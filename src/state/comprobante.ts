/* Comprobante de cita en PDF, generado en el navegador (jsPDF, cargado solo al pedirlo).
   Es un documento de DEMOSTRACIÓN: lo dice en el propio PDF. Los colores son los de la paleta clara del sitio
   (el PDF no depende del modo oscuro). */
import { findClinic } from '../data/clinics'
import { METODO, fechaLarga, fmtTelefono, type Tramite, fmtHora } from './tramite'

const C = {
  titulo: '#1F2933', cuerpo: '#43474A', secundario: '#5B6B7A', borde: '#D6E4F5', resaltado: '#EBF4FC',
  accion: '#0074D9', marino: '#004480', verde: '#006D3D', marca: '#008B50',
}

const fechaHoraEmision = (d = new Date()) =>
  d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }) + ', ' +
  d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' h'

/** Texto del pago para el comprobante. */
export function textoPago(t: Tramite): string[] {
  if (!t.metodoPago) return ['—']
  const lineas = [METODO[t.metodoPago]]
  if (t.metodoPago === 'en_clinica') lineas.push('Pagas en recepción el día de tu cita.')
  else if (t.pago?.estado === 'aprobado') {
    const partes = ['Pago aprobado']
    if (t.pago.tarjeta) partes.push(`${t.pago.tarjeta.marca} •••• ${t.pago.tarjeta.ultimos4}`)
    if (t.pago.autorizacion) partes.push(`autorización ${t.pago.autorizacion} (de ejemplo)`)
    lineas.push(partes.join(' · '))
  } else lineas.push('Pago pendiente')
  return lineas
}

/** Genera y descarga el comprobante. Lanza error si no se pudo cargar el generador (p. ej. sin conexión). */
export async function descargarComprobante(t: Tramite): Promise<string> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const M = 18 // margen
  const ancho = W - M * 2
  let y = 0

  doc.setProperties({ title: `Comprobante de cita ${t.id}`, subject: 'Comprobante de cita (demostración)', author: 'Salud Digna · prototipo', creator: 'Portal del paciente (prototipo)' })

  // encabezado
  doc.setFillColor(C.resaltado); doc.rect(0, 0, W, 34, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.setTextColor(C.marca); doc.text('Salud', M, 17)
  doc.setTextColor(C.titulo); doc.text('Digna', M + doc.getTextWidth('Salud '), 17)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(C.marca); doc.text('La salud es para todos', M, 23)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(C.marino)
  doc.text('Comprobante de cita', W - M, 17, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(C.secundario)
  doc.text(`Emitido el ${fechaHoraEmision()}`, W - M, 23, { align: 'right' })
  y = 44

  // aviso de demostración
  doc.setDrawColor(C.borde); doc.setLineWidth(0.4)
  doc.roundedRect(M, y - 6, ancho, 12, 2, 2, 'S')
  doc.setFontSize(9); doc.setTextColor(C.cuerpo)
  doc.text('Documento de demostración (prototipo). No es un comprobante oficial y no ampara ningún cobro.', M + 4, y + 1.5)
  y += 21

  // estado y folio
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(C.verde)
  doc.text('Cita confirmada', M, y)
  doc.setFontSize(11); doc.setTextColor(C.secundario); doc.setFont('helvetica', 'normal')
  doc.text('Folio', W - M, y - 6, { align: 'right' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(C.titulo)
  doc.text(t.id, W - M, y, { align: 'right' })
  y += 10
  doc.setDrawColor(C.borde); doc.line(M, y, W - M, y)
  y += 8

  // datos
  const c = findClinic(t.clinica)
  const filas: [string, string[]][] = [
    ['Paciente', [t.paciente.nombre?.trim() || '—', ...(t.paciente.telefono ? [`Tel. ${fmtTelefono(t.paciente.telefono)}`] : [])]],
    ['Estudio', [t.estudio?.nombre ?? '—', t.estudio?.precio ? `${t.estudio.precio} IVA incluido` : 'Precio según tu clínica']],
    ['Clínica', c ? [c.name, c.address, [c.phone && `Tel. ${c.phone}`, c.horario].filter(Boolean).join(' · ')].filter(Boolean) : ['Pendiente de elegir']],
    ['Fecha y hora', t.fecha && t.hora ? [`${fechaLarga(t.fecha).replace(/^./, (l) => l.toUpperCase())} · ${fmtHora(t.hora)}`, 'Horario de demostración'] : ['—']],
    ['Pago', textoPago(t)],
  ]
  const colK = 38
  for (const [k, vs] of filas) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(C.secundario)
    doc.text(k, M, y)
    let yy = y
    vs.forEach((v, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.setFontSize(i === 0 ? 12 : 10)
      doc.setTextColor(i === 0 ? C.titulo : C.cuerpo)
      const lineas = doc.splitTextToSize(v, ancho - colK) as string[]
      doc.text(lineas, M + colK, yy)
      yy += lineas.length * (i === 0 ? 5.6 : 4.8) + 1
    })
    y = Math.max(y + 8, yy + 3)
    doc.setDrawColor(C.borde); doc.line(M, y - 3.5, W - M, y - 3.5)
    y += 3
  }

  // indicaciones y contacto
  y += 2
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(C.titulo)
  doc.text('Para tu cita', M, y)
  y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(C.cuerpo)
  const indicaciones = [
    'Presenta este comprobante o tu folio en recepción.',
    'Revisa las preparaciones de tu estudio antes de acudir.',
    'Si necesitas cambiar tu cita, escríbenos con tu folio: no tienes que volver a dar tus datos.',
  ]
  for (const i of indicaciones) {
    const l = doc.splitTextToSize(`•  ${i}`, ancho) as string[]
    doc.text(l, M, y); y += l.length * 4.8 + 1
  }
  y += 4
  doc.setFillColor(C.resaltado); doc.roundedRect(M, y - 5, ancho, 16, 2, 2, 'F')
  doc.setFont('helvetica', 'bold'); doc.setTextColor(C.titulo); doc.text('¿Necesitas ayuda?', M + 4, y + 0.5)
  doc.setFont('helvetica', 'normal'); doc.setTextColor(C.cuerpo)
  doc.text('WhatsApp +52 55 3956 6729 (asistente 24/7, asesores de 7:00 a 21:00) · Call Center 55 5554 7166', M + 4, y + 6)

  // pie
  doc.setFontSize(8); doc.setTextColor(C.secundario)
  doc.text(`Generado desde el portal del paciente · Folio ${t.id} · Datos de demostración`, M, 287)
  doc.text('Página 1 de 1', W - M, 287, { align: 'right' })

  const nombre = `comprobante-cita-${t.id}.pdf`
  doc.save(nombre)
  return nombre
}
