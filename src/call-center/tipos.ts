/* Protocolo entre el portal y el servidor del call center (modulos/call-center/server/src/tipos.ts).
   Mantener los dos iguales. El modo local usa los mismos mensajes, sin servidor. */
import type { Contexto } from '../api/api'

export type Etapa = 'conectando' | 'ia_pidiendo_telefono' | 'ia_esperando_otp' | 'ia_confirmando_motivo'
  | 'transfiriendo_asesor' | 'en_llamada_asesor' | 'finalizada'
export type Espera = 'telefono' | 'otp' | 'motivo' | 'ninguna'
export type Turno = { autor: 'ia' | 'paciente' | 'sistema'; texto: string; en: string }

/** Lo que el paciente llevaba en el portal y aún no está en la base. Lo declara él: sin verificar. */
export type Borrador = { nombre?: string | null; estudio?: string | null; clinica?: string | null; fecha?: string | null; hora?: string | null; paso?: string | null }

export type Entrante = {
  borrador?: Borrador | null
  callId: string
  creadaEn: string
  interaccionAsesorId: string | null
  interaccionIaId: string | null
  contexto: Contexto | null
  brief: {
    motivo: 'continuar_tramite' | 'informacion' | 'nueva_cita' | 'otro'
    resumenIa: string
    tramiteFolioSugerido?: string | null
    tramiteIdSugerido?: string | null
    verificadoPor: 'otp' | 'sesion_web_y_otp' | 'sin_verificar'
    telefonoNormalizado: string
    telefonoEnmascarado: string
  }
  transcripcionIa: Turno[]
  requiereRevalidarEnAsesor: boolean
}

export type MensajeCliente =
  | { tipo: 'call:start'; telefonoSugerido?: string; jwtSupabase?: string; directo?: boolean; borrador?: Borrador | null }
  | { tipo: 'call:otp'; callId: string; codigo: string }
  | { tipo: 'call:speech'; callId: string; texto: string }
  | { tipo: 'call:hangup'; callId: string }
  | { tipo: 'advisor:online'; jwtAsesor: string }
  | { tipo: 'advisor:offline' }
  | { tipo: 'advisor:answer' | 'advisor:reject' | 'advisor:hangup'; callId: string }
  | { tipo: 'chat:send'; callId: string; texto: string }
  | { tipo: 'webrtc:signal'; callId: string; hacia: 'cliente' | 'asesor'; signal: unknown }

export type MensajeServidor =
  | { tipo: 'call:started'; callId: string; etapa: Etapa; asesoresEnLinea: number }
  | { tipo: 'call:state'; callId: string; etapa: Etapa; otpEnviadoA?: string }
  | { tipo: 'ia:utterance'; callId: string; texto: string; audioBase64?: string | null; audioMime?: string | null; esperaRespuesta: Espera }
  | { tipo: 'call:transferring'; callId: string; resumenIa: string; asesoresEnLinea: number }
  | { tipo: 'call:connected'; callId: string; asesorNombre: string }
  | { tipo: 'call:ended'; callId: string; motivo: string }
  | { tipo: 'call:otp_request'; callId: string; enviadoA: string }
  | { tipo: 'call:otp_result'; callId: string; ok: boolean; message: string }
  | { tipo: 'advisor:verified'; callId: string }
  | { tipo: 'advisor:registered'; email: string; rol: string; enCola: number }
  | { tipo: 'advisor:ringing'; pop: Entrante }
  | { tipo: 'advisor:answered'; pop: Entrante }
  | { tipo: 'advisor:call_taken'; callId: string; porOtro: boolean }
  | { tipo: 'advisor:call_ended'; callId: string; motivo: string }
  | { tipo: 'chat:message'; callId: string; desde: 'cliente' | 'asesor'; texto: string }
  | { tipo: 'webrtc:signal'; callId: string; desde: 'cliente' | 'asesor'; signal: unknown }
  | { tipo: 'error'; code: string; message: string }

export type Linea = { autor: 'sofia' | 'paciente' | 'asesor' | 'sistema'; texto: string }

/** Motivos de fin en palabras para una persona. */
export const MOTIVO_FIN: Record<string, string> = {
  cliente_colgo: 'El paciente terminó la llamada.',
  asesor_colgo: 'El asesor terminó la llamada.',
  asesor_desconectado: 'Se perdió la conexión con el asesor.',
  conexion_perdida: 'Se perdió la conexión.',
  inactividad: 'La llamada terminó por inactividad.',
  error: 'No se pudo iniciar la llamada.',
}
