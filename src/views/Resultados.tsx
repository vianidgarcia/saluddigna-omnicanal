import { useApp } from '../context'
import { Back } from '../components/Back'
import { container, link } from '../components/ui'

export function Resultados() {
  const { toast } = useApp()
  return (
    <div className={`${container} py-8 lg:py-12`}>
      <Back />
      <h1 className="mt-4 t-greeting font-head text-titulo">Mis resultados</h1>
      <p className="mt-4 max-w-xl t-body">Aún no tienes resultados. Te avisaremos por WhatsApp cuando estén listos.</p>
      <button onClick={() => toast()} className={`${link} mt-2`}>Ver preparaciones</button>
    </div>
  )
}
