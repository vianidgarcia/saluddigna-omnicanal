/* Pago de prueba del orquestador (Edge Function pago-demo, sin cargo). Solo modo api; carga diferida.
   Sirve para el paso 4 del agendado (por folio) y para la liga /pagar/:referencia que llega por WhatsApp. */
import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../context'
import type { PagoPorPagar } from '../api/citas'
import { partirFechaHora } from '../api/mapa'
import * as orq from '../api/orquestador'
import { fechaLarga, fmtHora, horaEvento } from '../state/tramite'
import { FormCelular } from './FormCelular'
import { Icon } from './Icon'
import { apagado, avisoDe, link, outlineBtn, solidBtn } from './ui'

const dinero = (n: number, moneda = 'MXN') => new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda }).format(n)

export default function PagoApi({ folio, referencia, onSimular, onReintentar }: {
  folio?: string; referencia?: string
  /** volver a la pasarela simulada (solo en el agendado) */
  onSimular?: () => void
  /** volver a mandar el trámite a la base */
  onReintentar?: () => void
}) {
  const { contextoApi: ctx, aplicarApi, enviandoApi, verificarCelular, go, enlaceApi } = useApp()
  const [pagos, setPagos] = useState<PagoPorPagar[] | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [pagado, setPagado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const verificado = ctx?.sesion.nivel_verificacion === 'verificada'

  const cargar = useCallback(async () => {
    try { setPagos(await orq.porPagar()); setError(null) } catch (e) { setError(avisoDe(e)) }
  }, [])
  // cada cambio del contexto (otro canal pudo pagar) vuelve a pedir lo pendiente
  useEffect(() => { if (verificado && !enviandoApi) void cargar() }, [verificado, enviandoApi, ctx, cargar])

  const p = pagos?.find((x) => (referencia ? x.referencia.toUpperCase() === referencia.toUpperCase() : x.folio === folio))
  const bloqueado = ctx?.tramites_abiertos.some((x) => x.folio === p?.folio && x.en_atencion_de_otro)

  const pagar = async () => {
    if (!p) return
    setOcupado(true); setError(null)
    try { const c = await orq.pagar(p.referencia); setPagado(true); aplicarApi(c); if (folio) go('agendar') } catch (e) { setError(avisoDe(e)); void cargar() } finally { setOcupado(false) }
  }

  if (pagado) {
    return (
      <div className="mt-8 max-w-3xl">
        <p role="status" className="flex items-center gap-2 t-body font-semibold text-verde"><Icon n="check" />Pago de prueba registrado: tu cita quedó confirmada.</p>
        <button onClick={() => go('tramites')} className={`${solidBtn} mt-4`}>Ver mis citas</button>
      </div>
    )
  }
  if (!ctx || enlaceApi === 'conectando' || enviandoApi) return <p role="status" className="mt-8 t-body text-secundario">{enviandoApi ? 'Registrando tu cita…' : 'Conectando…'}</p>
  if (!verificado) {
    return (
      <div className="mt-8 max-w-3xl">
        <p className="t-body text-titulo">Confirma tu celular para pagar: así solo tú puedes ver tus pagos.</p>
        {onReintentar
          ? <button onClick={onReintentar} className={`${solidBtn} mt-4`}>Confirmar mi celular</button>
          : <FormCelular id="pago" onTelefono={(t) => verificarCelular(t)} />}
        {onSimular && <button onClick={onSimular} className={`${link} mt-2`}>Usar la pasarela simulada (solo en este dispositivo)</button>}
      </div>
    )
  }
  return (
    <div className="mt-8 max-w-3xl">
      <div role="status" className="empty:hidden">{error && <p className="mb-4 flex items-start gap-2 t-body font-semibold text-error"><Icon n="alert" className="mt-0.5" />{error}</p>}</div>
      {!pagos && !error && <p role="status" className="t-body text-secundario">Buscando tu pago…</p>}
      {p && (
        <section aria-labelledby="pa-t" className="rounded-2xl border border-borde bg-superficie p-6 lg:p-8">
          <h2 id="pa-t" className="t-card font-head text-titulo">{p.etiqueta ?? p.estudio}</h2>
          <p className="mt-2 t-body text-titulo">Total: <strong className="font-bold">{dinero(p.monto, p.moneda)}</strong> <span className="t-meta text-secundario">(monto de ejemplo)</span></p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><dt className="t-meta text-secundario">Folio</dt><dd className="t-body font-semibold text-titulo">{p.folio}</dd></div>
            <div><dt className="t-meta text-secundario">Referencia</dt><dd className="break-all font-mono t-body font-semibold text-titulo">{p.referencia}</dd></div>
            {p.expira_en && <div><dt className="t-meta text-secundario">Paga antes de</dt><dd className="t-body font-semibold text-titulo">{horaEvento(p.expira_en)}</dd></div>}
            {p.fecha_hora && !folio && <div><dt className="t-meta text-secundario">Cita (hora del centro)</dt><dd className="t-body font-semibold text-titulo">{(() => { const [f, h] = partirFechaHora(p.fecha_hora); return `${fechaLarga(f)}, ${fmtHora(h)}` })()}</dd></div>}
          </dl>
          {bloqueado && <p className="mt-4 t-body font-semibold text-ambar-texto">Te está atendiendo una persona: espera a que termine para pagar.</p>}
          <button onClick={pagar} disabled={ocupado || bloqueado} className={`${solidBtn} mt-6 w-full`}><Icon n="candado" />{ocupado ? 'Registrando pago…' : `Pagar ${dinero(p.monto, p.moneda)} (prueba, sin cargo)`}</button>
          <p className="mt-2 t-meta text-secundario">También puedes responder PAGAR por WhatsApp o pagar en la caja de la clínica: aquí lo verás al momento.</p>
        </section>
      )}
      {pagos && !p && (
        <>
          <p className="t-body text-titulo">{referencia ? `No encontramos un pago pendiente con la referencia ${referencia}. Puede que ya esté pagado, que haya vencido o que sea de otro celular.` : 'Tu cita todavía no tiene un pago en el sistema: no se pudo registrar o el pago venció.'}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {onReintentar && <button onClick={onReintentar} className={solidBtn}><Icon n="refresh" />Intentar de nuevo</button>}
            <button onClick={() => void cargar()} className={`${outlineBtn} ${apagado}`}><Icon n="refresh" />Buscar otra vez</button>
            {onSimular && <button onClick={onSimular} className={link}>Usar la pasarela simulada</button>}
            {referencia && <button onClick={() => go('tramites')} className={link}>Ver mis citas</button>}
          </div>
        </>
      )}
    </div>
  )
}
