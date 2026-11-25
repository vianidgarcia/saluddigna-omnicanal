/**
 * Cliente de la API de Salud Digna (orquestador omnicanal).
 *
 * - Una función tipada por cada RPC del esquema `api` (siempre POST: la API rechaza GET con PT405).
 * - Errores normalizados en `ErrorApi`, decididos por el campo `code` del JSON, no por el HTTP.
 * - Sin dependencias de React: lo pueden reutilizar la PWA, la app móvil o scripts de Node.
 * - Nunca usa la clave secreta: lo que la necesita pasa por Edge Functions.
 *
 * La sección "SIMULADOR" al final solo existe para pruebas locales.
 */
import { createClient, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export type Cliente = SupabaseClient<Database, 'api'>
type Funciones = Database['api']['Functions']
type Args<F extends keyof Funciones> = Funciones[F]['Args']

/**
 * Crea un cliente. `almacen` separa la sesión guardada: en un mismo navegador pueden
 * convivir la paciente (anónima), el asesor y el admin, cada uno con su propia sesión.
 */
export function crearCliente(url: string, clavePublica: string, almacen: string): Cliente {
  return createClient<Database, 'api'>(url, clavePublica, {
    db: { schema: 'api' },
    auth: { storageKey: `sd-${almacen}`, persistSession: true, autoRefreshToken: true },
  })
}

// =====================================================================
// Errores
// =====================================================================
export type Gravedad = 'aviso' | 'error'

/** Códigos que devuelve la API (más 'limite_citas', que llega sin `code`, y 'red'). */
export type CodigoError =
  | 'PT404' | 'PT405' | 'PT409' | 'PT423' | 'PT429' | '42501' | '22023' | 'P0001' | 'XX000'
  | 'limite_citas' | 'auth' | 'sesion_inexistente' | 'red' | 'desconocido'

export class ErrorApi extends Error {
  readonly code: CodigoError | string
  readonly hint: string | null
  readonly gravedad: Gravedad
  /** Texto para mostrar a una persona */
  readonly aviso: string
  /** El `detail` JSON que la base adjunta (p. ej. qué trámite existe en PT409 tramite_duplicado o PT423) */
  readonly detalle: Record<string, string>
  readonly cuerpo: unknown

  constructor(code: string, message: string, hint: string | null = null, cuerpo: unknown = null) {
    super(message)
    this.code = code
    this.hint = hint
    this.cuerpo = cuerpo
    let detalle: Record<string, string> = {}
    try { detalle = JSON.parse(String((cuerpo as { details?: string })?.details ?? '{}')) } catch { /* sin detalle */ }
    this.detalle = detalle
    const { aviso, gravedad } = traducir(code, message, detalle)
    this.aviso = aviso
    this.gravedad = gravedad
  }
}

function traducir(code: string, msg: string, det: Record<string, string>): { aviso: string; gravedad: Gravedad } {
  const aviso = (texto: string) => ({ aviso: texto, gravedad: 'aviso' as const })
  const error = (texto: string) => ({ aviso: texto, gravedad: 'error' as const })
  switch (code) {
    case 'limite_citas': return aviso('Ya tiene 5 citas próximas, el máximo permitido. Podrá agendar otra cuando pase alguna.')
    case 'PT409':
      if (msg === 'horario_sin_cupo') return aviso('Ese horario se acaba de llenar. Elija otro.')
      if (msg === 'conflicto_de_version') return aviso('Otro canal actualizó el trámite. Se recargó la información; intente de nuevo.')
      if (msg === 'limite_beneficiarios') return aviso('Se alcanzó el máximo de 10 familiares.')
      if (msg === 'clave_idempotencia_en_uso') return error('La llave de idempotencia ya la usó otro paciente.')
      if (msg === 'tramite_duplicado') return aviso(`Ya hay un trámite abierto de ${det.etiqueta ?? 'ese estudio'} (folio ${det.folio ?? '—'}): continúe ese.`)
      if (msg === 'cita_duplicada') return aviso(`${det.etiqueta ?? 'Esa persona'} ya tiene una cita futura de ese estudio (folio ${det.folio ?? '—'}).`)
      return aviso(`Conflicto: ${msg}`)
    case 'PT423': return aviso(`${det.canal === 'clinica' ? 'Recepción de la clínica' : 'Un asesor'} está atendiendo ${det.etiqueta ?? 'este trámite'} (folio ${det.folio ?? '—'}): se puede ver, pero no cambiar.`)
    case 'PT429': return aviso(`Demasiadas solicitudes: ${msg}. Espere un momento.`)
    case 'PT404': return aviso(`No encontrado: ${msg}.`)
    case '22023':
      if (msg === 'horario_fuera_de_atencion') return aviso('Ese horario está fuera del horario de atención de la clínica.')
      return aviso(`Dato inválido: ${msg}.`)
    case 'P0001': return aviso(msg)
    case '42501': return error(`Sin permiso: ${msg}.`)
    case 'PT405': return error('La API solo acepta POST.')
    case 'XX000': return error(`Error de configuración del servidor: ${msg}`)
    case 'auth': return aviso(msg)
    case 'red': return error(`Sin conexión con el servidor: ${msg}`)
    default: return error(msg || 'Error desconocido')
  }
}

/** Convierte cualquier error (PostgREST, Edge Function, Auth, red) en ErrorApi. */
export async function aErrorApi(e: unknown): Promise<ErrorApi> {
  if (e instanceof ErrorApi) return e
  if (e instanceof FunctionsHttpError) {
    const cuerpo = await (e.context as Response).json().catch(() => ({}))
    return new ErrorApi(cuerpo.code ?? 'desconocido', cuerpo.message ?? e.message, cuerpo.hint ?? null, cuerpo)
  }
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    if (o.error === 'limite_citas') return new ErrorApi('limite_citas', 'limite_citas', null, o)
    if (typeof o.code === 'string' && /^(PT\d{3}|\d{5}|P\d{4}|XX000|[0-9A-Z]{5})$/.test(o.code)) {
      return new ErrorApi(o.code, String(o.message ?? ''), (o.hint as string) ?? null, o)
    }
    if (o.name === 'AuthApiError' || o.name === 'AuthError' || o.__isAuthError) {
      if (esSesionHuerfana(o)) return new ErrorApi('sesion_inexistente', MENSAJE_SESION_HUERFANA, null, o)
      return new ErrorApi('auth', String(o.message ?? 'Error de autenticación'), null, o)
    }
    if (esSesionHuerfana(o)) return new ErrorApi('sesion_inexistente', MENSAJE_SESION_HUERFANA, null, o)
    if (o.name === 'TypeError' || o.name === 'FunctionsFetchError') return new ErrorApi('red', String(o.message ?? ''), null, o)
    if (typeof o.message === 'string') return new ErrorApi('desconocido', o.message, null, o)
  }
  return new ErrorApi('desconocido', String(e))
}

