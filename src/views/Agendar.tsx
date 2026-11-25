import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../context'
import { Back } from '../components/Back'
import { SelectorHorario } from '../components/SelectorHorario'
import { BotonComprobante } from '../components/BotonComprobante'
import { Icon } from '../components/Icon'
import { CHIPS, estudiosOfrecidos } from '../data/studies'
import { findClinic } from '../data/clinics'
import { FiltrosClinica, fmtKm, useBuscadorClinica } from '../components/BuscadorClinica'
import { MapaClinicasDiferido as MapaClinicas } from '../components/MapaDiferido'
import { NB, WA, container, chip, link, outlineBtn, solidBtn } from '../components/ui'
import {
  LISTA_PASOS, METODO, PASOS, TOTAL_PASOS, avance, conEvento, fmtTelefono, fechaLarga, pasoCompleto, yaPaso,
  type MetodoPago, type Paso, type Tramite, fmtHora } from '../state/tramite'

const PREGUNTA: Record<Paso, string> = {
  1: '¿Qué estudio necesitas?',
  2: '¿En qué clínica te atendemos?',
  3: '¿Qué día y a qué hora?',
  4: 'Revisa tu cita y elige cómo pagar',
}
const optionRow = 'flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors has-[:checked]:border-enlace has-[:checked]:bg-resaltado'
const radio = 'mt-0.5 size-5 shrink-0 accent-accion-hover'

export function Agendar() {
  const { tramite } = useApp()
  if (!tramite) return null
  if (tramite.estado === 'confirmada') return <Confirmada t={tramite} />
  return <Flujo t={tramite} />
}

