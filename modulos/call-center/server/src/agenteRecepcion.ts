import { enmascararTelefono, normalizarTelefonoMx, telefonoValido } from './config.js'
import type { GroqClient } from './groqClient.js'
import { ErrorPuente, ocultarCodigos, type ISupabaseBridge } from './supabaseBridge.js'
import type { BriefRecepcion, Contexto, EtapaLlamada, TurnoDialogo } from './tipos.js'

const PALABRAS_DIGITO: Record<string, string> = {
  cero: '0',
  uno: '1',
  una: '1',
  dos: '2',
  tres: '3',
  cuatro: '4',
  cinco: '5',
  seis: '6',
  siete: '7',
  ocho: '8',
  nueve: '9',
}

/**
 * Extrae dígitos de voz transcrita en español ("uno dos 3 4 cinco 6" -> "123456").
 * Así ahorramos 100% de tokens de Groq en captura de teléfono y código OTP.
 */
export function extraerDigitosDeVoz(texto: string): string {
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const tokens = limpio.split(/[\s,.\-;:]+/).filter(Boolean)
  let out = ''
  for (const tok of tokens) {
    if (tok in PALABRAS_DIGITO) {
      out += PALABRAS_DIGITO[tok]
    } else if (/^\d+$/.test(tok)) {
      out += tok
    } else {
      const soloDig = tok.replace(/\D/g, '')
      if (soloDig) out += soloDig
    }
  }
  return out
}

function resumirContextoParaPrompt(ctx: Contexto): string {
  // Sin nombre ni teléfono: este texto sale hacia un proveedor externo
  const tramites = (ctx.tramites_abiertos ?? []).slice(0, 3).map((t) => {
    const paso = t.paso_descripcion || t.paso_actual
    return `${t.folio}: ${(t.etiqueta ?? 'trámite').split('·')[0].trim()} (paso: ${paso})`
  })
  const citas = (ctx.citas_proximas ?? []).slice(0, 2).map((c) => `${c.estudio} en ${c.clinica} (${c.estado})`)
  const pagos = ctx.pagos_pendientes?.length ?? 0

  return [
    `Nivel: ${ctx.sesion.nivel_verificacion}`,
    `Tramites: ${tramites.length ? tramites.join('; ') : 'ninguno'}`,
    `Citas: ${citas.length ? citas.join('; ') : 'ninguna'}`,
    `Pagos pendientes: ${pagos}`,
  ].join(' | ')
}

function descripcionPasoNatural(paso?: string): string {
  switch (paso) {
    case 'seleccion_estudio':
      return 'elegir el estudio'
    case 'seleccion_clinica':
      return 'elegir la clínica'
    case 'seleccion_horario':
      return 'elegir fecha y horario'
    case 'pago':
      return 'realizar el pago'
    case 'confirmada':
      return 'cita confirmada'
    default:
      return paso || 'en proceso'
  }
}

export interface RespuestaAgente {
  texto: string
  etapa: EtapaLlamada
  esperaRespuesta: 'telefono' | 'otp' | 'motivo' | 'ninguna'
  transferirAhora: boolean
  brief?: BriefRecepcion
  otpEnviadoA?: string
}

export interface EstadoLlamada {
  callId: string
  creadaEn: string
  etapa: EtapaLlamada
  telefono: string | null
  origenWebVerificado: boolean
  interaccionIaId: string | null
  interaccionAsesorId: string | null
  jwtAsesorPreasignado: string | null
  asesorPreasignadoSocketId: string | null
  contexto: Contexto | null
  intentosOtpFallidos: number
  /** El OTP se confirmó en la interacción vigente */
  verificado: boolean
  /** Cuántas veces la IA pidió aclarar el motivo (tope para no dar vueltas) */
  aclaraciones: number
  turnos: TurnoDialogo[]
  brief?: BriefRecepcion
}

export class AgenteRecepcion {
  constructor(
    private readonly bridge: ISupabaseBridge,
    private readonly groq: GroqClient,
  ) {}

