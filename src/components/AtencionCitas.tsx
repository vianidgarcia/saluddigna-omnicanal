/* Atención por celular: el personal elige la cita ANTES de verificar (docs/GUIA_APP_PWA.md, 7.1 y 7.2).
   Call center: fecha de nacimiento u OTP. Mostrador: identificación oficial (solo el tipo, nunca el número).
   Solo modo api; carga diferida. */
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../context'
import { TIPOS_DOCUMENTO, type Contexto, type TipoDocumento } from '../api/api'
import type { Cita } from '../api/citas'
import { partirFechaHora, zonaDe } from '../api/mapa'
import * as p from '../api/personal'
import { fechaLarga, fmtHora, fmtTelefono } from '../state/tramite'
import { CambiarFecha } from './CitasApi'
import { CitaTelefono } from './CitaTelefono'
import { Icon } from './Icon'
import { apagado, avisoDe, link, outlineBtn } from './ui'

const campo = 'mt-2 h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion'
export const DOCUMENTO: Record<TipoDocumento, string> = {
  ine: 'INE', pasaporte: 'Pasaporte', licencia: 'Licencia', cedula_profesional: 'Cédula profesional',
  cartilla_militar: 'Cartilla militar', acta_nacimiento: 'Acta de nacimiento', curp: 'CURP', otro: 'Otro',
}
export const ESTADO_CITA: Record<string, string> = { reservada: 'Apartada', confirmada: 'Confirmada', en_clinica: 'En la clínica', atendida: 'Atendida', cancelada: 'Cancelada', no_asistio: 'No asistió' }

export function ElegirDocumento({ id, valor, onCambio }: { id: string; valor: TipoDocumento; onCambio: (t: TipoDocumento) => void }) {
  return (
    <div>
      <label htmlFor={id} className="text-base font-semibold text-titulo">Identificación oficial</label>
      <select id={id} value={valor} onChange={(e) => onCambio(e.target.value as TipoDocumento)} className={campo}>
        {TIPOS_DOCUMENTO.map((t) => <option key={t} value={t}>{DOCUMENTO[t]}</option>)}
      </select>
    </div>
  )
}

