import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../context'
import { esApi } from '../api/modo'
import { Back } from '../components/Back'
import { Icon } from '../components/Icon'
import { WA, NB, container, outlineBtn, link, solidBtn } from '../components/ui'
import { TOTAL_PASOS, avance, conEvento, fechaLarga, METODO, type Tramite, fmtHora } from '../state/tramite'
import {
  CODIGO_VERIFICACION, TARJETAS_PRUEBA, clabeEjemplo, formatoNumero, marcaDe, procesarCargo, referenciaSpei, referenciaTienda,
  soloDigitos, validarTarjeta, verificarCodigo, type Cargo, type DatosTarjeta, type Errores,
} from '../state/pasarela'

/* Paso 4 · Pago: pasarela SIMULADA. Tarjeta (con verificación 3-D Secure), efectivo en tienda y transferencia SPEI.
   No se cobra nada ni se guardan datos de tarjeta: solo marca y últimos 4 dígitos. */

/* Pago del orquestador: solo modo api. Si no hay conexión queda la pasarela simulada. */
const PagoApi = lazy(() => import('../components/PagoApi'))

const campo = 'h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion aria-[invalid=true]:border-2 aria-[invalid=true]:border-error'
const monto = (t: Tramite) => t.estudio?.precio
  ? { cantidad: t.estudio.precio, nota: '(IVA incluido)' }
  : { cantidad: '$350', nota: '(monto de ejemplo)' }

function ErrorCampo({ id, children }: { id: string; children: ReactNode }) {
  return <p id={id} className="mt-1 flex items-start gap-2 t-meta font-semibold text-error"><Icon n="alert" size={18} className="mt-px" />{children}</p>
}

export function Pay() {
  const { tramite: t, update, go, startAgendar, enlaceApi, enviandoApi, reenviarApi } = useApp()
  const [simular, setSimular] = useState(false)
  const enBase = esApi && enlaceApi !== 'sin_conexion' && !simular

  if (enBase && enviandoApi) {
    return <div className={`${container} py-8 lg:py-12`}><Back /><h1 className="mt-4 t-greeting font-head text-titulo">Pago de tu cita</h1><p role="status" className="mt-6 t-body text-secundario">Registrando tu cita…</p></div>
  }

  if (!t || t.estado !== 'pago_pendiente' || !t.metodoPago || t.metodoPago === 'en_clinica') {
    return (
      <div className={`${container} py-8 lg:py-12`}>
        <Back />
        <h1 className="mt-4 t-greeting font-head text-titulo">No tienes pagos pendientes</h1>
        <p className="mt-4 max-w-xl t-body">Cuando elijas pagar con tarjeta, en tienda o por transferencia al agendar, aquí harás tu pago.</p>
        <button onClick={() => startAgendar()} className={`${outlineBtn} mt-6`}><Icon n="calendar" />Agendar cita</button>
      </div>
    )
  }

  const metodo = t.metodoPago
  const titulo = enBase ? 'Pago de prueba' : { en_linea: 'Paga con tarjeta', oxxo: `Paga en${NB}Oxxo`, spei: 'Paga por transferencia' }[metodo]

  const cambiarMetodo = () => {
    update((x) => conEvento({ ...x, estado: 'en_curso', metodoPago: null, pago: null, paso: TOTAL_PASOS }, 'pago.metodo_cambiado', 'Regresó a elegir otro método de pago'))
    go('agendar')
  }
  /** Pago aprobado → la cita queda confirmada (y lo ven el asesor y las otras pestañas). */
  const aprobar = (detalle: string, extra: Partial<NonNullable<Tramite['pago']>> = {}) => {
    update((x) => {
      const pago = { ...(x.pago ?? { intentos: 0 }), ...extra, estado: 'aprobado' as const, fecha: new Date().toISOString() }
      const conPago = conEvento({ ...x, pago }, 'pago.aprobado', detalle, 'pasarela')
      return conEvento({ ...conPago, estado: 'confirmada', desdeResumen: false }, 'cita.confirmada', `${METODO[metodo]} · ${x.fecha ? fechaLarga(x.fecha) : ''} ${fmtHora(x.hora)}`, 'pasarela')
    })
    go('agendar')
  }

  return (
    <div className={`${container} py-8 lg:py-12`}>
      <Back />
      <h1 className="mt-4 t-greeting font-head text-titulo">Paso {TOTAL_PASOS} de {TOTAL_PASOS} · {titulo}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="t-body text-titulo">{t.estudio?.nombre} · {t.clinica}</p>
        <span className="inline-flex items-center gap-2 rounded-full bg-ambar-fondo px-3 py-1 t-meta font-semibold text-ambar-texto"><span aria-hidden="true" className="size-2 rounded-full bg-ambar" />Pago pendiente</span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL_PASOS} aria-valuenow={TOTAL_PASOS} aria-valuetext={`Paso ${TOTAL_PASOS} de ${TOTAL_PASOS}: pago pendiente`} aria-label="Avance del trámite" className="mt-6 h-2 max-w-xl rounded-full bg-resaltado"><div className="h-full rounded-full bg-accion-hover" style={{ width: `${avance(TOTAL_PASOS)}%` }} /></div>
      {enBase && (
        <>
          <Suspense fallback={<p role="status" className="mt-8 t-body text-secundario">Cargando el pago…</p>}>
            <PagoApi folio={t.id} onSimular={() => setSimular(true)} onReintentar={reenviarApi} />
          </Suspense>
          <button onClick={cambiarMetodo} className={`${link} mt-4`}>Cambiar método de pago</button>
        </>
      )}
      {!enBase && <><p className="mt-6 flex max-w-3xl items-start gap-2 rounded-lg bg-resaltado px-4 py-3 t-body text-titulo">
        <Icon n="candado" className="mt-0.5 text-icono" />
        <span><strong className="font-bold">Pasarela de pago simulada.</strong> No se hace ningún cobro. No escribas datos reales de tarjeta: usa las tarjetas de prueba.</span>
      </p>

      {metodo === 'en_linea' && <PagoTarjeta t={t} onAprobado={aprobar} onCambiarMetodo={cambiarMetodo} />}
      {metodo === 'oxxo' && <PagoTienda t={t} onAprobado={aprobar} onCambiarMetodo={cambiarMetodo} />}
      {metodo === 'spei' && <PagoSpei t={t} onAprobado={aprobar} onCambiarMetodo={cambiarMetodo} />}</>}
    </div>
  )
}

