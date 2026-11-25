import type { ConfigServidor } from './config.js'

export interface MensajeGroq {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface RespuestaClasificadaIa {
  respuesta: string
  listo_transferir: boolean
  motivo: 'continuar_tramite' | 'informacion' | 'nueva_cita' | 'otro'
  folio_sugerido: string | null
  resumen_breve: string
}

/**
 * Cliente ultra ligero para Groq (OpenAI-compatible) diseñado para respetar
 * cuotas gratuitas bajas:
 *   - Ventana deslizante por minuto (GROQ_MAX_RPM)
 *   - Enfriamiento automático ante HTTP 429
 *   - Prompts compactos y salida JSON acotada (max_tokens: 150)
 *   - Si no hay cuota o falla la red, devuelve null para activar el respaldo local
 */
export class GroqClient {
  private marcasTiempo: number[] = []
  private bloqueadoHasta = 0

  constructor(private readonly cfg: ConfigServidor) {}

  get disponible(): boolean {
    if (!this.cfg.groqApiKey) return false
    const ahora = Date.now()
    if (ahora < this.bloqueadoHasta) return false
    this.marcasTiempo = this.marcasTiempo.filter((t) => ahora - t < 60_000)
    return this.marcasTiempo.length < this.cfg.groqMaxRpm
  }

  async completarJson(mensajes: MensajeGroq[]): Promise<RespuestaClasificadaIa | null> {
    if (!this.disponible) return null
    this.marcasTiempo.push(Date.now())

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.groqApiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.groqModel,
          temperature: 0.2,
          max_tokens: 160,
          response_format: { type: 'json_object' },
          messages: mensajes,
        }),
        signal: AbortSignal.timeout(5000),
      })

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') || 30)
        this.bloqueadoHasta = Date.now() + Math.min(60, Math.max(10, retryAfter)) * 1000
        return null
      }
      if (!res.ok) return null

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const raw = data.choices?.[0]?.message?.content?.trim()
      if (!raw) return null

      const parsed = JSON.parse(raw) as Partial<RespuestaClasificadaIa>
      if (!parsed.respuesta || typeof parsed.respuesta !== 'string') return null

      const motivoValido = ['continuar_tramite', 'informacion', 'nueva_cita', 'otro'].includes(
        String(parsed.motivo),
      )
        ? (parsed.motivo as RespuestaClasificadaIa['motivo'])
        : 'otro'

      return {
        respuesta: parsed.respuesta.trim(),
        listo_transferir: Boolean(parsed.listo_transferir),
        motivo: motivoValido,
        folio_sugerido: typeof parsed.folio_sugerido === 'string' ? parsed.folio_sugerido : null,
        resumen_breve:
          typeof parsed.resumen_breve === 'string' && parsed.resumen_breve.trim()
            ? parsed.resumen_breve.trim()
            : 'Paciente verificado solicita atención de un asesor.',
      }
    } catch {
      return null
    }
  }
}
