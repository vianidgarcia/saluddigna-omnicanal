

export const STUDIES: Record<string, string[]> = {
  Laboratorio: ['Biometría hemática', 'Química sanguínea de 6 elementos', 'Perfil de lípidos'],
  Ultrasonido: ['Ultrasonido obstétrico', 'Ultrasonido abdominal', 'Ultrasonido pélvico'],
  Mastografía: ['Mastografía bilateral', 'Mastografía + ultrasonido mamario', 'Densitometría ósea'],
  'Rayos X': ['Rayos X de tórax', 'Rayos X de columna lumbar', 'Rayos X de extremidades'],
  Papanicolaou: ['Papanicolaou', 'Papanicolaou + prueba de VPH', 'Colposcopia'],
  Lentes: ['Examen de la vista', 'Lentes monofocales', 'Lentes bifocales'],
}
export const CHIPS = Object.keys(STUDIES)
/** Los estudios que se pueden elegir: todos, o solo los `disponibles` (modo api: los que la base tiene). Sin categorías vacías. */
export function estudiosOfrecidos(disponibles?: Set<string> | null): Record<string, string[]> {
  if (!disponibles) return STUDIES
  return Object.fromEntries(Object.entries(STUDIES).map(([c, n]) => [c, n.filter((x) => disponibles.has(x))]).filter(([, n]) => n.length))
}
export const categoriaDe = (nombre: string) => CHIPS.find((c) => STUDIES[c].includes(nombre)) ?? ''