  async iniciar(
    estado: EstadoLlamada,
    params: {
      jwtPaciente?: string
      telefonoSugerido?: string
      asesorDisponible?: { socketId: string; jwt: string } | null
    },
  ): Promise<RespuestaAgente> {
    let telefono: string | null = null
    let nivelInicial: 'canal' | 'declarada' = 'declarada'

    if (params.jwtPaciente) {
      const usuario = await this.bridge.verificarJwtUsuario(params.jwtPaciente)
      if (usuario?.telefono && usuario.telefonoConfirmado) {
        telefono = usuario.telefono
        nivelInicial = 'canal'
        estado.origenWebVerificado = true
      }
    }

    if (!telefono && params.telefonoSugerido && telefonoValido(params.telefonoSugerido)) {
      telefono = normalizarTelefonoMx(params.telefonoSugerido)
    }

    // Caso 1: No tenemos teléfono válido todavía -> Sofía lo pide por voz/texto
    if (!telefono) {
      estado.etapa = 'ia_pidiendo_telefono'
      const texto =
        '¡Hola! Gracias por comunicarte a Salud Digna, habla Sofía, tu asistente telefónica. ' +
        'Para consultar tu expediente y pasarte con un asesor, dime por favor tu número celular a 10 dígitos.'
      this.anotar(estado, 'ia', texto)
      return { texto, etapa: estado.etapa, esperaRespuesta: 'telefono', transferirAhora: false }
    }

    // Caso 2: Ya tenemos teléfono (de la sesión web o sugerido) -> abrimos en Supabase y mandamos OTP anti-bot
    return this.abrirExpedienteYEnviarOtp(estado, telefono, nivelInicial, params.asesorDisponible ?? null)
  }

  /** Marcó directo al asesor: sin menú ni código previo. Se verifica ya en la llamada. */
  iniciarDirecto(estado: EstadoLlamada, telefono: string | undefined): RespuestaAgente {
    if (!telefono || !telefonoValido(telefono)) {
      throw new ErrorPuente('TELEFONO', 'Escribe tu celular a 10 dígitos para llamar.')
    }
    estado.telefono = normalizarTelefonoMx(telefono)
    estado.etapa = 'transfiriendo_asesor'
    estado.brief = {
      motivo: 'otro',
      resumenIa: 'Llamó directo al asesor, sin pasar por la contestadora.',
      tramiteFolioSugerido: null,
      tramiteIdSugerido: null,
      verificadoPor: 'sin_verificar',
      telefonoNormalizado: estado.telefono,
      telefonoEnmascarado: enmascararTelefono(estado.telefono),
    }
    const texto = 'Te comunico con un asesor.'
    estado.turnos.push({ autor: 'sistema', texto, en: new Date().toISOString() })
    return { texto, etapa: estado.etapa, esperaRespuesta: 'ninguna', transferirAhora: true, brief: estado.brief }
  }

