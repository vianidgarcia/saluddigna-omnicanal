/* Funciones de la API que describe docs/GUIA_APP_PWA.md y que todavía no están en la copia `api.ts` (que no se
   edita aquí). Cuando el backend actualice su api.ts, se borra este archivo y se importan de ahí.
   Sirven con cualquiera de los dos clientes (paciente o personal): la base decide los permisos. */
import { aErrorApi, horariosDisponibles, type CitaProxima, type Cliente, type Horario } from './api'

/** Cita del contexto. Con nivel 'declarada' solo trae id, folio, fecha y estado. */
export type Cita = Partial<CitaProxima> & Pick<CitaProxima, 'id' | 'fecha_hora' | 'estado'> & {
  folio?: string
  /** Solo con sesión verificada */
  clinica_id?: string; estudio_id?: string; pagada?: boolean
}
export type PagoPorPagar = {
  referencia: string; monto: number; moneda?: string; estudio?: string; etiqueta?: string; folio?: string
  fecha_hora?: string; expira_en?: string; link_pago?: string | null; tramite_id?: string
}

async function rpc<T>(c: Cliente, funcion: string, args: object): Promise<T> {
  // los tipos generados (database.types.ts) aún no conocen estas funciones
  const { data, error } = await (c as unknown as { rpc: (f: string, a: object) => Promise<{ data: unknown; error: unknown }> }).rpc(funcion, args)
  if (error) {
    const e = await aErrorApi(error)
    if (e.code === 'sesion_inexistente') await c.auth.signOut({ scope: 'local' })
    throw e
  }
  return data as T
}

export const cancelarCita = (c: Cliente, interaccion: string, cita: string, motivo: string) =>
  rpc<{ cita_id: string; estado: string; reembolso: boolean; folio: string }>(c, 'cancelar_cita', { p_interaccion_id: interaccion, p_cita_id: cita, p_motivo: motivo })

/** Misma clínica y estudio; conserva estado y pago. */
export const reprogramarCita = (c: Cliente, interaccion: string, cita: string, fechaHora: string) =>
  rpc<{ cita_id: string; fecha_hora: string; folio: string }>(c, 'reprogramar_cita', { p_interaccion_id: interaccion, p_cita_id: cita, p_fecha_hora: fechaHora })

export const pagosPendientes = (c: Cliente, interaccion: string) =>
  rpc<PagoPorPagar[]>(c, 'pagos_pendientes', { p_interaccion_id: interaccion })

/** Pago de prueba (sin cargo). Pagar dos veces responde igual, con repetido: true. */
export async function pagarDemo(c: Cliente, interaccion: string, referencia: string): Promise<void> {
  const { error } = await c.functions.invoke('pago-demo', { body: { interaccion_id: interaccion, referencia } })
  if (error) throw await aErrorApi(error)
}

export const cobrarEnCaja = (c: Cliente, cita: string, metodo: 'efectivo' | 'tarjeta') =>
  rpc<unknown>(c, 'cobrar_en_caja', { p_cita_id: cita, p_metodo: metodo })

const masDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Horarios libres entre dos fechas. La base entrega máximo 14 días y 100 horarios por consulta: se pide por tramos. */
export async function rangoHorarios(c: Cliente, clinica: string, estudio: string, desde: string, hasta: string): Promise<Horario[]> {
  const todos = new Map<string, Horario>()
  let cursor = desde
  while (cursor <= hasta) {
    const tope = masDias(cursor, 13)
    const fin = tope < hasta ? tope : hasta
    const dias = Math.round((Date.parse(fin) - Date.parse(cursor)) / 86_400_000) + 1
    const lote = await horariosDisponibles(c, clinica, estudio, cursor, dias)
    for (const h of lote) todos.set(h.fecha_hora, h)
    const ultimo = lote.at(-1)?.fecha
    cursor = lote.length >= 100 && ultimo && ultimo > cursor ? ultimo : masDias(fin, 1)
  }
  return [...todos.values()].sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))
}

export const marcarAtendida = (c: Cliente, cita: string) => rpc<unknown>(c, 'marcar_atendida', { p_cita_id: cita })
