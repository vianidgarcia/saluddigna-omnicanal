/* Verificación del celular por código (OTP). Solo aparece en modo api: el orquestador exige un
   celular verificado antes de abrir el primer trámite, para que nadie se apropie del historial de
   otro paciente. En modo local el portal no la muestra y confirma como siempre.

   Sigue el patrón de ClinicSheet: hoja abajo en teléfono, panel a la derecha en escritorio. */
import { useEffect, useRef, useState } from 'react'
import type { ModoOtp } from '../api/api'
import { Icon } from './Icon'
import { link, outlineBtn, solidBtn } from './ui'
import { fmtTelefono } from '../state/tramite'

type Props = {
  telefono: string
  pedirCodigo: (tel: string) => Promise<ModoOtp>
  confirmarCodigo: (tel: string, codigo: string, modo: ModoOtp) => Promise<void>
  /** El celular quedó verificado: quien llama sigue con la confirmación del trámite. */
  onVerificado: () => void
  onCancelar: () => void
}

export function VerificarCelular({ telefono, pedirCodigo, confirmarCodigo, onVerificado, onCancelar }: Props) {
  const [fase, setFase] = useState<'pedir' | 'codigo'>('pedir')
  const [modo, setModo] = useState<ModoOtp>('agregar')
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const primero = useRef<HTMLButtonElement>(null)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    primero.current?.focus()
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancelar()
    window.addEventListener('keydown', k)
    return () => { window.removeEventListener('keydown', k); prev?.focus?.() }
  }, [onCancelar])

  useEffect(() => { if (fase === 'codigo') campo.current?.focus() }, [fase])

  const enviar = async () => {
    setOcupado(true); setError(null)
    try {
      setModo(await pedirCodigo(telefono))
      setFase('codigo')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar el código. Inténtalo de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  const validar = async () => {
    setOcupado(true); setError(null)
    try {
      await confirmarCodigo(telefono, codigo, modo)
      onVerificado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'El código no coincide. Revísalo o pide uno nuevo.')
      setCodigo('')
      campo.current?.focus()
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end lg:items-stretch">
      <div onClick={onCancelar} className="absolute inset-0 bg-[#1F2933]/50 [animation:fade_200ms_ease-out]" />
      <div role="dialog" aria-modal="true" aria-labelledby="otp-t"
        className="relative flex w-full flex-col rounded-t-2xl bg-superficie [animation:sheet-up_250ms_cubic-bezier(.2,0,0,1)] lg:w-[440px] lg:rounded-none lg:[animation:sheet-right_250ms_cubic-bezier(.2,0,0,1)]">
        <div className="flex items-center justify-between border-b border-borde px-4 py-3 lg:px-6">
          <h2 id="otp-t" className="t-card font-head text-titulo">Confirma tu celular</h2>
          <button ref={primero} onClick={onCancelar}
            className="inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-base font-semibold text-enlace hover:bg-resaltado active:bg-resaltado-2">
            <Icon n="x" />Cerrar
          </button>
        </div>

        <div className="px-4 py-5 lg:px-6">
          {fase === 'pedir' ? (
            <>
              <p className="t-body">
                Te enviaremos un código al <strong className="font-bold text-titulo">{fmtTelefono(telefono)}</strong> para
                que tu cita quede ligada a ti en todos los canales: si luego escribes por WhatsApp o llamas al Call
                Center, no tendrás que volver a dar tus datos.
              </p>
              <button onClick={enviar} disabled={ocupado} className={`${solidBtn} mt-5 w-full`}>
                {ocupado ? 'Enviando código…' : 'Enviar código'}
              </button>
              <button onClick={onCancelar} className={`${link} mt-2 w-full justify-center`}>Usar otro número</button>
            </>
          ) : (
            <>
              <p className="t-body">
                {modo === 'iniciar_sesion'
                  ? 'Ese número ya tiene trámites con nosotros: con el código recuperas tu historial.'
                  : `Escribe el código de 6 dígitos que enviamos al ${fmtTelefono(telefono)}.`}
              </p>
              <label htmlFor="otp" className="mt-5 block text-base font-semibold text-titulo">Código de 6 dígitos</label>
              <input id="otp" ref={campo} value={codigo} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                aria-describedby={error ? 'otp-e' : undefined} aria-invalid={!!error || undefined}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter' && codigo.length === 6 && !ocupado) void validar() }}
                className={`mt-2 min-h-12 w-full rounded-lg border bg-superficie px-4 text-lg tracking-[0.3em] text-titulo ${error ? 'border-error' : 'border-borde'}`} />
              <button onClick={validar} disabled={ocupado || codigo.length < 6} className={`${solidBtn} mt-4 w-full`}>
                {ocupado ? 'Confirmando…' : 'Confirmar'}
              </button>
              <button onClick={() => { setFase('pedir'); setCodigo(''); setError(null) }} className={`${outlineBtn} mt-2 w-full`}>
                Pedir otro código
              </button>
            </>
          )}

          {error && <p id="otp-e" role="status" className="mt-3 t-meta text-error">{error}</p>}
          <p className="mt-4 t-meta text-secundario">Prototipo: con los números de prueba el código es 123456.</p>
        </div>
      </div>
    </div>
  )
}
