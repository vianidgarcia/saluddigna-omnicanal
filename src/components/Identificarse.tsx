/* Antes del paso 1, solo en modo api y con conexión: celular por código y nombre. Así cada paso se guarda en la base
   y la misma conversación sigue en WhatsApp, el Call Center o la clínica. Si ya hay pendientes, se ofrecen primero.
   Carga diferida (arrastra Supabase). */
import { useState } from 'react'
import { useApp } from '../context'
import { canalDesdeApi } from '../api/mapa'
import * as orq from '../api/orquestador'
import { CANAL } from '../state/tramite'
import { FormCelular } from './FormCelular'
import { Icon } from './Icon'
import { apagado, avisoDe, outlineBtn, solidBtn } from './ui'

export default function Identificarse({ onListo }: { onListo: (nuevo: boolean) => void }) {
  const { contextoApi: ctx, aplicarApi, retomarApi, verificarCelular } = useApp()
  const [nombre, setNombre] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!ctx) return null

  const hacer = async (fn: () => Promise<void>) => {
    setOcupado(true); setError(null)
    try { await fn() } catch (e) { setError(avisoDe(e)) } finally { setOcupado(false) }
  }
  const aviso = <div role="status" className="empty:hidden">{error && <p className="mt-3 flex items-start gap-2 t-body font-semibold text-error"><Icon n="alert" className="mt-0.5" />{error}</p>}</div>

  if (ctx.sesion.nivel_verificacion !== 'verificada') {
    return (
      <div className="max-w-3xl">
        <h2 className="t-card font-head text-titulo">Primero, tu celular</h2>
        <p className="mt-1 t-body">Usa el mismo número de tu WhatsApp. Así guardamos cada paso y puedes seguir aquí, por WhatsApp o por teléfono sin repetir tus datos.</p>
        <FormCelular id="ident" texto="Continuar" onTelefono={(t) => verificarCelular(t)} />
      </div>
    )
  }
  if (ctx.sesion.requiere_registro?.length) {
    const guardar = () => hacer(async () => { aplicarApi(await orq.guardarNombre(nombre)) })
    const listo = nombre.trim().split(/\s+/).length >= 2
    return (
      <div className="max-w-3xl">
        <h2 className="t-card font-head text-titulo">¿Cómo te llamas?</h2>
        <label htmlFor="ident-n" className="mt-4 block text-base font-semibold text-titulo">Nombre y apellidos</label>
        <input id="ident-n" autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && listo && !ocupado) void guardar() }}
          className="mt-2 h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion" />
        {aviso}
        <button onClick={guardar} disabled={ocupado || !listo} className={`${solidBtn} mt-4`}>{ocupado ? 'Guardando…' : 'Continuar'}</button>
      </div>
    )
  }
  return (
    <div className="max-w-3xl">
      <h2 className="t-card font-head text-titulo">Tienes algo pendiente</h2>
      <p className="mt-1 t-body">Puedes continuarlo justo donde te quedaste o empezar otro.</p>
      <ul className="mt-3">
        {ctx.tramites_abiertos.map((x) => (
          <li key={x.id} className="flex flex-col gap-2 border-b border-borde py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="t-body font-semibold text-titulo">{x.etiqueta ?? 'Trámite abierto'}</p>
              <p className="t-meta text-secundario">Folio {x.folio} · Sigue: {x.paso_descripcion ?? 'continuar'}{x.ultimo_canal && ` · último movimiento por ${CANAL[canalDesdeApi(x.ultimo_canal)]}`}</p>
              {x.en_atencion_de_otro && <p className="t-meta font-semibold text-ambar-texto">Te está atendiendo una persona.</p>}
            </div>
            <button disabled={ocupado || x.en_atencion_de_otro} onClick={() => hacer(async () => { await retomarApi(x.id); onListo(false) })}
              aria-label={`Continuar ${x.etiqueta ?? 'trámite'}, folio ${x.folio}`} className={`${outlineBtn} ${apagado} shrink-0`}>Continuar<Icon n="arrow" /></button>
          </li>
        ))}
      </ul>
      {aviso}
      <button onClick={() => onListo(true)} disabled={ocupado} className={`${solidBtn} mt-6`}>Agendar otra cita<Icon n="arrow" /></button>
    </div>
  )
}
