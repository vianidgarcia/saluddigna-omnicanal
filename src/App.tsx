import { useEffect, useRef, useState } from 'react'
import { Ctx, type AppCtx, type EstudioElegido, type View } from './context'
import { CLINICA_INICIAL } from './data/clinics'
import { Header } from './components/Header'
import { Cookies } from './components/Cookies'
import { Footer } from './components/Footer'
import { BottomNav } from './components/BottomNav'
import { ClinicSheet } from './components/ClinicSheet'
import { Home } from './views/Home'
import { Pay } from './views/Pay'
import { Tramites } from './views/Tramites'
import { Resultados } from './views/Resultados'
import { Agendar } from './views/Agendar'
import { Entrar } from './views/Entrar'
import { Asesor } from './views/Asesor'
import { StaffHeader } from './components/StaffHeader'
import { AvisoConexion, BotonInstalar } from './components/Pwa'
import { BotonTema } from './components/Tema'
import { loadSesion, saveSesion, type Rol, type Sesion } from './state/sesion'
import { loadTramiteAlAbrir, METODO, PASOS, STORAGE_KEY, conEvento, loadTramite, nuevoTramite, saveTramite, type Tramite } from './state/tramite'
import { esApi } from './api/modo'
import { useOrquestador } from './api/useOrquestador'
import { VerificarCelular } from './components/VerificarCelular'

const VIEW_KEY = 'sd_vista'
const COOKIES_KEY = 'sd_cookies'
const VIEWS: View[] = ['home', 'pay', 'tramites', 'resultados', 'agendar']

/** La vista se recuerda por pestaña: al recargar a mitad del flujo se vuelve a la misma pantalla. */
function loadView(t: Tramite | null): View {
  try {
    const v = window.sessionStorage.getItem(VIEW_KEY) as View | null
    if (!v || !VIEWS.includes(v)) return 'home'
    if ((v === 'agendar' || v === 'pay') && !t) return 'home'
    return v
  } catch {
    return 'home'
  }
}

