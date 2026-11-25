/* El enlace del portal con el orquestador omnicanal (repo hackathon-puebla).
 *
 * Idea: el trámite del PORTAL sigue siendo el que pinta la interfaz (src/state/tramite.ts), para no
 * reescribir las vistas. Este módulo lo espeja en la base: cada paso que el paciente termina se
 * manda al orquestador, y lo que llega del orquestador (WhatsApp, asesor, recepción) se fusiona de
 * vuelta. Así el folio, la cita y el pago son los MISMOS en todos los canales.
 *
 * Reglas que impone la base y que el portal no tenía:
 *   · Para iniciar un trámite hace falta nombre, apellido y CELULAR VERIFICADO por OTP.
 *     El portal pide esos datos hasta el paso 4, así que los pasos 1 a 3 se trabajan en local y el
 *     trámite se crea de golpe al confirmar (`crearTramiteCompleto`).
 *   · Cada escritura lleva la `version` del trámite; si otro canal lo movió primero, la base
 *     responde PT409 conflicto_de_version. Aquí se recarga y se reintenta UNA vez.
 *   · Mientras un asesor o recepción atiende el trámite, la base responde PT423 y no deja cambiarlo.
 *     Eso NO es un error del portal: se avisa al paciente y se deja ver, no cambiar.
 *
 * Nada de este archivo corre en modo local: ahí `cliente()` devuelve null.
 */
import {
  ErrorApi, agregarBeneficiario, asegurarSesionAnonima, avanzarTramite, cerrarInteraccion, confirmarOtpTelefono,
  generarPago, guardarDatosPaciente, horariosDisponibles, iniciarSesionPaciente, iniciarTramite,
  misBeneficiarios, nuevaSesionAnonima, registrarConsentimientoAvisos, obtenerContexto, pedirOtpTelefono, reservarCita, retomarTramite, suscribirPaciente,
  type Beneficiario, type Cliente, type Contexto, type Relacion, type EventoPaciente, type Horario, type ModoOtp, type Pago,
  type Tramite as TramiteApi,
} from './api'
import { cliente } from './cliente'
import { cancelarCita, pagarDemo, pagosPendientes, rangoHorarios, reprogramarCita, type Cita, type PagoPorPagar } from './citas'
import { canalPropio } from './modo'
import { directorioCompleto, idClinica, idEstudio, listaEstudios, olvidarCatalogos } from './catalogo'
import { aE164, emparejarEstudio, fechaHoraDeHorarios, partirNombre } from './mapa'

// se reexportan para que las vistas no tengan que saber en qué archivo viven
export { aE164, partirNombre }

/** Estado del enlace, en memoria: se rehace al recargar la página (la sesión sí persiste). */
type Enlace = {
  interaccion: string | null
  pacienteId: string | null
  /** Último trámite que devolvió la base: de aquí sale la `version` de cada escritura. */
  remoto: TramiteApi | null
  /** Horarios del último paso 3, para recuperar el `fecha_hora` exacto sin hacer cuentas de zona. */
  horarios: Horario[]
  /** Lo que le falta al titular para poder agendar (vacío = puede). */
  faltaRegistro: string[]
  verificado: boolean
}

const enlace: Enlace = { interaccion: null, pacienteId: null, remoto: null, horarios: [], faltaRegistro: [], verificado: false }

export const estadoEnlace = () => ({ ...enlace })
export const tramiteRemoto = () => enlace.remoto
export const pacienteId = () => enlace.pacienteId

function exigirCliente(): Cliente {
  const c = cliente()
  if (!c) throw new Error('El portal está en modo local: no hay orquestador al que llamar.')
  return c
}

function guardarContexto(ctx: Contexto): Contexto {
  enlace.interaccion = ctx.sesion.interaccion_id
  enlace.pacienteId = ctx.paciente.id
  enlace.faltaRegistro = ctx.sesion.requiere_registro ?? []
  enlace.verificado = ctx.sesion.nivel_verificacion === 'verificada'
  enlace.remoto = ctx.tramite_activo
  return ctx
}

