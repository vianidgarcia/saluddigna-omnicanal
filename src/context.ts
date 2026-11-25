import { createContext, useContext } from 'react'
import type { Contexto } from './api/api'
import type { EstadoEnlace } from './api/useOrquestador'
import type { Tramite } from './state/tramite'
import type { Rol, Sesion } from './state/sesion'

export type View = 'home' | 'pay' | 'tramites' | 'resultados' | 'agendar' | 'liga'
export type EstudioElegido = NonNullable<Tramite['estudio']>
export type AppCtx = {
  go: (v: View) => void
  toast: (msg?: string) => void
  openClinics: () => void
  scrollToId: (id: string) => void
  /** trámite activo (null si no hay) */
  tramite: Tramite | null
  /** aplica un cambio al trámite activo y lo guarda (checkpoint) */
  update: (fn: (t: Tramite) => Tramite) => void
  /** abre el flujo de agendado; con estudio lo deja preseleccionado */
  startAgendar: (estudio?: EstudioElegido) => void
  /** abre el paso exacto donde se quedó el paciente */
  continuar: () => void
  simularWhatsApp: () => void
  /** abre la llamada por internet con la contestadora */
  llamar: () => void
  /** sesión simulada por rol */
  sesion: Sesion | null
  salir: () => void
  /** visitante: abre la pantalla Entrar con un rol preseleccionado */
  abrirEntrar: (rol?: Rol, motivo?: string) => void
  reiniciarDemo: () => void
  /** Modo api: lo que la base sabe del paciente en todos los canales (null en modo local o sin conexión) */
  contextoApi: Contexto | null
  aplicarApi: (c: Contexto) => void
  enlaceApi: EstadoEnlace
  /** se está mandando el trámite a la base */
  enviandoApi: boolean
  /** abre la verificación por código de un celular de 10 dígitos */
  verificarCelular: (telefono: string) => void
  /** vuelve a mandar a la base el trámite que espera su pago */
  reenviarApi: () => void
  /** continúa un trámite abierto en cualquier canal */
  retomarApi: (tramiteId: string) => Promise<void>
  /** Modo api: estudios del portal que la base tiene (null = todos). */
  estudiosDisponibles?: Set<string> | null
  /** Modo api: horarios reales de una clínica entre dos fechas. Undefined en modo local. */
  horariosClinica?: (clinica: string, estudio: string, desde: string, hasta: string) => Promise<{ fecha: string; hora: string }[] | null>
}
export const Ctx = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = () => useContext(Ctx)