type PropsMetodo = { t: Tramite; onAprobado: (detalle: string, extra?: Partial<NonNullable<Tramite['pago']>>) => void; onCambiarMetodo: () => void }

/* ---------- tarjeta ---------- */
type Fase = 'formulario' | 'procesando' | 'verificacion' | 'verificando' | 'rechazado'

function PagoTarjeta({ t, onAprobado, onCambiarMetodo }: PropsMetodo) {
  const { update } = useApp()
  const [d, setD] = useState<DatosTarjeta>({ numero: '', titular: '', vencimiento: '', cvv: '' })
  const [err, setErr] = useState<Errores>({})
  const [fase, setFase] = useState<Fase>('formulario')
  const [motivo, setMotivo] = useState('')
  const [tarjeta, setTarjeta] = useState<Cargo['tarjeta'] | null>(null)
  const [codigo, setCodigo] = useState('')
  const [errCodigo, setErrCodigo] = useState<string | null>(null)
  const [intentosCodigo, setIntentosCodigo] = useState(0)
  const form = useRef<HTMLDivElement>(null)
  const titulo = useRef<HTMLHeadingElement>(null)
  const { cantidad, nota } = monto(t)
  const marca = marcaDe(d.numero)
  const amex = marca === 'American Express'

  // al cambiar de fase, el foco va al título de la nueva pantalla
  useEffect(() => { if (fase !== 'formulario' && fase !== 'procesando') titulo.current?.focus() }, [fase])

  const set = (k: keyof DatosTarjeta, v: string) => { setD((x) => ({ ...x, [k]: v })); if (err[k]) setErr((e) => ({ ...e, [k]: undefined })) }
  const onVencimiento = (v: string) => {
    const n = soloDigitos(v).slice(0, 4)
    set('vencimiento', n.length > 2 ? `${n.slice(0, 2)}/${n.slice(2)}` : n)
  }
  const usarPrueba = (numero: string) => {
    setD({ numero: formatoNumero(numero), titular: 'Paciente de Prueba', vencimiento: '12/30', cvv: marcaDe(numero) === 'American Express' ? '1234' : '123' })
    setErr({})
    form.current?.querySelector<HTMLInputElement>('#tj-numero')?.focus()
  }

  const rechazar = (m: string, tj: Cargo['tarjeta']) => {
    setMotivo(m); setFase('rechazado')
    update((x) => conEvento({ ...x, pago: { ...(x.pago ?? { intentos: 0 }), estado: 'rechazado', intentos: (x.pago?.intentos ?? 0) + 1, motivo: m, tarjeta: tj } },
      'pago.rechazado', `${tj.marca} •••• ${tj.ultimos4}: ${m}`, 'pasarela'))
  }
  const aprobado = (c: Extract<Cargo, { estado: 'aprobado' }>) =>
    onAprobado(`${c.tarjeta.marca} •••• ${c.tarjeta.ultimos4} · autorización ${c.autorizacion} (de ejemplo)`, { tarjeta: c.tarjeta, autorizacion: c.autorizacion })

  const pagar = async () => {
    const e = validarTarjeta(d)
    setErr(e)
    const primero = (['numero', 'titular', 'vencimiento', 'cvv'] as const).find((k) => e[k])
    if (primero) { form.current?.querySelector<HTMLInputElement>(`#tj-${primero}`)?.focus(); return }
    setFase('procesando')
    const c = await procesarCargo(d.numero)
    setTarjeta(c.tarjeta)
    if (c.estado === 'aprobado') aprobado(c)
    else if (c.estado === 'rechazado') rechazar(c.motivo, c.tarjeta)
    else {
      setFase('verificacion'); setCodigo(''); setErrCodigo(null); setIntentosCodigo(0)
      update((x) => conEvento(x, 'pago.verificacion_solicitada', `El banco pidió verificar la tarjeta ${c.tarjeta.marca} •••• ${c.tarjeta.ultimos4} (3-D Secure simulado)`, 'pasarela'))
    }
  }
  const verificar = async () => {
    if (!tarjeta) return
    if (soloDigitos(codigo).length !== 6) { setErrCodigo('El código tiene 6 dígitos.'); return }
    setFase('verificando')
    const c = await verificarCodigo(codigo, tarjeta)
    if (c.estado === 'aprobado') return aprobado(c)
    const n = intentosCodigo + 1
    setIntentosCodigo(n)
    if (n >= 3) return rechazar('No pudimos verificar la tarjeta con tu banco.', tarjeta)
    setFase('verificacion'); setErrCodigo(`El código no coincide. Te ${3 - n === 1 ? 'queda 1 intento' : `quedan ${3 - n} intentos`}.`)
  }
  const otraTarjeta = () => { setD((x) => ({ ...x, numero: '', cvv: '' })); setErr({}); setFase('formulario'); requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('#tj-numero')?.focus()) }

  const procesando = fase === 'procesando' || fase === 'verificando'

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-12">
      <section aria-labelledby="tj-t" className="rounded-2xl border border-borde bg-superficie p-6 lg:col-span-7 lg:p-8">
        {(fase === 'formulario' || fase === 'procesando') && (
          <div ref={form}>
            <h2 id="tj-t" className="t-card font-head text-titulo">Datos de la tarjeta</h2>
            <p className="mt-1 t-body text-titulo">Total a pagar: <strong className="font-bold">{cantidad}</strong> <span className="t-meta text-secundario">{nota}</span></p>
            <fieldset disabled={procesando} className="mt-5 grid gap-4">
              <div>
                <label htmlFor="tj-numero" className="text-base font-semibold text-titulo">Número de tarjeta</label>
                <div className="relative mt-2">
                  <input id="tj-numero" inputMode="numeric" autoComplete="off" value={d.numero} placeholder="0000 0000 0000 0000"
                    onChange={(e) => set('numero', formatoNumero(e.target.value))} maxLength={amex ? 17 : 19}
                    aria-invalid={!!err.numero} aria-describedby={err.numero ? 'tj-numero-e' : undefined} className={`${campo} pr-36 font-mono tracking-wide`} />
                  {soloDigitos(d.numero).length >= 2 && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 t-meta font-semibold text-secundario">{marca}</span>}
                </div>
                {err.numero && <ErrorCampo id="tj-numero-e">{err.numero}</ErrorCampo>}
              </div>
              <div>
                <label htmlFor="tj-titular" className="text-base font-semibold text-titulo">Nombre del titular</label>
                <input id="tj-titular" autoComplete="off" value={d.titular} onChange={(e) => set('titular', e.target.value)} placeholder="Como aparece en la tarjeta"
                  aria-invalid={!!err.titular} aria-describedby={err.titular ? 'tj-titular-e' : undefined} className={`${campo} mt-2`} />
                {err.titular && <ErrorCampo id="tj-titular-e">{err.titular}</ErrorCampo>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="tj-vencimiento" className="text-base font-semibold text-titulo">Vencimiento</label>
                  <input id="tj-vencimiento" inputMode="numeric" autoComplete="off" value={d.vencimiento} onChange={(e) => onVencimiento(e.target.value)} placeholder="MM/AA"
                    aria-invalid={!!err.vencimiento} aria-describedby={err.vencimiento ? 'tj-vencimiento-e' : undefined} className={`${campo} mt-2`} />
                  {err.vencimiento && <ErrorCampo id="tj-vencimiento-e">{err.vencimiento}</ErrorCampo>}
                </div>
                <div>
                  <label htmlFor="tj-cvv" className="text-base font-semibold text-titulo">Código de seguridad</label>
                  <input id="tj-cvv" inputMode="numeric" autoComplete="off" value={d.cvv} onChange={(e) => set('cvv', soloDigitos(e.target.value).slice(0, 4))} placeholder={amex ? '4 dígitos' : '3 dígitos'}
                    aria-invalid={!!err.cvv} aria-describedby={err.cvv ? 'tj-cvv-e' : undefined} className={`${campo} mt-2 font-mono`} />
                  {err.cvv && <ErrorCampo id="tj-cvv-e">{err.cvv}</ErrorCampo>}
                </div>
              </div>
            </fieldset>
            <button onClick={pagar} disabled={procesando} className={`${solidBtn} mt-6 w-full`}>
              <Icon n="candado" />{procesando ? 'Procesando pago…' : `Pagar ${cantidad}`}
            </button>
            <p role="status" className="mt-2 t-meta text-secundario">{procesando ? 'Enviando el pago a la pasarela (simulado)…' : 'Solo guardamos la marca y los últimos 4 dígitos de la tarjeta.'}</p>
          </div>
        )}

        {(fase === 'verificacion' || fase === 'verificando') && tarjeta && (
          <div>
            <h2 id="tj-t" ref={titulo} tabIndex={-1} data-focus-target className="flex items-center gap-2 t-card font-head text-titulo"><Icon n="candado" className="text-icono" />Verificación de tu banco</h2>
            <p className="mt-2 t-body">Tu banco pide confirmar que eres tú para la tarjeta <strong className="font-bold text-titulo">{tarjeta.marca} •••• {tarjeta.ultimos4}</strong>. Escribe el código que te envió por SMS (simulado).</p>
            <p id="cod-h" className="mt-3 inline-block rounded-md bg-resaltado px-3 py-1 t-meta font-semibold text-titulo">Código de demostración: {CODIGO_VERIFICACION}</p>
            <label htmlFor="tj-codigo" className="mt-4 block text-base font-semibold text-titulo">Código de verificación</label>
            <input id="tj-codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} disabled={procesando}
              onChange={(e) => { setCodigo(soloDigitos(e.target.value)); setErrCodigo(null) }} onKeyDown={(e) => e.key === 'Enter' && verificar()}
              aria-invalid={!!errCodigo} aria-describedby={errCodigo ? 'cod-h tj-codigo-e' : 'cod-h'} className={`${campo} mt-2 font-mono tracking-widest sm:max-w-[14rem]`} />
            {errCodigo && <ErrorCampo id="tj-codigo-e">{errCodigo}</ErrorCampo>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button onClick={() => rechazar('Cancelaste la verificación del banco.', tarjeta)} disabled={procesando} className={`${link} justify-center`}>Cancelar</button>
              <button onClick={verificar} disabled={procesando} className={solidBtn}>{procesando ? 'Verificando…' : 'Verificar'}</button>
            </div>
            <p role="status" className="sr-only">{procesando ? 'Verificando con tu banco' : ''}</p>
          </div>
        )}

        {fase === 'rechazado' && (
          <div>
            <h2 id="tj-t" ref={titulo} tabIndex={-1} data-focus-target className="flex items-center gap-2 t-card font-head text-error"><Icon n="alert" />Pago rechazado</h2>
            <p role="alert" className="mt-2 t-body text-titulo">{motivo}</p>
            {tarjeta && <p className="mt-1 t-meta text-secundario">{tarjeta.marca} •••• {tarjeta.ultimos4} · No se hizo ningún cargo.</p>}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button onClick={otraTarjeta} className={solidBtn}><Icon n="tarjeta" />Intentar con otra tarjeta</button>
              <button onClick={onCambiarMetodo} className={`${link} justify-center`}>Cambiar método de pago</button>
            </div>
          </div>
        )}
      </section>

      <aside aria-labelledby="pruebas-t" className="lg:col-span-5">
        <h2 id="pruebas-t" className="t-card font-head text-titulo">Tarjetas de prueba</h2>
        <p className="mt-1 t-meta text-secundario">Elige una para ver cada resultado. Vencimiento 12/30, código 123.</p>
        <ul className="mt-3">
          {TARJETAS_PRUEBA.map((tp) => (
            <li key={tp.numero} className="flex items-center justify-between gap-3 border-t border-borde py-2">
              <span className="min-w-0">
                <span className="block font-mono text-base text-titulo">{formatoNumero(tp.numero)}</span>
                <span className="block t-meta text-secundario">{marcaDe(tp.numero)} · {tp.resultado}</span>
              </span>
              <button onClick={() => { if (fase !== 'formulario') otraTarjeta(); usarPrueba(tp.numero) }} disabled={procesando}
                aria-label={`Usar la tarjeta de prueba terminada en ${tp.numero.slice(-4)} (${tp.resultado})`} className={`${link} shrink-0`}>Usar</button>
            </li>
          ))}
        </ul>
        {fase === 'formulario' && <button onClick={onCambiarMetodo} className={`${link} mt-4`}>Cambiar método de pago</button>}
      </aside>
    </div>
  )
}

/* ---------- efectivo en tienda ---------- */
function PagoTienda({ t, onAprobado, onCambiarMetodo }: PropsMetodo) {
  const { update } = useApp()
  const [copiado, setCopiado] = useState(false)
  const REF = referenciaTienda(t.id)
  const { cantidad, nota } = monto(t)
  const copiar = async () => {
    try { await navigator.clipboard.writeText(REF.replace(/ /g, '')) } catch { /* el portapapeles puede estar bloqueado */ }
    setCopiado(true); window.setTimeout(() => setCopiado(false), 3000)
  }
  const waText = encodeURIComponent(`Hola, esta es mi referencia de pago en Oxxo para el trámite ${t.id}: ${REF.replace(/ /g, '')}`)
  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-12">
      <section aria-labelledby="ref-t" className="rounded-2xl border border-borde bg-superficie p-6 lg:col-span-7 lg:p-8">
        <h2 id="ref-t" className="t-card font-head text-titulo">Tu referencia de pago</h2>
        <p className="mt-1 t-meta text-secundario">Referencia de ejemplo</p>
        <p className="mt-3 font-mono text-[22px] font-semibold tracking-wide text-titulo min-[400px]:text-[24px] sm:text-[28px] lg:text-[32px]">{REF.replace(/ /g, NB)}</p>
        <button onClick={copiar} className={`${outlineBtn} mt-4`}><Icon n={copiado ? 'check' : 'copy'} />{copiado ? 'Referencia copiada' : 'Copiar referencia'}</button>
        <p role="status" className="sr-only">{copiado ? 'Referencia copiada' : ''}</p>
        <Montos cantidad={cantidad} nota={nota} t={t} />
      </section>
      <section aria-labelledby="pasos-t" className="lg:col-span-5">
        <h2 id="pasos-t" className="t-card font-head text-titulo">Cómo pagar</h2>
        <ol className="mt-4 flex flex-col gap-3 t-body">
          <li>1. Acude a cualquier Oxxo.</li>
          <li>2. Indica que harás un pago de servicio.</li>
          <li>3. Dicta la referencia y paga el monto exacto.</li>
        </ol>
        <div className="mt-6 flex flex-col gap-2">
          <a href={`${WA}?text=${waText}`} target="_blank" rel="noopener" className={solidBtn}
            onClick={() => update((x) => conEvento(x, 'pago.referencia_enviada', 'Pidió recibir la referencia en su WhatsApp', 'whatsapp'))}>
            <Icon n="chat" />Enviar referencia a mi WhatsApp
          </a>
          <button onClick={() => onAprobado('La tienda confirmó el pago en efectivo (simulado)')} className={outlineBtn}><Icon n="tienda" />Demo: simular pago en tienda</button>
          <button onClick={onCambiarMetodo} className={`${link} justify-center`}>Cambiar método de pago</button>
        </div>
      </section>
    </div>
  )
}