  async procesarMensaje(
    estado: EstadoLlamada,
    textoUsuario: string,
    asesorDisponible: { socketId: string; jwt: string } | null,
  ): Promise<RespuestaAgente> {
    const entrada = textoUsuario.trim()
    if (!entrada) {
      return {
        texto: 'No logré escucharte bien, ¿me lo puedes repetir por favor?',
        etapa: estado.etapa,
        esperaRespuesta: this.esperaDeEtapa(estado.etapa),
        transferirAhora: false,
      }
    }

    const esOtp = estado.etapa === 'ia_esperando_otp' && /\d{6}/.test(extraerDigitosDeVoz(entrada))
    this.anotar(estado, 'paciente', esOtp ? '(dictó su código)' : entrada)

    // 1) Esperando número telefónico
    if (estado.etapa === 'ia_pidiendo_telefono') {
      const digitos = extraerDigitosDeVoz(entrada)
      if (!telefonoValido(digitos)) {
        const texto = 'Necesito un número celular válido de 10 dígitos para buscarte en el sistema. ¿Me lo repites?'
        this.anotar(estado, 'ia', texto)
        return { texto, etapa: estado.etapa, esperaRespuesta: 'telefono', transferirAhora: false }
      }
      const tel = normalizarTelefonoMx(digitos)
      return this.abrirExpedienteYEnviarOtp(estado, tel, 'declarada', asesorDisponible)
    }

    // 2) Esperando OTP anti-bot de 6 dígitos
    if (estado.etapa === 'ia_esperando_otp') {
      const digitos = extraerDigitosDeVoz(entrada)
      const matchOtp = digitos.match(/\d{6}/)
      if (!matchOtp) {
        const plano = entrada.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        if (/asesor|humano|persona|agente/i.test(plano)) {
          return this.seguirSinVerificar(estado, 'Claro, un asesor confirmará tu identidad. ')
        }
        if (/reenvi|otro codigo|no llego|no me llega/i.test(plano)) {
          return this.reenviarOtp(estado)
        }
        const texto = 'Por favor dime o escribe el código de 6 dígitos que enviamos a tu teléfono para confirmar tu identidad.'
        this.anotar(estado, 'ia', texto)
        return { texto, etapa: estado.etapa, esperaRespuesta: 'otp', transferirAhora: false }
      }

      const codigo = matchOtp[0]
      const targetId = estado.interaccionAsesorId || estado.interaccionIaId!
      const jwtTarget = estado.interaccionAsesorId ? estado.jwtAsesorPreasignado ?? undefined : undefined

      const validacion = await this.bridge.validarOtp(targetId, codigo, jwtTarget)
      if (!validacion.verificado || !validacion.contexto) {
        estado.intentosOtpFallidos += 1
        if (estado.intentosOtpFallidos >= 3) {
          return this.seguirSinVerificar(estado, 'El código no coincidió en varios intentos, así que un asesor confirmará tu identidad. ')
        }
        const texto = 'Ese código no coincide o ya venció. Revísalo y dime los 6 dígitos de nuevo, por favor.'
        this.anotar(estado, 'ia', texto)
        return { texto, etapa: estado.etapa, esperaRespuesta: 'otp', transferirAhora: false }
      }

      // ¡Identidad verificada en PostgreSQL! Actualizamos también el contexto de la interacción IA si hace falta
      estado.contexto = validacion.contexto
      estado.verificado = true
      estado.etapa = 'ia_confirmando_motivo'
      return this.presentarContextoYConfirmarMotivo(estado)
    }

    // 3) Ya verificado: confirmando qué trámite desea continuar o qué información necesita antes de transferir
    if (estado.etapa === 'ia_confirmando_motivo') {
      return this.resolverMotivoYTransferir(estado, entrada)
    }

    return {
      texto: 'Tu llamada ya está siendo atendida por un asesor.',
      etapa: estado.etapa,
      esperaRespuesta: 'ninguna',
      transferirAhora: false,
    }
  }

