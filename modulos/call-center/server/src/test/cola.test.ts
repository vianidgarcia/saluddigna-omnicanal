import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { WebSocket } from 'ws'
import type { ConfigServidor } from '../config.js'
import { GroqClient } from '../groqClient.js'
import { ErrorPuente, type ISupabaseBridge } from '../supabaseBridge.js'
import type { Contexto, MensajeWsServidor } from '../tipos.js'
import { crearServidorCallCenter } from '../wsServer.js'

const cfg: ConfigServidor = {
  port: 0, corsOrigin: '*', supabaseUrl: 'x', supabaseAnonKey: 'x', supabaseServiceRoleKey: 'x', groqApiKey: '',
  groqModel: 'm', groqMaxRpm: 1, enableServerTts: false, ttsVoice: 'v',
}
const ctx = (id: string, nivel: 'declarada' | 'verificada'): Contexto => ({
  sesion: { interaccion_id: id, canal: 'call_center', nivel_verificacion: nivel, requiere_verificacion: nivel === 'declarada' },
  paciente: { id: 'p', nombre: nivel === 'verificada' ? 'Ana' : null, tiene_fecha_nacimiento: true },
  tramite_activo: null,
  tramites_abiertos: [],
})
const pausa = (ms = 80) => new Promise((r) => setTimeout(r, ms))

class Puente implements ISupabaseBridge {
  servicioDisponible = true
  entregado = true
  fallaAsesor = ''
  demora = 0
  n = 0
  cerradas: string[] = []
  abiertas: string[] = []
  mensajes: string[] = []
  async verificarJwtUsuario(j: string) {
    if (!j.startsWith('asesor')) return null
    const id = j.split(':')[0]
    return { userId: id, telefono: null, telefonoConfirmado: false, email: id, rol: 'asesor' }
  }
  private abrir(prefijo: string) {
    const id = `${prefijo}-${++this.n}`
    this.abiertas.push(id)
    return ctx(id, 'declarada')
  }
  async abrirContactoIa() { await pausa(this.demora); return this.abrir('ia') }
  async abrirContactoAsesor(jwt: string) {
    if (this.fallaAsesor === jwt) throw new ErrorPuente('PT429', 'límite')
    return this.abrir('hum')
  }
  async obtenerContexto(id: string) { return ctx(id, 'verificada') }
  async solicitarYEnviarOtp() { return { expira_en: '', telefono_enmascarado: '****4567', entregado: this.entregado } }
  async validarOtp(id: string, c: string) {
    return c === '123456' ? { verificado: true, contexto: ctx(id, 'verificada') } : { verificado: false }
  }
  async verificarFechaNacimiento() { return { verificado: false } }
  async registrarMensajesRecepcion(id: string, turnos: { texto: string }[]) { this.mensajes.push(id + JSON.stringify(turnos)) }
  async cerrarInteraccion(id: string) { this.cerradas.push(id) }
}

class Cli {
  msgs: MensajeWsServidor[] = []
  constructor(readonly ws: WebSocket) { ws.on('message', (r) => this.msgs.push(JSON.parse(r.toString()))) }
  enviar(m: object) { this.ws.send(JSON.stringify(m)) }
  async espera<T extends MensajeWsServidor['tipo']>(tipo: T, n = 1): Promise<Extract<MensajeWsServidor, { tipo: T }>> {
    for (let i = 0; i < 150; i++) {
      const x = this.msgs.filter((m) => m.tipo === tipo)
      if (x.length >= n) return x[n - 1] as never
      await pausa(10)
    }
    throw new Error(`no llegó ${tipo} #${n}: ${JSON.stringify(this.msgs)}`)
  }
  cuenta(tipo: string) { return this.msgs.filter((m) => m.tipo === tipo).length }
}