async function llamar<F extends keyof Funciones, T>(c: Cliente, funcion: F, args?: Args<F>): Promise<T> {
  // deno-lint/eslint: el tipo de rpc() de supabase-js no acepta claves genéricas; los Args ya están tipados arriba
  const { data, error } = await (c.rpc as unknown as (f: string, a?: object) => Promise<{ data: unknown; error: unknown }>)(
    funcion as string, (args ?? {}) as object)
  if (error) {
    const e = await aErrorApi(error)
    // El usuario del token ya no existe (db reset o "Reiniciar demo"): se olvida la sesión de este navegador
    if (e.code === 'sesion_inexistente') await c.auth.signOut({ scope: 'local' })
    throw e
  }
  return data as T
}

// ---------------------------------------------------------------------
// Sesión huérfana: el navegador guarda un token cuyo usuario ya no existe
// ("User from sub claim in JWT does not exist"), p. ej. tras `db reset` o "Reiniciar demo".
// ---------------------------------------------------------------------
const MENSAJE_SESION_HUERFANA = 'Tu sesión ya no existe (se reinició la base de datos). Vuelve a entrar.'
function esSesionHuerfana(o: Record<string, unknown>): boolean {
  return o.code === 'user_not_found' || /sub claim in JWT does not exist|user not found/i.test(String(o.message ?? ''))
}

// Token ya validado contra el servidor por cliente (para no preguntar a Auth en cada sondeo)
const validados = new WeakMap<Cliente, string>()

/** true si hay sesión y su usuario sigue existiendo. Si quedó huérfana, la cierra (solo en este navegador). */
export async function sesionVigente(c: Cliente): Promise<boolean> {
  const { data } = await c.auth.getSession()
  if (!data.session) return false
  if (validados.get(c) === data.session.access_token) return true
  const { error } = await c.auth.getUser()
  if (!error) { validados.set(c, data.session.access_token); return true }
  if (esSesionHuerfana(error as unknown as Record<string, unknown>) || error.status === 403 || error.status === 401) {
    await c.auth.signOut({ scope: 'local' })
    return false
  }
  return true   // otro error (p. ej. sin red): no se toca la sesión
}

async function invocar<T>(c: SupabaseClient<any, any>, funcion: string, cuerpo: object): Promise<T> {
  try {
    const { data, error } = await c.functions.invoke(funcion, { body: cuerpo })
    if (error) throw error
    return data as T
  } catch (e) {
    throw await aErrorApi(e)
  }
}

// =====================================================================
// Tipos del dominio (lo que devuelven las funciones api)
// =====================================================================
export type Canal = 'web' | 'app' | 'whatsapp' | 'call_center' | 'clinica'
export type Nivel = 'declarada' | 'canal' | 'verificada'
export type Relacion = 'titular' | 'hijo' | 'hija' | 'madre' | 'padre' | 'conyuge' | 'otro'
export type Paso = 'seleccion_estudio' | 'seleccion_clinica' | 'seleccion_horario' | 'pago' | 'confirmada'

