import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { enmascararTelefono, normalizarTelefonoMx, type ConfigServidor } from './config.js'
import type { Contexto, TurnoDialogo } from './tipos.js'

export interface UsuarioAuthVerificado {
  userId: string
  telefono: string | null
  telefonoConfirmado: boolean
  email?: string | null
  rol?: string | null
}

export interface ResultadoOtp {
  expira_en: string
  telefono_enmascarado: string
  /** false: el código se generó pero ningún canal lo entregó (no hay que pedírselo al paciente) */
  entregado: boolean
}

export interface ResultadoValidacion {
  verificado: boolean
  motivo?: string
  nivel_verificacion?: string
  contexto?: Contexto
}

export interface ISupabaseBridge {
  /** ¿Hay clave de servicio? Sin ella no existe la interacción 'ia', solo la del asesor. */
  readonly servicioDisponible: boolean
  verificarJwtUsuario(jwt: string): Promise<UsuarioAuthVerificado | null>
  abrirContactoIa(telefono: string, nivel: 'declarada' | 'canal'): Promise<Contexto>
  abrirContactoAsesor(jwtAsesor: string, telefono: string): Promise<Contexto>
  obtenerContexto(interaccionId: string, jwtAsesor?: string): Promise<Contexto>
  solicitarYEnviarOtp(params: {
    interaccionId: string
    telefono: string
    jwtAsesor?: string
  }): Promise<ResultadoOtp>
  validarOtp(interaccionId: string, codigo: string, jwtAsesor?: string): Promise<ResultadoValidacion>
  verificarFechaNacimiento(interaccionId: string, fechaIso: string, jwtAsesor?: string): Promise<ResultadoValidacion>
  registrarMensajesRecepcion(interaccionId: string, turnos: TurnoDialogo[], resumen: string, jwtAsesor?: string): Promise<void>
  cerrarInteraccion(interaccionId: string, resultado: string, jwtAsesor?: string): Promise<void>
}

export class ErrorPuente extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

/** Los códigos OTP dictados no se guardan en la conversación. */
export const ocultarCodigos = (t: string): string => t.replace(/(?<!\d)\d{6}(?!\d)/g, '******')

function normalizarError(e: unknown): ErrorPuente {
  if (e instanceof ErrorPuente) return e
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    return new ErrorPuente(String(o.code ?? 'SUPABASE_ERR'), String(o.message ?? 'Error de Supabase'), o.details)
  }
  return new ErrorPuente('SUPABASE_ERR', String(e))
}

export class SupabaseBridge implements ISupabaseBridge {
  private readonly service: SupabaseClient<any, 'api'>
  private readonly anon: SupabaseClient<any, 'api'>

