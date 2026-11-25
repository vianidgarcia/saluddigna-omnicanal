/* La contestadora del modo local: el mismo recorrido que el servidor, con datos de demostración.
   No usa la red: recibe lo que dijo el paciente y devuelve qué contesta. */
import type { Entrante, Espera, Etapa, Turno } from './tipos'

export const CODIGO_DEMO = '123456'
export type DatosDemo = { folio: string; nombre: string | null; telefono: string | null; estudio: string | null } | null
export type Respuesta = { texto: string; etapa: Etapa; espera: Espera; transferir?: Entrante['brief'] }

const DIGITO: Record<string, string> = { cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9' }
const plano = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** "ocho seis 6 uno" → "8661" */
export const digitosDe = (s: string) => plano(s).split(/[\s,.;:-]+/).map((x) => DIGITO[x] ?? x.replace(/\D/g, '')).join('')

export function crearContestadora(datos: () => DatosDemo) {
  let etapa: Etapa = 'ia_pidiendo_telefono'
  let tel = ''
  let intentos = 0
  let verificado = false
  const turnos: Turno[] = []
  const anotar = (autor: Turno['autor'], texto: string) => { turnos.push({ autor, texto, en: new Date().toISOString() }) }
  const decir = (texto: string, e: Etapa, espera: Espera): Respuesta => {
    etapa = e
    anotar('ia', texto)
    return { texto, etapa: e, espera }
  }
  const sinVerificar = (p: string) =>
    decir(`${p} ¿Qué necesitas: continuar un trámite, información o una cita nueva?`, 'ia_confirmando_motivo', 'motivo')

  return {
    turnos,
    get verificado() { return verificado },
    saludo: () => decir('¡Hola! Habla Sofía, asistente de Salud Digna. Dime tu número celular a 10 dígitos, por favor.', 'ia_pidiendo_telefono', 'telefono'),
    responder(texto: string): Respuesta {
      const entrada = texto.trim()
      if (etapa === 'ia_pidiendo_telefono') {
        anotar('paciente', entrada)
        const d = digitosDe(entrada)
        if (d.length < 10 || d.length > 13) return decir('Necesito un celular de 10 dígitos. ¿Me lo repites?', etapa, 'telefono')
        tel = d.slice(-10)
        if (datos()?.telefono !== tel) return sinVerificar('Gracias. No encontré un trámite con ese número; un asesor confirmará tus datos.')
        return decir(`Ubiqué el número terminado en ${tel.slice(-4)}. Dime el código de 6 dígitos (en esta demo es ${CODIGO_DEMO}).`, 'ia_esperando_otp', 'otp')
      }
      if (etapa === 'ia_esperando_otp') {
        const d = digitosDe(entrada)
        anotar('paciente', d ? '(dictó su código)' : entrada)
        if (/asesor|humano|persona/.test(plano(entrada))) return sinVerificar('Claro, un asesor confirmará tu identidad.')
        if (d !== CODIGO_DEMO) {
          intentos += 1
          if (intentos >= 3) return sinVerificar('El código no coincidió, así que un asesor confirmará tu identidad.')
          return decir(`Ese código no coincide. Intenta de nuevo (en esta demo es ${CODIGO_DEMO}).`, etapa, 'otp')
        }
        verificado = true
        const t = datos()
        return decir(
          `Gracias${t?.nombre ? `, ${t.nombre}` : ''}. Veo tu trámite ${t?.folio ?? ''}${t?.estudio ? ` de ${t.estudio}` : ''}. ¿Quieres continuarlo, pedir información o una cita nueva?`,
          'ia_confirmando_motivo', 'motivo')
      }
      if (etapa === 'ia_confirmando_motivo') {
        anotar('paciente', entrada)
        const p = plano(entrada)
        const motivo = /info|precio|preparacion|ayuno|horario|duda/.test(p) ? 'informacion'
          : /nuev|otra cita|agendar/.test(p) ? 'nueva_cita'
          : verificado ? 'continuar_tramite' : 'otro'
        const r = decir('Perfecto, te transfiero con un asesor y le paso lo que me contaste.', 'transfiriendo_asesor', 'ninguna')
        const folio = verificado ? datos()?.folio ?? null : null
        return {
          ...r,
          transferir: {
            motivo, resumenIa: `Dijo: “${entrada.slice(0, 120)}”`, tramiteFolioSugerido: folio, tramiteIdSugerido: folio,
            verificadoPor: verificado ? 'otp' : 'sin_verificar',
            telefonoNormalizado: `52${tel}`, telefonoEnmascarado: `+52 ****** ${tel.slice(-4)}`,
          },
        }
      }
      return { texto: '', etapa, espera: 'ninguna' }
    },
  }
}
