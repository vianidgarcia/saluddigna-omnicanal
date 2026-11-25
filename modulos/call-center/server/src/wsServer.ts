import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { AgenteRecepcion, type EstadoLlamada, type RespuestaAgente } from './agenteRecepcion.js'
import type { ConfigServidor } from './config.js'
import type { GroqClient } from './groqClient.js'
import { ErrorPuente, type ISupabaseBridge } from './supabaseBridge.js'
import type { Borrador, MensajeWsCliente, MensajeWsServidor, PayloadScreenPop } from './tipos.js'
import { sintetizarVoz } from './tts.js'

interface AsesorConectado {
  socketId: string
  ws: WebSocket
  userId: string
  jwt: string
  email: string
  rol: string
  /** Llamada que lo tiene apartado (preasignada, timbrando o en curso). Un asesor, una llamada. */
  callId: string | null
  /** El paciente colgó y el asesor sigue capturando: su interacción se cierra cuando él termine. */
  porCerrar: string | null
}

interface LlamadaActiva {
  estado: EstadoLlamada
  clienteWs: WebSocket
  asesorSocketId: string | null
  timbraEn: string | null
  rechazadaPor: Set<string>
  timer?: NodeJS.Timeout
  inactividad?: NodeJS.Timeout
  /** Los mensajes de una llamada se procesan en orden, uno a la vez. */
  cola: Promise<void>
  pop?: PayloadScreenPop
  borrador: Borrador | null
  intentosCodigo: number
}

export interface Tiempos {
  timbreMs: number
  reintentoMs: number
  inactividadMs: number
}
const TIEMPOS: Tiempos = { timbreMs: 45_000, reintentoMs: 10_000, inactividadMs: 180_000 }
const MAX_LLAMADAS = 50
/** Solo los campos conocidos y cortos: viene del navegador del paciente. */
const limpiarBorrador = (b: unknown): Borrador | null => {
  if (!b || typeof b !== 'object') return null
  const o = b as Record<string, unknown>
  const txt = (k: string) => (typeof o[k] === 'string' && o[k] ? (o[k] as string).slice(0, 100) : null)
  const r = { nombre: txt('nombre'), estudio: txt('estudio'), clinica: txt('clinica'), fecha: txt('fecha'), hora: txt('hora'), paso: txt('paso') }
  return Object.values(r).some(Boolean) ? r : null
}
const ROLES_ASESOR = new Set(['asesor', 'supervisor', 'admin'])

