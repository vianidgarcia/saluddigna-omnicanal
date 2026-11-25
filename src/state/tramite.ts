/* Estado del trámite: simula al orquestador omnicanal. Todo es de demostración. */

export type Canal = 'web' | 'whatsapp' | 'call_center' | 'clinica' | 'pasarela'
export type MetodoPago = 'en_linea' | 'oxxo' | 'spei' | 'en_clinica'
/** Pago simulado (pasarela de demostración). Nunca se guardan número completo ni CVV: solo marca y últimos 4. */
export type Pago = {
  estado: 'pendiente' | 'aprobado' | 'rechazado'
  intentos: number
  autorizacion?: string
  tarjeta?: { marca: string; ultimos4: string }
  motivo?: string
  fecha?: string
}
export type Paso = 1 | 2 | 3 | 4
export const TOTAL_PASOS = 4
export const LISTA_PASOS: Paso[] = [1, 2, 3, 4]
export type Estado = 'en_curso' | 'pago_pendiente' | 'confirmada'

export type Evento = { tipo: string; canal: Canal; fecha: string; detalle: string }

export type Tramite = {
  id: string
  estudio: { categoria: string; nombre: string; precio?: string } | null
  clinica: string | null
  /** true cuando el paciente eligió "Aún no lo decido" */
  clinicaPendiente: boolean
  fecha: string | null // AAAA-MM-DD
  hora: string | null // HH:MM
  /** sin cuenta: el trámite se identifica por su folio (id); nombre y teléfono (10 dígitos) se piden al confirmar */
  paciente: { nombre: string | null; telefono: string | null }
  /** Modo api: familiar para quien es la cita (sin esto, es para el titular) */
  beneficiario?: { id: string; nombre: string } | null
  /** Modo api: aceptó avisos por WhatsApp */
  avisos?: boolean
  metodoPago: MetodoPago | null
  pago?: Pago | null
  paso: Paso
  estado: Estado
  /** el paciente entró a editar un dato desde el resumen del último paso */
  desdeResumen: boolean
  canalInicio: Canal
  ultimoCanal: Canal
  ultimaActualizacion: string
  eventos: Evento[]
}

export const STORAGE_KEY = 'sd_tramite_activo'

export const PASOS: Record<Paso, string> = {
  1: 'Estudio',
  2: 'Clínica',
  3: 'Fecha y hora',
  4: 'Pago',
}

export const CANAL: Record<Canal, string> = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  call_center: 'Call Center',
  clinica: 'clínica',
  pasarela: 'Pasarela de pago',
}

export const METODO: Record<MetodoPago, string> = {
  en_linea: 'Tarjeta de crédito o débito',
  oxxo: 'Efectivo en tienda (Oxxo)',
  spei: 'Transferencia SPEI',
  en_clinica: 'Pago en clínica',
}
/** Texto del pago pendiente según el método (tarjeta de inicio, Mis trámites, asesor). */
export const PAGO_PENDIENTE: Record<MetodoPago, string> = {
  en_linea: 'Pago con tarjeta pendiente',
  oxxo: 'Pago pendiente en\u00a0Oxxo',
  spei: 'Transferencia pendiente',
  en_clinica: 'Pago en clínica',
}

export function loadTramite(): Tramite | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as Tramite
    if (!t || !t.id || !Array.isArray(t.eventos)) return null
    // trámites guardados con la versión de 5 pasos (incluía identificación por WhatsApp)
    const viejo = t as unknown as { paso: number; paciente?: { nombre?: string | null; telefono?: string | null } }
    return {
      ...t,
      paso: Math.min(Math.max(viejo.paso, 1), TOTAL_PASOS) as Paso,
      paciente: { nombre: viejo.paciente?.nombre ?? null, telefono: viejo.paciente?.telefono ?? null },
    }
  } catch {
    return null
  }
}

/** Al abrir la página: una cita ya confirmada no se conserva (no hay cuenta; el comprobante en PDF es el respaldo).
    Un trámite en curso sí se conserva, para retomarlo tras una interrupción. Las demás lecturas (p. ej. la
    sincronización entre pestañas) usan loadTramite para no perder la confirmación en vivo. */
export function loadTramiteAlAbrir(): Tramite | null {
  const t = loadTramite()
  if (t?.estado === 'confirmada') { saveTramite(null); return null }
  return t
}