/* ---------- contenedor del flujo ---------- */
function Flujo({ t }: { t: Tramite }) {
  const { update, go } = useApp()
  const paso = t.paso
  const headRef = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(false)
  useEffect(() => {
    // al cambiar de paso: arriba y foco en la pregunta (lectores de pantalla la anuncian)
    if (mounted.current) window.scrollTo(0, 0)
    mounted.current = true
    headRef.current?.focus({ preventScroll: true })
  }, [paso])

  const irA = (p: Paso, tipo: string, detalle: string, extra: Partial<Tramite> = {}) =>
    update((x) => conEvento({ ...x, ...extra, paso: p }, tipo, detalle))

  const detalle = (p: Paso): string => {
    if (p === 1) return t.estudio?.nombre ?? ''
    if (p === 2) return t.clinica ?? 'Clínica pendiente'
    if (p === 3) return t.fecha ? `${fechaLarga(t.fecha)}, ${fmtHora(t.hora)}` : ''
    return ''
  }

  const siguiente = () => {
    // desde el resumen: volver al primer dato que falte (o al resumen)
    const next: Paso = t.desdeResumen
      ? LISTA_PASOS.find((p) => p > paso && p < TOTAL_PASOS && !pasoCompleto(t, p)) ?? TOTAL_PASOS
      : (Math.min(paso + 1, TOTAL_PASOS) as Paso)
    irA(next, 'tramite.paso_completado', `Paso ${paso} (${PASOS[paso]}): ${detalle(paso)}`, { desdeResumen: next === TOTAL_PASOS ? false : t.desdeResumen })
  }
  const atras = () => irA((paso - 1) as Paso, 'tramite.paso_regresado', `Regresó al paso ${paso - 1}: ${PASOS[(paso - 1) as Paso]}`)
  const cambiar = (p: Paso) => irA(p, 'tramite.dato_editado', `Abrió “Cambiar” en ${PASOS[p]} desde el resumen`, { desdeResumen: true })

  /* qué falta para continuar en cada paso */
  let falta: string | null = null
  if (paso === 1 && !t.estudio) falta = 'Elige una categoría y luego tu estudio para continuar.'
  if (paso === 2 && !pasoCompleto(t, 2)) falta = 'Elige una clínica o marca “Aún no lo decido” para continuar.'
  if (paso === 3 && (!t.fecha || yaPaso(t.fecha))) falta = 'Elige un día en el calendario para continuar.'
  else if (paso === 3 && (!t.hora || yaPaso(t.fecha!, t.hora))) falta = 'Elige la hora de tu cita para continuar.'
  if (paso === 4) {
    falta = !t.clinica ? 'Elige una clínica para confirmar tu cita (toca “Cambiar” en Clínica).'
      : !t.fecha || !t.hora || yaPaso(t.fecha, t.hora) ? 'La fecha u hora de tu cita ya pasó: toca “Cambiar” en Fecha y hora.'
        : !t.paciente.nombre?.trim() ? 'Escribe a nombre de quién es la cita para continuar.'
          : (t.paciente.telefono ?? '').length !== 10 ? 'Escribe un teléfono de 10 dígitos para continuar.'
          : !t.metodoPago ? 'Elige cómo quieres pagar para continuar.' : null
  }

  // pago en clínica: se confirma al momento; los demás pasan por la pasarela simulada (vista Pago)
  const INICIO_PAGO: Partial<Record<MetodoPago, [string, string]>> = {
    en_linea: ['pago.iniciado', 'Inició el pago con tarjeta en la pasarela (simulada)'],
    oxxo: ['pago.referencia_generada', 'Referencia de pago en Oxxo generada (demo)'],
    spei: ['pago.datos_transferencia', 'Datos de transferencia SPEI generados (demo)'],
  }
  const confirmar = () => {
    const inicio = t.metodoPago && INICIO_PAGO[t.metodoPago]
    if (inicio) {
      update((x) => conEvento({ ...x, estado: 'pago_pendiente', desdeResumen: false, pago: { estado: 'pendiente', intentos: 0 } }, inicio[0], inicio[1], 'pasarela'))
      go('pay')
      return
    }
    update((x) => conEvento({ ...x, estado: 'confirmada', desdeResumen: false }, 'cita.confirmada', `${METODO[x.metodoPago!]} · ${x.fecha ? fechaLarga(x.fecha) : ''} ${fmtHora(x.hora)}`))
    window.scrollTo(0, 0)
  }
  const PRIMARIO: Record<MetodoPago, string> = {
    en_linea: 'Continuar al pago con tarjeta', oxxo: 'Generar referencia de pago', spei: 'Generar datos de transferencia', en_clinica: 'Confirmar cita',
  }
  const primario = paso === TOTAL_PASOS
    ? (t.metodoPago ? PRIMARIO[t.metodoPago] : 'Confirmar cita')
    : t.desdeResumen ? 'Guardar y continuar' : 'Continuar'

  return (
    <div className={`${container} py-4 lg:py-12`}>
      <Back />
      <h1 className="mt-2 t-section font-head text-titulo lg:mt-4">Agendar cita</h1>
      <Progreso paso={paso} />
      <div className={`mt-6 lg:mt-8 ${paso === 2 ? '' : 'max-w-3xl'}`}>
        <h2 ref={headRef} tabIndex={-1} data-focus-target className="t-card font-head text-titulo">
          <span className="sr-only">Paso {paso} de {TOTAL_PASOS}: </span>{PREGUNTA[paso]}
        </h2>
        {paso === 1 && <p className="mt-1 t-meta text-secundario">Guardamos tu avance en cada paso. Si te interrumpes, retómalo desde el inicio o por WhatsApp.</p>}
        <div className="mt-6">
          {paso === 1 && <PasoEstudio t={t} />}
          {paso === 2 && <PasoClinica t={t} />}
          {paso === 3 && <PasoFecha t={t} />}
          {paso === 4 && <PasoPago t={t} onCambiar={cambiar} />}
        </div>
        <div className="mt-8 border-t border-borde pt-6">
            {falta && <p id="falta" className="mb-3 t-body text-cuerpo">{falta}</p>}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              {paso > 1
                ? <button onClick={atras} className={outlineBtn}><Icon n="left" />Atrás</button>
                : <button onClick={() => go('home')} className={outlineBtn}><Icon n="left" />Atrás</button>}
              <button onClick={paso === TOTAL_PASOS ? confirmar : siguiente} disabled={!!falta} aria-describedby={falta ? 'falta' : undefined} className={solidBtn}>
                {primario}<Icon n="arrow" />
              </button>
            </div>
        </div>
      </div>
    </div>
  )
}

function Progreso({ paso }: { paso: Paso }) {
  return (
    <div className="mt-3 max-w-3xl lg:mt-4">
      <p className="t-sub font-semibold text-titulo">Paso {paso} de {TOTAL_PASOS} · {PASOS[paso]}</p>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL_PASOS} aria-valuenow={paso} aria-valuetext={`Paso ${paso} de ${TOTAL_PASOS}: ${PASOS[paso]}`} aria-label="Avance del agendado" className="mt-2 h-2 rounded-full bg-resaltado">
        <div className="h-full rounded-full bg-accion-hover transition-[width]" style={{ width: `${avance(paso)}%` }} />
      </div>
      <ol className="mt-2 hidden grid-cols-4 gap-2 t-meta sm:grid" aria-hidden="true">
        {LISTA_PASOS.map((p) => (
          <li key={p} className={p === paso ? 'font-semibold text-enlace' : p < paso ? 'text-cuerpo' : 'text-secundario'}>{p}. {PASOS[p]}</li>
        ))}
      </ol>
    </div>
  )
}

