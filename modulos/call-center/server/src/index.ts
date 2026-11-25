import { cargarConfig } from './config.js'
import { GroqClient } from './groqClient.js'
import { SupabaseBridge } from './supabaseBridge.js'
import { crearServidorCallCenter } from './wsServer.js'

const cfg = cargarConfig()
const bridge = new SupabaseBridge(cfg)
const groq = new GroqClient(cfg)
const { server } = crearServidorCallCenter({ cfg, bridge, groq })

server.listen(cfg.port, () => {
  console.log(`[call-center-server] Escuchando en http://localhost:${cfg.port} (WS: /ws)`)
  console.log(`[call-center-server] Supabase: ${cfg.supabaseUrl}`)
  console.log(`[call-center-server] Groq: ${cfg.groqApiKey ? `habilitado (${cfg.groqModel}, max ${cfg.groqMaxRpm} rpm)` : 'sin API key (respaldo local activo)'}`)
  if (!cfg.supabaseServiceRoleKey) {
    console.warn('[call-center-server] AVISO: Falta SUPABASE_SERVICE_ROLE_KEY en server/.env; configúrala para llamadas reales contra Supabase.')
  }
})
