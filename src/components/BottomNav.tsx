import { useApp, type View } from '../context'
import { Icon } from './Icon'

export function BottomNav({ view }: { view: View }) {
  const { go, openClinics } = useApp()
  const items: [string, string, () => void, boolean][] = [
    ['home', 'Inicio', () => go('home'), view === 'home'],
    ['tramite', 'Mis trámites', () => go('tramites'), view === 'tramites'],
    ['file', 'Resultados', () => go('resultados'), view === 'resultados'],
    ['pin', 'Clínicas', () => openClinics(), false],
  ]
  return (
    <nav aria-label="Navegación inferior" className="fixed inset-x-0 bottom-0 z-30 border-t border-borde bg-superficie lg:hidden">
      <ul className="grid grid-cols-4">
        {items.map(([i, t, act, on]) => (
          <li key={t}><button onClick={act} aria-current={on ? 'page' : undefined} className={`flex h-16 w-full flex-col items-center justify-center gap-0.5 t-meta active:bg-resaltado ${on ? 'font-semibold text-enlace' : 'text-cuerpo'}`}><Icon n={i} />{t}</button></li>
        ))}
      </ul>
    </nav>
  )
}
