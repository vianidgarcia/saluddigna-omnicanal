import { useApp } from '../context'
import { Icon } from './Icon'
import { WA, NB, container, outlineBtn, link } from './ui'

export function Help() {
  const { llamar } = useApp()
  return (
    <div id="ayuda" className="mt-10 scroll-mt-24 bg-banda py-10 lg:mt-16 lg:py-12">
      <section aria-labelledby="ayuda-t" className={`${container} flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between`}>
        <div>
          <h2 id="ayuda-t" className="t-section font-head text-titulo">¿Necesitas ayuda?</h2>
          <p className="mt-1 t-body">Asistente por WhatsApp 24/7 · Asesores de 7:00 a 21:00</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
          <a href={WA} target="_blank" rel="noopener" className={outlineBtn}><Icon n="chat" />Escribir por WhatsApp</a>
          <button onClick={llamar} className={outlineBtn}><Icon n="phone" />Llamar desde aquí</button>
          <a href="tel:+525555547166" className={`${link} justify-center`}><Icon n="phone" />Llamar 55{NB}5554{NB}7166</a>
        </div>
      </section>
    </div>
  )
}
