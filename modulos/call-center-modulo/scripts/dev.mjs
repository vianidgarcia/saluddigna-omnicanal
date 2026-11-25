import { spawn } from 'node:child_process'

const procesos = [
  spawn('npm', ['--prefix', 'server', 'run', 'dev'], { stdio: 'inherit' }),
  spawn('npm', ['--prefix', 'web', 'run', 'dev'], { stdio: 'inherit' }),
]

const terminar = () => {
  for (const p of procesos) p.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', terminar)
process.on('SIGTERM', terminar)