export interface Sesion {
  interaccion_id: string
  canal: Canal
  nivel_verificacion: Nivel
  requiere_verificacion: boolean
  metodos?: string[]
  /** Lo que le falta al titular para iniciar trámites (vacío = registro completo). Solo con sesión canal+ */
  requiere_registro?: CampoRegistro[]
}
export type CampoRegistro = 'nombre' | 'apellido_paterno' | 'celular_verificado'

export interface Paciente {
  id: string
  estado?: string
  nombre?: string | null
  /** Nombre o, si no lo hay, el teléfono enmascarado ("Paciente +52******4567") */
  nombre_mostrar?: string | null
  telefono?: string | null
  tiene_fecha_nacimiento: boolean
  /** Aceptó avisos por WhatsApp en su teléfono verificado */
  avisos_whatsapp?: boolean
}

export interface Tramite {
  id: string
  /** Folio corto legible (SD-4K7Q) */
  folio: string
  /** "<estudio> · para <ti | nombre o relación>" */
  etiqueta: string
  tipo: string
  estado: string
  paso_actual: Paso
  paso_descripcion?: string
  siguiente_paso?: string | null
  version: number
  contexto: { estudio_id?: string; clinica_id?: string; beneficiario_id?: string; cita_id?: string; fecha_hora?: string; precio?: number; pago_id?: string }
  beneficiario?: { id: string; nombre: string | null; relacion: Relacion } | null
  estudio?: { id: string; nombre: string; preparacion: string | null } | null
  clinica?: { id: string; nombre: string; ciudad: string; direccion: string | null } | null
  resumen?: string | null
  resumen_actualizado_en?: string | null
  canal_origen?: Canal
  ultimo_canal?: Canal
  canales_usados?: Canal[]
  ultima_actividad_en?: string
  expira_en?: string
  /** Bloqueo del asesor vigente */
  en_atencion?: boolean
  atencion_hasta?: string | null
  /** Solo en tramite_activo del contexto */
  en_atencion_de_otro?: boolean
  atendido_por_mi?: boolean
}

/** Tarjeta de un trámite pendiente (contexto.tramites_abiertos), recientes primero */
export interface TramiteAbierto {
  id: string
  folio: string
  /** Solo con nivel canal o más */
  etiqueta?: string
  paso_actual: Paso
  paso_descripcion?: string
  ultimo_canal?: Canal
  ultima_actividad_en?: string
  beneficiario?: { id: string; nombre: string | null; relacion: Relacion }
  en_atencion_de_otro?: boolean
  atendido_por_mi?: boolean
  /** Dónde lo atiende otro: 'call_center' (asesor) o 'clinica' (recepción) */
  atencion_canal?: 'call_center' | 'clinica' | null
}

export interface Evento {
  ocurrido_en: string
  tipo_evento: string
  canal: string
  actor_tipo: string
  tramite_id?: string | null
  payload: Record<string, unknown>
}

export interface Mensaje { creado_en: string; canal: string; autor: string; contenido: string }

export interface CitaProxima {
  id: string
  fecha_hora: string
  /** reservada | confirmada | en_clinica (ya llegó: trae turno y área) */
  estado: string
  turno?: string | null
  area?: string | null
  llegada_en?: string | null
  estudio: string
  clinica: string
  precio: number
  beneficiario: { id: string; nombre: string | null; relacion: Relacion }
}

export interface PagoPendiente { id: string; monto: number; link_pago: string; expira_en: string }

/** Contexto unificado de una sesión. Lo que trae depende del nivel de verificación. */
export interface Contexto {
  sesion: Sesion
  paciente: Paciente
  /** El trámite con el que trabaja ESTA sesión (null: hay que elegir uno o empezar otro) */
  tramite_activo: Tramite | null
  /** Todos los trámites abiertos del paciente, recientes primero */
  tramites_abiertos: TramiteAbierto[]
  linea_tiempo?: Evento[]
  mensajes_recientes?: Mensaje[]
  citas_proximas?: (CitaProxima & { folio?: string })[]
  pagos_pendientes?: (PagoPendiente & { folio?: string })[]
}

export interface Estudio {
  id: string; clave: string; nombre: string; categoria: string; descripcion: string | null
  preparacion: string | null; duracion_min: number; precio_base: number
}
export interface Clinica {
  id: string; clave: string; nombre: string; ciudad: string; estado: string; direccion?: string
  zona_horaria: string
  /** Solo en clinicas_para_estudio */
  precio: number
  id_externo?: number; slug?: string; telefono?: string; lat?: number; lng?: number
  /** Horario como se publica ("Lunes a Viernes: 6:00 am a 7:00 pm · …") */
  horario?: string
  /** Solo si se mandó lat/lng */
  distancia_km?: number
}
export interface Ubicacion { estado: string; clinicas: number; ciudades: { ciudad: string; clinicas: number }[] }
export type FiltroClinicas = { ciudad?: string; estado?: string; busqueda?: string; lat?: number; lng?: number; limite?: number }
export interface Horario { fecha_hora: string; fecha: string; hora: string; disponibles: number }
export interface Beneficiario {
  id: string; nombre: string; relacion: Relacion
  nombre_completo?: string; fecha_nacimiento?: string; es_tutor_legal?: boolean
}
export interface Pago { pago_id: string; monto: number; moneda: string; link_pago: string; expira_en: string; version: number }

