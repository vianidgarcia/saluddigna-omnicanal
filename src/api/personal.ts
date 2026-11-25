/* El lado del PERSONAL: asesor, supervisión y administración contra el orquestador.
 *
 * Usa un cliente aparte del de la paciente (clientePersonal), con su propio almacén de sesión, para
 * que en el mismo navegador se puedan tener abiertos el portal y la vista del asesor, como ya pasa
 * con las credenciales simuladas.
 *
 * Roles: la base tiene cuatro (asesor, supervisor, admin, recepcion) y el portal dos.
 * `rolBase` y `clinicaId` van en la sesión: la vista del personal muestra a cada cuenta solo lo suyo.
 */
import {
  agendaClinica, bandejaAtencion, buscarPacientes, cerrarInteraccion, cerrarSesion,
  iniciarContacto, iniciarSesionPersonal, journeyPaciente, obtenerContexto, registrarLlegada, retomarTramite,
  validarOtp, verificarIdentidad, verificarIdentificacion, metricas, suscribirJourneyGlobal, tramitesEnCurso,
  type Bandeja, type CategoriaBandeja, type Clinica, type Contexto, type EventoEnVivo, type Horario, type Journey,
  type Metricas, type PacienteEncontrado, type TipoDocumento, type TramiteEnCurso,
} from './api'
import { directorioCompleto } from './catalogo'
import { enviarCodigo } from './codigo'
import { cancelarCita, cobrarEnCaja, marcarAtendida, rangoHorarios, reprogramarCita, type Cita } from './citas'
import { clientePersonal, esApi } from './cliente'
import type { Rol } from '../state/sesion'

/** Rol de la base → rol del portal. null si el usuario no es personal. */
export function aRolPortal(rolBase: string | null): Rol | null {
  switch (rolBase) {
    case 'asesor': return 'asesor'
    case 'recepcion': return 'asesor'
    case 'supervisor': return 'admin'
    case 'admin': return 'admin'
    default: return null
  }
}

function exigir() {
  const c = clientePersonal()
  if (!c) throw new Error('El portal está en modo local: la vista del personal usa las credenciales de demostración.')
  return c
}

/** Entra con las credenciales REALES de core.staff. Devuelve el rol del portal y el rol de la base. */
export async function entrarPersonal(correo: string, clave: string): Promise<{ rol: Rol; rolBase: string; clinicaId: string | null; clinicaNombre: string | null }> {
  const c = exigir()
  const { rol: rolBase, clinica_id } = await iniciarSesionPersonal(c, correo, clave)
  const rol = aRolPortal(rolBase)
  if (!rol) {
    await cerrarSesion(c)
    throw new Error('Esa cuenta no tiene un rol de personal en el sistema. Pide que te den de alta en core.staff.')
  }
  // la clínica viene asignada a la cuenta: aquí solo se busca su nombre para el encabezado
  const clinicaNombre = clinica_id ? (await clinicas().catch(() => [])).find((x) => x.id === clinica_id)?.nombre ?? null : null
  return { rol, rolBase: rolBase ?? '', clinicaId: clinica_id, clinicaNombre }
}

export async function salirPersonal(): Promise<void> {
  const c = clientePersonal()
  if (c) await cerrarSesion(c)
}

/* ------------------------------------------------------------- supervisión ---- */

/** Conteos de la bandeja (atorados, pago por vencer, en atención, seguridad, llegadas de hoy). */
export const conteosBandeja = () => bandejaAtencion(exigir(), {})

export const categoriaBandeja = (categoria: CategoriaBandeja, limite = 20): Promise<Bandeja> =>
  bandejaAtencion(exigir(), { categoria, limite })

/** Por celular, folio (SD-4K7Q) o nombre; mínimo 3 caracteres. */
export const buscar = (texto: string): Promise<PacienteEncontrado[]> => buscarPacientes(exigir(), texto)

/** Todo lo que ha hecho el paciente en todos los canales: trámites, interacciones y eventos. */
export const journey = (pacienteId: string): Promise<Journey> => journeyPaciente(exigir(), pacienteId)

