# Prototipo omnicanal · Salud Digna (HackaTec Nacional)

## Qué es
Portal web del paciente para el reto "Un paciente, una sola conversación". El jurado lo opera en vivo:
todo botón debe hacer algo visible y el flujo debe resistir interrupciones y cambios de canal.
Stack: React 19 + Vite + Tailwind 4 + TypeScript. Datos simulados (no hay APIs reales).

## Comandos
- `npm install` · `npm run dev` · `npm run build` (debe pasar sin errores antes de terminar cualquier tarea)
- `npm run tipos` (`tsc --noEmit`) para revisar tipos (`vite build` no los revisa).
- `npm run probar` para las pruebas de `src/api/` (no necesitan base de datos).

## Dos modos: local y api (ver CONEXION.md)
El portal corre con datos simulados (`VITE_MODO=local`, por omisión) o conectado al orquestador
omnicanal en Supabase (`VITE_MODO=api`, repo `eduardomv2/hackathon-puebla`). **CONEXION.md explica
el enlace completo y lo que falta**; lo imprescindible al tocar código:
- `src/api/api.ts` y `src/api/database.types.ts` son COPIAS del backend: no editarlos aquí.
- Para saber el modo, importar `./api/modo`, NUNCA `./api/cliente`: `cliente.ts` arrastra Supabase
  (~66 kB comprimidos) y debe quedar en su trozo diferido. Revisar el tamaño de `index-*.js`.
- El trámite de `src/state/tramite.ts` sigue siendo la fuente de la interfaz. Toda la escritura
  pasa por `commit` en `App.tsx`: ese es el único punto de enganche con el orquestador.
- El modo `local` no debe romperse nunca: es el respaldo si el backend falla en la presentación.

## Estructura
- `src/App.tsx`: estado global (sesión del personal, vista, clínica, trámite) y contexto `useApp`.
  EL PACIENTE NO TIENE CUENTA: usa todo el portal sin iniciar sesión (no hay usuario de prueba de paciente).
  "Iniciar sesión" (esquina superior derecha; "Entrar" por debajo de 1280 px) es solo para el personal: Asesor y
  Administrador, que ven `StaffHeader` + `views/Asesor`.
- Agendado en 4 pasos (`TOTAL_PASOS`): Estudio, Clínica, Fecha y hora, Pago. En el paso 4 se piden los "Datos del
  paciente": nombre y teléfono celular (10 dígitos, obligatorio, con formato 667 123 4567). El trámite se identifica
  por su FOLIO (`id`, p. ej. SD-MX…); el asesor busca por folio, nombre o teléfono (bastan los últimos 4 dígitos) y ve
  el teléfono en la ficha. No hay cuenta de paciente.
- Persistencia: el trámite EN CURSO se conserva (localStorage) para retomarlo tras una interrupción; una cita YA
  CONFIRMADA no se conserva al cerrar y volver a abrir la página (`loadTramiteAlAbrir`; el respaldo es el PDF).
  La sincronización entre pestañas sigue usando `loadTramite` para ver la confirmación en vivo.
- Mis trámites (paciente) NO muestra historial; la línea de tiempo es solo para el asesor.
- Fecha y hora: `SelectorHorario`. Calendario de 6 semanas fijas: los días de otros meses y los días sin lugar se
  ven atenuados y no se pueden elegir; solo los días disponibles son botones. Horarios: campo "Hora de la cita" que
  abre una LISTA desplegable (role="listbox") con los horarios libres uno debajo de otro (~5 visibles, con scroll
  propio); al elegir se cierra; teclado: flechas, Inicio/Fin, Enter, Escape. El cartel "Tu cita" va debajo del campo.
  La opción activa se desplaza dentro de la lista (no la página). En teléfono, al tocar un día la vista baja al campo.
  Nunca permite fechas u horas pasadas (`yaPaso`). La hora se GUARDA en 24 h ("13:30") y se MUESTRA en 12 h con AM/PM
  ("01:30 PM") con `fmtHora` en todos lados (horarios, resumen, tarjeta, asesor, pagos, PDF).
