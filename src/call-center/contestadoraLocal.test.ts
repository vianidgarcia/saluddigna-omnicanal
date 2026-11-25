import assert from 'node:assert/strict'
import test from 'node:test'
import { CODIGO_DEMO, crearContestadora, digitosDe } from './contestadoraLocal.ts'

const t = { folio: 'SD-1', nombre: 'Ana', telefono: '8661234571', estudio: 'Mastografía' }

test('digitosDe entiende voz y números mezclados', () => {
  assert.equal(digitosDe('ocho seis 6 uno, 23'), '866123')
})

test('recorrido completo verificado, sin guardar el código', () => {
  const c = crearContestadora(() => t)
  assert.equal(c.saludo().espera, 'telefono')
  assert.equal(c.responder('866 123 4571').espera, 'otp')
  assert.equal(c.responder(CODIGO_DEMO).espera, 'motivo')
  const r = c.responder('quiero continuar')
  assert.equal(r.transferir?.verificadoPor, 'otp')
  assert.equal(r.transferir?.tramiteFolioSugerido, 'SD-1')
  assert.ok(!c.turnos.some((x) => x.autor === 'paciente' && x.texto.includes(CODIGO_DEMO)))
})

test('teléfono desconocido llega al asesor sin verificar', () => {
  const c = crearContestadora(() => null)
  c.saludo()
  assert.equal(c.responder('123').espera, 'telefono')
  assert.equal(c.responder('6671234567').espera, 'motivo')
  assert.equal(c.responder('x').transferir?.verificadoPor, 'sin_verificar')
})

test('tres códigos malos llegan al asesor sin datos del trámite', () => {
  const c = crearContestadora(() => t)
  c.saludo()
  c.responder('8661234571')
  c.responder('000000')
  c.responder('000000')
  assert.equal(c.responder('000000').espera, 'motivo')
  assert.equal(c.responder('x').transferir?.tramiteFolioSugerido, null)
})
