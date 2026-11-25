import 'dotenv/config'

export interface ConfigServidor {
  port: number
  corsOrigin: string
  supabaseUrl: string
  supabaseAnonKey: string
  supabaseServiceRoleKey: string
  groqApiKey: string
  groqModel: string
  groqMaxRpm: number
  enableServerTts: boolean
  ttsVoice: string
}

export function cargarConfig(): ConfigServidor {
  const env = process.env
  return {
    port: Number(env.PORT || 4010),
    corsOrigin: env.CORS_ORIGIN || '*',
    supabaseUrl: env.SUPABASE_URL || 'http://127.0.0.1:54321',
    supabaseAnonKey: env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
    groqApiKey: env.GROQ_API_KEY || '',
    groqModel: env.GROQ_MODEL || 'llama-3.1-8b-instant',
    groqMaxRpm: Math.max(1, Number(env.GROQ_MAX_RPM || 20)),
    enableServerTts: (env.ENABLE_SERVER_TTS ?? 'false').toLowerCase() === 'true',
    ttsVoice: env.TTS_VOICE || 'es-MX-DaliaNeural',
  }
}

/** Normaliza teléfonos mexicanos ("866 123 4567" -> "528661234567") igual que PanelPaciente.tsx */
export function normalizarTelefonoMx(entrada: string): string {
  const digitos = entrada.replace(/\D/g, '')
  if (digitos.length === 10) return `52${digitos}`
  if (digitos.length === 13 && digitos.startsWith('521')) return `52${digitos.slice(3)}`
  return digitos
}

export function telefonoValido(entrada: string): boolean {
  const norm = normalizarTelefonoMx(entrada)
  return /^\d{12,15}$/.test(norm)
}

export function enmascararTelefono(tel: string): string {
  const d = normalizarTelefonoMx(tel)
  if (d.length < 4) return tel
  return `+${d.slice(0, 2)}${'*'.repeat(Math.max(2, d.length - 6))}${d.slice(-4)}`
}
