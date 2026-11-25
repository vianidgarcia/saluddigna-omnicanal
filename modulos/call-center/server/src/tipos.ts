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
  requiere_registro?: ('nombre' | 'apellido_paterno' | 'celular_verificado')[]
}

export interface Paciente {
  id: string
  estado?: string
  nombre?: string | null
  nombre_mostrar?: string | null
  telefono?: string | null
  tiene_fecha_nacimiento: boolean
  avisos_whatsapp?: boolean
}

export interface Tramite {
  id: string
  folio: string
  etiqueta: string
  tipo: string
  estado: string
  paso_actual: Paso
  paso_descripcion?: string
  siguiente_paso?: string | null
  version: number
  contexto: {
    estudio_id?: string
    clinica_id?: string
    beneficiario_id?: string
    cita_id?: string
    fecha_hora?: string
    precio?: number
    pago_id?: string
  }
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
  en_atencion?: boolean
  atencion_hasta?: string | null
  en_atencion_de_otro?: boolean
  atendido_por_mi?: boolean
}

export interface TramiteAbierto {
  id: string
  folio: string
  etiqueta?: string
  paso_actual: Paso
  paso_descripcion?: string
  ultimo_canal?: Canal
  ultima_actividad_en?: string
  beneficiario?: { id: string; nombre: string | null; relacion: Relacion }
  en_atencion_de_otro?: boolean
  atendido_por_mi?: boolean
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

export interface Mensaje {
  creado_en: string
  canal: string
  autor: string
  contenido: string
}

export interface CitaProxima {
  id: string
  fecha_hora: string
  estado: string
  turno?: string | null
  area?: string | null
  llegada_en?: string | null
  estudio: string
  clinica: string
  precio: number
  folio?: string
  beneficiario: { id: string; nombre: string | null; relacion: Relacion }
}

export interface PagoPendiente {
  id: string
  monto: number
  link_pago: string
  expira_en: string
  folio?: string
}

export interface Contexto {
  sesion: Sesion
  paciente: Paciente
  tramite_activo: Tramite | null
  tramites_abiertos: TramiteAbierto[]
  linea_tiempo?: Evento[]
  mensajes_recientes?: Mensaje[]
  citas_proximas?: CitaProxima[]
  pagos_pendientes?: PagoPendiente[]
}

export type EtapaLlamada =
  | 'conectando'
  | 'ia_pidiendo_telefono'
  | 'ia_esperando_otp'
  | 'ia_confirmando_motivo'
  | 'transfiriendo_asesor'
  | 'en_llamada_asesor'
  | 'finalizada'

export interface TurnoDialogo {
  autor: 'ia' | 'paciente' | 'sistema'
  texto: string
  en: string
}

export interface BriefRecepcion {
  motivo: 'continuar_tramite' | 'informacion' | 'nueva_cita' | 'otro'
  resumenIa: string
  tramiteFolioSugerido?: string | null
  tramiteIdSugerido?: string | null
  verificadoPor: 'otp' | 'sesion_web_y_otp' | 'sin_verificar'
  telefonoNormalizado: string
  telefonoEnmascarado: string
}

/** Lo que el paciente llevaba en el portal y aún no está en la base. Lo declara él: sin verificar. */
export interface Borrador { nombre?: string | null; estudio?: string | null; clinica?: string | null; fecha?: string | null; hora?: string | null; paso?: string | null }

export interface PayloadScreenPop {
  borrador?: Borrador | null
  callId: string
  creadaEn: string
  interaccionAsesorId: string | null
  interaccionIaId: string | null
  /** null: identidad sin confirmar por OTP */
  contexto: Contexto | null
  brief: BriefRecepcion
  transcripcionIa: TurnoDialogo[]
  requiereRevalidarEnAsesor: boolean
}

// Mensajes WebSocket: Cliente -> Servidor
export type MensajeWsCliente =
  | {
      tipo: 'call:start'
      telefonoSugerido?: string
      jwtSupabase?: string
      nombreSugerido?: string
      /** Marcó directo al asesor: no pasa por la contestadora */
      directo?: boolean
      borrador?: Borrador | null
    }
  | { tipo: 'call:speech'; callId: string; texto: string; origen?: 'voz' | 'texto' | 'dtmf' }
  | { tipo: 'call:hangup'; callId: string }
  /** El paciente escribe su código durante la llamada: se valida en la interacción del asesor */
  | { tipo: 'call:otp'; callId: string; codigo: string }
  | { tipo: 'advisor:online'; jwtAsesor: string; nombre?: string }
  | { tipo: 'advisor:offline' }
  | { tipo: 'advisor:answer'; callId: string }
  | { tipo: 'advisor:reject'; callId: string; motivo?: string }
  | { tipo: 'advisor:hangup'; callId: string }
  | { tipo: 'chat:send'; callId: string; texto: string }
  | { tipo: 'webrtc:signal'; callId: string; hacia: 'cliente' | 'asesor'; signal: unknown }

// Mensajes WebSocket: Servidor -> Cliente / Asesor
export type MensajeWsServidor =
  | {
      tipo: 'call:started'
      callId: string
      etapa: EtapaLlamada
      telefono?: string
      asesoresEnLinea: number
    }
  | {
      tipo: 'call:state'
      callId: string
      etapa: EtapaLlamada
      contextoResumen?: {
        nivel: Nivel
        nombre?: string | null
        tramitesCount: number
        citasCount: number
      }
      otpEnviadoA?: string
    }
  | {
      tipo: 'ia:utterance'
      callId: string
      texto: string
      audioBase64?: string | null
      audioMime?: string | null
      esperaRespuesta: 'telefono' | 'otp' | 'motivo' | 'ninguna'
    }
  | {
      tipo: 'call:transferring'
      callId: string
      resumenIa: string
      asesoresEnLinea: number
    }
  | {
      tipo: 'call:connected'
      callId: string
      asesorNombre: string
      interaccionAsesorId: string | null
    }
  | { tipo: 'call:ended'; callId: string; motivo: string }
  | { tipo: 'call:otp_request'; callId: string; enviadoA: string }
  | { tipo: 'call:otp_result'; callId: string; ok: boolean; message: string }
  | { tipo: 'advisor:verified'; callId: string }
  | { tipo: 'advisor:registered'; email: string; rol: string; enCola: number }
  | { tipo: 'advisor:ringing'; pop: PayloadScreenPop }
  | { tipo: 'advisor:answered'; pop: PayloadScreenPop }
  | { tipo: 'chat:message'; callId: string; desde: 'cliente' | 'asesor'; texto: string }
  | { tipo: 'advisor:call_taken'; callId: string; porOtro: boolean }
  | { tipo: 'advisor:call_ended'; callId: string; motivo: string }
  | { tipo: 'webrtc:signal'; callId: string; desde: 'cliente' | 'asesor'; signal: unknown }
  | { tipo: 'error'; code: string; message: string }
