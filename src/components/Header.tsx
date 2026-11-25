import { useEffect, useRef, useState } from 'react'
import { ROL, type Rol } from '../state/sesion'
import { useApp } from '../context'
import type { Clinic } from '../data/clinics'
import { Icon } from './Icon'
import { LogoSaludDigna } from './LogoSaludDigna'
import { BotonTema } from './Tema'
import { container } from './ui'

// "Clínicas" se quitó del menú: la abre el selector de clínica (y "Clínicas" en la barra inferior del teléfono)
const NAV = ['Servicios', 'Paquetes', 'Resultados']

/** Logo oficial (ver LogoSaludDigna). 28 px de alto en teléfono (≈132 px) y 32 px desde 640 px (≈151 px), para que el encabezado quepa. */
export function Logo({ className = 'h-7 w-auto sm:h-8' }: { className?: string }) {
  return <LogoSaludDigna className={className} />
}

/* ---------- header ---------- */
export function Header({ clinic, onChange, onHome }: { clinic: Clinic; onChange: () => void; onHome: () => void }) {
  const [open, setOpen] = useState(false)
  const { go, openClinics, scrollToId } = useApp()
  const navAct = (n: string) => { setOpen(false); if (n === 'Servicios') scrollToId('servicios'); else if (n === 'Paquetes') scrollToId('paquetes'); else if (n === 'Resultados') go('resultados'); else openClinics() }
  const item = 'inline-flex min-h-12 items-center whitespace-nowrap rounded-md px-2 text-base font-semibold text-titulo transition-colors hover:bg-resaltado hover:text-enlace active:bg-resaltado-2'
  return (
    <header className="sticky top-0 z-30 border-b border-borde bg-superficie">
      <div className={`${container} flex min-h-[72px] items-center justify-between gap-4`}>
        <div className="flex items-center gap-4">
          <button onClick={onHome} className="inline-flex min-h-12 items-center rounded-md" aria-label="Salud Digna, ir al inicio"><Logo /></button>
          <nav aria-label="Navegación principal" className="hidden items-center gap-1 lg:flex">
            {NAV.map((n) => n === 'Servicios' || n === 'Paquetes'
              ? <a key={n} href={n === 'Servicios' ? '#servicios' : '#paquetes'} onClick={(e) => { e.preventDefault(); navAct(n) }} className={item}>{n}</a>
              : <button key={n} onClick={() => navAct(n)} className={item}>{n}</button>)}
          </nav>
        </div>
        <div className="hidden items-center gap-1 lg:flex">
          <span className="hidden xl:block"><BotonTema /></span>
          <button onClick={onChange} className="inline-flex min-h-12 items-center gap-2 whitespace-nowrap rounded-md px-3 text-base text-titulo transition-colors hover:bg-resaltado active:bg-resaltado-2">
            <Icon n="pin" className="text-enlace" />
            <span>{clinic.name} ·</span><span className="font-semibold text-enlace underline underline-offset-4">Cambiar</span>
          </button>
          <button onClick={() => go('tramites')} className={item}>Mis trámites</button>
          <MenuEntrar />
        </div>
        <div className="flex items-center gap-2 lg:hidden">
          <MenuEntrar />
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-12 min-w-12 flex-col items-center justify-center rounded-md text-titulo hover:bg-resaltado active:bg-resaltado-2">
            <Icon n={open ? 'x' : 'menu'} size={22} /><span className="t-meta">Menú</span>
          </button>
        </div>
      </div>
      {open && (
        <div className="border-t border-borde bg-superficie pb-3 lg:hidden">
          <nav aria-label="Menú móvil" className={`${container} flex flex-col`}>
            {NAV.map((n) => <button key={n} onClick={() => navAct(n)} className={`${item} w-full`}>{n}</button>)}
            <button onClick={() => { setOpen(false); go('tramites') }} className={`${item} w-full`}>Mis trámites</button>
            <button onClick={() => { setOpen(false); onChange() }} className={`${item} w-full gap-2`}>
              <Icon n="pin" className="text-enlace" />{clinic.name} · <span className="ml-1 text-enlace underline underline-offset-4">Cambiar</span>
            </button>
            <BotonTema className="w-full" />
          </nav>
        </div>
      )}
    </header>
  )
}

/* ---------- iniciar sesión (esquina superior derecha, visitante) ---------- */
const OPCIONES_ROL: [Rol, string, string][] = [
  ['asesor', 'headset', 'Atención al paciente (Call Center)'],
  ['admin', 'shield', 'Atención al paciente y control de la demo'],
]

function MenuEntrar() {
  const { abrirEntrar } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLButtonElement>('[data-opcion]')?.focus()
    const fuera = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button ref={btn} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={open ? 'menu-entrar' : undefined}
        className="inline-flex min-h-12 items-center gap-2 whitespace-nowrap rounded-lg border border-borde-accion bg-superficie px-3 sm:px-4 text-base font-semibold text-enlace transition-colors hover:bg-resaltado active:bg-resaltado-2">
        <Icon n="user" /><span className="xl:hidden">Entrar</span><span className="hidden xl:inline">Iniciar sesión</span><Icon n="left" size={16} className={`transition-transform ${open ? 'rotate-90' : '-rotate-90'}`} />
      </button>
      {open && (
        <div id="menu-entrar" className="absolute right-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-borde bg-superficie p-2 shadow-[0_8px_24px_-4px_rgba(0,68,128,0.24)]">
          <p className="px-3 pb-1 pt-2 t-meta font-semibold text-secundario">Acceso para personal de Salud Digna</p>
          <ul>
            {OPCIONES_ROL.map(([r, ic, d]) => (
              <li key={r}>
                <button data-opcion onClick={() => { setOpen(false); abrirEntrar(r) }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-resaltado active:bg-resaltado-2">
                  <Icon n={ic} className="text-enlace" />
                  <span><span className="block text-base font-semibold text-titulo">{ROL[r]}</span><span className="block t-meta text-secundario">{d}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
