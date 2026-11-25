import { esApi } from '../api/modo'
import type { MensajeCliente, MensajeServidor } from './tipos'
import { transporteLocal } from './transporteLocal'

export type Rol = 'cliente' | 'asesor'
export interface Transporte { enviar(m: MensajeCliente): void; cerrar(): void }
export interface Oyente { mensaje(m: MensajeServidor): void; abierto(): void; caido(): void }

const URL_CC = (import.meta.env.VITE_CALL_CENTER_URL ?? '') as string

/** En modo api sin servidor configurado no hay llamadas (no se simulan contra datos reales). */
export const hayCallCenter = !esApi || !!URL_CC

/** Cada transporte sirve una vez: si se cae, quien lo usa decide si abre otro. */
export function abrirTransporte(rol: Rol, o: Oyente): Transporte {
  return esApi ? transporteWs(o) : transporteLocal(rol, o)
}

function transporteWs(o: Oyente): Transporte {
  let ws: WebSocket
  let cerrado = false
  try {
    ws = new WebSocket(URL_CC)
  } catch {
    window.setTimeout(() => { if (!cerrado) o.caido() })
    return { enviar() {}, cerrar() { cerrado = true } }
  }
  ws.onopen = () => { if (!cerrado) o.abierto() }
  ws.onmessage = (e) => {
    if (cerrado) return
    let m: MensajeServidor
    try { m = JSON.parse(String(e.data)) as MensajeServidor } catch { return }
    o.mensaje(m)
  }
  ws.onclose = () => { if (!cerrado) { cerrado = true; o.caido() } }
  return {
    enviar: (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)) },
    cerrar: () => { cerrado = true; ws.close() },
  }
}
