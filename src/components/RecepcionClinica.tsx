/* Recepción: llegadas de hoy de una clínica y mostrador (docs/GUIA_APP_PWA.md, 7.3). Solo modo api; carga diferida.
   Recepción opera su clínica (viene en la cuenta); el administrador la elige. */
import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../context'
import type { CitaAgenda, Clinica, TipoDocumento } from '../api/api'
import { partirFechaHora } from '../api/mapa'
import * as p from '../api/personal'
import { fechaLarga, fmtHora } from '../state/tramite'
import AtencionCitas, { Cobrar, ElegirDocumento, ESTADO_CITA } from './AtencionCitas'
import { Icon } from './Icon'
import { apagado, avisoDe, link, outlineBtn } from './ui'

/** Hoy en la zona de la clínica (no la del dispositivo). */
const hoyEn = (zona: string) => partirFechaHora(new Date().toISOString(), zona)[0]

export default function RecepcionClinica() {
  const { sesion } = useApp()
  const fija = sesion?.clinicaId ?? null
  const [clinicas, setClinicas] = useState<Clinica[]>([])
  const [clinicaId, setClinicaId] = useState(fija ?? '')
  const [agenda, setAgenda] = useState<CitaAgenda[] | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [doc, setDoc] = useState<TipoDocumento>('ine')
  const [preparacion, setPreparacion] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => { let vivo = true; void p.clinicas().then((l) => { if (vivo) setClinicas(l) }).catch((e: unknown) => { if (vivo) setError(avisoDe(e)) }); return () => { vivo = false } }, [])
  const clinica = clinicas.find((c) => c.id === clinicaId)
  const zona = clinica?.zona_horaria
  const hoy = zona ? hoyEn(zona) : ''

  // se descarta la respuesta de una clínica que ya no es la elegida
  useEffect(() => {
    if (!clinicaId || !zona) return
    let vivo = true
    setAgenda(null)
    void p.agenda(clinicaId, hoyEn(zona)).then((a) => { if (vivo) setAgenda(a) }).catch((e: unknown) => { if (vivo) { setAgenda([]); setError(avisoDe(e)) } })
    return () => { vivo = false }
  }, [clinicaId, zona, vuelta])
  const cargar = useCallback(() => { setError(null); setVuelta((n) => n + 1) }, [])

  const hacer = async (fn: () => Promise<string>) => {
    setOcupado(true); setError(null); setAviso(null)
    try { setAviso(await fn()); setAbierta(null) } catch (e) { setError(avisoDe(e)) }
    setVuelta((n) => n + 1)
    setOcupado(false)
  }

  return (
    <>
      <section aria-labelledby="ll-t" className="mt-8 max-w-3xl">
        <h2 id="ll-t" className="t-section font-head text-titulo">Llegadas de hoy{clinica && ` · ${clinica.nombre}`}</h2>
        {hoy && <p className="mt-1 t-meta text-secundario first-letter:uppercase">{fechaLarga(hoy)}</p>}
        {!fija && (
          <div className="mt-4">
            <label htmlFor="rc-cl" className="text-base font-semibold text-titulo">Clínica</label>
            <select id="rc-cl" value={clinicaId} onChange={(e) => { setClinicaId(e.target.value); setAbierta(null); setError(null); setAviso(null) }}
              className="mt-2 h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo">
              <option value="">Elige una clínica</option>
              {[...clinicas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.ciudad}, {c.estado}</option>)}
            </select>
          </div>
        )}
        <div role="status" className="mt-3">
          {error && <p className="flex items-start gap-2 t-body font-semibold text-error"><Icon n="alert" className="mt-0.5" />{error}</p>}
          {aviso && <p className="flex items-start gap-2 t-body font-semibold text-titulo"><Icon n="check" className="mt-0.5 text-enlace" />{aviso}</p>}
          {clinicaId && !agenda && !error && <p className="t-body text-secundario">Consultando la agenda…</p>}
          {agenda?.length === 0 && !error && <p className="rounded-lg bg-resaltado px-4 py-3 t-body text-titulo">No hay citas para hoy en esta clínica.</p>}
        </div>
        {clinicaId && <button onClick={cargar} disabled={ocupado} className={link}><Icon n="refresh" />Actualizar agenda</button>}
        <ul>
          {(agenda ?? []).map((c) => (
            <li key={c.cita_id} className="border-b border-borde py-4">
              <p className="t-body font-semibold text-titulo">{fmtHora(partirFechaHora(c.fecha_hora, zona)[1])} · {c.paciente} · {c.estudio}</p>
              <p className="t-meta text-secundario">Folio {c.folio ?? '—'} · {c.area_nombre} · {ESTADO_CITA[c.estado] ?? c.estado} · {c.pagada ? 'Pagada' : 'Sin pagar'}{c.turno && ` · Turno ${c.turno}`}{c.agendada_por && !c.es_titular && ` · Agendó ${c.agendada_por}`}</p>
              {c.preparacion && <p className="t-meta text-secundario">Preparación: {c.preparacion}</p>}
              <div className="mt-2 flex flex-wrap gap-3">
                {(c.estado === 'reservada' || c.estado === 'confirmada') && <button onClick={() => { setAbierta(abierta === c.cita_id ? null : c.cita_id); setDoc('ine'); setPreparacion(true) }} disabled={ocupado} aria-expanded={abierta === c.cita_id} aria-label={`Registrar llegada de ${c.paciente}`} className={`${outlineBtn} ${apagado}`}><Icon n="user" />Registrar llegada</button>}
                {!c.pagada && (c.estado === 'reservada' || c.estado === 'en_clinica') && <Cobrar ocupado={ocupado} onCobrar={(m) => hacer(async () => { await p.cobrar(c.cita_id, m); return `Cobro de ${c.paciente} registrado (de prueba).` })} />}
                {c.estado === 'en_clinica' && <button disabled={ocupado} onClick={() => hacer(async () => { await p.atendida(c.cita_id); return `${c.paciente}: estudio realizado.` })} className={`${outlineBtn} ${apagado}`}><Icon n="check" />Marcar atendida</button>}
              </div>
              {abierta === c.cita_id && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:items-end">
                  <ElegirDocumento id={`doc-${c.cita_id}`} valor={doc} onCambio={setDoc} />
                  <label className="flex min-h-12 items-center gap-3 t-body text-titulo"><input type="checkbox" checked={preparacion} onChange={(e) => setPreparacion(e.target.checked)} className="size-5 accent-accion-hover" />Cumplió la preparación</label>
                  <button disabled={ocupado} onClick={() => hacer(async () => { const r = await p.llegada(c.cita_id, doc, preparacion); return `Turno ${r.turno} para ${c.paciente}. ${r.indicacion}` })} className={`${outlineBtn} ${apagado} sm:col-span-2`}><Icon n="check" />Confirmar llegada</button>
                  <p className="t-meta text-secundario sm:col-span-2">Revisa la identificación de quien recibe el estudio. Solo se guarda el tipo de documento.</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <AtencionCitas canal="clinica" clinicaId={clinicaId || null} />
    </>
  )
}
