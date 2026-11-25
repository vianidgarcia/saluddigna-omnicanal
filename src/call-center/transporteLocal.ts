/* Modo local: la llamada vive en la pestaña del paciente y llega a las pestañas del personal de este
   mismo navegador por BroadcastChannel. Se anuncia cada 2 s: si el asesor abre después, también la ve. */
import { loadTramite } from '../state/tramite'
import { crearContestadora } from './contestadoraLocal'
import type { Oyente, Rol, Transporte } from './transporte'
import type { Entrante, MensajeServidor } from './tipos'

type DelAsesor =
  | { tipo: 'answer' | 'hangup' | 'adios' | 'latido'; callId: string }
  | { tipo: 'chat' | 'signal'; callId: string; dato: unknown }
type Sobre =
  | { a: 'asesor'; para?: string; menos?: string; m: MensajeServidor }
  | { a: 'cliente'; de: string; m: DelAsesor }

const id = () => Math.random().toString(36).slice(2)
/** Chrome frena los temporizadores de pestañas ocultas (hasta 1 por minuto): el margen lo tolera. */
const SIN_LATIDO_MS = 75_000

export function transporteLocal(rol: Rol, o: Oyente): Transporte {
  if (typeof BroadcastChannel === 'undefined') {
    const x = window.setTimeout(() => o.caido())
    return { enviar() {}, cerrar() { window.clearTimeout(x) } }
  }
  const canal = new BroadcastChannel('sd_call_center')
  const x = window.setTimeout(() => o.abierto())
  const t = rol === 'cliente' ? ladoCliente(canal, o) : ladoAsesor(canal, o)
  return { enviar: t.enviar, cerrar: () => { window.clearTimeout(x); t.cerrar() } }
}

function ladoCliente(canal: BroadcastChannel, o: Oyente): Transporte {
  let callId = ''
  let pop: Entrante | null = null
  let asesor: string | null = null
  let anuncio: number | undefined
  let latido = 0
  let cont = crearContestadora(() => null)
  const alAsesor = (m: MensajeServidor, destino: { para?: string; menos?: string } = {}) =>
    canal.postMessage({ a: 'asesor', ...destino, m } satisfies Sobre)

  const terminar = (motivo: string) => {
    if (!callId) return
    const c = callId
    window.clearInterval(anuncio)
    if (pop) alAsesor({ tipo: 'advisor:call_ended', callId: c, motivo })
    callId = ''
    pop = null
    asesor = null
    o.mensaje({ tipo: 'call:ended', callId: c, motivo })
  }
  const anunciar = () => {
    if (!pop) return
    if (asesor) {
      if (Date.now() - latido > SIN_LATIDO_MS) terminar('asesor_desconectado')
      return
    }
    alAsesor({ tipo: 'advisor:ringing', pop })
  }
  canal.onmessage = (e: MessageEvent<Sobre>) => {
    const s = e.data
    if (s.a !== 'cliente' || !pop || s.m.callId !== callId) return
    if (s.m.tipo === 'answer') {
      if (asesor) {
        alAsesor({ tipo: 'advisor:call_taken', callId, porOtro: true }, { para: s.de })
        return
      }
      asesor = s.de
      latido = Date.now()
      alAsesor({ tipo: 'advisor:answered', pop }, { para: s.de })
      alAsesor({ tipo: 'advisor:call_taken', callId, porOtro: true }, { menos: s.de })
      o.mensaje({ tipo: 'call:connected', callId, asesorNombre: 'Asesor (demo)' })
      return
    }
    if (s.de !== asesor) return
    switch (s.m.tipo) {
      case 'latido': latido = Date.now(); return
      case 'hangup': terminar('asesor_colgo'); return
      case 'adios': terminar('asesor_desconectado'); return
      case 'chat': o.mensaje({ tipo: 'chat:message', callId, desde: 'asesor', texto: String(s.m.dato) }); return
      case 'signal': o.mensaje({ tipo: 'webrtc:signal', callId, desde: 'asesor', signal: s.m.dato }); return
    }
  }
  const alCerrarPagina = () => terminar('conexion_perdida')
  window.addEventListener('pagehide', alCerrarPagina)

  return {
    enviar(m) {
      if (m.tipo === 'call:start') {
        terminar('reemplazada')
        callId = id()
        cont = crearContestadora(() => {
          const t = loadTramite()
          return t && { folio: t.id, nombre: t.paciente.nombre, telefono: t.paciente.telefono, estudio: t.estudio?.nombre ?? null }
        })
        if (m.directo) {
          const t = loadTramite()
          const tel = (m.telefonoSugerido ?? '').replace(/\D/g, '').slice(-10)
          const folio = t && t.paciente.telefono === tel ? t.id : null
          pop = {
            callId, creadaEn: new Date().toISOString(), interaccionAsesorId: null, interaccionIaId: null, contexto: null, borrador: m.borrador,
            brief: {
              motivo: folio ? 'continuar_tramite' : 'otro', resumenIa: 'Llamó directo al asesor, sin pasar por la contestadora.',
              tramiteFolioSugerido: folio, tramiteIdSugerido: folio, verificadoPor: 'sin_verificar',
              telefonoNormalizado: `52${tel}`, telefonoEnmascarado: `+52 ****** ${tel.slice(-4)}`,
            },
            transcripcionIa: [], requiereRevalidarEnAsesor: true,
          }
          o.mensaje({ tipo: 'call:started', callId, etapa: 'transfiriendo_asesor', asesoresEnLinea: 0 })
          o.mensaje({ tipo: 'call:transferring', callId, resumenIa: pop.brief.resumenIa, asesoresEnLinea: 0 })
          anunciar()
          anuncio = window.setInterval(anunciar, 2000)
          return
        }
        const r = cont.saludo()
        o.mensaje({ tipo: 'call:started', callId, etapa: r.etapa, asesoresEnLinea: 0 })
        o.mensaje({ tipo: 'ia:utterance', callId, texto: r.texto, esperaRespuesta: r.espera })
        return
      }
      if (!callId || !('callId' in m) || m.callId !== callId) return
      if (m.tipo === 'call:hangup') terminar('cliente_colgo')
      else if (m.tipo === 'call:speech' && !pop) {
        const r = cont.responder(m.texto)
        o.mensaje({ tipo: 'call:state', callId, etapa: r.etapa })
        o.mensaje({ tipo: 'ia:utterance', callId, texto: r.texto, esperaRespuesta: r.espera })
        if (!r.transferir) return
        pop = {
          callId, creadaEn: new Date().toISOString(), interaccionAsesorId: null, interaccionIaId: null, contexto: null,
          brief: r.transferir, transcripcionIa: [...cont.turnos], requiereRevalidarEnAsesor: !cont.verificado,
        }
        o.mensaje({ tipo: 'call:transferring', callId, resumenIa: r.transferir.resumenIa, asesoresEnLinea: 0 })
        anunciar()
        anuncio = window.setInterval(anunciar, 2000)
      } else if (m.tipo === 'chat:send' && asesor) {
        alAsesor({ tipo: 'chat:message', callId, desde: 'cliente', texto: m.texto }, { para: asesor })
      } else if (m.tipo === 'webrtc:signal' && asesor) {
        alAsesor({ tipo: 'webrtc:signal', callId, desde: 'cliente', signal: m.signal }, { para: asesor })
      }
    },
    cerrar() {
      terminar('cliente_colgo')
      window.removeEventListener('pagehide', alCerrarPagina)
      canal.close()
    },
  }
}

