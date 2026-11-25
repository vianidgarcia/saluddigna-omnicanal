# Guía para conectar la app/PWA de Salud Digna al orquestador omnicanal

> **Para quien la lee (humano o Claude Code):** esta guía describe TODA la lógica que ya existe en la base de
> datos y cómo usarla desde la app. La app **no tiene lógica de negocio propia**: pinta pantallas y llama a la API.
> Todo lo importante (cupos, reglas, verificación, pagos, duplicados, permisos) lo decide la base. Si una regla
> parece faltar en la app, casi seguro ya está en la base: **no la reimplementes, llama a la función**.
>
> Referencia viva y probada de todo lo que aquí se dice: la carpeta `simulador/` de este repositorio
> (`simulador/src/api.ts` = cliente de la API ya tipado; `simulador/src/ui/Tramite.tsx` = flujo del paciente;
> `simulador/src/paneles/*` = las consolas del personal). **Cuando dudes, copia cómo lo hace el simulador.**

## 0. Reglas de oro (léelas primero)

1. **Clave secreta jamás en la app.** La app solo usa la clave **publishable** (`sb_publishable_…`). La clave
   `service_role` / `sb_secret_…` solo vive en Edge Functions del servidor. Si ves que una app la necesita, está mal.
2. **No leas tablas.** Solo se expone el esquema `api`, y todo es **RPC con POST** (`supabase.rpc('nombre', args)`
   con `db: { schema: 'api' }`). Nunca `rpc(..., { get: true })`: da error `PT405`.
3. **No cambies la base de datos desde la app.** Si necesitas algo que la API no da, **dilo a Eduardo**: se hace
   con una migración nueva y su prueba pgTAP en el repo de la base. La app no crea tablas ni funciones.
4. **Decide por el campo `code` del error**, no por el texto ni solo por el HTTP (ver sección 6).
5. **Fechas:** la base devuelve ISO con zona (UTC). Muéstralas en la **zona horaria de la clínica**
   (`clinica.zona_horaria`, p. ej. `America/Mexico_City`, `America/Tijuana`). No uses la zona del dispositivo
   para horarios de citas.
6. **Concurrencia por versión:** los trámites tienen `version`. Siempre manda la versión que viste y, al
   responder, usa la `version` nueva. Si otro canal lo cambió, llega `PT409` (ver 6): recarga el contexto.

## 1. Conexión

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://bdkjkmynxaphqcnapmjk.supabase.co',
  'sb_publishable_wrZ4EDTapWIzEm9WMowSSg_GG653EUj',   // pública: va en la app
  {
    db: { schema: 'api' },
    // storageKey propio: no choques con otras sesiones (p. ej. la del personal en el mismo navegador)
    auth: { storageKey: 'sd-paciente', persistSession: true, autoRefreshToken: true },
  },
)
```

- Proyecto: **hackathon-omnicanal** en supabase.com (plan gratis). Es la base real de las pruebas: lo que haga la
  app lo ven también la web de pruebas, WhatsApp, el call center y la recepción.
- El proyecto "pausa" tras una semana sin uso en el plan gratis: si no responde, avisa a Eduardo.

## 2. Qué lleva la app y qué no

| Rol | ¿Va en la app móvil/PWA? | Dónde |
|---|---|---|
| **Paciente** | **Sí. Es lo único** | PWA / app |
| Asesor (call center) | No | Web de personal (`/personal`) |
| Recepción de clínica | No | Web de personal (`/personal`) |
| Supervisor / Admin | No | Web de personal (`/personal`) |

La **app del paciente no tiene login de personal.** Las secciones 7 en adelante documentan los roles de personal
para que la **web de personal** (o la sección de administración, si la hacen en la misma PWA con rutas separadas)
implemente la lógica completa. Si solo van a hacer la app del paciente, pueden saltar a la sección 9.

## 3. Paciente: flujo completo

### 3.1 Entrar (sesión anónima + contexto)

El paciente puede ver catálogo, precios, clínicas y horarios **sin cuenta**. Para eso basta una sesión anónima:

```ts
const { data: { session } } = await supabase.auth.getSession()
if (!session) await supabase.auth.signInAnonymously()

