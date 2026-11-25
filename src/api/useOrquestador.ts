/* El hook que usa App.tsx para hablar con el orquestador.
 *
 * Qué resuelve:
 *   · En modo local no hace NADA (ni una llamada de red): el portal queda igual que antes.
 *   · En modo api abre la sesión, empuja la confirmación a la base y escucha los cambios que
 *     llegan de WhatsApp, del call center o de recepción.
 *   · Si el backend falla a media demostración, avisa y DEJA CONTINUAR con el flujo simulado.
 *     Para el jurado es mejor un portal que funcione solo que una pantalla trabada.
 *
 * Los pasos 1 a 3 se trabajan en local porque la base exige nombre, apellido y celular verificado
 * antes de abrir un trámite, y el portal pide esos datos hasta el paso 4. Al confirmar se manda
 * todo junto: registro, trámite, clínica, horario y pago.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Contexto, EventoPaciente, ModoOtp } from './api'
import { MODO, canalPropio, esApi } from './modo'
import { canalDesdeApi, confirmarDesdeCita, detalleEvento, esMismoTramite, fusionarDesdeApi } from './mapa'
import { CANAL, conEvento, type Tramite } from '../state/tramite'
import { STUDIES } from '../data/studies'

/* El orquestador (y con él la biblioteca de Supabase) se descarga la primera vez que se necesita.
   En modo local nunca se pide, así que el arranque del portal pesa lo mismo que antes. */
type Orq = typeof import('./orquestador')
let modulo: Promise<Orq> | null = null
const cargar = (): Promise<Orq> => (modulo ??= import('./orquestador'))

/** Los errores de la API traen un aviso ya redactado para una persona (ErrorApi). */
type AvisoApi = { aviso: string; code: string }
const esErrorApi = (e: unknown): e is AvisoApi =>
  !!e && typeof e === 'object' && typeof (e as AvisoApi).aviso === 'string' && typeof (e as AvisoApi).code === 'string'

export type EstadoEnlace = 'apagado' | 'conectando' | 'listo' | 'sin_conexion'

/** Lo que hace falta antes de poder mandar el trámite a la base. */
export type Pendiente = { necesitaOtp: true; telefono: string } | { necesitaOtp: false }

export type Orquestador = {
  modo: typeof MODO
  estado: EstadoEnlace
  /** El celular del paciente ya está verificado por OTP en esta sesión. */
  verificado: boolean
  /** Último aviso para mostrar en un toast (null si no hay). */
  aviso: string | null
  limpiarAviso: () => void
  /** Manda el trámite confirmado a la base. Devuelve si falta verificar el celular. */
  confirmar: (t: Tramite) => Promise<Pendiente>
  pedirCodigo: (telefono10: string) => Promise<ModoOtp>
  confirmarCodigo: (telefono10: string, codigo: string, modo: ModoOtp) => Promise<void>
  /** Horarios reales de la clínica; vacío si el enlace no está listo. */
  horarios: Orq['horarios']
  /** Horarios libres de un rango de fechas (null = la base no conoce esa clínica o estudio). */
  horariosRango: Orq['horariosRango']
  /** Estudios del portal que la base tiene; null = todos (modo local o si no se pudo consultar). */
  estudiosDisponibles: Set<string> | null
  reiniciar: () => Promise<void>
  /** Último contexto de la base: citas, trámites abiertos y nivel de verificación. null en modo local. */
  contexto: Contexto | null
  /** Aplica un contexto recién recibido (lo usan las pantallas que llaman al orquestador). */
  aplicar: (ctx: Contexto) => void
  /** Se está mandando el trámite a la base. */
  enviando: boolean
}

/**
 * @param tramiteRef  referencia al trámite vivo del portal (para no re-suscribirse en cada tecla)
 * @param alCambiarRemoto  qué hacer cuando otro canal movió el trámite
 */
