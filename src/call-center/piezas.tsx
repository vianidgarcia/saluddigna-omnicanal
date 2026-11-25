import { useEffect, useRef } from 'react'
import { Icon } from '../components/Icon'
import { outlineBtn } from '../components/ui'
import type { Linea } from './tipos'
import type { useAudioWebRtc } from './useAudioWebRtc'

export const campo = 'h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion'
export const apagado = 'disabled:cursor-not-allowed disabled:border-borde disabled:bg-banda disabled:text-cuerpo'

const AUDIO = { apagado: 'Audio apagado', conectando: 'Esperando el audio…', activo: 'Audio conectado', fallo: 'Sin audio' }

export function ControlAudio({ a }: { a: ReturnType<typeof useAudioWebRtc> }) {
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        {!a.microfono
          ? <button onClick={() => void a.activarMicrofono()} className={outlineBtn}><Icon n="mic" />Activar micrófono</button>
          : <button onClick={a.alternarSilencio} aria-pressed={a.silenciado} className={outlineBtn}><Icon n="mic" />{a.silenciado ? 'Quitar silencio' : 'Silenciar'}</button>}
        <span role="status" className="t-meta text-secundario">{AUDIO[a.estado]}{a.silenciado ? ' · micrófono en silencio' : ''}</span>
      </div>
      {a.errorAudio && <p role="alert" className="mt-2 t-body font-semibold text-error">{a.errorAudio}</p>}
    </div>
  )
}

const QUIEN: Record<Linea['autor'], string> = { sofia: 'Sofía (asistente)', paciente: 'Paciente', asesor: 'Asesor', sistema: 'Aviso' }

export function Conversacion({ lineas, yo }: { lineas: Linea[]; yo: 'paciente' | 'asesor' }) {
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => { if (caja.current) caja.current.scrollTop = caja.current.scrollHeight }, [lineas])
  return (
    <div ref={caja} role="log" aria-label="Conversación de la llamada" tabIndex={0} className="mt-4 max-h-72 overflow-y-auto">
      {lineas.map((l, i) => (
        <div key={i} className={`border-t border-borde py-2 ${l.autor === yo ? 'text-right' : ''}`}>
          <p className="t-meta text-secundario">{l.autor === yo ? 'Tú' : QUIEN[l.autor]}</p>
          <p className="t-body break-words text-titulo">{l.texto}</p>
        </div>
      ))}
    </div>
  )
}