/* ---------- paso 1: estudio ---------- */
function PasoEstudio({ t }: { t: Tramite }) {
  const { update, estudiosDisponibles } = useApp()
  const catalogo = estudiosOfrecidos(estudiosDisponibles)
  const inicial = t.estudio && CHIPS.includes(t.estudio.categoria) ? t.estudio.categoria : null
  const [cat, setCat] = useState<string | null>(inicial)
  const paquete = t.estudio && !CHIPS.includes(t.estudio.categoria) ? t.estudio : null
  return (
    <>
      {paquete && (
        <p className="mb-6 rounded-lg bg-resaltado px-4 py-3 t-body text-titulo" role="status">
          Elegiste: <strong className="font-bold">{paquete.nombre}{paquete.precio ? ` – ${paquete.precio}` : ''}</strong>{paquete.precio ? ' (IVA incluido)' : ''}. Puedes continuar o elegir otro estudio.
        </p>
      )}
      <p className="text-base font-semibold text-titulo" id="cat-l">Categoría</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="cat-l">
        {Object.keys(catalogo).map((c) => <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c} className={chip(cat === c)}>{c}</button>)}
      </div>
      {cat && (
        <fieldset className="mt-6">
          <legend className="text-base font-semibold text-titulo">Estudios de {cat.toLowerCase()}</legend>
          <div className="mt-2 flex flex-col gap-2">
            {(catalogo[cat] ?? []).map((n) => (
              <label key={n} className={`${optionRow} border-borde hover:border-borde-accion`}>
                <input type="radio" name="estudio" className={radio} checked={t.estudio?.nombre === n}
                  onChange={() => update((x) => ({ ...x, estudio: { categoria: cat, nombre: n } }))} />
                <span><span className="block text-base font-semibold text-titulo">{n}</span><span className="block t-meta text-secundario">Precio según tu clínica</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  )
}

/* ---------- paso 2: clínica ---------- */
function PasoClinica({ t }: { t: Tramite }) {
  const { update } = useApp()
  const b = useBuscadorClinica()
  const [vista, setVista] = useState<'lista' | 'mapa'>('lista')
  const panel = useRef<HTMLDivElement>(null)
  const elegir = (nombre: string) => update((x) => ({ ...x, clinica: nombre, clinicaPendiente: false }))
  const masCercana = b.ubicacion ? b.resultados[0]?.c.name : null

  // sin ubicación: agrupadas por ciudad (ya vienen ordenadas por estado, ciudad y nombre); con ubicación: por distancia
  const grupos: [string | null, typeof b.resultados][] = []
  if (b.ubicacion) grupos.push([null, b.resultados])
  else for (const r of b.resultados) {
    const k = `${r.c.ciudad}, ${r.c.estado}`
    const g = grupos[grupos.length - 1]
    if (g && g[0] === k) g[1].push(r); else grupos.push([k, [r]])
  }

  // al elegir desde el mapa, la lista se desplaza hasta esa clínica (solo dentro de su panel, sin mover la página)
  useEffect(() => {
    const p = panel.current
    const el = t.clinica ? p?.querySelector<HTMLElement>(`[data-clinica="${CSS.escape(t.clinica)}"]`) : null
    if (!p || !el || p.scrollHeight <= p.clientHeight) return
    if (el.offsetTop < p.scrollTop || el.offsetTop + el.offsetHeight > p.scrollTop + p.clientHeight) p.scrollTop = el.offsetTop - 48
  }, [t.clinica])

  const tab = (on: boolean) => `inline-flex min-h-12 items-center justify-center gap-2 text-base font-semibold transition-colors ${on ? 'bg-accion-hover text-white' : 'bg-superficie text-enlace hover:bg-resaltado'}`

  return (
    <>
      <FiltrosClinica b={b} id="pc" />
      <fieldset className="mt-6">
        <legend className="sr-only">Elige una clínica</legend>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p aria-hidden="true" className="t-sub font-bold text-titulo">Elige una clínica</p>
          <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-dashed border-borde px-4 text-base text-titulo transition-colors hover:border-borde-accion has-[:checked]:border-solid has-[:checked]:border-enlace has-[:checked]:bg-resaltado">
            <input type="radio" name="clinica" className="size-5 accent-accion-hover" checked={t.clinicaPendiente}
              onChange={() => update((x) => ({ ...x, clinica: null, clinicaPendiente: true }))} />
            Aún no lo decido
          </label>
        </div>
        {t.clinicaPendiente && <p className="mt-1 t-meta text-secundario">Puedes seguir y elegirla antes de confirmar tu cita.</p>}

        {/* teléfono: lista o mapa; escritorio: los dos lado a lado */}
        <div role="group" aria-label="Ver clínicas como" className="mt-3 grid grid-cols-2 overflow-hidden rounded-lg border border-borde-accion lg:hidden">
          <button onClick={() => setVista('lista')} aria-pressed={vista === 'lista'} className={tab(vista === 'lista')}><Icon n="menu" size={18} />Lista</button>
          <button onClick={() => setVista('mapa')} aria-pressed={vista === 'mapa'} className={tab(vista === 'mapa')}><Icon n="pin" size={18} />Mapa</button>
        </div>

        <div className="mt-3 lg:grid lg:grid-cols-2 lg:gap-6">
          <div className={vista === 'lista' ? '' : 'hidden lg:block'}>
            <div ref={panel} className="relative lg:h-[30rem] lg:overflow-y-auto lg:rounded-lg lg:border lg:border-borde lg:p-2">
              {!b.activo && (
                <p className="rounded-lg bg-resaltado px-4 py-3 t-body text-titulo">Usa tu ubicación o elige un estado para ver la lista. También puedes tocar un punto en el mapa.</p>
              )}
              {b.activo && !b.total && (
                <p className="rounded-lg bg-resaltado px-4 py-3 t-body text-titulo">No encontramos clínicas con esos filtros. Prueba con otra ciudad o toca “Limpiar filtros”.</p>
              )}
              {grupos.map(([titulo, filas]) => (
                <div key={titulo ?? 'cercanas'} role="group" aria-label={titulo ?? 'Clínicas cercanas'} className="mb-3 last:mb-0">
                  {titulo && (
                    <p className="sticky top-0 z-[1] -mx-2 bg-superficie px-2 pb-1 pt-1 t-meta font-semibold text-secundario">
                      {titulo} · {filas.length === 1 ? '1 clínica' : `${filas.length} clínicas`}
                    </p>
                  )}
                  <div className="flex flex-col gap-2">
                    {filas.map(({ c, km }) => (
                      <label key={c.name} data-clinica={c.name} className={`${optionRow} border-borde hover:border-borde-accion`}>
                        <input type="radio" name="clinica" className={radio} checked={t.clinica === c.name} onChange={() => elegir(c.name)} />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-base font-semibold text-titulo">{c.name}</span>
                            {km !== undefined && <span className="t-meta text-secundario">{fmtKm(km)}</span>}
                            {c.name === masCercana && <span className="t-meta font-semibold text-enlace">Más cercana</span>}
                          </span>
                          {b.ubicacion && <span className="block t-meta text-secundario">{c.ciudad}, {c.estado}</span>}
                          <span className="block t-meta text-cuerpo">{c.address}</span>
                          {(c.phone || c.horario) && <span className="block t-meta text-secundario">{c.phone && <>Tel.{NB}{c.phone}</>}{c.phone && c.horario && ' · '}{c.horario}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={vista === 'mapa' ? '' : 'hidden lg:block'}>
            <MapaClinicas alto="h-80 lg:h-[30rem]" clinicas={b.enMapa.map((r) => r.c)} elegida={t.clinica} ubicacion={b.ubicacion}
              onElegir={(c) => elegir(c.name)} />
          </div>
        </div>
      </fieldset>
    </>
  )
}

/* ---------- paso 3: fecha y hora ---------- */
function PasoFecha({ t }: { t: Tramite }) {
  const { update, horariosClinica } = useApp()
  const { clinica, estudio } = t
  // modo api: solo se ofrecen las horas que la clínica acepta; el key reinicia el selector al cambiar de clínica o estudio
  const consultar = horariosClinica && clinica && estudio
    ? (desde: string, hasta: string) => horariosClinica(clinica, estudio.nombre, desde, hasta) : undefined
  return <SelectorHorario key={`${clinica}|${estudio?.nombre}`} consultar={consultar} fecha={t.fecha} hora={t.hora}
    onFecha={(v) => update((x) => ({ ...x, fecha: v, hora: x.fecha === v ? x.hora : null }))}
    onHora={(h) => update((x) => ({ ...x, hora: h }))} />
}

/* ---------- paso 4: resumen editable + pago ---------- */
const OPCIONES: [MetodoPago, string, string][] = [
  ['en_linea', 'tarjeta', 'Visa, Mastercard o American Express. Pasarela simulada: no se hace ningún cobro.'],
  ['oxxo', 'tienda', 'Te damos una referencia para pagar en efectivo en cualquier Oxxo.'],
  ['spei', 'banco', 'Te damos una CLABE y una referencia para transferir desde tu banco.'],
  ['en_clinica', 'pin', 'Pagas en recepción el día de tu cita.'],
]

function Resumen({ t, onCambiar }: { t: Tramite; onCambiar?: (p: Paso) => void }) {
  const c = findClinic(t.clinica)
  const filas: [Paso, string, ReactNode][] = [
    [1, 'Estudio', <>{t.estudio?.nombre}<span className="block t-meta font-normal text-secundario">{t.estudio?.precio ? `${t.estudio.precio} IVA incluido` : 'Precio según tu clínica'}</span></>],
    [2, 'Clínica', c
      ? <>{c.name}<span className="block t-meta font-normal text-secundario">{c.address} · Tel.{NB}{c.phone}</span></>
      : <span className="inline-flex items-center gap-2 rounded-full bg-ambar-fondo px-3 py-1 t-meta font-semibold text-ambar-texto"><span aria-hidden="true" className="size-2 rounded-full bg-ambar" />Clínica pendiente</span>],
    [3, 'Fecha y hora', t.fecha ? <span className="first-letter:uppercase">{fechaLarga(t.fecha)} · {fmtHora(t.hora)}<span className="block t-meta font-normal text-secundario">Horario de demostración</span></span> : '—'],
  ]
  return (
    <dl className="divide-y divide-borde">
      {filas.map(([p, k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4 py-3 first:pt-0">
          <div>
            <dt className="t-meta text-secundario">{k}</dt>
            <dd className="t-body font-semibold text-titulo">{v}</dd>
          </div>
          {onCambiar && <button onClick={() => onCambiar(p)} aria-label={`Cambiar ${k.toLowerCase()}`} className={`${link} shrink-0`}>Cambiar</button>}
        </div>
      ))}
    </dl>
  )
}

/** Teléfono de contacto: 10 dígitos, con formato al escribir; el error aparece al salir del campo. */
function CampoTelefono({ valor, onCambio }: { valor: string | null; onCambio: (tel: string) => void }) {
  const [tocado, setTocado] = useState(false)
  const digitos = (valor ?? '').replace(/\D/g, '')
  const error = tocado && digitos.length > 0 && digitos.length !== 10 ? `El teléfono debe tener 10 dígitos; llevas ${digitos.length}.` : null
  return (
    <div>
      <label htmlFor="tel-paciente" className="text-base font-semibold text-titulo">Teléfono celular</label>
      <input id="tel-paciente" type="tel" inputMode="numeric" autoComplete="tel-national" value={fmtTelefono(digitos) || digitos}
        onChange={(e) => onCambio(e.target.value.replace(/\D/g, '').slice(0, 10))} onBlur={() => setTocado(true)}
        aria-invalid={!!error} aria-describedby={error ? 'tel-h tel-e' : 'tel-h'} placeholder="10 dígitos, ej. 667 123 4567"
        className="mt-2 h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion aria-[invalid=true]:border-2 aria-[invalid=true]:border-error" />
      <p id="tel-h" className="mt-1 t-meta text-secundario">Para avisarte de cambios en tu cita.</p>
      {error && <p id="tel-e" className="mt-1 flex items-start gap-2 t-meta font-semibold text-error"><Icon n="alert" size={18} className="mt-px" />{error}</p>}
    </div>
  )
}

function PasoPago({ t, onCambiar }: { t: Tramite; onCambiar: (p: Paso) => void }) {
  const { update } = useApp()
  return (
    <>
      <fieldset className="mb-8">
        <legend className="t-sub font-bold text-titulo">Datos del paciente</legend>
        <p id="datos-h" className="t-meta text-secundario">No necesitas cuenta. Con estos datos y tu folio te atendemos en la clínica, por WhatsApp o en el Call Center.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="nombre-paciente" className="text-base font-semibold text-titulo">¿A nombre de quién es la cita?</label>
            <input id="nombre-paciente" autoComplete="name" value={t.paciente.nombre ?? ''} aria-describedby="datos-h"
              onChange={(e) => update((x) => ({ ...x, paciente: { ...x.paciente, nombre: e.target.value } }))}
              placeholder="Nombre y apellidos" className="mt-2 h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion" />
          </div>
          <CampoTelefono valor={t.paciente.telefono} onCambio={(tel) => update((x) => ({ ...x, paciente: { ...x.paciente, telefono: tel } }))} />
        </div>
      </fieldset>
      <section aria-labelledby="res-t" className="rounded-2xl border border-borde bg-superficie p-6">
        <h3 id="res-t" className="t-sub font-bold text-titulo">Resumen de tu cita</h3>
        <div className="mt-4"><Resumen t={t} onCambiar={onCambiar} /></div>
      </section>
      <fieldset className="mt-8">
        <legend className="text-base font-semibold text-titulo">¿Cómo quieres pagar?</legend>
        <div className="mt-2 flex flex-col gap-2">
          {OPCIONES.map(([m, ic, d]) => (
            <label key={m} className={`${optionRow} border-borde hover:border-borde-accion`}>
              <input type="radio" name="pago" className={radio} checked={t.metodoPago === m}
                onChange={() => update((x) => ({ ...x, metodoPago: m }))} />
              <Icon n={ic} className="mt-0.5 text-icono" />
              <span><span className="block text-base font-semibold text-titulo">{METODO[m]}</span><span className="block t-meta text-secundario">{d}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  )
}

/* ---------- confirmación final ---------- */
function Confirmada({ t }: { t: Tramite }) {
  const { go } = useApp()
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [])
  return (
    <div className={`${container} py-8 lg:py-12`}>
      <Back />
      <div className="mt-4 max-w-3xl">
        <h1 ref={ref} tabIndex={-1} data-focus-target className="flex items-center gap-3 t-greeting font-head text-verde">
          <Icon n="check" size={36} />Cita confirmada
        </h1>
        <p role="status" className="mt-2 t-body text-titulo">
          {t.paciente.nombre ? `${t.paciente.nombre}, guardamos` : 'Guardamos'} los detalles en Mis trámites con tu folio {t.id}.{' '}
          {t.metodoPago === 'en_clinica' ? 'Pagas en recepción el día de tu cita.' : t.pago?.estado === 'aprobado' ? 'Tu pago quedó registrado (simulación: no se hizo ningún cobro).' : ''}
        </p>
        <section aria-labelledby="conf-t" className="mt-6 rounded-2xl border border-borde bg-superficie p-6">
          <h2 id="conf-t" className="t-sub font-bold text-titulo">Detalles de tu cita</h2>
          <div className="mt-4"><Resumen t={t} /></div>
          <dl className="mt-3 grid gap-3 border-t border-borde pt-3 sm:grid-cols-2">
            <div><dt className="t-meta text-secundario">Pago</dt><dd className="t-body font-semibold text-titulo">{t.metodoPago ? METODO[t.metodoPago] : '—'}
              {t.pago?.estado === 'aprobado' && <span className="block t-meta font-normal text-secundario">
                Aprobado{t.pago.tarjeta && ` · ${t.pago.tarjeta.marca} •••• ${t.pago.tarjeta.ultimos4}`}{t.pago.autorizacion && ` · Autorización ${t.pago.autorizacion} (de ejemplo)`}
              </span>}</dd></div>
            {t.paciente.nombre && <div><dt className="t-meta text-secundario">A nombre de</dt><dd className="t-body font-semibold text-titulo">{t.paciente.nombre}{t.paciente.telefono && <span className="block t-meta font-normal text-secundario">Tel. {fmtTelefono(t.paciente.telefono)}</span>}</dd></div>}
            <div><dt className="t-meta text-secundario">Folio</dt><dd className="t-body font-semibold text-titulo">{t.id} <span className="t-meta font-normal text-secundario">(folio de ejemplo)</span></dd></div>
          </dl>
        </section>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <button onClick={() => go('tramites')} className={solidBtn}>Ver mis trámites</button>
          <BotonComprobante t={t} />
          <a href={`${WA}?text=${encodeURIComponent(`Hola, quiero ver mi cita ${t.id}`)}`} target="_blank" rel="noopener" className={`${link} justify-center`}><Icon n="chat" />Abrir en WhatsApp</a>
        </div>
      </div>
    </div>
  )
}

export { Resumen }