  private async abrirExpedienteYEnviarOtp(
    estado: EstadoLlamada,
    telefono: string,
    nivelInicial: 'canal' | 'declarada',
    asesorDisponible: { socketId: string; jwt: string } | null,
  ): Promise<RespuestaAgente> {
    estado.telefono = telefono

    // Abrimos siempre interacción de IA para dejar rastro auditable de recepción IA
    // (sin clave de servicio no existe esta interacción: solo queda la del asesor).
    let ctxIa: Contexto | null = null
    if (this.bridge.servicioDisponible) {
      ctxIa = await this.bridge.abrirContactoIa(telefono, nivelInicial)
      estado.interaccionIaId = ctxIa.sesion.interaccion_id
      estado.contexto = ctxIa
    }

    // Si hay un asesor online en cola, pre-enlazamos su interacción humana para que el OTP quede
    // validado directamente sobre SU interacción en PostgreSQL (nivel_verificacion = 'verificada').
    let targetInteraccionOtp = estado.interaccionIaId
    let jwtAsesorParaOtp: string | undefined

    if (asesorDisponible) {
      try {
        const ctxAsesor = await this.bridge.abrirContactoAsesor(asesorDisponible.jwt, telefono)
        estado.contexto ??= ctxAsesor
        estado.interaccionAsesorId = ctxAsesor.sesion.interaccion_id
        estado.jwtAsesorPreasignado = asesorDisponible.jwt
        estado.asesorPreasignadoSocketId = asesorDisponible.socketId
        targetInteraccionOtp = ctxAsesor.sesion.interaccion_id
        jwtAsesorParaOtp = asesorDisponible.jwt
      } catch {
        // Si falla el pre-enlace (p. ej. token expirado), seguimos con intIa limpia
        estado.interaccionAsesorId = null
        estado.jwtAsesorPreasignado = null
        estado.asesorPreasignadoSocketId = null
      }
    }

    if (!targetInteraccionOtp) return this.seguirSinVerificar(estado, 'Gracias. Un asesor confirmará tu identidad. ')

    let otpInfo
    try {
      otpInfo = await this.bridge.solicitarYEnviarOtp({
        interaccionId: targetInteraccionOtp,
        telefono,
        jwtAsesor: jwtAsesorParaOtp,
      })
    } catch (e) {
      if (e instanceof ErrorPuente && e.code === 'PT429') {
        const texto =
          'Se solicitaron varios códigos hace poco para este número. Si ya tienes un código reciente de 6 dígitos dímelo, o espera unos minutos.'
        estado.etapa = 'ia_esperando_otp'
        this.anotar(estado, 'ia', texto)
        return { texto, etapa: estado.etapa, esperaRespuesta: 'otp', transferirAhora: false }
      }
      return this.seguirSinVerificar(estado, 'No pude enviarte un código en este momento; un asesor confirmará tu identidad. ')
    }
    if (!otpInfo.entregado) {
      return this.seguirSinVerificar(estado, 'No pude enviarte un código en este momento; un asesor confirmará tu identidad. ')
    }

    estado.etapa = 'ia_esperando_otp'
    const nombreCanal = nivelInicial === 'canal' && ctxIa?.paciente.nombre ? ctxIa.paciente.nombre : null
    const saludo = nombreCanal
      ? `¡Hola ${nombreCanal}! Habla Sofía de Salud Digna. Confirmé tu número terminado en ${telefono.slice(-4)}. `
      : `Gracias, ubiqué el número terminado en ${telefono.slice(-4)}. `
    const texto =
      `${saludo}Para confirmar que eres tú y proteger tu información, te envié un código de 6 dígitos a tu WhatsApp o SMS. ` +
      '¿Me lo dictas por favor?'

    this.anotar(estado, 'ia', texto)
    return {
      texto,
      etapa: estado.etapa,
      esperaRespuesta: 'otp',
      transferirAhora: false,
      otpEnviadoA: otpInfo.telefono_enmascarado,
    }
  }

  private async reenviarOtp(estado: EstadoLlamada): Promise<RespuestaAgente> {
    if (!estado.telefono || !(estado.interaccionAsesorId || estado.interaccionIaId)) {
      const texto = 'Primero necesito tu número celular a 10 dígitos.'
      this.anotar(estado, 'ia', texto)
      return { texto, etapa: 'ia_pidiendo_telefono', esperaRespuesta: 'telefono', transferirAhora: false }
    }
    const targetId = (estado.interaccionAsesorId || estado.interaccionIaId)!
    let otp
    try {
      otp = await this.bridge.solicitarYEnviarOtp({
      interaccionId: targetId,
      telefono: estado.telefono,
      jwtAsesor: estado.jwtAsesorPreasignado ?? undefined,
      })
    } catch {
      return this.seguirSinVerificar(estado, 'Por ahora no puedo enviar más códigos; un asesor confirmará tu identidad. ')
    }
    if (!otp.entregado) return this.seguirSinVerificar(estado, 'No pude enviarte otro código; un asesor confirmará tu identidad. ')
    const texto = `Listo, reenvié un nuevo código de 6 dígitos al número terminado en ${otp.telefono_enmascarado.slice(-4)}. ¿Cuál es?`
    this.anotar(estado, 'ia', texto)
    return {
      texto,
      etapa: estado.etapa,
      esperaRespuesta: 'otp',
      transferirAhora: false,
      otpEnviadoA: otp.telefono_enmascarado,
    }
  }