// Abre una "interacción" en el canal 'app' (en navegador normal usa 'web') y devuelve el CONTEXTO
const { data: ctx, error } = await supabase.rpc('iniciar_sesion_paciente', { p_canal: 'app' })
const interaccionId = ctx.sesion.interaccion_id   // guárdalo: casi todo lo pide
```

**Sesión huérfana:** si la base se reinicia, el token guardado puede apuntar a un usuario que ya no existe
(`User from sub claim in JWT does not exist`, `code: user_not_found`). Al arrancar valida con
`supabase.auth.getUser()`; si falla, `supabase.auth.signOut({ scope: 'local' })` y vuelve a entrar.

### 3.2 Catálogo y clínicas (público, sin verificar)

| Pantalla | Llamada | Notas |
|---|---|---|
| Lista de estudios | `catalogo_estudios({ p_busqueda?, p_categoria? })` | trae `id`, `nombre`, `preparacion`, `duracion_min`, `precio_base` |
| Elegir estado → ciudad | `ubicaciones_clinicas({ p_estudio_id? })` | `[{ estado, clinicas, ciudades:[{ciudad,clinicas}] }]` |
| Clínicas que hacen ese estudio | `clinicas_para_estudio({ p_estudio_id, p_estado?, p_ciudad?, p_busqueda?, p_lat?, p_lng?, p_limite? })` | con `p_lat`+`p_lng` ordena por cercanía y agrega `distancia_km` ("📍 Cerca de mí"); manda las dos o ninguna |
| Mapa / directorio | `directorio_clinicas({ ... mismos filtros })` | sin precio; trae `lat`, `lng`, `telefono`, `horario` (texto publicado) |
| Horarios libres | `horarios_disponibles({ p_clinica_id, p_estudio_id, p_desde?, p_dias? })` | `[{ fecha_hora, fecha, hora, disponibles }]`; 1–14 días; ya filtra cupo, horario de atención, días inhábiles y mínimo 1 h de anticipación |

- Son **261 clínicas reales** y 6 estudios de ejemplo. `fecha`/`hora` ya vienen en la zona de la clínica; usa
  `fecha_hora` (ISO) para reservar.
- La geolocalización del navegador (`navigator.geolocation`) solo funciona en **https o localhost**. Si el
  usuario la niega, ofrece escribir ciudad/estado.

### 3.3 Verificar el celular (obligatorio para agendar)

Ver catálogo es libre; **iniciar un trámite exige teléfono verificado** con un código OTP que llega **por
WhatsApp** (no por SMS; el respaldo por SMS no está configurado).

```ts
// Paso 1: pedir el código. phone en formato E.164 sin espacios: '+528661234567'
let modo: 'agregar' | 'iniciar_sesion' = 'agregar'
const r = await supabase.auth.updateUser({ phone })
if (r.error) {
  if (r.error.code === 'phone_exists' || /already been registered/i.test(r.error.message)) {
    // Ese número ya tiene cuenta: se inicia sesión con ella
    const l = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: false } })
    if (l.error) throw l.error
    modo = 'iniciar_sesion'
  } else throw r.error
}

// Paso 2: confirmar el código de 6 dígitos
const { error } = await supabase.auth.verifyOtp({
  phone, token: codigo, type: modo === 'agregar' ? 'phone_change' : 'sms',
})
if (error) throw error

