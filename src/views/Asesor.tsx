import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../context'
import { Icon } from '../components/Icon'
import { ClinicSheet } from '../components/ClinicSheet'
import { BotonComprobante } from '../components/BotonComprobante'
import { SelectorHorario } from '../components/SelectorHorario'
import { container, link, outlineBtn, solidBtn } from '../components/ui'
import { esApi } from '../api/modo'

/* Diferida: solo el personal en modo api la necesita, así no pesa en el arranque del portal. */
const BandejaOmnicanal = lazy(() => import('../components/BandejaOmnicanal').then((m) => ({ default: m.BandejaOmnicanal })))
import { CLINICA_INICIAL, findClinic } from '../data/clinics'
import {
  CANAL, ICONO_CANAL, METODO, PASOS, TIPO_EVENTO, TICK_MS, avance, conEvento, conNota, esNotaInterna,
  fechaLarga, fmtTelefono, hace, horaEvento, TOTAL_PASOS, yaPaso, type Tramite, fmtHora } from '../state/tramite'

const fieldInput = 'w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion'
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function coincide(t: Tramite, q: string): boolean {
  const texto = sinAcentos(q.trim())
  if (!texto) return false
  // por folio (con o sin "SD-") o por el nombre con el que se agendó la cita
  const folio = texto.replace(/^sd-?/, '').replace(/[^a-z0-9]/g, '')
  if (folio && t.id.toLowerCase().replace(/^sd-/, '').includes(folio)) return true
  // por teléfono: con 4 o más dígitos (p. ej. los últimos 4)
  const digitos = q.replace(/\D/g, '')
  if (digitos.length >= 4 && t.paciente.telefono?.includes(digitos)) return true
  return !!t.paciente.nombre && sinAcentos(t.paciente.nombre).includes(texto)
}

const Pendiente = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-2 rounded-full bg-ambar-fondo px-3 py-1 t-meta font-semibold text-ambar-texto">
    <span aria-hidden="true" className="size-2 rounded-full bg-ambar" />{children}
  </span>
)

export function Asesor() {
  const { tramite: t, sesion } = useApp()
  const [q, setQ] = useState('')
  const [buscado, setBuscado] = useState<string | null>(null)
  const [abierta, setAbierta] = useState(false)
  useEffect(() => { if (!t) setAbierta(false) }, [t])

  const buscar = () => { setBuscado(q); setAbierta(false) }
  const encontrado = t && buscado !== null && coincide(t, buscado)

  return (
    <div className={`${container} py-8 lg:py-12`}>
      <h1 className="t-greeting font-head text-titulo">Atención al paciente</h1>
      <p className="mt-2 max-w-3xl t-body">Busca al paciente y retoma su trámite con todo lo que ya hizo en web, WhatsApp o Call Center, sin volver a pedirle sus datos.</p>

      {esApi && (
        <Suspense fallback={<p role="status" className="mt-8 t-body text-secundario">Cargando la bandeja omnicanal…</p>}>
          <BandejaOmnicanal />
        </Suspense>
      )}

      {/* Modo api: la búsqueda y el recorrido del paciente son los de la bandeja (datos reales). La ficha de abajo
          opera sobre el trámite local del navegador y NO escribe en la base, así que solo existe en modo local. */}
      {!esApi && <section className="mt-6 max-w-3xl">
        <h2 className="t-section font-head text-titulo">{esApi ? 'Trámite de este dispositivo' : 'Buscar paciente'}</h2>
        {esApi && <p className="mt-1 t-body">Solo el trámite abierto en este navegador. Para los de otros canales usa la bandeja de arriba.</p>}
        <label id="buscar-l" htmlFor="buscar" className="mt-4 block text-base font-semibold text-titulo">Buscar por folio, nombre o teléfono del paciente</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Icon n="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-secundario" />
            <input id="buscar" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && buscar()}
              aria-describedby="buscar-h" placeholder="Ej. SD-MXK3A9, María López o 667 123 4567" className={`${fieldInput} h-12 pl-12`} />
          </div>
          <button onClick={buscar} className={outlineBtn}><Icon n="search" />Buscar</button>
        </div>
        <p id="buscar-h" className="mt-1 t-meta text-secundario">El paciente ve su folio en “Mis trámites” y en su tarjeta de inicio; nombre y teléfono son los que dio al confirmar. Del teléfono bastan los últimos 4 dígitos.</p>

        <div role="status" className="mt-4">
          {!t && <p className="rounded-lg bg-resaltado px-4 py-3 t-body text-titulo">No hay trámites activos. Inicia uno desde el portal del paciente.</p>}
          {t && buscado !== null && !encontrado && <p className="t-body text-titulo">No encontramos pacientes con “{buscado}”. Revisa el folio, el nombre o el teléfono.</p>}
        </div>
        {t && encontrado && (
          <ul aria-label="Resultados de búsqueda">
            <li className="flex flex-col gap-2 border-y border-borde py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="t-sub font-bold text-titulo">{t.paciente.nombre ?? 'Paciente sin nombre registrado'}<span className="font-normal text-cuerpo"> · Folio {t.id}{t.paciente.telefono && ` · Tel. ${fmtTelefono(t.paciente.telefono)}`}</span></p>
                <p className="t-meta text-secundario">{t.estudio?.nombre ?? 'Estudio por elegir'} · Folio {t.id} (de ejemplo)</p>
              </div>
              <button onClick={() => setAbierta(true)} aria-pressed={abierta} className={`${link} shrink-0`}>{abierta ? 'Ficha abierta' : 'Abrir ficha'}<Icon n="arrow" /></button>
            </li>
          </ul>
        )}
      </section>}

      {!esApi && t && abierta && <Ficha t={t} />}
      {sesion?.rol === 'admin' && <PanelAdmin />}
    </div>
  )
}