  constructor(private readonly cfg: ConfigServidor) {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      throw new Error('Faltan SUPABASE_URL o SUPABASE_ANON_KEY en server/.env')
    }
    this.anon = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    this.service = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey || cfg.supabaseAnonKey, {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  get servicioDisponible(): boolean {
    return Boolean(this.cfg.supabaseServiceRoleKey)
  }

  /** Con x-sd-telefono el límite de la base cuenta por paciente. */
  private servicioPara(telefono: string): SupabaseClient<any, 'api'> {
    this.exigirServiceRole()
    return createClient(this.cfg.supabaseUrl, this.cfg.supabaseServiceRoleKey, {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-sd-telefono': normalizarTelefonoMx(telefono) } },
    })
  }

  private exigirServiceRole() {
    if (!this.cfg.supabaseServiceRoleKey) {
      throw new ErrorPuente(
        'CONFIG_SERVICE_ROLE',
        'Falta SUPABASE_SERVICE_ROLE_KEY en server/.env para operar el canal IA y el envío de OTP.',
      )
    }
  }

  private clienteAsesor(jwtAsesor: string): SupabaseClient<any, 'api'> {
    return createClient(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, {
      db: { schema: 'api' },
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwtAsesor}` } },
    })
  }

  private async rpc<T>(client: SupabaseClient<any, 'api'>, fn: string, args: object): Promise<T> {
    const { data, error } = await client.rpc(fn, args)
    if (error) throw normalizarError(error)
    return data as T
  }

  async verificarJwtUsuario(jwt: string): Promise<UsuarioAuthVerificado | null> {
    if (!jwt) return null
    const cliente = this.cfg.supabaseServiceRoleKey ? this.service : this.anon
    const { data, error } = await cliente.auth.getUser(jwt)
    if (error || !data.user) return null
    const u = data.user
    return {
      userId: u.id,
      telefono: u.phone ? normalizarTelefonoMx(u.phone) : null,
      telefonoConfirmado: Boolean(u.phone && u.phone_confirmed_at),
      email: u.email ?? null,
      rol: (u.app_metadata?.rol as string | undefined) ?? null,
    }
  }

  async abrirContactoIa(telefono: string, nivel: 'declarada' | 'canal'): Promise<Contexto> {
    return this.rpc<Contexto>(this.servicioPara(telefono), 'iniciar_contacto', {
      p_canal: 'call_center',
      p_telefono: normalizarTelefonoMx(telefono),
      p_agente: 'ia',
      p_nivel: nivel,
    })
  }

  async abrirContactoAsesor(jwtAsesor: string, telefono: string): Promise<Contexto> {
    return this.rpc<Contexto>(this.clienteAsesor(jwtAsesor), 'iniciar_contacto', {
      p_canal: 'call_center',
      p_telefono: normalizarTelefonoMx(telefono),
      p_agente: 'humano',
      p_nivel: 'declarada',
    })
  }

  async obtenerContexto(interaccionId: string, jwtAsesor?: string): Promise<Contexto> {
    const client = jwtAsesor ? this.clienteAsesor(jwtAsesor) : this.service
    if (!jwtAsesor) this.exigirServiceRole()
    return this.rpc<Contexto>(client, 'obtener_contexto', { p_interaccion_id: interaccionId })
  }

  async solicitarYEnviarOtp(params: {
    interaccionId: string
    telefono: string
    jwtAsesor?: string
  }): Promise<ResultadoOtp> {
    // Camino 1 (Idéntico al Call Center actual): si hay asesor preasignado, usamos la Edge Function `enviar-otp`
    if (params.jwtAsesor) {
      const cliente = this.clienteAsesor(params.jwtAsesor)
      const { data, error } = await cliente.functions.invoke('enviar-otp', {
        body: { interaccion_id: params.interaccionId },
      })
      if (!error && data) {
        return { ...(data as Omit<ResultadoOtp, 'entregado'>), entregado: true }
      }
      // PT429 y demás rechazos de la base se respetan; el respaldo es solo si la función no responde
      const cuerpo = await (error as { context?: Response } | null)?.context?.json?.().catch(() => null)
      if (cuerpo?.code) throw new ErrorPuente(String(cuerpo.code), String(cuerpo.message ?? ''), cuerpo)
      // Si la Edge Function no está levantada en local, caemos al respaldo con service_role
    }

    // Camino 2: service_role solicita el OTP directo y lo deposita en bandeja simulada si está encendida
    const otp = await this.rpc<{
      codigo: string
      expira_en: string
      telefono: string
      telefono_enmascarado: string
    }>(this.servicioPara(params.telefono), 'solicitar_otp', { p_interaccion_id: params.interaccionId })

    let entregado = false
    try {
      const simClient = createClient(this.cfg.supabaseUrl, this.cfg.supabaseServiceRoleKey, {
        db: { schema: 'simulador' as 'api' },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error } = await simClient.rpc('enviar', {
        p_telefono: otp.telefono,
        p_tipo: 'otp',
        p_contenido: `Salud Digna: tu código de verificación es ${otp.codigo}. Vence en 5 minutos. Díselo a la asistente telefónica.`,
      })
      if (!error) entregado = true
    } catch {
      /* En producción el esquema simulador está apagado */
    }

    return {
      expira_en: otp.expira_en,
      telefono_enmascarado: otp.telefono_enmascarado || enmascararTelefono(params.telefono),
      entregado,
    }
  }

  async validarOtp(interaccionId: string, codigo: string, jwtAsesor?: string): Promise<ResultadoValidacion> {
    const client = jwtAsesor ? this.clienteAsesor(jwtAsesor) : this.service
    if (!jwtAsesor) this.exigirServiceRole()
    return this.rpc<ResultadoValidacion>(client, 'validar_otp', {
      p_interaccion_id: interaccionId,
      p_codigo: codigo.trim(),
    })
  }

  async verificarFechaNacimiento(
    interaccionId: string,
    fechaIso: string,
    jwtAsesor?: string,
  ): Promise<ResultadoValidacion> {
    const client = jwtAsesor ? this.clienteAsesor(jwtAsesor) : this.service
    if (!jwtAsesor) this.exigirServiceRole()
    return this.rpc<ResultadoValidacion>(client, 'verificar_identidad', {
      p_interaccion_id: interaccionId,
      p_fecha_nacimiento: fechaIso,
    })
  }

  async registrarMensajesRecepcion(interaccionId: string, turnos: TurnoDialogo[], resumen: string, jwtAsesor?: string): Promise<void> {
    if (!jwtAsesor) this.exigirServiceRole()
    const lineas = turnos
      .filter((t) => t.autor !== 'sistema' && t.texto.trim())
      .slice(-8)
      .map((t) => `${t.autor === 'ia' ? 'Recepción IA' : 'Paciente'}: ${ocultarCodigos(t.texto)}`)
    const bloque = `[Recepción IA -> Transferencia]\nResumen: ${resumen}\n${lineas.join('\n')}`
    await this.rpc(jwtAsesor ? this.clienteAsesor(jwtAsesor) : this.service, 'registrar_mensaje', {
      p_interaccion_id: interaccionId,
      p_direccion: 'entrante',
      p_autor: 'agente_ia',
      p_contenido: bloque,
      p_metadatos: { origen: 'contestadora_ia', turnos: turnos.length },
    })
  }

  async cerrarInteraccion(interaccionId: string, resultado: string, jwtAsesor?: string): Promise<void> {
    const client = jwtAsesor ? this.clienteAsesor(jwtAsesor) : this.service
    if (!jwtAsesor) this.exigirServiceRole()
    await this.rpc(client, 'cerrar_interaccion', {
      p_interaccion_id: interaccionId,
      p_resultado: resultado,
    })
  }
}
