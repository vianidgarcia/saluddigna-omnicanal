import { useState } from 'react'
import { useApp } from '../context'
import { Icon } from './Icon'
import { BotonInstalar } from './Pwa'
import { BotonTema } from './Tema'
import { container } from './ui'

export const FOOT: Record<string, string[]> = {
  Conócenos: ['Quiénes somos', 'Nuestra misión', 'Sala de prensa'],
  Servicios: ['Laboratorio', 'Ultrasonido', 'Mastografía', 'Lentes'],
  Pacientes: ['Mis resultados', 'Preparaciones', 'Preguntas frecuentes'],
  Empresas: ['Convenios', 'Chequeos empresariales', 'Contacto'],
}
export function Footer() {
  const { toast, simularWhatsApp, reiniciarDemo } = useApp()
  const [confirmar, setConfirmar] = useState(false)
  const small = 'inline-flex min-h-12 items-center gap-2 rounded-md text-secundario hover:text-enlace hover:underline'
  return (
    <footer className="border-t border-borde bg-superficie pt-10 lg:pt-16">
      <div className={container}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4 lg:gap-8">
          {Object.entries(FOOT).map(([h, items]) => (
            <nav key={h} aria-label={h}>
              <h2 className="t-sub font-bold text-titulo">{h}</h2>
              <ul className="mt-2">{items.map((i) => <li key={i}><button onClick={() => toast()} className="inline-flex min-h-12 items-center rounded-md text-left t-body text-cuerpo hover:text-enlace hover:underline active:text-enlace-hover">{i}</button></li>)}</ul>
            </nav>
          ))}
        </div>
        <div className="mt-8 flex flex-col border-t border-borde py-4 t-meta lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-x-6">
            <button onClick={() => toast()} className="inline-flex min-h-12 items-center rounded-md text-secundario hover:text-enlace hover:underline">Aviso de privacidad</button>
            <button onClick={() => toast()} className="inline-flex min-h-12 items-center rounded-md text-secundario hover:text-enlace hover:underline">Términos y condiciones</button>
            <BotonTema className="!px-0 !text-sm !font-normal !text-secundario hover:!bg-transparent hover:!text-enlace hover:underline" />
            <BotonInstalar />
          </div>
          <p className="text-secundario">© Salud Digna</p>
        </div>
        <section aria-label="Controles de la demostración" className="flex flex-col gap-x-6 border-t border-borde py-2 t-meta lg:flex-row lg:items-center">
          <button onClick={simularWhatsApp} className={small}><Icon n="chat" size={18} />Demo: simular regreso por WhatsApp</button>
          {!confirmar
            ? <button onClick={() => setConfirmar(true)} className={small}><Icon n="refresh" size={18} />Reiniciar demo</button>
            : (
              <div role="status" className="flex flex-wrap items-center gap-x-4">
                <span className="text-titulo">¿Borrar el trámite de demostración?</span>
                <button onClick={() => { setConfirmar(false); reiniciarDemo() }} className="inline-flex min-h-12 items-center rounded-md font-semibold text-enlace underline underline-offset-4">Sí, borrar</button>
                <button onClick={() => setConfirmar(false)} className="inline-flex min-h-12 items-center rounded-md font-semibold text-enlace underline underline-offset-4">Cancelar</button>
              </div>
            )}
        </section>
      </div>
    </footer>
  )
}