// Paso 3: SIEMPRE volver a pedir el contexto: ahora la sesión es 'verificada'
const { data: ctx2 } = await supabase.rpc('iniciar_sesion_paciente', { p_canal: 'app' })
```

- **Números de prueba con código fijo `123456`** (no mandan nada, no necesitan chat abierto):
  `+528661234567`, `+528661234568`, `+528661234569`, `+528661234570`, `+528661234571`. Vigentes hasta 31/01/2027.
- **WhatsApp real:** el número de prueba de Meta **solo entrega a los celulares registrados en la app de Meta**
  (tres celulares del equipo: están en `docs/CREDENCIALES_EQUIPO.md`, que Eduardo te pasa en privado) y solo si ese celular **escribió antes** al número de prueba de Meta
  (+1 555 138 0373) en las últimas 24 h. Si el código no llega: escribir "hola" a ese número y reintentar.
- Si dos sesiones anónimas esperan el mismo número, solo la última recibe el código (es esperado).
- Pon un temporizador de reenvío (~60 s) y un máximo de intentos en pantalla: Supabase Auth limita los envíos de código y responde con error de límite si se abusa.

### 3.4 Registro del titular

Antes del primer trámite hacen falta **nombre**, **apellido paterno** (el materno es opcional) y **celular
verificado**. El contexto lo dice en `ctx.sesion.requiere_registro` (arreglo; vacío = completo; valores
`nombre`, `apellido_paterno`, `celular_verificado`). Si falta algo, `iniciar_tramite` responde `22023`
`faltan_datos_titular` con `details.faltan`.

```ts
await supabase.rpc('guardar_datos_paciente', {
  p_interaccion_id: interaccionId, p_nombre: 'Ana', p_apellido_paterno: 'López', p_apellido_materno: 'García',
})
// Casilla "Acepto recibir avisos por WhatsApp" (solo con sesión verificada)
await supabase.rpc('registrar_consentimiento_avisos', { p_interaccion_id: interaccionId, p_acepta: true })
```

Sin consentimiento, el sistema **no** manda avisos proactivos por WhatsApp.

### 3.5 Agendar: el trámite (máquina de estados)

Un **trámite** = una intención de estudio, con **folio** (`SD-4K7Q`) y **etiqueta** ("Mastografía · para ti").
Conviven **varios** a la vez. Pasos (`paso_actual`):

```
seleccion_clinica ──► seleccion_horario ──► pago ──► confirmada
        (iniciar_tramite lo crea aquí, ya con estudio)   (la deja el pago acreditado)
