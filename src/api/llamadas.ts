/* Operaciones del asesor durante una llamada, con SU sesión (clientePersonal). Arrastra Supabase: solo la
   importa call-center/FichaLlamada, que se carga de forma diferida. */
import {
  agregarBeneficiario, avanzarTramite, ErrorApi, generarPago, guardarDatosPaciente, horariosDisponibles, iniciarTramite,
  leerBandeja, misBeneficiarios, obtenerContexto, pagarSimulado, referenciaDeLink, reservarCita, retomarTramite, suscribirPaciente, validarOtp, verificarIdentidad,
  type Beneficiario, type Contexto, type Horario, type MensajeBandeja, type Paso, type Relacion, type Tramite,
} from './api'
import { directorioCompleto, idClinica, idEstudio, listaEstudios } from './catalogo'
import { enviarCodigo } from './codigo'
import { cliente, clientePersonal } from './cliente'
import { fechaHoraDeHorarios, partirNombre } from './mapa'

function c() {
  const x = clientePersonal()
  if (!x) throw new Error('El portal está en modo local.')
  return x
}

export const mensajeDe = (e: unknown) => (e instanceof ErrorApi ? e.aviso : e instanceof Error ? e.message : 'No se pudo completar.')

export async function contexto(i: string): Promise<Contexto> {
  await directorioCompleto(c()).catch(() => {}) // zonas horarias de las clínicas
  return obtenerContexto(c(), i)
}
export const pedirOtp = (i: string) => enviarCodigo(c(), i)
export const confirmarOtp = (i: string, codigo: string) => validarOtp(c(), i, codigo)
export const verificarFecha = (i: string, fecha: string) => verificarIdentidad(c(), i, fecha)
export const guardarNombre = (i: string, completo: string): Promise<Contexto> => guardarDatosPaciente(c(), i, partirNombre(completo))
export const tomar = (i: string, tramite: string) => retomarTramite(c(), i, tramite)
export const estudios = () => listaEstudios(c())
export const pago = (i: string, t: Tramite) => conReintento(i, t, (x) => generarPago(c(), i, x))
export const escuchar = (pacienteId: string, fn: () => void) => suscribirPaciente(c(), pacienteId, fn)

/** Con conflicto de versión recarga y reintenta UNA vez, solo si sigue siendo el mismo trámite y paso. */
async function conReintento<T>(i: string, t: Tramite, fn: (t: Tramite) => Promise<T>): Promise<T> {
  try {
    return await fn(t)
  } catch (e) {
    if (!(e instanceof ErrorApi && e.code === 'PT409' && e.message === 'conflicto_de_version')) throw e
    const fresco = (await contexto(i)).tramite_activo
    if (fresco?.id !== t.id || fresco.paso_actual !== t.paso_actual) throw e
    return fn(fresco)
  }
}

/** Trámite nuevo; si esa persona ya tenía uno abierto de ese estudio, se retoma. */
export async function nuevo(i: string, estudioId: string, beneficiario?: string | null): Promise<void> {
  try {
    await iniciarTramite(c(), i, estudioId, beneficiario)
  } catch (e) {
    if (!(e instanceof ErrorApi && e.message === 'tramite_duplicado')) throw e
    const abierto = (await contexto(i)).tramites_abiertos.find((x) => x.folio === e.detalle.folio)
    if (!abierto) throw e
    await tomar(i, abierto.id)
  }
}

export async function elegirClinica(i: string, t: Tramite, nombre: string): Promise<void> {
  const estudio = t.estudio?.id ?? t.contexto.estudio_id
  const clinica = estudio ? await idClinica(c(), estudio, nombre) : null
  if (!clinica) throw new Error(`“${nombre}” no ofrece este estudio en el sistema.`)
  await conReintento(i, t, (x) => avanzarTramite(c(), i, x, 'seleccion_horario', { clinica_id: clinica }))
}

const masDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** La base entrega máximo 14 días y 100 horarios por consulta: se pide por tramos. */
export async function horarios(t: Tramite, desde: string, hasta: string): Promise<Horario[] | null> {
  const clinica = t.clinica?.id ?? t.contexto.clinica_id
  const estudio = t.estudio?.id ?? t.contexto.estudio_id
  if (!clinica || !estudio) return null
  const todos = new Map<string, Horario>()
  let cursor = desde
  while (cursor <= hasta) {
    const tope = masDias(cursor, 13)
    const fin = tope < hasta ? tope : hasta
    const dias = Math.round((Date.parse(fin) - Date.parse(cursor)) / 86_400_000) + 1
    const lote = await horariosDisponibles(c(), clinica, estudio, cursor, dias)
    for (const h of lote) todos.set(h.fecha_hora, h)
    const ultimo = lote.at(-1)?.fecha
    cursor = lote.length >= 100 && ultimo && ultimo > cursor ? ultimo : masDias(fin, 1)
  }
  return [...todos.values()]
}

export async function reservar(i: string, t: Tramite, lista: Horario[], fecha: string, hora: string): Promise<void> {
  const fh = fechaHoraDeHorarios(lista, fecha, hora)
  if (!fh) throw new Error('Ese horario ya no está disponible. Elige otro.')
  await conReintento(i, t, (x) => reservarCita(c(), i, x, fh))
}

/* ------------------------------------------------ corregir pasos y familia ---- */

/** Regresa el trámite a un paso anterior para cambiar lo elegido. */
export const regresar = (i: string, t: Tramite, paso: Paso) => conReintento(i, t, (x) => avanzarTramite(c(), i, x, paso))

export const elegirEstudio = (i: string, t: Tramite, estudio: string, beneficiario: string) =>
  conReintento(i, t, (x) => avanzarTramite(c(), i, x, 'seleccion_clinica', { estudio_id: estudio, beneficiario_id: beneficiario }))

export const familia = (i: string): Promise<Beneficiario[]> => misBeneficiarios(c(), i)

export async function agregarFamiliar(i: string, completo: string, nacimiento: string, relacion: Exclude<Relacion, 'titular'>): Promise<string> {
  const n = partirNombre(completo)
  return (await agregarBeneficiario(c(), i, { ...n, fecha_nacimiento: nacimiento, relacion, es_tutor_legal: relacion === 'hijo' || relacion === 'hija' })).beneficiario_id
}

/* ------------------------------------------------ lo que llevaba en el portal ---- */

/** Pasa a la base lo que el paciente llevaba en el portal. Dice hasta dónde se pudo. */
export async function continuarBorrador(i: string, b: { estudio?: string | null; clinica?: string | null; fecha?: string | null; hora?: string | null }): Promise<string> {
  const estudio = b.estudio ? await idEstudio(c(), b.estudio) : null
  if (!estudio) throw new Error(`“${b.estudio ?? 'Sin estudio'}” no está en el catálogo. Inicia el trámite eligiendo el estudio.`)
  await nuevo(i, estudio)
  let t = (await contexto(i)).tramite_activo
  if (!t || t.paso_actual !== 'seleccion_clinica' || !b.clinica) return 'Trámite abierto: continúa desde aquí'
  await elegirClinica(i, t, b.clinica)
  t = (await contexto(i)).tramite_activo
  if (!t || t.paso_actual !== 'seleccion_horario' || !b.fecha || !b.hora) return 'Trámite abierto con su estudio y clínica'
  const libres = (await horarios(t, b.fecha, b.fecha)) ?? []
  if (!fechaHoraDeHorarios(libres, b.fecha, b.hora)) return 'Trámite abierto; el horario que había elegido ya no está libre'
  await reservar(i, t, libres, b.fecha, b.hora)
  return 'Trámite abierto y horario reservado'
}

/* ------------------------------------------------ simulador (solo Supabase local) ---- */

export const pagoSimulado = (liga: string, telefono?: string) => pagarSimulado(c(), referenciaDeLink(liga), telefono)

/** Mensajes que "le llegan" al teléfono del paciente. */
export async function bandeja(telefono10: string, despues: number): Promise<MensajeBandeja[]> {
  const x = cliente()
  return x ? leerBandeja(x, '52' + telefono10.replace(/\D/g, '').slice(-10), despues) : []
}
