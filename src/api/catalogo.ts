/* Puente entre los catálogos del portal y los del orquestador.
 *
 * El portal nombra las cosas por su NOMBRE (data/studies.ts, data/clinicasData.ts con las 261
 * sucursales reales). El orquestador las identifica por UUID. Aquí se emparejan por nombre
 * normalizado, con memoria para no volver a pedir el catálogo en cada paso.
 *
 * Si algo no empareja NO se inventa un id: se devuelve null y quien llama avisa. Es el síntoma de
 * que el catálogo de la base (core.clinicas / core.estudios) no trae lo mismo que el portal; la
 * solución de fondo es generar el seed de la base desde data/clinicasData.ts.
 */
import { catalogoEstudios, clinicasParaEstudio, type Cliente, type Clinica, type Estudio } from './api'
import { emparejarEstudio, normalizar } from './mapa'
import { CLINICAS_DATOS } from '../data/clinicasData'

let estudios: Estudio[] | null = null
const clinicasPorEstudio = new Map<string, Clinica[]>()

/** Catálogo de estudios del orquestador (se pide una vez por sesión). */
export async function listaEstudios(c: Cliente): Promise<Estudio[]> {
  if (!estudios) estudios = await catalogoEstudios(c)
  return estudios
}

/** uuid del estudio cuyo nombre usa el portal. null si el catálogo de la base no lo tiene. */
export async function idEstudio(c: Cliente, nombre: string): Promise<string | null> {
  return emparejarEstudio(await listaEstudios(c), nombre)?.id ?? null
}

/**
 * Clínicas que la base ofrece para ese estudio (con memoria por estudio y lugar).
 * La base devuelve máximo 50 por consulta y el portal tiene 261: sin filtro solo se vería una parte.
 * Con `ciudad` y `estado` cada consulta trae pocas (en los datos reales, hasta 8 por ciudad).
 */
export async function listaClinicas(c: Cliente, estudioId: string, ciudad?: string, estado?: string): Promise<Clinica[]> {
  const clave = `${estudioId}|${ciudad ?? ''}|${estado ?? ''}`
  const previo = clinicasPorEstudio.get(clave)
  if (previo) return previo
  const lista = await clinicasParaEstudio(c, estudioId, ciudad, estado)
  clinicasPorEstudio.set(clave, lista)
  return lista
}

/**
 * uuid de la clínica cuyo nombre usa el portal.
 * El portal guarda nombres como "Culiacán Centro" y la base puede traer "Clínica Culiacán Centro":
 * se compara normalizado y, si no, por contenido en cualquiera de los dos sentidos.
 */
export async function idClinica(c: Cliente, estudioId: string, nombre: string): Promise<string | null> {
  const n = normalizar(nombre)
  // la ciudad y el estado salen del directorio del portal; si el nombre no está ahí, se pide sin filtro
  const sucursal = CLINICAS_DATOS.find((x) => normalizar(x.name) === n)
  const lista = await listaClinicas(c, estudioId, sucursal?.ciudad || undefined, sucursal?.estado || undefined)
  const exacto = lista.find((x) => normalizar(x.nombre) === n)
  if (exacto) return exacto.id
  const parcial = lista.find((x) => normalizar(x.nombre).includes(n) || n.includes(normalizar(x.nombre)))
  return parcial?.id ?? null
}

/** Olvida los catálogos (tras "Reiniciar demo" o un cambio de catálogo en la base). */
export function olvidarCatalogos() {
  estudios = null
  clinicasPorEstudio.clear()
}