/* ---------- transferencia SPEI ---------- */
function PagoSpei({ t, onAprobado, onCambiarMetodo }: PropsMetodo) {
  const { update } = useApp()
  const [copiado, setCopiado] = useState(false)
  const CLABE = clabeEjemplo(t.id)
  const REF = referenciaSpei(t.id)
  const { cantidad, nota } = monto(t)
  const copiar = async () => {
    try { await navigator.clipboard.writeText(CLABE.replace(/ /g, '')) } catch { /* el portapapeles puede estar bloqueado */ }
    setCopiado(true); window.setTimeout(() => setCopiado(false), 3000)
  }
  const waText = encodeURIComponent(`Hola, estos son mis datos de transferencia para el trámite ${t.id}: CLABE ${CLABE.replace(/ /g, '')}, referencia ${REF}`)
  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-12">
      <section aria-labelledby="spei-t" className="rounded-2xl border border-borde bg-superficie p-6 lg:col-span-7 lg:p-8">
        <h2 id="spei-t" className="t-card font-head text-titulo">Datos para tu transferencia</h2>
        <p className="mt-1 t-meta text-secundario">Datos de ejemplo</p>
        <dl className="mt-4 grid gap-4">
          <div><dt className="t-meta text-secundario">CLABE interbancaria</dt>
            <dd className="font-mono text-[20px] font-semibold tracking-wide text-titulo sm:text-[24px]">{CLABE.replace(/ /g, NB)}</dd></div>
          <div className="grid grid-cols-2 gap-4">
            <div><dt className="t-meta text-secundario">Referencia numérica</dt><dd className="font-mono t-body font-semibold text-titulo">{REF}</dd></div>
            <div><dt className="t-meta text-secundario">Concepto</dt><dd className="t-body font-semibold text-titulo">{t.id}</dd></div>
          </div>
          <div><dt className="t-meta text-secundario">Beneficiario</dt><dd className="t-body font-semibold text-titulo">Salud Digna <span className="t-meta font-normal text-secundario">(cuenta de ejemplo)</span></dd></div>
        </dl>
        <button onClick={copiar} className={`${outlineBtn} mt-4`}><Icon n={copiado ? 'check' : 'copy'} />{copiado ? 'CLABE copiada' : 'Copiar CLABE'}</button>
        <p role="status" className="sr-only">{copiado ? 'CLABE copiada' : ''}</p>
        <Montos cantidad={cantidad} nota={nota} t={t} />
      </section>
      <section aria-labelledby="pasos-spei-t" className="lg:col-span-5">
        <h2 id="pasos-spei-t" className="t-card font-head text-titulo">Cómo pagar</h2>
        <ol className="mt-4 flex flex-col gap-3 t-body">
          <li>1. Entra a la app o portal de tu banco.</li>
          <li>2. Haz una transferencia SPEI a la CLABE, con la referencia numérica.</li>
          <li>3. Usa tu folio como concepto. Confirmamos el pago en cuanto llegue.</li>
        </ol>
        <div className="mt-6 flex flex-col gap-2">
          <a href={`${WA}?text=${waText}`} target="_blank" rel="noopener" className={solidBtn}
            onClick={() => update((x) => conEvento(x, 'pago.referencia_enviada', 'Pidió recibir los datos de transferencia en su WhatsApp', 'whatsapp'))}>
            <Icon n="chat" />Enviar datos a mi WhatsApp
          </a>
          <button onClick={() => onAprobado('Se recibió la transferencia SPEI (simulado)')} className={outlineBtn}><Icon n="banco" />Demo: simular transferencia recibida</button>
          <button onClick={onCambiarMetodo} className={`${link} justify-center`}>Cambiar método de pago</button>
        </div>
      </section>
    </div>
  )
}

function Montos({ cantidad, nota, t }: { cantidad: string; nota: string; t: Tramite }) {
  return (
    <dl className="mt-6 grid gap-3 border-t border-borde pt-6 t-body">
      <div><dt className="t-meta text-secundario">Monto</dt><dd className="font-semibold text-titulo">{cantidad} <span className="t-meta font-normal text-secundario">{nota}</span></dd></div>
      <div><dt className="t-meta text-secundario">Paga antes de tu cita</dt><dd className="font-semibold text-titulo first-letter:uppercase">
        {t.fecha ? `${fechaLarga(t.fecha)}, ${fmtHora(t.hora)}` : '—'} <span className="t-meta font-normal text-secundario">(horario de demostración)</span>
      </dd></div>
    </dl>
  )
}
