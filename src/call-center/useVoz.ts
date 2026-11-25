/* Voz del navegador (Web Speech): Sofía habla y el paciente puede dictar. Todo es opcional: si el
   navegador no la tiene, queda el texto y el teclado. Chrome procesa el dictado en sus servidores. */
import { useCallback, useEffect, useRef, useState } from 'react'

type Reconocedor = {
  lang: string
  interimResults: boolean
  start(): void
  abort(): void
  onresult: ((e: { results: { [i: number]: { [i: number]: { transcript: string } } } }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type Ctor = new () => Reconocedor
const ctor = (): Ctor | undefined => {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export function useVoz() {
  const [altavoz, setAltavoz] = useState(true)
  const [escuchando, setEscuchando] = useState(false)
  const [errorVoz, setErrorVoz] = useState<string | null>(null)
  const rec = useRef<Reconocedor | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  const callar = useCallback(() => {
    audio.current?.pause()
    audio.current = null
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }, [])

  const hablar = useCallback((texto: string, base64?: string | null, mime?: string | null) => {
    callar()
    if (base64) {
      audio.current = new Audio(`data:${mime ?? 'audio/mpeg'};base64,${base64}`)
      void audio.current.play().catch(() => {})
      return
    }
    if (!('speechSynthesis' in window) || !texto) return
    const u = new SpeechSynthesisUtterance(texto)
    u.lang = 'es-MX'
    window.speechSynthesis.speak(u)
  }, [callar])

  const detener = useCallback(() => {
    const r = rec.current
    rec.current = null
    r?.abort()
    setEscuchando(false)
  }, [])

  const dictar = useCallback((alTexto: (t: string) => void) => {
    const C = ctor()
    if (!C) return
    callar()
    detener()
    const r = new C()
    r.lang = 'es-MX'
    r.interimResults = false
    r.onresult = (e) => { if (rec.current === r) alTexto(e.results[0][0].transcript) }
    r.onerror = (e) => { if (e.error !== 'aborted') setErrorVoz('No pudimos escucharte. Escribe tu respuesta o usa el teclado.') }
    r.onend = () => { if (rec.current === r) { rec.current = null; setEscuchando(false) } }
    rec.current = r
    setErrorVoz(null)
    setEscuchando(true)
    try { r.start() } catch { detener() }
  }, [callar, detener])

  useEffect(() => () => { callar(); rec.current?.abort() }, [callar])
  return { altavoz, setAltavoz, hablar, callar, dictar, detener, escuchando, puedeDictar: !!ctor(), errorVoz }
}