function ladoAsesor(canal: BroadcastChannel, o: Oyente): Transporte {
  const yo = id()
  let enLinea = false
  let timbra = ''
  let visto = 0
  let atiende = ''
  const rechazadas = new Map<string, number>()
  const alCliente = (m: DelAsesor) => canal.postMessage({ a: 'cliente', de: yo, m } satisfies Sobre)

  canal.onmessage = (e: MessageEvent<Sobre>) => {
    const s = e.data
    if (s.a !== 'asesor' || !enLinea || (s.para && s.para !== yo) || s.menos === yo) return
    const m = s.m
    switch (m.tipo) {
      case 'advisor:ringing': {
        const c = m.pop.callId
        if (atiende || (timbra && timbra !== c)) return
        // Rechazada: se vuelve a ofrecer a los 20 s, para que la llamada no se pierda
        if (Date.now() - (rechazadas.get(c) ?? 0) < 20_000) return
        visto = Date.now()
        if (timbra === c) return
        timbra = c
        break
      }
      case 'advisor:answered':
        atiende = m.pop.callId
        timbra = ''
        break
      case 'advisor:call_taken':
        if (timbra !== m.callId) return
        timbra = ''
        break
      case 'advisor:call_ended':
        if (m.callId !== timbra && m.callId !== atiende) return
        timbra = ''
        break
      case 'chat:message':
      case 'webrtc:signal':
        if (m.callId !== atiende) return
        break
      default:
        return
    }
    o.mensaje(m)
  }
  const tic = window.setInterval(() => {
    if (atiende) alCliente({ tipo: 'latido', callId: atiende })
    if (timbra && Date.now() - visto > SIN_LATIDO_MS) {
      const c = timbra
      timbra = ''
      o.mensaje({ tipo: 'advisor:call_ended', callId: c, motivo: 'conexion_perdida' })
    }
  }, 2000)
  const adios = () => { if (atiende) alCliente({ tipo: 'adios', callId: atiende }) }
  window.addEventListener('pagehide', adios)

  return {
    enviar(m) {
      switch (m.tipo) {
        case 'advisor:online':
          enLinea = true
          o.mensaje({ tipo: 'advisor:registered', email: 'demo', rol: 'asesor', enCola: 0 })
          return
        case 'advisor:answer': alCliente({ tipo: 'answer', callId: m.callId }); return
        case 'advisor:reject': rechazadas.set(m.callId, Date.now()); timbra = ''; return
        case 'advisor:hangup': alCliente({ tipo: 'hangup', callId: m.callId }); atiende = ''; return
        case 'chat:send': alCliente({ tipo: 'chat', callId: m.callId, dato: m.texto }); return
        case 'webrtc:signal': alCliente({ tipo: 'signal', callId: m.callId, dato: m.signal }); return
      }
    },
    cerrar() {
      adios()
      window.clearInterval(tic)
      window.removeEventListener('pagehide', adios)
      canal.close()
    },
  }
}
