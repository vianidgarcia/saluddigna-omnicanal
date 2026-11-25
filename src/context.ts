import { createContext, useContext } from 'react'
import type { Tramite } from './state/tramite'
import type { Rol, Sesion } from './state/sesion'

export type View = 'home' | 'pay' | 'tramites' | 'resultados' | 'agendar'
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
  /** sesión simulada por rol */
  sesion: Sesion | null
  salir: () => void
  /** visitante: abre la pantalla Entrar con un rol preseleccionado */
  abrirEntrar: (rol?: Rol, motivo?: string) => void
  reiniciarDemo: () => void
  /** Modo api: horarios reales de una clínica entre dos fechas. Undefined en modo local. */
  /** Modo api: estudios del portal que la base tiene (null = todos). */
  estudiosDisponibles?: Set<string> | null
  horariosClinica?: (clinica: string, estudio: string, desde: string, hasta: string) => Promise<{ fecha: string; hora: string }[] | null>
}
export const Ctx = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = () => useContext(Ctx)
