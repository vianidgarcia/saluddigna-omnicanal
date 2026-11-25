/* Expediente del paciente durante la llamada (modo api): quién es, sus trámites, en qué paso se quedó cada uno
   y cómo retomarlos o corregirlos. Todo se escribe en la base con la sesión del asesor. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Beneficiario, Contexto, Estudio } from '../api/api'
import * as api from '../api/llamadas'
import { canalDesdeApi, detalleEvento } from '../api/mapa'
import { Icon } from '../components/Icon'
import { link, outlineBtn } from '../components/ui'
import { CANAL, hace } from '../state/tramite'
import { apagado, campo } from './piezas'
import type { Borrador } from './tipos'
import { Avance, EligeEstudio, Para, TramiteLlamada, cuando, type Hacer } from './TramiteLlamada'

const NIVEL = { declarada: 'Sin verificar', canal: 'Verificación parcial', verificada: 'Identidad verificada' }

export default function FichaLlamada({ inicial, sugerido, borrador, telefono, verificadas }: {
  inicial: Contexto; sugerido: string | null; borrador: Borrador | null; telefono: string; verificadas: number
}) {
  const [ctx, setCtx] = useState(inicial)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [otpA, setOtpA] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [nacimiento, setNacimiento] = useState('')
  const [nombre, setNombre] = useState(borrador?.nombre ?? '')
  const [lista, setLista] = useState<Estudio[]>([])
  const [familia, setFamilia] = useState<Beneficiario[]>([])
  const [estudio, setEstudio] = useState('')
  const [para, setPara] = useState(inicial.paciente.id)
  const [abreNuevo, setAbreNuevo] = useState(false)
  const [usado, setUsado] = useState(false)
  const enCurso = useRef(false)

  const i = ctx.sesion.interaccion_id
  const nivel = ctx.sesion.nivel_verificacion
  const t = ctx.tramite_activo
  const faltan = ctx.sesion.requiere_registro ?? []
  const faltaNombre = faltan.some((x) => x !== 'celular_verificado')
  const faltaCelular = faltan.includes('celular_verificado')
  const pacienteId = ctx.paciente.id
  // por teléfono basta la verificación parcial (fecha de nacimiento): así lo decide la base
  const puedeAbrir = nivel !== 'declarada' && !faltaNombre && !faltaCelular

  const recargar = useCallback(async () => setCtx(await api.contexto(i)), [i])
  /** Toda acción recarga el expediente al final, también si falla: otro canal pudo moverlo. */
  const hacer: Hacer = async (fn, ok) => {
    if (enCurso.current) return
    enCurso.current = true
    setOcupado(true)
    setError(null)
    setAviso(null)
    try { const r = await fn(); setAviso(ok ?? (typeof r === 'string' ? r : null)) } catch (e) { setError(api.mensajeDe(e)) }
    try { await recargar() } catch (e) { setError((x) => x ?? api.mensajeDe(e)) }
    enCurso.current = false
    setOcupado(false)
  }

  useEffect(() => {
    let vivo = true
    let dejar: (() => void) | undefined
    let espera: number | undefined
    void api.escuchar(pacienteId, () => {
      window.clearTimeout(espera)
      espera = window.setTimeout(() => { if (vivo) void recargar().catch(() => {}) }, 500)
    }).then((f) => { if (vivo) dejar = f; else f() }).catch(() => { /* sin tiempo real: se recarga con cada acción */ })
    void api.estudios().then((x) => { if (vivo) setLista(x) }).catch(() => {})
    return () => { vivo = false; window.clearTimeout(espera); dejar?.() }
  }, [pacienteId, recargar])

  // el paciente escribió su código en su pantalla
  useEffect(() => {
    if (!verificadas) return
    setOtpA(null)
    void recargar().then(() => setAviso('Identidad verificada por el paciente')).catch((e: unknown) => setError(api.mensajeDe(e)))
  }, [verificadas, recargar])

  const recargarFamilia = useCallback(async () => { setFamilia(await api.familia(i)) }, [i])
  useEffect(() => { if (nivel !== 'declarada') void recargarFamilia().catch(() => {}) }, [nivel, recargarFamilia])

  const validar = () => hacer(async () => {
    const r = await api.confirmarOtp(i, codigo)
    if (!r.verificado) throw new Error(r.motivo === 'codigo_incorrecto' ? 'El código no coincide.' : 'No hay un código vigente. Envía otro.')
    setOtpA(null)
    setCodigo('')
  }, 'Identidad verificada')
  const porFecha = () => hacer(async () => {
    const r = await api.verificarFecha(i, nacimiento)
    if (!r.verificado) throw new Error(r.motivo === 'sin_fecha_registrada' ? 'No tiene fecha registrada: usa el código.' : 'La fecha no coincide.')
  }, 'La fecha coincide')
  const whatsapp = (ctx.mensajes_recientes ?? []).filter((m) => m.canal === 'whatsapp').slice(-6)
  const btn = `${outlineBtn} ${apagado}`

  return (
    <div className="mt-6 border-t border-borde pt-6 lg:mt-0 lg:border-t-0 lg:pt-3">
      <h3 className="t-card font-head text-titulo">{ctx.paciente.nombre || ctx.paciente.nombre_mostrar || 'Paciente sin nombre'}</h3>
      <p className="t-body">{NIVEL[nivel]}{ctx.paciente.telefono && ` · ${ctx.paciente.telefono}`}{ctx.paciente.avisos_whatsapp && ' · recibe avisos por WhatsApp'}</p>
      <div role="status">
        {aviso && <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-resaltado px-3 py-2 t-body font-semibold text-titulo"><Icon n="check" />{aviso}</p>}
        {ocupado && <p className="mt-2 t-meta text-secundario">Guardando…</p>}
      </div>
      {error && <p role="alert" className="mt-2 t-body font-semibold text-error">{error}</p>}

      {(nivel !== 'verificada' || faltaCelular) && (
        <div className="mt-4">
          <h4 className="t-sub font-bold text-titulo">Verificar identidad</h4>
          <p className="t-meta text-secundario">Al contestar se le manda un código: el paciente lo confirma en su pantalla y el expediente se abre solo. Si prefiere dictarlo, envíale otro desde aquí.</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <button onClick={() => void hacer(async () => setOtpA((await api.pedirOtp(i)).telefono_enmascarado), 'Código enviado al paciente')} disabled={ocupado} className={btn}><Icon n="chat" />{otpA ? 'Reenviar código' : 'Enviar código'}</button>
            {otpA && (
              <>
                <div>
                  <label htmlFor="fl-otp" className="text-base font-semibold text-titulo">Código que dicta el paciente ({otpA})</label>
                  <input id="fl-otp" inputMode="numeric" maxLength={6} autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} className={campo} />
                </div>
                <button onClick={() => void validar()} disabled={ocupado || codigo.length !== 6} className={btn}><Icon n="check" />Validar</button>
              </>
            )}
          </div>
          {nivel === 'declarada' && ctx.paciente.tiene_fecha_nacimiento && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="fl-nac" className="text-base font-semibold text-titulo">Fecha de nacimiento</label>
                <input id="fl-nac" type="date" value={nacimiento} onChange={(e) => setNacimiento(e.target.value)} className={campo} />
              </div>
              <button onClick={() => void porFecha()} disabled={ocupado || !nacimiento} className={btn}><Icon n="check" />Comprobar fecha</button>
            </div>
          )}
        </div>
      )}

      {nivel !== 'declarada' && faltaNombre && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label htmlFor="fl-nom" className="text-base font-semibold text-titulo">Nombre y apellidos del paciente</label>
            <input id="fl-nom" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" className={campo} />
          </div>
          <button onClick={() => void hacer(() => api.guardarNombre(i, nombre), 'Datos guardados')} disabled={ocupado || nombre.trim().split(/\s+/).length < 2} className={btn}><Icon n="check" />Guardar datos</button>
        </div>
      )}

      {borrador?.estudio && !usado && puedeAbrir && (
        <div className="mt-4 rounded-lg bg-resaltado p-4">
          <p className="t-body text-titulo">En el portal llevaba <b>{borrador.estudio}</b>{borrador.clinica && ` en ${borrador.clinica}`}{borrador.paso && ` y se quedó en ${borrador.paso}`}.</p>
          <button onClick={() => void hacer(async () => { const r = await api.continuarBorrador(i, borrador); setUsado(true); return r })} disabled={ocupado} className={`${btn} mt-2`}><Icon n="refresh" />Continuar lo del portal</button>
        </div>
      )}

      <h4 className="mt-6 t-sub font-bold text-titulo">Trámites pendientes ({ctx.tramites_abiertos.length})</h4>
      {nivel === 'declarada'
        ? <p className="t-body">{ctx.tramites_abiertos.map((x) => x.folio).join(', ') || 'Ninguno'}{ctx.tramites_abiertos.length > 0 && '. Se abren al verificar la identidad.'}</p>
        : (
          <ul>
            {ctx.tramites_abiertos.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-borde py-3">
                <div className="min-w-0">
                  <p className="t-body font-semibold text-titulo">{x.etiqueta ?? 'Trámite'} · {x.folio}{x.id === sugerido && ' · mencionado en la llamada'}</p>
                  <p className="t-meta text-secundario">{x.ultimo_canal && `Último canal: ${CANAL[canalDesdeApi(x.ultimo_canal)]}`}{x.ultima_actividad_en && ` · ${hace(x.ultima_actividad_en)}`}{x.en_atencion_de_otro && (x.atencion_canal === 'clinica' ? ' · lo atiende recepción de la clínica' : ' · lo atiende otro asesor')}</p>
                  <Avance paso={x.paso_actual} />
                </div>
                {t?.id === x.id && t.atendido_por_mi
                  ? <span className="t-body font-semibold text-titulo">Lo atiendes tú</span>
                  : <button onClick={() => void hacer(() => api.tomar(i, x.id), 'Trámite tomado')} disabled={ocupado || x.en_atencion_de_otro} className={btn}>Tomar trámite</button>}
              </li>
            ))}
            {!ctx.tramites_abiertos.length && <li className="t-body">No tiene trámites pendientes.</li>}
          </ul>
        )}

      {puedeAbrir && (
        <>
          <button onClick={() => setAbreNuevo(!abreNuevo)} aria-expanded={abreNuevo} className={link}><Icon n="file" />{abreNuevo ? 'Cancelar trámite nuevo' : 'Empezar otro trámite'}</button>
          {abreNuevo && (
            <div className="mt-2">
              <Para id="fl" {...{ i, ctx, familia, recargarFamilia, para, setPara, ocupado, hacer }} />
              <EligeEstudio id="fl-est" estudios={lista} valor={estudio} cambiar={setEstudio} />
              <button onClick={() => void hacer(async () => { await api.nuevo(i, estudio, para === pacienteId ? null : para); setAbreNuevo(false); setEstudio('') }, 'Trámite listo para continuar')} disabled={ocupado || !estudio} className={`${btn} mt-3`}><Icon n="file" />Iniciar trámite</button>
            </div>
          )}
        </>
      )}

      {t && nivel !== 'declarada' && <TramiteLlamada key={t.id} {...{ i, t, ctx, telefono, estudios: lista, familia, recargarFamilia, ocupado, hacer }} />}

      {!!ctx.citas_proximas?.length && (
        <div className="mt-6 border-t border-borde pt-4">
          <h4 className="t-sub font-bold text-titulo">Citas próximas</h4>
          <ul>{ctx.citas_proximas.map((x) => <li key={x.id} className="t-body">{cuando(x.fecha_hora, x.clinica)} · {x.estudio} · {x.clinica} · {x.estado.replace('_', ' ')}</li>)}</ul>
        </div>
      )}
      {whatsapp.length > 0 && (
        <div className="mt-6 border-t border-borde pt-4">
          <h4 className="t-sub font-bold text-titulo">WhatsApp del paciente (solo lectura)</h4>
          <ul>{whatsapp.map((m, n) => <li key={n} className="t-body break-words"><span className="text-secundario">{m.autor === 'paciente' ? 'Paciente' : 'Asistente'}: </span>{m.contenido}</li>)}</ul>
        </div>
      )}
      {!!ctx.linea_tiempo?.length && (
        <details className="mt-6 border-t border-borde pt-4">
          <summary className="min-h-12 cursor-pointer t-sub font-bold text-titulo">Línea de tiempo ({ctx.linea_tiempo.length})</summary>
          <ol>{ctx.linea_tiempo.slice(0, 20).map((e, n) => <li key={n} className="border-t border-borde py-2 t-body text-titulo">{detalleEvento(e.tipo_evento, e.payload)}<span className="block t-meta text-secundario">{CANAL[canalDesdeApi(e.canal)]} · {hace(e.ocurrido_en)}</span></li>)}</ol>
        </details>
      )}
      <button onClick={() => void hacer(async () => {})} disabled={ocupado} className={`${link} mt-2`}><Icon n="refresh" />Actualizar expediente</button>
    </div>
  )
}
