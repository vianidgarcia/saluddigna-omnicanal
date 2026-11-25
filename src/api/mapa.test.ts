/* Pruebas de las equivalencias entre el modelo del portal y el del orquestador.
   No tocan la red ni la base: corren con `npm run probar` (node --test). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANAL_DESDE_API, CANAL_HACIA_API, PASO_DESDE_API, PASO_HACIA_API, canalDesdeApi, claveHorario,
  emparejarEstudio, estadoDesdeApi, esMismoTramite, fechaHoraDeHorarios, fusionarDesdeApi, normalizar, partirFechaHora,
  aE164, partirNombre,
} from './mapa.ts'
import type { Tramite as TramiteApi, Horario } from './api.ts'
import type { Tramite } from '../state/tramite.ts'

test('los pasos van y vuelven sin perderse', () => {
  for (const p of [1, 2, 3, 4] as const) assert.equal(PASO_DESDE_API[PASO_HACIA_API[p]], p)
  // 'confirmada' no tiene paso propio en el portal: cae en el último
  assert.equal(PASO_DESDE_API.confirmada, 4)
})

test('los canales van y vuelven; pasarela y app se mapean al más cercano', () => {
  for (const c of ['web', 'whatsapp', 'call_center', 'clinica'] as const) {
    assert.equal(CANAL_DESDE_API[CANAL_HACIA_API[c]], c)
  }
  assert.equal(CANAL_HACIA_API.pasarela, 'web', 'la base no tiene canal pasarela')
  assert.equal(CANAL_DESDE_API.app, 'web', 'el portal no distingue la app móvil')
  assert.equal(canalDesdeApi(undefined), 'web')
  assert.equal(canalDesdeApi('inventado'), 'web', 'un canal desconocido no debe romper la vista')
})

const base = (extra: Partial<TramiteApi> = {}): TramiteApi => ({
  id: 'uuid', folio: 'SD-4K7Q', etiqueta: 'x', tipo: 'cita', estado: 'abierto',
  paso_actual: 'pago', version: 3, contexto: {}, ...extra,
})

test('el estado del portal sale del paso y del pago de la base', () => {
  assert.equal(estadoDesdeApi(base({ paso_actual: 'seleccion_clinica' })), 'en_curso')
  assert.equal(estadoDesdeApi(base({ paso_actual: 'pago' })), 'en_curso', 'sin pago generado sigue en curso')
  assert.equal(estadoDesdeApi(base({ paso_actual: 'pago', contexto: { pago_id: 'p1' } })), 'pago_pendiente')
  assert.equal(estadoDesdeApi(base({ paso_actual: 'confirmada' })), 'confirmada')
})

test('partirFechaHora no corre la hora por la zona del navegador', () => {
  assert.deepEqual(partirFechaHora('2026-11-27T13:30:00+00:00'), ['2026-11-27', '13:30'])
  assert.deepEqual(partirFechaHora('2026-11-27 08:00:00-06'), ['2026-11-27', '08:00'])
  assert.deepEqual(partirFechaHora('no es fecha'), ['', ''])
})

test('el fecha_hora para reservar se toma de la lista de la clínica, no se calcula', () => {
  const hs: Horario[] = [
    { fecha_hora: '2026-11-27T13:30:00-06:00', fecha: '2026-11-27', hora: '13:30:00', disponibles: 2 },
    { fecha_hora: '2026-11-27T14:00:00-06:00', fecha: '2026-11-27', hora: '14:00', disponibles: 1 },
  ]
  assert.equal(fechaHoraDeHorarios(hs, '2026-11-27', '13:30'), '2026-11-27T13:30:00-06:00')
  assert.equal(fechaHoraDeHorarios(hs, '2026-11-27', '14:00'), '2026-11-27T14:00:00-06:00')
  assert.equal(fechaHoraDeHorarios(hs, '2026-11-28', '13:30'), null, 'un horario que no está debe dar null')
  assert.equal(claveHorario('2026-11-27', '13:30'), '2026-11-27 13:30')
})

const local: Tramite = {
  id: 'SD-LOCAL', estudio: { categoria: 'Mastografía', nombre: 'Mastografía bilateral', precio: '$300' },
  clinica: null, clinicaPendiente: true, fecha: null, hora: null,
  paciente: { nombre: 'Ana López Pérez', telefono: '6671234567' },
  metodoPago: 'oxxo', paso: 2, estado: 'en_curso', desdeResumen: false,
  canalInicio: 'web', ultimoCanal: 'web', ultimaActualizacion: '2026-11-24T00:00:00.000Z', eventos: [],
}

test('la fusión toma el folio de la base y conserva lo que solo existe en el portal', () => {
  const t = fusionarDesdeApi(local, base({
    paso_actual: 'confirmada',
    clinica: { id: 'c1', nombre: 'Culiacán Centro', ciudad: 'Culiacán', direccion: null },
    estudio: { id: 'e1', nombre: 'Mastografía bilateral', preparacion: null },
    contexto: { fecha_hora: '2026-11-27T13:30:00-06:00' },
    ultimo_canal: 'whatsapp',
  }))
  assert.equal(t.id, 'SD-4K7Q', 'el folio manda la base')
  assert.equal(t.estado, 'confirmada')
  assert.equal(t.paso, 4)
  assert.equal(t.clinica, 'Culiacán Centro')
  assert.equal(t.clinicaPendiente, false, 'si la base ya tiene clínica, deja de estar pendiente')
  assert.equal(t.fecha, '2026-11-27')
  assert.equal(t.hora, '13:30')
  assert.equal(t.ultimoCanal, 'whatsapp')
  // lo que la base no conoce no se pierde
  assert.equal(t.metodoPago, 'oxxo')
  assert.equal(t.paciente.nombre, 'Ana López Pérez')
  assert.equal(t.estudio?.categoria, 'Mastografía', 'la categoría es del portal: la base no la tiene')
  assert.equal(t.estudio?.precio, '$300')
})

test('la fusión no borra lo local cuando la base aún no tiene esos datos', () => {
  const conFecha: Tramite = { ...local, fecha: '2026-12-01', hora: '09:00', clinica: 'Culiacán Centro' }
  const t = fusionarDesdeApi(conFecha, base({ paso_actual: 'seleccion_horario', contexto: {} }))
  assert.equal(t.fecha, '2026-12-01')
  assert.equal(t.hora, '09:00')
  assert.equal(t.clinica, 'Culiacán Centro')
})

test('el nombre del formulario se parte en los campos que pide la base', () => {
  assert.deepEqual(partirNombre('Ana'), { nombre: 'Ana' })
  assert.deepEqual(partirNombre('Ana López'), { nombre: 'Ana', apellido_paterno: 'López' })
  assert.deepEqual(partirNombre('Ana López Pérez'), { nombre: 'Ana', apellido_paterno: 'López', apellido_materno: 'Pérez' })
  assert.deepEqual(partirNombre('  Ana María  López Pérez '),
    { nombre: 'Ana María', apellido_paterno: 'López', apellido_materno: 'Pérez' })
  assert.deepEqual(partirNombre('   '), { nombre: '' })
})

test('el teléfono de 10 dígitos del portal se vuelve el que espera Auth', () => {
  assert.equal(aE164('6671234567'), '526671234567')
  assert.equal(aE164('667 123 4567'), '526671234567')
  assert.equal(aE164('+52 667 123 4567'), '526671234567', 'si ya trae lada, no se duplica')
})

test('normalizar permite emparejar catálogos escritos distinto', () => {
  assert.equal(normalizar('Mastografía  BILATERAL'), 'mastografia bilateral')
  assert.equal(normalizar(' Culiacán Centro '), 'culiacan centro')
})

test('un trámite viejo de la base no se funde sobre el que el paciente arma ahora', () => {
  const local = { id: 'SD-1700000000', estudio: { categoria: 'Laboratorio', nombre: 'Biometría hemática' } } as Tramite
  const viejo = base({ folio: 'SD-846S', estudio: { id: 'e1', nombre: 'Mastografía bilateral' } as TramiteApi['estudio'] })
  assert.equal(esMismoTramite(local, viejo), false, 'otro estudio y otro folio: es otro trámite')
  assert.equal(esMismoTramite(local, base({ folio: 'SD-1700000000' })), true, 'mismo folio')
  const mismoEstudio = base({ folio: 'SD-9X9X', estudio: { id: 'e2', nombre: 'Biometría hemática' } as TramiteApi['estudio'] })
  assert.equal(esMismoTramite(local, mismoEstudio), true, 'mismo estudio: se continúa el de otro canal')
})

test('un estudio del portal solo empareja con el estudio correcto de la base', () => {
  const base = [{ nombre: 'Mastografía' }, { nombre: 'Biometría hemática' }, { nombre: 'Rayos X de tórax' }]
  assert.equal(emparejarEstudio(base, 'Biometría Hemática')?.nombre, 'Biometría hemática', 'sin acentos ni mayúsculas')
  assert.equal(emparejarEstudio(base, 'Mastografía bilateral')?.nombre, 'Mastografía', 'un calificativo no cambia el estudio')
  assert.equal(emparejarEstudio(base, 'Mastografía + ultrasonido mamario'), undefined, 'un combo con + es otro estudio')
  assert.equal(emparejarEstudio(base, 'Papanicolaou'), undefined, 'lo que la base no tiene no se inventa')
  assert.equal(emparejarEstudio([{ nombre: 'Mastografía + ultrasonido mamario' }], 'Mastografía + ultrasonido mamario')?.nombre, 'Mastografía + ultrasonido mamario', 'el combo idéntico sí')
})
