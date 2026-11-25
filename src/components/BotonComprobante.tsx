import { useState } from 'react'
import { useApp } from '../context'
import { conEvento, type Canal, type Tramite } from '../state/tramite'
import { Icon } from './Icon'
import { outlineBtn } from './ui'

/** Descarga el comprobante de la cita en PDF (solo para citas confirmadas). */
export function BotonComprobante({ t, canal = 'web', className = '' }: { t: Tramite; canal?: Canal; className?: string }) {
  const { update } = useApp()
  const [estado, setEstado] = useState<'listo' | 'generando' | 'hecho' | 'error'>('listo')
  if (t.estado !== 'confirmada') return null
  const descargar = async () => {
    setEstado('generando')
    try {
      const { descargarComprobante } = await import('../state/comprobante')
      const archivo = await descargarComprobante(t)
      update((x) => conEvento(x, 'cita.comprobante_descargado', `Descargó el comprobante en PDF (${archivo})`, canal))
      setEstado('hecho')
    } catch {
      setEstado('error')
    }
  }
  return (
    <div className={className}>
      <button onClick={descargar} disabled={estado === 'generando'} className={`${outlineBtn} w-full sm:w-auto disabled:cursor-wait`}>
        <Icon n="download" />{estado === 'generando' ? 'Generando PDF…' : 'Descargar comprobante (PDF)'}
      </button>
      <p role="status" className="mt-1 t-meta text-secundario empty:hidden">
        {estado === 'hecho' ? 'Listo: el comprobante se guardó en tus descargas.' : estado === 'error' ? 'No se pudo generar el PDF. Revisa tu conexión e inténtalo de nuevo.' : ''}
      </p>
    </div>
  )
}