export function useOrquestador(
  tramiteRef: { current: Tramite | null },
  alCambiarRemoto: (t: Tramite | null) => void,
): Orquestador {
  const [estado, setEstado] = useState<EstadoEnlace>(esApi ? 'conectando' : 'apagado')
  const [verificado, setVerificado] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [contexto, setContexto] = useState<Contexto | null>(null)
  const [enviando, setEnviando] = useState(false)
  const enviandoRef = useRef(false)
  const previo = useRef<{ paciente: string; folios: Set<string> } | null>(null)
  const [estudiosDisponibles, setEstudiosDisponibles] = useState<Set<string> | null>(null)
  const alCambiar = useRef(alCambiarRemoto)
  alCambiar.current = alCambiarRemoto

  const avisar = useCallback((e: unknown, respaldo: string) => {
    const texto = esErrorApi(e) ? e.aviso : e instanceof Error ? e.message : respaldo
    setEstado((prev) => (esErrorApi(e) && e.code === 'red' ? 'sin_conexion' : prev))
    setAviso(texto)
    console.warn('[orquestador]', e)
  }, [])

  const aplicar = useCallback((ctx: Contexto) => {
    setContexto(ctx)
    setVerificado(ctx.sesion.nivel_verificacion === 'verificada')
    const folios = new Set([...(ctx.citas_proximas ?? []), ...ctx.tramites_abiertos].map((x) => x.folio ?? ''))
    const antes = previo.current
    previo.current = { paciente: ctx.paciente.id, folios }
    const remoto = ctx.tramite_activo
    const local = tramiteRef.current
    // solo si es el mismo trámite: el activo de la base puede ser el de una prueba o cita anterior
    if (!local) return
    // pagado (aquí, por WhatsApp o en caja): el trámite se cierra y queda la cita con el mismo folio
    const cita = ctx.citas_proximas?.find((x) => x.folio === local.id)
    if (cita && !ctx.tramites_abiertos.some((x) => x.folio === local.id)) {
      const t = confirmarDesdeCita(local, cita)
      if (t) alCambiar.current(t)
    } else if (remoto && esMismoTramite(local, remoto)) {
      alCambiar.current(fusionarDesdeApi(local, remoto))
    } else if (antes?.paciente === ctx.paciente.id && antes.folios.has(local.id) && !folios.has(local.id)) {
      // la base ya no lo tiene: se canceló, venció o se atendió
      alCambiar.current(null)
      setAviso(`El folio ${local.id} ya no está vigente: se canceló, venció o ya se atendió.`)
    }
  }, [tramiteRef])

  /* ---- abrir la sesión al cargar la página ---- */
  useEffect(() => {
    if (!esApi) return
    let vivo = true
    void (async () => {
      try {
        const orq = await cargar()
        const ctx = await orq.arrancar()
        if (!vivo) return
        setEstado('listo')
        aplicar(ctx)
        // el catálogo es público: solo se ofrece lo que la base puede agendar
        void orq.estudiosOfrecidos(Object.values(STUDIES).flat()).then((n) => { if (vivo && n.length) setEstudiosDisponibles(new Set(n)) }).catch(() => {})
      } catch (e) {
        if (!vivo) return
        setEstado('sin_conexion')
        avisar(e, 'No se pudo conectar con el orquestador: el portal sigue en modo demostración.')
      }
    })()
    return () => { vivo = false }
  }, [aplicar, avisar])

  /* ---- tiempo real. Al verificar el celular la sesión puede pasar a otro paciente: se vuelve a suscribir ---- */
  const pacienteId = contexto?.paciente.id ?? null
  useEffect(() => {
    if (!pacienteId) return
    let vivo = true
    let dejarDeEscuchar: (() => void) | null = null
    let espera: number | undefined

    const alLlegar = (e: EventoPaciente) => {
      if (!vivo) return
      // El evento llega SIN el detalle (los mensajes están cifrados): se vuelve a pedir el contexto
      // y, mientras, se anota en la línea de tiempo del portal para que el asesor lo vea al momento.
      // Mientras se envía el trámite no se mezcla nada a medias: `confirmar` sincroniza al final.
      if (enviandoRef.current) return
      const local = tramiteRef.current
      const deCanal: string = e.tipo === 'evento' ? e.evento.canal : e.mensaje.canal
      // lo hecho en este mismo canal ya se sabe
      const ajeno = deCanal !== canalPropio() && deCanal !== 'sistema'
      if (ajeno && e.tipo === 'evento') setAviso(`Desde ${CANAL[canalDesdeApi(deCanal)]}: ${detalleEvento(e.evento.tipo_evento)}`)
      if (local && ajeno) {
        const canal = canalDesdeApi(deCanal)
        const detalle = e.tipo === 'evento' ? detalleEvento(e.evento.tipo_evento) : 'Mensaje nuevo en la conversación'
        alCambiar.current(conEvento(local, e.tipo === 'evento' ? e.evento.tipo_evento : 'canal.mensaje_recibido', detalle, canal))
      }
      window.clearTimeout(espera)
      espera = window.setTimeout(() => {
        void cargar().then((orq) => orq.sincronizar()).then((ctx) => { if (vivo) aplicar(ctx) })
          .catch(() => { /* el evento siguiente lo recupera */ })
      }, 400)
    }

    void cargar().then((orq) => orq.escuchar(alLlegar))
      .then((dejar) => { if (vivo) dejarDeEscuchar = dejar; else dejar() })
      .catch(() => { /* sin tiempo real: se sincroniza con cada acción */ })

    return () => { vivo = false; window.clearTimeout(espera); dejarDeEscuchar?.() }
  }, [aplicar, tramiteRef, pacienteId])

  /* ---- confirmar: aquí se crea todo en la base ---- */
  const confirmar = useCallback(async (t: Tramite): Promise<Pendiente> => {
    if (!esApi) return { necesitaOtp: false }
    const telefono = t.paciente.telefono ?? ''
    enviandoRef.current = true
    setEnviando(true)
    try {
      const orq = await cargar()
      if (estado !== 'listo') aplicar(await orq.arrancar())

      // 1. celular verificado por OTP: sin esto la base no deja abrir el trámite desde web
      if (!orq.estadoEnlace().verificado) return { necesitaOtp: true, telefono }

      // 2. registro del titular, solo si falta: nunca se pisa el nombre ya registrado
      if (t.paciente.nombre?.trim() && orq.estadoEnlace().faltaRegistro.length) await orq.guardarNombre(t.paciente.nombre)
      // que falle el consentimiento de avisos no debe impedir la cita
      if (t.avisos) await orq.consentirAvisos().catch((e: unknown) => console.warn('[orquestador] avisos', e))

      // 3. el trámite con su estudio y su clínica
      await orq.crearTramiteCompleto({ estudio: t.estudio?.nombre ?? '', clinica: t.clinica, beneficiario: t.beneficiario?.id })

      // 4. el horario (hay que pedir la lista: de ahí sale el fecha_hora exacto de la clínica)
      //    Si el trámite ya existía y ya tiene su cita, se conserva: no se vuelve a reservar.
      if (t.clinica && t.fecha && t.hora && !orq.tramiteRemoto()?.contexto?.cita_id) {
        await orq.horarios(t.clinica, t.estudio?.nombre ?? '', t.fecha)
        await orq.reservar(t.fecha, t.hora)
      }

      // 5. el pago lo genera la base, salvo el pago en clínica (se cobra en mostrador)
      if (t.metodoPago && t.metodoPago !== 'en_clinica' && !orq.tramiteRemoto()?.contexto?.pago_id) await orq.pago()

      aplicar(await orq.sincronizar())
      setEstado('listo')
      return { necesitaOtp: false }
    } catch (e) {
      avisar(e, 'No se pudo registrar el trámite en el orquestador; quedó guardado solo en este dispositivo.')
      // trámite duplicado: ya existe uno igual abierto en la base; se adopta para ver su folio y su avance
      if (esErrorApi(e) && e.code === 'PT409') {
        try { aplicar(await (await cargar()).sincronizar()) } catch { /* el aviso ya se mostró */ }
      }
      return { necesitaOtp: false }
    } finally {
      enviandoRef.current = false
      setEnviando(false)
    }
  }, [aplicar, avisar, estado])

  const pedirCodigo = useCallback(async (tel: string) => (await cargar()).pedirCodigo(tel), [])

  const confirmarCodigo = useCallback(async (tel: string, codigo: string, modo: ModoOtp) => {
    aplicar(await (await cargar()).confirmarCodigo(tel, codigo, modo))
  }, [aplicar])

  const horarios: Orq['horarios'] = useCallback(async (...args: Parameters<Orq['horarios']>) => {
    if (!esApi) return []
    return (await cargar()).horarios(...args)
  }, [])

  const horariosRango: Orq['horariosRango'] = useCallback(async (...args: Parameters<Orq['horariosRango']>) => {
    if (!esApi) return null
    return (await cargar()).horariosRango(...args)
  }, [])

  const reiniciar = useCallback(async () => {
    if (!esApi) return
    try { aplicar(await (await cargar()).reiniciar()) } catch (e) { avisar(e, 'No se pudo reiniciar la demo en el orquestador.') }
  }, [aplicar, avisar])

  return {
    modo: MODO, estado, verificado, aviso,
    limpiarAviso: () => setAviso(null),
    confirmar, pedirCodigo, confirmarCodigo, horarios, horariosRango, estudiosDisponibles, reiniciar,
    contexto, aplicar, enviando,
  }
}
