/**
 * Genera el seed del catálogo del orquestador a partir del catálogo del portal.
 *
 *   npm run seed-catalogo [ruta-de-salida]
 *
 * Lee src/data/clinicasData.ts (261 sucursales reales) y src/data/studies.ts y escribe, por omisión,
 * ../hackathon-puebla/supabase/seed-catalogo-real.sql con:
 *   core.clinicas, core.estudios, core.clinica_estudios y core.horarios_clinica
 * de modo que los NOMBRES (con los que catalogo.ts empareja) y los horarios sean los mismos que
 * en el portal. Es idempotente (on conflict / not exists): se puede cargar más de una vez.
 *
 * No toca las migraciones ni seed.sql. Qué se inventa y qué no:
 *   · Clínicas, direcciones y horarios: reales (de clinicasData.ts).
 *   · Qué estudios ofrece cada clínica: no hay dato real; el portal ofrece todos en todas, igual aquí.
 *   · Precios: de EJEMPLO (core.reservar_cita / pagos exigen monto > 0). El portal no los muestra.
 */
import { writeFileSync } from 'node:fs'
import { CLINICAS_DATOS, type ClinicaDato } from '../src/data/clinicasData.ts'
import { STUDIES } from '../src/data/studies.ts'
import { normalizar } from '../src/api/mapa.ts'

