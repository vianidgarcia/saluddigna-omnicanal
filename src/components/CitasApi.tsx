/* Citas y pendientes del paciente en TODOS los canales (solo modo api; carga diferida: arrastra Supabase).
   Las reglas (cupo, plazos, reembolso, bloqueo del personal) las decide la base: aquí solo se muestran. */
import { useState } from 'react'
import { useApp } from '../context'
import type { Horario } from '../api/api'
import type { Cita } from '../api/citas'
import { partirFechaHora, zonaDe } from '../api/mapa'
import * as orq from '../api/orquestador'
import { CANAL, fechaLarga, fmtHora } from '../state/tramite'
import { canalDesdeApi } from '../api/mapa'
import { FormCelular } from './FormCelular'
import { Icon } from './Icon'
import { SelectorHorario } from './SelectorHorario'
import { avisoDe, apagado, link, outlineBtn } from './ui'

const ESTADO: Record<string, string> = { reservada: 'Apartada · pago pendiente', confirmada: 'Confirmada', en_clinica: 'Ya estás en la clínica' }
const cuando = (c: Cita) => { const [f, h] = partirFechaHora(c.fecha_hora, zonaDe(c.clinica)); return f ? `${fechaLarga(f)}, ${fmtHora(h)}` : '' }

export default function CitasApi() {
  const { contextoApi: ctx, aplicarApi, retomarApi, verificarCelular, toast } = useApp()
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cambiando, setCambiando] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<string | null>(null)

  if (!ctx) return <p role="status" className="mt-8 t-body text-secundario">Consultando tus citas…</p>

  const hacer = async (fn: () => Promise<string | void>) => {
    setOcupado(true); setError(null)
    try {
      const m = await fn()
      if (m) toast(m)
      setCambiando(null); setCancelando(null)
    } catch (e) {
      setError(avisoDe(e))
      // otro canal pudo moverla: se muestra lo que hay ahora
      try { aplicarApi(await orq.sincronizar()) } catch { /* sin conexión: queda el aviso */ }
    } finally { setOcupado(false) }
  }

  if (ctx.sesion.nivel_verificacion !== 'verificada') {
    return (
      <section aria-labelledby="mc-t" className="mt-10 max-w-3xl border-t border-borde pt-6">
        <h2 id="mc-t" className="t-card font-head text-titulo">Mis citas en todos los canales</h2>
        <p className="mt-1 t-body">Confirma tu celular para ver, cambiar o cancelar las citas que hiciste por web, WhatsApp, Call Center o en la clínica.</p>
        <FormCelular id="mc" onTelefono={(t) => verificarCelular(t)} />
      </section>
    )
  }

  const citas = (ctx.citas_proximas ?? []) as Cita[]
  // un trámite con su cita ya apartada también viene abierto: se muestra en los pendientes para terminarlo
  const abiertos = ctx.tramites_abiertos
  const bloqueo = (folio?: string) => abiertos.find((x) => x.folio === folio && x.en_atencion_de_otro)

  return (
    <section aria-labelledby="mc-t" className="mt-10 max-w-3xl border-t border-borde pt-6">
      <h2 id="mc-t" className="t-card font-head text-titulo">Mis citas en todos los canales</h2>
      <div role="status" className="empty:hidden">{error && <p className="mt-3 flex items-start gap-2 t-body font-semibold text-error"><Icon n="alert" className="mt-0.5" />{error}</p>}</div>

      {abiertos.length > 0 && (
        <div className="mt-4">
          <h3 className="t-sub font-bold text-titulo">Pendientes</h3>
          <ul>
            {abiertos.map((x) => (
              <li key={x.id} className="flex flex-col gap-2 border-b border-borde py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="t-body font-semibold text-titulo">{x.etiqueta ?? 'Trámite abierto'}</p>
                  <p className="t-meta text-secundario">Folio {x.folio} · {x.paso_descripcion ?? 'En curso'}{x.ultimo_canal && ` · último movimiento por ${CANAL[canalDesdeApi(x.ultimo_canal)]}`}</p>
                  {x.en_atencion_de_otro && <p className="mt-1 t-meta font-semibold text-ambar-texto">Te está atendiendo una persona{x.atencion_canal === 'clinica' ? ' en la clínica' : ' del Call Center'}: puedes verlo, pero no cambiarlo.</p>}
                </div>
                <button onClick={() => hacer(async () => { await retomarApi(x.id) })} disabled={ocupado || x.en_atencion_de_otro}
                  aria-label={`Continuar ${x.etiqueta ?? 'trámite'}, folio ${x.folio}`} className={`${outlineBtn} ${apagado} shrink-0`}>Continuar<Icon n="arrow" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="mt-6 t-sub font-bold text-titulo">Próximas citas</h3>
      {citas.length === 0 && <p className="mt-2 t-body">No tienes citas próximas.</p>}
      <ul>
        {citas.map((c) => {
          const atendida = bloqueo(c.folio)
          const editable = c.estado !== 'en_clinica' && !atendida
          const para = c.beneficiario && c.beneficiario.relacion !== 'titular' ? c.beneficiario.nombre : null
          return (
            <li key={c.id} className="border-b border-borde py-4">
              <p className="t-body font-semibold text-titulo">{c.estudio}{para && ` · para ${para}`}</p>
              <p className="t-body first-letter:uppercase">{cuando(c)} · {c.clinica}</p>
              <p className="t-meta text-secundario">Folio {c.folio} · {ESTADO[c.estado] ?? c.estado}{c.pagada && ' · Pagada (de prueba)'}{c.turno && ` · Turno ${c.turno}${c.area ? ` en ${c.area}` : ''}`}</p>
              {atendida && <p className="mt-1 t-meta font-semibold text-ambar-texto">Te está atendiendo una persona: por ahora no puedes cambiarla.</p>}
              {editable && (
                <div className="mt-2 flex flex-wrap gap-3">
                  <button onClick={() => { setCambiando(cambiando === c.id ? null : c.id); setCancelando(null); setError(null) }} disabled={ocupado} aria-expanded={cambiando === c.id}
                    aria-label={`Cambiar fecha de ${c.estudio}`} className={`${outlineBtn} ${apagado}`}><Icon n="calendar" />Cambiar fecha</button>
                  <button onClick={() => { setCancelando(cancelando === c.id ? null : c.id); setCambiando(null); setError(null) }} disabled={ocupado} aria-expanded={cancelando === c.id}
                    aria-label={`Cancelar cita de ${c.estudio}`} className={`${link} ${apagado}`}>Cancelar cita</button>
                </div>
              )}
              {cancelando === c.id && (
                <div role="group" aria-label="Confirmar cancelación" className="mt-3 rounded-lg bg-resaltado px-4 py-3">
                  <p className="t-body text-titulo">¿Cancelar esta cita?{c.pagada && ' Como ya está pagada, quedará marcada para reembolso.'}</p>
                  <div className="mt-1 flex flex-wrap gap-x-6">
                    <button disabled={ocupado} className={link} onClick={() => hacer(async () => {
                      const r = await orq.cancelar(c.id, 'Cancelada por el paciente desde el portal')
                      aplicarApi(r.ctx)
                      return r.reembolso ? 'Cita cancelada. El pago quedó marcado para reembolso.' : 'Cita cancelada.'
                    })}>{ocupado ? 'Cancelando…' : 'Sí, cancelar'}</button>
                    <button disabled={ocupado} onClick={() => setCancelando(null)} className={link}>No, conservarla</button>
                  </div>
                </div>
              )}
              {cambiando === c.id && (
                <CambiarFecha id={`cf-${c.id}`} ocupado={ocupado} consultar={(d, h) => orq.horariosDeCita(c, d, h)}
                  onGuardar={(fh) => hacer(async () => { aplicarApi(await orq.reprogramar(c.id, fh)); return 'Tu cita cambió de fecha.' })} />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Elegir otro horario de una cita (paciente y personal). Misma clínica y estudio. */
export function CambiarFecha({ id, ocupado, consultar, onGuardar }: {
  id: string; ocupado: boolean
  consultar: (desde: string, hasta: string) => Promise<Horario[] | null>
  onGuardar: (fechaHora: string) => void
}) {
  const [fecha, setFecha] = useState<string | null>(null)
  const [hora, setHora] = useState<string | null>(null)
  const [lista, setLista] = useState<Horario[]>([])
  const pedir = async (d: string, h: string) => {
    const r = await consultar(d, h)
    if (r) setLista((x) => [...x, ...r])
    return r
  }
  const elegido = lista.find((x) => x.fecha === fecha && x.hora.slice(0, 5) === hora)
  return (
    <div className="mt-4">
      <SelectorHorario id={id} consultar={pedir} fecha={fecha} hora={hora} onFecha={(v) => { setFecha(v); setHora(null) }} onHora={setHora} />
      {fecha && hora && !elegido && <p role="status" className="mt-2 t-meta text-error">Ese horario no está confirmado por la clínica. Elige otro o intenta más tarde.</p>}
      <button onClick={() => elegido && onGuardar(elegido.fecha_hora)} disabled={ocupado || !elegido} className={`${outlineBtn} ${apagado} mt-3`}>
        <Icon n="check" />{ocupado ? 'Guardando…' : 'Guardar nueva fecha'}
      </button>
    </div>
  )
}
