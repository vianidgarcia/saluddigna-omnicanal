/* Lado del asesor: disponible / no disponible, llamada entrante y llamada en curso. */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../context'
import { esApi } from '../api/modo'
import { Icon } from '../components/Icon'
import { outlineBtn, solidBtn } from '../components/ui'
import { conEvento, fechaLarga, fmtHora } from '../state/tramite'
import { Conversacion, ControlAudio, apagado, campo } from './piezas'
import { abrirTransporte, hayCallCenter, type Transporte } from './transporte'
import { MOTIVO_FIN, type Entrante, type Linea } from './tipos'
import { useAudioWebRtc } from './useAudioWebRtc'

/* Arrastra Supabase: solo se descarga en modo api, al contestar. */
const FichaLlamada = lazy(() => import('./FichaLlamada'))

const MOTIVO = { continuar_tramite: 'Continuar un trámite', informacion: 'Pedir información', nueva_cita: 'Cita nueva', otro: 'Por confirmar' }

/** Token del asesor y aviso cuando se renueva. En modo local no hay. */
async function sesionPersonal(alRenovar: (jwt: string) => void): Promise<{ jwt: string; dejar: () => void }> {
  if (!esApi) return { jwt: 'demo', dejar: () => {} }
  const { clientePersonal } = await import('../api/cliente')
  const c = clientePersonal()
  const jwt = (await c?.auth.getSession())?.data.session?.access_token
  if (!c || !jwt) throw new Error('Tu sesión venció. Sal y vuelve a entrar.')
  const { data } = c.auth.onAuthStateChange((ev, s) => { if (ev === 'TOKEN_REFRESHED' && s) alRenovar(s.access_token) })
  return { jwt, dejar: () => data.subscription.unsubscribe() }
}