export interface CitaAgenda {
  cita_id: string; fecha_hora: string; estado: string; estudio: string; paciente: string
  es_titular: boolean; agendada_por: string | null; verificado_presencial: boolean
  preparacion: string | null; area: Area; area_nombre: string
  turno: string | null; llegada_en: string | null; pagada: boolean; folio: string | null
}
export type Area = 'laboratorio' | 'ultrasonido' | 'rayos_x' | 'mastografia'
export interface Llegada {
  cita_id: string; turno: string; llegada_en: string; estudio: string; preparacion: string | null
  cumplio_preparacion: boolean | null; area: Area; area_nombre: string
  pago: { estado: 'pagado' | 'pendiente'; monto: number }
  /** "Pasar a caja" | "Pasar a Ultrasonido" | "No cumplió la preparación: …" */
  indicacion: string
}
export interface TramiteEnCurso {
  tramite_id: string; paciente_id: string; paciente: string; tipo: string; paso_actual: string; estado: string
  canal_origen: string; ultimo_canal: string; clinica: string | null; ultima_actividad_en: string
  minutos_inactivo: number; resumen: string | null
}
export interface Journey {
  paciente: { id: string; estado: string; nombre: string }
  tramites: Tramite[]
  interacciones: { id: string; canal: string; agente: string; nivel: Nivel; iniciada_en: string; finalizada_en: string | null; resultado: string | null }[]
  linea_tiempo: Evento[]
}
export interface PeriodoMetricas {
  desde: string; hasta: string; tramites: number; citas: number; ingresos: number
  embudo: { paso: string; estado: string; tramites: number }[]
  por_canal_origen: Record<string, number>
  transiciones_de_canal: { de: string; a: string; total: number }[]
  citas_por_estado: Record<string, number>
}
export interface Metricas {
  actual: PeriodoMetricas
  anio_anterior: PeriodoMetricas
  variacion_pct: { tramites: number | null; citas: number | null; ingresos: number | null }
}

// =====================================================================
// Autenticación
// =====================================================================

/** Sesión anónima de la web/app (la crea si no hay). */
export async function asegurarSesionAnonima(c: Cliente): Promise<void> {
  if (await sesionVigente(c)) return
  const { error } = await c.auth.signInAnonymously()
  if (error) throw await aErrorApi(error)
}

/** Empieza de cero: otra persona anónima en el mismo navegador. */
export async function nuevaSesionAnonima(c: Cliente): Promise<void> {
  await c.auth.signOut({ scope: 'local' })   // local: funciona aunque el usuario ya no exista
  const { error } = await c.auth.signInAnonymously()
  if (error) throw await aErrorApi(error)
}

/**
 * Paso 1 de "verificar mi celular": Auth manda un OTP (en local, números de prueba con 123456).
 * - Teléfono nuevo: se agrega a la cuenta actual (anónima) → 'agregar'.
 * - Teléfono que ya tiene cuenta (la paciente volvió, quizá desde otro dispositivo): se inicia
 *   sesión con esa cuenta → 'iniciar_sesion'.
 * Devuelve el modo, que hay que pasar a confirmarOtpTelefono.
 */
export type ModoOtp = 'agregar' | 'iniciar_sesion'
export async function pedirOtpTelefono(c: Cliente, telefono: string): Promise<ModoOtp> {
  const { error } = await c.auth.updateUser({ phone: telefono })
  if (!error) return 'agregar'
  if (error.code === 'phone_exists' || /already been registered/i.test(error.message)) {
    const r = await c.auth.signInWithOtp({ phone: telefono, options: { shouldCreateUser: false } })
    if (r.error) throw await aErrorApi(r.error)
    return 'iniciar_sesion'
  }
  throw await aErrorApi(error)
}

/** Paso 2: confirma el código. Después hay que volver a llamar iniciarSesionPaciente. */
export async function confirmarOtpTelefono(c: Cliente, telefono: string, codigo: string, modo: ModoOtp = 'agregar'): Promise<void> {
  const { error } = await c.auth.verifyOtp({ phone: telefono, token: codigo, type: modo === 'agregar' ? 'phone_change' : 'sms' })
  if (error) throw await aErrorApi(error)
}

export async function iniciarSesionPersonal(c: Cliente, email: string, contrasena: string): Promise<{ rol: string | null; clinica_id: string | null }> {
  const { data, error } = await c.auth.signInWithPassword({ email, password: contrasena })
  if (error) throw await aErrorApi(error)
  const meta = data.user.app_metadata ?? {}
  return { rol: meta.rol ?? null, clinica_id: meta.clinica_id ?? null }
}

