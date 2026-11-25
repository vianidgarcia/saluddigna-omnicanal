# Publicar el portal

Portal en **Vercel** (`vercel.json`) y servidor de llamadas en **Render** (`render.yaml`). La base y el bot ya están en Supabase.

## 1. Portal en Vercel
Con GitHub: *Add New > Project*, elegir el repositorio y dejar la raíz. Sin GitHub: `npx vercel` y `npx vercel --prod` desde la raíz.

Variables (*Settings > Environment Variables*). Quedan dentro de la compilación: al cambiar una hay que volver a publicar.

| Variable | Valor |
|---|---|
| `VITE_MODO` | `api` (`local` = respaldo con datos simulados) |
| `VITE_SUPABASE_URL` | El de `.env.example` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | El de `.env.example` (es pública) |
| `VITE_CALL_CENTER_URL` | `wss://NOMBRE.onrender.com/ws` (después del paso 2; vacía = sin llamadas) |

No definir `VITE_SIMULADOR`. Nunca poner una clave secreta en una variable `VITE_`: todas llegan al navegador.

## 2. Llamadas en Render
*New > Blueprint* con este repositorio. Render pide:

| Variable | Valor |
|---|---|
| `SUPABASE_ANON_KEY` | La misma clave publicable |
| `CORS_ORIGIN` | `https://TU-PORTAL.vercel.app`, sin diagonal final (varios: separados por coma) |
| `SUPABASE_SERVICE_ROLE_KEY` | Opcional y SECRETA: solo aquí. Sin ella la contestadora no escribe en la base |
| `GROQ_API_KEY` | Opcional y SECRETA. Sin ella la contestadora usa su respaldo |

Comprobar `https://NOMBRE.onrender.com/health` y luego poner `VITE_CALL_CENTER_URL` en Vercel y volver a publicar.
Las direcciones de vista previa de Vercel no están en `CORS_ORIGIN`: prueba las llamadas en la de producción.

## 3. Backend
Quien administra Supabase cambia `pago_url_base` a `https://TU-PORTAL.vercel.app` para que las ligas de WhatsApp abran el portal.

## 4. Revisión
- Abrir directo `/citas`, `/tramite/SD-XXXX` y `/pagar/SD-XXXX`: no deben dar 404.
- Pedir celular en Inicio, agendar y ver la cita como asesor.
- Llamada entre dos dispositivos en redes distintas (solo hay STUN; si no hay audio falta un servidor TURN).
- Abrir `/health` unos minutos antes de presentar: el plan gratis duerme el servidor.
- Respaldo: `VITE_MODO=local` compilado en la laptop (`npm run preview:pwa`).