export default function App() {
  const [tramite, setTramite] = useState<Tramite | null>(loadTramiteAlAbrir)
  const tRef = useRef(tramite)
  const [sesion, setSesion] = useState<Sesion | null>(loadSesion)
  // pantalla Entrar (solo personal: asesor o administrador), abierta desde la esquina superior derecha
  const [entrar, setEntrar] = useState<{ rol: Rol; motivo?: string } | null>(null)

  // Otra pestaña (p. ej. el Asesor) cambió el trámite: se refleja aquí sin recargar.
  // La sesión NO se sincroniza: cada pestaña conserva su propio rol.
  useEffect(() => {
    // En modo api esto lo hace Realtime (y además ve los otros canales, no solo las otras pestañas).
    if (esApi) return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return
      const t = loadTramite()
      tRef.current = t
      setTramite(t)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const [view, setView] = useState<View>(() => loadView(tramite))
  const [clinic, setClinic] = useState(CLINICA_INICIAL)
  const [sheet, setSheet] = useState(false)
  const [cookies, setCookies] = useState(() => { try { return !window.localStorage.getItem(COOKIES_KEY) } catch { return true } })
  const cerrarCookies = (eleccion: string) => {
    setCookies(false)
    try { window.localStorage.setItem(COOKIES_KEY, eleccion) } catch { /* sin almacenamiento: se vuelve a preguntar */ }
  }
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const abrirEntrar = (rol: Rol = 'asesor', motivo?: string) => { setEntrar({ rol, motivo }); window.scrollTo(0, 0) }
  const go = (v: View) => {
    setView(v)
    try { window.sessionStorage.setItem(VIEW_KEY, v) } catch { /* sin almacenamiento */ }
    window.scrollTo(0, 0)
  }
  const toast = (msg = 'Disponible en la versión completa') => {
    setToastMsg(msg)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToastMsg(null), 3000)
  }
  const scrollToId = (id: string) => {
    go('home')
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  /* ---- orquestador ----
     En modo local todo esto queda en localStorage, como antes. En modo api el trámite se espeja en
     la base: el folio, la cita y el pago pasan a ser los mismos que ven WhatsApp y el call center. */
  const guardar = (t: Tramite | null) => { tRef.current = t; setTramite(t); saveTramite(t) }
  // lo que llega de otro canal ya viene fusionado: se guarda sin volver a empujarlo a la base
  const orq = useOrquestador(tRef, guardar)
  // trámite esperando a que el paciente confirme su celular (solo modo api)
  const [porVerificar, setPorVerificar] = useState<{ t: Tramite; telefono: string } | null>(null)

  /** Manda a la base el trámite ya confirmado por el paciente. */
  const empujar = (t: Tramite) => {
    void orq.confirmar(t).then((p) => { if (p.necesitaOtp) setPorVerificar({ t, telefono: p.telefono }) })
  }

  const commit = (t: Tramite | null) => {
    const antes = tRef.current
    guardar(t)
    // El trámite se crea en la base cuando el paciente confirma: antes de eso no hay datos
    // suficientes (la base exige nombre, apellido y celular verificado).
    if (!esApi || !t) return
    const cerrado = t.estado === 'confirmada' || t.estado === 'pago_pendiente'
    if (cerrado && antes?.estado !== t.estado) empujar(t)
  }
  const update = (fn: (t: Tramite) => Tramite) => { if (tRef.current) commit(fn(tRef.current)) }

  // Un problema con el orquestador se avisa y no detiene el flujo: la demostración sigue en local.
  useEffect(() => {
    if (!orq.aviso) return
    toast(orq.aviso)
    orq.limpiarAviso()
  }, [orq.aviso])

  const startAgendar = (estudio?: EstudioElegido) => {
    let t = tRef.current
    if (!t || t.estado === 'confirmada') t = nuevoTramite('web')
    if (estudio) {
      // estudio preseleccionado: al continuar se salta al primer dato que falte
      t = { ...t, estudio, paso: 1, estado: 'en_curso', metodoPago: t.estado === 'pago_pendiente' ? null : t.metodoPago, desdeResumen: true }
    } else if (t.estado === 'pago_pendiente') {
      go('pay'); return
    }
    commit(t)
    go('agendar')
  }

  const continuar = () => {
    const t = tRef.current
    if (!t) return startAgendar()
    if (t.estado === 'confirmada') return go('tramites')
    const destino = t.estado === 'pago_pendiente' ? `el pago (${METODO[t.metodoPago ?? 'oxxo'].toLowerCase()})` : `el paso ${t.paso}: ${PASOS[t.paso]}`
    commit(conEvento(t, 'tramite.retomado', `Retomó en ${destino}`))
    go(t.estado === 'pago_pendiente' ? 'pay' : 'agendar')
  }

  const simularWhatsApp = () => {
    const t = tRef.current
    if (!t) { toast('Primero agenda una cita para simular el regreso por WhatsApp'); return }
    commit(conEvento(t, 'canal.mensaje_recibido', 'Escribió por WhatsApp “¿Cómo va mi cita?” y el asistente respondió con su avance (demo)', 'whatsapp'))
    go('home')
    toast('Demo: se registró un mensaje por WhatsApp')
  }

  const reiniciarDemo = () => {
    void orq.reiniciar()
    commit(null)
    go('home')
    toast('Demo reiniciada: no hay trámites en curso')
  }

  const entrarComo = (s: Sesion) => {
    saveSesion(s); setSesion(s); setEntrar(null)
    setView('home'); window.scrollTo(0, 0)
  }
  const salir = () => {
    if (esApi) void import('./api/personal').then((p) => p.salirPersonal()).catch(() => {})
    saveSesion(null); setSesion(null); setEntrar(null)
    setView('home')
    try { window.sessionStorage.setItem(VIEW_KEY, 'home') } catch { /* sin almacenamiento */ }
    window.scrollTo(0, 0)
  }

  // accesos directos de la app instalada (manifest → shortcuts): ?accion=agendar | tramites
  const accionInicial = useRef(true)
  useEffect(() => {
    if (!accionInicial.current) return
    accionInicial.current = false
    const accion = new URLSearchParams(window.location.search).get('accion')
    if (!accion) return
    window.history.replaceState(null, '', window.location.pathname)
    if (accion === 'agendar') startAgendar()
    else if (accion === 'tramites') go('tramites')
  })

  const ctx: AppCtx = { go, toast, openClinics: () => setSheet(true), scrollToId, tramite, update, startAgendar, continuar, simularWhatsApp, reiniciarDemo, sesion, salir, abrirEntrar, horariosClinica: esApi ? orq.horariosRango : undefined, estudiosDisponibles: orq.estudiosDisponibles }
  const toastEl = (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 lg:bottom-8">
      {toastMsg && <div className="rounded-lg bg-[#1F2933] px-5 py-3 text-base text-white shadow-lg">{toastMsg}</div>}
    </div>
  )

  if (!sesion && entrar) {
    return <Entrar key={entrar.rol + (entrar.motivo ?? '')} rolInicial={entrar.rol} motivo={entrar.motivo} onEntrar={entrarComo}
      onVolver={() => { setEntrar(null); window.scrollTo(0, 0) }} />
  }

  if (sesion) {
    return (
      <Ctx.Provider value={ctx}>
        <div className="flex min-h-screen flex-col bg-superficie">
          <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-superficie focus:px-4 focus:py-3 focus:font-semibold focus:text-enlace focus:shadow-lg">Saltar al contenido</a>
          <StaffHeader />
          <AvisoConexion />
          <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none"><Asesor /></main>
          <footer className="border-t border-borde py-2"><div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-x-6 px-4 t-meta text-secundario lg:px-8"><p className="py-3">Prototipo · todos los datos son de demostración.</p><span className="sm:hidden"><BotonTema /></span><BotonInstalar /></div></footer>
          {toastEl}
        </div>
      </Ctx.Provider>
    )
  }

  const activeView: View = (view === 'agendar' && !tramite) ? 'home' : view
  return (
    <Ctx.Provider value={ctx}>
      <div className="flex min-h-screen flex-col pb-16 lg:pb-0">
        <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-superficie focus:px-4 focus:py-3 focus:font-semibold focus:text-enlace focus:shadow-lg">Saltar al contenido</a>
        <Header clinic={clinic} onChange={() => setSheet(true)} onHome={() => go('home')} />
        <AvisoConexion />
        {cookies && <Cookies onDone={cerrarCookies} />}
        <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
          {activeView === 'home' && <Home clinic={clinic} />}
          {activeView === 'pay' && <Pay />}
          {activeView === 'tramites' && <Tramites />}
          {activeView === 'resultados' && <Resultados />}
          {activeView === 'agendar' && <Agendar />}
        </main>
        <Footer />
        <BottomNav view={activeView} />
        {sheet && <ClinicSheet current={clinic} onSelect={setClinic} onClose={() => setSheet(false)} />}
        {porVerificar && (
          <VerificarCelular telefono={porVerificar.telefono} pedirCodigo={orq.pedirCodigo} confirmarCodigo={orq.confirmarCodigo}
            onVerificado={() => { const t = porVerificar.t; setPorVerificar(null); empujar(t) }}
            onCancelar={() => { setPorVerificar(null); toast('Tu cita quedó guardada en este dispositivo. Confirma tu celular para verla también en WhatsApp.') }} />
        )}
        {toastEl}
      </div>
    </Ctx.Provider>
  )
}