function exigirInteraccion(): string {
  if (!enlace.interaccion) throw new Error('No hay sesión con el orquestador todavía: llama a arrancar() primero.')
  return enlace.interaccion
}

/* ------------------------------------------------------------------ sesión ---- */

/** Abre la sesión del paciente (anónima, sin cuenta) y devuelve su contexto unificado. */
export async function arrancar(): Promise<Contexto> {
  const c = exigirCliente()
  await asegurarSesionAnonima(c)
  // zonas horarias de las clínicas: las horas de la base vienen en UTC
  await directorioCompleto(c).catch(() => {})
  return guardarContexto(await iniciarSesionPaciente(c, canalPropio()))
}

/** "Reiniciar demo": otra persona anónima en el mismo navegador. */
export async function reiniciar(): Promise<Contexto> {
  const c = exigirCliente()
  olvidarCatalogos()
  enlace.remoto = null
  enlace.horarios = []
  await nuevaSesionAnonima(c)
  return guardarContexto(await iniciarSesionPaciente(c, canalPropio()))
}

/** Vuelve a leer el contexto: lo que cambió en otros canales. */
export async function sincronizar(): Promise<Contexto> {
  const c = exigirCliente()
  return guardarContexto(await obtenerContexto(c, exigirInteraccion()))
}

export async function cerrar(): Promise<void> {
  const c = cliente()
  if (!c || !enlace.interaccion) return
  try { await cerrarInteraccion(c, enlace.interaccion) } catch { /* la sesión expira sola */ }
}

/* ------------------------------------------------- verificación del celular ---- */

/** Paso 1 del OTP. Devuelve el modo, que hay que pasarle a `confirmarCodigo`. */
export async function pedirCodigo(telefono10: string): Promise<ModoOtp> {
  return pedirOtpTelefono(exigirCliente(), aE164(telefono10))
}

/** Paso 2 del OTP: confirma y recarga el contexto (ahora con nivel 'verificada'). */
export async function confirmarCodigo(telefono10: string, codigo: string, modo: ModoOtp): Promise<Contexto> {
  const c = exigirCliente()
  await confirmarOtpTelefono(c, aE164(telefono10), codigo, modo)
  return guardarContexto(await iniciarSesionPaciente(c, canalPropio()))
}

export async function guardarNombre(completo: string): Promise<Contexto> {
  const c = exigirCliente()
  return guardarContexto(await guardarDatosPaciente(c, exigirInteraccion(), partirNombre(completo)))
}

/* ------------------------------------------------------------- escrituras ---- */

/** Retoma el trámite abierto con ese folio (el que la base dijo que ya existía). */
async function retomarAbierto(c: Cliente, interaccion: string, folio: string | undefined, original: ErrorApi): Promise<TramiteApi> {
  const ctx = await obtenerContexto(c, interaccion)
  const abierto = ctx.tramites_abiertos?.find((x) => x.folio === folio)
  if (!abierto) throw original
  return retomarTramite(c, interaccion, abierto.id)
}

/** Reintenta UNA vez si otro canal movió el trámite primero (PT409 conflicto_de_version). */
async function conReintento<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ErrorApi && e.code === 'PT409' && e.message === 'conflicto_de_version') {
      await sincronizar()
      return fn()
    }
    throw e
  }
}

function exigirRemoto(): TramiteApi {
  if (!enlace.remoto) throw new Error('No hay trámite en el orquestador: hay que crearlo primero.')
  return enlace.remoto
}

/**
 * Crea el trámite en la base con lo que el paciente ya eligió en los pasos 1 a 3.
 * Devuelve el trámite remoto; `estudio` y `clinica` son los NOMBRES que usa el portal.
 */
