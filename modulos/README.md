# Módulos

Cada módulo es una pieza con su propio código y sus propias dependencias, que se conecta al
mismo backend (Supabase, esquema `api`) que el portal. El portal del paciente vive en `src/` y
**no se mueve**: los módulos nuevos entran aquí, uno por carpeta, sin tocar `src/`.
Excepción acordada: la interfaz del call center vive en `src/call-center/` (carga diferida); su servidor, aquí.

| Carpeta | Qué es | Estado |
|---|---|---|
| `call-center/` | Módulo de call center: contestadora, fila de asesores y señalización de audio | integrado; falta probarlo contra la base real |

## Reglas para un módulo nuevo
1. Una carpeta por módulo, con su `README.md` (qué hace, cómo se corre, qué variables necesita).
2. Su propio `package.json`; el portal no depende de él ni al revés.
3. **Nunca** se suben `.env`, claves ni `node_modules`/`dist`. Se documentan en un `.env.example` sin valores.
4. Habla con el backend solo por la API pública (`supabase.rpc(...)` en el esquema `api`) con la clave
   **publicable**. Las claves secretas viven solo en servidores y Edge Functions, nunca en el navegador.
5. No edita `src/api/api.ts` ni `src/api/database.types.ts`: son copias del backend.
6. Antes de mezclar: que compile y pasen sus pruebas, y que el portal siga pasando
   `npm run tipos`, `npm run probar` y `npm run build`.