/* ---------- ficha del paciente ---------- */
function Ficha({ t }: { t: Tramite }) {
  const { update, sesion, horariosClinica } = useApp()
  const [aviso, setAviso] = useState<string | null>(null)
  const [clinicas, setClinicas] = useState(false)
  const [reagendar, setReagendar] = useState(false)
  const [nf, setNf] = useState<string | null>(t.fecha)
  const [nh, setNh] = useState<string | null>(t.hora)
  const [nota, setNota] = useState('')
  const [, tick] = useState(0)
  useEffect(() => { const id = window.setInterval(() => tick((n) => n + 1), TICK_MS); return () => window.clearInterval(id) }, [])

  const p = t.paciente
  const confirmada = t.estado === 'confirmada'
  const paso = t.estado === 'en_curso' ? t.paso : TOTAL_PASOS
  const c = findClinic(t.clinica)
  const falta = [!t.estudio && 'estudio', !t.clinica && 'clínica', !(t.fecha && t.hora && !yaPaso(t.fecha, t.hora)) && 'fecha y hora vigentes'].filter(Boolean) as string[]
  const autor = sesion?.rol === 'admin' ? 'Administración' : 'Asesor'
  const avisar = (m: string) => setAviso(m)

  const confirmarClinica = (nombre: string) => {
    update((x) => conEvento({ ...x, clinica: nombre, clinicaPendiente: false }, 'asesor.clinica_confirmada', `${autor} confirmó la clínica ${nombre}`, 'call_center'))
    avisar(`Clínica confirmada: ${nombre}`)
  }
  const guardarHorario = () => {
    if (!nf || !nh) return
    update((x) => conEvento({ ...x, fecha: nf, hora: nh }, 'asesor.reagendado', `${autor} reagendó a ${fechaLarga(nf)}, ${fmtHora(nh)} (horario de demostración)`, 'call_center'))
    setReagendar(false)
    avisar(`Cita reagendada: ${fechaLarga(nf)}, ${fmtHora(nh)}`)
  }
  const reenviarReferencia = () => {
    update((x) => conEvento(x, 'pago.referencia_enviada', `${autor} reenvió ${x.metodoPago === 'spei' ? 'los datos de transferencia SPEI' : 'la referencia de pago en Oxxo'} por WhatsApp (demo)`, 'call_center'))
    avisar('Referencia enviada')
  }
  const cerrar = () => {
    update((x) => conEvento({ ...x, estado: 'confirmada', paso: TOTAL_PASOS, metodoPago: x.metodoPago ?? 'en_clinica', desdeResumen: false },
      'cita.confirmada', `${autor} cerró el trámite como confirmado · ${x.fecha ? fechaLarga(x.fecha) : ''} ${fmtHora(x.hora)} · ${METODO[x.metodoPago ?? 'en_clinica']}`, 'call_center'))
    avisar('Trámite cerrado: cita confirmada')
  }
  const guardarNota = () => {
    const texto = nota.trim()
    if (!texto) return
    update((x) => conNota(x, texto, autor))
    setNota('')
    avisar('Nota interna guardada')
  }

  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-12 lg:gap-8">
      <div className="flex flex-col gap-8 lg:col-span-7">
        {/* paciente */}
        <section aria-labelledby="fp-t" className="rounded-2xl border border-borde bg-superficie p-6">
          <h2 id="fp-t" className="t-card font-head text-titulo">Ficha del paciente</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><dt className="t-meta text-secundario">Nombre</dt><dd className="t-body font-semibold text-titulo">{p.nombre ?? 'Aún sin nombre (se pide al confirmar)'}</dd></div>
            <div><dt className="t-meta text-secundario">Teléfono</dt><dd className="t-body font-semibold text-titulo">{p.telefono
              ? <a href={`tel:+52${p.telefono}`} className="text-enlace underline underline-offset-4">{fmtTelefono(p.telefono)}</a>
              : 'Aún sin teléfono (se pide al confirmar)'}</dd></div>
            <div><dt className="t-meta text-secundario">Folio del trámite</dt><dd className="t-body font-semibold text-titulo">{t.id} <span className="t-meta font-normal text-secundario">(de ejemplo)</span></dd></div>
          </dl>
        </section>

        {/* trámite */}
        <section aria-labelledby="ft-t" className="rounded-2xl border border-borde bg-superficie p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="ft-t" className="t-card font-head text-titulo">Estado del trámite</h2>
            {confirmada
              ? <span className="inline-flex items-center gap-2 t-body font-semibold text-verde"><Icon n="check" size={18} />Cita confirmada</span>
              : t.estado === 'pago_pendiente' ? <Pendiente>Pago pendiente en Oxxo</Pendiente> : <Pendiente>En curso</Pendiente>}
          </div>
          <div className="mt-4">
            <p className="t-sub font-semibold text-titulo">Paso {paso} de {TOTAL_PASOS} · {PASOS[paso]}</p>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL_PASOS} aria-valuenow={paso} aria-valuetext={`Paso ${paso} de ${TOTAL_PASOS}: ${PASOS[paso]}${confirmada ? ', confirmado' : ''}`} aria-label="Avance del trámite" className="mt-2 h-2 rounded-full bg-resaltado">
              <div className="h-full rounded-full bg-accion-hover" style={{ width: `${confirmada ? 100 : avance(paso)}%` }} />
            </div>
          </div>
          <dl className="mt-4 divide-y divide-borde">
            <Fila k="Estudio">{t.estudio?.nombre ?? <Pendiente>Sin elegir</Pendiente>}</Fila>
            <Fila k="Clínica">{c ? <>{c.name}<span className="block t-meta font-normal text-secundario">{c.address}</span></> : <Pendiente>Pendiente</Pendiente>}</Fila>
            <Fila k="Fecha y hora">{t.fecha && t.hora ? <span className="first-letter:uppercase">{fechaLarga(t.fecha)} · {fmtHora(t.hora)}</span> : <Pendiente>Sin elegir</Pendiente>}</Fila>
            <Fila k="Método de pago">{t.metodoPago ? <>{METODO[t.metodoPago]}
              {t.pago && <span className="block t-meta font-normal text-secundario">
                {t.pago.estado === 'aprobado' ? `Pago aprobado${t.pago.tarjeta ? ` · ${t.pago.tarjeta.marca} •••• ${t.pago.tarjeta.ultimos4}` : ''}${t.pago.autorizacion ? ` · autorización ${t.pago.autorizacion}` : ''}`
                  : t.pago.estado === 'rechazado' ? `Último intento rechazado: ${t.pago.motivo ?? ''}` : 'Pago pendiente'}
              </span>}</> : <Pendiente>Sin elegir</Pendiente>}</Fila>
            <Fila k="Canales">Inició en {CANAL[t.canalInicio]} · último movimiento por {CANAL[t.ultimoCanal]}, {hace(t.ultimaActualizacion)}</Fila>
          </dl>
        </section>

        {/* acciones */}
        <section aria-labelledby="fa-t">
          <h2 id="fa-t" className="t-card font-head text-titulo">Acciones</h2>
          <p className="mt-1 t-meta text-secundario">Cada acción actualiza el mismo trámite y queda en la línea de tiempo como Call Center.</p>
          <p role="status" className="mt-3 min-h-0 t-body font-semibold text-titulo empty:hidden">{aviso && <span className="inline-flex items-center gap-2 rounded-lg bg-resaltado px-3 py-2"><Icon n="check" size={18} className="text-enlace" />{aviso}</span>}</p>
          {confirmada ? (
            <>
              <p className="mt-4 flex items-center gap-2 t-body font-semibold text-verde"><Icon n="check" />El trámite está cerrado como confirmado. El paciente ya lo ve en su portal.</p>
              <BotonComprobante t={t} canal="call_center" className="mt-3" />
            </>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-3">
                {!t.clinica && <button onClick={() => setClinicas(true)} className={outlineBtn}><Icon n="pin" />Confirmar clínica</button>}
                <button onClick={() => { setReagendar(!reagendar); setNf(t.fecha); setNh(t.hora) }} aria-expanded={reagendar} aria-controls={reagendar ? 'reag' : undefined} className={outlineBtn}><Icon n="calendar" />Reagendar</button>
                {(t.metodoPago === 'oxxo' || t.metodoPago === 'spei') && t.estado === 'pago_pendiente' && <button onClick={reenviarReferencia} className={outlineBtn}><Icon n="chat" />{t.metodoPago === 'spei' ? 'Reenviar datos de transferencia por WhatsApp' : 'Reenviar referencia por WhatsApp'}</button>}
              </div>
              {reagendar && (
                <div id="reag" className="mt-4 border-t border-borde pt-4">
                  <div className="flex flex-wrap items-center gap-x-3"><p className="t-sub font-bold text-titulo">Nueva fecha y hora</p></div>
                  <div className="mt-2">
                    <SelectorHorario id="reag" key={`${t.clinica}|${t.estudio?.nombre}`} consultar={horariosClinica && t.clinica && t.estudio ? (d, h) => horariosClinica(t.clinica!, t.estudio!.nombre, d, h) : undefined} fecha={nf} hora={nh} onFecha={(v) => { if (v !== nf) setNh(null); setNf(v) }} onHora={setNh} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button onClick={guardarHorario} disabled={!nf || !nh} aria-describedby={!nf || !nh ? 'reag-h' : undefined}
                      className={`${outlineBtn} disabled:cursor-not-allowed disabled:border-borde disabled:bg-banda disabled:text-cuerpo`}><Icon n="check" />Guardar nuevo horario</button>
                    <button onClick={() => setReagendar(false)} className={link}>Cancelar</button>
                  </div>
                  {(!nf || !nh) && <p id="reag-h" className="mt-1 t-meta text-secundario">{!nf ? 'Elige un día.' : 'Elige un horario.'}</p>}
                </div>
              )}
              <div className="mt-6 border-t border-borde pt-6">
                {falta.length > 0 && <p id="cerrar-h" className="mb-3 t-body text-cuerpo">Para cerrar falta: {falta.join(', ')}.</p>}
                <button onClick={cerrar} disabled={falta.length > 0} aria-describedby={falta.length ? 'cerrar-h' : undefined} className={`${solidBtn} w-full sm:w-auto`}>
                  <Icon n="check" />Cerrar trámite como confirmado
                </button>
                {!t.metodoPago && falta.length === 0 && <p className="mt-1 t-meta text-secundario">Sin método de pago elegido: se registrará como pago en clínica.</p>}
              </div>
            </>
          )}
        </section>

        {/* nota interna */}
        <section>
          <label id="nota-l" htmlFor="nota" className="flex items-center gap-2 t-card font-head text-titulo"><Icon n="note" />Nota interna</label>
          <p id="nota-h" className="mt-1 t-meta text-secundario">Solo la ven asesores y administradores; no aparece en el portal del paciente.</p>
          <textarea id="nota" value={nota} onChange={(e) => setNota(e.target.value)} rows={3} aria-describedby="nota-h"
            placeholder="Ej. Prefiere que le llamen por la tarde." className={`${fieldInput} mt-2 py-3`} />
          <button onClick={guardarNota} disabled={!nota.trim()} className={`${outlineBtn} mt-2 disabled:cursor-not-allowed disabled:border-borde disabled:bg-banda disabled:text-cuerpo`}><Icon n="note" />Guardar nota</button>
        </section>
      </div>

      <div className="lg:col-span-5"><Linea t={t} /></div>

      {clinicas && (
        <ClinicSheet titulo="Confirmar clínica del paciente" current={CLINICA_INICIAL} sinSeleccion
          onSelect={(cl) => confirmarClinica(cl.name)} onClose={() => setClinicas(false)} />
      )}
    </div>
  )
}

