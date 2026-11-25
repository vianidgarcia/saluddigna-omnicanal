/**
 * Prueba el ENLACE del portal con el orquestador, sin navegador ni React.
 *
 *   npm run probar-enlace
 *
 * Corre el mismo flujo que hace la interfaz al confirmar una cita, usando los módulos de
 * src/api/ (no una copia), y además revisa los dos choques conocidos entre los dos proyectos:
 *   · el catálogo: los nombres del portal contra los uuid de la base
 *   · los horarios: las horas que ofrece SelectorHorario contra las que acepta la clínica
 *
 * Requiere, en el repo del backend (hackathon-puebla):
 *   npx supabase start
 *   cd simulador && npm install && npm run usuarios
 * y aquí un .env.local con VITE_MODO=api, VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.
 *
 * Es re-ejecutable: si la paciente de prueba ya tiene el trámite abierto, lo dice y sigue.
 */
import { esApi } from '../src/api/modo.ts'
import { idClinica, idEstudio, listaEstudios } from '../src/api/catalogo.ts'
import { cliente } from '../src/api/cliente.ts'
import { partirNombre } from '../src/api/mapa.ts'
import * as orq from '../src/api/orquestador.ts'
import { ErrorApi } from '../src/api/api.ts'
import { CLINICAS_DATOS } from '../src/data/clinicasData.ts'
import { STUDIES } from '../src/data/studies.ts'
import { HORAS } from '../src/components/SelectorHorario.tsx'

/** Número de prueba de config.toml del backend (OTP 123456). En el portal se escribe 866 123 4571. */
const TEL_10 = '8661234571'
const CODIGO = '123456'
const NOMBRE = 'Ana López García'

let fallas = 0
const ok = (cond: boolean, texto: string) => { console.log(`  ${cond ? 'ok   ' : 'FALLA'} ${texto}`); if (!cond) fallas++ }
const nota = (texto: string) => console.log(`  ·    ${texto}`)
const titulo = (t: string) => console.log(`\n${t}`)
const motivo = (e: unknown) => (e instanceof ErrorApi ? `${e.code} ${e.message}` : e instanceof Error ? e.message : String(e))