- Clínicas: `data/clinicasData.ts` (GENERADO: 261 sucursales reales de las páginas públicas de salud-digna.org, con
  estado, ciudad, dirección, teléfono, coordenadas y horario; no editar a mano ni inventar clínicas) y
  `data/clinics.ts` (búsqueda y distancias). `components/BuscadorClinica`: estado, ciudad, sucursal y
  "Usar mi ubicación" (geolocalización real; si no se comparte, ubicación de ejemplo en Culiacán) AL PRINCIPIO.
  Con ubicación (y sin otros filtros) la lista y el mapa muestran SOLO las cercanas: a `RADIO_KM` (30 km) o menos; si
  no hay ninguna tan cerca, las 5 más cercanas, y el texto lo explica.
  Sin paginar: la lista muestra todas las coincidencias del filtro y SOLO esas (no se fija la clínica elegida).
  Paso 2: "Aún no lo decido" arriba a la derecha; escritorio: lista agrupada por ciudad (con su propio scroll) junto
  al mapa; teléfono: conmutador Lista / Mapa. Lo usan el paso 2 del agendado y `ClinicSheet` (también el asesor).
  `ClinicSheet` (panel lateral): encabezado fijo y UN solo scroll (filtros compactos + conmutador Lista / Mapa en todo
  ancho), para que el mapa nunca se encime a la lista.
- Mapa: `components/MapaClinicas` (Leaflet + mosaicos de OpenStreetMap, sin clave; atribución obligatoria) muestra todas
  las coincidencias del buscador; tocar un punto elige la clínica. Se carga diferido con `MapaDiferido` (no pesa en el
  inicio) y, si no se puede descargar, avisa y la lista sigue funcionando. Sin animaciones de zoom/encuadre: Leaflet
  falla si se desmonta a mitad de una animación. La rueda del ratón NO hace zoom hasta hacer clic o enfocar el mapa (así la rueda
  desplaza la página/lista); se apaga al salir el puntero o perder el foco. En pruebas automatizadas, `tile.openstreetmap.org` se sirve con una imagen vacía.
- `src/components/`: piezas de interfaz (Header, StaffHeader, Cookies, ContinueCard, Search, Packages, Help, Footer, BottomNav, ClinicSheet, BuscadorClinica, MapaClinicas, MapaDiferido, SelectorHorario, Pwa, Tema, Icon, ui).
- `src/views/`: Entrar, Home, Agendar, Pay, Tramites, Resultados, Asesor (también la usa Administrador).
- `src/data/`: clinics, studies, packages.
- `src/state/tramite.ts`: tipo `Tramite`, persistencia en localStorage (`sd_tramite_activo`) y línea de tiempo de eventos.
  Los eventos `nota.interna` solo los ven Asesor/Administrador. Las pestañas se sincronizan con el evento `storage`.
- `src/state/sesion.ts`: roles del personal (asesor, admin) y credenciales de demostración (`sd_sesion` en localStorage +
  copia por pestaña en sessionStorage, para tener el portal y la vista del asesor abiertos a la vez). Una pestaña que
  se usa sin sesión queda marcada ("ninguna") y al recargar NO hereda la sesión del personal de otra pestaña.
- Pagos: `src/state/pasarela.ts` es una pasarela SIMULADA (tarjeta con verificación 3-D Secure, efectivo en tienda y
  SPEI) cuya respuesta imita un cargo real (id, estado, autorización), para reemplazarla por una integración real
  (con servidor y llave privada) sin tocar la interfaz. `views/Pay.tsx`: checkout por método. Tarjetas de prueba:
  4111…1111 y 5555…4444 aprobadas, 4000…3220 pide código 123456, 4000…0002 rechazada, 4000…9995 sin fondos.
  Nunca se guarda el número completo ni el CVV (solo marca y últimos 4); los campos tienen autocomplete="off".
  Los eventos del pago usan el canal `pasarela`. Pendiente por definir: liga de pago enviada por el asesor.
- Comprobante en PDF: `state/comprobante.ts` (jsPDF, cargado solo al pulsar el botón; no pesa en el inicio) y
  `components/BotonComprobante` ("Descargar comprobante (PDF)"), solo con la cita confirmada: en la confirmación,
  en Mis trámites y en la ficha del asesor. Incluye folio, nombre, estudio, clínica, fecha y hora, pago (solo marca y
  últimos 4) y contacto; dice que es un documento de demostración. La descarga se registra en la línea de tiempo.

## PWA
- `public/manifest.webmanifest` (íconos en `public/icons/`, atajos `?accion=agendar|tramites`) y `public/sw.js`.
- El service worker solo se registra en la versión compilada (`import.meta.env.PROD`), nunca en `npm run dev`.
  Precarga index.html y los archivos de `/assets/` que enlaza; navegación con red primero y respaldo en caché.
  Al cambiar `sw.js`, sube `VERSION` para que los clientes descarten la caché anterior.
- Probar: `npm run preview:pwa` (compila y sirve en la red local). Instalar requiere localhost o HTTPS.
- `components/Pwa.tsx`: aviso de conexión (en el flujo, no fijo) y botón "Instalar app" (solo si el navegador lo ofrece).

