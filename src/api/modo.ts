/* En qué modo corre el portal. Este archivo NO importa el cliente de Supabase a propósito:
 * así el código del orquestador (y la biblioteca de Supabase, unos 66 kB comprimidos) solo se
 * descarga cuando de verdad se usa, igual que el mapa y el generador de PDF.
 *
 *   local → todo simulado en localStorage (lo que había antes). No necesita backend.
 *   api   → el trámite vive en Supabase y se comparte con WhatsApp, call center y clínica.
 *
 * Si el modo es "api" pero faltan la URL o la clave, se degrada a "local" con un aviso en consola
 * en vez de romper: durante una demostración es preferible un portal que funcione solo a una
 * pantalla en blanco.
 */
export type Modo = 'local' | 'api'

const env = import.meta.env
export const URL_API = (env.VITE_SUPABASE_URL ?? '') as string
export const CLAVE_API = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '') as string

function decidirModo(): Modo {
  if ((env.VITE_MODO ?? 'local') !== 'api') return 'local'
  if (!URL_API || !CLAVE_API) {
    console.warn('[orquestador] VITE_MODO=api pero falta VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY: el portal sigue en modo local.')
    return 'local'
  }
  return 'api'
}

export const MODO: Modo = decidirModo()
export const esApi = MODO === 'api'

/** 'app' si corre instalada (PWA), 'web' en el navegador: así lo distingue la base. */
export const canalPropio = (): 'app' | 'web' =>
  typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches ? 'app' : 'web'

/** Teléfono y pagos simulados del backend: SOLO con la Supabase de esta computadora, nunca con una publicada. */
export const haySimulador = esApi && env.VITE_SIMULADOR === 'true' && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL_API)