export async function cerrarSesion(c: Cliente): Promise<void> {
  const { error } = await c.auth.signOut()
  if (error) await c.auth.signOut({ scope: 'local' })   // sesión huérfana: al menos se olvida aquí
}

// =====================================================================
// Paciente (web / app)
// =====================================================================
export const iniciarSesionPaciente = (c: Cliente, canal: 'web' | 'app') =>
  llamar<'iniciar_sesion_paciente', Contexto>(c, 'iniciar_sesion_paciente', { p_canal: canal })

/** Con la casilla "Acepto recibir avisos por WhatsApp" (requiere teléfono verificado). */
/** Registro del titular (paciente, bot o personal). Sin verificar solo llena campos vacíos. */
export const guardarDatosPaciente = (c: Cliente, interaccion: string,
  datos: { nombre?: string; apellido_paterno?: string; apellido_materno?: string | null }) =>
  llamar<'guardar_datos_paciente', Contexto>(c, 'guardar_datos_paciente', {
    p_interaccion_id: interaccion,
    ...(datos.nombre ? { p_nombre: datos.nombre } : {}),
    ...(datos.apellido_paterno ? { p_apellido_paterno: datos.apellido_paterno } : {}),
    ...(datos.apellido_materno ? { p_apellido_materno: datos.apellido_materno } : {}),
  })

export const registrarConsentimientoAvisos = (c: Cliente, interaccion: string, acepta: boolean) =>
  llamar<'registrar_consentimiento_avisos', { acepta: boolean; telefono: string; registrado_en: string }>(
    c, 'registrar_consentimiento_avisos', { p_interaccion_id: interaccion, p_acepta: acepta })

// =====================================================================
// Comunes a cualquier sesión (paciente o personal)
// =====================================================================
export const obtenerContexto = (c: Cliente, interaccion: string) =>
  llamar<'obtener_contexto', Contexto>(c, 'obtener_contexto', { p_interaccion_id: interaccion })

/**
 * Crea un trámite NUEVO (conviven varios) ya con su estudio y para quién: nace en "elegir clínica".
 * En web/app exige teléfono verificado. PT409 tramite_duplicado si esa persona ya lo tiene abierto.
 */
export const iniciarTramite = (c: Cliente, interaccion: string, estudio: string, beneficiario?: string | null) =>
  llamar<'iniciar_tramite', Tramite>(c, 'iniciar_tramite', {
    p_interaccion_id: interaccion, p_estudio_id: estudio, ...(beneficiario ? { p_beneficiario_id: beneficiario } : {}),
  })

/** La sesión sigue con un trámite pendiente. Un asesor lo toma (bloqueo 10 min; PT423 si es de otro asesor). */
export const retomarTramite = (c: Cliente, interaccion: string, tramite: string) =>
  llamar<'retomar_tramite', Tramite & { en_atencion_de_otro: boolean }>(c, 'retomar_tramite', { p_interaccion_id: interaccion, p_tramite_id: tramite })

/** p_datos solo acepta estudio_id, clinica_id y beneficiario_id. */
export const avanzarTramite = (c: Cliente, interaccion: string, tramite: Tramite, paso: Paso,
  datos: { estudio_id?: string; clinica_id?: string; beneficiario_id?: string } = {}) =>
  llamar<'avanzar_tramite', Tramite>(c, 'avanzar_tramite', {
    p_interaccion_id: interaccion, p_tramite_id: tramite.id, p_version: tramite.version, p_paso: paso, p_datos: datos,
  })

/** Con 5 citas futuras lanza ErrorApi('limite_citas') con gravedad 'aviso'. */
export const reservarCita = (c: Cliente, interaccion: string, tramite: Tramite, fechaHora: string) =>
  llamar<'reservar_cita', Tramite>(c, 'reservar_cita', {
    p_interaccion_id: interaccion, p_tramite_id: tramite.id, p_version: tramite.version, p_fecha_hora: fechaHora,
  })

export const generarPago = (c: Cliente, interaccion: string, tramite: Tramite) =>
  llamar<'generar_pago', Pago>(c, 'generar_pago', { p_interaccion_id: interaccion, p_tramite_id: tramite.id, p_version: tramite.version })

export const agregarBeneficiario = (c: Cliente, interaccion: string, b: {
  nombre: string; apellido_paterno?: string; apellido_materno?: string; fecha_nacimiento: string
  sexo?: 'F' | 'M' | 'X'; relacion: Exclude<Relacion, 'titular'>; es_tutor_legal?: boolean
}) =>
  llamar<'agregar_beneficiario', { beneficiario_id: string; reutilizado: boolean; relacion: Relacion }>(c, 'agregar_beneficiario', {
    p_interaccion_id: interaccion, p_nombre: b.nombre, p_apellido_paterno: b.apellido_paterno ?? null,
    p_apellido_materno: b.apellido_materno ?? null, p_fecha_nacimiento: b.fecha_nacimiento, p_sexo: b.sexo ?? null,
    p_relacion: b.relacion, p_es_tutor_legal: b.es_tutor_legal ?? false,
  } as unknown as Args<'agregar_beneficiario'>)