## Sistema visual (no cambiar sin pedirlo)
- Colores con nombre (src/index.css, `@theme`): usa SIEMPRE las clases con nombre, nunca hex sueltos:
  `text-titulo` #1F2933, `text-cuerpo` #43474A, `text-secundario` #5B6B7A, `text-enlace` #005BB0, `text-icono` #0074D9,
  `bg-accion` #0074D9 (hover `bg-accion-hover` #005BB0, activo `bg-accion-activo` #004480), `bg-superficie` (blanco),
  `bg-banda` #ECF3F9, `bg-resaltado` #EBF4FC, `bg-resaltado-2` #D6E4F5, `border-borde` #D6E4F5, `border-borde-accion`.
  Ámbar SOLO para pendiente (`bg-ambar`, `bg-ambar-fondo`, `text-ambar-texto`). Verde `text-verde` SOLO para
  confirmación final. Error `text-error`/`border-error`. Nunca gris plano.
- Modo oscuro: `data-tema="oscuro"` en <html> redefine esas variables (index.html lo fija antes de pintar según
  `sd_tema` o la preferencia del sistema; `components/Tema.tsx` lo alterna). Los rellenos de acción conservan su azul.
  El botón está en el encabezado (≥1280 px), en "Menú" (móvil), en el pie, en Entrar y en el encabezado del personal.
  El encabezado del portal va justo de ancho: sus botones no se envuelven (whitespace-nowrap); revisa 1024, 1280 y
  1440 px al agregarle algo. Únicas excepciones con color fijo: el aviso flotante (toast)
  y el fondo del panel de clínicas (#1F2933).
- Logo oficial: `components/LogoSaludDigna.tsx` (del archivo salud_digna.svg proporcionado, sin metadatos), en línea
  para que se vea sin conexión. Colores por variable: `--color-logo-verde` #008959, `--color-logo-gris` #868589 y
  `--color-logo-gris-2` #808082 (en modo oscuro se aclaran). `Logo` (Header.tsx) lo usa a 28 px de alto en teléfono y
  32 px desde 640 px, en el encabezado del portal, el del personal y Entrar.
- Tipografía: títulos Montserrat 700 (utilidad `font-head`); todo lo demás Open Sans.
  Escala ya definida en src/index.css: t-greeting, t-section, t-card, t-sub, t-body, t-meta.
- Estructura: un solo contenedor max-w-[1200px] px-4 lg:px-8; bandas de fondo a todo el ancho;
  máximo un nivel de tarjetas (nunca tarjeta dentro de tarjeta).
- Un solo botón primario relleno por vista. Secundarios: borde. Terciarios: enlace.

## Accesibilidad (obligatorio)
- Contraste AA, objetivos táctiles ≥48px, etiquetas visibles en campos, íconos siempre con texto.
- Anillo de enfoque: reglas en src/index.css; dentro de fondos oscuros usar la clase `on-dark`.
- Encabezados en orden lógico; barras de progreso con aria-valuenow/aria-valuetext;
  mensajes dinámicos con role="status".
- Cookies en el flujo de la página (nunca fijas ni modales).

## Datos reales (no inventar otros)
- Clínicas: directorio completo en `data/clinicasData.ts` (261 sucursales, 32 estados). La clínica inicial del
  portal es Culiacán (Ruperto L. Paliza #87, Col. Centro, (667) 712 60 83).
- WhatsApp +52 55 3956 6729 (asistente 24/7, asesores 7:00–21:00). Call Center 55 5554 7166.
- Paquetes reales: Integral mujer $630, Mastografía + densitometría $300, Mastografía + electro $320.
- Precios de estudios individuales: NO inventar; mostrar "Precio según tu clínica".
  Cualquier monto, referencia u horario simulado debe decir "de ejemplo" o "demo".

## Reglas de trabajo
- No romper lo que ya funciona: vistas home, pay, tramites, resultados, agendar; panel de clínicas; aviso de cookies.
- Cambios pequeños y verificables; textos de interfaz en español de México.
- Al terminar: `npm run build`, revisar que ningún enlace apunte a un id inexistente
  y que todo <button> tenga onClick. Resume qué cambió y qué quedó pendiente.

## Módulos (ver `modulos/README.md`)
- El portal del paciente vive en `src/`. Los módulos nuevos (p. ej. `modulos/call-center/`) van en su propia
  carpeta, con su propio `package.json`, y no tocan `src/`.
- Nunca se suben `.env` ni claves: solo `.env.example`. Las claves secretas no van en el navegador.
- Un módulo habla con el backend solo por la API pública con la clave publicable.