export async function crearTramiteCompleto(datos: { estudio: string; clinica: string | null; beneficiario?: string | null }): Promise<TramiteApi> {
  const c = exigirCliente()
  const interaccion = exigirInteraccion()

  const estudioId = await idEstudio(c, datos.estudio)
  if (!estudioId) throw new Error(`El catálogo de la base no tiene el estudio “${datos.estudio}”. Hay que cargar el catálogo real (core.estudios).`)

  // el trámite nace ya con su estudio, en el paso "elegir clínica"
  let t: TramiteApi
  try {
    t = await iniciarTramite(c, interaccion, estudioId, datos.beneficiario)
  } catch (e) {
    if (!(e instanceof ErrorApi && e.code === 'PT409' && e.message === 'tramite_duplicado')) throw e
    // Ya hay uno abierto de este estudio (p. ej. un intento anterior que quedó a medias): se RETOMA y se
    // completa lo que le falte. Volver a pedir que se cree solo repite el error y el paciente no avanza.
    t = await retomarAbierto(c, interaccion, e.detalle.folio, e)
  }
  enlace.remoto = t

  // si ya tiene clínica se respeta la que eligió antes: "continúe ese"
  if (datos.clinica && !t.clinica) {
    const clinicaId = await idClinica(c, estudioId, datos.clinica)
    if (!clinicaId) throw new Error(`El catálogo de la base no tiene la clínica “${datos.clinica}”. Hay que generar el seed desde data/clinicasData.ts.`)
    t = await conReintento(() => avanzarTramite(c, interaccion, exigirRemoto(), 'seleccion_horario', { clinica_id: clinicaId }))
    enlace.remoto = t
  }
  return t
}

/** De los nombres de estudio del portal, los que la base tiene (el resto no se puede agendar en modo api). */
export async function estudiosOfrecidos(nombres: string[]): Promise<string[]> {
  const lista = await listaEstudios(exigirCliente())
  return nombres.filter((n) => emparejarEstudio(lista, n))
}

/** De qué clínica y estudio son los horarios guardados en `enlace.horarios` (clave "clinicaId|estudioId"). */
let horariosDe = ''

/** Guarda horarios para reservar: de la misma clínica y estudio se SUMAN; de otra, reemplazan. */
function recordarHorarios(clave: string, nuevos: Horario[]) {
  const previos = clave === horariosDe ? enlace.horarios : []
  const porHora = new Map(previos.map((h) => [h.fecha_hora, h]))
  for (const h of nuevos) porHora.set(h.fecha_hora, h)
  horariosDe = clave
  enlace.horarios = [...porHora.values()].sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora))
}

/** Horarios reales de la clínica (los del portal son de ejemplo). Guarda la lista para reservar. */
export async function horarios(clinicaNombre: string, estudioNombre: string, desde?: string, dias = 14): Promise<Horario[]> {
  const c = exigirCliente()
  const estudioId = await idEstudio(c, estudioNombre)
  if (!estudioId) return []
  const clinicaId = await idClinica(c, estudioId, clinicaNombre)
  if (!clinicaId) return []
  const lista = await horariosDisponibles(c, clinicaId, estudioId, desde, dias)
  recordarHorarios(`${clinicaId}|${estudioId}`, lista)
  return lista
}

/**
 * Horarios libres de 'desde' a 'hasta' (ambos 'AAAA-MM-DD', inclusive).
 * La base entrega máximo 14 días y 100 horarios por consulta: se pide por tramos y, si un tramo se
 * llena, se continúa desde el último día recibido. Lo recibido se recuerda para `reservar`.
 * `null` = la base no conoce esa clínica o ese estudio (distinto de "sin horarios libres").
 */
export async function horariosRango(clinicaNombre: string, estudioNombre: string, desde: string, hasta: string): Promise<Horario[] | null> {
  const c = exigirCliente()
  const estudioId = await idEstudio(c, estudioNombre)
  const clinicaId = estudioId ? await idClinica(c, estudioId, clinicaNombre) : null
  if (!estudioId || !clinicaId) return null
  const lista = await rangoHorarios(c, clinicaId, estudioId, desde, hasta)
  recordarHorarios(`${clinicaId}|${estudioId}`, lista)
  return lista
}