export const misBeneficiarios = (c: Cliente, interaccion: string) =>
  llamar<'mis_beneficiarios', Beneficiario[]>(c, 'mis_beneficiarios', { p_interaccion_id: interaccion })

export const cerrarInteraccion = (c: Cliente, interaccion: string, resultado = 'finalizada') =>
  llamar<'cerrar_interaccion', null>(c, 'cerrar_interaccion', { p_interaccion_id: interaccion, p_resultado: resultado })

// =====================================================================
// Catálogo (público: también sin sesión)
// =====================================================================
export const catalogoEstudios = (c: Cliente, busqueda?: string, categoria?: string) =>
  llamar<'catalogo_estudios', Estudio[]>(c, 'catalogo_estudios', { p_busqueda: busqueda || undefined, p_categoria: categoria || undefined })

const argsFiltro = (f: FiltroClinicas) => ({
  p_ciudad: f.ciudad || undefined, p_estado: f.estado || undefined, p_busqueda: f.busqueda || undefined,
  p_lat: f.lat, p_lng: f.lng, p_limite: f.limite,
})

/** Clínicas que hacen el estudio, con su precio. Sin filtros: las primeras 50 por ciudad. */
export const clinicasParaEstudio = (c: Cliente, estudio: string, filtro: FiltroClinicas = {}) =>
  llamar<'clinicas_para_estudio', Clinica[]>(c, 'clinicas_para_estudio', { p_estudio_id: estudio, ...argsFiltro(filtro) })

/** Todas las clínicas activas (hasta 300), con teléfono, coordenadas y horario */
export const directorioClinicas = (c: Cliente, filtro: FiltroClinicas = {}) =>
  llamar<'directorio_clinicas', Clinica[]>(c, 'directorio_clinicas', argsFiltro(filtro))

/** Estados y ciudades con clínica (que hagan el estudio, si se indica) */
export const ubicacionesClinicas = (c: Cliente, estudio?: string) =>
  llamar<'ubicaciones_clinicas', Ubicacion[]>(c, 'ubicaciones_clinicas', { p_estudio_id: estudio })

/** inmediato: en mostrador (personal de la clínica) incluye el horario en curso; si no, 1 h de anticipación */
export const horariosDisponibles = (c: Cliente, clinica: string, estudio: string, desde?: string, dias?: number, inmediato = false) =>
  llamar<'horarios_disponibles', Horario[]>(c, 'horarios_disponibles', {
    p_clinica_id: clinica, p_estudio_id: estudio, p_desde: desde, p_dias: dias, ...(inmediato ? { p_inmediato: true } : {}),
  })

// =====================================================================
// Personal: call center y clínica
// =====================================================================
export const iniciarContacto = (c: Cliente, canal: 'call_center' | 'clinica', telefono: string) =>
  llamar<'iniciar_contacto', Contexto>(c, 'iniciar_contacto', {
    p_canal: canal, p_telefono: telefono, p_agente: 'humano', p_nivel: 'declarada',
  })

export const verificarIdentidad = (c: Cliente, interaccion: string, fechaNacimiento: string) =>
  llamar<'verificar_identidad', { verificado: boolean; motivo?: string; nivel_verificacion?: Nivel; contexto?: Contexto }>(
    c, 'verificar_identidad', { p_interaccion_id: interaccion, p_fecha_nacimiento: fechaNacimiento })

/** Edge Function: el código va al teléfono REGISTRADO del paciente; aquí solo vuelve lo enmascarado. */
export const enviarOtp = (c: Cliente, interaccion: string) =>
  invocar<{ expira_en: string; telefono_enmascarado: string }>(c, 'enviar-otp', { interaccion_id: interaccion })

export const validarOtp = (c: Cliente, interaccion: string, codigo: string) =>
  llamar<'validar_otp', { verificado: boolean; motivo?: string; contexto?: Contexto }>(c, 'validar_otp', { p_interaccion_id: interaccion, p_codigo: codigo })

export const agendaClinica = (c: Cliente, clinica: string, fecha?: string) =>
  llamar<'agenda_clinica', CitaAgenda[]>(c, 'agenda_clinica', { p_clinica_id: clinica, p_fecha: fecha })