export function crearServidorCallCenter(deps: {
  cfg: ConfigServidor
  bridge: ISupabaseBridge
  groq: GroqClient
  tiempos?: Partial<Tiempos>
}): { server: Server; wss: WebSocketServer } {
  const { cfg, bridge, groq } = deps
  const t = { ...TIEMPOS, ...deps.tiempos }
  const agente = new AgenteRecepcion(bridge, groq)

  const asesores = new Map<string, AsesorConectado>()
  const llamadas = new Map<string, LlamadaActiva>()
  const llamadaDeCliente = new Map<WebSocket, string>()
  const asesorDeSocket = new Map<WebSocket, string>()

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin)
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        ok: true,
        asesoresEnLinea: asesores.size,
        llamadasActivas: llamadas.size,
        contestadoraEnBase: bridge.servicioDisponible,
        groqDisponible: groq.disponible,
        ttsServidor: cfg.enableServerTts,
      }))
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 64 * 1024,
    verifyClient: ({ origin }: { origin: string }) =>
      cfg.corsOrigin === '*' || cfg.corsOrigin.split(',').map((o) => o.trim()).includes(origin),
  })

  const enviar = (ws: WebSocket | undefined, msg: MensajeWsServidor) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }
  const libre = (a: AsesorConectado) => !a.callId && a.ws.readyState === WebSocket.OPEN
  const soltar = (socketId: string | null, callId: string) => {
    const a = socketId ? asesores.get(socketId) : undefined
    if (a && a.callId === callId) a.callId = null
  }

  /** Aparta un asesor libre para la llamada, para que su OTP quede en SU interacción. */
  const preasignar = (l: LlamadaActiva): AsesorConectado | null => {
    const previo = l.estado.asesorPreasignadoSocketId
    if (previo) return asesores.get(previo) ?? null
    for (const a of asesores.values()) {
      if (libre(a)) {
        a.callId = l.estado.callId
        return a
      }
    }
    return null
  }

  const cerrar = async (id: string | null, resultado: string, jwt?: string | null) => {
    if (id) await bridge.cerrarInteraccion(id, resultado, jwt ?? undefined).catch(() => {})
  }

  const emitir = async (l: LlamadaActiva, r: RespuestaAgente) => {
    const { estado, clienteWs } = l
    const ctx = estado.verificado ? estado.contexto : null
    enviar(clienteWs, {
      tipo: 'call:state',
      callId: estado.callId,
      etapa: estado.etapa,
      otpEnviadoA: r.otpEnviadoA,
      contextoResumen: ctx
        ? {
            nivel: ctx.sesion.nivel_verificacion,
            nombre: ctx.paciente.nombre || ctx.paciente.nombre_mostrar,
            tramitesCount: ctx.tramites_abiertos?.length ?? 0,
            citasCount: ctx.citas_proximas?.length ?? 0,
          }
        : undefined,
    })
    const audio = await sintetizarVoz(r.texto, cfg)
    enviar(clienteWs, {
      tipo: 'ia:utterance',
      callId: estado.callId,
      texto: r.texto,
      audioBase64: audio?.audioBase64 ?? null,
      audioMime: audio?.mime ?? null,
      esperaRespuesta: r.esperaRespuesta,
    })
  }

  // ---------------------------------------------------------- cola y timbre
  const dejarDeTimbrar = (l: LlamadaActiva) => {
    clearTimeout(l.timer)
    if (!l.timbraEn) return
    const a = asesores.get(l.timbraEn)
    soltar(l.timbraEn, l.estado.callId)
    if (a) enviar(a.ws, { tipo: 'advisor:call_taken', callId: l.estado.callId, porOtro: true })
    l.timbraEn = null
  }

  const timbrar = (l: LlamadaActiva) => {
    const id = l.estado.callId
    if (!l.pop || l.asesorSocketId || l.timbraEn || !llamadas.has(id)) return
    const puede = (a: AsesorConectado) =>
      a.ws.readyState === WebSocket.OPEN && (!a.callId || a.callId === id) && !l.rechazadaPor.has(a.userId)
    const pre = l.estado.asesorPreasignadoSocketId ? asesores.get(l.estado.asesorPreasignadoSocketId) : undefined
    const a = pre && puede(pre) ? pre : [...asesores.values()].find(puede)
    clearTimeout(l.timer)
    if (!a) {
      // Todos ocupados o rechazaron: se vuelve a ofrecer más tarde
      l.timer = setTimeout(() => {
        l.rechazadaPor.clear()
        timbrar(l)
      }, t.reintentoMs)
      return
    }
    if (pre && pre !== a) soltar(pre.socketId, id)
    a.callId = id
    l.timbraEn = a.socketId
    const propia = l.estado.asesorPreasignadoSocketId === a.socketId
    enviar(a.ws, {
      tipo: 'advisor:ringing',
      pop: {
        ...l.pop,
        interaccionAsesorId: propia ? l.estado.interaccionAsesorId : null,
        requiereRevalidarEnAsesor: !(propia && l.estado.verificado && l.estado.interaccionAsesorId),
      },
    })
    l.timer = setTimeout(() => {
      l.rechazadaPor.add(a.userId)
      dejarDeTimbrar(l)
      timbrar(l)
      atenderCola()
    }, t.timbreMs)
  }

  const atenderCola = () => {
    for (const l of llamadas.values()) timbrar(l)
  }

  const transferir = async (l: LlamadaActiva) => {
    const { estado } = l
    if (!estado.brief) return
    const jwt = estado.interaccionAsesorId ? estado.jwtAsesorPreasignado : null
    const donde = estado.interaccionIaId ?? estado.interaccionAsesorId
    if (donde) {
      await bridge
        .registrarMensajesRecepcion(donde, estado.turnos, estado.brief.resumenIa, estado.interaccionIaId ? undefined : (jwt ?? undefined))
        .catch(() => {})
    }
    await cerrar(estado.interaccionIaId, 'transferida_asesor')
    if (estado.interaccionAsesorId && jwt) {
      estado.contexto = await bridge.obtenerContexto(estado.interaccionAsesorId, jwt).catch(() => estado.contexto)
    }
    if (!llamadas.has(estado.callId)) return
    clearTimeout(l.inactividad)
    l.pop = {
      callId: estado.callId,
      borrador: l.borrador,
      creadaEn: estado.creadaEn,
      interaccionAsesorId: estado.interaccionAsesorId,
      interaccionIaId: estado.interaccionIaId,
      // Sin OTP, el asesor no recibe datos del expediente por esta vía
      contexto: estado.verificado ? estado.contexto : null,
      brief: estado.brief,
      transcripcionIa: estado.turnos,
      requiereRevalidarEnAsesor: true,
    }
    enviar(l.clienteWs, {
      tipo: 'call:transferring',
      callId: estado.callId,
      resumenIa: estado.brief.resumenIa,
      asesoresEnLinea: asesores.size,
    })
    timbrar(l)
  }

  // ---------------------------------------------------------- fin de llamada
  const finalizar = async (callId: string, motivo: string, porAsesor = false) => {
    const l = llamadas.get(callId)
    if (!l) return
    llamadas.delete(callId)
    llamadaDeCliente.delete(l.clienteWs)
    clearTimeout(l.inactividad)
    const { estado } = l
    const yaTransferida = Boolean(l.pop)
    estado.etapa = 'finalizada'
    dejarDeTimbrar(l)
    const atiende = l.asesorSocketId ? asesores.get(l.asesorSocketId) : undefined
    enviar(l.clienteWs, { tipo: 'call:ended', callId, motivo })
    if (atiende) enviar(atiende.ws, { tipo: 'advisor:call_ended', callId, motivo })

    if (atiende && !porAsesor) {
      atiende.porCerrar = estado.interaccionAsesorId // sigue apartado hasta advisor:hangup
    } else {
      soltar(l.asesorSocketId ?? estado.asesorPreasignadoSocketId, callId)
      await cerrar(estado.interaccionAsesorId, 'llamada_terminada', estado.jwtAsesorPreasignado)
    }
    if (!yaTransferida) await cerrar(estado.interaccionIaId, 'llamada_terminada')
    atenderCola()
  }

  const terminarCaptura = async (a: AsesorConectado) => {
    const id = a.porCerrar
    a.porCerrar = null
    a.callId = null
    await cerrar(id, 'llamada_terminada', a.jwt)
    atenderCola()
  }

  const vigilar = (l: LlamadaActiva) => {
    clearTimeout(l.inactividad)
    l.inactividad = setTimeout(() => void finalizar(l.estado.callId, 'inactividad'), t.inactividadMs)
  }

  const reportar = (ws: WebSocket, e: unknown) => {
    const err = e instanceof ErrorPuente ? e : new ErrorPuente('INTERNAL', 'Ocurrió un error en la llamada.')
    if (!(e instanceof ErrorPuente)) console.error('[call-center]', e)
    enviar(ws, { tipo: 'error', code: err.code, message: err.message })
  }

  /** Corre un turno de la contestadora en orden; si colgaron a media consulta, no deja sesiones abiertas. */
  const turno = (
    l: LlamadaActiva,
    fn: (asesor: AsesorConectado | null) => Promise<RespuestaAgente>,
    alEmpezar?: () => void,
  ): Promise<void> => {
    const id = l.estado.callId
    l.cola = l.cola
      .then(async () => {
        if (!llamadas.has(id)) return
        const e = l.estado.etapa
        if (e === 'transfiriendo_asesor' || e === 'en_llamada_asesor') return
        const pre = preasignar(l)
        let r: RespuestaAgente | null = null
        try {
          r = await fn(pre)
        } finally {
          if (!llamadas.has(id)) {
            soltar(pre?.socketId ?? null, id)
            await cerrar(l.estado.interaccionAsesorId, 'llamada_terminada', l.estado.jwtAsesorPreasignado)
            await cerrar(l.estado.interaccionIaId, 'llamada_terminada')
            atenderCola()
          } else if (pre && !l.estado.asesorPreasignadoSocketId) {
            soltar(pre.socketId, id) // sin interacción abierta no hay por qué apartarlo
            atenderCola()
          }
        }
        if (!r || !llamadas.has(id)) return
        vigilar(l)
        alEmpezar?.()
        await emitir(l, r)
        if (r.transferirAhora) await transferir(l)
      })
      .catch((e) => reportar(l.clienteWs, e))
    return l.cola
  }

  /** Ya en la llamada y sin verificar: se manda el código y el paciente lo escribe en su pantalla. */
  const pedirCodigo = async (l: LlamadaActiva, a: AsesorConectado) => {
    const { estado } = l
    if (estado.verificado || !estado.interaccionAsesorId) return
    try {
      const r = await bridge.solicitarYEnviarOtp({ interaccionId: estado.interaccionAsesorId, telefono: estado.telefono ?? '', jwtAsesor: a.jwt })
      if (!r.entregado) throw new ErrorPuente('SIN_ENVIO', '')
      enviar(l.clienteWs, { tipo: 'call:otp_request', callId: estado.callId, enviadoA: r.telefono_enmascarado })
    } catch {
      enviar(a.ws, { tipo: 'error', code: 'SIN_CODIGO', message: 'No se pudo enviar el código al paciente. Inténtalo en "Verificar identidad".' })
    }
  }

  const contestar = async (a: AsesorConectado, callId: string) => {
    const l = llamadas.get(callId)
    if (!l?.pop || l.asesorSocketId || l.timbraEn !== a.socketId) {
      enviar(a.ws, { tipo: 'advisor:call_taken', callId, porOtro: true })
      return
    }
    // Se aparta ANTES de cualquier espera: nadie más puede contestarla
    clearTimeout(l.timer)
    l.timbraEn = null
    l.asesorSocketId = a.socketId
    const { estado } = l
    const propia = estado.asesorPreasignadoSocketId === a.socketId && Boolean(estado.interaccionAsesorId)
    if (!propia) {
      try {
        const ctx = await bridge.abrirContactoAsesor(a.jwt, estado.telefono ?? '')
        await cerrar(estado.interaccionAsesorId, 'reasignada', estado.jwtAsesorPreasignado)
        estado.interaccionAsesorId = ctx.sesion.interaccion_id
        estado.jwtAsesorPreasignado = a.jwt
        estado.asesorPreasignadoSocketId = a.socketId
        // El nivel es por interacción: la nueva nace 'declarada'
        estado.verificado = ctx.sesion.nivel_verificacion === 'verificada'
        estado.contexto = ctx
        if (!estado.interaccionIaId) {
          await bridge.registrarMensajesRecepcion(ctx.sesion.interaccion_id, estado.turnos, l.pop.brief.resumenIa, a.jwt).catch(() => {})
        }
      } catch (e) {
        l.asesorSocketId = null
        l.rechazadaPor.add(a.userId)
        soltar(a.socketId, callId)
        enviar(a.ws, { tipo: 'advisor:call_taken', callId, porOtro: false })
        timbrar(l)
        throw e
      }
      if (!llamadas.has(callId) || !asesores.has(a.socketId)) {
        // Alguien se fue mientras se abría el contacto
        a.porCerrar = null
        if (a.callId === callId) a.callId = null
        await cerrar(estado.interaccionAsesorId, 'llamada_terminada', a.jwt)
        await finalizar(callId, 'asesor_desconectado', true)
        return
      }
    }
    estado.etapa = 'en_llamada_asesor'
    l.pop = {
      ...l.pop,
      contexto: estado.contexto,
      interaccionAsesorId: estado.interaccionAsesorId,
      requiereRevalidarEnAsesor: !estado.verificado,
    }
    enviar(a.ws, { tipo: 'advisor:answered', pop: l.pop })
    enviar(l.clienteWs, { tipo: 'call:connected', callId, asesorNombre: a.email, interaccionAsesorId: null })
    void pedirCodigo(l, a)
  }

  const desconectarAsesor = async (ws: WebSocket) => {
    const id = asesorDeSocket.get(ws)
    const a = id ? asesores.get(id) : undefined
    if (!a) return
    asesorDeSocket.delete(ws)
    asesores.delete(a.socketId)
    await cerrar(a.porCerrar, 'llamada_terminada', a.jwt)
    for (const l of [...llamadas.values()]) {
      if (l.asesorSocketId === a.socketId) {
        await finalizar(l.estado.callId, 'asesor_desconectado', true)
      } else if (l.timbraEn === a.socketId) {
        clearTimeout(l.timer)
        l.timbraEn = null
        timbrar(l)
      }
    }
  }

  const atender = async (ws: WebSocket, msg: MensajeWsCliente) => {
    const socketId = asesorDeSocket.get(ws)
    const asesor = socketId ? asesores.get(socketId) : undefined
    const propia = (callId: string) => (llamadaDeCliente.get(ws) === callId ? llamadas.get(callId) : undefined)

    switch (msg.tipo) {
      case 'call:start': {
        const anterior = llamadaDeCliente.get(ws)
        if (anterior) await finalizar(anterior, 'reemplazada')
        if (asesor || llamadas.size >= MAX_LLAMADAS) {
          throw new ErrorPuente('OCUPADO', 'Todas las líneas están ocupadas. Intenta en unos minutos.')
        }
        const callId = randomUUID()
        const l: LlamadaActiva = {
          clienteWs: ws,
          asesorSocketId: null,
          timbraEn: null,
          rechazadaPor: new Set(),
          cola: Promise.resolve(),
          borrador: limpiarBorrador(msg.borrador),
          intentosCodigo: 0,
          estado: {
            callId,
            creadaEn: new Date().toISOString(),
            etapa: 'conectando',
            telefono: null,
            origenWebVerificado: false,
            interaccionIaId: null,
            interaccionAsesorId: null,
            jwtAsesorPreasignado: null,
            asesorPreasignadoSocketId: null,
            contexto: null,
            intentosOtpFallidos: 0,
            verificado: false,
            aclaraciones: 0,
            turnos: [],
          },
        }
        llamadas.set(callId, l)
        llamadaDeCliente.set(ws, callId)
        vigilar(l)
        await turno(
          l,
          async (a) =>
            msg.directo ? agente.iniciarDirecto(l.estado, msg.telefonoSugerido) :
            agente.iniciar(l.estado, {
              jwtPaciente: msg.jwtSupabase,
              telefonoSugerido: msg.telefonoSugerido,
              asesorDisponible: a && { socketId: a.socketId, jwt: a.jwt },
            }),
          () =>
            enviar(ws, {
              tipo: 'call:started',
              callId,
              etapa: l.estado.etapa,
              telefono: l.estado.telefono ?? undefined,
              asesoresEnLinea: asesores.size,
            }),
        )
        if (l.estado.etapa === 'conectando') await finalizar(callId, 'error') // falló el arranque: sin llamadas fantasma
        return
      }
      case 'call:speech': {
        const l = propia(msg.callId)
        if (!l) throw new ErrorPuente('CALL_NOT_FOUND', 'La llamada no existe o ya terminó.')
        if (typeof msg.texto !== 'string') return
        await turno(l, (a) => agente.procesarMensaje(l.estado, msg.texto.slice(0, 500), a && { socketId: a.socketId, jwt: a.jwt }))
        return
      }
      case 'call:otp': {
        const l = propia(msg.callId)
        const a = l?.asesorSocketId ? asesores.get(l.asesorSocketId) : undefined
        if (!l || !a || l.estado.etapa !== 'en_llamada_asesor' || !l.estado.interaccionAsesorId || l.estado.verificado) return
        const codigo = String(msg.codigo).replace(/\D/g, '')
        if (l.intentosCodigo >= 5 || codigo.length !== 6) {
          const message = codigo.length !== 6 ? 'El código tiene 6 dígitos.' : 'Demasiados intentos. Sigue con el asesor.'
          enviar(ws, { tipo: 'call:otp_result', callId: msg.callId, ok: false, message })
          return
        }
        l.intentosCodigo += 1
        const v = await bridge.validarOtp(l.estado.interaccionAsesorId, codigo, a.jwt)
        if (v.verificado) {
          l.estado.verificado = true
          if (v.contexto) l.estado.contexto = v.contexto
          enviar(a.ws, { tipo: 'advisor:verified', callId: msg.callId })
        }
        const message = v.verificado ? 'Identidad confirmada. El asesor ya ve tu trámite.' : 'El código no coincide o ya venció.'
        enviar(ws, { tipo: 'call:otp_result', callId: msg.callId, ok: v.verificado, message })
        return
      }
      case 'call:hangup':
        if (propia(msg.callId)) await finalizar(msg.callId, 'cliente_colgo')
        return

      case 'advisor:online': {
        const u = await bridge.verificarJwtUsuario(msg.jwtAsesor)
        if (!u?.rol || !ROLES_ASESOR.has(u.rol)) {
          throw new ErrorPuente('42501', 'Solo personal autorizado (asesor, supervisor o admin) puede conectarse a la cola.')
        }
        if (ws.readyState !== WebSocket.OPEN) return
        // Se relee: pudo registrarse mientras se validaba el token
        const idActual = asesorDeSocket.get(ws)
        let a = idActual ? asesores.get(idActual) : undefined
        if (a && a.userId !== u.userId) throw new ErrorPuente('42501', 'Esta conexión ya pertenece a otro asesor.')
        if (a) {
          a.jwt = msg.jwtAsesor // token renovado: no se pierde la llamada en curso
          for (const l of llamadas.values()) {
            if (l.estado.asesorPreasignadoSocketId === a.socketId) l.estado.jwtAsesorPreasignado = a.jwt
          }
        } else {
          a = {
            socketId: randomUUID(), ws, userId: u.userId, jwt: msg.jwtAsesor,
            email: u.email || 'Asesor', rol: u.rol, callId: null, porCerrar: null,
          }
          asesores.set(a.socketId, a)
          asesorDeSocket.set(ws, a.socketId)
        }
        enviar(ws, {
          tipo: 'advisor:registered',
          email: a.email,
          rol: a.rol,
          enCola: [...llamadas.values()].filter((l) => l.pop && !l.asesorSocketId).length,
        })
        atenderCola()
        return
      }
      case 'advisor:offline':
        await desconectarAsesor(ws)
        return
      case 'advisor:answer':
        if (!asesor) throw new ErrorPuente('NO_ADVISOR', 'Conéctate primero como asesor.')
        await contestar(asesor, msg.callId)
        return
      case 'advisor:reject': {
        const l = llamadas.get(msg.callId)
        if (!asesor || !l || l.timbraEn !== asesor.socketId) return
        l.rechazadaPor.add(asesor.userId)
        dejarDeTimbrar(l)
        timbrar(l)
        atenderCola()
        return
      }
      case 'advisor:hangup': {
        if (!asesor) return
        const l = llamadas.get(msg.callId)
        if (l && l.asesorSocketId === asesor.socketId) await finalizar(msg.callId, 'asesor_colgo', true)
        else if (!l && asesor.callId === msg.callId) await terminarCaptura(asesor)
        return
      }
      case 'chat:send':
      case 'webrtc:signal': {
        const l = llamadas.get(msg.callId)
        const deCliente = l?.clienteWs === ws
        const deAsesor = Boolean(l && asesor && l.asesorSocketId === asesor.socketId)
        if (!l?.asesorSocketId || (!deCliente && !deAsesor)) return
        const destino = deCliente ? asesores.get(l.asesorSocketId)?.ws : l.clienteWs
        const desde = deCliente ? ('cliente' as const) : ('asesor' as const)
        if (msg.tipo === 'chat:send') {
          const texto = String(msg.texto).trim().slice(0, 500)
          if (texto) enviar(destino, { tipo: 'chat:message', callId: msg.callId, desde, texto })
        } else {
          enviar(destino, { tipo: 'webrtc:signal', callId: msg.callId, desde, signal: msg.signal })
        }
        return
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.on('error', () => {})
    ws.on('message', (raw) => {
      let msg: MensajeWsCliente
      try {
        msg = JSON.parse(raw.toString()) as MensajeWsCliente
        if (!msg || typeof msg.tipo !== 'string') throw new Error('sin tipo')
      } catch {
        enviar(ws, { tipo: 'error', code: 'BAD_JSON', message: 'Mensaje inválido' })
        return
      }
      atender(ws, msg).catch((e) => reportar(ws, e))
    })
    ws.on('close', () => {
      const callId = llamadaDeCliente.get(ws)
      if (callId) void finalizar(callId, 'conexion_perdida')
      void desconectarAsesor(ws)
    })
  })

  return { server, wss }
}
