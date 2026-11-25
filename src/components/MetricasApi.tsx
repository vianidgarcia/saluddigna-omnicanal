/* Métricas de supervisión y administración, comparadas con el año anterior. Solo modo api; carga diferida. */
import { useEffect, useState } from 'react'
import { useApp } from '../context'
import type { Metricas } from '../api/api'
import { panelMetricas } from '../api/personal'
import { isoDia } from '../state/tramite'
import { avisoDe, chip } from './ui'

const PERIODOS: [string, number][] = [['Últimos 7 días', 6], ['Últimos 30 días', 29], ['Últimos 90 días', 89]]
const dinero = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)

export default function MetricasApi() {
  const { sesion } = useApp()
  const [dias, setDias] = useState(29)
  const [m, setM] = useState<Metricas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clinica = sesion?.clinicaId ?? undefined
  useEffect(() => {
    let vivo = true
    const desde = new Date()
    desde.setDate(desde.getDate() - dias)
    setM(null); setError(null)
    void panelMetricas(isoDia(desde), isoDia(new Date()), clinica).then((r) => { if (vivo) setM(r) }).catch((e: unknown) => { if (vivo) setError(avisoDe(e)) })
    return () => { vivo = false }
  }, [dias, clinica])
  const dato = (k: 'tramites' | 'citas' | 'ingresos', n: string) => {
    const v = m?.variacion_pct[k]
    return (
      <div>
        <dt className="t-meta text-secundario">{n}</dt>
        <dd className="font-head t-card text-titulo">{k === 'ingresos' ? dinero(m?.actual[k] ?? 0) : m?.actual[k]}</dd>
        <dd className="t-meta text-secundario">{v == null ? 'Sin datos del año anterior' : `${v > 0 ? '+' : ''}${v} % contra el año anterior`}</dd>
      </div>
    )
  }
  return (
    <section aria-labelledby="me-t" className="mt-10 max-w-3xl">
      <h2 id="me-t" className="t-section font-head text-titulo">Métricas</h2>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Periodo">
        {PERIODOS.map(([n, d]) => <button key={d} onClick={() => setDias(d)} aria-pressed={dias === d} className={chip(dias === d)}>{n}</button>)}
      </div>
      <div role="status" className="mt-3">
        {error && <p className="t-body font-semibold text-error">{error}</p>}
        {!m && !error && <p className="t-body text-secundario">Calculando…</p>}
      </div>
      {m && <dl className="mt-4 grid gap-4 sm:grid-cols-3">{dato('tramites', 'Trámites')}{dato('citas', 'Citas')}{dato('ingresos', 'Ingresos (de prueba)')}</dl>}
    </section>
  )
}