export default function PanelLlamadas({ alAtender }: { alAtender: (e: Entrante) => void }) {
  const { update } = useApp()
  const [disponible, setDisponible] = useState(false)
  const [registrado, setRegistrado] = useState(false)
  const [entrante, setEntrante] = useState<Entrante | null>(null)
  const [actual, setActual] = useState<Entrante | null>(null)
  const [colgo, setColgo] = useState<string | null>(null)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [texto, setTexto] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [verificadas, setVerificadas] = useState(0)
  const tr = useRef<Transporte | null>(null)
  const actualRef = useRef<Entrante | null>(null)
  const alAtenderRef = useRef(alAtender)
  alAtenderRef.current = alAtender
  const updateRef = useRef(update)
  updateRef.current = update
  const audio = useAudioWebRtc('asesor', useCallback((signal: unknown) => {
    if (actualRef.current) tr.current?.enviar({ tipo: 'webrtc:signal', callId: actualRef.current.callId, hacia: 'cliente', signal })
  }, []))
  const { recibir, apagar } = audio

  /** Modo local: la llamada queda en la línea de tiempo del trámite de este navegador. */
  const anotar = useCallback((e: Entrante, tipo: string, detalle: string) => {
    if (esApi || !e.brief.tramiteFolioSugerido) return
    updateRef.current((x) => (x.id === e.brief.tramiteFolioSugerido ? conEvento(x, tipo, detalle, 'call_center') : x))
  }, [])

  useEffect(() => {
    if (!disponible || !hayCallCenter) return
    let vivo = true
    let dejar = () => {}
    let reintento: number | undefined
    const t = abrirTransporte('asesor', {
      abierto: () => void sesionPersonal((jwt) => t.enviar({ tipo: 'advisor:online', jwtAsesor: jwt }))
        .then((s) => {
          if (!vivo) { s.dejar(); return }
          dejar = s.dejar
          t.enviar({ tipo: 'advisor:online', jwtAsesor: s.jwt })
        })
        .catch((e: unknown) => {
          if (!vivo) return
          setAviso(e instanceof Error ? e.message : 'No se pudo entrar a la fila.')
          setDisponible(false)
        }),
      caido: () => {
        if (!vivo) return
        setRegistrado(false)
        setEntrante(null)
        if (actualRef.current) setColgo('Se perdió la conexión con el centro de llamadas.')
        apagar()
        setAviso('Sin conexión con el centro de llamadas. Reintentando…')
        reintento = window.setTimeout(() => setVuelta((n) => n + 1), 4000)
      },
      mensaje: (m) => {
        if (!vivo) return
        const id = actualRef.current?.callId
        switch (m.tipo) {
          case 'advisor:registered': setRegistrado(true); setAviso(null); return
          case 'advisor:ringing':
            // tras reconectar, aún puede estar capturando la llamada anterior
            if (actualRef.current) t.enviar({ tipo: 'advisor:reject', callId: m.pop.callId })
            else setEntrante(m.pop)
            return
          case 'advisor:answered':
            actualRef.current = m.pop
            setEntrante(null)
            setActual(m.pop)
            setColgo(null)
            setAviso(null)
            setLineas(m.pop.transcripcionIa.map((x): Linea => ({ autor: x.autor === 'ia' ? 'sofia' : x.autor, texto: x.texto })))
            anotar(m.pop, 'llamada.atendida', `Un asesor contestó la llamada. ${m.pop.brief.resumenIa}`)
            alAtenderRef.current(m.pop)
            return
          case 'advisor:call_taken': setEntrante((e) => (e?.callId === m.callId ? null : e)); return
          case 'advisor:call_ended':
            setEntrante((e) => (e?.callId === m.callId ? null : e))
            if (id === m.callId) { apagar(); setColgo(MOTIVO_FIN[m.motivo] ?? 'La llamada terminó.') }
            return
          case 'advisor:verified': if (id === m.callId) setVerificadas((n) => n + 1); return
          case 'chat:message': if (id === m.callId) setLineas((x) => [...x, { autor: 'paciente', texto: m.texto }]); return
          case 'webrtc:signal': if (id === m.callId) recibir(m.signal); return
          case 'error':
            setAviso(m.message)
            if (m.code === '42501') setDisponible(false)
            return
        }
      },
    })
    tr.current = t
    return () => {
      vivo = false
      window.clearTimeout(reintento)
      dejar()
      t.cerrar()
      tr.current = null
      setRegistrado(false)
      setEntrante(null)
    }
  }, [disponible, vuelta, apagar, recibir, anotar])

  const terminar = () => {
    if (!actual) return
    tr.current?.enviar({ tipo: 'advisor:hangup', callId: actual.callId })
    anotar(actual, 'llamada.terminada', 'Terminó la llamada con el asesor')
    actualRef.current = null
    setActual(null)
    setColgo(null)
    setLineas([])
    setTexto('')
    apagar()
  }
  const mandar = () => {
    const limpio = texto.trim()
    if (!limpio || !actual) return
    tr.current?.enviar({ tipo: 'chat:send', callId: actual.callId, texto: limpio })
    setLineas((x) => [...x, { autor: 'asesor', texto: limpio }])
    setTexto('')
  }

  return (
    <section aria-labelledby="cc-t" className={`mt-8 border-y border-borde py-6 ${actual ? '' : 'max-w-3xl'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cc-t" className="flex items-center gap-2 t-section font-head text-titulo"><Icon n="headset" />Llamadas</h2>
        <button onClick={() => { setAviso(null); setDisponible(!disponible) }} disabled={!!actual || !hayCallCenter} aria-pressed={disponible} className={`${outlineBtn} ${apagado}`}>
          <Icon n="phone" />{disponible ? 'Dejar de recibir llamadas' : 'Recibir llamadas'}
        </button>
      </div>
      <div role="status" className="mt-2">
        {!hayCallCenter && <p className="t-body">Falta configurar el servidor del call center (VITE_CALL_CENTER_URL).</p>}
        {hayCallCenter && !actual && !entrante && <p className="t-body">{registrado ? 'Disponible. En espera de llamadas.' : disponible ? 'Conectando…' : 'No disponible.'}</p>}
        {aviso && <p className="t-body font-semibold text-error">{aviso}</p>}
      </div>

      {entrante && !actual && (
        <div role="alert" className="mt-4 rounded-2xl border border-borde-accion bg-resaltado p-5">
          <h3 className="t-card font-head text-titulo">Llamada entrante · {entrante.brief.telefonoEnmascarado}</h3>
          <Resumen e={entrante} />
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => tr.current?.enviar({ tipo: 'advisor:answer', callId: entrante.callId })} className={solidBtn}><Icon n="phone" />Contestar</button>
            <button onClick={() => { tr.current?.enviar({ tipo: 'advisor:reject', callId: entrante.callId }); setEntrante(null) }} className={outlineBtn}><Icon n="x" />Rechazar</button>
          </div>
        </div>
      )}

      {actual && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="t-card font-head text-titulo">{colgo ? 'Llamada terminada' : 'En llamada'} · {actual.brief.telefonoEnmascarado}</h3>
            <button onClick={terminar} className={outlineBtn}><Icon n="x" />{colgo ? 'Terminar atención' : 'Colgar'}</button>
          </div>
          <div role="status">{colgo && <p className="mt-2 t-body font-semibold text-titulo">{colgo} Termina la atención cuando acabes de capturar.</p>}</div>
          <div className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-8">
          <div>
          <Resumen e={actual} />
          {!colgo && <ControlAudio a={audio} />}
          <Conversacion lineas={lineas} yo="asesor" />
          {!colgo && (
            <div className="mt-3">
              <label htmlFor="cc-texto" className="text-base font-semibold text-titulo">Escribe al paciente</label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input id="cc-texto" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mandar()} maxLength={300} autoComplete="off" className={campo} />
                <button onClick={mandar} disabled={!texto.trim()} className={`${outlineBtn} ${apagado}`}><Icon n="arrow" />Enviar</button>
              </div>
            </div>
          )}
          </div>
          {esApi && actual.contexto && (
            <Suspense fallback={<p role="status" className="mt-4 t-body">Abriendo el expediente…</p>}>
              <FichaLlamada key={actual.callId} inicial={actual.contexto} sugerido={actual.brief.tramiteIdSugerido ?? null}
                borrador={actual.borrador ?? null} telefono={actual.brief.telefonoNormalizado} verificadas={verificadas} />
            </Suspense>
          )}
          </div>
        </div>
      )}
    </section>
  )
}

function Resumen({ e }: { e: Entrante }) {
  const nombre = e.contexto?.paciente.nombre_mostrar
  return (
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <div><dt className="t-meta text-secundario">Motivo</dt><dd className="t-body font-semibold text-titulo">{MOTIVO[e.brief.motivo]}</dd></div>
      <div><dt className="t-meta text-secundario">Identidad al recibirla</dt><dd className="t-body font-semibold text-titulo">{e.requiereRevalidarEnAsesor ? 'Por verificar en la llamada' : 'Verificada con código'}</dd></div>
      <div className="sm:col-span-2"><dt className="t-meta text-secundario">Cómo llegó la llamada</dt><dd className="t-body text-titulo">{e.brief.resumenIa}</dd></div>
      {e.brief.tramiteFolioSugerido && <div><dt className="t-meta text-secundario">Folio</dt><dd className="t-body font-semibold text-titulo">{e.brief.tramiteFolioSugerido}</dd></div>}
      {e.borrador?.estudio && <div className="sm:col-span-2"><dt className="t-meta text-secundario">Llevaba en el portal (sin verificar)</dt><dd className="t-body text-titulo">{[e.borrador.estudio, e.borrador.clinica, e.borrador.fecha && fechaLarga(e.borrador.fecha), e.borrador.hora && fmtHora(e.borrador.hora)].filter(Boolean).join(' · ')}{e.borrador.paso && ` · se quedó en ${e.borrador.paso}`}</dd></div>}
      {nombre && <div><dt className="t-meta text-secundario">Paciente</dt><dd className="t-body font-semibold text-titulo">{nombre}</dd></div>}
    </dl>
  )
}
