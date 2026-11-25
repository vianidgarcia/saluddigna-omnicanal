/* Acceso por rol simulado. Credenciales de demostración: no hay autenticación real. */

/** Solo el personal inicia sesión; el paciente usa el portal sin cuenta. */
export type Rol = 'asesor' | 'admin'
export type Sesion = { rol: Rol; correo: string; nombre: string; inicio: string
  /** Modo api: rol de la base (asesor, recepcion, supervisor, admin) y clínica asignada a la cuenta */
  rolBase?: string; clinicaId?: string | null; clinicaNombre?: string | null }
export const ROL_BASE: Record<string, string> = { asesor: 'Asesor', recepcion: 'Recepción', supervisor: 'Supervisión', admin: 'Administrador' }
export const rolVisible = (s: Sesion) => (s.rolBase && ROL_BASE[s.rolBase]) || ROL[s.rol]

/** Cuentas del personal en modo api (docs/GUIA_APP_PWA.md). La contraseña NUNCA va en el código. */
export const CUENTAS_API: { correo: string; rolBase: string; rol: Rol; descripcion: string }[] = [
  { correo: 'asesor@demo.mx', rolBase: 'asesor', rol: 'asesor', descripcion: 'Call center: llamadas y atención por teléfono.' },
  { correo: 'recepcion@demo.mx', rolBase: 'recepcion', rol: 'asesor', descripcion: 'Clínica Puebla: llegadas de hoy, caja y mostrador.' },
  { correo: 'clinica@demo.mx', rolBase: 'supervisor', rol: 'admin', descripcion: 'Clínica Puebla: bandeja, búsqueda y métricas.' },
  { correo: 'admin@demo.mx', rolBase: 'admin', rol: 'admin', descripcion: 'Supervisión, call center y recepción de todas las clínicas.' },
]

export const SESION_KEY = 'sd_sesion'
/** copia por pestaña: permite tener Paciente y Asesor abiertos a la vez en dos pestañas */
const SESION_TAB_KEY = 'sd_sesion_pestana'

export const ROL: Record<Rol, string> = { asesor: 'Asesor', admin: 'Administrador' }

export const CREDENCIALES: { rol: Rol; correo: string; clave: string; nombre: string; descripcion: string }[] = [
  { rol: 'asesor', correo: 'asesor@demo.mx', clave: 'demo123', nombre: 'Asesor Call Center', descripcion: 'Atención al paciente: ficha, línea de tiempo y acciones.' },
  { rol: 'admin', correo: 'admin@demo.mx', clave: 'demo123', nombre: 'Administración', descripcion: 'Lo mismo que el asesor, más el control de la demo.' },
]

const parse = (raw: string | null): Sesion | null => {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Sesion
    return s && (s.rol === 'asesor' || s.rol === 'admin') ? s : null
  } catch {
    return null
  }
}

/** Marca de pestaña que se usa SIN sesión (portal del paciente): al recargarla no hereda la sesión del personal
    abierta en otra pestaña. Una pestaña nueva, sin marca, sí hereda la última sesión guardada. */
const SIN_SESION = 'ninguna'

export function loadSesion(): Sesion | null {
  try {
    const pestana = window.sessionStorage.getItem(SESION_TAB_KEY)
    if (pestana === SIN_SESION) return null
    const s = parse(pestana) ?? parse(window.localStorage.getItem(SESION_KEY))
    if (!s) window.sessionStorage.setItem(SESION_TAB_KEY, SIN_SESION)
    return s
  } catch {
    return null
  }
}

export function saveSesion(s: Sesion | null) {
  try {
    if (s) {
      const raw = JSON.stringify(s)
      window.localStorage.setItem(SESION_KEY, raw)
      window.sessionStorage.setItem(SESION_TAB_KEY, raw)
    } else {
      window.localStorage.removeItem(SESION_KEY)
      window.sessionStorage.setItem(SESION_TAB_KEY, SIN_SESION)
    }
  } catch {
    /* sin almacenamiento: la sesión vive solo en memoria */
  }
}

/** Valida contra las credenciales de demostración. Devuelve la sesión o un mensaje de error. */
export function entrar(rol: Rol, correo: string, clave: string): Sesion | string {
  const c = CREDENCIALES.find((x) => x.correo === correo.trim().toLowerCase())
  if (!c || c.clave !== clave) return 'Correo o contraseña incorrectos. Usa las credenciales de demostración de abajo.'
  if (c.rol !== rol) return `Ese correo es de ${ROL[c.rol]}. Cambia el rol o usa otra cuenta.`
  return { rol, correo: c.correo, nombre: c.nombre, inicio: new Date().toISOString() }
}