async function main() {
  if (!esApi) {
    console.error('El portal está en modo local. Pon VITE_MODO=api, VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en .env.local.')
    process.exit(1)
  }
  const c = cliente()!

  titulo('1. Catálogo de estudios: nombres del portal contra la base')
  const estudiosBase = await listaEstudios(c)
  nota(`la base trae ${estudiosBase.length} estudios: ${estudiosBase.map((e) => e.nombre).join(', ')}`)
  const delPortal = Object.values(STUDIES).flat()
  const sinEstudio: string[] = []
  for (const nombre of delPortal) {
    if (!(await idEstudio(c, nombre))) sinEstudio.push(nombre)
  }
  ok(sinEstudio.length < delPortal.length, `${delPortal.length - sinEstudio.length} de ${delPortal.length} estudios del portal existen en la base`)
  if (sinEstudio.length) nota(`sin equivalente (el portal los ofrece y la base los rechazaría): ${sinEstudio.join(', ')}`)

  titulo('2. Catálogo de clínicas: las 261 del portal contra la base')
  // el primer estudio del portal que la base sí conoce (para pedirle sus clínicas)
  let estudioPrueba = estudiosBase[0].id
  for (const nombre of delPortal) {
    const id = await idEstudio(c, nombre)
    if (id) { estudioPrueba = id; break }
  }
  // Se resuelve una muestra repartida por todo el directorio, como lo hace el portal (por ciudad y estado).
  // No las 261: cada consulta cuenta en el rate limit de la base (PT429) y el portal hace una por confirmación.
  const paso = Math.ceil(CLINICAS_DATOS.length / 12)
  const muestra = CLINICAS_DATOS.filter((_, i) => i % paso === 0 || i === CLINICAS_DATOS.length - 1)
  const emparejadas: string[] = []
  for (const cl of muestra) {
    if (await idClinica(c, estudioPrueba, cl.name)) emparejadas.push(cl.name)
  }
  ok(emparejadas.length === muestra.length, `${emparejadas.length} de ${muestra.length} clínicas de la muestra (de ${CLINICAS_DATOS.length}) resuelven a un uuid de la base`)
  const faltan = muestra.filter((cl) => !emparejadas.includes(cl.name)).map((cl) => cl.name)
  if (faltan.length) nota(`sin equivalente: ${faltan.join(', ')}`)

  titulo('3. Flujo completo, igual que al confirmar una cita en el portal')
  await orq.arrancar()
  nota('sesión anónima abierta')
  const modo = await orq.pedirCodigo(TEL_10)
  await orq.confirmarCodigo(TEL_10, CODIGO, modo)
  ok(orq.estadoEnlace().verificado, `celular verificado por OTP (modo "${modo}")`)

  const partes = partirNombre(NOMBRE)
  await orq.guardarNombre(NOMBRE)
  ok(orq.estadoEnlace().faltaRegistro.length === 0, `registro completo (${partes.nombre} / ${partes.apellido_paterno} / ${partes.apellido_materno})`)

  const estudio = estudiosBase[0].nombre
  const clinica = emparejadas[0]
  if (!clinica) { ok(false, 'ninguna clínica del portal empareja: no se puede seguir el flujo'); return }
  nota(`se usará estudio "${estudio}" y clínica "${clinica}"`)

  let folio = ''
  try {
    const t = await orq.crearTramiteCompleto({ estudio, clinica })
    folio = t.folio
    ok(true, `trámite en la base con folio ${folio} (creado o retomado si ya estaba abierto)`)
    ok(!!(await idClinica(c, estudioPrueba, clinica)), 'la clínica del portal resolvió a un uuid de la base')
  } catch (e) {
    ok(false, `crearTramiteCompleto: ${motivo(e)}`)
    return
  }

  titulo('4. Horarios: lo que ofrece el portal contra lo que acepta la clínica')
  const hs = await orq.horarios(clinica, estudio)
  ok(hs.length > 0, `la base ofrece ${hs.length} horarios`)
  if (hs.length === 0) {
    nota('sin horarios: falta cargar core.horarios_clinica para esa clínica')
    return
  }
  const dia = hs[0].fecha
  const delDia = hs.filter((h) => h.fecha === dia).map((h) => h.hora.slice(0, 5))
  nota(`día ${dia}: la base acepta ${delDia[0]} a ${delDia.at(-1)}`)
  const rechazadas = HORAS.filter((h) => !delDia.includes(h))
  ok(rechazadas.length < HORAS.length, `${HORAS.length - rechazadas.length} de las ${HORAS.length} horas del portal existen en la base`)
  if (rechazadas.length) {
    nota(`la rejilla de demostración ofrecería y la base rechazaría: ${rechazadas.join(', ')}`)
    nota('por eso en modo api SelectorHorario ya no usa la rejilla: pide las horas con orq.horariosRango().')
  }
  // lo que ve el selector en modo api: el rango pedido por tramos debe incluir todo lo que dio horarios()
  const hoy = hs[0].fecha
  const hasta = hs.at(-1)!.fecha
  const rango = await orq.horariosRango(clinica, estudio, hoy, hasta)
  ok(rango !== null && hs.every((h) => rango.some((r) => r.fecha_hora === h.fecha_hora)), `horariosRango(${hoy} a ${hasta}) trae los ${hs.length} horarios de horarios()`)
  ok(rango !== null && rango.every((r) => r.fecha >= hoy && r.fecha <= hasta), 'horariosRango no se sale del rango pedido')
  const horasSelector = rango?.filter((r) => r.fecha === dia).map((r) => r.hora.slice(0, 5)) ?? []
  ok(horasSelector.every((h) => delDia.includes(h)), `todas las horas que ofrecería el selector el ${dia} las acepta la clínica`)

  titulo('5. Reserva y pago')
  // Igual que el portal: si el trámite ya existía y ya tiene cita o pago, se conservan (no se repite el paso).
  const previo = orq.tramiteRemoto()
  if (previo?.contexto?.cita_id) {
    ok(true, `el trámite ya tenía su cita (${previo.contexto.fecha_hora}): se conserva, no se vuelve a reservar`)
  } else {
    try {
      const t = await orq.reservar(dia, delDia[0])
      ok(t.contexto.fecha_hora != null, `cita reservada para ${t.contexto.fecha_hora}`)
    } catch (e) {
      ok(false, `reservar: ${motivo(e)}`)
    }
  }
  if (orq.tramiteRemoto()?.contexto?.pago_id) {
    ok(true, 'el trámite ya tenía su pago generado: se conserva')
  } else {
    try {
      const p = await orq.pago()
      ok(!!p.link_pago, `pago generado por la base: ${p.link_pago} (monto ${p.monto})`)
      nota('el portal todavía cobra con su pasarela simulada: pendiente usar esta liga.')
    } catch (e) {
      ok(false, `generarPago: ${motivo(e)}`)
    }
  }

  titulo('6. Lo que vería el asesor')
  const ctx = await orq.sincronizar()
  ok(ctx.tramite_activo?.folio === folio, `el contexto unificado trae el folio ${folio}`)
  nota(`canales usados por el trámite: ${(ctx.tramite_activo?.canales_usados ?? ['web']).join(', ')}`)
}

main()
  .then(() => {
    console.log(fallas === 0 ? '\nTodo bien.' : `\n${fallas} ${fallas === 1 ? 'falla' : 'fallas'}.`)
    process.exit(fallas === 0 ? 0 : 1)
  })
  .catch((e) => { console.error('\nSe cortó:', motivo(e)); process.exit(1) })
