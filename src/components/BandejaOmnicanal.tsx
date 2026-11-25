/* Bandeja omnicanal: lo que el asesor ve del orquestador, con TODOS los canales juntos.
 *
 * Solo aparece en modo api. Es la prueba de que el portal, WhatsApp, el call center y la clínica
 * comparten un mismo trámite: aquí salen pacientes que nunca pasaron por la web, y la línea de
 * tiempo dice por qué canal entró cada paso.
 *
 * En modo local la vista del asesor sigue funcionando con el trámite de este dispositivo.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Bandeja, CategoriaBandeja, Journey, PacienteEncontrado } from '../api/api'
import { buscar, categoriaBandeja, conteosBandeja, escucharTodo, journey } from '../api/personal'
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
const ORDEN: CategoriaBandeja[] = ['atorados', 'pago_por_vencer', 'en_atencion', 'seguridad', 'llegadas_hoy']

export function BandejaOmnicanal() {
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
      const b = cat ? await categoriaBandeja(cat) : await conteosBandeja()
      if (vivo.current) { setBandeja(b); setError(null) }
    } catch (e) {
      if (vivo.current) fallo(e, 'No se pudo leer la bandeja. ¿Tu cuenta tiene rol de supervisor o administrador?')
    } finally {
      if (vivo.current) setCargando(false)
    }
  }, [])

  useEffect(() => {
    vivo.current = true
    void refrescar(categoria)
    return () => { vivo.current = false }
  }, [categoria, refrescar])

  /* Tiempo real: cualquier evento de cualquier paciente, venga del canal que venga. */
  useEffect(() => {
    let dejar: (() => void) | null = null
    void escucharTodo(() => { void refrescar(categoria) }).then((f) => { dejar = f }).catch(() => { /* sin tiempo real: queda el refresco manual */ })
    return () => dejar?.()
  }, [categoria, refrescar])

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
        {error && <p className="flex items-start gap-2 t-body font-semibold text-error"><Icon n="alert" className="mt-0.5" />{error}</p>}
      </div>

      {categoria && bandeja && (
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
