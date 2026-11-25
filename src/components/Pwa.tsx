import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { container } from './ui'

/* Piezas de la PWA: aviso de conexión e instalación. */

type PromptInstalacion = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** Aviso en el flujo de la página (no fijo) cuando no hay conexión, y un mensaje breve al recuperarla. */
export function AvisoConexion() {
  const [enLinea, setEnLinea] = useState(() => navigator.onLine)
  const [recuperada, setRecuperada] = useState(false)
  useEffect(() => {
    let t: number | undefined
    const on = () => { setEnLinea(true); setRecuperada(true); window.clearTimeout(t); t = window.setTimeout(() => setRecuperada(false), 4000) }
    const off = () => { setEnLinea(false); setRecuperada(false) }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.clearTimeout(t) }
  }, [])
  return (
    <div role="status" aria-live="polite">
      {!enLinea && (
        <div className="border-b border-borde bg-ambar-fondo">
          <p className={`${container} flex items-start gap-2 py-3 t-body text-titulo`}>
            <Icon n="alert" className="mt-0.5 text-ambar-texto" />
            <span><strong className="font-bold">Sin conexión.</strong> Puedes seguir usando el portal: tus cambios se guardan en este dispositivo. Confirmar, pagar o cambiar citas, WhatsApp y llamadas necesitan conexión.</span>
          </p>
        </div>
      )}
      {enLinea && recuperada && (
        <div className="border-b border-borde bg-resaltado">
          <p className={`${container} flex items-center gap-2 py-3 t-body text-titulo`}><Icon n="check" className="text-enlace" />Conexión restablecida.</p>
        </div>
      )}
    </div>
  )
}

/** Botón "Instalar app": solo aparece cuando el navegador ofrece instalarla (Chrome, Edge, Android). */
export function BotonInstalar({ className = '' }: { className?: string }) {
  const [prompt, setPrompt] = useState<PromptInstalacion | null>(null)
  const [instalada, setInstalada] = useState(() => window.matchMedia?.('(display-mode: standalone)').matches ?? false)
  useEffect(() => {
    const antes = (e: Event) => { e.preventDefault(); setPrompt(e as PromptInstalacion) }
    const listo = () => { setInstalada(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', antes)
    window.addEventListener('appinstalled', listo)
    return () => { window.removeEventListener('beforeinstallprompt', antes); window.removeEventListener('appinstalled', listo) }
  }, [])
  if (instalada) return <span className={`inline-flex min-h-12 items-center gap-2 text-secundario ${className}`}><Icon n="check" size={18} />App instalada</span>
  if (!prompt) return null
  const instalar = async () => {
    await prompt.prompt()
    const r = await prompt.userChoice
    if (r.outcome === 'accepted') setInstalada(true)
    setPrompt(null)
  }
  return (
    <button onClick={instalar} className={`inline-flex min-h-12 items-center gap-2 rounded-md font-semibold text-enlace underline underline-offset-4 hover:text-enlace-hover ${className}`}>
      <Icon n="download" size={18} />Instalar app
    </button>
  )
}
