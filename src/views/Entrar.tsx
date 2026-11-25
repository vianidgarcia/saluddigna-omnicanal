import { useRef, useState } from 'react'
import { Logo } from '../components/Header'
import { Icon } from '../components/Icon'
import { AvisoConexion } from '../components/Pwa'
import { BotonTema } from '../components/Tema'
import { container, link, outlineBtn, solidBtn } from '../components/ui'
import { CREDENCIALES, CUENTAS_API, ROL, ROL_BASE, entrar, type Rol, type Sesion } from '../state/sesion'
import { esApi } from '../api/modo'

const ICONO_ROL: Record<Rol, string> = { asesor: 'headset', admin: 'shield' }
const fieldInput = 'h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion aria-[invalid=true]:border-2 aria-[invalid=true]:border-error'

export function Entrar({ onEntrar, onVolver, rolInicial = 'asesor', motivo }: {
  onEntrar: (s: Sesion) => void; onVolver: () => void; rolInicial?: Rol; motivo?: string
}) {
  const [rol, setRol] = useState<Rol>(rolInicial)
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const correoRef = useRef<HTMLInputElement>(null)

  /* En modo api se entra con las cuentas REALES de core.staff (Supabase Auth): el rol lo decide la
     base, no este formulario. En modo local se valida contra las credenciales de demostración. */
  const enviar = () => {
    if (!esApi) {
      const r = entrar(rol, correo, clave)
      if (typeof r === 'string') { setError(r); correoRef.current?.focus(); return }
      setError(null)
      onEntrar(r)
      return
    }
    setOcupado(true); setError(null)
    // el módulo del personal (y con él Supabase) se descarga solo al entrar
    void import('../api/personal').then((p) => p.entrarPersonal(correo.trim(), clave))
      .then(({ rol: rolReal, rolBase, clinicaId, clinicaNombre }) => {
        onEntrar({ rol: rolReal, correo: correo.trim(), nombre: ROL_BASE[rolBase] ?? ROL[rolReal], inicio: new Date().toISOString(), rolBase, clinicaId, clinicaNombre })
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'No se pudo entrar. Revisa el correo y la contraseña.')
        correoRef.current?.focus()
      })
      .finally(() => setOcupado(false))
  }
  const usar = (c: (typeof CREDENCIALES)[number]) => {
    setRol(c.rol); setCorreo(c.correo); setClave(c.clave); setError(null)
    correoRef.current?.focus()
  }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') enviar() }

  return (
    <div className="flex min-h-screen flex-col bg-banda">
      <header className="border-b border-borde bg-superficie">
        <div className={`${container} flex min-h-[72px] items-center justify-between gap-3`}>
          <button onClick={onVolver} className="inline-flex min-h-12 items-center rounded-md" aria-label="Salud Digna, volver a la página principal"><Logo /></button>
          <BotonTema />
        </div>
      </header>
      <AvisoConexion />
      <main id="contenido" className={`${container} flex-1 py-6 lg:py-12`}>
        <button onClick={onVolver} className={link}><Icon n="left" />Volver a la página principal</button>
        {motivo && <p role="status" className="mt-2 flex items-center gap-2 t-body font-semibold text-titulo"><Icon n="user" className="text-enlace" />{motivo}</p>}
        <div className="mt-4 grid gap-8 lg:grid-cols-12 lg:gap-8">
          <section aria-labelledby="entrar-t" className="rounded-2xl bg-superficie p-6 lg:col-span-7 lg:p-10">
            <h1 id="entrar-t" className="t-greeting font-head text-titulo">Entrar</h1>
            <p className="mt-2 t-body">Acceso para el personal de Salud Digna. Los pacientes no necesitan cuenta: agendan y retoman su trámite desde el portal.</p>

            {!esApi && <fieldset className="mt-6">
              <legend className="text-base font-semibold text-titulo">Entrar como</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {(['asesor', 'admin'] as Rol[]).map((r) => (
                  <label key={r} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-borde px-4 py-3 transition-colors hover:border-borde-accion has-[:checked]:border-enlace has-[:checked]:bg-resaltado">
                    <input type="radio" name="rol" checked={rol === r} onChange={() => { setRol(r); setError(null) }} className="size-5 shrink-0 accent-accion-hover" />
                    <Icon n={ICONO_ROL[r]} className="text-enlace" />
                    <span className="text-base font-semibold text-titulo">{ROL[r]}</span>
                  </label>
                ))}
              </div>
            </fieldset>}

            <div className="mt-6">
              <label htmlFor="correo" className="text-base font-semibold text-titulo">Correo</label>
              <input ref={correoRef} id="correo" type="email" autoComplete="username" value={correo}
                onChange={(e) => { setCorreo(e.target.value); setError(null) }} onKeyDown={onEnter}
                aria-invalid={!!error} aria-describedby={error ? 'entrar-e' : undefined}
                placeholder="nombre@demo.mx" className={`${fieldInput} mt-2`} />
            </div>
            <div className="mt-4">
              <label htmlFor="clave" className="text-base font-semibold text-titulo">Contraseña</label>
              <input id="clave" type="password" autoComplete="current-password" value={clave}
                onChange={(e) => { setClave(e.target.value); setError(null) }} onKeyDown={onEnter}
                aria-invalid={!!error} aria-describedby={error ? 'entrar-e' : undefined} className={`${fieldInput} mt-2`} />
              {error && <p id="entrar-e" role="alert" className="mt-2 flex items-start gap-2 t-body font-semibold text-error"><Icon n="alert" className="mt-0.5" />{error}</p>}
            </div>
            <button onClick={enviar} disabled={ocupado} className={`${solidBtn} mt-6 w-full sm:w-auto`}>
              {ocupado ? 'Entrando…' : <>{esApi ? 'Entrar' : `Entrar como ${ROL[rol].toLowerCase()}`}<Icon n="arrow" /></>}
            </button>
          </section>

          <section aria-labelledby="cred-t" className="lg:col-span-5">
            <h2 id="cred-t" className="t-card font-head text-titulo">{esApi ? 'Cuentas del personal' : 'Credenciales de demostración'}</h2>
            <p className="mt-1 t-meta text-secundario">
              {esApi
                ? 'Conectado al orquestador: entra con tu cuenta del personal. El rol lo decide el sistema, no este formulario. La contraseña te la da quien administra el proyecto.'
                : 'Solo para la demo: no hay cuentas reales.'}
            </p>
            <ul className="mt-4 flex flex-col">
              {esApi && CUENTAS_API.map((c) => (
                <li key={c.correo} className="border-t border-borde py-4 first:border-t-0 first:pt-0">
                  <p className="flex items-center gap-2 t-sub font-bold text-titulo"><Icon n={ICONO_ROL[c.rol]} className="text-enlace" />{ROL_BASE[c.rolBase]}</p>
                  <p className="mt-1 t-meta text-cuerpo">{c.descripcion}</p>
                  <p className="mt-2 t-body font-semibold text-titulo">{c.correo}</p>
                  <button onClick={() => { setCorreo(c.correo); setError(null); document.getElementById('clave')?.focus() }} className={`${outlineBtn} mt-3`} aria-label={`Usar el correo de ${ROL_BASE[c.rolBase]}`}>Usar este correo</button>
                </li>
              ))}
              {!esApi && CREDENCIALES.map((c) => (
                <li key={c.rol} className="border-t border-borde py-4 first:border-t-0 first:pt-0">
                  <p className="flex items-center gap-2 t-sub font-bold text-titulo"><Icon n={ICONO_ROL[c.rol]} className="text-enlace" />{ROL[c.rol]}</p>
                  <p className="mt-1 t-meta text-cuerpo">{c.descripcion}</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 t-body">
                    <dt className="text-secundario">Correo</dt><dd className="font-semibold text-titulo">{c.correo}</dd>
                    <dt className="text-secundario">Contraseña</dt><dd className="font-semibold text-titulo">{c.clave}</dd>
                  </dl>
                  <button onClick={() => usar(c)} className={`${outlineBtn} mt-3`} aria-label={`Usar credenciales de ${ROL[c.rol]}`}>Usar estas credenciales</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  )
}
