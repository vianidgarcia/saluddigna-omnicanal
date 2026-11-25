import { useEffect, useState } from 'react'
import { useApp } from '../context'
import { TOTAL_PASOS, avance, CANAL, ICONO_CANAL, TICK_MS, clinicaTexto, estadoTexto, fechaLarga, hace, fmtHora } from '../state/tramite'
import { FormCelular } from './FormCelular'
import { Icon } from './Icon'
import { WA, avisoDe, link, solidBtn } from './ui'

// tarjeta clara (antes azul marino): mismo peso visual que el buscador de al lado, texto oscuro más fácil de leer
const card = 'flex flex-col rounded-2xl border border-borde bg-superficie p-6 text-cuerpo lg:h-full lg:p-10'
const primario = solidBtn
const enlace = `${link} justify-center underline`

export function ContinueCard() {
  const { tramite: actual, continuar, startAgendar, contextoApi, enlaceApi, go, retomarApi, verificarCelular, toast } = useApp()
  const verificado = contextoApi?.sesion.nivel_verificacion === 'verificada'
  // un trámite recién abierto, sin nada elegido, no tapa lo pendiente de otros canales
  const t = actual && enlaceApi === 'listo' && actual.estado === 'en_curso' && !actual.estudio ? null : actual
  const proximas = contextoApi?.citas_proximas?.length ?? 0
  const pendiente = contextoApi?.tramites_abiertos[0]
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  // lo que quedó a medias en otro canal (WhatsApp, Call Center, clínica)
  if (!t && pendiente) {
    return (
      <section aria-labelledby="continua" className={card}>
        <h2 id="continua" className="t-sub font-semibold text-secundario">Tienes pendiente</h2>
        <h3 className="mt-6 font-head t-card text-titulo">{pendiente.etiqueta ?? 'Trámite abierto'}</h3>
        <p className="mt-1 t-body">Folio {pendiente.folio} · Sigue: {pendiente.paso_descripcion ?? 'continuar'}</p>
        {pendiente.ultimo_canal && <p className="mt-1 t-meta text-secundario">Último movimiento por {CANAL[pendiente.ultimo_canal === 'app' ? 'web' : pendiente.ultimo_canal]}</p>}
        <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6 lg:mt-auto lg:pt-8">
          <button onClick={() => { void retomarApi(pendiente.id).catch((e: unknown) => toast(avisoDe(e))) }} disabled={pendiente.en_atencion_de_otro} className={primario}>{pendiente.en_atencion_de_otro ? 'Te está atendiendo una persona' : 'Continuar'}<Icon n="arrow" /></button>
          <button onClick={() => startAgendar()} className={enlace}>Empezar otro</button>
        </div>
      </section>
    )
  }

  // modo api: lo primero es el celular, para encontrar lo que empezó en cualquier canal
  if (!t && enlaceApi === 'listo' && !verificado) {
    return (
      <section aria-labelledby="continua" className={card}>
        <h2 id="continua" className="font-head t-card text-titulo">¿Cuál es tu celular?</h2>
        <p className="mt-3 t-body">Con tu número revisamos si tienes algo pendiente por WhatsApp, Call Center o en la clínica, y lo sigues aquí. Si no, agendas en 4 pasos.</p>
        <FormCelular id="inicio" texto="Continuar" onTelefono={verificarCelular} />
        <a href={WA} target="_blank" rel="noopener" className={`${enlace} mt-4 lg:mt-auto`}><Icon n="chat" />Agendar por WhatsApp</a>
      </section>
    )
  }

  if (!t) {
    return (
      <section aria-labelledby="continua" className={card}>
        <h2 id="continua" className="font-head t-card text-titulo">Agenda tu próximo estudio</h2>
        {verificado && proximas > 0 && <p className="mt-3 t-body">Tienes {proximas === 1 ? '1 cita próxima' : `${proximas} citas próximas`}. <button onClick={() => go('tramites')} className={link}>{proximas === 1 ? 'Ver mi cita' : 'Ver mis citas'}</button></p>}
        <p role="status" className="mt-3 t-body">{verificado ? 'No tienes nada pendiente.' : 'Aún no tienes trámites en curso.'} Agenda en 4 pasos; si te interrumpes, aquí retomas donde te quedaste, desde la web o por WhatsApp.</p>
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
