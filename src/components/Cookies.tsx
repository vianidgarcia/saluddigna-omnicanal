import { useState } from 'react'
import { container, outlineBtn, link } from './ui'

export function Cookies({ onDone }: { onDone: (eleccion: 'todas' | 'necesarias') => void }) {
  const [cfg, setCfg] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  return (
    <section aria-label="Aviso de cookies" className="border-b border-borde bg-resaltado">
      <div className={`${container} py-3`}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <p className="t-body text-titulo">Usamos cookies necesarias para que el sitio funcione y, si lo permites, analíticas para mejorarlo.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => onDone('todas')} className={outlineBtn}>Aceptar</button>
            <button onClick={() => onDone('necesarias')} className={outlineBtn}>Rechazar</button>
            <button onClick={() => setCfg(!cfg)} aria-expanded={cfg} aria-controls="ck-cfg" className={link}>Configurar</button>
          </div>
        </div>
        {cfg && (
          <div id="ck-cfg" className="mt-3 flex flex-col gap-1 border-t border-borde pt-3 lg:flex-row lg:items-center lg:gap-8">
            <label className="flex min-h-12 items-center gap-3 text-base text-titulo">
              <input type="checkbox" checked disabled className="size-5 accent-accion-hover" />
              <span>Necesarias <span className="t-meta text-secundario">· Siempre activas</span></span>
            </label>
            <label className="flex min-h-12 items-center gap-3 text-base text-titulo">
              <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="size-5 accent-accion-hover" />
              <span>Analíticas</span>
            </label>
            <button onClick={() => onDone(analytics ? 'todas' : 'necesarias')} className={`${outlineBtn} lg:ml-auto`}>Guardar preferencias</button>
          </div>
        )}
      </div>
    </section>
  )
}
