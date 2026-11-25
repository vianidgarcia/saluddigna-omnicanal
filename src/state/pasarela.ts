/* Pasarela de pago SIMULADA (inspirada en el flujo de las pasarelas en México: tarjeta, tienda y SPEI).
   No se conecta a ningún servicio ni guarda datos de tarjeta: el resultado depende de la tarjeta de prueba.
   La respuesta imita la forma de un "cargo" de una pasarela real (id, estado, autorización, error), para que
   cambiar a una integración real (con servidor propio y llave privada) solo implique reemplazar `procesarCargo`. */

export type Marca = 'Visa' | 'Mastercard' | 'American Express' | 'Tarjeta'
export type Cargo =
  | { id: string; estado: 'aprobado'; autorizacion: string; tarjeta: { marca: Marca; ultimos4: string } }
  | { id: string; estado: 'rechazado'; motivo: string; tarjeta: { marca: Marca; ultimos4: string } }
  | { id: string; estado: 'requiere_verificacion'; tarjeta: { marca: Marca; ultimos4: string } }

/** Código que "envía el banco" en la verificación 3-D Secure simulada. */
export const CODIGO_VERIFICACION = '123456'

export const TARJETAS_PRUEBA: { numero: string; resultado: string }[] = [
  { numero: '4111111111111111', resultado: 'Aprobada' },
  { numero: '5555555555554444', resultado: 'Aprobada' },
  { numero: '4000000000003220', resultado: 'Pide verificación del banco (3-D Secure)' },
  { numero: '4000000000000002', resultado: 'Rechazada por el banco' },
  { numero: '4000000000009995', resultado: 'Rechazada: fondos insuficientes' },
]
const RECHAZOS: Record<string, string> = {
  '4000000000000002': 'El banco emisor rechazó la tarjeta. Intenta con otra tarjeta o elige otro método de pago.',
  '4000000000009995': 'Fondos insuficientes. Intenta con otra tarjeta o elige otro método de pago.',
}
const CON_VERIFICACION = new Set(['4000000000003220'])

export const soloDigitos = (s: string) => s.replace(/\D/g, '')

export function marcaDe(numero: string): Marca {
  const n = soloDigitos(numero)
  if (/^3[47]/.test(n)) return 'American Express'
  if (/^4/.test(n)) return 'Visa'
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'Mastercard'
  return 'Tarjeta'
}

/** Agrupa como en la tarjeta física: 4-4-4-4 (Amex: 4-6-5). */
export function formatoNumero(numero: string): string {
  const n = soloDigitos(numero)
  if (marcaDe(n) === 'American Express') return [n.slice(0, 4), n.slice(4, 10), n.slice(10, 15)].filter(Boolean).join(' ')
  return n.slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ')
}

/** Algoritmo de Luhn: descarta números de tarjeta mal escritos. */
export function luhn(numero: string): boolean {
  const n = soloDigitos(numero)
  if (n.length < 13 || n.length > 19) return false
  let suma = 0
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    suma += d
  }
  return suma % 10 === 0
}

export type DatosTarjeta = { numero: string; titular: string; vencimiento: string; cvv: string }
export type Errores = Partial<Record<keyof DatosTarjeta, string>>

export function validarTarjeta(d: DatosTarjeta, hoy = new Date()): Errores {
  const e: Errores = {}
  const n = soloDigitos(d.numero)
  const amex = marcaDe(n) === 'American Express'
  if (!n) e.numero = 'Escribe el número de la tarjeta.'
  else if ((amex ? n.length !== 15 : n.length !== 16) || !luhn(n)) e.numero = 'El número de tarjeta no es válido. Revísalo.'
  if (d.titular.trim().length < 3) e.titular = 'Escribe el nombre como aparece en la tarjeta.'
  const m = d.vencimiento.match(/^(\d{2})\s*\/\s*(\d{2})$/)
  if (!m) e.vencimiento = 'Escribe la fecha como MM/AA. Ej. 08/29.'
  else {
    const mes = Number(m[1]); const anio = 2000 + Number(m[2])
    if (mes < 1 || mes > 12) e.vencimiento = 'El mes debe estar entre 01 y 12.'
    else if (new Date(anio, mes, 1) <= new Date(hoy.getFullYear(), hoy.getMonth(), 1)) e.vencimiento = 'La tarjeta está vencida.'
  }
  const c = soloDigitos(d.cvv)
  if (c.length !== (amex ? 4 : 3)) e.cvv = amex ? 'El código tiene 4 dígitos (al frente de la tarjeta).' : 'El código tiene 3 dígitos (al reverso de la tarjeta).'
  return e
}

const aleatorio = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
const idCargo = () => 'ch_demo_' + Date.now().toString(36)

/** Simula el envío del cargo a la pasarela (con espera de red). */
export function procesarCargo(numero: string, espera = 1400): Promise<Cargo> {
  const n = soloDigitos(numero)
  const tarjeta = { marca: marcaDe(n), ultimos4: n.slice(-4) }
  return new Promise((ok) => window.setTimeout(() => {
    if (RECHAZOS[n]) ok({ id: idCargo(), estado: 'rechazado', motivo: RECHAZOS[n], tarjeta })
    else if (CON_VERIFICACION.has(n)) ok({ id: idCargo(), estado: 'requiere_verificacion', tarjeta })
    else ok({ id: idCargo(), estado: 'aprobado', autorizacion: aleatorio(6), tarjeta })
  }, espera))
}

/** Simula la respuesta del banco a la verificación 3-D Secure. */
export function verificarCodigo(codigo: string, tarjeta: Cargo['tarjeta'], espera = 900): Promise<Cargo> {
  return new Promise((ok) => window.setTimeout(() => {
    if (soloDigitos(codigo) === CODIGO_VERIFICACION) ok({ id: idCargo(), estado: 'aprobado', autorizacion: aleatorio(6), tarjeta })
    else ok({ id: idCargo(), estado: 'rechazado', motivo: 'El código no coincide.', tarjeta })
  }, espera))
}

/** Datos de ejemplo, estables por trámite. */
function digitos(semilla: string, largo: number) {
  let h = 2166136261
  let out = ''
  for (let i = 0; out.length < largo; i++) {
    h = Math.imul(h ^ semilla.charCodeAt(i % semilla.length) ^ i, 16777619) >>> 0
    out += String(h % 10)
  }
  return out
}
/** Referencia de tienda de 16 dígitos. */
export const referenciaTienda = (id: string) => digitos(id, 16).replace(/(\d{4})(?=\d)/g, '$1 ')
/** CLABE de ejemplo (18 dígitos; el prefijo 999 no corresponde a ningún banco). */
export const clabeEjemplo = (id: string) => ('999180' + digitos(id + 'clabe', 12)).replace(/^(\d{3})(\d{3})(\d{11})(\d)$/, '$1 $2 $3 $4')
export const referenciaSpei = (id: string) => digitos(id + 'spei', 7)
