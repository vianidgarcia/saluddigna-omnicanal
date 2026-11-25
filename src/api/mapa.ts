/* Equivalencias entre el modelo del PORTAL (src/state/tramite.ts) y el del ORQUESTADOR
 * (esquema api del repo hackathon-puebla). Los dos nacieron por separado y no coinciden:
 *
 *   portal                        orquestador
 *   ─────────────────────────     ───────────────────────────────
 *   paso: 1 | 2 | 3 | 4           paso_actual: 'seleccion_estudio' | … | 'confirmada'
 *   canal: … | 'pasarela'         canal: 'web' | 'app' | 'whatsapp' | 'call_center' | 'clinica'
 *   estudio: { nombre, … }        estudio_id (uuid) + estudio: { id, nombre, preparacion }
 *   clinica: nombre               clinica_id (uuid)
 *   fecha 'AAAA-MM-DD' + hora     fecha_hora (timestamptz)
 *   id: 'SD-…' creado aquí        folio ('SD-4K7Q') creado por la base
 *
 * Todo lo de este archivo son funciones PURAS: no llaman a la red, así que se pueden probar sin
 * base de datos (node --test src/api/mapa.test.ts).
 */
import type { Canal as CanalApi, Paso as PasoApi, Tramite as TramiteApi, Horario } from './api'
import type { Canal, Estado, Paso, Tramite } from '../state/tramite'

/* ---------------------------------------------------------------- pasos ---- */

/** El paso del portal (1-4) que corresponde a cada paso del orquestador. */
export const PASO_DESDE_API: Record<PasoApi, Paso> = {
  seleccion_estudio: 1,
  seleccion_clinica: 2,
  seleccion_horario: 3,
  pago: 4,
  confirmada: 4,
}

/** El paso del orquestador que corresponde a cada paso del portal. */
export const PASO_HACIA_API: Record<Paso, PasoApi> = {
  1: 'seleccion_estudio',
  2: 'seleccion_clinica',
  3: 'seleccion_horario',
  4: 'pago',
}

/* --------------------------------------------------------------- canales ---- */

/** 'pasarela' no existe en el orquestador: ahí el pago entra por su propio webhook, no por un canal. */
export const CANAL_HACIA_API: Record<Canal, CanalApi> = {
  web: 'web',
  whatsapp: 'whatsapp',
  call_center: 'call_center',
  clinica: 'clinica',
  pasarela: 'web',
}

/** 'app' (la app móvil del orquestador) se muestra como web: el portal no distingue las dos. */
export const CANAL_DESDE_API: Record<CanalApi, Canal> = {
  web: 'web',
  app: 'web',
  whatsapp: 'whatsapp',
  call_center: 'call_center',
  clinica: 'clinica',
}

export const canalDesdeApi = (c: string | undefined | null): Canal =>
  CANAL_DESDE_API[(c ?? 'web') as CanalApi] ?? 'web'

/* --------------------------------------------------------------- estados ---- */

/** El estado del portal a partir del trámite del orquestador. */
export function estadoDesdeApi(t: TramiteApi): Estado {
  if (t.paso_actual === 'confirmada' || t.estado === 'confirmada' || t.estado === 'completado') return 'confirmada'
  if (t.paso_actual === 'pago' && t.contexto?.pago_id) return 'pago_pendiente'
  return 'en_curso'
}

/* ----------------------------------------------------------- fecha y hora ---- */

