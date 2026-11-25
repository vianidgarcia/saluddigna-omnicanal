/* Audio entre el paciente y el asesor (WebRTC). El micrófono se pide solo al pulsar el botón y cada lado
   lo activa cuando quiere ("negociación perfecta": el paciente cede si los dos ofrecen a la vez).
   Sin TURN puede fallar entre redes distintas: queda el texto. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { esApi } from '../api/modo'
import type { Rol } from './transporte'

const ICE: RTCIceServer[] = esApi ? [{ urls: 'stun:stun.l.google.com:19302' }] : []
type Senal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
export type EstadoAudio = 'apagado' | 'conectando' | 'activo' | 'fallo'

export function useAudioWebRtc(rol: Rol, enviar: (s: unknown) => void) {
  const [estado, setEstado] = useState<EstadoAudio>('apagado')
  const [microfono, setMicrofono] = useState(false)
  const [silenciado, setSilenciado] = useState(false)
  const [errorAudio, setErrorAudio] = useState<string | null>(null)
  const pc = useRef<RTCPeerConnection | null>(null)
  const flujo = useRef<MediaStream | null>(null)
  const salida = useRef<HTMLAudioElement | null>(null)
  const ofreciendo = useRef(false)
  const ignorar = useRef(false)
  const pendientes = useRef<RTCIceCandidateInit[]>([])
  const cadena = useRef<Promise<void>>(Promise.resolve())
  /** Cambia al apagar: descarta permisos de micrófono concedidos después de colgar. */
  const sesion = useRef(0)
  const enviarRef = useRef(enviar)
  enviarRef.current = enviar

  const asegurar = useCallback(() => {
    if (pc.current) return pc.current
    const p = new RTCPeerConnection({ iceServers: ICE })
    pc.current = p
    p.onicecandidate = (e) => { if (e.candidate) enviarRef.current({ candidate: e.candidate.toJSON() }) }
    p.onnegotiationneeded = () => void (async () => {
      try {
        ofreciendo.current = true
        await p.setLocalDescription()
        enviarRef.current({ description: p.localDescription?.toJSON() })
      } catch { /* la conexión se cerró a media negociación */ } finally { ofreciendo.current = false }
    })()
    p.ontrack = (e) => {
      salida.current ??= new Audio()
      salida.current.srcObject = e.streams[0] ?? new MediaStream([e.track])
      void salida.current.play().catch(() => setErrorAudio('El navegador bloqueó el sonido. Pulsa “Activar micrófono” para escucharlo.'))
    }
    p.onconnectionstatechange = () => {
      if (pc.current !== p) return
      if (p.connectionState === 'connected') { setEstado('activo'); setErrorAudio(null) }
      else if (p.connectionState === 'connecting' || p.connectionState === 'disconnected') setEstado('conectando')
      else if (p.connectionState === 'failed') { setEstado('fallo'); setErrorAudio('No se pudo conectar el audio en esta red. Sigue por texto.') }
    }
    return p
  }, [])

  const recibir = useCallback((s: unknown) => {
    const n = sesion.current
    cadena.current = cadena.current.then(async () => {
      if (n !== sesion.current) return
      const { description, candidate } = (s ?? {}) as Senal
      const p = asegurar()
      if (description) {
        const choque = description.type === 'offer' && (ofreciendo.current || p.signalingState !== 'stable')
        ignorar.current = rol === 'asesor' && choque
        if (ignorar.current) return
        await p.setRemoteDescription(description)
        for (const c of pendientes.current.splice(0)) await p.addIceCandidate(c)
        if (description.type === 'offer') {
          await p.setLocalDescription()
          enviarRef.current({ description: p.localDescription?.toJSON() })
        }
      } else if (candidate && !ignorar.current) {
        if (p.remoteDescription) await p.addIceCandidate(candidate)
        else pendientes.current.push(candidate)
      }
    }).catch(() => { /* señal tardía o inválida */ })
  }, [asegurar, rol])

  const activarMicrofono = useCallback(async () => {
    setErrorAudio(null)
    void salida.current?.play().catch(() => {})
    if (flujo.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorAudio('El micrófono requiere HTTPS o localhost. Puedes seguir por texto.')
      return
    }
    const n = sesion.current
    try {
      const f = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (n !== sesion.current || flujo.current) { for (const t of f.getTracks()) t.stop(); return }
      flujo.current = f
      const p = asegurar()
      for (const pista of f.getTracks()) p.addTrack(pista, f)
      setMicrofono(true)
      setEstado((e) => (e === 'activo' ? e : 'conectando'))
    } catch {
      if (n === sesion.current) setErrorAudio('No pudimos usar el micrófono. Revisa el permiso o sigue por texto.')
    }
  }, [asegurar])

  const alternarSilencio = () => {
    for (const t of flujo.current?.getAudioTracks() ?? []) t.enabled = silenciado
    setSilenciado(!silenciado)
  }

  const apagar = useCallback(() => {
    sesion.current += 1
    for (const t of flujo.current?.getTracks() ?? []) t.stop()
    flujo.current = null
    const p = pc.current
    pc.current = null
    p?.close()
    if (salida.current) { salida.current.pause(); salida.current.srcObject = null }
    pendientes.current = []
    ignorar.current = false
    ofreciendo.current = false
    setMicrofono(false)
    setSilenciado(false)
    setEstado('apagado')
    setErrorAudio(null)
  }, [])

  useEffect(() => apagar, [apagar])
  return { estado, microfono, silenciado, errorAudio, recibir, activarMicrofono, alternarSilencio, apagar }
}