```

| Acción | Llamada | Resultado |
|---|---|---|
| Empezar | `iniciar_tramite({ p_interaccion_id, p_estudio_id, p_beneficiario_id? })` | trámite en `seleccion_clinica` (el estudio es **obligatorio**). `PT409 tramite_duplicado` si esa persona ya tiene ese estudio abierto: ofrece continuar el existente (`details` trae folio) |
| Elegir clínica | `avanzar_tramite({ p_interaccion_id, p_tramite_id, p_version, p_paso: 'seleccion_horario', p_datos: { clinica_id } })` | `p_datos` solo acepta `estudio_id`, `clinica_id`, `beneficiario_id` |
| Apartar horario | `reservar_cita({ p_interaccion_id, p_tramite_id, p_version, p_fecha_hora })` | paso → `pago`. Si cambias de hora, la cita anterior sin pagar se cancela sola |
| Generar pago | `generar_pago({ p_interaccion_id, p_tramite_id, p_version })` | devuelve `referencia`, `monto`, `link_pago`, `expira_en`, `version` |
| Volver a cambiar horario | `avanzar_tramite(..., p_paso: 'seleccion_horario')` desde `pago` | permite elegir otro |
| Retomar uno pendiente | `retomar_tramite({ p_interaccion_id, p_tramite_id })` | la sesión sigue con ese trámite |

Reglas que ya aplica la base (no las dupliques):
- Cupo por horario (`PT409 horario_sin_cupo`) y horario de atención (`22023 horario_fuera_de_atencion`).
- Máximo **5 citas futuras** por titular: `reservar_cita` responde HTTP 409 con cuerpo
  `{"error":"limite_citas","citas_futuras":5}` (no es excepción normal; revisa `data.error`).
- Mismo estudio + misma persona con otro trámite o cita futura: `PT409 tramite_duplicado` / `cita_duplicada`.
- El trámite vence a las 72 h sin actividad (`expira_en`); sin estudio a las 24 h se cancela.
- Máximo 10 beneficiarios por titular.

El **contexto** (`ctx`) trae `tramite_activo` (con el que trabaja esta sesión) y `tramites_abiertos`
(todos, recientes primero). Al abrir la app, si hay pendientes, muéstralos: "Tienes pendiente: Mastografía ·
para ti, eligiendo clínica" y botón **Continuar** (`retomar_tramite`) o **Empezar otro**.

### 3.6 Familiares (beneficiarios)

Se puede agendar **para otra persona** (hijo, madre…). La cita es del titular, la atiende el beneficiario.

```ts
await supabase.rpc('agregar_beneficiario', {
  p_interaccion_id, p_nombre, p_apellido_paterno, p_apellido_materno, p_fecha_nacimiento: '2015-03-02',
  p_sexo: 'F', p_relacion: 'hija', p_es_tutor_legal: true,
})
const { data: familia } = await supabase.rpc('mis_beneficiarios', { p_interaccion_id })
// luego: iniciar_tramite({ ..., p_beneficiario_id })
```
`relacion`: `hijo`, `hija`, `madre`, `padre`, `conyuge`, `otro` (y `titular` = ella misma).

### 3.7 Pagar

**No hay pasarela real.** Está activo el **pago de prueba** (sin cargo):

```ts
// 1) Pagos que puede pagar este paciente (referencia, monto, estudio, para quién, folio, vence)
const { data: pendientes } = await supabase.rpc('pagos_pendientes', { p_interaccion_id })
// 2) Pagar (Edge Function; usa la sesión del paciente; pagar dos veces responde igual con repetido: true)
const { data, error } = await supabase.functions.invoke('pago-demo', {
  body: { interaccion_id: interaccionId, referencia: pendientes[0].referencia },
})
// 3) Recarga el contexto: la cita pasa a 'confirmada' y el trámite a 'completado'
```

- **Link de pago:** `link_pago = <pago_url_base>/pagar/<referencia>`. Mientras la app no esté publicada es
  `null`. **Cuando publiquen la PWA**, Eduardo registra la URL base en la base y la app debe atender la ruta
  **`/pagar/:referencia`**: busca esa referencia en `pagos_pendientes` y muestra el botón de pago. Esa ruta es
  la que abre el link que llega por WhatsApp.
- Un pago vence a las 24 h o 1 h antes de la cita (lo que ocurra primero). Si venció, genera otro
  (`generar_pago`).
- El paciente también puede pagar respondiendo **PAGAR** por WhatsApp, o **en caja** en la clínica
  (recepción cobra). Lo ves reflejado en tiempo real.

### 3.8 Mis citas: ver, cambiar, cancelar

`ctx.citas_proximas` (con sesión verificada) trae por cita: `id`, `fecha_hora`, `estado` (`reservada`,
`confirmada`, `en_clinica`), `estudio`, `clinica`, `precio`, `folio`, `beneficiario`, `turno`/`area` (si ya llegó),
y `clinica_id`, `estudio_id`, `pagada`.

```ts
// Cancelar (si estaba pagada, el pago queda 'reembolsado'; si no, el link expira y el trámite abierto se cancela)
const { data } = await supabase.rpc('cancelar_cita', { p_interaccion_id, p_cita_id, p_motivo: 'ya no puedo' })
// → { cita_id, estado: 'cancelada', reembolso: boolean, folio }

// Cambiar fecha/hora (misma clínica y estudio; conserva estado y pago)
//   1) horarios_disponibles({ p_clinica_id: cita.clinica_id, p_estudio_id: cita.estudio_id })
//   2) reprogramar_cita:
await supabase.rpc('reprogramar_cita', { p_interaccion_id, p_cita_id, p_fecha_hora: horario.fecha_hora })
```
Reglas: solo citas `reservada`/`confirmada` y futuras (`22023` si no); el nuevo horario ≥ 1 h en el futuro,
dentro del horario de atención, con cupo (`PT409 horario_sin_cupo`) y distinto del actual.
**Cambiar la clínica o el estudio = cancelar y agendar otra.**
**Recordar** `PT423` (ver 3.10): si un asesor/recepción tiene tomado el trámite, el paciente lo ve pero no lo cambia.

### 3.9 Tiempo real (obligatorio para sentirse "omnicanal")

Cuando algo cambia desde otro canal (pagó por WhatsApp, recepción cobró, el asesor movió la cita), la app debe
actualizarse sola. Se escucha un canal **Broadcast privado** del paciente:

```ts
await supabase.realtime.setAuth()
const canal = supabase.channel(`paciente:${ctx.paciente.id}`, { config: { private: true } })
  .on('broadcast', { event: '*' }, (m) => {
    // m.event === 'mensaje_nuevo' → llegó un mensaje (sin texto: está cifrado)
    // si no: m.payload = { evento_id, paciente_id, tramite_id, tipo_evento, canal, actor_tipo, ocurrido_en }
    //   canal === canal propio → ya lo sabes (lo hiciste tú). Otro canal → avisa "Desde WhatsApp: ..."
    refrescarContexto()   // vuelve a llamar obtener_contexto (debounce ~400 ms)
  })
  .subscribe()
