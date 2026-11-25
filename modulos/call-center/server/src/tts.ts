import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import type { ConfigServidor } from './config.js'

export interface AudioTts {
  audioBase64: string
  mime: string
}

const CACHE_MAX = 40
const cache = new Map<string, AudioTts>()

function guardarEnCache(clave: string, valor: AudioTts) {
  if (cache.size >= CACHE_MAX) {
    const primera = cache.keys().next().value
    if (primera) cache.delete(primera)
  }
  cache.set(clave, valor)
}

/**
 * Sintetiza voz mexicana natural con Microsoft Edge TTS (gratuito, sin API key).
 * Si falla o tarda más de 3 s (p. ej. sin internet en el venue), devuelve null para
 * que el navegador use inmediatamente Web Speech API (speechSynthesis es-MX).
 */
export async function sintetizarVoz(texto: string, cfg: ConfigServidor): Promise<AudioTts | null> {
  if (!cfg.enableServerTts || !texto.trim()) return null

  const clave = `${cfg.ttsVoice}:${texto}`
  const hit = cache.get(clave)
  if (hit) return hit

  const tts = new MsEdgeTTS({ connectionTimeoutMs: 2500, synthesisTimeoutMs: 3500 })
  let timer: NodeJS.Timeout | undefined

  try {
    const tarea = (async (): Promise<AudioTts> => {
      await tts.setMetadata(cfg.ttsVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
      const { audioStream } = tts.toStream(texto)
      const chunks: Buffer[] = []
      for await (const chunk of audioStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      const buffer = Buffer.concat(chunks)
      if (!buffer.length) throw new Error('Audio TTS vacío')
      return { audioBase64: buffer.toString('base64'), mime: 'audio/mpeg' }
    })()

    const limite = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 3200)
    })

    const resultado = await Promise.race([tarea, limite])
    if (resultado) {
      guardarEnCache(clave, resultado)
      return resultado
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    try {
      tts.close()
    } catch {
      /* noop */
    }
  }
}
