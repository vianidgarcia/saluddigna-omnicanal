import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fechaLarga, hoyISO, isoDia, yaPaso, fmtHora } from '../state/tramite'
import { Icon } from './Icon'

/* Calendario + horarios. Nunca permite fechas ni horas que ya pasaron.
   Dos fuentes de horarios:
   · demo (por omisión y en modo local): `HORAS` con una ocupación de ejemplo, estable para cada día y hora.
   · real (modo api, con la prop `consultar`): solo lo que la clínica acepta, pedido a la base por mes.
     Si la base no responde, o no conoce la clínica, vuelve a la demo y lo avisa (el modo local es el respaldo). */

/** Horarios de la clínica entre dos fechas ('AAAA-MM-DD', inclusive). null = la base no conoce la clínica o el estudio. */
export type ConsultarHorarios = (desde: string, hasta: string) => Promise<{ fecha: string; hora: string }[] | null>

export const DIAS_MAXIMOS = 90
export const HORAS = Array.from({ length: 21 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
export const ocupado = (fecha: string, hora: string) => {
  let h = 0
  for (const ch of fecha + hora) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % 4 === 0
}
/** ¿Se puede reservar este horario? (no pasado y no ocupado) */
export const disponible = (fecha: string, hora: string) => !yaPaso(fecha, hora) && !ocupado(fecha, hora)

const MESES = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString('es-MX', { month: 'long' }))
const SEMANA: [string, string][] = [['L', 'lunes'], ['M', 'martes'], ['M', 'miércoles'], ['J', 'jueves'], ['V', 'viernes'], ['S', 'sábado'], ['D', 'domingo']]
const parse = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }
const sumarDias = (iso: string, n: number) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoDia(d) }

type Fuente = {
  /** true = horarios reales de la clínica; false = de demostración */
  real: boolean
  cargando: boolean
  /** por qué se volvió a la demostración (null si no) */
  aviso: string | null
  /** horas libres de un día, 'HH:MM' */
  horasDe: (fecha: string) => string[]
  /** pide a la base lo que falte entre dos fechas (no hace nada en demo) */
  asegurar: (desde: string, hasta: string) => void
}

function useFuente(consultar: ConsultarHorarios | undefined, hoy: string, max: string): Fuente {
  const [lista, setLista] = useState<Map<string, string[]>>(new Map())
  const [pendientes, setPendientes] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const pedidos = useRef(new Set<string>())
  const consultarRef = useRef(consultar)
  consultarRef.current = consultar
  const real = !!consultar && !aviso

  const asegurar = useCallback((desde: string, hasta: string) => {
    const pedir = consultarRef.current
    if (!pedir) return
    const d = desde < hoy ? hoy : desde
    const h = hasta > max ? max : hasta
    let ini: string | null = null
    let fin: string | null = null
    for (let x = d; x <= h; x = sumarDias(x, 1)) if (!pedidos.current.has(x)) { ini ??= x; fin = x }
    if (!ini || !fin) return
    const [a, b] = [ini, fin]
    for (let x = a; x <= b; x = sumarDias(x, 1)) pedidos.current.add(x)
    setPendientes((n) => n + 1)
    pedir(a, b)
      .then((horarios) => {
        if (horarios === null) { setAviso('Esta clínica todavía no está en el sistema de citas.'); return }
        setLista((previo) => {
          const nuevo = new Map(previo)
          for (let x = a; x <= b; x = sumarDias(x, 1)) nuevo.set(x, [])
          for (const hh of horarios) nuevo.get(hh.fecha)?.push(hh.hora.slice(0, 5))
          return nuevo
        })
      })
      .catch(() => setAviso('No pudimos consultar los horarios de la clínica.'))
      .finally(() => setPendientes((n) => n - 1))
  }, [hoy, max])

  const horasDe = useCallback((fecha: string) => real
    ? (lista.get(fecha) ?? []).filter((h) => !yaPaso(fecha, h))
    : HORAS.filter((h) => disponible(fecha, h)), [real, lista])

  return { real, cargando: real && pendientes > 0, aviso: consultar ? aviso : null, horasDe, asegurar }
}

