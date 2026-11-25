import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Clinic, Punto } from '../data/clinics'

/* Mapa de las clínicas del buscador (OpenStreetMap + Leaflet). Es complementario a la lista:
   tocar un punto elige la clínica, y la clínica elegida se resalta y se centra. */

const AZUL = '#0074D9'
const AZUL_OSCURO = '#004480'
const MEXICO: L.LatLngBoundsExpression = [[14.5, -117.5], [32.8, -86.5]]


export function MapaClinicas({ clinicas, elegida, ubicacion, onElegir, alto = 'h-72 lg:h-96' }: {
  clinicas: Clinic[]
  elegida: string | null
  ubicacion?: (Punto & { fuente: 'real' | 'demo' }) | null
  onElegir: (c: Clinic) => void
  alto?: string
}) {
  const div = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const capa = useRef<L.LayerGroup | null>(null)
  const marcas = useRef(new Map<string, L.CircleMarker>())
  // último encuadre: se repite si el mapa estaba oculto (ancho 0) y vuelve a mostrarse (p. ej. pestaña Lista/Mapa)
  const encuadre = useRef<(() => void) | null>(null)
  const elegirRef = useRef(onElegir)
  elegirRef.current = onElegir

  // crear el mapa una sola vez
  useEffect(() => {
    if (!div.current || mapa.current) return
    // sin animación de zoom: si el mapa se desmonta a mitad de una animación, Leaflet falla (_leaflet_pos)
    const m = L.map(div.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomAnimation: false, markerZoomAnimation: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m)
    m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>')
    m.fitBounds(MEXICO)
    capa.current = L.layerGroup().addTo(m)
    mapa.current = m
    // rueda del ratón: hace zoom solo después de hacer clic en el mapa (o enfocarlo con el teclado) y se apaga al
    // salir del mapa; así la rueda no queda "atrapada" al desplazar la página o la lista
    const activarRueda = () => m.scrollWheelZoom.enable()
    const apagarRueda = () => m.scrollWheelZoom.disable()
    m.on('click focus', activarRueda)
    m.on('blur', apagarRueda)
    const contenedor = div.current
    contenedor.addEventListener('mouseleave', apagarRueda)
    // el contenedor puede cambiar de tamaño (panel lateral, rotación del teléfono)
    let oculto = div.current.clientWidth === 0
    const ro = new ResizeObserver(() => {
      const ahora = !div.current || div.current.clientWidth === 0
      m.invalidateSize()
      if (oculto && !ahora) encuadre.current?.()
      oculto = ahora
    })
    ro.observe(div.current)
    return () => { ro.disconnect(); contenedor.removeEventListener('mouseleave', apagarRueda); m.stop(); m.off(); m.remove(); mapa.current = null; capa.current = null }
  }, [])

  // dibujar puntos y encuadrar cada vez que cambian los resultados
  const claveLista = clinicas.map((c) => c.id).join(',')
  useEffect(() => {
    const m = mapa.current
    const g = capa.current
    if (!m || !g) return
    g.clearLayers()
    marcas.current.clear()
    const puntos: L.LatLngExpression[] = []
    for (const c of clinicas) {
      const sel = c.name === elegida
      const mk = L.circleMarker([c.lat, c.lng], {
        radius: sel ? 11 : 7, weight: sel ? 3 : 2, color: '#FFFFFF', fillColor: sel ? AZUL_OSCURO : AZUL, fillOpacity: 1,
      })
      mk.bindTooltip(c.name, { direction: 'top', offset: [0, -6] })
      mk.on('click', () => elegirRef.current(c))
      mk.addTo(g)
      marcas.current.set(c.name, mk)
      if (sel) mk.bringToFront()
      puntos.push([c.lat, c.lng])
    }
    if (ubicacion) {
      L.circleMarker([ubicacion.lat, ubicacion.lng], { radius: 8, weight: 3, color: AZUL_OSCURO, fillColor: '#FFFFFF', fillOpacity: 1 })
        .bindTooltip(ubicacion.fuente === 'real' ? 'Tu ubicación' : 'Ubicación de ejemplo', { permanent: false })
        .addTo(g)
    }
    // con ubicación: encuadra tú + las 5 más cercanas; si no, todas las coincidencias
    const foco: L.LatLngExpression[] = ubicacion ? [[ubicacion.lat, ubicacion.lng], ...puntos.slice(0, 5)] : puntos
    encuadre.current = () => {
      if (foco.length === 1) m.setView(foco[0], 14, { animate: false })
      else if (foco.length) m.fitBounds(L.latLngBounds(foco), { padding: [24, 24], maxZoom: 14, animate: false })
      else m.fitBounds(MEXICO, { animate: false })
    }
    encuadre.current()
  }, [claveLista, ubicacion?.lat, ubicacion?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  // resaltar y centrar la clínica elegida sin volver a encuadrar todo
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    marcas.current.forEach((l, nombre) => {
      const sel = nombre === elegida
      l.setStyle({ fillColor: sel ? AZUL_OSCURO : AZUL, weight: sel ? 3 : 2 })
      l.setRadius(sel ? 11 : 7)
      if (sel) { l.bringToFront(); if (!m.getBounds().contains(l.getLatLng())) m.panTo(l.getLatLng(), { animate: false }) }
    })
  }, [elegida])

  const sel = clinicas.find((c) => c.name === elegida)
  return (
    <figure className="m-0">
      <div ref={div} role="region" aria-label={`Mapa con ${clinicas.length} clínicas. También puedes elegir en la lista.`}
        className={`isolate z-0 w-full overflow-hidden rounded-lg border border-borde bg-banda ${alto}`} />
      <figcaption className="mt-1 t-meta text-secundario">
        Toca un punto para elegir la clínica. {clinicas.length === 1 ? '1 clínica en el mapa.' : `${clinicas.length} clínicas en el mapa.`}{' '}
        Para acercar: botones + y −, pellizco en el teléfono, o haz clic en el mapa y usa la rueda del ratón.
      </figcaption>
      <p role="status" className="mt-1 t-body text-titulo empty:hidden">
        {sel && <><span className="font-semibold">Elegiste:</span> {sel.name} · {sel.ciudad}, {sel.estado}</>}
      </p>
    </figure>
  )
}
