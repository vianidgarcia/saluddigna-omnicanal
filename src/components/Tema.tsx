import { useEffect, useState } from 'react'
import { Icon } from './Icon'

/* Modo claro / oscuro. index.html fija data-tema antes de pintar; aquí se alterna y se recuerda la elección.
   Sin elección guardada, sigue la preferencia del sistema (y sus cambios en vivo). */

type Tema = 'claro' | 'oscuro'
const CLAVE = 'sd_tema'
const COLOR_BARRA: Record<Tema, string> = { claro: '#FFFFFF', oscuro: '#16212D' }

const actual = (): Tema => (document.documentElement.getAttribute('data-tema') === 'oscuro' ? 'oscuro' : 'claro')
function aplicar(t: Tema) {
  document.documentElement.setAttribute('data-tema', t)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR_BARRA[t])
  window.dispatchEvent(new CustomEvent('sd-tema', { detail: t }))
}

export function useTema() {
  const [tema, setTema] = useState<Tema>(actual)
  useEffect(() => {
    aplicar(actual())
    const sync = () => setTema(actual())
    window.addEventListener('sd-tema', sync)
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const sistema = (e: MediaQueryListEvent) => {
      let guardado: string | null = null
      try { guardado = localStorage.getItem(CLAVE) } catch { /* sin almacenamiento */ }
      if (!guardado) aplicar(e.matches ? 'oscuro' : 'claro')
    }
    mq?.addEventListener('change', sistema)
    return () => { window.removeEventListener('sd-tema', sync); mq?.removeEventListener('change', sistema) }
  }, [])
  const alternar = () => {
    const t: Tema = actual() === 'oscuro' ? 'claro' : 'oscuro'
    try { localStorage.setItem(CLAVE, t) } catch { /* se aplica solo en esta visita */ }
    aplicar(t)
  }
  return { tema, alternar }
}

export function BotonTema({ className = '' }: { className?: string }) {
  const { tema, alternar } = useTema()
  const oscuro = tema === 'oscuro'
  return (
    <button onClick={alternar}
      className={`inline-flex min-h-12 items-center gap-2 whitespace-nowrap rounded-md px-3 text-base font-semibold text-titulo transition-colors hover:bg-resaltado hover:text-enlace active:bg-resaltado-2 ${className}`}>
      <Icon n={oscuro ? 'sol' : 'luna'} />{oscuro ? 'Modo claro' : 'Modo oscuro'}
    </button>
  )
}
