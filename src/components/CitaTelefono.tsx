/* Agendar o continuar una cita mientras se atiende por teléfono. La base pide identidad (fecha de nacimiento o código),
   nombre y celular verificado alguna vez; los pasos son los mismos de la llamada (TramiteLlamada). Solo modo api. */
import { useCallback, useEffect, useState } from 'react'
import type { Beneficiario, Contexto, Estudio } from '../api/api'
import * as api from '../api/llamadas'
import { EligeEstudio, Para, TramiteLlamada, type Hacer } from '../call-center/TramiteLlamada'
import { campo } from '../call-center/piezas'
import { Icon } from './Icon'
import { apagado, outlineBtn } from './ui'

export function CitaTelefono({ i, ctx, telefono, ocupado, hacer }: { i: string; ctx: Contexto; telefono: string; ocupado: boolean; hacer: Hacer }) {
  const [estudios, setEstudios] = useState<Estudio[]>([])
  const [familia, setFamilia] = useState<Beneficiario[]>([])
  const [para, setPara] = useState(ctx.paciente.id)
  const [estudio, setEstudio] = useState('')
  const [nombre, setNombre] = useState('')
  const [abierto, setAbierto] = useState(false)
  const identificado = ctx.sesion.nivel_verificacion !== 'declarada'
  const faltan = ctx.sesion.requiere_registro ?? []
  const faltaCelular = faltan.includes('celular_verificado')
  const faltaNombre = faltan.some((x) => x !== 'celular_verificado')
  const t = ctx.tramite_activo
  const btn = `${outlineBtn} ${apagado}`

  const recargarFamilia = useCallback(async () => { setFamilia(await api.familia(i)) }, [i])
  useEffect(() => {
    if (!identificado) return
    let vivo = true
    void api.estudios().then((x) => { if (vivo) setEstudios(x) }).catch(() => {})
    void recargarFamilia().catch(() => {})
    return () => { vivo = false }
  }, [identificado, recargarFamilia])

  return (
    <div className="mt-6 border-t border-borde pt-4">
      <h3 className="t-sub font-bold text-titulo">Agendar una cita</h3>
      {!identificado && <p className="mt-1 t-body">Primero verifica la identidad del paciente, arriba.</p>}
      {identificado && faltaCelular && <p className="mt-1 t-body">Su celular aún no está confirmado: envíale el código para poder agendar.</p>}
      {identificado && faltaNombre && (
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label htmlFor="ct-nom" className="text-base font-semibold text-titulo">Nombre y apellidos del paciente</label>
            <input id="ct-nom" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="off" className={`${campo} mt-1`} />
          </div>
          <button onClick={() => void hacer(() => api.guardarNombre(i, nombre), 'Datos guardados.')} disabled={ocupado || nombre.trim().split(/\s+/).length < 2} className={btn}><Icon n="check" />Guardar datos</button>
        </div>
      )}
      {identificado && !faltan.length && (
        <>
          <button onClick={() => setAbierto(!abierto)} aria-expanded={abierto} className={`${btn} mt-2`}><Icon n="calendar" />{abierto ? 'Cerrar cita nueva' : 'Agendar cita nueva'}</button>
          {abierto && (
            <div className="mt-3">
              <Para id="ct" {...{ i, ctx, familia, recargarFamilia, para, setPara, ocupado, hacer }} />
              <EligeEstudio id="ct-est" estudios={estudios} valor={estudio} cambiar={setEstudio} />
              <button onClick={() => void hacer(async () => { await api.nuevo(i, estudio, para === ctx.paciente.id ? null : para); setAbierto(false); setEstudio('') }, 'Trámite abierto: continúa abajo.')}
                disabled={ocupado || !estudio} className={`${btn} mt-3`}>Continuar<Icon n="arrow" /></button>
            </div>
          )}
        </>
      )}
      {identificado && t && t.atendido_por_mi && <TramiteLlamada key={t.id} {...{ i, t, ctx, telefono, estudios, familia, recargarFamilia, ocupado, hacer }} />}
    </div>
  )
}