const SALIDA = process.argv[2] ?? new URL('../../hackathon-puebla/supabase/seed-catalogo-real.sql', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const q = (s: string) => `'${s.replace(/'/g, "''")}'`

/* ------------------------------------------------------------- horarios ---- */

/** '6:00 am' / '19:00 pm' / '3:00 p.m.' → 'HH:MM' en 24 h (el sitio mezcla 12 y 24 h). */
function hora24(h: string, m: string, ap: string): string {
  let n = Number(h)
  const pm = /^p/i.test(ap)
  if (pm && n < 12) n += 12
  if (!pm && n === 12) n = 0
  return `${String(n).padStart(2, '0')}:${m}`
}

type Tramo = { abre: string; cierra: string }
const DIAS_SEMANA = { lun_vie: [1, 2, 3, 4, 5], sab: [6], dom: [0] } as const

/** 'Lunes a Vie: 6:00 am a 19:00 pm · Sab: … · Dom: No Laboramos' → tramos por grupo de días. */
function leerHorario(texto: string): Partial<Record<keyof typeof DIAS_SEMANA, Tramo>> {
  const r: Partial<Record<keyof typeof DIAS_SEMANA, Tramo>> = {}
  for (const parte of texto.split('·')) {
    const i = parte.indexOf(':')
    if (i < 0) continue
    const etiqueta = normalizar(parte.slice(0, i))
    const grupo = etiqueta.startsWith('lunes') ? 'lun_vie' : etiqueta.startsWith('sab') ? 'sab' : etiqueta.startsWith('dom') ? 'dom' : null
    if (!grupo) continue
    const t = [...parte.slice(i + 1).matchAll(/(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/gi)]
    if (t.length >= 2) {
      const abre = hora24(t[0][1], t[0][2], t[0][3])
      const cierra = hora24(t[1][1], t[1][2], t[1][3])
      if (cierra > abre) r[grupo] = { abre, cierra }
    }
  }
  return r
}

/** Para las sucursales sin horario publicado: el mismo de seed.sql (L-V 7:00–15:00, sábado 7:00–12:00). */
const HORARIO_POR_OMISION = { lun_vie: { abre: '07:00', cierra: '15:00' }, sab: { abre: '07:00', cierra: '12:00' } }

/* ----------------------------------------------------------- zona horaria ---- */

/** Desde 2022 solo cambian de zona estos estados (aprox.; los municipios fronterizos usan horario de verano). */
const ZONA: Record<string, string> = {
  'Baja California': 'America/Tijuana',
  'Baja California Sur': 'America/Mazatlan',
  Chihuahua: 'America/Chihuahua',
  Nayarit: 'America/Mazatlan',
  Sinaloa: 'America/Mazatlan',
  Sonora: 'America/Hermosillo',
  'Quintana Roo': 'America/Cancun',
}

/* -------------------------------------------------------------- estudios ---- */

type EstudioSeed = { clave: string; nombre: string; categoria: string; area: string; duracion: number; precio: number; capacidad: number }
/** Por categoría del portal: categoría y área de la base. `area` solo admite 4 valores (check de la base). */
const POR_CATEGORIA: Record<string, { categoria: string; area: string; duracion: number; precio: number }> = {
  Laboratorio: { categoria: 'laboratorio', area: 'laboratorio', duracion: 10, precio: 150 },
  Ultrasonido: { categoria: 'imagen', area: 'ultrasonido', duracion: 30, precio: 450 },
  Mastografía: { categoria: 'imagen', area: 'mastografia', duracion: 20, precio: 550 },
  'Rayos X': { categoria: 'imagen', area: 'rayos_x', duracion: 15, precio: 300 },
  // la base no tiene área propia para estos: se atienden como laboratorio (toma de muestra / consultorio)
  Papanicolaou: { categoria: 'ginecologia', area: 'laboratorio', duracion: 20, precio: 250 },
  Lentes: { categoria: 'optometria', area: 'laboratorio', duracion: 30, precio: 200 },
}
const slug = (s: string) => normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase()

const estudios: EstudioSeed[] = Object.entries(STUDIES).flatMap(([cat, nombres]) => {
  const c = POR_CATEGORIA[cat]
  if (!c) throw new Error(`Categoría del portal sin equivalencia: ${cat}`)
  return nombres.map((nombre) => ({
    clave: `P-${slug(nombre)}`, nombre, categoria: c.categoria, area: c.area, duracion: c.duracion, precio: c.precio,
    capacidad: c.categoria === 'imagen' ? 2 : 10,
  }))
})

/* --------------------------------------------------------------- armado ---- */

const clave = (c: ClinicaDato) => `SD-${String(c.id).padStart(3, '0')}`

// Dos sucursales con el mismo nombre normalizado empatarían a la misma clínica en catalogo.ts.
const vistos = new Map<string, string>()
for (const c of CLINICAS_DATOS) {
  const n = normalizar(c.name)
  if (vistos.has(n)) throw new Error(`Nombre repetido: "${c.name}" (${vistos.get(n)} y ${clave(c)})`)
  vistos.set(n, clave(c))
}

let sinHorario = 0
let sinLeer = 0
const filasHorario: string[] = []
for (const c of CLINICAS_DATOS) {
  let h = leerHorario(c.horario)
  if (!c.horario.trim()) { h = HORARIO_POR_OMISION; sinHorario++ }
  else if (!h.lun_vie) { h = { ...HORARIO_POR_OMISION, ...h }; sinLeer++ }
  for (const [grupo, tramo] of Object.entries(h) as [keyof typeof DIAS_SEMANA, Tramo][]) {
    for (const d of DIAS_SEMANA[grupo]) filasHorario.push(`(${q(clave(c))},${d},'${tramo.abre}','${tramo.cierra}')`)
  }
}

const lineas: string[] = []
lineas.push(`-- =====================================================================
-- Catálogo REAL del portal (GENERADO: no editar a mano).
--   Fuente: saluddigna-interfaz/src/data/clinicasData.ts y src/data/studies.ts
--   Regenerar: en saluddigna-interfaz, \`npm run seed-catalogo\`
--
-- SOLO DESARROLLO / DEMO. Se carga DESPUÉS de seed.sql (necesita sus 6 estudios para no duplicarlos).
-- No está en supabase/config.toml a propósito: las pruebas pgTAP (110_catalogo, 120_horarios…)
-- cuentan 6 estudios y 3 clínicas. Para activarlo, ver el README ("Catálogo real del portal").
--
--   · ${CLINICAS_DATOS.length} clínicas con su nombre del portal (catalogo.ts empareja por nombre), claves SD-<id>.
--   · ${estudios.length} estudios del portal; los que ya existen en seed.sql (mismo nombre) no se duplican.
--   · Cada clínica ofrece todos los estudios (el portal no distingue; no hay dato real).
--   · Horarios reales de cada sucursal, un turno cada 30 min. Domingo sin renglón = cerrado.
--   · PRECIOS DE EJEMPLO (la base exige monto > 0). El portal no los muestra ("Precio según tu clínica").
-- =====================================================================
`)

lineas.push('-- Clínicas')
lineas.push('insert into core.clinicas (clave, nombre, ciudad, estado, direccion, zona_horaria) values')
lineas.push(CLINICAS_DATOS.map((c) => `  (${q(clave(c))}, ${q(c.name)}, ${q(c.ciudad || c.name)}, ${q(c.estado)}, ${q(c.address)}, ${q(ZONA[c.estado] ?? 'America/Mexico_City')})`).join(',\n'))
lineas.push('on conflict (clave) do nothing;\n')

lineas.push('-- Estudios (area: laboratorio | ultrasonido | rayos_x | mastografia)')
lineas.push('insert into core.estudios (clave, nombre, categoria, area, duracion_min, precio_base)')
lineas.push('select v.clave, v.nombre, v.categoria, v.area, v.duracion_min, v.precio_base')
lineas.push('from (values')
lineas.push(estudios.map((e) => `  (${q(e.clave)}, ${q(e.nombre)}, ${q(e.categoria)}, ${q(e.area)}, ${e.duracion}, ${e.precio}.00)`).join(',\n'))
lineas.push(') as v(clave, nombre, categoria, area, duracion_min, precio_base)')
lineas.push('where not exists (select 1 from core.estudios e where e.nombre = v.nombre)')
lineas.push('on conflict (clave) do nothing;\n')

lineas.push('-- Qué estudios ofrece cada clínica del portal (imagen: 2 por horario; laboratorio y demás: 10)')
lineas.push(`insert into core.clinica_estudios (clinica_id, estudio_id, capacidad_por_horario)
select c.id, e.id, case when e.categoria = 'imagen' then 2 else 10 end
from core.clinicas c
cross join core.estudios e
where c.clave like 'SD-%'
  and e.nombre in (${estudios.map((e) => q(e.nombre)).join(', ')})
on conflict (clinica_id, estudio_id) do nothing;\n`)

lineas.push('-- Horarios de atención (dia_semana: 0 = domingo … 6 = sábado)')
lineas.push('insert into core.horarios_clinica (clinica_id, dia_semana, abre, cierra)')
lineas.push('select c.id, v.dia, v.abre::time, v.cierra::time')
lineas.push('from (values')
lineas.push(filasHorario.map((f) => `  ${f}`).join(',\n'))
lineas.push(') as v(clave, dia, abre, cierra)')
lineas.push('join core.clinicas c on c.clave = v.clave')
lineas.push('on conflict (clinica_id, dia_semana) do nothing;')

writeFileSync(SALIDA, lineas.join('\n') + '\n')
console.log(`Escrito ${SALIDA}`)
console.log(`  ${CLINICAS_DATOS.length} clínicas · ${estudios.length} estudios · ${filasHorario.length} renglones de horario`)
console.log(`  ${sinHorario} sucursales sin horario publicado (se usó el de seed.sql) · ${sinLeer} con horario sin lunes a viernes legible`)
