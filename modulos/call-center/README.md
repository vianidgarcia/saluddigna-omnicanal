# Módulo: call center

Servidor de llamadas: contestadora (Sofía), fila, timbre a los asesores y señalización del audio.
La interfaz vive en el portal (`src/call-center/`) y habla con este servidor por WebSocket.

## Correr
```bash
cd modulos/call-center/server
npm install
cp .env.example .env     # llenar SUPABASE_URL y SUPABASE_ANON_KEY
npm run dev              # http://localhost:4010/health
npm test && npm run typecheck
```
En el portal (`.env.local`): `VITE_MODO=api` y `VITE_CALL_CENTER_URL=ws://localhost:4010/ws`.

En **modo local** no hace falta nada de esto: se abren dos pestañas del portal (paciente y asesor), el asesor
pulsa "Recibir llamadas" y el paciente "Llamar desde aquí". Código demo: 123456.

## Correr con Supabase local (OTP simulado)
Requiere Docker. El backend es un clon de `hackathon-puebla` con `supabase/functions/.env` copiado de su ejemplo
(`MODO_SIMULADOR=true`, solo local).
```bash
# 1. backend (en su carpeta)
npx supabase start -x studio,imgproxy,logflare,vector,mailpit,postgres-meta,storage-api,supavisor
(cd simulador && npm ci && npm run usuarios)      # asesor@demo.mx / demo1234, solo la primera vez
# 2. servidor (modulos/call-center/server; .env.demo con URL y claves de `npx supabase status`)
DOTENV_CONFIG_PATH=.env.demo npm run dev          # PowerShell: $env:DOTENV_CONFIG_PATH='.env.demo'; npm run dev
# 3. portal (raíz; .env.demo.local con VITE_MODO=api y la URL local)
npm run dev -- --mode demo
```
Los códigos salen en el simulador del backend (`cd simulador && npm run dev`, ruta `/demo`). Sin ese modo, el portal
sigue usando `.env.local`.

## Variables
| Variable | Para qué |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Obligatorias |
| `SUPABASE_SERVICE_ROLE_KEY` | Opcional, **solo aquí**. Con ella la contestadora abre su interacción `ia` y guarda la conversación |
| `CORS_ORIGIN` | Orígenes del portal, separados por coma (`*` solo en desarrollo) |
| `GROQ_API_KEY` | Opcional. Se le envía lo que dice el paciente (sin códigos ni números largos) y sus folios/estudios, no el nombre de la ficha. Sin ella se usan reglas locales |
| `ENABLE_SERVER_TTS` | `false` por omisión: en `true` manda el texto hablado (incluye el nombre) a Edge TTS |

Sin clave de servicio: si hay asesor libre, el OTP se valida en su interacción; si no, Sofía solo toma teléfono
y motivo, y el asesor verifica al contestar.

## Qué usa de la base (esquema `api`, sin tablas nuevas)
| Momento | Función |
|---|---|
| Entra la llamada | `iniciar_contacto` (`ia` con servicio; `humano` con el JWT del asesor apartado) |
| Verificar | Edge Function `enviar-otp` o `solicitar_otp`; `validar_otp` |
| Transferir | `registrar_mensaje`, `cerrar_interaccion` |
| Atender (portal) | `obtener_contexto`, `retomar_tramite`, `iniciar_tramite`, `avanzar_tramite`, `reservar_cita`, `generar_pago` |
| Colgar | `cerrar_interaccion` (libera el trámite) |

El nivel de verificación es **por interacción**: si contesta otro asesor, se verifica de nuevo.

## Llamada directa y verificación
El paciente elige asesor directo (`call:start` con `directo`) o contestadora. Si al contestar no está verificado, el
servidor pide el OTP en la interacción del asesor y el paciente lo escribe (`call:otp`, máximo 5 intentos).
Sin envío de códigos (base sin SMS/WhatsApp) el expediente sigue cerrado: solo se ven folios y el borrador del portal.
`VITE_SIMULADOR=true` en `.env.demo.local` activa el celular y el pago simulados (solo con Supabase en localhost).

## Reglas de la fila
- Un asesor, una llamada. Timbra 45 s; si rechaza o no contesta pasa al siguiente y después se vuelve a ofrecer.
- Si el paciente cuelga, el asesor sigue capturando hasta "Terminar atención".
- La contestadora cuelga tras 3 minutos sin actividad. Recargar la página termina la llamada.
- La fila vive en memoria: una sola instancia; reiniciar el servidor corta las llamadas.

## Audio
WebRTC entre navegadores. El micrófono exige HTTPS (o localhost) y el servidor, `wss://`. Usa STUN público; sin
TURN puede fallar entre redes distintas y queda el chat de texto.

El protocolo está duplicado en `server/src/tipos.ts` y `src/call-center/tipos.ts`: cambiar los dos.