export const TIPOS_DOCUMENTO = ['ine', 'pasaporte', 'licencia', 'cedula_profesional', 'cartilla_militar', 'acta_nacimiento', 'curp', 'otro'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

/** Mostrador: la identificación oficial verifica ESTA sesión (metodo 'identificacion'). Solo el tipo de documento. */
export const verificarIdentificacion = (c: Cliente, interaccion: string, tipo: TipoDocumento) =>
  llamar<'verificar_presencial', Contexto>(c, 'verificar_presencial', { p_interaccion_id: interaccion, p_tipo_documento: tipo })

/** Llegada: INE de quien recibe el estudio, cita en_clinica, turno por área y a dónde dirigirlo. */
export const registrarLlegada = (c: Cliente, cita: string, tipo: TipoDocumento, cumplioPreparacion: boolean) =>
  llamar<'registrar_llegada', Llegada>(c, 'registrar_llegada', {
    p_cita_id: cita, p_tipo_documento: tipo, p_cumplio_preparacion: cumplioPreparacion,
  })

/** Solo el tipo de documento: el número nunca se captura. */
export const verificarPresencial = (c: Cliente, cita: string, tipo: TipoDocumento) =>
  llamar<'verificar_presencial', { cita_id: string; beneficiario_id: string; tipo_documento: string; verificado_presencial_en: string }>(
    c, 'verificar_presencial', { p_cita_id: cita, p_tipo_documento: tipo })

// =====================================================================
// Panel administrativo
// =====================================================================
export const tramitesEnCurso = (c: Cliente, filtros: { clinica?: string; paso?: string; limite?: number } = {}) =>
  llamar<'tramites_en_curso', TramiteEnCurso[]>(c, 'tramites_en_curso', { p_clinica_id: filtros.clinica, p_paso: filtros.paso, p_limite: filtros.limite })

// ---------------------------------------------------------------------
// Supervisión: bandeja de atención y búsqueda
// ---------------------------------------------------------------------
export const CATEGORIAS_BANDEJA = ['atorados', 'pago_por_vencer', 'en_atencion', 'seguridad', 'llegadas_hoy'] as const
export type CategoriaBandeja = (typeof CATEGORIAS_BANDEJA)[number]
export interface ItemBandeja {
  categoria: CategoriaBandeja
  paciente_id: string
  paciente: string
  /** Texto listo para mostrar: "Sin actividad hace 3 h · Elegir clínica" */
  detalle: string
  momento: string
  tramite_id?: string; folio?: string; etiqueta?: string; clinica?: string | null; canal?: string; paso?: string; estado?: string
  // según la categoría
  monto?: number; atiende?: string; canal_atencion?: string; cita_id?: string; turno?: string; area?: string
  fallidas?: number; bloqueos?: number; metodos?: string[]; bloqueado_hasta?: string | null
}
export interface Bandeja {
  conteos: Record<CategoriaBandeja, number>
  categoria: CategoriaBandeja | null
  items: ItemBandeja[]
  /** Para la página siguiente (null si no hay más) */
  siguiente_cursor: string | null
}
export interface FiltrosBandeja {
  categoria?: CategoriaBandeja | null; limite?: number; cursor?: string | null
  clinica?: string; canal?: string; estado?: string; desde?: string; hasta?: string
}
/** Sin categoría solo trae conteos; cada página, máximo 50. Supervisor de clínica: solo la suya. */
export const bandejaAtencion = (c: Cliente, f: FiltrosBandeja = {}) =>
  llamar<'bandeja_atencion', Bandeja>(c, 'bandeja_atencion', {
    p_categoria: f.categoria ?? undefined, p_limite: f.limite, p_cursor: f.cursor ?? undefined,
    p_clinica_id: f.clinica || undefined, p_canal: f.canal || undefined, p_estado: f.estado || undefined,
    p_desde: f.desde || undefined, p_hasta: f.hasta || undefined,
  })

export interface PacienteEncontrado {
  paciente_id: string; nombre: string; telefono: string | null; estado: string
  /** Si es un familiar declarado: el journey es el de su titular */
  titular_id: string | null
  tramites_abiertos: number; ultimo_folio: string | null; ultima_actividad_en: string | null
  coincide_por: 'folio' | 'telefono' | 'nombre'
}
/** Por celular, folio (SD-4K7Q) o nombre; mínimo 3 caracteres. */
export const buscarPacientes = (c: Cliente, texto: string, limite = 20) =>
  llamar<'buscar_pacientes', PacienteEncontrado[]>(c, 'buscar_pacientes', { p_texto: texto, p_limite: limite })

export const journeyPaciente = (c: Cliente, paciente: string, limite = 100) =>
  llamar<'journey_paciente', Journey>(c, 'journey_paciente', { p_paciente_id: paciente, p_limite: limite })

export const metricas = (c: Cliente, desde: string, hasta: string, clinica?: string) =>
  llamar<'metricas', Metricas>(c, 'metricas', { p_desde: desde, p_hasta: hasta, p_clinica_id: clinica })

export interface EventoEnVivo {
  evento_id: string; paciente_id: string; tramite_id: string | null; tipo_evento: string
  canal: string; actor_tipo: string; ocurrido_en: string
}

/**
 * Tiempo real del panel: Broadcast privado 'journey:global' (solo supervisor/admin, por RLS).
 * Devuelve la función para dejar de escuchar.
 */
export async function suscribirJourneyGlobal(c: Cliente, alEvento: (e: EventoEnVivo) => void,
  alEstado?: (estado: string) => void): Promise<() => void> {
  await c.realtime.setAuth()
  const canal = c.channel('journey:global', { config: { private: true } })
    .on('broadcast', { event: '*' }, (m) => alEvento(m.payload as EventoEnVivo))
    .subscribe((estado) => alEstado?.(estado))
  return () => { void c.removeChannel(canal) }
}

/** Lo que llega por el canal del paciente: eventos del trámite y avisos de mensaje nuevo (sin su texto). */
export type EventoPaciente =
  | { tipo: 'evento'; evento: EventoEnVivo }
  | { tipo: 'mensaje_nuevo'; mensaje: { paciente_id: string; interaccion_id: string; canal: Canal; autor: string; direccion: 'entrante' | 'saliente'; creado_en: string } }

/**
 * Tiempo real de UN paciente (Broadcast privado 'paciente:<id>'). Lo pueden escuchar el propio
 * paciente (web/app) y el asesor mientras tiene una interacción abierta con él (RLS).
 * Los mensajes llegan sin su texto (está cifrado): para verlo, volver a pedir el contexto.
 */
export async function suscribirPaciente(c: Cliente, pacienteId: string, alLlegar: (e: EventoPaciente) => void,
  alEstado?: (estado: string) => void): Promise<() => void> {
  await c.realtime.setAuth()
  const canal = c.channel(`paciente:${pacienteId}`, { config: { private: true } })
    .on('broadcast', { event: '*' }, (m) => alLlegar(m.event === 'mensaje_nuevo'
      ? { tipo: 'mensaje_nuevo', mensaje: m.payload as never }
      : { tipo: 'evento', evento: m.payload as EventoEnVivo }))
    .subscribe((estado) => alEstado?.(estado))
  return () => { void c.removeChannel(canal) }
}

// =====================================================================
// SIMULADOR (solo pruebas locales): teléfono simulado y proveedor de pagos
// =====================================================================
export interface MensajeBandeja { id: number; tipo: 'otp' | 'link_pago' | 'bot' | 'sistema'; contenido: string; creado_en: string }

/** Manda un mensaje como si llegara de WhatsApp (formato del webhook de WhatsApp Cloud API). */
export const enviarWhatsApp = (c: Cliente, telefono: string, texto: string) =>
  invocar<{ resultados: { respuestas?: string[]; error?: string }[] }>(c, 'whatsapp-webhook', {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [{ from: telefono, id: `sim-${Date.now()}`, type: 'text', text: { body: texto } }] } }] }],
  })

