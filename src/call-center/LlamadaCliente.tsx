/* Llamada del paciente, dentro del flujo de la página. La monta App: sobrevive al cambiar de vista. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../context'
import { esApi, haySimulador } from '../api/modo'
import { Icon } from '../components/Icon'
import { NB, container, link, outlineBtn } from '../components/ui'
import { PASOS } from '../state/tramite'
import { Conversacion, ControlAudio, apagado, campo } from './piezas'
import { TelefonoSimulado } from './TelefonoSimulado'
import { abrirTransporte, hayCallCenter, type Transporte } from './transporte'
import { MOTIVO_FIN, type Espera, type Linea, type MensajeServidor } from './tipos'
import { useAudioWebRtc } from './useAudioWebRtc'
import { useVoz } from './useVoz'

type Fase = 'marcar' | 'conectando' | 'sofia' | 'espera' | 'asesor' | 'fin'
const TITULO: Record<Fase, string> = {
  marcar: '¿A quién quieres llamar?', conectando: 'Conectando tu llamada…', sofia: 'Hablas con Sofía, asistente virtual', espera: 'En espera de un asesor',
  asesor: 'Hablas con un asesor', fin: 'Llamada terminada',
}
const ETIQUETA: Record<Espera, string> = {
  telefono: 'Tu celular a 10 dígitos', otp: 'Código de 6 dígitos', motivo: '¿En qué te ayudamos?', ninguna: 'Mensaje',
}

export default function LlamadaCliente({ onCerrar }: { onCerrar: () => void }) {
  const { tramite } = useApp()
  const [fase, setFase] = useState<Fase>('marcar')
  const [espera, setEspera] = useState<Espera>('ninguna')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [texto, setTexto] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)
  const [marcado, setMarcado] = useState<{ directo: boolean; tel: string } | null>(null)
  const [tel, setTel] = useState(tramite?.paciente.telefono ?? '')
  const [pideCodigo, setPideCodigo] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const tr = useRef<Transporte | null>(null)
  const callId = useRef('')
  const faseRef = useRef<Fase>('marcar')
  const titulo = useRef<HTMLHeadingElement>(null)
  const tramiteRef = useRef(tramite)
  tramiteRef.current = tramite
  const voz = useVoz()
  const vozRef = useRef(voz)
  vozRef.current = voz
  const audio = useAudioWebRtc('cliente', useCallback((signal: unknown) => {
    tr.current?.enviar({ tipo: 'webrtc:signal', callId: callId.current, hacia: 'asesor', signal })
  }, []))
  const { recibir, apagar } = audio

  useEffect(() => { titulo.current?.focus() }, [marcado])
  useEffect(() => {
    let vivo = true
    const pasar = (f: Fase) => { faseRef.current = f; setFase(f) }
    const decir = (l: Linea) => setLineas((x) => [...x, l])
    const silencio = () => { vozRef.current.callar(); vozRef.current.detener() }
    const acabar = (m: string) => {
      silencio()
      apagar()
      callId.current = ''
      pasar('fin')
      setAviso(m)
    }
    callId.current = ''
    setLineas([])
    setAviso(null)
    setTexto('')
    setEspera('ninguna')
    setPideCodigo(null)
    setCodigo('')
    if (!marcado) { pasar('marcar'); return }
    pasar('conectando')
    if (!hayCallCenter) {
      acabar('Las llamadas desde el portal no están disponibles por ahora. Marca al 55 5554 7166.')
      return
    }
    const alMensaje = (m: MensajeServidor) => {
      if (!vivo) return
      if (m.tipo !== 'call:started' && 'callId' in m && m.callId !== callId.current) return
      switch (m.tipo) {
        case 'call:started': callId.current = m.callId; pasar(marcado.directo ? 'espera' : 'sofia'); return
        case 'ia:utterance':
          setEspera(m.esperaRespuesta)
          decir({ autor: 'sofia', texto: m.texto })
          if (vozRef.current.altavoz) vozRef.current.hablar(m.texto, m.audioBase64, m.audioMime)
          return
        case 'call:transferring': pasar('espera'); return
        case 'call:connected':
          silencio()
          pasar('asesor')
          decir({ autor: 'sistema', texto: 'Un asesor contestó tu llamada.' })
          return
        case 'call:otp_request': setPideCodigo(m.enviadoA); return
        case 'call:otp_result':
          setAviso(m.message)
          setCodigo('')
          if (m.ok) setPideCodigo(null)
          return
        case 'chat:message': decir({ autor: 'asesor', texto: m.texto }); return
        case 'webrtc:signal': recibir(m.signal); return
        case 'call:ended': acabar(m.motivo === 'cliente_colgo' ? 'Terminaste la llamada.' : MOTIVO_FIN[m.motivo] ?? 'La llamada terminó.'); return
        case 'error':
          if (faseRef.current === 'conectando') acabar(`${m.message} También puedes marcar al 55 5554 7166.`)
          else setAviso(m.message)
          return
      }
    }
    const t = abrirTransporte('cliente', {
      mensaje: alMensaje,
      abierto: () => void (async () => {
        // Con el celular confirmado en el portal, Sofía ya no lo pide
        const jwtSupabase = esApi ? await jwtPaciente() : undefined
        const x = tramiteRef.current
        if (vivo) {
          t.enviar({
            tipo: 'call:start', jwtSupabase, directo: marcado.directo,
            telefonoSugerido: marcado.directo || esApi ? marcado.tel || undefined : undefined,
            // lo que lleva en el portal viaja con la llamada (la base solo lo conoce al confirmar)
            borrador: x && x.estado !== 'confirmada' ? { nombre: x.paciente.nombre, estudio: x.estudio?.nombre, clinica: x.clinica, fecha: x.fecha, hora: x.hora, paso: PASOS[x.paso] } : null,
          })
        }
      })(),
      caido: () => { if (vivo && faseRef.current !== 'fin') acabar('No hay conexión con el centro de llamadas. Vuelve a intentar o marca al 55 5554 7166.') },
    })
    tr.current = t
    return () => {
      vivo = false
      t.cerrar()
      tr.current = null
      vozRef.current.callar()
      apagar()
    }
  }, [marcado, apagar, recibir])

  const mandar = (t: string) => {
    const limpio = t.trim()
    if (!limpio || !callId.current) return
    setTexto('')
    setAviso(null)
    voz.callar()
    const codigo = fase === 'sofia' && espera === 'otp' && /\d/.test(limpio)
    setLineas((x) => [...x, { autor: 'paciente', texto: codigo ? '(código enviado)' : limpio }])
    tr.current?.enviar(fase === 'asesor'
      ? { tipo: 'chat:send', callId: callId.current, texto: limpio }
      : { tipo: 'call:speech', callId: callId.current, texto: limpio })
  }
  // el dictado responde después: usa la versión vigente de `mandar`
  const mandarRef = useRef(mandar)
  mandarRef.current = mandar

  const colgar = () => {
    if (callId.current) tr.current?.enviar({ tipo: 'call:hangup', callId: callId.current })
    else onCerrar()
  }
  const compartir = (c: string) => {
    if (callId.current && c.length === 6) tr.current?.enviar({ tipo: 'call:otp', callId: callId.current, codigo: c })
  }
  const telValido = tel.replace(/\D/g, '').length === 10
  const marcar = (directo: boolean) => setMarcado({ directo, tel: tel.replace(/\D/g, '') })
  const numerico = fase === 'sofia' && (espera === 'telefono' || espera === 'otp')
  const puedeEscribir = fase === 'asesor' || (fase === 'sofia' && espera !== 'ninguna')

  return (
    <section aria-labelledby="llamada-t" className="border-b border-borde bg-banda py-6">
      <div className={container}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="llamada-t" ref={titulo} tabIndex={-1} className="flex items-center gap-2 t-card font-head text-titulo"><Icon n="phone" />{TITULO[fase]}</h2>
          <div className="flex flex-wrap items-center gap-3">
            {fase === 'sofia' && (
              <button onClick={() => { voz.callar(); voz.setAltavoz(!voz.altavoz) }} aria-pressed={voz.altavoz} className={link}><Icon n="chat" />Voz de Sofía: {voz.altavoz ? 'encendida' : 'apagada'}</button>
            )}
            {fase === 'marcar' ? <button onClick={onCerrar} className={link}><Icon n="x" />Cerrar</button> : fase === 'fin'
              ? <>
                  <button onClick={() => setMarcado(null)} className={outlineBtn}><Icon n="phone" />Volver a llamar</button>
                  <button onClick={onCerrar} className={link}><Icon n="x" />Cerrar</button>
                </>
              : <button onClick={colgar} className={outlineBtn}><Icon n="x" />Colgar</button>}
          </div>
        </div>
        <p className="mt-1 t-meta text-secundario">Llamada por internet, de demostración. En una emergencia marca al 911.</p>
        {fase === 'marcar' && (
          <div className="mt-4 max-w-2xl">
            <label htmlFor="llamada-tel" className="text-base font-semibold text-titulo">Tu celular a 10 dígitos</label>
            <input id="llamada-tel" inputMode="numeric" autoComplete="off" maxLength={14} value={tel} onChange={(e) => setTel(e.target.value.replace(/[^\d ]/g, ''))} className={`${campo} mt-2`} aria-describedby="llamada-tel-h" />
            <p id="llamada-tel-h" className="mt-1 t-meta text-secundario">Con él ubicamos tus trámites. Los números de abajo son de ejemplo.</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button onClick={() => marcar(true)} disabled={!telValido} className={`${outlineBtn} ${apagado}`}><Icon n="headset" />Llamar a un asesor · 800{NB}000{NB}0101</button>
              <button onClick={() => marcar(false)} className={outlineBtn}><Icon n="phone" />Llamar a la contestadora · 800{NB}000{NB}0100</button>
            </div>
          </div>
        )}
        <div role="status">
          {fase === 'espera' && <p className="mt-3 t-body text-titulo">Tu llamada está en la fila. Puedes seguir usando el portal sin colgar.</p>}
          {aviso && <p className="mt-3 t-body font-semibold text-titulo">{aviso}</p>}
        </div>
        {fase === 'fin' && <a href="tel:+525555547166" className={link}><Icon n="phone" />Llamar 55{NB}5554{NB}7166</a>}

        {fase === 'asesor' && pideCodigo && (
          <div className="mt-4 max-w-2xl rounded-lg bg-resaltado p-4">
            <label htmlFor="llamada-codigo" className="text-base font-semibold text-titulo">Confirma tu identidad: código enviado a {pideCodigo}</label>
            <p className="t-meta text-secundario">Con él, el asesor puede ver tus trámites y continuarlos.</p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input id="llamada-codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && compartir(codigo)} className={campo} />
              <button onClick={() => compartir(codigo)} disabled={codigo.length !== 6} className={`${outlineBtn} ${apagado}`}><Icon n="shield" />Confirmar código</button>
            </div>
          </div>
        )}
        {haySimulador && telValido && fase !== 'marcar' && fase !== 'fin' && (
          <TelefonoSimulado telefono={tel.replace(/\D/g, '')} usar={pideCodigo ? compartir : fase === 'sofia' && espera === 'otp' ? mandar : null} />
        )}
        {lineas.length > 0 && <Conversacion lineas={lineas} yo="paciente" />}

        {puedeEscribir && (
          <div className="mt-4 max-w-2xl">
            <label htmlFor="llamada-texto" className="text-base font-semibold text-titulo">{fase === 'asesor' ? 'Escribe al asesor' : ETIQUETA[espera]}</label>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <input id="llamada-texto" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mandar(texto)}
                autoComplete="off" maxLength={300} inputMode={numerico ? 'numeric' : 'text'} className={campo} />
              <button onClick={() => mandar(texto)} disabled={!texto.trim()} className={`${outlineBtn} ${apagado}`}><Icon n="arrow" />Enviar</button>
              {fase === 'sofia' && voz.puedeDictar && (
                <button onClick={() => (voz.escuchando ? voz.detener() : voz.dictar((t) => mandarRef.current(t)))} aria-pressed={voz.escuchando} className={outlineBtn}>
                  <Icon n="mic" />{voz.escuchando ? 'Escuchando…' : 'Hablar'}
                </button>
              )}
            </div>
            {voz.errorVoz && fase === 'sofia' && <p role="alert" className="mt-2 t-body font-semibold text-error">{voz.errorVoz}</p>}
            {numerico && (
              <div className="mt-3 grid max-w-xs grid-cols-3 gap-2" role="group" aria-label="Teclado numérico">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'Borrar'].map((k, i) => k
                  ? <button key={k} onClick={() => setTexto((v) => (k === 'Borrar' ? v.slice(0, -1) : v + k))} className={`${outlineBtn} px-2`}>{k}</button>
                  : <span key={`hueco-${i}`} />)}
              </div>
            )}
            {fase === 'sofia' && espera === 'otp' && <button onClick={() => mandar('Quiero hablar con un asesor')} className={link}><Icon n="headset" />Seguir con un asesor sin código</button>}
            {fase === 'sofia' && espera === 'motivo' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {['Continuar mi trámite', 'Pedir información', 'Agendar una cita nueva'].map((x) => <button key={x} onClick={() => mandar(x)} className={outlineBtn}>{x}</button>)}
              </div>
            )}
          </div>
        )}
        {fase === 'asesor' && <ControlAudio a={audio} />}
      </div>
    </section>
  )
}

async function jwtPaciente(): Promise<string | undefined> {
  try {
    const { cliente } = await import('../api/cliente')
    return (await cliente()?.auth.getSession())?.data.session?.access_token
  } catch {
    return undefined
  }
}