const Fila = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="py-3 first:pt-0"><dt className="t-meta text-secundario">{k}</dt><dd className="t-body font-semibold text-titulo">{children}</dd></div>
)

/* ---------- línea de tiempo unificada ---------- */
function Linea({ t }: { t: Tramite }) {
  const eventos = [...t.eventos].reverse()
  return (
    <section aria-labelledby="lt-t" className="lg:sticky lg:top-24">
      <h2 id="lt-t" className="t-card font-head text-titulo">Línea de tiempo</h2>
      <p className="mt-1 t-meta text-secundario">Todos los canales en una sola conversación. Lo más reciente arriba.</p>
      <ol className="mt-4" aria-live="polite">
        {eventos.map((e, i) => {
          const nota = esNotaInterna(e)
          return (
            <li key={`${e.fecha}-${i}`} className={`flex gap-3 border-t border-borde py-3 ${nota ? '-mx-3 rounded-lg border-t-0 bg-resaltado px-3' : ''}`}>
              <Icon n={nota ? 'note' : ICONO_CANAL[e.canal]} className="mt-1 text-icono" />
              <div className="min-w-0">
                <p className="t-meta text-secundario"><time dateTime={e.fecha}>{horaEvento(e.fecha)}</time> · {nota ? 'Nota interna · solo personal' : CANAL[e.canal]}</p>
                <p className="t-body font-semibold text-titulo">{TIPO_EVENTO[e.tipo] ?? e.tipo}</p>
                <p className="t-body break-words">{e.detalle}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/* ---------- solo administrador ---------- */
function PanelAdmin() {
  const { tramite: t, reiniciarDemo } = useApp()
  const [confirmar, setConfirmar] = useState(false)
  const porCanal = (['web', 'whatsapp', 'call_center'] as const).map((c) => [c, t ? t.eventos.filter((e) => e.canal === c && !esNotaInterna(e)).length : 0] as const)
  return (
    <section aria-labelledby="adm-t" className="mt-12 border-t border-borde pt-8">
      <h2 id="adm-t" className="flex items-center gap-2 t-card font-head text-titulo"><Icon n="shield" />Administración de la demo</h2>
      <p className="mt-1 t-meta text-secundario">Visible solo para el rol Administrador.</p>
      {!esApi && <dl className="mt-4 grid grid-cols-3 gap-4 sm:max-w-lg">
        {porCanal.map(([c, n]) => (
          <div key={c}><dt className="flex items-center gap-1 t-meta text-secundario"><Icon n={ICONO_CANAL[c]} size={16} />{CANAL[c]}</dt><dd className="font-head t-card text-titulo">{n}</dd></div>
        ))}
      </dl>}
      {!esApi && <p className="mt-1 t-meta text-secundario">Movimientos del trámite activo por canal.</p>}
      <div className="mt-4" role="status">
        {!confirmar
          ? <button onClick={() => setConfirmar(true)} disabled={!t} className={`${outlineBtn} disabled:cursor-not-allowed disabled:border-borde disabled:bg-banda disabled:text-cuerpo`}><Icon n="refresh" />Reiniciar demo</button>
          : (
            <div className="flex flex-wrap items-center gap-x-4">
              <span className="t-body text-titulo">¿Borrar el trámite de demostración?</span>
              <button onClick={() => { setConfirmar(false); reiniciarDemo() }} className={link}>Sí, borrar</button>
              <button onClick={() => setConfirmar(false)} className={link}>Cancelar</button>
            </div>
          )}
      </div>
    </section>
  )
}
