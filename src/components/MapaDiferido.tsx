import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'

/* El mapa (Leaflet) se descarga solo cuando se muestra: el inicio y el resto del portal no lo cargan.
   Si no se puede descargar (p. ej. sin conexión y sin haberlo abierto antes), se avisa y la lista sigue funcionando. */
const Mapa = lazy(() => import('./MapaClinicas').then((m) => ({ default: m.MapaClinicas })))
type Props = ComponentProps<typeof Mapa>

class SinMapa extends Component<{ alto: string; children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <p role="status" className={`grid w-full place-items-center rounded-lg border border-borde bg-banda px-4 text-center t-body text-titulo ${this.props.alto}`}>
        El mapa no está disponible en este momento (revisa tu conexión). Puedes elegir tu clínica en la lista.
      </p>
    )
  }
}

export function MapaClinicasDiferido(props: Props) {
  const alto = props.alto ?? 'h-72 lg:h-96'
  return (
    <SinMapa alto={alto}>
      <Suspense fallback={<div role="status" className={`grid w-full place-items-center rounded-lg border border-borde bg-banda t-meta text-secundario ${alto}`}>Cargando mapa…</div>}>
        <Mapa {...props} />
      </Suspense>
    </SinMapa>
  )
}
