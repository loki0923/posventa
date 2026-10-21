// =====================================================
// GESTIÓNPRO POS - SERVICE WORKER (MODO OFFLINE PWA)
// Versión: 4.0.0
// =====================================================

// Al cambiar CACHE_NAME, el evento 'activate' borra las cachés anteriores.
// Hay que subirlo en CADA despliegue que toque el shell; si no, los equipos
// siguen con la versión vieja.
const CACHE_NAME = 'gestionpro-pos-v16';

const STATIC_ASSETS = [
    './',
    './index.html',
    './app.js',
    './catalogo.html',
    './manifest.json'
];

// El "shell" de la aplicación (HTML y app.js) va NETWORK-FIRST.
//
// ANTES todo iba stale-while-revalidate, así que tras un despliegue el
// navegador seguía ejecutando el app.js VIEJO durante una carga completa. Y
// como el index.html sí podía llegar nuevo, quedaba una mezcla incoherente:
// HTML nuevo con JS viejo. El síntoma es exactamente el que se reportó: la
// interfaz muestra datos de la versión anterior y parece que los arreglos no
// se aplicaron. Además era imposible de diagnosticar desde fuera.
//
// Con network-first: si hay red, siempre llega la versión nueva; la caché solo
// se usa cuando no hay conexión.
// catalogo.html va incluido: es una página pública y también recibe
// correcciones de seguridad (se le cerró un XSS). Si se sirviera con
// stale-while-revalidate, el arreglo no llegaría a los clientes hasta que
// expirara la caché.
const SHELL_NAMES = ['/', '/index.html', '/app.js', '/catalogo.html'];

function esShell(url) {
    if (url.origin !== self.location.origin) return false;
    if (SHELL_NAMES.includes(url.pathname)) return true;
    // Soporta despliegues en subcarpeta (GitHub Pages, etc.)
    return /\/(index\.html|app\.js|catalogo\.html)$/.test(url.pathname) || /\/$/.test(url.pathname);
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Pre-cacheados recursos del sistema POS');
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[SW] Limpiando caché anterior:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Solo GET: no interceptar escrituras.
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Solo http/https. La API Cache RECHAZA otros esquemas (chrome-extension://,
    // moz-extension://, etc.) lanzando un TypeError, y el fallo quedaba como
    // error NO capturado en la consola del service worker:
    //   "Failed to execute 'put' on 'Cache': Request scheme
    //    'chrome-extension' is unsupported"
    if (!url.protocol.startsWith('http')) return;

    // Permitir que Firebase SDK gestione sus propios sockets y endpoints de
    // autenticación y base de datos (no deben cachearse NUNCA).
    if (url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('identitytoolkit.googleapis.com') ||
        url.hostname.includes('securetoken.googleapis.com') ||
        url.hostname.includes('firebaseinstallations.googleapis.com')) {
        return;
    }

    // 1) SHELL: red primero, caché como respaldo sin conexión.
    if (esShell(url)) {
        event.respondWith(
            fetch(request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const copia = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copia));
                }
                return networkResponse;
            }).catch(() => {
                return caches.match(request).then((cached) => {
                    if (cached) return cached;
                    if (request.mode === 'navigate') return caches.match('./index.html');
                });
            })
        );
        return;
    }

    // 2) RESTO (librerías CDN, fuentes, imágenes): stale-while-revalidate.
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                // Actualizar la caché en segundo plano cuando haya conexión.
                fetch(request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, networkResponse);
                        });
                    }
                }).catch(() => {});
                return cachedResponse;
            }

            // Si no estaba en caché, pedir a la red y guardar para el futuro.
            return fetch(request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'error') {
                    return networkResponse;
                }

                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseToCache);
                });

                return networkResponse;
            }).catch(() => {
                // Respaldo de navegación sin conexión.
                if (request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                return Response.error();
            });
        })
    );
});
