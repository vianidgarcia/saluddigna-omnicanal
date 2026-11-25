import { useMemo, useState } from 'react'
import { useApp } from '../context'
import { categoriaDe, estudiosOfrecidos } from '../data/studies'
import { Icon } from './Icon'
import { WA, link, chip } from './ui'

export function Search() {
  const { startAgendar, estudiosDisponibles } = useApp()
  const catalogo = useMemo(() => estudiosOfrecidos(estudiosDisponibles), [estudiosDisponibles])
  const chips = Object.keys(catalogo)
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return null
    const c = chips.find((x) => x.toLowerCase() === t)
    if (c) return catalogo[c]
    return Object.values(catalogo).flat().filter((n) => n.toLowerCase().includes(t)).slice(0, 3)
  }, [q, catalogo]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section aria-labelledby="q-label" className="rounded-2xl bg-superficie p-6 lg:h-full lg:p-8">
      <label id="q-label" htmlFor="q" className="font-head t-card text-titulo">¿Qué estudio necesitas?</label>
      <div className="relative mt-4">
        <Icon n="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-secundario" />
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej. ultrasonido, mastografía" className="h-12 w-full rounded-lg border border-borde bg-superficie pl-12 pr-12 text-base text-titulo transition-colors hover:border-borde-accion" />
        {q && <button aria-label="Borrar búsqueda" onClick={() => setQ('')} className="absolute right-1 top-1/2 grid size-12 -translate-y-1/2 place-items-center rounded-md text-secundario hover:text-titulo"><Icon n="x" /></button>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Estudios frecuentes">
        {chips.map((c) => <button key={c} onClick={() => setQ(c)} aria-pressed={q === c} className={chip(q === c)}>{c}</button>)}
      </div>
      {results && (
        <div className="mt-6" aria-live="polite">
          {results.length ? (
            <>
              <p className="t-meta text-secundario">Resultados sugeridos</p>
              <ul className="mt-1">
                {results.map((n) => (
                  <li key={n} className="flex min-h-14 items-center justify-between gap-3 border-t border-borde py-2 first:border-t-0">
                    <div><p className="text-base font-semibold text-titulo">{n}</p><p className="t-meta text-secundario">Precio según tu clínica</p></div>
                    <button onClick={() => startAgendar({ categoria: categoriaDe(n), nombre: n })} className={`${link} shrink-0`}>Agendar cita</button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div>
              <p className="t-body text-titulo">No encontramos estudios con ese nombre.</p>
              <p className="mt-1 t-meta text-secundario">Prueba con uno de los estudios frecuentes de arriba o pregúntanos.</p>
              <a href={WA} target="_blank" rel="noopener" className={`${link} mt-1`}><Icon n="chat" />Pregúntanos por WhatsApp</a>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
