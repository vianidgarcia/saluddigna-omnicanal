import { useEffect, useState } from 'react'
import { useApp } from '../context'
import { TOTAL_PASOS, avance, CANAL, ICONO_CANAL, TICK_MS, clinicaTexto, estadoTexto, fechaLarga, hace, fmtHora } from '../state/tramite'
import { Icon } from './Icon'
import { WA, link, solidBtn } from './ui'

// tarjeta clara (antes azul marino): mismo peso visual que el buscador de al lado, texto oscuro más fácil de leer
const card = 'flex flex-col rounded-2xl border border-borde bg-superficie p-6 text-cuerpo lg:h-full lg:p-10'
const primario = solidBtn
const enlace = `${link} justify-center underline`

export function ContinueCard() {
  const { tramite: t, continuar, startAgendar } = useApp()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  if (!t) {
    return (
      <section aria-labelledby="continua" className={card}>
        <h2 id="continua" className="font-head t-card text-titulo">Agenda tu próximo estudio</h2>
        <p className="mt-3 t-body">Aún no tienes trámites en curso. Agenda en 4 pasos; si te interrumpes, aquí retomas donde te quedaste, desde la web o por WhatsApp.</p>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6 lg:mt-auto lg:pt-8">
          <button onClick={() => startAgendar()} className={primario}><Icon n="calendar" />Agendar cita</button>
          <a href={WA} target="_blank" rel="noopener" className={enlace}><Icon n="chat" />Agendar por WhatsApp</a>
        </div>
      </section>
    )
  }

  const confirmada = t.estado === 'confirmada'
  const paso = t.estado === 'pago_pendiente' ? TOTAL_PASOS : t.paso
  const waText = encodeURIComponent(`Hola, quiero continuar mi trámite ${t.id}`)
  return (
    <section aria-labelledby="continua" className={card}>
      <h2 id="continua" className="t-sub font-semibold text-secundario">{confirmada ? 'Tu próxima cita' : 'Continúa donde te quedaste'}</h2>
      <div className="mt-6">
        <h3 className="font-head t-card text-titulo">{t.estudio?.nombre ?? 'Cita por agendar'}</h3>
        <p className="mt-1 t-body">
          {clinicaTexto(t)} · <strong className={`font-bold ${confirmada ? 'text-verde' : 'text-titulo'}`}>{confirmada && <Icon n="check" size={18} className="mr-1 inline -translate-y-px" />}{estadoTexto(t)}</strong>
        </p>
        {confirmada && t.fecha && <p className="mt-1 t-body first-letter:uppercase">{fechaLarga(t.fecha)} · {fmtHora(t.hora)}</p>}
      </div>
      {!confirmada && (
        <div className="mt-8">
          <p className="t-sub font-semibold text-titulo">Paso {paso} de {TOTAL_PASOS}</p>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL_PASOS} aria-valuenow={paso} aria-valuetext={`Paso ${paso} de ${TOTAL_PASOS}`} aria-label="Avance del trámite" className="mt-2 h-2 rounded-full bg-resaltado">
            <div className="h-full rounded-full bg-accion-hover transition-[width]" style={{ width: `${avance(paso)}%` }} />
          </div>
        </div>
      )}
      <ul className="mt-6 flex flex-col gap-2 border-t border-borde pt-6 t-meta text-cuerpo">
        <li className="flex items-center gap-2"><Icon n={ICONO_CANAL[t.canalInicio]} size={20} className="text-icono" />Iniciado en {CANAL[t.canalInicio]}</li>
        <li className="flex items-center gap-2" aria-live="polite"><Icon n={ICONO_CANAL[t.ultimoCanal]} size={20} className="text-icono" />Último movimiento por {CANAL[t.ultimoCanal]}, {hace(t.ultimaActualizacion, now)}</li>
      </ul>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
        <button onClick={continuar} className={primario}>
          {confirmada ? 'Ver mi cita' : 'Continuar trámite'}<Icon n="arrow" />
        </button>
        <a href={`${WA}?text=${waText}`} target="_blank" rel="noopener" className={enlace}>
          <Icon n="chat" />Seguir por WhatsApp
        </a>
      </div>
    </section>
  )
}
