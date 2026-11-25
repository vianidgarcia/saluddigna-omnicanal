/* El lado del PERSONAL: asesor, supervisión y administración contra el orquestador.
 *
 * Usa un cliente aparte del de la paciente (clientePersonal), con su propio almacén de sesión, para
 * que en el mismo navegador se puedan tener abiertos el portal y la vista del asesor, como ya pasa
 * con las credenciales simuladas.
 *
 * Roles: la base tiene cuatro (asesor, supervisor, admin, recepcion) y el portal dos.
 * supervisor y admin comparten la vista de administración; recepcion se trata como asesor
 * (su pantalla de mostrador todavía no existe en este portal).
 */
import {
  bandejaAtencion, buscarPacientes, cerrarSesion, iniciarContacto, iniciarSesionPersonal,
  journeyPaciente, metricas, suscribirJourneyGlobal, tramitesEnCurso,
  type Bandeja, type CategoriaBandeja, type Contexto, type EventoEnVivo, type Journey,
  type Metricas, type PacienteEncontrado, type TramiteEnCurso,
} from './api'
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
export async function entrarPersonal(correo: string, clave: string): Promise<{ rol: Rol; rolBase: string; clinicaId: string | null }> {
  const c = exigir()
  const { rol: rolBase, clinica_id } = await iniciarSesionPersonal(c, correo, clave)
  const rol = aRolPortal(rolBase)
  if (!rol) {
    await cerrarSesion(c)
    throw new Error('Esa cuenta no tiene un rol de personal en el sistema. Pide que te den de alta en core.staff.')
  }
  return { rol, rolBase: rolBase ?? '', clinicaId: clinica_id }
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

export const panelMetricas = (desde: string, hasta: string): Promise<Metricas> => metricas(exigir(), desde, hasta)

/**
 * Abre la atención de un paciente por teléfono (10 dígitos del portal).
 * Esto es lo que toma el trámite para el asesor: la base lo bloquea 10 minutos para que dos
 * canales no lo cambien a la vez.
 */
export async function atender(telefono10: string): Promise<Contexto> {
  const c = exigir()
  return iniciarContacto(c, 'call_center', '52' + telefono10.replace(/\D/g, '').slice(-10))
}

/** Tiempo real del panel: cada evento de CUALQUIER paciente (solo supervisor y admin, por RLS). */
export async function escucharTodo(alEvento: (e: EventoEnVivo) => void): Promise<() => void> {
  if (!esApi) return () => {}
  return suscribirJourneyGlobal(exigir(), alEvento)
}
