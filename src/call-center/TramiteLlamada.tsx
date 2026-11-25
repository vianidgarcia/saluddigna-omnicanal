/* El trámite que atiende el asesor: en qué paso se quedó, qué eligió y cómo continuarlo o corregirlo. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Beneficiario, Contexto, Estudio, Horario, Pago, Paso, Relacion, Tramite } from '../api/api'
import * as api from '../api/llamadas'
import { canalDesdeApi, partirFechaHora, zonaDe } from '../api/mapa'
import { haySimulador } from '../api/modo'
import { ClinicSheet } from '../components/ClinicSheet'
import { Icon } from '../components/Icon'
import { SelectorHorario } from '../components/SelectorHorario'
import { link, outlineBtn } from '../components/ui'
import { CLINICA_INICIAL } from '../data/clinics'
import { CANAL, fechaLarga, fmtHora } from '../state/tramite'
import { apagado, campo } from './piezas'

export type Hacer = (fn: () => Promise<unknown>, ok?: string) => Promise<void>

const PASOS: [Paso, string][] = [['seleccion_estudio', 'Estudio'], ['seleccion_clinica', 'Clínica'], ['seleccion_horario', 'Fecha y hora'], ['pago', 'Pago'], ['confirmada', 'Confirmada']]
const RELACION: Record<Relacion, string> = { titular: 'titular', hijo: 'hijo', hija: 'hija', madre: 'madre', padre: 'padre', conyuge: 'cónyuge', otro: 'otro familiar' }
export const nombrePaso = (p: Paso) => PASOS.find(([x]) => x === p)?.[1] ?? p
export const cuando = (iso: string, clinica?: string | null) => { const [f, h] = partirFechaHora(iso, zonaDe(clinica)); return f ? `${fechaLarga(f)}, ${fmtHora(h)}` : '' }

/** Avance del trámite, con el paso en que se quedó. */
export function Avance({ paso }: { paso: Paso }) {
  const en = PASOS.findIndex(([x]) => x === paso)
  return (
    <ol className="mt-2 flex flex-wrap gap-2" aria-label="Avance del trámite">
      {PASOS.map(([p, n], i) => (
        <li key={p} aria-current={i === en ? 'step' : undefined}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 t-meta ${i === en ? 'bg-ambar-fondo font-semibold text-ambar-texto' : i < en ? 'bg-resaltado text-titulo' : 'border border-borde text-secundario'}`}>
          {i < en && <Icon n="check" size={14} />}{n}{i === en && p !== 'confirmada' && ' · se quedó aquí'}
        </li>
      ))}
    </ol>
  )
}

function Dato({ t, children }: { t: string; children: React.ReactNode }) {
  return <div><dt className="t-meta text-secundario">{t}</dt><dd className="t-body font-semibold text-titulo">{children}</dd></div>
}

export function TramiteLlamada({ i, t, ctx, telefono, estudios, familia, recargarFamilia, ocupado, hacer }: {
  i: string; t: Tramite; ctx: Contexto; telefono: string; estudios: Estudio[]; familia: Beneficiario[]
  recargarFamilia: () => Promise<void>; ocupado: boolean; hacer: Hacer
}) {
  const [clinicas, setClinicas] = useState(false)
  const [fecha, setFecha] = useState<string | null>(null)
  const [hora, setHora] = useState<string | null>(null)
  const [pago, setPago] = useState<Pago | null>(null)
  const [estudio, setEstudio] = useState(t.contexto.estudio_id ?? '')
  const [para, setPara] = useState(t.contexto.beneficiario_id ?? ctx.paciente.id)
  const horarios = useRef<Horario[]>([])
  const p = t.paso_actual
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    setFecha(null)
    setHora(null)
    setPago(null)
    setEstudio(t.contexto.estudio_id ?? '')
    setPara(t.contexto.beneficiario_id ?? ctx.paciente.id)
    horarios.current = []
  }, [t.id, t.paso_actual, t.contexto.clinica_id, t.contexto.estudio_id, t.contexto.beneficiario_id, ctx.paciente.id])

  const consultar = useCallback(async (desde: string, hasta: string) => {
    const x = await api.horarios(tRef.current, desde, hasta)
    if (x) horarios.current = [...horarios.current, ...x]
    return x
  }, [])
  const liga = pago?.link_pago ?? (p === 'pago' ? ctx.pagos_pendientes?.find((x) => !x.folio || x.folio === t.folio)?.link_pago : undefined)
  const btn = `${outlineBtn} ${apagado}`
  const regreso = (paso: Paso, texto: string) =>
    <button onClick={() => void hacer(() => api.regresar(i, t, paso), `Listo: elige de nuevo (${nombrePaso(paso).toLowerCase()})`)} disabled={ocupado} className={`${link} ${apagado}`}><Icon n="left" />{texto}</button>

  return (
    <div className="mt-6 border-t border-borde pt-4">
      <h4 className="t-sub font-bold text-titulo">Trámite que atiendes: {t.etiqueta} · {t.folio}</h4>
      <Avance paso={p} />
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Dato t="Estudio">{t.estudio?.nombre ?? 'Sin elegir'}</Dato>
        <Dato t="Para">{t.beneficiario ? `${t.beneficiario.nombre ?? 'Sin nombre'} (${RELACION[t.beneficiario.relacion]})` : 'Titular'}</Dato>
        <Dato t="Clínica">{t.clinica ? `${t.clinica.nombre}, ${t.clinica.ciudad}` : 'Sin elegir'}</Dato>
        <Dato t="Fecha y hora">{t.contexto.fecha_hora ? cuando(t.contexto.fecha_hora, t.clinica?.nombre) : 'Sin elegir'}</Dato>
        {t.contexto.precio !== undefined && <Dato t="Monto (de ejemplo)">${t.contexto.precio}</Dato>}
        {t.canales_usados && <Dato t="Canales">{t.canales_usados.map((x) => CANAL[canalDesdeApi(x)]).join(' → ')}</Dato>}
      </dl>
      {t.estudio?.preparacion && <p className="mt-2 t-meta text-secundario">Preparación: {t.estudio.preparacion}</p>}
      {t.resumen && <p className="mt-2 whitespace-pre-line rounded-lg bg-resaltado px-3 py-2 t-body text-titulo">{t.resumen.replace(/^\[(ia|plantilla)\]\s*/, '')}</p>}

      {t.en_atencion_de_otro
        ? <p className="mt-3 t-body font-semibold text-titulo">Otra persona lo está atendiendo: se puede ver, pero no cambiar.</p>
        : (
          <div className="mt-4">
            {p === 'seleccion_estudio' && (
              <>
                <Para id="tl" {...{ i, ctx, familia, recargarFamilia, para, setPara, ocupado, hacer }} />
                <EligeEstudio id="tl-est" estudios={estudios} valor={estudio} cambiar={setEstudio} />
                <button onClick={() => void hacer(() => api.elegirEstudio(i, t, estudio, para), 'Estudio guardado')} disabled={ocupado || !estudio} className={`${btn} mt-3`}><Icon n="check" />Guardar estudio</button>
              </>
            )}
            {p === 'seleccion_clinica' && (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => setClinicas(true)} disabled={ocupado} className={btn}><Icon n="pin" />Elegir clínica</button>
                {regreso('seleccion_estudio', 'Cambiar estudio')}
              </div>
            )}
            {p === 'seleccion_horario' && (
              <>
                <SelectorHorario id="fl-h" key={`${t.id}|${t.contexto.clinica_id}`} consultar={consultar} fecha={fecha} hora={hora} onFecha={(v) => { if (v !== fecha) setHora(null); setFecha(v) }} onHora={setHora} />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button onClick={() => void hacer(() => api.reservar(i, t, horarios.current, fecha ?? '', hora ?? ''), 'Horario reservado')} disabled={ocupado || !fecha || !hora} className={btn}><Icon n="calendar" />Reservar horario</button>
                  {regreso('seleccion_clinica', 'Cambiar clínica')}
                </div>
              </>
            )}
            {p === 'pago' && (
              <>
                {liga && <p className="t-body break-all text-titulo">Liga de pago de ejemplo: {liga}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {!liga && <button onClick={() => void hacer(async () => setPago(await api.pago(i, t)), 'Liga de pago generada')} disabled={ocupado} className={btn}><Icon n="tarjeta" />Generar liga de pago</button>}
                  {liga && haySimulador && <button onClick={() => void hacer(() => api.pagoSimulado(liga, telefono), 'Pago de ejemplo acreditado')} disabled={ocupado} className={btn}><Icon n="tarjeta" />Simular pago (demo)</button>}
                  {regreso('seleccion_horario', 'Cambiar horario')}
                </div>
              </>
            )}
            {p === 'confirmada' && <p className="t-body font-semibold text-verde">Cita confirmada</p>}
          </div>
        )}
      {clinicas && (
        <ClinicSheet titulo="Clínica del paciente" current={CLINICA_INICIAL} sinSeleccion onClose={() => setClinicas(false)}
          onSelect={(cl) => void hacer(() => api.elegirClinica(i, t, cl.name), 'Clínica elegida')} />
      )}
    </div>
  )
}

export function EligeEstudio({ id, estudios, valor, cambiar }: { id: string; estudios: Estudio[]; valor: string; cambiar: (v: string) => void }) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="text-base font-semibold text-titulo">Estudio</label>
      <select id={id} value={valor} onChange={(e) => cambiar(e.target.value)} className={`${campo} mt-1`}>
        <option value="">Elige un estudio</option>
        {estudios.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
      </select>
    </div>
  )
}

/** Para quién es el estudio: el titular o un familiar (que se puede registrar aquí). */
export function Para({ id, i, ctx, familia, recargarFamilia, para, setPara, ocupado, hacer }: {
  id: string; i: string; ctx: Contexto; familia: Beneficiario[]; recargarFamilia: () => Promise<void>
  para: string; setPara: (v: string) => void; ocupado: boolean; hacer: Hacer
}) {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [nacimiento, setNacimiento] = useState('')
  const [relacion, setRelacion] = useState<Exclude<Relacion, 'titular'>>('hijo')
  return (
    <div>
      <label htmlFor={`${id}-para`} className="text-base font-semibold text-titulo">¿Para quién es?</label>
      <select id={`${id}-para`} value={para} onChange={(e) => setPara(e.target.value)} className={`${campo} mt-1`}>
        <option value={ctx.paciente.id}>{ctx.paciente.nombre ?? 'El titular'} (titular)</option>
        {familia.filter((f) => f.id !== ctx.paciente.id).map((f) => <option key={f.id} value={f.id}>{f.nombre_completo ?? f.nombre} ({RELACION[f.relacion]})</option>)}
      </select>
      <button onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className={link}><Icon n="user" />{abierto ? 'Cancelar familiar' : 'Agregar familiar'}</button>
      {abierto && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label htmlFor={`${id}-fn`} className="text-base font-semibold text-titulo">Nombre y apellidos</label><input id={`${id}-fn`} value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" className={campo} /></div>
          <div><label htmlFor={`${id}-fd`} className="text-base font-semibold text-titulo">Nacimiento</label><input id={`${id}-fd`} type="date" value={nacimiento} onChange={(e) => setNacimiento(e.target.value)} className={campo} /></div>
          <div><label htmlFor={`${id}-fr`} className="text-base font-semibold text-titulo">Parentesco</label>
            <select id={`${id}-fr`} value={relacion} onChange={(e) => setRelacion(e.target.value as typeof relacion)} className={campo}>
              {(['hijo', 'hija', 'madre', 'padre', 'conyuge', 'otro'] as const).map((r) => <option key={r} value={r}>{RELACION[r]}</option>)}
            </select></div>
          <button disabled={ocupado || nombre.trim().split(/\s+/).length < 2 || !nacimiento} className={`${outlineBtn} ${apagado}`}
            onClick={() => void hacer(async () => {
              const nuevo = await api.agregarFamiliar(i, nombre, nacimiento, relacion)
              await recargarFamilia()
              setPara(nuevo)
              setAbierto(false)
              setNombre('')
            }, 'Familiar registrado')}><Icon n="check" />Guardar familiar</button>
        </div>
      )}
    </div>
  )
}
