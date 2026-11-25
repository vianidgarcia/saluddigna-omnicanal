import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { WebSocket } from 'ws'
import { extraerDigitosDeVoz } from '../agenteRecepcion.js'
import type { ConfigServidor } from '../config.js'
import { GroqClient } from '../groqClient.js'
import type { ISupabaseBridge, ResultadoOtp, ResultadoValidacion, UsuarioAuthVerificado } from '../supabaseBridge.js'
import type { Contexto, MensajeWsServidor, TurnoDialogo } from '../tipos.js'
import { crearServidorCallCenter } from '../wsServer.js'

class MockSupabaseBridge implements ISupabaseBridge {
  servicioDisponible = true
  mensajesGuardados: { interaccionIaId: string; resumen: string; turnos: TurnoDialogo[] }[] = []
  interaccionesCerradas: { id: string; resultado: string }[] = []
  ultimoTargetOtp: { interaccionId: string; jwtAsesor?: string } | null = null
  preEnlazarAsesor = false

  private readonly ctxDeclarada: Contexto = {
    sesion: {
      interaccion_id: 'int-ia-1',
      canal: 'call_center',
      nivel_verificacion: 'declarada',
      requiere_verificacion: true,
      metodos: ['fecha_nacimiento', 'otp'],
    },
    paciente: { id: 'pac-1', tiene_fecha_nacimiento: true },
    tramite_activo: null,
    tramites_abiertos: [{ id: 'tr-1', folio: 'SD-4K7Q', paso_actual: 'seleccion_horario' }],
  }

  private ctxVerificada(interaccionId: string): Contexto {
    return {
      sesion: {
        interaccion_id: interaccionId,
        canal: 'call_center',
        nivel_verificacion: 'verificada',
        requiere_verificacion: false,
        requiere_registro: [],
      },
      paciente: {
        id: 'pac-1',
        estado: 'verificado',
        nombre: 'Ana López García',
        nombre_mostrar: 'Ana López García',
        telefono: '+52******4567',
        tiene_fecha_nacimiento: true,
        avisos_whatsapp: true,
      },
      tramite_activo: null,
      tramites_abiertos: [
        {
          id: 'tr-1',
          folio: 'SD-4K7Q',
          etiqueta: 'Ultrasonido obstétrico · para ti',
          paso_actual: 'seleccion_horario',
          paso_descripcion: 'Elegir fecha y horario',
          ultimo_canal: 'whatsapp',
        },
      ],
      citas_proximas: [
        {
          id: 'cita-1',
          fecha_hora: '2026-11-28T16:00:00Z',
          estado: 'reservada',
          estudio: 'Biometría hemática',
          clinica: 'Puebla (centro)',
          precio: 180,
          folio: 'SD-9M2P',
          beneficiario: { id: 'pac-1', nombre: 'Ana López García', relacion: 'titular' },
        },
      ],
      pagos_pendientes: [],
    }
  }

  async verificarJwtUsuario(jwt: string): Promise<UsuarioAuthVerificado | null> {
    if (jwt === 'jwt-asesor-1') {
      return { userId: 'staff-1', telefono: null, telefonoConfirmado: false, email: 'asesor@demo.mx', rol: 'asesor' }
    }
    if (jwt === 'jwt-paciente-verificado') {
      return { userId: 'pac-auth-1', telefono: '528661234567', telefonoConfirmado: true }
    }
    return null
  }

  async abrirContactoIa(_telefono: string, nivel: 'declarada' | 'canal'): Promise<Contexto> {
    if (nivel === 'canal') {
      return {
        ...this.ctxDeclarada,
        sesion: { ...this.ctxDeclarada.sesion, nivel_verificacion: 'canal', requiere_verificacion: false },
        paciente: { ...this.ctxDeclarada.paciente, nombre: 'Ana' },
      }
    }
    return this.ctxDeclarada
  }

