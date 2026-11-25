import { Suspense, lazy } from 'react'
import { useApp } from '../context'
import { Back } from '../components/Back'
import { Icon } from '../components/Icon'
import { BotonComprobante } from '../components/BotonComprobante'
import { container, outlineBtn, solidBtn } from '../components/ui'
import { TOTAL_PASOS, CANAL, clinicaTexto, estadoTexto, fechaLarga, hace, fmtHora } from '../state/tramite'

/* Diferida: solo modo api, arrastra Supabase. */
const CitasApi = lazy(() => import('../components/CitasApi'))

export function Tramites() {
  const { enlaceApi } = useApp()
  return (
    <div className={`${container} py-8 lg:py-12`}>
      <Back />
      <h1 className="mt-4 t-greeting font-head text-titulo">Mis trámites</h1>
      <TramiteLocal />
      {(enlaceApi === 'listo' || enlaceApi === 'conectando') && <Suspense fallback={<p role="status" className="mt-8 t-body text-secundario">Cargando tus citas…</p>}><CitasApi /></Suspense>}
    </div>
  )
}

function TramiteLocal() {
  const { tramite: t, continuar, startAgendar } = useApp()
  if (!t) {
    return (
      <div className="mt-6 max-w-3xl border-t border-borde pt-6">
        <p className="t-body text-titulo">No tienes trámites en curso en este dispositivo.</p>
        <button onClick={() => startAgendar()} className={`${solidBtn} mt-4`}><Icon n="calendar" />Agendar cita</button>
      </div>
    )
  }
  const confirmada = t.estado === 'confirmada'
  const paso = t.estado === 'pago_pendiente' ? TOTAL_PASOS : t.paso
  return (
      <section aria-labelledby="tr-t" className="mt-6 max-w-3xl border-t border-borde pt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 id="tr-t" className="t-card font-head text-titulo">{t.estudio?.nombre ?? 'Cita por agendar'}</h2>
            <p className="mt-1 t-body">{clinicaTexto(t)}{t.fecha && t.hora ? <> · <span className="first-letter:uppercase">{fechaLarga(t.fecha)}, {fmtHora(t.hora)}</span></> : null}</p>
            <p className="mt-2">
              {confirmada
                ? <span className="inline-flex items-center gap-2 t-body font-semibold text-verde"><Icon n="check" size={18} />Cita confirmada</span>
                : <span className="inline-flex items-center gap-2 rounded-full bg-ambar-fondo px-3 py-1 t-meta font-semibold text-ambar-texto"><span aria-hidden="true" className="size-2 rounded-full bg-ambar" />Paso {paso} de {TOTAL_PASOS} · {estadoTexto(t)}</span>}
            </p>
            <p className="mt-2 t-meta text-secundario">Folio {t.id} (de ejemplo) · Iniciado en {CANAL[t.canalInicio]} · Último movimiento por {CANAL[t.ultimoCanal]}, {hace(t.ultimaActualizacion)}</p>
          </div>
          {confirmada
            ? <div className="flex shrink-0 flex-col gap-3"><BotonComprobante t={t} /><button onClick={() => startAgendar()} className={outlineBtn}><Icon n="calendar" />Agendar otra cita</button></div>
            : <button onClick={continuar} className={`${solidBtn} shrink-0`}>Continuar trámite<Icon n="arrow" /></button>}
        </div>
      </section>
  )
}
