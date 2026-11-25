# Módulo: call center

Aquí va el módulo de call center (servidor de agente de recepción + SDK web para el asesor).

## Estructura esperada
```
modulos/call-center/
  server/        servidor (Node/TypeScript): agente, voz, WebSocket
  web/           SDK web para el asesor (React): ventana de llamada, asistente de trámite
  scripts/       arranque de desarrollo
  README.md
```

## Para integrarlo
1. Copiar el código fuente **sin** `node_modules/`, `dist/` ni archivos `.env`.
2. Dejar un `server/.env.example` y un `web/.env.example` sin valores secretos; cada quien crea su `.env`.
3. Revisar que ninguna clave (por ejemplo del proveedor de IA o de voz) esté escrita en el código.
4. Documentar aquí cómo se corre y qué RPC de Supabase usa.

> Pendiente: definir con el equipo el contrato con el backend (qué funciones de `api` consume).