  async abrirContactoAsesor(_jwtAsesor: string, _telefono: string): Promise<Contexto> {
    this.preEnlazarAsesor = true
    return {
      ...this.ctxDeclarada,
      sesion: { ...this.ctxDeclarada.sesion, interaccion_id: 'int-asesor-1' },
    }
  }

  async obtenerContexto(interaccionId: string): Promise<Contexto> {
    return this.ctxVerificada(interaccionId)
  }

  async solicitarYEnviarOtp(params: {
    interaccionId: string
    telefono: string
    jwtAsesor?: string
  }): Promise<ResultadoOtp> {
    this.ultimoTargetOtp = { interaccionId: params.interaccionId, jwtAsesor: params.jwtAsesor }
    return { expira_en: '2026-11-25T03:00:00Z', telefono_enmascarado: '+52******4567', entregado: true }
  }

  async validarOtp(interaccionId: string, codigo: string): Promise<ResultadoValidacion> {
    if (codigo === '123456') {
      return { verificado: true, nivel_verificacion: 'verificada', contexto: this.ctxVerificada(interaccionId) }
    }
    return { verificado: false, motivo: 'codigo_incorrecto' }
  }

  async verificarFechaNacimiento(): Promise<ResultadoValidacion> {
    return { verificado: false, motivo: 'dato_no_coincide' }
  }

  async registrarMensajesRecepcion(interaccionIaId: string, turnos: TurnoDialogo[], resumen: string): Promise<void> {
    this.mensajesGuardados.push({ interaccionIaId, resumen, turnos })
  }

  async cerrarInteraccion(interaccionId: string, resultado: string): Promise<void> {
    this.interaccionesCerradas.push({ id: interaccionId, resultado })
  }
}

const cfgTest: ConfigServidor = {
  port: 0,
  corsOrigin: '*',
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'test-anon',
  supabaseServiceRoleKey: 'test-service',
  groqApiKey: '', // Sin key en test para probar el flujo determinista sin consumir cuota
  groqModel: 'llama-3.1-8b-instant',
  groqMaxRpm: 20,
  enableServerTts: false, // Sin red externa en test
  ttsVoice: 'es-MX-DaliaNeural',
}

function esperarMensaje(ws: WebSocket, predicado: (m: MensajeWsServidor) => boolean): Promise<MensajeWsServidor> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout esperando mensaje WS')), 3000)
    const onMsg = (raw: WebSocket.RawData) => {
      const m = JSON.parse(raw.toString()) as MensajeWsServidor
      if (predicado(m)) {
        clearTimeout(timer)
        ws.off('message', onMsg)
        resolve(m)
      }
    }
    ws.on('message', onMsg)
  })
}

test('extraerDigitosDeVoz convierte palabras habladas y números mezclados', () => {
  assert.equal(extraerDigitosDeVoz('mi número es ocho seis seis uno dos tres 45 67'), '8661234567')
  assert.equal(extraerDigitosDeVoz('el código es uno dos tres cuatro cinco seis'), '123456')
})

