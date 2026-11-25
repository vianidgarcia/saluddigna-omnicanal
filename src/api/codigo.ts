/* Código que pide el personal. El backend (enviar-otp) lo manda por WhatsApp y, si falla, por SMS. Si el SMS no está
   configurado, su error llega en crudo y no dice por qué falló WhatsApp (o CANAL_CODIGO=sms): aquí se dice qué hacer. */
import { enviarOtp, ErrorApi, type Cliente } from './api'

export const avisoEnvio = (mensaje: string): string | null =>
  /^(SMS no (configurado|enviado)|WhatsApp (no configurado|respondió))/.test(mensaje)
    ? 'El código no salió por WhatsApp ni por SMS. Pide al paciente que escriba “hola” por WhatsApp al +1 555 138 0373 desde este celular y vuelve a enviarlo.'
    : null

export async function enviarCodigo(c: Cliente, interaccion: string) {
  try {
    return await enviarOtp(c, interaccion)
  } catch (e) {
    const aviso = e instanceof ErrorApi ? avisoEnvio(e.message) : null
    if (!aviso) throw e
    console.warn('[codigo]', e)
    throw new Error(aviso)
  }
}
