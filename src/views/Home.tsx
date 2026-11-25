import { useApp } from '../context'
import type { Clinic } from '../data/clinics'
import { tel } from '../data/clinics'
import { ContinueCard } from '../components/ContinueCard'
import { Search } from '../components/Search'
import { Packages } from '../components/Packages'
import { Help } from '../components/Help'
import { Icon } from '../components/Icon'
import { NB, container, link } from '../components/ui'

const QUICK = [
  ['calendar', 'Agendar cita', 'Elige estudio, clínica y horario.'],
  ['file', 'Mis resultados', 'Consulta y descarga tus estudios.'],
  ['refresh', 'Cambiar cita', 'Reprograma sin perder tu lugar.'],
  ['beaker', 'Preparaciones', 'Qué hacer antes de tu estudio.'],
]

function Hero() {
  const { go, toast, startAgendar } = useApp()
  const quickAct = (t: string) => (t === 'Agendar cita' ? startAgendar() : t === 'Mis resultados' ? go('resultados') : toast())
  return (
    <div className="bg-banda pb-10 pt-8 lg:pb-16 lg:pt-12">
      <div className={container}>
        <h1 className="t-greeting font-head text-titulo">Agenda tus estudios en Salud Digna</h1>
        <div className="mt-6 grid gap-6 lg:grid-cols-12 lg:items-stretch lg:gap-8">
          <div className="lg:col-span-7"><ContinueCard /></div>
          <div className="lg:col-span-5"><Search /></div>
        </div>
        <section aria-labelledby="acc-t">
          <h2 id="acc-t" className="sr-only">Acciones rápidas</h2>
          <ul id="servicios" className="mt-10 scroll-mt-24 grid grid-cols-2 gap-x-4 gap-y-8 lg:mt-16 lg:grid-cols-4 lg:gap-8">
            {QUICK.map(([i, t, d]) => (
              <li key={t} className="group relative -m-2 rounded-lg p-2 transition-colors hover:bg-resaltado has-[:active]:bg-resaltado-2">
                <Icon n={i} size={28} className="text-icono" />
                <h3 className="mt-3 font-head t-card text-titulo group-hover:text-enlace">
                  <button onClick={() => quickAct(t)} className="rounded-md text-left after:absolute after:inset-0 after:content-['']">{t}</button>
                </h3>
                <p className="mt-1 t-body">{d}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/* ---------- lower sections ---------- */
function ClinicRow({ clinic }: { clinic: Clinic }) {
  const { openClinics } = useApp()
  return (
    <section aria-label="Tu clínica" className={`${container} pt-10 lg:pt-16`}>
      <div className="flex flex-col gap-2 border-t border-borde pt-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <p className="flex items-start gap-3 t-body text-cuerpo">
          <Icon n="pin" className="mt-0.5 text-icono" />
          <span>Tu clínica: <strong className="font-bold text-titulo">{clinic.name}</strong> · {clinic.ciudad}, {clinic.estado}</span>
        </p>
        <div className="flex flex-wrap gap-x-6">
          {clinic.phone && <a href={tel(clinic.phone)} className={link}><Icon n="phone" />Llamar{NB}{clinic.phone.replace(/ /g, NB)}</a>}
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${clinic.lat},${clinic.lng}`} target="_blank" rel="noopener" className={link}><Icon n="nav" />Cómo llegar</a>
          <button onClick={openClinics} className={link}>Ver todas las clínicas</button>
        </div>
      </div>
    </section>
  )
}

export function Home({ clinic }: { clinic: Clinic }) {
  return (
    <>
      <Hero />
      <ClinicRow clinic={clinic} />
      <Packages />
      <Help />
    </>
  )
}