interface Escena {
  p: Puente
  conectar: () => Promise<Cli>
  asesor: (n: string) => Promise<Cli>
  transferida: (otp?: string[]) => Promise<{ c: Cli; callId: string }>
}
const caso = (nombre: string, fn: (e: Escena) => Promise<void>, prep?: (p: Puente) => void) =>
  test(nombre, async () => {
    const p = new Puente()
    prep?.(p)
    const { server, wss } = crearServidorCallCenter({ cfg, bridge: p, groq: new GroqClient(cfg), tiempos: { timbreMs: 250, reintentoMs: 100 } })
    server.listen(0)
    await once(server, 'listening')
    const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/ws`
    const conectar = async () => {
      const c = new Cli(new WebSocket(url))
      await once(c.ws, 'open')
      return c
    }
    const asesor = async (n: string) => {
      const a = await conectar()
      a.enviar({ tipo: 'advisor:online', jwtAsesor: n })
      await a.espera('advisor:registered')
      return a
    }
    const transferida = async (otp = ['123456']) => {
      const c = await conectar()
      c.enviar({ tipo: 'call:start', telefonoSugerido: '8661234567' })
      const { callId } = await c.espera('call:started')
      for (const texto of [...otp, 'quiero una cita']) c.enviar({ tipo: 'call:speech', callId, texto })
      await c.espera('call:transferring')
      return { c, callId }
    }
    try {
      await fn({ p, conectar, asesor, transferida })
    } finally {
      for (const w of wss.clients) w.terminate()
      await pausa(30)
      server.close()
    }
  })

caso('rechazo: pasa al siguiente asesor y este debe revalidar', async ({ p, asesor, transferida }) => {
  const a = await asesor('asesorA')
  const b = await asesor('asesorB')
  const { c, callId } = await transferida()
  assert.equal((await a.espera('advisor:ringing')).pop.requiereRevalidarEnAsesor, false)
  a.enviar({ tipo: 'advisor:reject', callId })
  assert.equal((await b.espera('advisor:ringing')).pop.requiereRevalidarEnAsesor, true)
  b.enviar({ tipo: 'advisor:answer', callId })
  assert.equal((await b.espera('advisor:answered')).pop.requiereRevalidarEnAsesor, true)
  await c.espera('call:connected')
  assert.ok(p.cerradas.includes('hum-2'), 'se cierra la interacción del que rechazó')
})

caso('sin respuesta: el timbre vence y pasa al siguiente', async ({ asesor, transferida }) => {
  const a = await asesor('asesorA')
  const b = await asesor('asesorB')
  await transferida()
  await a.espera('advisor:ringing')
  await b.espera('advisor:ringing')
})

caso('único asesor rechaza: se le vuelve a ofrecer', async ({ asesor, transferida }) => {
  const a = await asesor('asesorA')
  const { callId } = await transferida()
  await a.espera('advisor:ringing')
  a.enviar({ tipo: 'advisor:reject', callId })
  await a.espera('advisor:ringing', 2)
})

caso('dos llamadas no comparten asesor; la segunda entra al liberarse', async ({ asesor, transferida }) => {
  const a = await asesor('asesorA')
  const uno = await transferida()
  await a.espera('advisor:ringing')
  a.enviar({ tipo: 'advisor:answer', callId: uno.callId })
  await a.espera('advisor:answered')
  await transferida()
  await pausa()
  assert.equal(a.cuenta('advisor:ringing'), 1)
  a.enviar({ tipo: 'advisor:hangup', callId: uno.callId })
  await a.espera('advisor:ringing', 2)
})

caso('solo contesta a quien le timbra; un tercero no cuelga, habla ni señaliza', async ({ conectar, asesor, transferida }) => {
  const a = await asesor('asesorA')
  const b = await asesor('asesorB')
  const { c, callId } = await transferida()
  await a.espera('advisor:ringing')
  b.enviar({ tipo: 'advisor:answer', callId })
  await b.espera('advisor:call_taken')
  a.enviar({ tipo: 'advisor:answer', callId })
  await c.espera('call:connected')
  const x = await conectar()
  for (const m of [
    { tipo: 'call:hangup' }, { tipo: 'advisor:hangup' }, { tipo: 'webrtc:signal', hacia: 'asesor', signal: 1 },
    { tipo: 'chat:send', texto: 'hola' }, { tipo: 'call:speech', texto: 'x' },
  ]) x.enviar({ ...m, callId })
  b.enviar({ tipo: 'advisor:hangup', callId })
  await x.espera('error')
  await pausa()
  assert.equal(c.cuenta('call:ended') + a.cuenta('webrtc:signal') + a.cuenta('chat:message'), 0)
  c.enviar({ tipo: 'chat:send', callId, texto: 'hola' })
  assert.equal((await a.espera('chat:message')).desde, 'cliente')
})

caso('tres códigos malos: transfiere sin verificar, sin datos y sin guardar códigos', async ({ p, asesor, transferida }) => {
  const a = await asesor('asesorA')
  await transferida(['111111', '222222', '333333'])
  const { pop } = await a.espera('advisor:ringing')
  assert.equal(pop.brief.verificadoPor, 'sin_verificar')
  assert.equal(pop.requiereRevalidarEnAsesor, true)
  assert.equal(pop.contexto, null)
  assert.doesNotMatch(p.mensajes.join(), /111111|222222/)
})

caso('código no entregado: no se pide', async ({ conectar }) => {
  const c = await conectar()
  c.enviar({ tipo: 'call:start', telefonoSugerido: '8661234567' })
  assert.equal((await c.espera('ia:utterance')).esperaRespuesta, 'motivo')
}, (p) => { p.entregado = false })

caso('sin clave de servicio y sin asesor: el contacto se abre al contestar', async ({ p, asesor, transferida }) => {
  const { c, callId } = await transferida([])
  assert.equal(p.abiertas.length, 0)
  const a = await asesor('asesorA')
  await a.espera('advisor:ringing')
  a.enviar({ tipo: 'advisor:answer', callId })
  await c.espera('call:connected')
  assert.deepEqual(p.abiertas, ['hum-1'])
  assert.equal(p.mensajes.length, 1)
}, (p) => { p.servicioDisponible = false })

caso('si falla abrir el contacto, la llamada regresa a la cola', async ({ p, asesor, transferida }) => {
  const { c, callId } = await transferida()
  const a = await asesor('asesorA')
  p.fallaAsesor = 'asesorA'
  await a.espera('advisor:ringing')
  a.enviar({ tipo: 'advisor:answer', callId })
  await a.espera('error')
  p.fallaAsesor = ''
  await a.espera('advisor:ringing', 2)
  a.enviar({ tipo: 'advisor:answer', callId })
  await c.espera('call:connected')
})

caso('el paciente cuelga: el asesor termina de capturar antes de cerrar', async ({ p, asesor, transferida }) => {
  const a = await asesor('asesorA')
  const { c, callId } = await transferida()
  await a.espera('advisor:ringing')
  a.enviar({ tipo: 'advisor:answer', callId })
  const id = (await a.espera('advisor:answered')).pop.interaccionAsesorId!
  c.ws.close()
  await a.espera('advisor:call_ended')
  assert.ok(!p.cerradas.includes(id))
  a.enviar({ tipo: 'advisor:hangup', callId })
  await pausa()
  assert.ok(p.cerradas.includes(id))
})

caso('colgar a media consulta no deja interacciones abiertas', async ({ p, conectar, asesor, transferida }) => {
  const a = await asesor('asesorA')
  const c = await conectar()
  c.enviar({ tipo: 'call:start', telefonoSugerido: '8661234567' })
  await pausa(30)
  c.ws.close()
  await pausa(250)
  assert.ok(p.abiertas.length > 0)
  assert.deepEqual([...new Set(p.cerradas)].sort(), [...p.abiertas].sort())
  await transferida()
  await a.espera('advisor:ringing')
}, (p) => { p.demora = 100 })

caso('token renovado no corta; si el asesor se desconecta, la llamada termina', async ({ asesor, transferida }) => {
  const a = await asesor('asesorA')
  const { c, callId } = await transferida()
  await a.espera('advisor:ringing')
  a.enviar({ tipo: 'advisor:answer', callId })
  await c.espera('call:connected')
  a.enviar({ tipo: 'advisor:online', jwtAsesor: 'asesorA:nuevo' })
  await a.espera('advisor:registered', 2)
  assert.equal(c.cuenta('call:ended'), 0)
  a.ws.close()
  assert.equal((await c.espera('call:ended')).motivo, 'asesor_desconectado')
})

caso('quien no es personal no entra a la cola', async ({ conectar }) => {
  const x = await conectar()
  x.enviar({ tipo: 'advisor:online', jwtAsesor: 'paciente' })
  assert.equal((await x.espera('error')).code, '42501')
})

caso('directo: timbra sin contestadora, y el código del paciente verifica al asesor', async ({ conectar, asesor }) => {
  const a = await asesor('asesorA')
  const c = await conectar()
  c.enviar({ tipo: 'call:start', directo: true, telefonoSugerido: '8661234567', borrador: { estudio: 'Mastografía', otro: 'x' } })
  const { callId } = await c.espera('call:started')
  const pop = (await a.espera('advisor:ringing')).pop
  assert.equal(pop.contexto, null, 'sin verificar no viaja el expediente')
  assert.equal(pop.borrador?.estudio, 'Mastografía')
  assert.ok(!('otro' in pop.borrador!))
  c.enviar({ tipo: 'call:otp', callId, codigo: '123456' }) // aún no contestan: se ignora
  a.enviar({ tipo: 'advisor:answer', callId })
  await c.espera('call:otp_request')
  c.enviar({ tipo: 'call:otp', callId, codigo: '000000' })
  assert.equal((await c.espera('call:otp_result')).ok, false)
  assert.equal(a.cuenta('advisor:verified'), 0)
  c.enviar({ tipo: 'call:otp', callId, codigo: '123456' })
  await a.espera('advisor:verified')
  assert.equal((await c.espera('call:otp_result', 2)).ok, true)
})

caso('directo sin teléfono: error y sin llamada fantasma', async ({ conectar, asesor }) => {
  const a = await asesor('asesorA')
  const c = await conectar()
  c.enviar({ tipo: 'call:start', directo: true })
  assert.equal((await c.espera('error')).code, 'TELEFONO')
  await pausa()
  assert.equal(a.cuenta('advisor:ringing'), 0)
})

caso('código: otro socket no puede verificar y hay tope de intentos', async ({ conectar, asesor }) => {
  const a = await asesor('asesorA')
  const c = await conectar()
  c.enviar({ tipo: 'call:start', directo: true, telefonoSugerido: '8661234567' })
  const { callId } = await c.espera('call:started')
  await a.espera('advisor:ringing')
  a.enviar({ tipo: 'advisor:answer', callId })
  await c.espera('call:connected')
  const x = await conectar()
  x.enviar({ tipo: 'call:otp', callId, codigo: '123456' })
  for (let i = 0; i < 5; i++) c.enviar({ tipo: 'call:otp', callId, codigo: '000000' })
  await c.espera('call:otp_result', 5)
  c.enviar({ tipo: 'call:otp', callId, codigo: '123456' })
  assert.equal((await c.espera('call:otp_result', 6)).ok, false)
  assert.equal(a.cuenta('advisor:verified'), 0)
})
