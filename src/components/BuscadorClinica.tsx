import { useState, type RefObject } from 'react'
import { ESTADOS, UBICACION_DEMO, buscarClinicas, ciudadesDe, type Punto } from '../data/clinics'
import { Icon } from './Icon'
import { outlineBtn } from './ui'

/* Buscador de clínicas por estado, ciudad y sucursal, con "Usar mi ubicación".
   Lo usan el paso 2 del agendado y el panel de clínicas (también el del asesor).
   Sin paginar: con un filtro activo se muestran TODAS las coincidencias y solo ellas. */

type Ubicacion = Punto & { fuente: 'real' | 'demo' }
/** "Cerca de ti": clínicas a esta distancia o menos (en línea recta). */
export const RADIO_KM = 30
const MINIMO_CERCA = 5

export function useBuscadorClinica() {
  const [estado, setEstadoRaw] = useState('')
  const [ciudad, setCiudad] = useState('')
  const [q, setQ] = useState('')
  const [ubicacion, setUbicacion] = useState<Ubicacion | null>(null)
  const [buscando, setBuscando] = useState(false)

  const setEstado = (e: string) => { setEstadoRaw(e); setCiudad('') } // al cambiar de estado, la ciudad se reinicia
  const limpiar = () => { setEstadoRaw(''); setCiudad(''); setQ(''); setUbicacion(null) }

  /** Pide la ubicación al navegador; si no la comparte (o tarda), usa una ubicación de ejemplo. */
  const usarUbicacion = () => {
    setBuscando(true)
    const demo = () => { setUbicacion({ lat: UBICACION_DEMO.lat, lng: UBICACION_DEMO.lng, fuente: 'demo' }); setBuscando(false) }
    setEstadoRaw(''); setCiudad(''); setQ('')
    if (!('geolocation' in navigator)) return demo()
    navigator.geolocation.getCurrentPosition(
      (p) => { setUbicacion({ lat: p.coords.latitude, lng: p.coords.longitude, fuente: 'real' }); setBuscando(false) },
      demo,
      { timeout: 8000, maximumAge: 300000 },
    )
  }

  const ordenadas = buscarClinicas({ estado, ciudad, q, desde: ubicacion })
  // con ubicación (y sin otros filtros): solo las cercanas, a RADIO_KM o menos; si no hay tantas, las más cercanas
  const soloCerca = !!ubicacion && !estado && !ciudad && !q
  const enRadio = soloCerca ? ordenadas.filter((r) => (r.km ?? Infinity) <= RADIO_KM) : ordenadas
  const pocas = soloCerca && enRadio.length < MINIMO_CERCA
  const todos = soloCerca ? (pocas ? ordenadas.slice(0, MINIMO_CERCA) : enRadio) : ordenadas
  const activo = !!(estado || ciudad || q || ubicacion)
  return {
    estado, setEstado, ciudad, setCiudad, q, setQ,
    ubicacion, buscando, usarUbicacion, limpiar, activo,
    total: todos.length,
    /** con ubicación: true si se muestran solo las cercanas; `pocas` si no hubo ninguna a RADIO_KM y se muestran las más cercanas */
    soloCerca, pocas,
    /** todas las coincidencias (sin paginar) para el mapa; sin filtros, el directorio completo */
    enMapa: todos,
    resultados: activo ? todos : [],
  }
}
export type Buscador = ReturnType<typeof useBuscadorClinica>

const select = 'h-12 w-full appearance-none rounded-lg border border-borde bg-superficie pl-4 pr-10 text-base text-titulo transition-colors hover:border-borde-accion'

/** `compacto`: para espacios angostos (panel lateral): estado y ciudad en dos columnas, sucursal a todo el ancho,
    sin importar el ancho de la pantalla. */
export function FiltrosClinica({ b, id, inputRef, compacto = false }: { b: Buscador; id: string; inputRef?: RefObject<HTMLInputElement | null>; compacto?: boolean }) {
  const ciudades = ciudadesDe(b.estado)
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <button onClick={b.usarUbicacion} disabled={b.buscando} aria-pressed={!!b.ubicacion}
          className={`${outlineBtn} disabled:cursor-wait ${b.ubicacion ? 'bg-resaltado' : ''}`}>
          <Icon n="target" />{b.buscando ? 'Buscando tu ubicación…' : b.ubicacion ? 'Clínicas cerca de ti' : 'Usar mi ubicación'}
        </button>
        <p className="t-meta text-secundario">o busca por estado, ciudad o sucursal</p>
      </div>
      <div className={`mt-4 grid gap-3 ${compacto ? 'grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
        <div>
          <label htmlFor={`${id}-estado`} className="text-base font-semibold text-titulo">Estado</label>
          <div className="relative mt-2">
            <select id={`${id}-estado`} value={b.estado} onChange={(e) => b.setEstado(e.target.value)} className={select}>
              <option value="">Todos los estados</option>
              {ESTADOS.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <Icon n="left" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 -rotate-90 text-secundario" />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-ciudad`} className="text-base font-semibold text-titulo">Ciudad</label>
          <div className="relative mt-2">
            <select id={`${id}-ciudad`} value={b.ciudad} onChange={(e) => b.setCiudad(e.target.value)} className={select}>
              <option value="">{b.estado ? `Todas las ciudades de ${b.estado}` : 'Todas las ciudades'}</option>
              {ciudades.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Icon n="left" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 -rotate-90 text-secundario" />
          </div>
        </div>
        <div className={compacto ? 'col-span-2' : 'sm:col-span-2 lg:col-span-1'}>
          <label htmlFor={`${id}-q`} className="text-base font-semibold text-titulo">Sucursal</label>
          <div className="relative mt-2">
            <Icon n="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-secundario" />
            <input ref={inputRef} id={`${id}-q`} value={b.q} onChange={(e) => b.setQ(e.target.value)} placeholder="Nombre, colonia o calle"
              className="h-12 w-full rounded-lg border border-borde bg-superficie pl-12 pr-3 text-base text-titulo transition-colors hover:border-borde-accion" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4">
        <p role="status" className="t-meta text-secundario">
          {!b.activo ? `${b.total} clínicas en ${ESTADOS.length} estados. Usa tu ubicación o elige un estado para ver la lista.`
            : b.soloCerca
              ? `${b.pocas ? `No hay clínicas a menos de ${RADIO_KM} km; te mostramos las ${b.total} más cercanas` : `${b.total === 1 ? '1 clínica' : `${b.total} clínicas`} a menos de ${RADIO_KM} km`}${b.ubicacion?.fuente === 'demo' ? ` de ${UBICACION_DEMO.nombre} (ubicación de ejemplo: el navegador no compartió la tuya)` : ' de ti'}, de la más cercana a la más lejana.`
              : `${b.total === 1 ? '1 clínica encontrada' : `${b.total} clínicas encontradas`}${b.ubicacion ? ', de la más cercana a la más lejana' : ''}`}
        </p>
        {b.activo && <button onClick={b.limpiar} className="inline-flex min-h-12 items-center rounded-md px-1 t-meta font-semibold text-enlace underline underline-offset-4 hover:text-enlace-hover">Limpiar filtros</button>}
      </div>
    </div>
  )
}

export const fmtKm = (km: number) => `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString('es-MX')} km`