/** Hora para mostrar en formato de 12 horas con AM/PM ("13:30" → "01:30 PM"). Internamente se guarda "HH:MM" (24 h). */
export function fmtHora(h: string | null | undefined): string {
  if (!h) return ''
  const [hh, mm] = h.split(':').map(Number)
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`
}

/** Teléfono a 10 dígitos con formato 667 123 4567. */
export const fmtTelefono = (d: string | null) => (d ?? '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3')

export function saveTramite(t: Tramite | null) {
  try {
    if (t) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(t))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* almacenamiento bloqueado (ventana privada o vista previa): el flujo sigue en memoria */
  }
}

export function nuevoTramite(canal: Canal = 'web'): Tramite {
  const now = new Date().toISOString()
  return {
    id: 'SD-' + Date.now().toString(36).toUpperCase(),
    estudio: null,
    clinica: null,
    clinicaPendiente: false,
    fecha: null,
    hora: null,
    paciente: { nombre: null, telefono: null },
    metodoPago: null,
    paso: 1,
    estado: 'en_curso',
    desdeResumen: false,
    canalInicio: canal,
    ultimoCanal: canal,
    ultimaActualizacion: now,
    eventos: [{ tipo: 'tramite.iniciado', canal, fecha: now, detalle: 'Inició el agendado de una cita' }],
  }
}

/** Agrega un evento a la línea de tiempo y actualiza el último canal. */
export function conEvento(t: Tramite, tipo: string, detalle: string, canal: Canal = 'web'): Tramite {
  const fecha = new Date().toISOString()
  return { ...t, ultimoCanal: canal, ultimaActualizacion: fecha, eventos: [...t.eventos, { tipo, canal, fecha, detalle }] }
}

/** Qué pasos ya tienen su dato completo. */
export function pasoCompleto(t: Tramite, p: Paso): boolean {
  switch (p) {
    case 1: return !!t.estudio
    case 2: return !!t.clinica || t.clinicaPendiente
    case 3: return !!t.fecha && !!t.hora
    case 4: return !!t.metodoPago
  }
}

export function hace(iso: string, now = Date.now()): string {
  const min = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return 'el ' + new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

export function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Qué le falta al paciente en cada paso (tarjeta de continuidad y Mis trámites). */
export const PENDIENTE: Record<Paso, string> = {
  1: 'Elige tu estudio',
  2: 'Elige tu clínica',
  3: 'Elige fecha y hora',
  4: 'Elige cómo pagar',
}

export const ICONO_CANAL: Record<Canal, string> = { web: 'globe', whatsapp: 'chat', call_center: 'phone', clinica: 'pin', pasarela: 'tarjeta' }

/** Texto de estado corto para la tarjeta y Mis trámites. */
export function estadoTexto(t: Tramite): string {
  if (t.estado === 'confirmada') return 'Cita confirmada'
  if (t.estado === 'pago_pendiente') return PAGO_PENDIENTE[t.metodoPago ?? 'oxxo']
  return PENDIENTE[t.paso]
}

export function clinicaTexto(t: Tramite): string {
  return t.clinica ?? (t.clinicaPendiente ? 'Clínica por decidir' : 'Clínica por elegir')
}

/** Hook para refrescar textos relativos ("hace 2 min"). */
export const TICK_MS = 30000

/** Relleno de la barra (%): el paso actual cuenta como medio segmento, así el último paso no se ve terminado. */
export const avance = (paso: number) => ((paso - 0.5) / TOTAL_PASOS) * 100

/** Eventos que solo ven asesores y administradores. */
export const esNotaInterna = (e: Evento) => e.tipo === 'nota.interna'

/** Agrega una nota interna sin cambiar el último canal que ve el paciente. */
export function conNota(t: Tramite, texto: string, autor: string): Tramite {
  return { ...t, eventos: [...t.eventos, { tipo: 'nota.interna', canal: 'call_center', fecha: new Date().toISOString(), detalle: `${autor}: ${texto}` }] }
}

export const TIPO_EVENTO: Record<string, string> = {
  'tramite.iniciado': 'Trámite iniciado',
  'tramite.paso_completado': 'Paso completado',
  'tramite.paso_regresado': 'Regresó un paso',
  'tramite.dato_editado': 'Editó un dato',
  'tramite.retomado': 'Retomó el trámite',
  'pago.referencia_generada': 'Referencia de pago generada',
  'pago.referencia_enviada': 'Referencia enviada por WhatsApp',
  'pago.metodo_cambiado': 'Cambió el método de pago',
  'pago.iniciado': 'Inició el pago',
  'pago.datos_transferencia': 'Datos de transferencia generados',
  'pago.verificacion_solicitada': 'Verificación del banco solicitada',
  'pago.rechazado': 'Pago rechazado',
  'pago.aprobado': 'Pago aprobado',
  'canal.mensaje_recibido': 'Mensaje recibido',
  'asesor.clinica_confirmada': 'Clínica confirmada',
  'asesor.reagendado': 'Cita reagendada',
  'cita.confirmada': 'Cita confirmada',
  'cita.comprobante_descargado': 'Comprobante descargado',
  'llamada.atendida': 'Llamada atendida',
  'llamada.terminada': 'Llamada terminada',
  'nota.interna': 'Nota interna',
}

/** "10:42" si es de hoy; "24 nov, 10:42" si no. */
export function horaEvento(iso: string): string {
  const d = new Date(iso)
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toDateString() === new Date().toDateString() ? hora : `${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '')}, ${hora}`
}

/* ---------- fechas: nunca en el pasado ---------- */
export const isoDia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const hoyISO = () => isoDia(new Date())
/** ¿La fecha (y hora, si se da) ya pasó respecto a este momento? */
export function yaPaso(fecha: string, hora?: string | null): boolean {
  const [y, m, d] = fecha.split('-').map(Number)
  const [hh, mm] = (hora ?? '23:59').split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm).getTime() <= Date.now()
}