export const enCurso = (limite = 20): Promise<TramiteEnCurso[]> => tramitesEnCurso(exigir(), { limite })

export const panelMetricas = (desde: string, hasta: string, clinica?: string): Promise<Metricas> => metricas(exigir(), desde, hasta, clinica)

/**
 * Abre la atención de un paciente por teléfono (10 dígitos del portal).
 * Esto es lo que toma el trámite para el asesor: la base lo bloquea 10 minutos para que dos
 * canales no lo cambien a la vez.
 */
export async function atender(telefono10: string, canal: 'call_center' | 'clinica' = 'call_center'): Promise<Contexto> {
  const c = exigir()
  await clinicas().catch(() => []) // zonas horarias para mostrar las citas
  return iniciarContacto(c, canal, '52' + telefono10.replace(/\D/g, '').slice(-10))
}

export const refrescar = (i: string) => obtenerContexto(exigir(), i)
export const terminar = (i: string) => cerrarInteraccion(exigir(), i)
export const tomar = (i: string, tramite: string) => retomarTramite(exigir(), i, tramite)
export const verificarDocumento = (i: string, tipo: TipoDocumento) => verificarIdentificacion(exigir(), i, tipo)
export const verificarNacimiento = (i: string, fecha: string) => verificarIdentidad(exigir(), i, fecha)
export const mandarOtp = (i: string) => enviarCodigo(exigir(), i)
export const comprobarOtp = (i: string, codigo: string) => validarOtp(exigir(), i, codigo)
export const cancelar = (i: string, cita: string, motivo: string) => cancelarCita(exigir(), i, cita, motivo)
export const reprogramar = (i: string, cita: string, fechaHora: string) => reprogramarCita(exigir(), i, cita, fechaHora)
export const cobrar = (cita: string, metodo: 'efectivo' | 'tarjeta') => cobrarEnCaja(exigir(), cita, metodo)
export async function horariosDeCita(cita: Cita, desde: string, hasta: string): Promise<Horario[] | null> {
  if (!cita.clinica_id || !cita.estudio_id) return null
  return rangoHorarios(exigir(), cita.clinica_id, cita.estudio_id, desde, hasta)
}

/* --------------------------------------------------------------- recepción ---- */

export const clinicas = (): Promise<Clinica[]> => directorioCompleto(exigir())
export const agenda = (clinica: string, fecha: string) => agendaClinica(exigir(), clinica, fecha)
export const llegada = (cita: string, tipo: TipoDocumento, cumplio: boolean) => registrarLlegada(exigir(), cita, tipo, cumplio)
export const atendida = (cita: string) => marcarAtendida(exigir(), cita)

/* Supabase reutiliza el canal si ya existe y no deja agregarle oyentes: las altas y bajas van en fila,
   para que la anterior termine de cerrarse antes de abrir otra (StrictMode monta dos veces). */
let filaGlobal: Promise<unknown> = Promise.resolve()

/** Tiempo real del panel: cada evento de CUALQUIER paciente (solo supervisor y admin, por RLS). Devuelve cómo dejarlo. */
export function escucharTodo(alEvento: (e: EventoEnVivo) => void, alEstado: (conectado: boolean) => void): () => void {
  if (!esApi) return () => {}
  let vivo = true
  const alta = filaGlobal.then(async () => {
    if (!vivo) return null
    return suscribirJourneyGlobal(exigir(), (e) => { if (vivo) alEvento(e) }, (s) => { if (vivo) alEstado(s === 'SUBSCRIBED') })
  }).catch((e: unknown) => { console.warn('[bandeja] tiempo real', e); if (vivo) alEstado(false); return null })
  filaGlobal = alta
  return () => {
    vivo = false
    filaGlobal = filaGlobal.then(() => alta).then(async (dejar) => { dejar?.(); await new Promise((r) => setTimeout(r, 300)) }).catch(() => {})
  }
}
