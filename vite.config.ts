import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  base: process.env.FIGMA_PUBLIC_URL ? `${process.env.FIGMA_PUBLIC_URL}/` : '/',
  build: { sourcemap: mode === 'development' ? 'inline' : false },
  // solo el portal: los módulos de modulos/ tienen sus propias dependencias y no se escanean
  optimizeDeps: { entries: ['index.html'] },
  plugins: [react(), tailwindcss()],
  server: {
    port: process.env.FIGMA ? Number(process.env.PORT) : 5173,
    host: process.env.FIGMA ? (process.env.FIGMA_DEV_SERVER_HOST || '0.0.0.0') : undefined,
    strictPort: Boolean(process.env.FIGMA),
  },
}))