  /** Nunca deja al paciente atrapado: sin revelar datos, pasa al motivo y el asesor verifica. */
  private seguirSinVerificar(estado: EstadoLlamada, prefijo: string): RespuestaAgente {
    estado.verificado = false
    estado.etapa = 'ia_confirmando_motivo'
    const texto = `${prefijo}¿Qué necesitas: continuar un trámite, información o una cita nueva?`
    this.anotar(estado, 'ia', texto)
    return { texto, etapa: estado.etapa, esperaRespuesta: 'motivo', transferirAhora: false }
  }

  private async presentarContextoYConfirmarMotivo(estado: EstadoLlamada): Promise<RespuestaAgente> {
    const ctx = estado.contexto!
    const nombre = ctx.paciente.nombre || ctx.paciente.nombre_mostrar || 'Paciente'
    const abiertos = ctx.tramites_abiertos ?? []
    const citas = ctx.citas_proximas ?? []

    let detalle = ''
    if (abiertos.length === 1) {
      const t = abiertos[0]
      detalle = `Veo que tienes un trámite pendiente de ${t.etiqueta ?? 'estudio'} con folio ${t.folio}, en el paso de ${descripcionPasoNatural(t.paso_actual)}. `
    } else if (abiertos.length > 1) {
      const lista = abiertos
        .slice(0, 2)
        .map((t) => `${t.etiqueta ?? 'estudio'} (${t.folio})`)
        .join(' y ')
      detalle = `Veo que tienes ${abiertos.length} trámites pendientes, como ${lista}. `
    } else if (citas.length > 0) {
      const c = citas[0]
      detalle = `Veo tu cita de ${c.estudio} en ${c.clinica} con estado ${c.estado}. `
    } else {
      detalle = 'Veo que aún no tienes trámites abiertos en proceso. '
    }

    const texto =
      `¡Gracias, ${nombre}! Ya confirmé tu identidad. ${detalle}` +
      '¿Deseas continuar con ese trámite, necesitas información sobre estudios o quieres agendar algo nuevo?'

    this.anotar(estado, 'ia', texto)
    return { texto, etapa: estado.etapa, esperaRespuesta: 'motivo', transferirAhora: false }
  }

