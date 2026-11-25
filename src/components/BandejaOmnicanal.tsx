/* Bandeja omnicanal: lo que el asesor ve del orquestador, con TODOS los canales juntos.
 *
 * Solo aparece en modo api. Es la prueba de que el portal, WhatsApp, el call center y la clínica
 * comparten un mismo trámite: aquí salen pacientes que nunca pasaron por la web, y la línea de
 * tiempo dice por qué canal entró cada paso.
 *
 * En modo local la vista del asesor sigue funcionando con el trámite de este dispositivo.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bandeja, CategoriaBandeja, Journey, PacienteEncontrado, TramiteEnCurso } from '../api/api'
import { buscar, categoriaBandeja, conteosBandeja, enCurso, escucharTodo, journey } from '../api/personal'
import { canalDesdeApi, detalleEvento } from '../api/mapa'
import { CANAL, ICONO_CANAL, hace } from '../state/tramite'
import { Icon } from './Icon'
import { chip, link, outlineBtn } from './ui'

const fieldInput = 'w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion'

const NOMBRE_CATEGORIA: Record<CategoriaBandeja, string> = {
  atorados: 'Trámites atorados',
  pago_por_vencer: 'Pagos por vencer',
  en_atencion: 'En atención ahora',
  seguridad: 'Alertas de seguridad',
  llegadas_hoy: 'Llegadas de hoy',
}
const PASO: Record<string, string> = { seleccion_estudio: 'Elegir estudio', seleccion_clinica: 'Elegir clínica', seleccion_horario: 'Elegir fecha y hora', pago: 'Pagar la cita', confirmada: 'Confirmada' }
const ORDEN: CategoriaBandeja[] = ['atorados', 'pago_por_vencer', 'en_atencion', 'seguridad', 'llegadas_hoy']

type EventoLista = { id: string; paciente: string; tipo: string; payload?: Record<string, unknown>; canal: string; en: string }
/** Trabajo interno de la base: no es algo que haya hecho el paciente. */
const RUIDO = new Set(['asesor_consulto_contexto', 'resumen_actualizado', 'recordatorio_programado'])
const MAX_EVENTOS = 30
const nombreCanal = (c: string) => (c === 'sistema' ? 'Sistema' : CANAL[canalDesdeApi(c)])

/** Junta sin repetir, lo más reciente primero. */
const juntar = (a: EventoLista[], b: EventoLista[]) =>
  [...new Map([...b, ...a].map((e) => [e.id, e])).values()].sort((x, y) => y.en.localeCompare(x.en)).slice(0, MAX_EVENTOS)

