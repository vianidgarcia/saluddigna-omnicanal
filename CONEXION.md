# Conexión del portal con el orquestador omnicanal

Este repositorio es el **portal del paciente y del personal**. El cerebro omnicanal (base de
datos, API, bot de WhatsApp y webhooks de pago) vive en
[`eduardomv2/hackathon-puebla`](https://github.com/eduardomv2/hackathon-puebla), sobre Supabase.

Los dos proyectos nacieron por separado, así que el portal funciona en **dos modos**. El modo lo
decide `VITE_MODO` en `.env.local`:

| | `local` (por omisión) | `api` |
|---|---|---|
| Dónde vive el trámite | `localStorage` de este navegador | Supabase, compartido con todos los canales |
| Quién crea el folio | el portal (`SD-` + marca de tiempo) | la base (`SD-4K7Q`) |
| Sincronización | evento `storage` entre pestañas | Realtime: WhatsApp, Call Center y clínica |
| Horarios y catálogo | datos de ejemplo del portal | los reales de la clínica |
| Pago | pasarela simulada | referencia y liga que genera la base |
| Login del personal | credenciales de demostración | cuentas reales de `core.staff` |
| Necesita backend | no | sí |

**El modo `local` sigue intacto.** Si el backend se cae a media presentación, el portal avisa con
un toast y continúa con el flujo simulado: para el jurado es mejor un portal que funcione solo que
una pantalla trabada. Lo mismo pasa si `VITE_MODO=api` pero faltan la URL o la clave.

## Encenderlo

1. Levantar el backend (ver su README): Supabase en la nube o `npx supabase start` en local.
2. En este repo:
   ```bash
   cp .env.example .env.local
   ```
   y poner en `.env.local`:
   ```
   VITE_MODO=api
   VITE_SUPABASE_URL=https://<ref>.supabase.co     # o http://127.0.0.1:54321 en local
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
   ```
   La clave **publicable** es pública y puede ir al navegador. La clave **secreta** nunca va aquí:
   lo que la necesita (enviar WhatsApp, confirmar pagos) pasa por las Edge Functions del backend.
3. `npm run dev`.

Para la demostración con el jurado conviene Supabase **hosteado**: con la base en una laptop el
portal solo funciona en esa red, y los webhooks de WhatsApp y de pagos necesitan una URL pública.

## Cómo está armado

```
src/api/
  modo.ts            en qué modo corre el portal. NO importa Supabase (ver "peso" abajo)
  cliente.ts         los clientes de Supabase: uno del paciente y otro del personal
  api.ts             COPIA de hackathon-puebla/simulador/src/api.ts — no editar aquí
  database.types.ts  COPIA generada por `supabase gen types` — no editar aquí
  mapa.ts            equivalencias entre los dos modelos (funciones puras, con pruebas)
  mapa.test.ts       `npm run probar`
  catalogo.ts        empareja nombres del portal con los uuid de la base
  orquestador.ts     el enlace del paciente: sesión, OTP, trámite, horario, pago, Realtime
  citas.ts           funciones de la guía que api.ts aún no trae
  personal.ts        el lado del asesor: login real, bandeja, búsqueda y recorrido
  useOrquestador.ts  el hook que usa App.tsx
src/components/
  VerificarCelular.tsx   OTP del celular (solo modo api)
  BandejaOmnicanal.tsx   bandeja del asesor con todos los canales (solo modo api)
```

El trámite del portal (`src/state/tramite.ts`) **sigue siendo el que pinta la interfaz**, para no
reescribir las vistas. `useOrquestador` lo espeja en la base y fusiona de vuelta lo que llega de
otros canales (`fusionarDesdeApi`), conservando lo que solo existe aquí: la línea de tiempo local,
el método de pago y los datos del formulario.

Toda la escritura pasa por `commit` en `App.tsx`. Ese es el único punto de enganche.

### Cuándo se crea el trámite

La base exige **nombre, apellido y celular verificado por OTP** antes de abrir un trámite, para que
nadie se apropie del historial de otro paciente. Por eso `Identificarse` los pide antes del paso 1 y cada
paso terminado se guarda (`guardarPaso` → `espejar`). Al confirmar se completa lo que falte y se genera el pago.
Sin conexión el portal sigue en local; si aún falta el celular al confirmar, aparece `VerificarCelular`.

### Peso del arranque

El cliente de Supabase son unos 66 kB comprimidos. Para no cargarlos en modo local, todo lo que lo
arrastra se importa con `import()` dinámico y queda en su propio trozo (`cliente-*.js`), igual que
el mapa y el generador de PDF. Por eso existe `modo.ts` aparte de `cliente.ts`: **quien solo
necesite saber el modo debe importar `./api/modo`, nunca `./api/cliente`.** Si se rompe esa regla,
Supabase vuelve al arranque sin que nadie lo note; se revisa con `npm run build` mirando el tamaño
de `index-*.js` (sin esto ≈136 kB comprimidos, con Supabase dentro ≈198 kB).

### Versiones y bloqueos

Cada escritura lleva la `version` del trámite. Si otro canal lo movió primero, la base responde
`PT409 conflicto_de_version`: el enlace recarga y reintenta una vez. Mientras un asesor o recepción
atiende el trámite, la base responde `PT423` y no deja cambiarlo; eso no es un error del portal, se
avisa al paciente y el trámite se puede ver pero no cambiar.

## Lo que falta decidir en equipo

1. ~~El catálogo no coincide.~~ **Resuelto con un seed generado.** `npm run seed-catalogo` lee
   `data/clinicasData.ts` y `data/studies.ts` y escribe
   `hackathon-puebla/supabase/seed-catalogo-real.sql`: las 261 clínicas (claves `SD-<id>`, mismo nombre
   que el portal), los 18 estudios (sin duplicar los 6 de `seed.sql`), `clinica_estudios` y los horarios
   reales de cada sucursal en `core.horarios_clinica`. Es idempotente y NO está en `config.toml`, porque
   las pruebas pgTAP (`110_catalogo`, `120_horarios`…) cuentan 6 estudios y 3 clínicas. Se carga a mano
   después de `db reset` o en un proyecto nuevo: `npx supabase db query --remote --yes -f supabase/seed-catalogo-real.sql`
   (o `--local`/el SQL Editor), desde la carpeta del backend. En hosteado NO se usa `seed.sql`. Los precios del seed son de ejemplo (la base exige
   monto > 0) y cada clínica ofrece todos los estudios, igual que el portal; no hay dato real de ninguno.
2. ~~Horarios.~~ **Resuelto.** En modo api `SelectorHorario` recibe `consultar` (viene de `horariosClinica`
   en el contexto, que usa `orq.horariosRango`) y solo ofrece lo que la base acepta. La base entrega
   máximo 14 días y 100 horarios por consulta, así que se pide por mes visible y por tramos. Si la base
   no responde o no conoce la clínica, el selector vuelve a los horarios de demostración y lo avisa; en
   modo local no cambia nada.
3. **Dos bots de WhatsApp.** El backend trae el suyo (`whatsapp-webhook` + `agente.ts`) y existe
   además [`IsraelCarry22/salud-digna-chatbot`](https://github.com/IsraelCarry22/salud-digna-chatbot),
   que conversa mucho mejor pero guarda en su propio `memoria.json`. Para que sea omnicanal de
   verdad, ese bot debería cambiar `store.js` y `agenda.js` por llamadas a las RPC de la API.
4. ~~Recepción de clínica.~~ **Resuelto.** `RecepcionClinica` (llegadas, turno, caja, atendida) y
   `AtencionCitas` (mostrador y teléfono). Falta agendar en mostrador para hoy (`p_inmediato`).
5. ~~Pago.~~ **Resuelto.** En modo api se paga con `pago-demo` (sin cargo) en `PagoApi` y en
   `/pagar/:referencia`. Al publicar, Eduardo registra la URL base para que `link_pago` deje de ser `null`.
   Sin conexión queda la pasarela simulada.
6. ~~Seguimiento entre canales.~~ **Resuelto.** El celular se verifica al inicio y cada paso se guarda en la base
   (`espejar` crea, corrige o adelanta el trámite), así que se retoma en WhatsApp y al revés.
7. **Catálogo:** la base publicada tiene 6 estudios; el portal solo ofrece los que coinciden.

## Llamadas (call center)

El paciente llama desde "¿Necesitas ayuda?", lo atiende la contestadora y la llamada le timbra a un asesor
disponible en la vista del personal. Interfaz en `src/call-center/`, servidor en `modulos/call-center/`
(ver su README). Modo local: BroadcastChannel entre pestañas, sin servidor. Modo api: `VITE_CALL_CENTER_URL`;
si falta, el portal lo avisa y ofrece el teléfono. `src/api/llamadas.ts` son las operaciones del asesor.

## Dar de alta al personal

En modo api el login usa Supabase Auth, no las credenciales de demostración. Para cada persona:
crear el usuario en Auth e insertarlo en `core.staff`; un trigger copia su rol al JWT. Los roles de
la base son `asesor`, `supervisor`, `admin` y `recepcion`; el portal los reduce a dos
(`asesor` y `admin`) en `aRolPortal`. La bandeja omnicanal (con búsqueda y recorrido) necesita rol
de supervisor o admin; al asesor no se le muestra.

## Probar el enlace de punta a punta

`npm run probar-enlace` corre el mismo flujo que hace la interfaz al confirmar una cita, sin
navegador ni React, usando los módulos de `src/api/`. Además mide los dos choques conocidos entre
los dos proyectos: cuántos estudios y clínicas del portal existen en la base, y cuáles de las horas
que ofrece `SelectorHorario` rechazaría la clínica.

Antes hay que levantar el backend local (en el repo `hackathon-puebla`):

```bash
npx supabase start
cd simulador && npm install && npm run usuarios   # crea el personal de prueba
```

y aquí poner en `.env.local` el modo api con la URL y la clave que da `npx supabase status`.
El script usa el número de prueba **866 123 4571** con OTP **123456**. Es re-ejecutable: si la
paciente de prueba ya tiene el trámite abierto lo dice y sigue; para empezar de cero,
`npx supabase db reset` en el backend.

## Antes de entregar

```bash
npm run tipos          # tsc --noEmit: vite build NO revisa tipos
npm run probar         # equivalencias (funciones puras, sin base de datos)
npm run probar-enlace  # flujo completo contra Supabase local
npm run build
```
