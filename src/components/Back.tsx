import { useApp } from '../context'
import { Icon } from './Icon'
import { link } from './ui'

export function Back() {
  const { go } = useApp()
  return <button onClick={() => go('home')} className={link}><Icon n="left" />Volver al inicio</button>
}
