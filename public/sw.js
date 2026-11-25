/* Service worker del prototipo: permite instalar la app y usarla sin conexión.
   Estrategias: navegación → red primero (respaldo: index.html en caché);
   archivos propios → caché primero (Vite les pone hash); fuentes de Google → caché y actualización en segundo plano.
   Para forzar que todos reciban una versión nueva, cambia VERSION. */
const VERSION = 'sd-pwa-v4'
// ignoreVary: algunos servidores responden con `Vary: Origin` y los scripts con crossorigin no coincidirían en la caché
const MATCH = { ignoreVary: true }
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-64.png']

// Al instalar se guarda la app completa: el shell y los archivos con hash que index.html enlaza
// (así funciona sin conexión desde la primera visita, sin paso extra en la compilación).
async function precachear() {
  const c = await caches.open(VERSION)
  await c.addAll(SHELL)
  const html = await (await fetch('./index.html', { cache: 'no-store' })).text()
  const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => m[1])
  if (assets.length) await c.addAll(assets)
}

self.addEventListener('install', (event) => {
  event.waitUntil(precachear().then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const guardar = (req, res) => {
  if (res && (res.ok || res.type === 'opaque')) caches.open(VERSION).then((c) => c.put(req, res.clone()))
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // páginas: red primero, para recibir siempre la última versión; sin red, la app en caché
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => guardar(new Request('./index.html', { credentials: 'same-origin' }), res))
        .catch(() => caches.match('./index.html', { ignoreSearch: true, ignoreVary: true })),
    )
    return
  }

  // JS, CSS e íconos propios: caché primero
  if (url.origin === self.location.origin) {
    event.respondWith(caches.match(req, MATCH).then((hit) => hit || fetch(req).then((res) => guardar(req, res))))
    return
  }

  // fuentes de Google: lo guardado de inmediato y se actualiza en segundo plano
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(req, MATCH).then((hit) => {
        const red = fetch(req).then((res) => guardar(req, res)).catch(() => hit)
        return hit || red
      }),
    )
  }
  // el resto (WhatsApp, teléfono, etc.) va directo a la red
})