export function SelectorHorario({ fecha, hora, onFecha, onHora, id = 'h', consultar }: {
  fecha: string | null; hora: string | null; onFecha: (v: string) => void; onHora: (h: string | null) => void; id?: string
  /** Modo api: horarios reales de la clínica. Sin esto, horarios de demostración. */
  consultar?: ConsultarHorarios
}) {
  const hoy = hoyISO()
  const max = sumarDias(hoy, DIAS_MAXIMOS)
  const fuente = useFuente(consultar, hoy, max)
  const habilitado = (iso: string) => iso >= hoy && iso <= max && fuente.horasDe(iso).length > 0
  // fecha guardada que ya pasó: se trata como no elegida
  const fechaValida = fecha && habilitado(fecha) ? fecha : null
  // cuenta los días elegidos por el usuario: solo entonces se lleva la vista a los horarios (no al restaurar)
  const [toques, setToques] = useState(0)
  const elegirDia = (v: string) => { onFecha(v); setToques((n) => n + 1) }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-10">
      <Calendario id={id} fecha={fechaValida} hoy={hoy} max={max} habilitado={habilitado} onFecha={elegirDia} onVista={fuente.asegurar} />
      <div>
        {fechaValida
          ? <SelectorHora id={id} fecha={fechaValida} hora={hora} onHora={onHora} toques={toques} fuente={fuente} />
          : <p className="rounded-lg bg-resaltado px-4 py-3 t-body text-titulo">Elige un día en el calendario para ver las horas disponibles.</p>}
        {fecha && !fechaValida && !fuente.cargando && <p role="status" className="mt-3 t-body text-titulo">La fecha que tenías guardada ya pasó o no tiene lugar. Elige otra.</p>}
        <p role="status" className="mt-3 t-meta text-secundario empty:hidden">
          {fuente.cargando ? 'Consultando los horarios de la clínica…' : fuente.aviso ? `${fuente.aviso} Se muestran horarios de demostración.` : null}
        </p>
      </div>
    </div>
  )
}

