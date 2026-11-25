import { useState } from 'react'
import { fmtTelefono } from '../state/tramite'
import { apagado, outlineBtn } from './ui'

/** Pide un celular de 10 dígitos para verificarlo por código. */
export function FormCelular({ id, onTelefono, texto = 'Confirmar mi celular' }: { id: string; onTelefono: (tel: string) => void; texto?: string }) {
  const [tel, setTel] = useState('')
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label htmlFor={`${id}-tel`} className="text-base font-semibold text-titulo">Teléfono celular</label>
        <input id={`${id}-tel`} type="tel" inputMode="numeric" autoComplete="tel-national" value={fmtTelefono(tel) || tel} placeholder="10 dígitos, ej. 667 123 4567"
          onChange={(e) => setTel(e.target.value.replace(/\D/g, '').slice(0, 10))} onKeyDown={(e) => { if (e.key === 'Enter' && tel.length === 10) onTelefono(tel) }}
          className="mt-2 h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion" />
      </div>
      <button onClick={() => onTelefono(tel)} disabled={tel.length !== 10} className={`${outlineBtn} ${apagado}`}>{texto}</button>
    </div>
  )
}