/** Reserva el horario que el paciente eligió en el portal (fecha 'AAAA-MM-DD' y hora 'HH:MM'). */
export async function reservar(fecha: string, hora: string): Promise<TramiteApi> {
  const c = exigirCliente()
  const fechaHora = fechaHoraDeHorarios(enlace.horarios, fecha, hora)
  if (!fechaHora) throw new Error('Ese horario ya no está en la lista de la clínica. Hay que volver a pedir los horarios.')
  const t = await conReintento(() => reservarCita(c, exigirInteraccion(), exigirRemoto(), fechaHora))
  enlace.remoto = t
  return t
}

/** Referencia y liga de pago que genera la base (reemplaza a la pasarela simulada del portal). */
export async function pago(): Promise<Pago> {
  const c = exigirCliente()
  const p = await conReintento(() => generarPago(c, exigirInteraccion(), exigirRemoto()))
  await sincronizar()
  return p
}

/* ------------------------------------------ citas, pagos y familia (docs/GUIA_APP_PWA.md) ---- */

export const porPagar = (): Promise<PagoPorPagar[]> => pagosPendientes(exigirCliente(), exigirInteraccion())

export async function pagar(referencia: string): Promise<Contexto> {
  await pagarDemo(exigirCliente(), exigirInteraccion(), referencia)
  return sincronizar()
}

export async function cancelar(cita: string, motivo: string): Promise<{ ctx: Contexto; reembolso: boolean }> {
  const r = await cancelarCita(exigirCliente(), exigirInteraccion(), cita, motivo)
  return { ctx: await sincronizar(), reembolso: r.reembolso }
}

/** Horarios para cambiar una cita: los ids ya vienen en ella. */
export async function horariosDeCita(cita: Cita, desde: string, hasta: string): Promise<Horario[] | null> {
  if (!cita.clinica_id || !cita.estudio_id) return null
  return rangoHorarios(exigirCliente(), cita.clinica_id, cita.estudio_id, desde, hasta)
}

export async function reprogramar(cita: string, fechaHora: string): Promise<Contexto> {
  await reprogramarCita(exigirCliente(), exigirInteraccion(), cita, fechaHora)
  return sincronizar()
}

/** La sesión sigue con uno de los trámites pendientes (pudo empezar en WhatsApp o por teléfono). */
export async function retomar(tramite: string): Promise<{ ctx: Contexto; tramite: TramiteApi }> {
  await retomarTramite(exigirCliente(), exigirInteraccion(), tramite)
  const ctx = await sincronizar()
  if (!ctx.tramite_activo) throw new Error('Ese trámite ya no está abierto.')
  return { ctx, tramite: ctx.tramite_activo }
}

/** Celular de la cuenta con la que está la sesión (10 dígitos), o null si es anónima. */
export async function telefonoDeSesion(): Promise<string | null> {
  const { data } = await exigirCliente().auth.getSession()
  return data.session?.user.phone?.slice(-10) || null
}

export const familia = (): Promise<Beneficiario[]> => misBeneficiarios(exigirCliente(), exigirInteraccion())

export async function agregarFamiliar(d: { nombre: string; nacimiento: string; relacion: Exclude<Relacion, 'titular'> }): Promise<string> {
  const r = await agregarBeneficiario(exigirCliente(), exigirInteraccion(), {
    ...partirNombre(d.nombre), fecha_nacimiento: d.nacimiento, relacion: d.relacion, es_tutor_legal: d.relacion === 'hijo' || d.relacion === 'hija',
  })
  return r.beneficiario_id
}

export const consentirAvisos = () => registrarConsentimientoAvisos(exigirCliente(), exigirInteraccion(), true)

/* -------------------------------------------------------------- tiempo real ---- */

/**
 * Escucha los cambios del paciente en TODOS los canales (Broadcast privado 'paciente:<id>').
 * Sustituye al evento `storage` entre pestañas: ahora un cambio hecho por WhatsApp o por el asesor
 * llega al portal sin recargar. Devuelve la función para dejar de escuchar.
 */
export async function escuchar(alLlegar: (e: EventoPaciente) => void): Promise<() => void> {
  const c = cliente()
  if (!c || !enlace.pacienteId) return () => {}
  return suscribirPaciente(c, enlace.pacienteId, alLlegar)
}
