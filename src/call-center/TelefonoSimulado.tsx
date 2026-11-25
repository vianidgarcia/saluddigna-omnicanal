/* El celular del PACIENTE en la demostración (solo con la Supabase local): aquí "llega" su código.
   El asesor nunca lo ve: la pantalla del paciente es la única que lo muestra. */
import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { outlineBtn } from '../components/ui'

export function TelefonoSimulado({ telefono, usar }: { telefono: string; usar: ((codigo: string) => void) | null }) {
  const [codigo, setCodigo] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    let ultimo = 0
    const desde = Date.now() - 5000
    const leer = async () => {
      try {
        const { bandeja } = await import('../api/llamadas')
        const nuevos = await bandeja(telefono, ultimo)
        if (!vivo || !nuevos.length) return
        ultimo = nuevos[nuevos.length - 1].id
        const m = nuevos.filter((x) => x.tipo === 'otp' && Date.parse(x.creado_en) > desde).at(-1)
        const c = m?.contenido.match(/\d{6}/)?.[0]
        if (c) setCodigo(c)
      } catch { /* sin simulador: el código se escribe a mano */ }
    }
    void leer()
    const h = window.setInterval(() => void leer(), 2000)
    return () => { vivo = false; window.clearInterval(h) }
  }, [telefono])

  if (!codigo || !usar) return null
  return (
    <div role="status" className="mt-4 max-w-2xl rounded-lg border border-borde bg-superficie p-4">
      <p className="flex items-center gap-2 t-body text-titulo"><Icon n="chat" />Tu celular (demo): llegó el código <b>{codigo}</b></p>
      <button onClick={() => { usar(codigo); setCodigo(null) }} className={`${outlineBtn} mt-2`}><Icon n="shield" />Usar este código</button>
    </div>
  )
}
