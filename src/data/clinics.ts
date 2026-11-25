/* Clínicas de Salud Digna: datos reales en clinicasData.ts (generado desde salud-digna.org). Aquí, búsqueda y distancias. */
import { CLINICAS_DATOS, type ClinicaDato } from './clinicasData'

export type Clinic = ClinicaDato
export const CLINICS: Clinic[] = CLINICAS_DATOS

export type Punto = { lat: number; lng: number }
/** Ubicación de ejemplo cuando el navegador no comparte la real: centro de Culiacán. */
export const UBICACION_DEMO: Punto & { nombre: string } = { lat: 24.8041, lng: -107.3932, nombre: 'Culiacán, Sinaloa' }

export const tel = (p: string) => 'tel:+52' + p.replace(/\D/g, '')
export const findClinic = (name: string | null) => CLINICS.find((c) => c.name === name) ?? null
export const CLINICA_INICIAL = findClinic('Culiacán') ?? CLINICS[0]

/** Distancia en línea recta (km) entre dos puntos. */
export function distanciaKm(a: Punto, b: Punto): number {
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const porNombre = (a: string, b: string) => a.localeCompare(b, 'es')

export const ESTADOS = Array.from(new Set(CLINICS.map((c) => c.estado))).sort(porNombre)
export const ciudadesDe = (estado: string) =>
  Array.from(new Set(CLINICS.filter((c) => !estado || c.estado === estado).map((c) => c.ciudad))).sort(porNombre)

/** Buscador por estado, ciudad y sucursal (nombre, colonia o dirección), sin acentos ni mayúsculas.
    Con ubicación: de la más cercana a la más lejana. Sin ubicación: por estado, ciudad y nombre. */
export function buscarClinicas({ estado = '', ciudad = '', q = '', desde }: { estado?: string; ciudad?: string; q?: string; desde?: Punto | null } = {}) {
  const t = norm(q)
  const lista = CLINICS.filter((c) => (!estado || c.estado === estado) && (!ciudad || c.ciudad === ciudad) &&
    (!t || norm(`${c.name} ${c.address} ${c.ciudad} ${c.estado}`).includes(t)))
  if (desde) return lista.map((c) => ({ c, km: distanciaKm(desde, c) })).sort((a, b) => a.km - b.km)
  return lista.sort((a, b) => porNombre(a.estado, b.estado) || porNombre(a.ciudad, b.ciudad) || porNombre(a.name, b.name)).map((c) => ({ c, km: undefined as number | undefined }))
}
