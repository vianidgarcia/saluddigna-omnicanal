/* Los clientes de Supabase. Este archivo SÍ arrastra la biblioteca de Supabase, así que solo se
   carga de forma diferida (desde orquestador.ts y personal.ts, que a su vez se importan con
   import() dinámico). Para saber el modo sin pagar ese peso, usa ./modo. */
import { crearCliente, type Cliente } from './api'
import { CLAVE_API, URL_API, esApi } from './modo'

export { MODO, esApi } from './modo'
export type { Modo } from './modo'

let cache: Cliente | null = null

/** Cliente de Supabase del PACIENTE (sesión anónima). null en modo local. */
export function cliente(): Cliente | null {
  if (!esApi) return null
  if (!cache) cache = crearCliente(URL_API, CLAVE_API, 'paciente')
  return cache
}

/** Cliente aparte para el personal: así el asesor y la paciente conviven en el mismo navegador. */
let cachePersonal: Cliente | null = null
export function clientePersonal(): Cliente | null {
  if (!esApi) return null
  if (!cachePersonal) cachePersonal = crearCliente(URL_API, CLAVE_API, 'personal')
  return cachePersonal
}
