import { useApp } from '../context'
import { ROL } from '../state/sesion'
import { Logo } from './Header'
import { Icon } from './Icon'
import { BotonTema } from './Tema'
import { container } from './ui'

/** Encabezado de Asesor y Administrador: sin la navegación del paciente, con el rol visible. */
export function StaffHeader() {
  const { sesion, salir } = useApp()
  if (!sesion) return null
  return (
    <header className="sticky top-0 z-30 border-b border-borde bg-superficie">
      <div className={`${container} flex min-h-[72px] items-center justify-between gap-3`}>
        <div className="flex min-w-0 items-center gap-3 lg:gap-6">
          <Logo />
          <span className="hidden h-8 w-px bg-resaltado-2 sm:block" aria-hidden="true" />
          <p className="hidden t-sub font-semibold text-titulo sm:block">Atención al paciente</p>
        </div>
        <div className="flex items-center gap-2 lg:gap-4">
          <p className="flex items-center gap-2 rounded-full bg-resaltado px-3 py-1 t-meta font-semibold text-titulo">
            <Icon n={sesion.rol === 'admin' ? 'shield' : 'headset'} size={18} className="text-enlace" />
            <span><span className="sr-only">Rol: </span>{ROL[sesion.rol]}</span>
          </p>
          <span className="hidden t-meta text-secundario lg:inline">{sesion.correo}</span>
          <span className="hidden sm:block"><BotonTema /></span>
          <button onClick={salir} className="inline-flex min-h-12 items-center gap-2 rounded-md px-3 text-base font-semibold text-enlace transition-colors hover:bg-resaltado active:bg-resaltado-2">
            <Icon n="logout" />Salir
          </button>
        </div>
      </div>
    </header>
  )
}