/* ---------- calendario mensual: siempre 6 semanas; solo los días disponibles se pueden elegir ---------- */
function Calendario({ id, fecha, hoy, max, habilitado, onFecha, onVista }: {
  id: string; fecha: string | null; hoy: string; max: string; habilitado: (iso: string) => boolean; onFecha: (v: string) => void
  /** avisa qué días se están viendo (primer y último de la cuadrícula) para pedir sus horarios */
  onVista: (desde: string, hasta: string) => void
}) {
  const inicio = parse(fecha ?? hoy)
  const [mes, setMes] = useState({ y: inicio.getFullYear(), m: inicio.getMonth() })
  // día que recibe el foco con Tab (navegación con flechas dentro de la cuadrícula)
  const [foco, setFoco] = useState<string>(fecha ?? hoy)
  const moverFoco = useRef(false)
  const grid = useRef<HTMLTableElement>(null)

  const hoyD = parse(hoy)
  const maxD = parse(max)
  const puedeAtras = mes.y > hoyD.getFullYear() || (mes.y === hoyD.getFullYear() && mes.m > hoyD.getMonth())
  const puedeAdelante = mes.y < maxD.getFullYear() || (mes.y === maxD.getFullYear() && mes.m < maxD.getMonth())

  // 42 celdas (6 semanas, de lunes a domingo) con los días del mes anterior y siguiente para completar
  const semanas = useMemo(() => {
    const primero = new Date(mes.y, mes.m, 1)
    const offset = (primero.getDay() + 6) % 7 // lunes = 0
    const celdas = Array.from({ length: 42 }, (_, i) => isoDia(new Date(mes.y, mes.m, 1 - offset + i)))
    return Array.from({ length: 6 }, (_, i) => celdas.slice(i * 7, i * 7 + 7))
  }, [mes])

  useEffect(() => { onVista(semanas[0][0], semanas[5][6]) }, [semanas, onVista])

  const enMes = (iso: string) => { const d = parse(iso); return d.getFullYear() === mes.y && d.getMonth() === mes.m }
  const elegible = (iso: string) => enMes(iso) && habilitado(iso)
  // nunca un día deshabilitado (p. ej. hoy después del último horario): no podría recibir el foco
  const tabDia = elegible(foco) ? foco : (semanas.flat().find(elegible) ?? null)
  const hayDias = semanas.flat().some(elegible)

  useEffect(() => {
    if (!moverFoco.current) return
    moverFoco.current = false
    grid.current?.querySelector<HTMLButtonElement>(`[data-dia="${foco}"]`)?.focus()
  }, [foco, mes])

  const cambiarMes = (delta: number) => setMes(({ y, m }) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() } })

  const onKey = (e: React.KeyboardEvent, iso: string) => {
    const paso = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!paso) return
    e.preventDefault()
    // salta días sin lugar en la misma dirección; se detiene en los límites (hoy y el máximo)
    let destino = sumarDias(iso, paso)
    while (destino >= hoy && destino <= max && !habilitado(destino)) destino = sumarDias(destino, paso)
    if (destino < hoy || destino > max) return
    const d = parse(destino)
    setMes({ y: d.getFullYear(), m: d.getMonth() })
    moverFoco.current = true
    setFoco(destino)
  }

  const titulo = `${MESES[mes.m]} ${mes.y}`
  const navBtn = 'inline-flex min-h-12 items-center gap-1 rounded-lg px-2 text-base font-semibold text-enlace transition-colors hover:bg-resaltado disabled:cursor-not-allowed disabled:text-secundario disabled:hover:bg-transparent'

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p id={`${id}-mes`} className="t-sub font-bold capitalize text-titulo" aria-live="polite">{titulo}</p>
        <div className="flex items-center">
          <button onClick={() => cambiarMes(-1)} disabled={!puedeAtras} className={navBtn}><Icon n="left" /><span>Anterior</span></button>
          <button onClick={() => cambiarMes(1)} disabled={!puedeAdelante} className={navBtn}><span>Siguiente</span><Icon n="left" className="rotate-180" /></button>
        </div>
      </div>
      <table ref={grid} role="grid" aria-labelledby={`${id}-mes`} className="mt-2 w-full table-fixed border-collapse">
        <thead>
          <tr>{SEMANA.map(([c, l], i) => <th key={i} scope="col" abbr={l} className="pb-1 t-meta font-semibold text-secundario"><span aria-hidden="true">{c}</span><span className="sr-only">{l}</span></th>)}</tr>
        </thead>
        <tbody>
          {semanas.map((s, i) => (
            <tr key={i}>
              {s.map((iso) => {
                const dia = parse(iso).getDate()
                const propio = enMes(iso)
                if (!elegible(iso)) {
                  // fuera del mes o sin lugar: se ve atenuado y no se puede elegir
                  return (
                    <td key={iso} className="p-0.5 text-center">
                      <span aria-hidden={!propio} className={`mx-auto flex h-12 w-full max-w-12 items-center justify-center rounded-full text-base ${propio ? 'text-secundario' : 'text-secundario font-normal'}`}>
                        {dia}{propio && <span className="sr-only">, no disponible</span>}
                      </span>
                    </td>
                  )
                }
                const sel = iso === fecha
                const esHoy = iso === hoy
                return (
                  <td key={iso} className="p-0.5 text-center">
                    <button data-dia={iso} tabIndex={iso === tabDia ? 0 : -1} aria-pressed={sel}
                      aria-label={`${fechaLarga(iso)}${esHoy ? ', hoy' : ''}`}
                      onClick={() => { setFoco(iso); onFecha(iso) }} onKeyDown={(e) => onKey(e, iso)}
                      className={`mx-auto flex h-12 w-full max-w-12 items-center justify-center rounded-full text-base font-semibold transition-colors ${
                        sel ? 'bg-accion-hover text-white' : `text-titulo hover:bg-resaltado ${esHoy ? 'ring-2 ring-inset ring-borde-accion' : ''}`}`}>
                      {dia}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!hayDias && <p className="mt-2 rounded-lg bg-resaltado px-4 py-3 t-body text-titulo">No hay días disponibles en {titulo}. Prueba con otro mes.</p>}
      <p className="mt-2 t-meta text-secundario">Los días atenuados no están disponibles. Puedes agendar desde hoy y hasta {DIAS_MAXIMOS} días después; usa las flechas del teclado para moverte entre días.</p>
    </div>
  )
}

/* ---------- horario: campo "Hora" que abre una lista desplegable con los horarios libres ---------- */
function SelectorHora({ id, fecha, hora, onHora, toques, fuente }: { id: string; fecha: string; hora: string | null; onHora: (h: string | null) => void; toques: number; fuente: Fuente }) {
  const libres = fuente.horasDe(fecha)
  const elegida = hora && libres.includes(hora) ? hora : null
  // la hora guardada ya no sirve (pasó, se ocupó o la clínica no la acepta): se limpia, cuando ya se sabe
  useEffect(() => { if (!fuente.cargando && hora && !elegida) onHora(null) }, [fuente.cargando, hora, elegida]) // eslint-disable-line react-hooks/exhaustive-deps
  const seccion = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLButtonElement>(null)
  const lista = useRef<HTMLUListElement>(null)
  const [abierta, setAbierta] = useState(false)
  const [activa, setActiva] = useState(0)

  // al tocar un día en el teléfono, el campo de hora queda a la vista (el calendario ocupa la pantalla)
  useEffect(() => {
    if (toques > 0 && window.matchMedia('(max-width: 1023px)').matches) seccion.current?.scrollIntoView({ block: 'start' })
  }, [toques])

  const abrir = () => {
    const i = elegida ? libres.indexOf(elegida) : 0
    setActiva(i < 0 ? 0 : i)
    setAbierta(true)
  }
  const cerrar = (devolverFoco = true) => { setAbierta(false); if (devolverFoco) campo.current?.focus() }
  const elegir = (h: string) => { onHora(h); cerrar() }

  // al abrir: foco en la lista (sin mover la página) y, si la lista queda bajo el borde de la pantalla (o bajo la barra
  // inferior del teléfono), la página baja solo lo necesario para verla completa; clic fuera la cierra
  useEffect(() => {
    if (!abierta) return
    const l = lista.current
    l?.focus({ preventScroll: true })
    if (l) {
      const barra = window.matchMedia('(max-width: 1023px)').matches ? 72 : 8
      const sobra = l.getBoundingClientRect().bottom - (window.innerHeight - barra)
      if (sobra > 0) window.scrollBy(0, sobra)
    }
    const fuera = (e: MouseEvent) => {
      if (!lista.current?.contains(e.target as Node) && !campo.current?.contains(e.target as Node)) cerrar(false)
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierta]) // eslint-disable-line react-hooks/exhaustive-deps
  // la opción activa siempre a la vista DENTRO de la lista (sin desplazar la página)
  useEffect(() => {
    const l = lista.current
    const op = l?.querySelector<HTMLElement>(`#${id}-op-${activa}`)
    if (!abierta || !l || !op) return
    if (op.offsetTop < l.scrollTop) l.scrollTop = op.offsetTop
    else if (op.offsetTop + op.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = op.offsetTop + op.offsetHeight - l.clientHeight
  }, [abierta, activa, id])

  const onKeyLista = (e: React.KeyboardEvent) => {
    const ultimo = libres.length - 1
    const mover: Record<string, number> = { ArrowDown: Math.min(activa + 1, ultimo), ArrowUp: Math.max(activa - 1, 0), Home: 0, End: ultimo, PageDown: Math.min(activa + 5, ultimo), PageUp: Math.max(activa - 5, 0) }
    if (e.key in mover) { e.preventDefault(); setActiva(mover[e.key]) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (libres[activa]) elegir(libres[activa]) }
    else if (e.key === 'Escape') { e.preventDefault(); cerrar() }
    else if (e.key === 'Tab') cerrar(false)
  }
  const onKeyCampo = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); abrir() }
  }

  return (
    <div ref={seccion} className="scroll-mt-24">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="t-sub font-bold text-titulo first-letter:uppercase">{fechaLarga(fecha)}</h3>
        <span className="rounded-full bg-resaltado px-3 py-1 t-meta font-semibold text-titulo">{fuente.real ? 'Horarios de la clínica' : 'Horarios de demostración'}</span>
      </div>
      <p className="mt-1 t-meta text-secundario">{libres.length === 1 ? '1 horario disponible' : `${libres.length} horarios disponibles`}.</p>

      <p id={`${id}-hl`} className="mt-4 text-base font-semibold text-titulo">Hora de la cita</p>
      <div className="relative mt-2">
        <button ref={campo} type="button" onClick={() => (abierta ? cerrar() : abrir())} onKeyDown={onKeyCampo}
          aria-haspopup="listbox" aria-expanded={abierta} aria-controls={abierta ? `${id}-lista` : undefined} aria-labelledby={`${id}-hl ${id}-valor`}
          className={`flex h-12 w-full items-center justify-between rounded-lg border bg-superficie px-4 text-left text-base transition-colors hover:border-borde-accion ${abierta ? 'border-2 border-borde-accion' : 'border-borde'}`}>
          <span id={`${id}-valor`} className={elegida ? 'font-semibold text-titulo' : 'text-secundario'}>{elegida ? fmtHora(elegida) : 'Hora'}</span>
          <Icon n="left" className={`text-icono transition-transform ${abierta ? 'rotate-90' : '-rotate-90'}`} />
        </button>
        {abierta && (
          <ul ref={lista} id={`${id}-lista`} role="listbox" tabIndex={-1} aria-labelledby={`${id}-hl`}
            aria-activedescendant={libres.length ? `${id}-op-${activa}` : undefined} onKeyDown={onKeyLista}
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-borde bg-superficie py-1 shadow-[0_8px_24px_-4px_rgba(0,68,128,0.24)] focus:outline-none">
            {libres.map((h, i) => {
              const sel = elegida === h
              return (
                <li key={h} id={`${id}-op-${i}`} role="option" aria-selected={sel}
                  onClick={() => elegir(h)} onMouseMove={() => setActiva(i)}
                  className={`flex min-h-12 cursor-pointer items-center justify-between px-4 text-base ${i === activa ? 'bg-resaltado' : ''} ${sel ? 'font-semibold text-enlace' : 'text-titulo'}`}>
                  {fmtHora(h)}
                  {sel && <Icon n="check" size={18} className="text-enlace" />}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div role="status" className="mt-4">
        {elegida && (
          <p className="flex items-start gap-2 rounded-lg bg-resaltado px-4 py-3 t-body text-titulo">
            <Icon n="calendar" className="mt-0.5 text-enlace" />
            <span>Tu cita: <strong className="font-bold first-letter:uppercase">{fechaLarga(fecha)}, {fmtHora(elegida)}</strong></span>
          </p>
        )}
      </div>
    </div>
  )
}