export default function AtencionCitas({ canal, clinicaId }: { canal: 'call_center' | 'clinica'; clinicaId: string | null }) {
  const { sesion } = useApp()
  const [tel, setTel] = useState('')
  const [ctx, setCtx] = useState<Contexto | null>(null)
  const [elegida, setElegida] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [doc, setDoc] = useState<TipoDocumento>('ine')
  const [nacimiento, setNacimiento] = useState('')
  const [otpA, setOtpA] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [cambiando, setCambiando] = useState(false)
  const [cancelando, setCancelando] = useState(false)
  const id = canal === 'clinica' ? 'mo' : 'at'
  const abierta = useRef<string | null>(null)
  abierta.current = ctx?.sesion.interaccion_id ?? null
  // al salir de la pantalla se cierra la atención: libera los trámites tomados
  useEffect(() => () => { if (abierta.current) void p.terminar(abierta.current).catch(() => {}) }, [])

  const i = ctx?.sesion.interaccion_id ?? ''
  const nivel = ctx?.sesion.nivel_verificacion
  const citas = (ctx?.citas_proximas ?? []) as Cita[]
  const cita = citas.find((c) => c.id === elegida)

  const hacer = async (fn: () => Promise<string | void>, refrescar = true) => {
    setOcupado(true); setError(null); setAviso(null)
    try { const m = await fn(); if (m) setAviso(m); setCambiando(false); setCancelando(false) } catch (e) { setError(avisoDe(e)) }
    if (refrescar && abierta.current) { try { setCtx(await p.refrescar(abierta.current)) } catch (e) { setError((x) => x ?? avisoDe(e)) } }
    setOcupado(false)
  }
  const buscar = () => hacer(async () => { setElegida(null); setOtpA(null); setCodigo(''); setNacimiento(''); setCtx(await p.atender(tel, canal)) }, false)
  const terminar = () => hacer(async () => {
    await p.terminar(i)
    setCtx(null); setElegida(null); setTel(''); setOtpA(null); setCodigo(''); setNacimiento('')
    return 'Atención terminada.'
  }, false)
  const cuando = (c: Cita) => { const [f, h] = partirFechaHora(c.fecha_hora, zonaDe(c.clinica)); return `${fechaLarga(f)}, ${fmtHora(h)}` }

  // recepción solo cobra en su sucursal; la base también lo impide (42501)
  const puedeCobrar = sesion?.rolBase !== 'asesor' && (sesion?.rolBase === 'admin' || cita?.clinica_id === clinicaId)
  const modificable = cita && (cita.estado === 'reservada' || cita.estado === 'confirmada')

  return (
    <section aria-labelledby={`${id}-t`} className="mt-10 max-w-3xl">
      <h2 id={`${id}-t`} className="t-section font-head text-titulo">{canal === 'clinica' ? 'Mostrador' : 'Atención por teléfono'}</h2>
      <p className="mt-1 t-body">{canal === 'call_center' ? 'Busca por celular y verifica la identidad para agendar una cita o atender las que ya tiene.' : 'Busca por celular, elige la cita y después verifica la identidad.'} Antes de verificar solo se ven folio, fecha y estado.</p>

      {!ctx && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor={`${id}-tel`} className="text-base font-semibold text-titulo">Celular del paciente</label>
            <input id={`${id}-tel`} type="tel" inputMode="numeric" autoComplete="off" value={fmtTelefono(tel) || tel} placeholder="10 dígitos"
              onChange={(e) => setTel(e.target.value.replace(/\D/g, '').slice(0, 10))} onKeyDown={(e) => { if (e.key === 'Enter' && tel.length === 10 && !ocupado) void buscar() }} className={campo} />
          </div>
          <button onClick={buscar} disabled={ocupado || tel.length !== 10} className={`${outlineBtn} ${apagado}`}><Icon n="search" />{ocupado ? 'Buscando…' : 'Atender'}</button>
        </div>
      )}

      <div role="status" className="mt-3">
        {error && <p className="flex items-start gap-2 t-body font-semibold text-error"><Icon n="alert" className="mt-0.5" />{error}</p>}
        {aviso && <p className="flex items-start gap-2 t-body font-semibold text-titulo"><Icon n="check" className="mt-0.5 text-enlace" />{aviso}</p>}
      </div>

      {ctx && (
        <>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-b border-borde pb-3">
            <p className="t-sub font-bold text-titulo">{nivel === 'declarada' ? fmtTelefono(tel) : ctx.paciente.nombre_mostrar ?? fmtTelefono(tel)}
              <span className="ml-2 t-meta font-normal text-secundario">{nivel === 'verificada' ? 'Identidad verificada' : nivel === 'canal' ? 'Verificación parcial' : 'Sin verificar'}</span></p>
            <button onClick={terminar} disabled={ocupado} className={`${outlineBtn} ${apagado}`}>Terminar atención</button>
          </div>

          <h3 className="mt-4 t-sub font-bold text-titulo">Citas del paciente ({citas.length})</h3>
          {citas.length === 0 && <p className="mt-1 t-body">No tiene citas próximas.</p>}
          <ul>
            {citas.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 border-b border-borde py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="t-body text-titulo"><strong className="font-bold">Folio {c.folio}</strong> · {cuando(c)} · {ESTADO_CITA[c.estado] ?? c.estado}</p>
                <button onClick={() => { setElegida(c.id); setCambiando(false); setCancelando(false) }} aria-pressed={elegida === c.id} aria-label={`Elegir la cita con folio ${c.folio}`} className={`${link} shrink-0`}>{elegida === c.id ? 'Elegida' : 'Elegir'}</button>
              </li>
            ))}
          </ul>
          {ctx.tramites_abiertos.length > 0 && (
            <>
              <h3 className="mt-4 t-sub font-bold text-titulo">Trámites abiertos ({ctx.tramites_abiertos.length})</h3>
              <ul>
                {ctx.tramites_abiertos.map((t) => (
                  <li key={t.id} className="flex flex-col gap-1 border-b border-borde py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="t-body text-titulo"><strong className="font-bold">Folio {t.folio}</strong>{t.etiqueta && ` · ${t.etiqueta}`} · {t.paso_descripcion ?? t.paso_actual.replace(/_/g, ' ')}
                      {t.en_atencion_de_otro && <span className="block t-meta font-semibold text-ambar-texto">Lo atiende otra persona</span>}
                      {t.atendido_por_mi && <span className="block t-meta font-semibold text-enlace">Lo estás atendiendo: los demás canales no pueden cambiarlo</span>}</p>
                    {(nivel === 'verificada' || (nivel === 'canal' && canal === 'call_center')) && !t.atendido_por_mi && (
                      <button disabled={ocupado || t.en_atencion_de_otro} onClick={() => hacer(async () => { await p.tomar(i, t.id); return 'Trámite tomado.' })}
                        aria-label={`Tomar el trámite ${t.folio}`} className={`${outlineBtn} ${apagado} shrink-0`}>Tomar trámite</button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {nivel !== 'verificada' && (
            <div className="mt-6">
              <h3 className="t-sub font-bold text-titulo">Verificar identidad</h3>
              {canal === 'clinica' ? (
                <div className="mt-2 grid gap-3 sm:grid-cols-2 sm:items-end">
                  <ElegirDocumento id={`${id}-doc`} valor={doc} onCambio={setDoc} />
                  <button disabled={ocupado} onClick={() => hacer(async () => { await p.verificarDocumento(i, doc); return 'Identidad verificada.' })} className={`${outlineBtn} ${apagado}`}><Icon n="shield" />Ya revisé su identificación</button>
                  <p className="t-meta text-secundario sm:col-span-2">Solo se guarda el tipo de documento, nunca su número.</p>
                </div>
              ) : (
                <div className="mt-2 grid gap-4">
                  {nivel === 'declarada' && !ctx.paciente.tiene_fecha_nacimiento && <p className="t-body">No tiene fecha de nacimiento registrada: se verifica con un código. Llega por WhatsApp al celular registrado.</p>}
                  {nivel === 'declarada' && ctx.paciente.tiene_fecha_nacimiento && (
                    <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                      <div><label htmlFor={`${id}-nac`} className="text-base font-semibold text-titulo">Fecha de nacimiento</label>
                        <input id={`${id}-nac`} type="date" value={nacimiento} onChange={(e) => setNacimiento(e.target.value)} className={campo} /></div>
                      <button disabled={ocupado || !nacimiento} onClick={() => hacer(async () => { const r = await p.verificarNacimiento(i, nacimiento); if (!r.verificado) throw new Error('La fecha no coincide.'); return 'Verificación parcial: ya puedes agendar. Para cambiar o cancelar citas pide el código.' })} className={`${outlineBtn} ${apagado}`}>Comprobar fecha</button>
                    </div>
                  )}
                  {!otpA
                    ? <button disabled={ocupado} onClick={() => hacer(async () => { const r = await p.mandarOtp(i); setOtpA(r.telefono_enmascarado); return 'Código enviado.' }, false)} className={`${outlineBtn} ${apagado} justify-self-start`}><Icon n="chat" />Enviar código al paciente</button>
                    : (
                      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                        <div><label htmlFor={`${id}-otp`} className="text-base font-semibold text-titulo">Código que le llegó al {otpA}</label>
                          <input id={`${id}-otp`} inputMode="numeric" autoComplete="off" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} className={campo} /></div>
                        <button disabled={ocupado || codigo.length !== 6} onClick={() => hacer(async () => { const r = await p.comprobarOtp(i, codigo); setCodigo(''); if (!r.verificado) throw new Error('El código no coincide o ya venció.'); return 'Identidad verificada.' })} className={`${outlineBtn} ${apagado}`}>Comprobar código</button>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}

          {canal === 'call_center' && (
            <CitaTelefono key={i} i={i} ctx={ctx} telefono={tel} ocupado={ocupado}
              hacer={(fn, ok) => hacer(async () => { const r = await fn(); return ok ?? (typeof r === 'string' ? r : undefined) })} />
          )}

          {nivel === 'verificada' && cita && (
            <div className="mt-6 border-t border-borde pt-4">
              <h3 className="t-sub font-bold text-titulo">{cita.estudio}{cita.beneficiario && cita.beneficiario.relacion !== 'titular' && ` · para ${cita.beneficiario.nombre}`}</h3>
              <p className="t-body">{cuando(cita)} · {cita.clinica} · {ESTADO_CITA[cita.estado] ?? cita.estado} · {cita.pagada ? 'Pagada' : 'Sin pagar'}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {modificable && <button onClick={() => { setCambiando(!cambiando); setCancelando(false) }} disabled={ocupado} aria-expanded={cambiando} className={`${outlineBtn} ${apagado}`}><Icon n="calendar" />Cambiar fecha u hora</button>}
                {!cita.pagada && puedeCobrar && <Cobrar ocupado={ocupado} onCobrar={(m) => hacer(async () => { await p.cobrar(cita.id, m); return 'Cobro registrado (de prueba).' })} />}
                {modificable && <button onClick={() => { setCancelando(!cancelando); setCambiando(false) }} disabled={ocupado} aria-expanded={cancelando} className={`${link} ${apagado}`}>Cancelar cita</button>}
              </div>
              {!cita.pagada && !puedeCobrar && canal === 'clinica' && <p className="mt-2 t-body text-titulo">Esta cita es en {cita.clinica}: se cobra allá o el paciente paga en línea.</p>}
              {cancelando && (
                <div className="mt-3 rounded-lg bg-resaltado px-4 py-3">
                  <p className="t-body text-titulo">¿Cancelar la cita {cita.folio}?{cita.pagada && ' El pago quedará marcado para reembolso.'}</p>
                  <div className="flex flex-wrap gap-x-6">
                    <button disabled={ocupado} onClick={() => hacer(async () => { const r = await p.cancelar(i, cita.id, 'Cancelada por el personal a petición del paciente'); return r.reembolso ? 'Cita cancelada; pago marcado para reembolso.' : 'Cita cancelada.' })} className={link}>Sí, cancelar</button>
                    <button onClick={() => setCancelando(false)} className={link}>No, conservarla</button>
                  </div>
                </div>
              )}
              {cambiando && <CambiarFecha id={`${id}-cf`} ocupado={ocupado} consultar={(d, h) => p.horariosDeCita(cita, d, h)}
                onGuardar={(fh) => hacer(async () => { await p.reprogramar(i, cita.id, fh); return 'Cita reprogramada.' })} />}
            </div>
          )}
          {nivel === 'verificada' && !cita && citas.length > 0 && <p className="mt-4 t-body text-titulo">Elige una cita para ver su detalle y sus acciones.</p>}
        </>
      )}
    </section>
  )
}

/** Cobro en caja con su método. */
export function Cobrar({ ocupado, onCobrar }: { ocupado: boolean; onCobrar: (m: 'efectivo' | 'tarjeta') => void }) {
  const [abierto, setAbierto] = useState(false)
  if (!abierto) return <button onClick={() => setAbierto(true)} disabled={ocupado} className={`${outlineBtn} ${apagado}`}><Icon n="tarjeta" />Cobrar en caja</button>
  return (
    <span role="group" aria-label="Método de cobro" className="flex flex-wrap items-center gap-3">
      <button disabled={ocupado} onClick={() => onCobrar('efectivo')} className={`${outlineBtn} ${apagado}`}>Cobrar en efectivo</button>
      <button disabled={ocupado} onClick={() => onCobrar('tarjeta')} className={`${outlineBtn} ${apagado}`}>Cobrar con tarjeta</button>
      <button onClick={() => setAbierto(false)} className={link}>No cobrar</button>
    </span>
  )
}