/** 'AAAA-MM-DDTHH:MM…' → ['AAAA-MM-DD', 'HH:MM'] sin crear un Date (no corre la zona horaria). */
export function partirFechaHora(iso: string): [string, string] {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (m) return [m[1], m[2]]
  // Con desplazamiento raro o solo fecha: se usa la hora local del navegador como último recurso.
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ['', '']
  const p = (n: number) => String(n).padStart(2, '0')
  return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getHours())}:${p(d.getMinutes())}`]
}

/**
 * Empareja el nombre de un estudio del portal con uno de la base.
 * Exacto (sin acentos ni mayúsculas) o, si uno contiene al otro, se toma como el mismo
 * ("Mastografía bilateral" ~ "Mastografía"). Un combo con "+" solo empareja si es idéntico:
 * "Mastografía + ultrasonido mamario" NO es "Mastografía" y reservaría el estudio equivocado.
 */
export function emparejarEstudio<T extends { nombre: string }>(lista: T[], nombre: string): T | undefined {
  const n = normalizar(nombre)
  const exacto = lista.find((e) => normalizar(e.nombre) === n)
  if (exacto || n.includes('+')) return exacto
  return lista.find((e) => { const b = normalizar(e.nombre); return !b.includes('+') && (b.includes(n) || n.includes(b)) })
}

/** Clave con la que el portal identifica un horario ("2026-11-27 13:30"). */
export const claveHorario = (fecha: string, hora: string) => `${fecha} ${hora}`

/**
 * El `fecha_hora` exacto que hay que mandar a reservar_cita.
 * NO se arma con aritmética de fechas: se toma el que devolvió horarios_disponibles, porque solo
 * la base conoce la zona horaria de la clínica (core.clinicas.zona_horaria).
 */
export function fechaHoraDeHorarios(horarios: Horario[], fecha: string, hora: string): string | null {
  const h = horarios.find((x) => x.fecha === fecha && x.hora.slice(0, 5) === hora.slice(0, 5))
  return h?.fecha_hora ?? null
}

/* ------------------------------------------------------- trámite completo ---- */

/**
 * ¿El trámite de la base es el mismo que el del portal? Es el mismo si ya comparten folio o si piden
 * el mismo estudio (p. ej. se empezó por WhatsApp y se sigue en la web). Si no, es OTRO trámite:
 * fundirlo pisaría el estudio, la clínica y la fecha de lo que el paciente está armando ahora.
 */
export function esMismoTramite(local: Tramite, remoto: TramiteApi): boolean {
  if (local.id === remoto.folio) return true
  const a = local.estudio?.nombre
  const b = remoto.estudio?.nombre
  return !!a && !!b && normalizar(a) === normalizar(b)
}

/**
 * Trae al portal lo que cambió en el orquestador, CONSERVANDO lo que solo existe aquí
 * (línea de tiempo local, método de pago, datos del formulario). Así un cambio hecho por
 * WhatsApp o por el asesor se ve en el portal sin perder el avance local.
 */
export function fusionarDesdeApi(local: Tramite, remoto: TramiteApi): Tramite {
  const estado = estadoDesdeApi(remoto)
  const paso = PASO_DESDE_API[remoto.paso_actual] ?? local.paso
  const [fecha, hora] = remoto.contexto?.fecha_hora ? partirFechaHora(remoto.contexto.fecha_hora) : [local.fecha, local.hora]
  return {
    ...local,
    // el folio lo manda la base: es el que ve el asesor y el que va en el PDF
    id: remoto.folio || local.id,
    estudio: remoto.estudio ? { categoria: local.estudio?.categoria ?? '', nombre: remoto.estudio.nombre, precio: local.estudio?.precio } : local.estudio,
    clinica: remoto.clinica?.nombre ?? local.clinica,
    clinicaPendiente: remoto.clinica ? false : local.clinicaPendiente,
    fecha: fecha || null,
    hora: hora || null,
    paso,
    estado,
    ultimoCanal: canalDesdeApi(remoto.ultimo_canal),
    canalInicio: canalDesdeApi(remoto.canal_origen ?? local.canalInicio),
    ultimaActualizacion: remoto.ultima_actividad_en ?? new Date().toISOString(),
  }
}

/** Texto del evento para la línea de tiempo del portal a partir de un evento del orquestador. */
export function detalleEvento(tipo: string, payload: Record<string, unknown> = {}): string {
  const dato = (k: string) => (typeof payload[k] === 'string' ? (payload[k] as string) : '')
  switch (tipo) {
    case 'tramite_iniciado': return 'Inició el trámite'
    case 'tramite_avanzado': return `Avanzó a ${dato('paso') || 'el siguiente paso'}`
    case 'cita_reservada': return 'Reservó su horario'
    case 'cita_confirmada': return 'Cita confirmada'
    case 'cita_cancelada': return 'Canceló la cita'
    case 'pago_generado': return 'Se generó la referencia de pago'
    case 'pago_confirmado': return 'Pago confirmado'
    case 'mensaje_recibido': return 'Escribió un mensaje'
    case 'mensaje_enviado': return 'Recibió una respuesta'
    case 'llegada_registrada': return `Llegó a la clínica${dato('turno') ? ` (turno ${dato('turno')})` : ''}`
    case 'verificacion_bloqueada': return 'Se bloqueó la verificación por intentos fallidos'
    default: return tipo.replace(/_/g, ' ')
  }
}

/** Normaliza un nombre para comparar catálogos ("Mastografía  bilateral" ≡ "mastografia bilateral"). */
export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

/* --------------------------------------------------- datos del formulario ---- */

/** 10 dígitos del portal → el formato que espera Auth ("526671234567", sin '+' ni el 1). */
export const aE164 = (diezDigitos: string) => '52' + diezDigitos.replace(/\D/g, '').slice(-10)

/**
 * El portal pide un solo campo "Nombre completo"; la base guarda nombre y apellidos por separado
 * (los exige para el primer trámite). Con tres partes o más, las dos últimas son los apellidos.
 */
export function partirNombre(completo: string): { nombre: string; apellido_paterno?: string; apellido_materno?: string } {
  const p = completo.trim().split(/\s+/).filter(Boolean)
  if (p.length === 0) return { nombre: '' }
  if (p.length === 1) return { nombre: p[0] }
  if (p.length === 2) return { nombre: p[0], apellido_paterno: p[1] }
  return { nombre: p.slice(0, -2).join(' '), apellido_paterno: p.at(-2), apellido_materno: p.at(-1) }
}