  private async resolverMotivoYTransferir(estado: EstadoLlamada, entrada: string): Promise<RespuestaAgente> {
    const ctx = estado.verificado ? estado.contexto : null
    const abiertos = ctx?.tramites_abiertos ?? []
    const nombre = ctx?.paciente.nombre || ctx?.paciente.nombre_mostrar || 'Paciente'

    // Intentamos enriquecer la respuesta con Groq (solo 1 llamada compacta con JSON estricto)
    const ia = await this.groq.completarJson([
      {
        role: 'system',
        content:
          'Eres Sofía, recepcionista telefónica de Salud Digna (México). Responde SIEMPRE JSON válido con estas claves: ' +
          '{"respuesta":"1-2 oraciones naturales en español mexicano","listo_transferir":boolean,"motivo":"continuar_tramite"|"informacion"|"nueva_cita"|"otro","folio_sugerido":string|null,"resumen_breve":"1 frase para el asesor"}. ' +
          'Usa SOLO datos del contexto real. Si el paciente indica qué trámite quiere, pide información o dice sí/continuar/asesor, marca listo_transferir:true y dile que lo comunicas con un asesor que ya tiene su expediente.',
      },
      {
        role: 'user',
        content: `Contexto real: ${ctx ? resumirContextoParaPrompt(ctx) : 'identidad sin verificar, sin datos'}\nPaciente dijo: "${ocultarCodigos(entrada).replace(/\d{7,}/g, '[número]').slice(0, 260)}"`,
      },
    ])

    let texto: string
    let listo = true
    let motivo: BriefRecepcion['motivo'] = 'continuar_tramite'
    let folioSugerido: string | null = abiertos[0]?.folio ?? null
    let resumenIa = ''

    if (ia) {
      texto = ia.respuesta
      listo = ia.listo_transferir || estado.aclaraciones >= 2
      motivo = ia.motivo
      folioSugerido = ia.folio_sugerido || abiertos[0]?.folio || null
      resumenIa = ia.resumen_breve
    } else {
      // Fallback determinista cuando Groq no está disponible o alcanzó cuota gratuita
      const lower = entrada.toLowerCase()
      if (/info|precio|preparacion|ayuno|donde|sucursal|horario|duda/.test(lower)) {
        motivo = 'informacion'
        resumenIa = `${nombre} solicita información: "${entrada.slice(0, 120)}".`
      } else if (/nuevo|otro|agendar otro|otra cita/.test(lower)) {
        motivo = 'nueva_cita'
        folioSugerido = null
        resumenIa = `${nombre} desea iniciar un trámite nuevo (${entrada.slice(0, 100)}).`
      } else {
        motivo = abiertos.length ? 'continuar_tramite' : 'nueva_cita'
        const tMatch = abiertos.find(
          (t) =>
            lower.includes(t.folio.toLowerCase()) ||
            (t.etiqueta && lower.includes(t.etiqueta.split('·')[0].trim().toLowerCase())),
        )
        const elegido = tMatch ?? abiertos[0]
        folioSugerido = elegido?.folio ?? null
        resumenIa = elegido
          ? `${nombre} quiere continuar con ${elegido.etiqueta} (${elegido.folio}, paso: ${descripcionPasoNatural(elegido.paso_actual)}).`
          : `${nombre} solicita atención telefónica: "${entrada.slice(0, 120)}".`
      }
      texto = ctx
        ? `Perfecto, ${nombre}. Ya dejé listo tu expediente para que no repitas datos; te transfiero ahora mismo con un asesor.`
        : 'Perfecto, te transfiero con un asesor y le paso lo que me contaste.'
    }

    if (!listo) {
      estado.aclaraciones += 1
      this.anotar(estado, 'ia', texto)
      return { texto, etapa: estado.etapa, esperaRespuesta: 'motivo', transferirAhora: false }
    }

    const tramiteSugerido = folioSugerido
      ? abiertos.find((t) => t.folio.toUpperCase() === folioSugerido!.toUpperCase())
      : abiertos[0]

    const brief: BriefRecepcion = {
      motivo,
      resumenIa,
      tramiteFolioSugerido: tramiteSugerido?.folio ?? folioSugerido ?? null,
      tramiteIdSugerido: tramiteSugerido?.id ?? null,
      verificadoPor: !estado.verificado ? 'sin_verificar' : estado.origenWebVerificado ? 'sesion_web_y_otp' : 'otp',
      telefonoNormalizado: estado.telefono ?? '',
      telefonoEnmascarado: ctx?.paciente.telefono || enmascararTelefono(estado.telefono ?? ''),
    }

    estado.brief = brief
    estado.etapa = 'transfiriendo_asesor'
    this.anotar(estado, 'ia', texto)

    return {
      texto,
      etapa: 'transfiriendo_asesor',
      esperaRespuesta: 'ninguna',
      transferirAhora: true,
      brief,
    }
  }

  private esperaDeEtapa(etapa: EtapaLlamada): 'telefono' | 'otp' | 'motivo' | 'ninguna' {
    if (etapa === 'ia_pidiendo_telefono') return 'telefono'
    if (etapa === 'ia_esperando_otp') return 'otp'
    if (etapa === 'ia_confirmando_motivo') return 'motivo'
    return 'ninguna'
  }

  private anotar(estado: EstadoLlamada, autor: 'ia' | 'paciente', texto: string) {
    estado.turnos.push({ autor, texto, en: new Date().toISOString() })
  }
}