export function BandejaOmnicanal() {
  const [tramites, setTramites] = useState<TramiteEnCurso[] | null>(null)
  const [eventos, setEventos] = useState<EventoLista[]>([])
  const [conectado, setConectado] = useState<boolean | null>(null)
  const nombres = useRef(new Map<string, string>())
  const categoriaRef = useRef<CategoriaBandeja | null>(null)
  const [bandeja, setBandeja] = useState<Bandeja | null>(null)
  const [categoria, setCategoria] = useState<CategoriaBandeja | null>(null)
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<PacienteEncontrado[] | null>(null)
  const [elegido, setElegido] = useState<Journey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const vivo = useRef(true)

  const fallo = (e: unknown, respaldo: string) => {
    setError(e instanceof Error ? e.message : respaldo)
    console.warn('[bandeja]', e)
  }

  const refrescar = useCallback(async (cat: CategoriaBandeja | null) => {
    try {
      const [b, t] = await Promise.all([cat ? categoriaBandeja(cat) : conteosBandeja(), enCurso()])
      for (const x of t) nombres.current.set(x.paciente_id, x.paciente)
      // si mientras tanto se eligió otra categoría, esta respuesta ya no va
      if (vivo.current && categoriaRef.current === cat) { setBandeja(b); setTramites(t); setError(null) }
      return t
    } catch (e) {
      if (vivo.current) fallo(e, 'No se pudo leer la bandeja. ¿Tu cuenta tiene rol de supervisor o administrador?')
    } finally {
      if (vivo.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    vivo.current = true
    return () => { vivo.current = false }
  }, [])
  useEffect(() => {
    categoriaRef.current = categoria
    void refrescar(categoria)
  }, [categoria, refrescar])

  /** Lo más reciente de los pacientes con trámite abierto, para no empezar con la lista vacía. */
  const cargarRecientes = useCallback(async () => {
    try {
      const ids = [...new Set((await enCurso()).map((x) => x.paciente_id))].slice(0, 4)
      const js = (await Promise.allSettled(ids.map((id) => journey(id)))).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
      const viejos = js.flatMap((j) => j.linea_tiempo.slice(0, 15).map((e) => ({
        id: `${j.paciente.id}|${e.tipo_evento}|${Date.parse(e.ocurrido_en)}`, paciente: j.paciente.nombre || 'Paciente', tipo: e.tipo_evento, payload: e.payload, canal: e.canal, en: new Date(e.ocurrido_en).toISOString(),
      }))).filter((e) => !RUIDO.has(e.tipo))
      if (vivo.current) setEventos((x) => juntar(x, viejos))
    } catch (e) { console.warn('[bandeja] recientes', e) }
  }, [])
  useEffect(() => { void cargarRecientes() }, [cargarRecientes])

  /* Tiempo real: cualquier evento de cualquier paciente, venga del canal que venga. Una sola suscripción. */
  useEffect(() => {
    let espera: number | undefined
    const dejar = escucharTodo((e) => {
      window.clearTimeout(espera)
      espera = window.setTimeout(() => { void refrescar(categoriaRef.current) }, 400)
      if (RUIDO.has(e.tipo_evento)) return
      const nuevo = { id: `${e.paciente_id}|${e.tipo_evento}|${Date.parse(e.ocurrido_en)}`, tipo: e.tipo_evento, canal: e.canal, en: new Date(e.ocurrido_en).toISOString(), paciente: nombres.current.get(e.paciente_id) ?? 'Paciente' }
      setEventos((x) => juntar(x, [nuevo]))
      // el evento llega sin nombre: se busca una vez por paciente
      if (!nombres.current.has(e.paciente_id)) {
        nombres.current.set(e.paciente_id, 'Paciente')
        void journey(e.paciente_id).then((j) => {
          const nombre = j.paciente.nombre || 'Paciente'
          nombres.current.set(e.paciente_id, nombre)
          if (vivo.current) setEventos((x) => x.map((y) => (y.id.startsWith(`${e.paciente_id}|`) ? { ...y, paciente: nombre } : y)))
        }).catch(() => { nombres.current.delete(e.paciente_id) })
      }
    }, setConectado)
    return () => { window.clearTimeout(espera); dejar() }
  }, [refrescar])

  /* Sin tiempo real se vuelve a preguntar cada 20 s. */
  useEffect(() => {
    if (conectado !== false) return
    const n = window.setInterval(() => { void refrescar(categoriaRef.current); void cargarRecientes() }, 20_000)
    return () => window.clearInterval(n)
  }, [conectado, refrescar, cargarRecientes])

  const buscarPaciente = () => {
    const texto = q.trim()
    if (texto.length < 3) { setError('Escribe al menos 3 caracteres: celular, folio (SD-4K7Q) o nombre.'); return }
    setError(null)
    void buscar(texto)
      .then((r) => { setResultados(r); setElegido(null) })
      .catch((e: unknown) => fallo(e, 'No se pudo buscar al paciente.'))
  }

  /** Si el paciente es un familiar declarado, el recorrido que importa es el de su titular. */
  const abrir = (pacienteId: string, titularId: string | null = null) => {
    void journey(titularId ?? pacienteId)
      .then(setElegido)
      .catch((e: unknown) => fallo(e, 'No se pudo abrir el recorrido del paciente.'))
  }

  return (
    <section aria-labelledby="bandeja-t" className="mt-10 max-w-3xl">
      <h2 id="bandeja-t" className="t-section font-head text-titulo">Bandeja omnicanal</h2>
      <p className="mt-1 t-body">Trámites de todos los canales, no solo de este dispositivo. Se actualiza en cuanto algo pasa en WhatsApp, en el Call Center o en una clínica.</p>

      {/* conteos por categoría */}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Categorías de la bandeja">
        <button onClick={() => setCategoria(null)} aria-pressed={categoria === null} className={chip(categoria === null)}>Resumen</button>
        {ORDEN.map((c) => (
          <button key={c} onClick={() => setCategoria(c)} aria-pressed={categoria === c} className={chip(categoria === c)}>
            {NOMBRE_CATEGORIA[c]}{bandeja?.conteos?.[c] !== undefined && ` · ${bandeja.conteos[c]}`}
          </button>
        ))}
      </div>

      <div role="status" className="mt-3">
        {cargando && <p className="t-meta text-secundario">Leyendo la bandeja…</p>}
        {conectado === false && <p className="t-meta text-secundario">Sin tiempo real: se actualiza cada 20 segundos.</p>}
        {error && <p className="flex items-start gap-2 t-body font-semibold text-error"><Icon n="alert" className="mt-0.5" />{error}</p>}
      </div>

      {!categoria && (
        <>
          {tramites && (
            <>
              <h3 className="mt-4 t-sub font-bold text-titulo">Trámites en curso ({tramites.length})</h3>
              {tramites.length === 0
                ? <p className="mt-1 t-body">No hay trámites en curso.</p>
                : <ul className="mt-2" aria-label="Trámites en curso">
                    {tramites.slice(0, 10).map((x) => (
                      <li key={x.tramite_id} className="flex flex-col gap-1 border-t border-borde py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="t-sub font-bold text-titulo">{x.paciente}{x.clinica && <span className="font-normal text-cuerpo"> · {x.clinica}</span>}</p>
                          <p className="flex flex-wrap items-center gap-x-2 t-meta text-secundario">
                            <span className="inline-flex items-center gap-1"><Icon n={ICONO_CANAL[canalDesdeApi(x.ultimo_canal)]} />{nombreCanal(x.ultimo_canal)}</span>
                            <span>· {PASO[x.paso_actual] ?? x.paso_actual.replace(/_/g, ' ')} · {hace(x.ultima_actividad_en)}</span>
                          </p>
                        </div>
                        <button onClick={() => abrir(x.paciente_id)} aria-label={`Ver recorrido de ${x.paciente}`} className={`${link} shrink-0`}>Ver recorrido<Icon n="arrow" /></button>
                      </li>
                    ))}
                  </ul>}
            </>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4">
            <h3 className="t-sub font-bold text-titulo">Eventos recientes</h3>
            <button onClick={() => { void refrescar(null); void cargarRecientes() }} className={link}><Icon n="refresh" />Actualizar</button>
          </div>
          {eventos.length === 0
            ? <p className="t-body">Todavía no hay eventos. Aparecerán aquí en cuanto alguien use la web, WhatsApp, el Call Center o una clínica.</p>
            : <ol role="log" aria-label="Eventos recientes" tabIndex={0} className="max-h-96 overflow-y-auto">
                {eventos.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 border-t border-borde py-2">
                    <Icon n={ICONO_CANAL[canalDesdeApi(e.canal)]} className="mt-1 shrink-0 text-icono" />
                    <div>
                      <p className="t-body text-titulo"><strong className="font-bold">{e.paciente}</strong> · {detalleEvento(e.tipo, e.payload)}</p>
                      <p className="t-meta text-secundario">{nombreCanal(e.canal)} · {hace(e.en)}</p>
                    </div>
                  </li>
                ))}
              </ol>}
        </>
      )}

      {categoria && bandeja && bandeja.categoria === categoria && (
        bandeja.items.length === 0
          ? <p className="mt-2 rounded-lg bg-resaltado px-4 py-3 t-body text-titulo">No hay nada en “{NOMBRE_CATEGORIA[categoria]}”.</p>
          : <ul className="mt-2" aria-label={NOMBRE_CATEGORIA[categoria]}>
              {bandeja.items.map((i) => (
                <li key={`${i.paciente_id}-${i.tramite_id ?? i.cita_id ?? i.momento}`} className="flex flex-col gap-1 border-t border-borde py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="t-sub font-bold text-titulo">{i.paciente}
                      {i.folio && <span className="font-normal text-cuerpo"> · Folio {i.folio}</span>}</p>
                    <p className="flex flex-wrap items-center gap-x-2 t-meta text-secundario">
                      {i.canal && <span className="inline-flex items-center gap-1"><Icon n={ICONO_CANAL[canalDesdeApi(i.canal)]} />{CANAL[canalDesdeApi(i.canal)]}</span>}
                      <span>{i.detalle}</span>
                    </p>
                  </div>
                  <button onClick={() => abrir(i.paciente_id)} className={`${link} shrink-0`}>
                    Ver recorrido<Icon n="arrow" />
                  </button>
                </li>
              ))}
            </ul>
      )}

      {/* búsqueda real: por celular, folio o nombre, sobre todos los pacientes */}
      <div className="mt-8">
        <label htmlFor="buscar-api" className="text-base font-semibold text-titulo">Buscar paciente en el orquestador</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Icon n="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-secundario" />
            <input id="buscar-api" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && buscarPaciente()}
              placeholder="Ej. SD-4K7Q, 667 123 4567 o María López" className={`${fieldInput} h-12 pl-12`} />
          </div>
          <button onClick={buscarPaciente} className={outlineBtn}><Icon n="search" />Buscar</button>
        </div>

        {resultados && (
          resultados.length === 0
            ? <p role="status" className="mt-3 t-body text-titulo">No hay pacientes que coincidan con “{q.trim()}”.</p>
            : <ul className="mt-3" aria-label="Pacientes encontrados">
                {resultados.map((p) => (
                  <li key={p.paciente_id} className="flex flex-col gap-1 border-t border-borde py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="t-sub font-bold text-titulo">{p.nombre}
                        {p.telefono && <span className="font-normal text-cuerpo"> · {p.telefono}</span>}</p>
                      <p className="t-meta text-secundario">
                        {p.tramites_abiertos} {p.tramites_abiertos === 1 ? 'trámite abierto' : 'trámites abiertos'}
                        {p.ultimo_folio && ` · último folio ${p.ultimo_folio}`}
                        {p.ultima_actividad_en && ` · ${hace(p.ultima_actividad_en)}`}
                        {` · coincidió por ${p.coincide_por}`}
                      </p>
                    </div>
                    <button onClick={() => abrir(p.paciente_id, p.titular_id)} className={`${link} shrink-0`}>Ver recorrido<Icon n="arrow" /></button>
                  </li>
                ))}
              </ul>
        )}
      </div>

      {elegido && <Recorrido j={elegido} onCerrar={() => setElegido(null)} />}
    </section>
  )
}

/** El recorrido completo del paciente: sus trámites y la línea de tiempo con el canal de cada paso. */
function Recorrido({ j, onCerrar }: { j: Journey; onCerrar: () => void }) {
  return (
    <div className="mt-8 rounded-2xl border border-borde bg-superficie p-5 lg:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="t-card font-head text-titulo">{j.paciente.nombre || 'Paciente sin nombre'}</h3>
          <p className="t-meta text-secundario">{j.tramites.length} {j.tramites.length === 1 ? 'trámite' : 'trámites'} · {j.interacciones.length} interacciones</p>
        </div>
        <button onClick={onCerrar} className={link}><Icon n="x" />Cerrar</button>
      </div>

      {j.tramites.length > 0 && (
        <ul className="mt-4" aria-label="Trámites del paciente">
          {j.tramites.map((t) => (
            <li key={t.id} className="border-t border-borde py-3">
              <p className="t-sub font-bold text-titulo">Folio {t.folio}<span className="font-normal text-cuerpo"> · {t.etiqueta}</span></p>
              <p className="flex flex-wrap items-center gap-x-2 t-meta text-secundario">
                <span>{t.paso_descripcion ?? t.paso_actual}</span>
                {t.clinica && <span>· {t.clinica.nombre}</span>}
                {t.ultimo_canal && <span className="inline-flex items-center gap-1">· <Icon n={ICONO_CANAL[canalDesdeApi(t.ultimo_canal)]} />{CANAL[canalDesdeApi(t.ultimo_canal)]}</span>}
                {t.canales_usados && t.canales_usados.length > 1 && <span>· pasó por {t.canales_usados.length} canales</span>}
              </p>
              {t.resumen && <p className="mt-1 t-body">{t.resumen}</p>}
            </li>
          ))}
        </ul>
      )}

      {j.linea_tiempo.length > 0 && (
        <>
          <h4 className="mt-5 t-sub font-bold text-titulo">Línea de tiempo</h4>
          <ol className="mt-2" aria-label="Línea de tiempo del paciente">
            {j.linea_tiempo.map((e, i) => {
              const canal = canalDesdeApi(e.canal)
              return (
                <li key={`${e.ocurrido_en}-${i}`} className="flex items-start gap-3 border-t border-borde py-2">
                  <Icon n={ICONO_CANAL[canal]} className="mt-1 shrink-0 text-icono" />
                  <div>
                    <p className="t-body text-titulo">{detalleEvento(e.tipo_evento, e.payload)}</p>
                    <p className="t-meta text-secundario">{CANAL[canal]} · {hace(e.ocurrido_en)}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </div>
  )
}