test('flujo híbrido completo: asesor online -> cliente pide ayuda -> IA valida OTP -> Screen-Pop verificado -> cuelga', async () => {
  const bridge = new MockSupabaseBridge()
  const groq = new GroqClient(cfgTest)
  const { server } = crearServidorCallCenter({ cfg: cfgTest, bridge, groq })

  server.listen(0)
  await once(server, 'listening')
  const addr = server.address() as { port: number }
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws`

  const asesorWs = new WebSocket(wsUrl)
  const clienteWs = new WebSocket(wsUrl)
  await Promise.all([once(asesorWs, 'open'), once(clienteWs, 'open')])

  try {
    // 1. Asesor se conecta a la cola
    const regP = esperarMensaje(asesorWs, (m) => m.tipo === 'advisor:registered')
    asesorWs.send(JSON.stringify({ tipo: 'advisor:online', jwtAsesor: 'jwt-asesor-1' }))
    const reg = await regP
    assert.equal(reg.tipo, 'advisor:registered')

    // 2. Cliente hace clic en "Buscar ayuda telefónica" sin número previo
    const startedP = esperarMensaje(clienteWs, (m) => m.tipo === 'call:started')
    const saludoP = esperarMensaje(clienteWs, (m) => m.tipo === 'ia:utterance')
    clienteWs.send(JSON.stringify({ tipo: 'call:start' }))
    const started = await startedP
    assert.equal(started.tipo, 'call:started')
    const saludo = await saludoP
    assert.equal(saludo.tipo, 'ia:utterance')
    assert.equal(saludo.esperaRespuesta, 'telefono')

    // 3. Cliente dicta su número por voz -> IA pre-enlaza al asesor y manda OTP sobre la sesión del asesor
    const pideOtpP = esperarMensaje(clienteWs, (m) => m.tipo === 'ia:utterance')
    clienteWs.send(JSON.stringify({ tipo: 'call:speech', callId: started.callId, texto: '866 123 4567', origen: 'voz' }))
    const pideOtp = await pideOtpP
    assert.equal(pideOtp.tipo, 'ia:utterance')
    assert.equal(pideOtp.esperaRespuesta, 'otp')
    assert.equal(bridge.preEnlazarAsesor, true)
    assert.equal(bridge.ultimoTargetOtp?.interaccionId, 'int-asesor-1')

    // 4. Cliente dicta código incorrecto -> IA rechaza y mantiene etapa OTP
    const otpMaloP = esperarMensaje(clienteWs, (m) => m.tipo === 'ia:utterance')
    clienteWs.send(JSON.stringify({ tipo: 'call:speech', callId: started.callId, texto: '999999', origen: 'voz' }))
    const otpMalo = await otpMaloP
    assert.equal(otpMalo.tipo, 'ia:utterance')
    assert.equal(otpMalo.esperaRespuesta, 'otp')

    // 5. Cliente dicta código correcto -> IA lee nombre real ("Ana López García") y pregunta qué trámite desea continuar
    const confirmaNombreP = esperarMensaje(clienteWs, (m) => m.tipo === 'ia:utterance')
    clienteWs.send(JSON.stringify({ tipo: 'call:speech', callId: started.callId, texto: 'uno dos tres cuatro cinco seis', origen: 'voz' }))
    const confirmaNombre = await confirmaNombreP
    assert.equal(confirmaNombre.tipo, 'ia:utterance')
    assert.equal(confirmaNombre.esperaRespuesta, 'motivo')
    assert.match(confirmaNombre.texto, /Ana López García/)
    assert.match(confirmaNombre.texto, /SD-4K7Q/)

    // 6. Cliente dice que quiere continuar con su ultrasonido -> IA transfiere y salta Pop-up en asesor
    const ringingP = esperarMensaje(asesorWs, (m) => m.tipo === 'advisor:ringing')
    const transP = esperarMensaje(clienteWs, (m) => m.tipo === 'call:transferring')
    clienteWs.send(JSON.stringify({ tipo: 'call:speech', callId: started.callId, texto: 'Quiero continuar con mi ultrasonido', origen: 'voz' }))

    const [ringing, trans] = await Promise.all([ringingP, transP])
    assert.equal(trans.tipo, 'call:transferring')
    assert.equal(ringing.tipo, 'advisor:ringing')
    assert.equal(ringing.pop.interaccionAsesorId, 'int-asesor-1')
    assert.equal(ringing.pop.requiereRevalidarEnAsesor, false)
    assert.equal(ringing.pop.contexto?.paciente.nombre, 'Ana López García')
    assert.equal(ringing.pop.brief.tramiteFolioSugerido, 'SD-4K7Q')
    assert.equal(bridge.mensajesGuardados.length, 1)

    // 7. Asesor contesta -> cliente recibe call:connected
    const connectedP = esperarMensaje(clienteWs, (m) => m.tipo === 'call:connected')
    asesorWs.send(JSON.stringify({ tipo: 'advisor:answer', callId: started.callId }))
    const connected = await connectedP
    assert.equal(connected.tipo, 'call:connected')
    assert.equal(connected.asesorNombre, 'asesor@demo.mx')

    // 8. Asesor cuelga -> se liberan interacciones en Supabase
    const endedClienteP = esperarMensaje(clienteWs, (m) => m.tipo === 'call:ended')
    const endedAsesorP = esperarMensaje(asesorWs, (m) => m.tipo === 'advisor:call_ended')
    asesorWs.send(JSON.stringify({ tipo: 'advisor:hangup', callId: started.callId }))
    await Promise.all([endedClienteP, endedAsesorP])

    assert.ok(bridge.interaccionesCerradas.some((x) => x.id === 'int-asesor-1' && x.resultado === 'llamada_terminada'))
  } finally {
    clienteWs.close()
    asesorWs.close()
    server.close()
  }
})

test('flujo con sesión web verificada (saludo inmediato por nombre) y asesor que entra después', async () => {
  const bridge = new MockSupabaseBridge()
  const groq = new GroqClient(cfgTest)
  const { server } = crearServidorCallCenter({ cfg: cfgTest, bridge, groq })

  server.listen(0)
  await once(server, 'listening')
  const addr = server.address() as { port: number }
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws`

  const clienteWs = new WebSocket(wsUrl)
  await once(clienteWs, 'open')

  try {
    // 1. Paciente ya logueado en la web principal llama sin haber asesor online todavía
    const startedP = esperarMensaje(clienteWs, (m) => m.tipo === 'call:started')
    const saludoP = esperarMensaje(clienteWs, (m) => m.tipo === 'ia:utterance')
    clienteWs.send(JSON.stringify({ tipo: 'call:start', jwtSupabase: 'jwt-paciente-verificado' }))

    const started = await startedP
    const saludo = await saludoP
    assert.equal(started.tipo, 'call:started')
    assert.equal(saludo.tipo, 'ia:utterance')
    // Ya lo saluda por su nombre desde Supabase y pasa directo a pedir OTP (sin pedir teléfono)
    assert.match(saludo.texto, /Hola Ana/)
    assert.equal(saludo.esperaRespuesta, 'otp')
    assert.equal(bridge.preEnlazarAsesor, false)

    // 2. Valida OTP -> confirma identidad y pregunta motivo
    const motivoP = esperarMensaje(clienteWs, (m) => m.tipo === 'ia:utterance')
    clienteWs.send(JSON.stringify({ tipo: 'call:speech', callId: started.callId, texto: '123456' }))
    const motivo = await motivoP
    assert.equal(motivo.tipo, 'ia:utterance')
    assert.equal(motivo.esperaRespuesta, 'motivo')

    // 3. Paciente confirma que quiere información -> queda en espera de asesor
    const transP = esperarMensaje(clienteWs, (m) => m.tipo === 'call:transferring')
    clienteWs.send(JSON.stringify({ tipo: 'call:speech', callId: started.callId, texto: 'Quiero información de precios' }))
    const trans = await transP
    assert.equal(trans.tipo, 'call:transferring')

    // 4. Ahora se conecta el asesor y recibe automáticamente el Pop-up de la llamada en cola
    const asesorWs = new WebSocket(wsUrl)
    await once(asesorWs, 'open')
    const ringingP = esperarMensaje(asesorWs, (m) => m.tipo === 'advisor:ringing')
    asesorWs.send(JSON.stringify({ tipo: 'advisor:online', jwtAsesor: 'jwt-asesor-1' }))
    const ringing = await ringingP
    assert.equal(ringing.tipo, 'advisor:ringing')
    assert.equal(ringing.pop.brief.motivo, 'informacion')
    assert.equal(ringing.pop.requiereRevalidarEnAsesor, true)
    asesorWs.close()
  } finally {
    clienteWs.close()
    server.close()
  }
})

