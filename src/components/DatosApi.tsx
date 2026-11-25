/* Paso 4 en modo api: para quién es la cita (titular o familiar) y permiso de avisos. Carga diferida. */
import { useCallback, useEffect, useState } from 'react'
import { useApp } from '../context'
import type { Beneficiario, Relacion } from '../api/api'
import * as orq from '../api/orquestador'
import type { Tramite } from '../state/tramite'
import { apagado, avisoDe, link, outlineBtn } from './ui'

const campo = 'mt-2 h-12 w-full rounded-lg border border-borde bg-superficie px-4 text-base text-titulo transition-colors hover:border-borde-accion'
const RELACIONES: [Exclude<Relacion, 'titular'>, string][] = [['hijo', 'Hijo'], ['hija', 'Hija'], ['madre', 'Madre'], ['padre', 'Padre'], ['conyuge', 'Cónyuge'], ['otro', 'Otro familiar']]

export default function DatosApi({ t }: { t: Tramite }) {
  const { contextoApi: ctx, update, verificarCelular } = useApp()
  const verificado = ctx?.sesion.nivel_verificacion === 'verificada'
  const registrado = verificado && !ctx.sesion.requiere_registro?.length
  const [familia, setFamilia] = useState<Beneficiario[]>([])
  const [nuevo, setNuevo] = useState(false)
  const [nombre, setNombre] = useState('')
  const [nacimiento, setNacimiento] = useState('')
  const [relacion, setRelacion] = useState<Exclude<Relacion, 'titular'>>('hija')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const telefono = t.paciente.telefono ?? ''

  const cargar = useCallback(async () => {
    try { setFamilia((await orq.familia()).filter((b) => b.relacion !== 'titular')) } catch { /* se puede agendar para el titular */ }
  }, [])
  useEffect(() => { if (verificado) void cargar() }, [verificado, cargar])

  const agregar = async () => {
    setOcupado(true); setError(null)
    try {
      const id = await orq.agregarFamiliar({ nombre, nacimiento, relacion })
      update((x) => ({ ...x, beneficiario: { id, nombre: nombre.trim() } }))
      await cargar()
      setNuevo(false); setNombre(''); setNacimiento('')
    } catch (e) { setError(avisoDe(e)) } finally { setOcupado(false) }
  }
  // el elegido puede venir de antes de cargar la lista
  const opciones = t.beneficiario && !familia.some((b) => b.id === t.beneficiario?.id) ? [...familia, { id: t.beneficiario.id, nombre: t.beneficiario.nombre }] : familia

  return (
    <div className="mt-4 grid gap-4">
      {!verificado && (
        <p className="t-body">¿La cita es para un familiar?{' '}
          {telefono.length === 10
            ? <button onClick={() => verificarCelular(telefono)} className={link}>Confirma tu celular para elegirlo</button>
            : 'Escribe tu teléfono y confírmalo para elegirlo.'}
        </p>
      )}
      {registrado && (
        <div>
          <label htmlFor="para-quien" className="text-base font-semibold text-titulo">¿Quién recibe el estudio?</label>
          <select id="para-quien" value={t.beneficiario?.id ?? ''} className={campo}
            onChange={(e) => { const b = opciones.find((x) => x.id === e.target.value); update((x) => ({ ...x, beneficiario: b ? { id: b.id, nombre: b.nombre } : null })) }}>
            <option value="">Yo, el titular</option>
            {opciones.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
          <button onClick={() => setNuevo(!nuevo)} aria-expanded={nuevo} className={link}>{nuevo ? 'No agregar' : 'Agregar un familiar'}</button>
        </div>
      )}
      {registrado && nuevo && (
        <div className="grid gap-4 border-t border-borde pt-4 sm:grid-cols-2">
          <div><label htmlFor="fam-n" className="text-base font-semibold text-titulo">Nombre y apellidos</label>
            <input id="fam-n" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" className={campo} /></div>
          <div><label htmlFor="fam-f" className="text-base font-semibold text-titulo">Fecha de nacimiento</label>
            <input id="fam-f" type="date" value={nacimiento} onChange={(e) => setNacimiento(e.target.value)} className={campo} /></div>
          <div><label htmlFor="fam-r" className="text-base font-semibold text-titulo">Parentesco</label>
            <select id="fam-r" value={relacion} onChange={(e) => setRelacion(e.target.value as typeof relacion)} className={campo}>{RELACIONES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></div>
          <button onClick={agregar} disabled={ocupado || nombre.trim().split(/\s+/).length < 2 || !nacimiento} className={`${outlineBtn} ${apagado} self-end`}>{ocupado ? 'Guardando…' : 'Guardar familiar'}</button>
          {error && <p role="alert" className="t-meta font-semibold text-error sm:col-span-2">{error}</p>}
        </div>
      )}
      {!ctx?.paciente.avisos_whatsapp && (
        <label className="flex min-h-12 cursor-pointer items-center gap-3 t-body text-titulo">
          <input type="checkbox" checked={!!t.avisos} onChange={(e) => update((x) => ({ ...x, avisos: e.target.checked }))} className="size-5 shrink-0 accent-accion-hover" />
          Acepto recibir avisos de mi cita por WhatsApp
        </label>
      )}
    </div>
  )
}
