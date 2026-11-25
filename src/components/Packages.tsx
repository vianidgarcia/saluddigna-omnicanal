import { useApp } from '../context'
import { PACKAGES } from '../data/packages'
import { Icon } from './Icon'
import { NB, container, link, outlineBtn } from './ui'

export function Packages() {
  const { startAgendar, toast } = useApp()
  return (
    <section id="paquetes" className={`${container} scroll-mt-16 pt-10 lg:pt-16`} aria-labelledby="paq">
      <h2 id="paq" className="t-section font-head text-titulo">Paquetes de prevención</h2>
      <ul className="-mx-4 mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-8 lg:overflow-visible lg:px-0">
        {PACKAGES.map(([t, p]) => (
          <li key={t} className="flex w-[280px] shrink-0 snap-start flex-col rounded-2xl border border-borde bg-superficie p-6 shadow-[0_8px_24px_-4px_rgba(0,68,128,0.24)] lg:w-auto">
            <span className="self-start rounded-full bg-resaltado px-3 py-1 t-meta font-semibold text-titulo">Requiere cita</span>
            <h3 className="mt-4 t-card font-head text-titulo">{t}{NB}–{NB}{p}</h3>
            <p className="mt-1 t-meta text-secundario">IVA incluido</p>
            <button onClick={() => toast()} className={`${link} mt-4 mb-auto self-start`}>Ver preparaciones</button>
            <button onClick={() => startAgendar({ categoria: 'Paquetes', nombre: t, precio: p })} className={`${outlineBtn} mt-6 w-full`}><Icon n="calendar" />Agendar cita</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