// al salir: supabase.removeChannel(canal)
```
Los eventos más útiles: `tramite_iniciado`, `paso_avanzado`, `cita_reservada`, `pago_generado`,
`pago_confirmado`, `cita_confirmada`, `tramite_completado`, `cita_cancelada`, `cita_reprogramada`,
`cita_atendida`, `llegada_registrada`, `atencion_iniciada`, `atencion_liberada`.
Pantalla de ejemplo: `simulador/src/paneles/PanelPaciente.tsx`.

### 3.10 Convivencia con otros canales

- Mismo número = mismo paciente en web, app, WhatsApp, call center y clínica. Lo que empieza en WhatsApp
  aparece en la app (y al revés) en `tramites_abiertos`.
- **"El personal manda":** si un asesor o recepción toma un trámite, queda bloqueado para los demás canales
  ~10 min (se renueva con cada acción). Cualquier cambio da **`PT423 tramite_en_atencion`** con
  `details.canal` (`call_center` o `clinica`). La app debe **deshabilitar los botones** de ese trámite y mostrar
  "Te está atendiendo una persona…". `tramites_abiertos[i].en_atencion_de_otro` y `atencion_canal` lo anticipan.

## 4. El contexto (`ctx`) según el nivel de verificación

| Nivel | Se obtiene con | Qué trae `ctx` |
|---|---|---|
| `declarada` | Dato dictado (call center) | Solo: hay N trámites con folio y paso; `citas_proximas` con **solo** `id`, `folio`, `fecha_hora`, `estado` |
| `canal` | Sesión web anónima, WhatsApp, fecha de nacimiento | Trámites, mensajes, citas; datos enmascarados y nombre de pila |
| `verificada` | OTP, o cuenta con teléfono confirmado, o INE en mostrador | Todo, con nombre completo, ids y `pagada` en las citas |

El paciente de la app, tras el OTP del paso 3.3, es `verificada`. Si `ctx.sesion.requiere_verificacion` es `true`,
pídele verificar. Nunca muestres datos que el contexto no trae: el servidor ya recorta por nivel.

## 5. Datos de prueba

- Pacientes con código fijo `123456`: `+528661234567` … `+528661234571`. Están **sin registros**: créalos desde la
  app con nombres reales. (Si necesitan borrar los de prueba, pídelo a Eduardo.)
- Personal: `asesor@demo.mx`, `recepcion@demo.mx` (clínica **Puebla**, `PUE-CEN`), `clinica@demo.mx`
  (supervisión, Puebla), `admin@demo.mx`. **Las contraseñas y los celulares de WhatsApp están en `docs/CREDENCIALES_EQUIPO.md`** (no está en el repo: Eduardo te lo pasa en privado).
- Para probar de punta a punta con WhatsApp: ver la sección 3.3 (celulares registrados en Meta).

## 6. Errores: cómo reconocerlos y qué mostrar

Todo error de la API trae `code` (y `message`, `details`, `hint`). Decide por `code`:

| `code` | HTTP | Significa | Qué hacer en la app |
|---|---|---|---|
| `42501` | 401/403 | Sin permiso (rol, canal o nivel insuficiente) | Pide verificar identidad o vuelve a iniciar sesión |
| `PT404` | 404 | No existe (trámite, cita, pago…) | "No encontramos eso"; recarga el contexto |
| `22023` | 400 | Dato inválido (`horario_fuera_de_atencion`, `faltan_datos_titular`, "La cita ya pasó"…) | Muestra el `message`; con `faltan_datos_titular` abre el registro |
| `P0001` | 400 | Regla de negocio (saltarse pasos, trámite cerrado) | Recarga el contexto y vuelve al paso correcto |
| `PT409` | 409 | Conflicto: versión vieja, `horario_sin_cupo`, `tramite_duplicado`, `cita_duplicada` | `horario_sin_cupo`: "Ese horario se llenó", recarga horarios. Versión: recarga contexto. Duplicado: ofrece continuar el folio de `details` |
| `PT423` | 423 | Trámite tomado por personal | Deshabilita botones del trámite |
| `PT429` | 429 | Demasiadas solicitudes | "Espera un momento" y reintenta con espera |
| `PT405` | 405 | Llamaste por GET | Usa POST |
| `user_not_found` / "sub claim" | 401/403 | Sesión huérfana | `signOut({ scope: 'local' })` y reingresa |

Otros: `limite_citas` llega como `{ error: 'limite_citas' }` en el cuerpo (HTTP 409), no como excepción.
Límites por minuto: sin sesión 30, paciente 120. No hagas sondeo agresivo; usa tiempo real (3.9).
`simulador/src/api.ts` (`aErrorApi`) ya normaliza todos estos casos: cópialo.

## 7. Personal (web `/personal`): lógica por rol

Todo el personal entra con **correo y contraseña** (Supabase Auth). El rol y la clínica van en el JWT
(`user.app_metadata.rol` y `.clinica_id`); **la clínica ya viene asignada a la cuenta, no se elige al entrar**.
Guarda la sesión del personal con otro `storageKey` (`sd-personal`) que la del paciente y **ciérrala tras 30
minutos sin actividad**. Muestra el correo, el rol y, si tiene, el nombre de la clínica en el encabezado.

| Cuenta | Rol | Clínica | Pestañas |
|---|---|---|---|
| `asesor@demo.mx` | `asesor` | ninguna | Call center |
| `recepcion@demo.mx` | `recepcion` | **Puebla** | Llegadas de hoy, Mostrador |
| `clinica@demo.mx` | `supervisor` | Puebla | Supervisión |
| `admin@demo.mx` | `admin` | ninguna (ve todo) | Supervisión, Call center, Recepción |

### 7.1 Regla común: elegir la cita ANTES de verificar

Al atender a alguien (call center o mostrador) el orden es:

1. Escribir el celular → `iniciar_contacto({ p_canal: 'call_center' | 'clinica', p_telefono, p_agente: 'humano' })`.
   La sesión empieza **`declarada`** y el contexto trae **solo** `citas_proximas` con folio, fecha y estado.
2. Mostrar "Citas del paciente (N)" con folio/fecha/estado y botón **Elegir**. No muestres estudio ni nombre.
3. **Verificar identidad:**
   - Call center: fecha de nacimiento (`verificar_identidad`) → sube solo a `canal`; **OTP**
     (`enviar-otp` Edge Function + `validar_otp`) → `verificada`. Pedir el código **al paciente**; el asesor solo
     ve el teléfono enmascarado.
   - Mostrador: identificación oficial → `verificar_presencial({ p_interaccion_id, p_tipo_documento })` →
     `verificada`. **Solo se guarda el tipo de documento, nunca su número.**
4. Con la sesión verificada, la cita elegida muestra su detalle y **acciones** (7.2).
5. Al terminar: `cerrar_interaccion` (libera los trámites que tenía tomados).

### 7.2 Acciones sobre la cita elegida (ya verificada la identidad)

Funcionan **aunque el trámite ya esté cerrado** (cita pagada):

| Acción | Llamada | Quién | Reglas |
|---|---|---|---|
| Cambiar fecha u hora | `horarios_disponibles` → `reprogramar_cita({ p_interaccion_id, p_cita_id, p_fecha_hora })` | asesor, recepción, admin | cita `reservada`/`confirmada`, futura; horario ≥ 1 h; con cupo |
| Cobrar en caja | `cobrar_en_caja({ p_cita_id, p_metodo: 'efectivo' \| 'tarjeta' })` | **recepción de esa clínica**, supervisor, admin | cita no pagada (`reservada` o `en_clinica`). Usa el link de pago pendiente si existe; si no, crea uno `CJ-…`. Deja cita `confirmada` (o `en_clinica`), trámite completado y evento `pago_confirmado` con `canal=clinica` y método. No se cobra dos veces (`P0001`). **Recepción no cobra citas de otra sucursal** (`42501 Fuera del alcance de tu clínica`): muestra "Esta cita es en <clínica>: se cobra allá o el paciente paga en línea" y **oculta el botón** |
| Cancelar cita | `cancelar_cita({ p_interaccion_id, p_cita_id, p_motivo })` | asesor, recepción, admin | si estaba pagada → reembolso marcado |
| Tomar un trámite abierto | `retomar_tramite` | asesor, recepción | lo **bloquea** a otros canales (10 min, se renueva con cada acción; `PT423` a otro personal) |
| Avanzar un trámite abierto | `avanzar_tramite`, `reservar_cita`, `generar_pago` | asesor, recepción | igual que el paciente, en su nombre. En nube, el pago "de prueba" lo hace el paciente (PAGAR / app), no el asesor |

### 7.3 Recepción (rol `recepcion`, siempre con `clinica_id`)

- Solo ve y opera **su clínica**. `admin` elige clínica con un selector (directorio de 261).
- **Llegadas de hoy:** `agenda_clinica({ p_clinica_id, p_fecha })` → por cita: hora, paciente (el beneficiario),
  estudio, área, folio, `estado`, `turno`, `pagada`, `preparacion`.
  - **Registrar llegada** (`registrar_llegada({ p_cita_id, p_tipo_documento, p_cumplio_preparacion })`): solo
    citas de **hoy** y de su clínica; verifica la identificación de quien recibe el estudio; cita → `en_clinica`;
    asigna **turno por área** (`A-001` laboratorio, `U-` ultrasonido, `R-` rayos X, `M-` mastografía); responde
    `indicacion`: "Pasar a caja" (si no ha pagado) o "Pasar a <área>"; avisa si no cumplió la preparación.
  - **Cobrar en caja** (7.2) para quien no pagó.
  - **Marcar atendida** (`marcar_atendida({ p_cita_id })`): solo `en_clinica` → `atendida`.
- **Mostrador:** `iniciar_contacto('clinica', tel, 'humano')` → INE → mismas acciones de 7.2, y puede agendar
  **para hoy** (`horarios_disponibles({ ..., p_inmediato: true })`, incluye el horario en curso).

### 7.4 Asesor (call center, sin clínica)

Flujo 7.1 por **teléfono**: busca, elige la cita, verifica (fecha de nacimiento / OTP), opera (7.2). Ve el
resumen del trámite generado por IA, la línea de tiempo y **los mensajes de WhatsApp en vivo** (solo lectura)
mientras atiende (canal Broadcast `paciente:<id>`, solo lo puede escuchar quien tiene la interacción abierta).

### 7.5 Supervisor y admin

- **Bandeja de atención** (`bandeja_atencion({ p_clinica_id?, p_categoria?, p_limite?, p_cursor?, p_canal?,
  p_estado?, p_desde?, p_hasta? })`): sin `p_categoria` solo conteos; con categoría, lista paginada (máx. 50).
  Categorías: `atorados` (sin actividad > 2 h), `pago_por_vencer` (< 2 h), `en_atencion` (tomados por personal
  ahora), `seguridad` (fallos de verificación 24 h), `llegadas_hoy`. Un supervisor con clínica ve solo la suya.
- **Buscar paciente** (`buscar_pacientes({ p_texto })`): por folio (`SD-4K7Q`), celular (últimos 10 dígitos) o
  nombre; mínimo 3 caracteres. Queda en bitácora de lecturas.
- **Journey** (`journey_paciente({ p_paciente_id })`): todo lo que hizo el paciente en todos los canales.
- **Métricas** (`metricas({ p_desde, p_hasta, p_clinica_id? })`): comparado con el año anterior
  (`actual`, `anio_anterior`, `variacion_pct`).
- **Tiempo real global:** canal `journey:global` (solo supervisor/admin).
- **Trámites en curso** (`tramites_en_curso({ p_clinica_id?, p_paso?, p_limite? })`).

## 8. Funciones que existen pero NO se usan en la interfaz

- `solicitar_agente` / `solicitudes_agente`: "Hablar con una persona". Se quitó de la interfaz web porque el
  paciente ya gestiona sus citas solo. Siguen en la base; no las muestres.

## 9. PWA: recomendaciones

- **Sesión:** `persistSession: true` + `autoRefreshToken: true`. Al arrancar: `getSession` → `getUser` (valida)
  → `iniciar_sesion_paciente`. Si no hay sesión: `signInAnonymously`.
- **Offline / service worker:** puedes cachear estáticos y, si quieres, `catalogo_estudios`/`directorio_clinicas`
  (cambian poco). **No caches** `obtener_contexto`, `horarios_disponibles`, `pagos_pendientes` ni nada de pago/sesión.
  Sin red, muestra "Sin conexión" y bloquea acciones que escriben.
- **Rutas:** `/pagar/:referencia` (obligatoria cuando se publique), y conviene `/citas` y `/tramite/:folio`.
- **Geolocalización** solo con https. **Instalación:** manifest + iconos; en iOS se instala desde Safari.
- **Avisos:** el paciente recibe avisos por WhatsApp (si dio consentimiento). No hay notificaciones push propias.
- **Accesibilidad / móvil:** objetivos táctiles ≥ 44 px, fechas con día de la semana, dinero con `Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })`.

## 10. Lo que NO existe todavía

- Pasarela de pago real (hay pago de prueba sin cargo). Cuando exista, cambia la Edge Function, no la app.
- PDF de confirmación de pago y cita (pendiente).
- SMS como respaldo del código de WhatsApp (falta cuenta del proveedor).
- Recordatorio de cita (el día antes): solo existe el aviso de "trámite pendiente" a las 2 h sin actividad.
- Resultados de estudios (el bot da un enlace, no hay API de resultados).

## 11. Checklist de validación de la app (pruébala contra supabase.com)

**Paciente**
1. Abrir sin cuenta: ver estudios y clínicas con filtros por estado, ciudad y "Cerca de mí".
2. Intentar agendar sin verificar → pide celular y OTP. Con `+528661234567` y `123456` queda verificada.
3. Registrar nombre y apellido; sin ellos `iniciar_tramite` da `faltan_datos_titular`.
4. Agendar completo: estudio → clínica → horario → pago → pagar (prueba) → cita **confirmada** y trámite completado.
5. Cerrar la app a medio trámite y volver: aparece "Tienes pendiente" y se retoma.
6. Agendar el mismo estudio dos veces → `tramite_duplicado` con opción de continuar el folio existente.
7. Agendar para un familiar y verlo con "para <nombre>".
8. Apartar un horario y que otro canal lo llene → `horario_sin_cupo` y recargar horarios.
9. Cambiar fecha y cancelar (con y sin pago); ver el reembolso marcado.
10. Escribir "hola" por WhatsApp con ese número (si es uno de los registrados en Meta): lo hecho en la app
    aparece en el chat y viceversa, **sin recargar** la app (tiempo real).
11. Que el personal tome el trámite desde `/personal` → la app deshabilita los botones (`PT423`).
12. Probar sin red, con sesión vencida y con sesión huérfana.

**Personal**
13. Cada cuenta ve solo sus pestañas. Recepción con clínica Puebla: cita de otra clínica → aviso, sin botón de cobro.
14. Atender un número: sale la lista de citas con folio/fecha/estado **antes** de verificar; al verificar se abre
    el detalle con cambiar horario / cobrar en caja / cancelar.
15. Recepción: registrar llegada de una cita de hoy (turno e indicación), cobrar en caja y marcar atendida.
16. Supervisor: bandeja con conteos y listas, búsqueda por folio/celular/nombre, journey y métricas.

## 12. Cómo pedir cambios a la base

La base vive en este repositorio (`supabase/migrations`, pruebas en `supabase/tests/database`). Todo cambio es una
**migración nueva + prueba pgTAP**, y nunca se edita una ya aplicada. Si la app necesita un dato o una regla
nueva: describe qué pantalla, qué dato y qué regla, y pásaselo a Eduardo. No se toca la base desde la app.

Más detalle técnico (tablas de funciones, cifrado, límites, retención): `README.md`, secciones "Roles y vistas",
"Errores", "Límites de solicitudes", "Omnicanal en tiempo real".