/** Lee la bandeja del teléfono simulado (esquema simulador, apagado fuera de local). */
export async function leerBandeja(c: Cliente, telefono: string, despuesDe = 0): Promise<MensajeBandeja[]> {
  const { data, error } = await (c.schema('simulador' as 'api').rpc as unknown as (f: string, a: object) => Promise<{ data: unknown; error: unknown }>)(
    'leer', { p_telefono: telefono, p_despues_de: despuesDe })
  if (error) throw await aErrorApi(error)
  return data as MensajeBandeja[]
}

/** Simula al proveedor de pagos avisando que el pago se acreditó. */
export const pagarSimulado = (c: Cliente, referencia: string, telefono?: string, estado: 'pagado' | 'fallido' = 'pagado') =>
  invocar<{ estado: string; repetido?: boolean }>(c, 'pagos-webhook', { referencia, estado, telefono })

async function rpcSimulador<T>(c: Cliente, funcion: string, args: object = {}): Promise<T> {
  const { data, error } = await (c.schema('simulador' as 'api').rpc as unknown as (f: string, a: object) => Promise<{ data: unknown; error: unknown }>)(
    funcion, args)
  if (error) throw await aErrorApi(error)
  return data as T
}

/** Borra SOLO los datos de los teléfonos de prueba (42501 si el simulador está apagado). */
export const reiniciarDemo = (c: Cliente) =>
  rpcSimulador<{ pacientes_borrados: number; telefonos: string[] }>(c, 'reiniciar_demo')

/** Demo: pone la cita del trámite en este momento (para mostrar la llegada a cualquier hora). */
export const adelantarCita = (c: Cliente, folio: string) =>
  rpcSimulador<{ folio: string; cita_id: string; fecha_hora: string }>(c, 'adelantar_cita', { p_folio: folio })

/** Demo: deja el trámite inactivo y programa su recordatorio (plantilla de WhatsApp). */
export const forzarRecordatorio = (c: Cliente, folio: string) =>
  rpcSimulador<{ folio: string; recordatorios_programados: number }>(c, 'forzar_recordatorio', { p_folio: folio })

/** Referencia de pago a partir del link (…/checkout/SD-XXXX). */
export const referenciaDeLink = (link: string) => link.split('/checkout/')[1] ?? link
