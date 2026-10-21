// =====================================================
// GESTIÓNPRO 2026 - SISTEMA POS SAAS MULTI-TENANT
// Archivo único consolidado - UTF-8
// =====================================================

// Configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDKRrgpahHpzJOfypAkfGsnQOofhMkHmvk",
    authDomain: "pos-venta-bodega.firebaseapp.com",
    projectId: "pos-venta-bodega",
    storageBucket: "pos-venta-bodega.firebasestorage.app",
    messagingSenderId: "682865386753",
    appId: "1:682865386753:web:696cc4d360bd0537812700",
    measurementId: "G-1CHNJR1GML"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
const secondaryAuth = secondaryApp.auth();

// =====================================================
// VERSIÓN DE LA APLICACIÓN
// -----------------------------------------------------
// Sirve para saber de un vistazo si el navegador está ejecutando el código
// NUEVO o una copia cacheada por el service worker. Se pinta en la pantalla de
// login y en la barra lateral, y se registra en la consola.
//
// HAY QUE SUBIRLA —junto con CACHE_NAME en sw.js y el ?v= del <script> en
// index.html— en cada despliegue que toque app.js. Si no, es imposible
// distinguir "no se aplicó el cambio" de "el navegador sirve lo viejo".
// =====================================================
const APP_VERSION = 'v16 · 21/10/2026 · importador inventario excel';

function pintarVersionApp() {
    try {
        document.querySelectorAll('[data-app-version]').forEach(el => {
            el.textContent = APP_VERSION;
        });
        console.log(
            `%c GestiónPro ${APP_VERSION} `,
            'background:#4f46e5;color:#fff;padding:3px 8px;border-radius:6px;font-weight:bold'
        );
    } catch (e) {}
}

// Variables Globales
let rates = { bcv: 36.50, usdt: 38.10, eur: 39.20 };
let autoRates = { bcv: 36.5, usdt: 38.0, eur: 39.0 };
let products = [];
let cart = [];
let heldTicket = null;
let currentPOSCategory = 'Todos';
let currentOrderType = 'llevar'; // 'llevar' | 'aqui' | 'delivery'
let dailyOrderNumber = parseInt(localStorage.getItem('pos_daily_order_num') || '1', 10);
let activeComandas = JSON.parse(localStorage.getItem('pos_active_comandas') || '[]');
let kitchenSoundEnabled = localStorage.getItem('pos_kitchen_sound') !== 'false';
let mermasHistory = [];
let salesHistory = [];
let gastosHistory = [];
let usersList = [];
let clientes = [];
let abonosHistory = [];
let proveedores = [];
let ordenesCompra = [];
let currentOrdenItems = [];
let sugerenciasData = [];
let libroVentasData = [];
let bancos = ['Banco de Venezuela', 'B.N.C', 'BBVA Provincial', 'Mercantil', 'Banesco', 'Otro'];
let activeMermaCalc = null;
let currentSaleTotal = 0;
let currentDiscount = 0;
let puntosCanjeadosVenta = 0;
let selectedVueltoOption = 'efectivoUsd';
let saldoFavorAplicadoVenta = 0;
let isAppOnline = navigator.onLine;
// La cola se carga DESPUÉS de resolver la sesión, y va prefijada por uid:
// en un equipo compartido nadie debe sincronizar las ventas de otro usuario.
let offlineSalesQueue = [];
let currentBarcodeUnit = 'kg';
let currentUser = null;
let isAdmin = false;
let currentNegocioId = null;
// Inquilino REAL del usuario, tal como lo devolvió el servidor. No cambia en
// toda la sesión: currentNegocioId sí puede cambiar si se cambia de sucursal,
// y con las reglas de aislamiento solo `negocioAsignado` es accesible.
let negocioAsignado = null;
let html5QrScannerInstance = null;
let chartVentas = null;
let chartTop = null;
let storeConfig = { 
    name: 'GestiónPro', 
    rif: '', 
    logo: '', 
    phone: '', 
    nroFactura: 1001, 
    nroControl: '00-001001',
    businessType: localStorage.getItem('pos_business_mode') || 'bodega'
};

// Variable global para gestión limpia de listeners
let activeListeners = [];

function clearActiveListeners() {
    activeListeners.forEach(unsub => {
        if (typeof unsub === 'function') {
            try { unsub(); } catch (err) { console.warn('Error cancelando listener:', err); }
        }
    });
    activeListeners = [];
}

// Helper para precisión de redondeo monetario (evita centavos flotantes)
function roundMoney(num) {
    return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
}

// Escapa un valor para insertarlo dentro de HTML.
// Imprescindible en cualquier sitio donde se interpole un dato que venga de
// Firestore, de un formulario o de la URL: sin esto, un nombre con comillas o
// etiquetas se ejecuta como código en la sesión de quien lo ve.
function escHtml(valor) {
    return String(valor === null || valor === undefined ? '' : valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Formatea la fecha de creación de un perfil, tolerando basura.
function fechaCorta(valor) {
    if (!valor) return '—';
    const d = new Date(valor);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-VE');
}

// =====================================================
// TELÉFONOS
// -----------------------------------------------------
// WhatsApp exige el número en formato INTERNACIONAL y SIN el 0 inicial.
// Guardar '0414-1234567' producía enlaces wa.me/04141234567, que no llevan a
// ninguna parte. Ahora se escribe el número local de siempre y el sistema le
// pone el código del país solo.
// =====================================================
const TEL_PREFIJO_POR_DEFECTO = '58';   // Venezuela

// Convierte lo que teclee el usuario a dígitos internacionales.
//   0414-1234567  -> 584141234567
//   4141234567    -> 584141234567
//   0212-1234567  -> 582121234567
//   +584141234567 -> 584141234567   (ya internacional, se respeta)
//   +573001234567 -> 573001234567   (otro país: basta con escribir el +)
function normalizarTelefono(valor, prefijo) {
    const pre = String(prefijo || TEL_PREFIJO_POR_DEFECTO).replace(/\D/g, '');
    if (valor === null || valor === undefined) return '';

    const texto = String(valor).trim();
    if (!texto) return '';

    const digitos = texto.replace(/\D/g, '');
    if (!digitos) return '';

    // El usuario escribió el "+" -> ya viene internacional, se respeta.
    if (texto.startsWith('+')) return digitos;

    // Ya empieza por el código del país: se deja igual.
    if (pre && digitos.startsWith(pre) && digitos.length >= pre.length + 9) return digitos;

    // Formato local: se quita el 0 de troncal y se pone el prefijo.
    if (digitos.startsWith('0')) return pre + digitos.slice(1);

    // Móvil sin el 0 (4141234567) o cualquier otro caso: se antepone el prefijo.
    return pre + digitos;
}

// Presentación legible: 584141234567 -> +58 414-1234567
function formatearTelefono(valor) {
    const d = normalizarTelefono(valor);
    if (!d) return '';
    if (d.startsWith('58') && d.length >= 12) {
        return `+58 ${d.slice(2, 5)}-${d.slice(5)}`;
    }
    return `+${d}`;
}

// Enlace de WhatsApp listo para abrir. Centraliza la normalización para que
// TODOS los botones se beneficien, incluso con teléfonos guardados en formato
// local por versiones anteriores.
function enlaceWhatsApp(telefono, texto) {
    const destino = normalizarTelefono(telefono);
    const query = `?text=${encodeURIComponent(texto || '')}`;
    return destino ? `https://wa.me/${destino}${query}` : `https://wa.me/${query}`;
}

// Pinta en vivo, bajo el campo, cómo se va a guardar el número. Así se ve al
// instante que el +58 se añade solo y no hay que memorizar nada.
function actualizarPistaTelefono(inputId, pistaId) {
    const input = document.getElementById(inputId);
    const pista = document.getElementById(pistaId);
    if (!input || !pista) return;
    const valor = input.value.trim();
    if (!valor) {
        pista.textContent = '';
        pista.classList.add('hidden');
        return;
    }
    const internacional = normalizarTelefono(valor);
    pista.textContent = internacional
        ? `Se guardará como ${formatearTelefono(valor)} · WhatsApp: ${internacional}`
        : '';
    pista.classList.toggle('hidden', !internacional);
}

// Conecta un campo de teléfono con su pista y lo normaliza al salir del campo.
function conectarCampoTelefono(inputId, pistaId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const refrescar = () => actualizarPistaTelefono(inputId, pistaId);
    input.addEventListener('input', refrescar);
    input.addEventListener('blur', () => {
        const normalizado = normalizarTelefono(input.value);
        if (normalizado) input.value = normalizado;
        refrescar();
    });
    refrescar();
}

// Helper global multi-tenant seguro
function getDb(collectionName) {
    if (!currentNegocioId) {
        console.error("ALERTA CRÍTICA: Se intentó acceder a la BD sin negocio activo para la colección:", collectionName);
        throw new Error("No hay un negocio activo configurado para esta sesión.");
    }
    return db.collection('negocios').doc(currentNegocioId).collection(collectionName);
}

// =====================================================
// CACHÉ LOCAL AISLADA POR USUARIO
// -----------------------------------------------------
// Antes todas las claves eran globales del dispositivo ('cached_products',
// 'cached_clientes', 'offline_sales_queue'...), así que el siguiente usuario
// de un equipo compartido veía los productos, clientes, teléfonos y deudas
// del anterior, y podía llegar a sincronizar SUS ventas. Ahora cada clave va
// prefijada con el uid y solo se lee si hay sesión activa.
// =====================================================
const PREFIJO_CACHE = 'gp';

function claveCache(nombre) {
    if (!currentUser || !currentUser.uid) return null;
    return `${PREFIJO_CACHE}_${currentUser.uid}_${nombre}`;
}

function guardarCache(nombre, valor) {
    const clave = claveCache(nombre);
    if (!clave) return false;
    try {
        localStorage.setItem(clave, JSON.stringify(valor));
        return true;
    } catch (e) {
        // Cuota agotada (el catálogo lleva fotos base64). Antes esto podía
        // reventar en plena venta; ahora queda registrado y no propaga.
        console.warn(`No se pudo guardar la caché local "${nombre}":`, e);
        return false;
    }
}

function leerCache(nombre) {
    const clave = claveCache(nombre);
    if (!clave) return null;
    try {
        const raw = localStorage.getItem(clave);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.warn(`Caché local corrupta en "${nombre}", se ignora:`, e);
        return null;
    }
}

// Lectura tolerante de listas guardadas en el dispositivo: un JSON corrupto no
// debe impedir que la aplicación arranque ni vaciar silenciosamente el estado.
function leerListaLocal(clave) {
    try {
        const raw = localStorage.getItem(clave);
        if (!raw) return [];
        const val = JSON.parse(raw);
        return Array.isArray(val) ? val : [];
    } catch (e) {
        console.warn(`Lista local "${clave}" corrupta, se ignora:`, e);
        return [];
    }
}

function guardarListaLocal(clave, valor) {
    try {
        localStorage.setItem(clave, JSON.stringify(valor || []));
        return true;
    } catch (e) {
        console.warn(`No se pudo guardar la lista local "${clave}":`, e);
        return false;
    }
}

// Borra TODO rastro local: la sesión, las cachés de CUALQUIER uid (incluida
// la cola de ventas pendientes, que también va bajo el prefijo gp_) y los
// datos de la suite multi-sucursal. Se usa al cerrar sesión; cerrarSesion()
// avisa antes si quedan ventas sin sincronizar, para no perder facturación.
function limpiarDatosLocales() {
    const clavesFijas = [
        'cached_session', 'cached_products', 'cached_clientes', 'cached_rates',
        'cached_storeConfig', 'holding_branches', 'holding_transfers',
        'holding_cajeros', 'active_branch_id'
    ];
    clavesFijas.forEach(k => {
        try { localStorage.removeItem(k); } catch (e) {}
    });
    try {
        Object.keys(localStorage)
            .filter(k => k.startsWith(`${PREFIJO_CACHE}_`) || k.startsWith('caja_status_') || k.startsWith('branch_metrics_'))
            .forEach(k => localStorage.removeItem(k));
    } catch (e) {}
}


// =====================================================
// SESIÓN: INQUILINO Y ROL
// =====================================================
// Devuelve { negocioId, isAdmin } o { error }.
//
// Reglas de esta resolución:
//   - El SERVIDOR manda. El rol sale de usuarios/{uid}.role.
//   - La caché local solo se acepta si el blob pertenece A ESTE MISMO uid,
//     así el respaldo de un usuario no sirve para entrar como otro.
//   - Sin red, `isAdmin` de la caché es un valor de PRESENTACIÓN: la
//     autorización real la hacen las reglas de Firestore, que leen el rol
//     del servidor. Manipular localStorage ya no concede permisos, solo
//     cambia qué pestañas se ven.
//   - Se eliminaron las dos puertas traseras: el caso especial
//     'admin@bodega.com' (que concedía admin sobre 'bodega-demo' con solo
//     controlar ese email) y el respaldo de la colección legacy
//     users/{email}, que era escribible por cualquier autenticado.
async function resolverSesion(user) {
    if (navigator.onLine) {
        try {
            const uDoc = await db.collection('usuarios').doc(user.uid).get();
            const data = uDoc.exists ? uDoc.data() : null;
            if (data && data.negocioId) {
                const sesion = { negocioId: data.negocioId, isAdmin: data.role === 'admin' };
                guardarSesionLocal(user, sesion);
                return sesion;
            }
            // Autenticado pero con el perfil incompleto: acceso denegado
            // explícito. Antes esto derivaba en 'bodega-demo' (un inquilino
            // comodín compartido por todos los usuarios irresolubles).
            return { error: 'Tu usuario no tiene un negocio asignado. Pide al administrador que complete tu perfil (campo negocioId).' };
        } catch (e) {
            console.warn('No se pudo verificar el perfil en el servidor, se intenta la caché local:', e);
        }
    }

    const cache = leerSesionLocal(user.uid);
    if (cache) {
        return { negocioId: cache.negocioId, isAdmin: !!cache.isAdmin };
    }

    return {
        error: navigator.onLine
            ? 'No se pudo verificar tu usuario y este dispositivo no tiene sesión guardada. Inténtalo de nuevo con conexión.'
            : 'Este dispositivo no tiene datos guardados para tu usuario. Conéctate a internet e inicia sesión al menos una vez.'
    };
}

function claveSesionLocal(uid) {
    return `${PREFIJO_CACHE}_sesion_${uid}`;
}

function guardarSesionLocal(user, sesion) {
    try {
        localStorage.setItem(claveSesionLocal(user.uid), JSON.stringify({
            uid: user.uid,
            email: user.email,
            negocioId: sesion.negocioId,
            isAdmin: !!sesion.isAdmin,
            guardadoEn: new Date().toISOString()
        }));
    } catch (e) {
        console.warn('No se pudo guardar la sesión local:', e);
    }
}

// Solo se acepta si el blob pertenece a este uid y trae negocioId.
function leerSesionLocal(uid) {
    try {
        const raw = localStorage.getItem(claveSesionLocal(uid));
        if (!raw) return null;
        const ses = JSON.parse(raw);
        if (!ses || ses.uid !== uid || !ses.negocioId) return null;
        return ses;
    } catch (e) {
        return null;
    }
}

// =====================================================
// INICIALIZACIÓN Y MOTOR OFFLINE
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
    // Lo primero: dejar constancia de qué versión se está ejecutando.
    pintarVersionApp();

    if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.classList.add('dark');
        const icon = document.getElementById('theme-icon');
        if (icon) icon.className = 'fa-solid fa-sun text-amber-400 text-sm';
    }

    // 1. Estado de red. La caché local se carga DESPUÉS de resolver la sesión,
    //    porque está prefijada por uid: antes se pintaba aquí, sin autenticar,
    //    y mostraba los datos del usuario anterior en equipos compartidos.
    updateNetworkStatusUI();

    // 2. Persistencia offline de Firestore en IndexedDB
    db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        if (err.code === 'failed-precondition') {
            console.warn('Persistencia offline múltiple pestaña');
        } else if (err.code === 'unimplemented') {
            console.warn('Navegador no soporta IndexedDB persistence');
        }
    });

    renderBancos();
    initBusinessMode();
    renderKitchenDisplay();

    // Campos de teléfono: pista en vivo + normalización al salir del campo.
    // Así se escribe el número local de siempre y el +58 se añade solo.
    conectarCampoTelefono('cliente-telefono', 'cliente-telefono-pista');
    conectarCampoTelefono('settings-phone', 'settings-phone-pista');

    // 3. Monitoreo reactivo de estado de conexión
    window.addEventListener('online', () => {
        updateNetworkStatusUI();
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: '🌐 ¡Conexión Restablecida!',
            text: 'Sincronizando ventas y actualizando tasas...',
            showConfirmButton: false,
            timer: 3000
        });
        fetchRates();
        sincronizarVentasOffline();
    });

    window.addEventListener('offline', () => {
        updateNetworkStatusUI();
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'warning',
            title: '📡 Modo Offline Activo',
            text: 'Sin internet. Puedes seguir facturando con normalidad.',
            showConfirmButton: false,
            timer: 4000
        });
    });

    // 4. Autenticación con tolerancia a fallas de red offline
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            currentUser = null;
            isAdmin = false;
            currentNegocioId = null;
            negocioAsignado = null;
            document.getElementById('login-container').classList.remove('hidden');
            document.getElementById('app-container').classList.add('hidden');
            return;
        }

        currentUser = user;

        const sesion = await resolverSesion(user);

        if (sesion.error) {
            currentUser = null;
            currentNegocioId = null;
            negocioAsignado = null;
            isAdmin = false;
            await auth.signOut();
            return Swal.fire('Acceso denegado', sesion.error, 'error');
        }

        currentNegocioId = sesion.negocioId;
        negocioAsignado = sesion.negocioId;
        isAdmin = sesion.isAdmin;

        // Cargar la caché de ESTE usuario (productos, clientes, tasas y cola
        // de ventas pendientes). Va aquí y no antes de autenticar para que un
        // equipo compartido nunca pinte los datos del usuario anterior.
        loadCachedData();

        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('app-container').classList.remove('hidden');
        document.getElementById('user-display').textContent = isAdmin ? 'Admin' : 'Cajero';
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? 'flex' : 'none');
        if (typeof initMultiBranchSuite === 'function') initMultiBranchSuite();
        if (!isAdmin) switchTab('ventas');
        setupFirebaseListeners();
        fetchRates();
        setupBarcodeScanner();
        setupKeyboardShortcuts();

        // Si hay ventas offline en cola pendientes al iniciar sesión y hay conexión, sincronizar
        if (navigator.onLine && offlineSalesQueue.length > 0) {
            setTimeout(sincronizarVentasOffline, 1500);
        }
    });
});

// =====================================================
// MOTOR OFFLINE, CACHÉ LOCAL Y COLA DE SINCRONIZACIÓN
// =====================================================
let isSyncingOffline = false;

function loadCachedData() {
    if (!currentUser) return;
    try {
        const cachedProducts = leerCache('products');
        if (Array.isArray(cachedProducts) && cachedProducts.length) {
            products = cachedProducts;
            renderPOSProducts();
            if (isAdmin && typeof renderInventory === 'function') renderInventory();
        }
        const cachedClientes = leerCache('clientes');
        if (Array.isArray(cachedClientes) && cachedClientes.length) {
            clientes = cachedClientes;
            if (typeof renderClientes === 'function') renderClientes();
            if (typeof renderCuadernoFiados === 'function') renderCuadernoFiados();
            if (typeof updateBadgeFiados === 'function') updateBadgeFiados();
            if (typeof populateClientesSelect === 'function') populateClientesSelect();
        }
        const cachedRates = leerCache('rates');
        if (cachedRates) {
            rates = cachedRates;
            const rateBcv = document.getElementById('rate-bcv');
            if (rateBcv) rateBcv.innerHTML = `Bs ${rates.bcv.toFixed(2)}`;
            const rateUsdt = document.getElementById('rate-usdt');
            if (rateUsdt) rateUsdt.textContent = `Bs ${rates.usdt.toFixed(2)}`;
            const rateEur = document.getElementById('rate-eur');
            if (rateEur) rateEur.textContent = `Bs ${rates.eur.toFixed(2)}`;
        }
        const cachedConfig = leerCache('storeConfig');
        if (cachedConfig) {
            storeConfig = cachedConfig;
            pintarNombreTienda(document.getElementById('sidebar-store-name'), storeConfig.name);
            const rifEl = document.getElementById('sidebar-store-rif');
            if (rifEl) rifEl.textContent = storeConfig.rif ? `RIF: ${storeConfig.rif}` : '';
        }
        // La cola de ventas pendientes también pertenece a ESTE usuario.
        offlineSalesQueue = leerCache('offline_sales_queue') || [];
        updateNetworkStatusUI();
    } catch (e) {
        console.warn('Error al cargar datos locales en caché:', e);
    }
}

// Solo se permiten imágenes https: o data:image/*. Sin esto, un logo con
// comillas rompía el atributo e inyectaba HTML, y un "javascript:" se
// ejecutaba al asignarlo. El logo lo escribe el dueño, pero en un sistema
// multi-inquilino no hay que confiar en el documento.
function esUrlImagenSegura(url) {
    if (typeof url !== 'string') return false;
    const u = url.trim().toLowerCase();
    return u.startsWith('https://') || u.startsWith('data:image/');
}

// Pinta el nombre de la tienda sin innerHTML: el caso por defecto lleva el
// degradado de marca, y cualquier otro nombre se escribe como TEXTO.
// (Antes: nameEl.innerHTML = storeConfig.name -> XSS almacenado, y se
// ejecutaba al iniciar sesión tanto para el dueño como para el cajero.)
function pintarNombreTienda(el, nombre) {
    if (!el) return;
    el.textContent = '';
    if (nombre === 'GestiónPro' || !nombre) {
        el.append('Gestión');
        const span = document.createElement('span');
        span.className = 'text-gradient';
        span.textContent = 'Pro';
        el.append(span);
        return;
    }
    el.textContent = nombre;
}

// Pinta el logo validando el esquema de la URL y sin interpolar en HTML.
function pintarLogo(el, url) {
    if (!el) return;
    el.textContent = '';
    if (esUrlImagenSegura(url)) {
        const img = document.createElement('img');
        img.src = url.trim();
        img.alt = '';
        img.className = 'w-full h-full object-cover';
        el.appendChild(img);
        return;
    }
    const icono = document.createElement('i');
    icono.className = 'fa-solid fa-bolt';
    el.appendChild(icono);
}

function updateNetworkStatusUI() {
    isAppOnline = navigator.onLine;
    const badge = document.getElementById('network-status-badge');
    const dot = document.getElementById('network-status-dot');
    const ping = document.getElementById('network-status-ping');
    const text = document.getElementById('network-status-text');
    const pendingBtn = document.getElementById('pending-sync-btn');
    const pendingCount = document.getElementById('pending-sync-count');

    if (badge && dot && text) {
        if (isAppOnline) {
            badge.className = "cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-[11px] font-black border border-emerald-200 dark:border-emerald-800/60 shadow-xs transition-all hover:scale-105 active:scale-95";
            dot.className = "relative inline-flex rounded-full h-2 w-2 bg-emerald-500";
            if (ping) {
                ping.classList.remove('hidden');
                ping.className = "animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75";
            }
            text.textContent = "En Línea";
        } else {
            badge.className = "cursor-pointer flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 text-[11px] font-black border border-amber-200 dark:border-amber-800/60 shadow-xs transition-all hover:scale-105 active:scale-95 animate-pulse";
            dot.className = "relative inline-flex rounded-full h-2 w-2 bg-amber-500";
            if (ping) {
                ping.classList.add('hidden');
            }
            text.textContent = "Modo Offline";
        }
    }

    if (pendingBtn && pendingCount) {
        const count = (offlineSalesQueue && offlineSalesQueue.length) || 0;
        pendingCount.textContent = count;
        if (count > 0) {
            pendingBtn.classList.remove('hidden');
        } else {
            pendingBtn.classList.add('hidden');
        }
    }

    const modal = document.getElementById('offline-sync-modal');
    if (modal && !modal.classList.contains('hidden')) {
        renderOfflineSyncModalData();
    }
}

function openOfflineSyncModal() {
    const modal = document.getElementById('offline-sync-modal');
    const content = document.getElementById('offline-sync-modal-content');
    if (!modal) return;
    renderOfflineSyncModalData();
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        if (content) {
            content.classList.remove('scale-95');
            content.classList.add('scale-100');
        }
    });
}

function closeOfflineSyncModal() {
    const modal = document.getElementById('offline-sync-modal');
    const content = document.getElementById('offline-sync-modal-content');
    if (!modal) return;
    modal.classList.add('opacity-0');
    if (content) {
        content.classList.remove('scale-100');
        content.classList.add('scale-95');
    }
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 250);
}

function renderOfflineSyncModalData() {
    isAppOnline = navigator.onLine;
    const netStatus = document.getElementById('offline-modal-net-status');
    const netDesc = document.getElementById('offline-modal-net-desc');
    const statusCard = document.getElementById('offline-modal-status-card');
    const modalDot = document.getElementById('offline-modal-dot');
    const modalIcon = document.getElementById('offline-modal-icon');
    const iconContainer = document.getElementById('offline-modal-icon-container');

    if (statusCard && netStatus && netDesc) {
        if (isAppOnline) {
            statusCard.className = "p-4 rounded-2xl mb-4 flex items-center justify-between border bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60";
            if (modalDot) modalDot.className = "w-3 h-3 rounded-full bg-emerald-500 shadow-xs";
            if (modalIcon) modalIcon.className = "fa-solid fa-wifi text-emerald-600 dark:text-emerald-400";
            if (iconContainer) iconContainer.className = "w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-lg shadow-xs";
            netStatus.textContent = "Conexión a Internet Activa";
            netDesc.textContent = "Sincronización en tiempo real con Firebase Firestore.";
        } else {
            statusCard.className = "p-4 rounded-2xl mb-4 flex items-center justify-between border bg-amber-50/80 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60";
            if (modalDot) modalDot.className = "w-3 h-3 rounded-full bg-amber-500 shadow-xs animate-pulse";
            if (modalIcon) modalIcon.className = "fa-solid fa-wifi-slash text-amber-600 dark:text-amber-400";
            if (iconContainer) iconContainer.className = "w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center text-lg shadow-xs";
            netStatus.textContent = "Sin Conexión (Modo Offline)";
            netDesc.textContent = "Las ventas se guardan en la memoria local y se sincronizarán al volver la red.";
        }
    }

    const elProds = document.getElementById('offline-cached-prods-count');
    if (elProds) elProds.textContent = products.length;
    const elClients = document.getElementById('offline-cached-clients-count');
    if (elClients) elClients.textContent = clientes.length;
    const elRate = document.getElementById('offline-cached-rate-bcv');
    if (elRate) elRate.textContent = `Bs ${(rates && rates.bcv ? rates.bcv : 36.5).toFixed(2)}`;
    const elFact = document.getElementById('offline-cached-factura');
    if (elFact) elFact.textContent = `#${storeConfig.nroFactura || 1001}`;

    const queueList = document.getElementById('offline-queue-list');
    const queueBadge = document.getElementById('offline-queue-badge');
    const queueCount = (offlineSalesQueue && offlineSalesQueue.length) || 0;
    if (queueBadge) queueBadge.textContent = `${queueCount} en espera`;

    if (queueList) {
        if (queueCount === 0) {
            queueList.innerHTML = `<p class="text-center text-xs text-slate-400 py-4 italic"><i class="fa-solid fa-circle-check text-emerald-500 mr-1"></i> Todo el sistema está sincronizado con la nube.</p>`;
        } else {
            let html = '';
            offlineSalesQueue.forEach((item, idx) => {
                const totalUsd = Number(item.totalUsd || 0).toFixed(2);
                const itemsCount = (item.items || []).reduce((acc, i) => acc + (i.qty || 1), 0);
                const fecha = item.fechaStr || 'Reciente';
                html += `
                    <div class="bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-xs">
                        <div class="overflow-hidden pr-2">
                            <div class="flex items-center gap-1.5">
                                <span class="font-black text-slate-800 dark:text-white">#${item.nroFactura || (idx + 1)}</span>
                                <span class="text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 font-bold px-1.5 py-0.2 rounded-full">⏳ Pendiente</span>
                            </div>
                            <p class="text-[11px] text-slate-400 truncate">${itemsCount} prod(s) • ${fecha}</p>
                        </div>
                        <div class="text-right shrink-0">
                            <span class="font-black text-emerald-600 dark:text-emerald-400 text-sm">$${totalUsd}</span>
                        </div>
                    </div>
                `;
            });
            queueList.innerHTML = html;
        }
    }

    const syncBtn = document.getElementById('btn-force-sync');
    if (syncBtn) {
        if (isSyncingOffline) {
            syncBtn.disabled = true;
            syncBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando con Firestore...`;
        } else if (!isAppOnline) {
            syncBtn.disabled = true;
            syncBtn.innerHTML = `<i class="fa-solid fa-wifi-slash"></i> Esperando Conexión a Internet`;
        } else if (queueCount === 0) {
            syncBtn.disabled = false;
            syncBtn.innerHTML = `<i class="fa-solid fa-check-double text-emerald-300"></i> Al Día (Verificar Firestore)`;
        } else {
            syncBtn.disabled = false;
            syncBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Sincronizar ${queueCount} Venta(s) Ahora`;
        }
    }
}

async function forzarSincronizacionOffline() {
    if (!navigator.onLine) {
        return Swal.fire({
            title: 'Sin Internet',
            text: 'No es posible sincronizar sin conexión a internet. En cuanto vuelva la señal o WiFi, las ventas se enviarán automáticamente.',
            icon: 'info'
        });
    }
    if (offlineSalesQueue.length === 0) {
        return Swal.fire({
            title: '¡Todo al día!',
            text: 'No tienes ventas pendientes por sincronizar en la memoria de este dispositivo.',
            icon: 'success',
            timer: 2000,
            showConfirmButton: false
        });
    }
    await sincronizarVentasOffline(true);
}

// Límite duro de Firestore: 500 escrituras por batch. Se deja margen porque
// cada venta consume 1 (venta) + N (stock) + 1 (cliente) escrituras.
const LIMITE_ESCRITURAS_BATCH = 400;

async function sincronizarVentasOffline(manual = false) {
    if (isSyncingOffline) return;
    if (!navigator.onLine) return;
    if (!offlineSalesQueue || offlineSalesQueue.length === 0) return;

    isSyncingOffline = true;
    updateNetworkStatusUI();

    const totalToSync = offlineSalesQueue.length;
    console.log(`Iniciando sincronización de ${totalToSync} ventas offline hacia Firestore...`);

    const sincronizadas = [];
    let maxFactura = storeConfig.nroFactura || 1000;
    let primerError = null;

    try {
        // -------------------------------------------------------------
        // PASO 1 — IDEMPOTENCIA
        // Descartar las ventas que YA están en la nube. El id del documento
        // es determinista (el id local 'OFF-...'), así que si un intento
        // anterior llegó al servidor pero se perdió la respuesta, aquí se
        // detecta. Sin esto, cada reintento volvía a restar stock, volvía a
        // sumar la deuda del cliente y duplicaba los puntos de fidelidad.
        // -------------------------------------------------------------
        const porSubir = [];
        for (const sale of offlineSalesQueue) {
            if (!sale || !sale.id) continue;
            try {
                const snap = await getDb('sales').doc(sale.id).get();
                if (snap.exists) sincronizadas.push(sale);
                else porSubir.push(sale);
            } catch (e) {
                // Si no se puede comprobar, se intenta subir: mejor reintentar
                // que perder la venta. El id determinista impide que se cree
                // un documento duplicado.
                porSubir.push(sale);
            }
        }

        // -------------------------------------------------------------
        // PASO 2 — ENVÍO TROCEADO
        // Antes iba TODO en un solo batch: con ~55 ventas de 8 artículos se
        // superaba el límite de 500 escrituras y fallaba la sincronización
        // COMPLETA, dejando la cola atascada de forma indefinida.
        // -------------------------------------------------------------
        const pendientes = porSubir.slice();
        while (pendientes.length > 0) {
            const lote = [];
            let escrituras = 1; // el set de settings/general

            while (pendientes.length > 0) {
                const sale = pendientes[0];
                const costo = 1
                    + (Array.isArray(sale.items) ? sale.items.length : 0)
                    + (sale.clienteId ? 1 : 0);
                if (lote.length > 0 && escrituras + costo > LIMITE_ESCRITURAS_BATCH) break;
                lote.push(sale);
                pendientes.shift();
                escrituras += costo;
            }
            if (lote.length === 0) break; // lote imposible: evita bucle infinito

            const batch = db.batch();
            for (const sale of lote) {
                const saleRef = getDb('sales').doc(sale.id);
                const saleToUpload = {
                    ...sale,
                    offlineOriginId: sale.id,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    sincronizadoEn: new Date().toISOString(),
                    status: 'abierto'
                };
                delete saleToUpload.isOffline;
                delete saleToUpload.pendingSync;
                batch.set(saleRef, saleToUpload);

                // Descontar inventario en la nube.
                // set+merge en vez de update: si el producto había sido
                // borrado, update() lanzaba y bloqueaba TODA la cola para
                // siempre (era la causa de colas que nunca sincronizaban).
                if (Array.isArray(sale.items)) {
                    sale.items.forEach(i => {
                        if (i && i.id) {
                            batch.set(getDb('products').doc(i.id), {
                                stock: firebase.firestore.FieldValue.increment(-i.qty)
                            }, { merge: true });
                        }
                    });
                }

                // Sincronizar saldos del cliente (mismo criterio: set+merge).
                if (sale.clienteId) {
                    const updates = {};
                    if (sale.fiadoUsd > 0) {
                        updates.deudaUsd = firebase.firestore.FieldValue.increment(sale.fiadoUsd);
                    }
                    if (sale.saldoFavorAplicadoUsd > 0) {
                        updates.saldoFavorUsd = firebase.firestore.FieldValue.increment(-sale.saldoFavorAplicadoUsd);
                    }
                    if (sale.vuelto && sale.vuelto.montoUsd > 0 && sale.vuelto.metodo === 'saldoFavor') {
                        updates.saldoFavorUsd = firebase.firestore.FieldValue.increment(sale.vuelto.montoUsd);
                    }
                    if (sale.puntosGanados > 0 || sale.puntosCanjeados > 0) {
                        const deltaPuntos = (sale.puntosGanados || 0) - (sale.puntosCanjeados || 0);
                        updates.puntos = firebase.firestore.FieldValue.increment(deltaPuntos);
                    }
                    if (Object.keys(updates).length > 0) {
                        batch.set(getDb('clientes').doc(sale.clienteId), updates, { merge: true });
                    }
                }

                if (sale.nroFactura && sale.nroFactura > maxFactura) {
                    maxFactura = sale.nroFactura;
                }
            }

            batch.set(getDb('settings').doc('general'), { nroFactura: maxFactura }, { merge: true });

            try {
                await batch.commit();
                sincronizadas.push(...lote);
            } catch (err) {
                // Este lote falló: se conserva en la cola y se corta, porque
                // los lotes siguientes podrían compartir la causa del fallo.
                primerError = err;
                break;
            }
        }
    } catch (err) {
        primerError = err;
    } finally {
        // -------------------------------------------------------------
        // PASO 3 — LA COLA SOLO SE LIMPIA DE LO CONFIRMADO
        // Antes se vaciaba entera en cuanto el commit no lanzaba: si fallaba
        // a medias, las ventas no confirmadas desaparecían sin subir.
        // -------------------------------------------------------------
        const idsConfirmados = new Set(sincronizadas.map(s => s.id));
        offlineSalesQueue = offlineSalesQueue.filter(s => s && !idsConfirmados.has(s.id));
        guardarCache('offline_sales_queue', offlineSalesQueue);

        if (sincronizadas.length > 0) {
            storeConfig.nroFactura = maxFactura;
            guardarCache('storeConfig', storeConfig);
        }

        isSyncingOffline = false;
        updateNetworkStatusUI();

        const pendientesRestantes = offlineSalesQueue.length;

        if (pendientesRestantes === 0 && !primerError) {
            Swal.fire({
                icon: 'success',
                title: '¡Sincronización Exitosa!',
                html: `Se han subido y conciliado <b>${sincronizadas.length} venta(s)</b> pendientes con la base de datos central en la nube.`,
                timer: 3500,
                showConfirmButton: false
            });
        } else if (sincronizadas.length > 0) {
            // Éxito parcial: hay que decirlo, no ocultarlo.
            Swal.fire({
                icon: 'warning',
                title: 'Sincronización parcial',
                html: `Se subieron <b>${sincronizadas.length}</b> venta(s), pero quedan <b>${pendientesRestantes}</b> en cola.<br><br>
                       <span style="font-size:12px;color:#64748b">Causa: ${(primerError && primerError.message) || 'error de conexión'}</span>`,
                confirmButtonText: 'Entendido'
            });
        } else if (primerError) {
            console.error('Error durante sincronización de ventas offline:', primerError);
            // Antes, un fallo automático era MUDO: la cola se quedaba atascada
            // y el usuario no se enteraba nunca.
            Swal.fire({
                icon: 'error',
                title: 'No se pudo sincronizar',
                html: `Quedan <b>${pendientesRestantes}</b> venta(s) guardadas en la memoria de este dispositivo.<br><br>
                       <span style="font-size:12px;color:#64748b">${(primerError && primerError.message) || 'Error de conexión'}</span>`,
                confirmButtonText: 'Entendido'
            });
        }
    }
}

function procesarVentaOffline(saleDataRaw, cartItems, clienteId, saldoFavorAplicado, vueltoUsd, selectedVueltoOption) {
    const btn = document.getElementById('btn-confirm-sale');
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;

    // 1. Descontar stock localmente
    cartItems.forEach(i => {
        const prod = products.find(p => p.id === i.id);
        if (prod) {
            prod.stock = Math.max(0, (prod.stock || 0) - i.qty);
        }
    });
    guardarCache('products', products);

    // 2. Actualizar cliente localmente si aplica
    if (clienteId) {
        const cliente = clientes.find(c => c.id === clienteId);
        if (cliente) {
            if (saleDataRaw.fiadoUsd > 0) {
                cliente.deudaUsd = roundMoney((cliente.deudaUsd || 0) + saleDataRaw.fiadoUsd);
            }
            if (saldoFavorAplicado > 0) {
                cliente.saldoFavorUsd = roundMoney(Math.max(0, (cliente.saldoFavorUsd || 0) - saldoFavorAplicado));
            }
            if (vueltoUsd > 0 && selectedVueltoOption === 'saldoFavor') {
                const deudaActual = cliente.deudaUsd || 0;
                if (deudaActual > 0) {
                    if (vueltoUsd <= deudaActual) {
                        cliente.deudaUsd = roundMoney(deudaActual - vueltoUsd);
                    } else {
                        cliente.deudaUsd = 0;
                        cliente.saldoFavorUsd = roundMoney((cliente.saldoFavorUsd || 0) + (vueltoUsd - deudaActual));
                    }
                } else {
                    cliente.saldoFavorUsd = roundMoney((cliente.saldoFavorUsd || 0) + vueltoUsd);
                }
            }
            const deltaPuntos = (saleDataRaw.puntosGanados || 0) - (saleDataRaw.puntosCanjeados || 0);
            cliente.puntos = Math.max(0, (cliente.puntos || 0) + deltaPuntos);
        }
        guardarCache('clientes', clientes);
    }

    // 3. Incrementar correlativo de factura
    const nextFactura = ((storeConfig.nroFactura || 1000) + 1);
    storeConfig.nroFactura = nextFactura;
    guardarCache('storeConfig', storeConfig);

    // 4. Crear registro de venta offline
    const localId = `OFF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const offlineSale = {
        ...saleDataRaw,
        id: localId,
        nroFactura: nextFactura,
        isOffline: true,
        pendingSync: true,
        fechaStr: new Date().toLocaleString(),
        offlineCreatedAt: new Date().toISOString()
    };

    // 5. Agregar a cola offline persistente
    offlineSalesQueue.push(offlineSale);
    guardarCache('offline_sales_queue', offlineSalesQueue);

    // 6. Agregar a historial local en memoria para ver reflejado en dashboard
    salesHistory.unshift(offlineSale);

    // 7. Generar Ticket / WhatsApp
    if (document.getElementById('pay-print-ticket')?.checked) {
        generateReceipt(offlineSale);
    }
    const waCheckbox = document.getElementById('pay-send-whatsapp');
    if (waCheckbox && waCheckbox.checked) {
        enviarTicketWhatsApp(offlineSale);
    }

    // Comanda de Cocina para Modo Comida Rápida
    if (typeof crearComandaCocina === 'function') {
        crearComandaCocina(offlineSale, offlineSale.id);
    }

    // 8. Limpiar carrito y cerrar modal
    clearCart();
    closePaymentModal();
    updateNetworkStatusUI();
    renderPOSProducts();
    if (isAdmin && typeof renderInventory === 'function') renderInventory();
    if (typeof updatePOSDashboard === 'function') updatePOSDashboard();
    if (typeof marcarCajaAbiertaPorVenta === 'function') {
        marcarCajaAbiertaPorVenta(currentNegocioId);
    }

    btn.disabled = false;
    btn.className = "w-full animated-btn bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-600/25 transition-all text-base";
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Procesar Venta';

    Swal.fire({
        icon: 'success',
        title: '¡Venta Registrada (Modo Offline)!',
        html: `
            <div class="text-left text-xs space-y-2.5 mt-2 p-3 bg-amber-50/80 dark:bg-amber-950/40 rounded-xl border border-amber-200/80 dark:border-amber-800/60">
                <div class="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-black">
                    <i class="fa-solid fa-bolt-lightning text-sm text-amber-500"></i>
                    <span>Operación 100% Protegida Sin Conexión</span>
                </div>
                <p class="text-slate-600 dark:text-slate-300">
                    Factura <b>#${nextFactura}</b> guardada en la memoria local. El inventario se rebajó de inmediato.
                </p>
                <div class="flex items-center justify-between pt-1 border-t border-amber-200/60 dark:border-amber-800/40 text-[11px]">
                    <span class="text-slate-500 font-bold">Ventas en cola local:</span>
                    <span class="font-black text-amber-700 dark:text-amber-400">${offlineSalesQueue.length} pendiente(s)</span>
                </div>
            </div>
        `,
        confirmButtonText: 'Continuar Vendiendo'
    });
}

// =====================================================
// TEMA Y UTILIDADES
// =====================================================
function toggleTheme() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    if (typeof updateDashboardCharts === 'function') updateDashboardCharts();
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = isDark ? 'fa-solid fa-sun text-amber-400 text-sm' : 'fa-solid fa-moon text-slate-600 text-sm';
}

function renderBancos() {
    const selects = ['pay-banco-pm', 'abono-banco'];
    selects.forEach(id => {
        const s = document.getElementById(id);
        if (!s) return;
        let html = '<option value="">Seleccione Cuenta...</option>';
        bancos.forEach(b => html += `<option value="${b}">${b}</option>`);
        s.innerHTML = html;
    });
}

function toggleAbonoBank() {
    const val = document.getElementById('abono-metodo').value;
    const c = document.getElementById('abono-bank-container');
    if (val === 'pagoMovilBs') c.classList.remove('hidden');
    else c.classList.add('hidden');
}

function cargarDemoLogin() {
    const emailEl = document.getElementById('login-email');
    const passEl = document.getElementById('login-password');
    if (emailEl) emailEl.value = 'admin@bodega.com';
    if (passEl) passEl.value = '123456';
    if (typeof Swal !== 'undefined') {
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'info',
            title: 'Credenciales autocompletadas',
            timer: 1500,
            showConfirmButton: false
        });
    }
}
window.cargarDemoLogin = cargarDemoLogin;

async function procesarLogin() {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
    btn.disabled = true;
    try {
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (error) {
        Swal.fire('Error', `Código: ${error.code}`, 'error');
    }
    btn.innerHTML = 'Entrar al Sistema <i class="fa-solid fa-arrow-right"></i>';
    btn.disabled = false;
}

function cerrarSesion() {
    // Protección de datos: la caché local está prefijada por uid y se limpia
    // al salir, así que cerrar sesión con ventas sin subir las borraría. Se
    // avisa y se bloquea por defecto, en vez de perder facturación real en
    // silencio (y de paso evita que otro usuario sincronice ventas ajenas).
    if (offlineSalesQueue && offlineSalesQueue.length > 0) {
        return Swal.fire({
            title: 'Ventas sin sincronizar',
            html: `Hay <b>${offlineSalesQueue.length}</b> venta(s) en la memoria de este dispositivo que todavía no se han subido a la nube.<br><br>
                   Si cierras sesión ahora <b>se perderán</b>. Conéctate a internet y pulsa "Sincronizar" antes de salir.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Entendido, no salir',
            cancelButtonText: 'Salir y perder las ventas',
            confirmButtonColor: '#4f46e5',
            cancelButtonColor: '#e11d48'
        }).then(res => {
            if (res.dismiss === 'cancel') {
                return Swal.fire({
                    title: '¿Confirmas la pérdida?',
                    text: `Se borrarán ${offlineSalesQueue.length} venta(s) que nunca llegaron a la nube.`,
                    icon: 'error',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, borrar y salir',
                    confirmButtonColor: '#e11d48'
                }).then(r2 => {
                    if (r2.isConfirmed) ejecutarCierreSesion();
                });
            }
        });
    }

    return Swal.fire({
        title: '¿Cerrar Sesión?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#4f46e5',
        confirmButtonText: 'Sí'
    }).then(res => {
        if (res.isConfirmed) ejecutarCierreSesion();
    });
}

// Cierre efectivo. Antes solo se desconectaban los listeners y se llamaba a
// signOut(), SIN borrar nada: el siguiente usuario del mismo equipo veía los
// clientes, teléfonos y deudas del anterior, tanto en localStorage como en la
// caché de Firestore en IndexedDB.
async function ejecutarCierreSesion() {
    clearActiveListeners();

    // La persistencia de Firestore guarda los documentos ya leídos en
    // IndexedDB. Es un mejor intento: puede rechazar si la instancia está en
    // uso, y desde el cliente no hay garantía de vaciarla del todo.
    try {
        await db.clearPersistence();
    } catch (e) {
        console.warn('No se pudo limpiar la persistencia de Firestore:', e);
    }

    limpiarDatosLocales();

    try {
        await auth.signOut();
    } catch (e) {
        console.warn('Error al cerrar sesión en Firebase:', e);
    }

    // Recarga para no dejar en memoria datos del usuario anterior.
    window.location.reload();
}

// =====================================================
// FIREBASE LISTENERS
// =====================================================
function setupFirebaseListeners() {
    clearActiveListeners();
    listenProveedores();
    listenOrdenes();
    
    activeListeners.push(getDb('products').onSnapshot((snapshot) => {
        products = [];
        snapshot.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
        guardarCache('products', products);
        if (isAdmin) {
            renderInventory();
        }
        renderPOSProducts();
        if (document.getElementById('tab-mermas')?.classList.contains('active')) {
            populateMermasSelect();
        }
    }));
    
    activeListeners.push(getDb('clientes').orderBy('nombre').onSnapshot((snapshot) => {
        clientes = [];
        snapshot.forEach(doc => clientes.push({ id: doc.id, ...doc.data() }));
        guardarCache('clientes', clientes);
        renderClientes();
        if (typeof renderCuadernoFiados === 'function') renderCuadernoFiados();
        if (typeof updateBadgeFiados === 'function') updateBadgeFiados();
        populateClientesSelect();
    }));
    
    if (isAdmin) {
        activeListeners.push(getDb('sales').orderBy('timestamp', 'desc').limit(200).onSnapshot((snapshot) => {
            salesHistory = [];
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.status === 'abierto') salesHistory.push({ id: doc.id, ...d });
            });
            renderReports();
            updatePOSDashboard();
        }));
        activeListeners.push(getDb('mermas').orderBy('timestamp', 'desc').limit(100).onSnapshot((snapshot) => {
            mermasHistory = [];
            snapshot.forEach(doc => mermasHistory.push({ id: doc.id, ...doc.data() }));
            renderMermasHistory();
            renderReports();
        }));
        activeListeners.push(getDb('gastos').orderBy('timestamp', 'desc').limit(100).onSnapshot((snapshot) => {
            gastosHistory = [];
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.status === 'abierto') gastosHistory.push({ id: doc.id, ...d });
            });
            renderReports();
        }));
        activeListeners.push(getDb('abonos').orderBy('timestamp', 'desc').limit(100).onSnapshot((snapshot) => {
            abonosHistory = [];
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.status === 'abierto') abonosHistory.push({ id: doc.id, ...d });
            });
            renderReports();
        }));
        activeListeners.push(db.collection('usuarios').where('negocioId', '==', currentNegocioId).onSnapshot((snapshot) => {
            usersList = [];
            snapshot.forEach(doc => usersList.push({ id: doc.id, ...doc.data() }));
            renderUsers();
        }));
    } else {
        activeListeners.push(getDb('sales').orderBy('timestamp', 'desc').limit(50).onSnapshot((snapshot) => {
            salesHistory = [];
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.status === 'abierto' && d.cajero === currentUser.email) {
                    salesHistory.push({ id: doc.id, ...d });
                }
            });
            updatePOSDashboard();
        }));
        activeListeners.push(getDb('abonos').orderBy('timestamp', 'desc').limit(50).onSnapshot((snapshot) => {
            abonosHistory = [];
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.status === 'abierto' && d.cajero === currentUser.email) {
                    abonosHistory.push({ id: doc.id, ...d });
                }
            });
        }));
    }
    
    // Escuchar pedidos online del catálogo en tiempo real
    if (typeof listenPedidosOnline === 'function') {
        listenPedidosOnline();
    }
}

function updatePOSDashboard() {
    let tVentas = 0;
    let itemsCount = {};
    salesHistory.forEach(s => {
        tVentas += s.totalUsd || 0;
        s.items.forEach(i => {
            itemsCount[i.nombre] = (itemsCount[i.nombre] || 0) + i.qty;
        });
    });
    const elVentas = document.getElementById('pos-dash-ventas');
    if (elVentas) elVentas.textContent = `$${tVentas.toFixed(2)}`;
    let topName = "Ninguno", maxQ = 0;
    for (let name in itemsCount) {
        if (itemsCount[name] > maxQ) {
            maxQ = itemsCount[name];
            topName = name;
        }
    }
    const elTop = document.getElementById('pos-dash-top');
    if (elTop) elTop.textContent = topName;
}

function toggleSidebar() {
    const s = document.getElementById('main-sidebar');
    s.classList.toggle('md:w-64');
    s.classList.toggle('md:w-20');
    document.querySelectorAll('span.sidebar-text').forEach(el => el.classList.toggle('md:inline'));
    const h1 = document.querySelector('h1.sidebar-text');
    if (h1) h1.classList.toggle('md:block');
    const userDiv = document.querySelector('div.sidebar-text');
    if (userDiv) userDiv.classList.toggle('md:block');
}

function switchTab(tabId) {
    if (!isAdmin && ['inventario', 'reportes', 'usuarios', 'compras', 'libro-fiscal', 'tienda-online', 'torre-control'].includes(tabId)) {
        return Swal.fire({
            title: 'Acceso Restringido',
            text: 'La Torre de Control Global y funciones administrativas están reservadas exclusivamente para el dueño del negocio.',
            icon: 'warning',
            confirmButtonColor: '#4f46e5'
        });
    }
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('active');
        el.classList.add('hover:bg-white/50');
    });
    const tabEl = document.getElementById(`tab-${tabId}`);
    if (tabEl) tabEl.classList.add('active');
    const btn = document.getElementById(`btn-${tabId}`);
    if (btn) {
        btn.classList.add('active');
        btn.classList.remove('hover:bg-white/50');
    }
    if (tabId === 'mermas') populateMermasSelect();
    if (tabId === 'fiados') renderCuadernoFiados();
    if (tabId === 'clientes') renderClientes();
    if (tabId === 'cocina') renderKitchenDisplay();
    if (tabId === 'torre-control' && typeof renderTorreControl === 'function') renderTorreControl();
    if (tabId === 'ventas') {
        const search = document.getElementById('search-pos');
        if (search) search.focus();
    }
}

// =====================================================
// TASAS Y CONFIGURACIÓN
// =====================================================
async function fetchRates() {
    try {
        if (navigator.onLine) {
            const [resUsd, resEur] = await Promise.all([
                fetch('https://ve.dolarapi.com/v1/dolares'),
                fetch('https://ve.dolarapi.com/v1/euros')
            ]);
            const dataUsd = await resUsd.json();
            const dataEur = await resEur.json();
            autoRates.bcv = dataUsd.find(d => d.fuente === 'oficial')?.promedio || autoRates.bcv;
            autoRates.usdt = dataUsd.find(d => d.fuente === 'paralelo')?.promedio || autoRates.usdt;
            autoRates.eur = dataEur.find(d => d.fuente === 'oficial')?.promedio || autoRates.eur;
        }
    } catch (e) {
        console.warn('No se pudo conectar a dolarapi (modo offline o bloqueo de red):', e);
    }
    
    activeListeners.push(getDb('settings').doc('general').onSnapshot(doc => {
        if (doc && doc.exists) {
            const data = doc.data();
            rates.bcv = data.tasaManual ? data.tasaManual : autoRates.bcv;
            storeConfig.name = data.storeName || 'GestiónPro';
            storeConfig.rif = data.storeRif || '';
            storeConfig.logo = data.storeLogo || '';
            storeConfig.phone = data.storePhone || '';
            storeConfig.nroFactura = data.nroFactura || 1001;
            storeConfig.nroControl = data.nroControl || '00-001001';
        } else {
            rates.bcv = autoRates.bcv;
            if (navigator.onLine) {
                getDb('settings').doc('general').set({
                    storeName: 'GestiónPro',
                    nroFactura: 1001,
                    nroControl: '00-001001'
                }, { merge: true }).catch(err => console.warn('Init settings/general:', err));
            }
        }
        rates.usdt = autoRates.usdt;
        rates.eur = autoRates.eur;

        // Persistir en caché local (prefijada por uid)
        guardarCache('rates', rates);
        guardarCache('storeConfig', storeConfig);

        // Sin innerHTML: estas dos asignaciones eran el mejor vector de XSS
        // almacenado del sistema, porque se ejecutan al iniciar sesión tanto
        // para el dueño como para el cajero, y storeConfig viene de Firestore
        // (escribible por cualquier autenticado de cualquier inquilino antes
        // de estas reglas).
        pintarNombreTienda(document.getElementById('sidebar-store-name'), storeConfig.name);
        const rifEl = document.getElementById('sidebar-store-rif');
        if (rifEl) rifEl.textContent = storeConfig.rif ? `RIF: ${storeConfig.rif}` : '';
        pintarLogo(document.getElementById('sidebar-store-logo'), storeConfig.logo);
        const rateBcv = document.getElementById('rate-bcv');
        if (rateBcv) rateBcv.innerHTML = `Bs ${rates.bcv.toFixed(2)}`;
        const rateUsdt = document.getElementById('rate-usdt');
        if (rateUsdt) rateUsdt.textContent = `Bs ${rates.usdt.toFixed(2)}`;
        const rateEur = document.getElementById('rate-eur');
        if (rateEur) rateEur.textContent = `Bs ${rates.eur.toFixed(2)}`;
        
        updateCartUI();
        if (isAdmin) {
            renderInventory();
            renderReports();
        }
    }, err => {
        console.warn('Listener settings/general error (operando con datos locales):', err);
    }));
}

async function editarTasa() {
    if (!isAdmin) return Swal.fire('Error', 'Solo administradores', 'error');
    const { value: nuevaTasa } = await Swal.fire({
        title: 'Forzar Tasa de Cambio',
        input: 'number',
        inputLabel: 'Tasa BCV Manual (déjalo en blanco para automático)',
        inputValue: rates.bcv,
        inputAttributes: { step: '0.01' },
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar'
    });
    if (nuevaTasa !== undefined) {
        if (nuevaTasa === '') {
            getDb('settings').doc('general').set({ tasaManual: firebase.firestore.FieldValue.delete() }, { merge: true });
        } else {
            getDb('settings').doc('general').set({ tasaManual: parseFloat(nuevaTasa) }, { merge: true });
        }
        Swal.fire('¡Actualizado!', 'La tasa ha sido guardada.', 'success');
    }
}

// =====================================================
// CONTROL DE VENCIMIENTOS
// =====================================================
function getVencimientoInfo(fechaVenc) {
    if (!fechaVenc) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(fechaVenc + 'T00:00:00');
    const diffTime = exp - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
        return {
            dias: diffDays,
            status: 'vencido',
            badge: `<span class="px-2 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-700 border border-rose-300"><i class="fa-solid fa-triangle-exclamation"></i> Vencido (${Math.abs(diffDays)}d)</span>`
        };
    } else if (diffDays <= 7) {
        return {
            dias: diffDays,
            status: 'critico',
            badge: `<span class="px-2 py-0.5 rounded-full text-xs font-black bg-rose-50 text-rose-600 border border-rose-200"><i class="fa-solid fa-circle text-rose-500 mr-1 text-[8px]"></i>${diffDays} días</span>`
        };
    } else if (diffDays <= 30) {
        return {
            dias: diffDays,
            status: 'proximo',
            badge: `<span class="px-2 py-0.5 rounded-full text-xs font-black bg-amber-50 text-amber-700 border border-amber-200"><i class="fa-solid fa-circle text-amber-500 mr-1 text-[8px]"></i>${diffDays} días</span>`
        };
    } else {
        return {
            dias: diffDays,
            status: 'ok',
            badge: `<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><i class="fa-solid fa-circle text-emerald-500 mr-1 text-[8px]"></i>>30 días</span>`
        };
    }
}

// =====================================================
// INVENTARIO
// =====================================================
function renderInventory() {
    if (!isAdmin) return;
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    let lowStockCount = 0;
    products.forEach(p => {
        const stockNum = parseFloat(p.stock) || 0;
        const precioNum = parseFloat(p.precio) || 0;
        const costoNum = parseFloat(p.costo) || 0;
        if (stockNum < 5) lowStockCount++;
        const stockClass = stockNum < 5 ? 'text-rose-500 font-black' : 'text-slate-700 dark:text-slate-200';
        const isWeighed = p.tipo === 'Kg';
        const vencInfo = getVencimientoInfo(p.fechaVencimiento);
        const vencHtml = vencInfo ? vencInfo.badge : '<span class="text-xs text-slate-300">-</span>';
        const marcaHtml = p.marca ? `<span class="inline-block mt-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/40 mr-1"><i class="fa-solid fa-tag text-[9px] mr-1"></i>${p.marca}</span>` : '';
        const imgHtml = p.imagen 
            ? `<div class="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-700 shrink-0 border border-slate-200 dark:border-slate-700"><img src="${p.imagen}" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<div class=\\\'w-full h-full flex items-center justify-center text-slate-400 text-xs\\\'>📦</div>'"></div>`
            : `<div class="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 shrink-0 flex items-center justify-center border border-slate-200 dark:border-slate-700/60 text-xs"><i class="fa-solid fa-image"></i></div>`;
        tbody.innerHTML += `
            <tr class="hover:bg-white/60 dark:hover:bg-slate-800/40 transition border-b border-white/40 dark:border-slate-800">
                <td class="p-4 text-sm font-medium text-slate-500 dark:text-slate-400">${p.codigo || ''}</td>
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        ${imgHtml}
                        <div class="min-w-0">
                            <div class="font-bold text-slate-800 dark:text-slate-100">${p.nombre}</div>
                            ${marcaHtml}
                        </div>
                    </div>
                </td>
                <td class="p-4"><span class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-bold uppercase text-slate-600 dark:text-slate-300">${p.categoria}</span></td>
                <td class="p-4 text-center">${vencHtml}</td>
                <td class="p-4 text-right ${stockClass}">${stockNum.toFixed(2)} ${p.tipo}</td>
                <td class="p-4 text-right text-emerald-600 font-black">V: $${precioNum.toFixed(2)}<br><span class="text-xs text-rose-500">C: $${costoNum.toFixed(2)}</span></td>
                <td class="p-4 text-center">
                    ${isWeighed ? `<button onclick="openBarcodeModal('${p.id}')" class="w-8 h-8 rounded-full bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 shadow-sm mr-1" title="Imprimir Código"><i class="fa-solid fa-barcode"></i></button>` : ''}
                    <button onclick="editProduct('${p.id}')" class="w-8 h-8 rounded-full bg-white dark:bg-slate-700 text-blue-500 shadow-sm mr-1" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="deleteProduct('${p.id}')" class="w-8 h-8 rounded-full bg-white dark:bg-slate-700 text-rose-500 shadow-sm" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    });
    const badge = document.getElementById('badge-stock');
    if (badge) {
        if (lowStockCount > 0) {
            badge.classList.remove('hidden');
            badge.textContent = lowStockCount;
        } else {
            badge.classList.add('hidden');
        }
    }
    const searchVal = document.getElementById('search-inventory')?.value;
    if (searchVal) filterInventory(searchVal);
}

function filterInventory(query) {
    const tbody = document.getElementById('inventory-table-body');
    if (!tbody) return;
    const q = (query || '').toLowerCase().trim();
    const rows = tbody.getElementsByTagName('tr');
    for (let r of rows) {
        if (!q) {
            r.style.display = '';
        } else {
            const text = r.textContent.toLowerCase();
            r.style.display = text.includes(q) ? '' : 'none';
        }
    }
}
window.filterInventory = filterInventory;

// =====================================================
// GESTIÓN Y COMPRESIÓN DE FOTOGRAFÍAS DE PRODUCTOS
// =====================================================
let prodCameraStream = null;

function comprimirImagenBase64(dataUrl, maxW = 400, maxH = 400, quality = 0.82, callback) {
    const img = new Image();
    img.onload = function() {
        let width = img.width;
        let height = img.height;
        if (width > height) {
            if (width > maxW) {
                height = Math.round((height * maxW) / width);
                width = maxW;
            }
        } else {
            if (height > maxH) {
                width = Math.round((width * maxH) / height);
                height = maxH;
            }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        let result = '';
        try {
            result = canvas.toDataURL('image/webp', quality);
            if (!result || result.indexOf('data:image/webp') !== 0) {
                result = canvas.toDataURL('image/jpeg', quality);
            }
        } catch (err) {
            result = canvas.toDataURL('image/jpeg', quality);
        }
        if (callback) callback(result);
    };
    img.onerror = function() {
        if (callback) callback(dataUrl);
    };
    img.src = dataUrl;
}

function procesarFotoArchivo(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (!file.type.startsWith('image/')) {
        return Swal.fire('Archivo no válido', 'Por favor selecciona un archivo de imagen (JPG, PNG, WebP).', 'warning');
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        comprimirImagenBase64(e.target.result, 400, 400, 0.82, function(compressedBase64) {
            establecerFotoProducto(compressedBase64, false);
        });
    };
    reader.readAsDataURL(file);
}

function establecerFotoProducto(src, esUrlWeb = false) {
    const preview = document.getElementById('prod-img-preview');
    const placeholder = document.getElementById('prod-img-placeholder-icon');
    const btnEliminar = document.getElementById('btn-eliminar-foto-prod');
    const inputBase64 = document.getElementById('prod-img-base64');
    const inputUrl = document.getElementById('prod-img-url');

    if (!src) {
        eliminarFotoProducto();
        return;
    }

    if (preview) {
        preview.src = src;
        preview.classList.remove('hidden');
    }
    if (placeholder) placeholder.classList.add('hidden');
    if (btnEliminar) btnEliminar.classList.remove('hidden');

    if (esUrlWeb) {
        if (inputUrl) inputUrl.value = src;
        if (inputBase64) inputBase64.value = '';
    } else {
        if (inputBase64) inputBase64.value = src;
        if (inputUrl) inputUrl.value = '';
    }
}

function actualizarImagenPorUrl(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) {
        eliminarFotoProducto();
        return;
    }
    establecerFotoProducto(trimmed, true);
}

function eliminarFotoProducto() {
    const preview = document.getElementById('prod-img-preview');
    const placeholder = document.getElementById('prod-img-placeholder-icon');
    const btnEliminar = document.getElementById('btn-eliminar-foto-prod');
    const inputBase64 = document.getElementById('prod-img-base64');
    const inputUrl = document.getElementById('prod-img-url');
    const inputFile = document.getElementById('prod-img-file-input');

    if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (btnEliminar) btnEliminar.classList.add('hidden');
    if (inputBase64) inputBase64.value = '';
    if (inputUrl) inputUrl.value = '';
    if (inputFile) inputFile.value = '';
}

async function iniciarCamaraProducto() {
    const modal = document.getElementById('camera-product-modal');
    const video = document.getElementById('prod-camera-video');
    const loading = document.getElementById('prod-camera-loading');

    if (!modal || !video) return;

    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    if (loading) loading.classList.remove('hidden');

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Tu navegador no soporta captura de cámara directa.');
        }

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 640 },
                    height: { ideal: 640 }
                },
                audio: false
            });
        } catch (firstErr) {
            stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
            });
        }

        prodCameraStream = stream;
        video.srcObject = stream;
        video.setAttribute('playsinline', true);
        await video.play();
        if (loading) loading.classList.add('hidden');
    } catch (err) {
        if (loading) loading.classList.add('hidden');
        detenerCamaraProducto();
        Swal.fire({
            icon: 'error',
            title: 'No se pudo acceder a la cámara',
            text: err.name === 'NotAllowedError' 
                ? 'Permiso de cámara denegado. Permite el acceso a la cámara o sube una foto desde tu galería.' 
                : (err.message || 'Error al iniciar la cámara.'),
            confirmButtonColor: '#4f46e5'
        });
    }
}

function detenerCamaraProducto() {
    if (prodCameraStream) {
        prodCameraStream.getTracks().forEach(track => track.stop());
        prodCameraStream = null;
    }
    const video = document.getElementById('prod-camera-video');
    if (video) video.srcObject = null;

    const modal = document.getElementById('camera-product-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 250);
    }
}

function capturarFotoCamara() {
    const video = document.getElementById('prod-camera-video');
    if (!video || !video.videoWidth) {
        return Swal.fire('Aviso', 'Esperando señal de la cámara...', 'info');
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const minDim = Math.min(vw, vh);
    const sx = (vw - minDim) / 2;
    const sy = (vh - minDim) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, 400, 400);

    let compressed = '';
    try {
        compressed = canvas.toDataURL('image/webp', 0.82);
        if (!compressed || compressed.indexOf('data:image/webp') !== 0) {
            compressed = canvas.toDataURL('image/jpeg', 0.82);
        }
    } catch (e) {
        compressed = canvas.toDataURL('image/jpeg', 0.82);
    }

    establecerFotoProducto(compressed, false);
    detenerCamaraProducto();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: '¡Foto capturada con éxito!',
        timer: 1800,
        showConfirmButton: false
    });
}

function openProductModal() {
    if (!isAdmin) return;
    document.getElementById('prod-id').value = '';
    document.getElementById('prod-codigo').value = '';
    document.getElementById('prod-nombre').value = '';
    const mInput = document.getElementById('prod-marca');
    if (mInput) mInput.value = '';
    document.getElementById('prod-precio').value = '';
    document.getElementById('prod-costo').value = '';
    document.getElementById('prod-stock').value = '';
    const vInput = document.getElementById('prod-vencimiento');
    if (vInput) vInput.value = '';
    eliminarFotoProducto();
    const m = document.getElementById('product-modal');
    const c = document.getElementById('product-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
}

function closeProductModal() {
    detenerCamaraProducto();
    const m = document.getElementById('product-modal');
    const c = document.getElementById('product-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

async function saveProduct() {
    if (!isAdmin) return;
    const vInput = document.getElementById('prod-vencimiento');
    const mInput = document.getElementById('prod-marca');
    const base64Val = document.getElementById('prod-img-base64') ? document.getElementById('prod-img-base64').value : '';
    const urlVal = document.getElementById('prod-img-url') ? document.getElementById('prod-img-url').value.trim() : '';
    const imagenFinal = base64Val || urlVal || '';

    const prodData = {
        codigo: document.getElementById('prod-codigo').value.trim(),
        nombre: document.getElementById('prod-nombre').value.trim(),
        marca: mInput ? mInput.value.trim() : '',
        categoria: document.getElementById('prod-categoria').value,
        precio: parseFloat(document.getElementById('prod-precio').value),
        costo: parseFloat(document.getElementById('prod-costo').value) || 0,
        stock: parseFloat(document.getElementById('prod-stock').value),
        tipo: document.getElementById('prod-tipo').value,
        fechaVencimiento: vInput ? vInput.value || null : null,
        imagen: imagenFinal
    };
    if (!prodData.nombre || isNaN(prodData.precio) || isNaN(prodData.stock)) {
        return Swal.fire('Error', 'Faltan datos obligatorios', 'error');
    }
    try {
        const id = document.getElementById('prod-id').value;
        if (id) await getDb('products').doc(id).update(prodData);
        else await getDb('products').add(prodData);
        closeProductModal();
    } catch (e) {
        Swal.fire('Error', e.message, 'error');
    }
}

function editProduct(id) {
    if (!isAdmin) return;
    const p = products.find(p => p.id === id);
    if (!p) return;
    document.getElementById('prod-id').value = p.id;
    document.getElementById('prod-codigo').value = p.codigo || '';
    document.getElementById('prod-nombre').value = p.nombre;
    const mInput = document.getElementById('prod-marca');
    if (mInput) mInput.value = p.marca || '';
    document.getElementById('prod-categoria').value = p.categoria;
    document.getElementById('prod-precio').value = p.precio;
    document.getElementById('prod-costo').value = p.costo || 0;
    document.getElementById('prod-stock').value = p.stock;
    document.getElementById('prod-tipo').value = p.tipo;
    const vInput = document.getElementById('prod-vencimiento');
    if (vInput) vInput.value = p.fechaVencimiento || '';
    
    if (p.imagen) {
        establecerFotoProducto(p.imagen, p.imagen.startsWith('http'));
    } else {
        eliminarFotoProducto();
    }

    const m = document.getElementById('product-modal');
    const c = document.getElementById('product-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
}

function deleteProduct(id) {
    if (!isAdmin) return;
    Swal.fire({
        title: '¿Eliminar?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sí'
    }).then(r => {
        if (r.isConfirmed) getDb('products').doc(id).delete();
    });
}

// =====================================================
// ETIQUETA DE BALANZA
// =====================================================
function setBarcodeUnit(unit) {
    currentBarcodeUnit = unit;
    const btnKg = document.getElementById('btn-unit-kg');
    const btnG = document.getElementById('btn-unit-g');
    const unitLabel = document.getElementById('barcode-input-unit-label');
    const input = document.getElementById('barcode-weight');
    if (btnKg && btnG) {
        if (unit === 'kg') {
            btnKg.className = 'px-2.5 py-1 rounded-lg bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm transition-all';
            btnG.className = 'px-2.5 py-1 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all';
            if (unitLabel) unitLabel.textContent = 'Kg';
            if (input && !input.value) input.placeholder = '2.0';
        } else {
            btnG.className = 'px-2.5 py-1 rounded-lg bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm transition-all';
            btnKg.className = 'px-2.5 py-1 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all';
            if (unitLabel) unitLabel.textContent = 'g';
            if (input && !input.value) input.placeholder = '2000';
        }
    }
    updateBarcodeLiveTotal();
}

function setPresetWeight(kilos) {
    const input = document.getElementById('barcode-weight');
    if (!input) return;
    if (currentBarcodeUnit === 'kg') {
        input.value = kilos.toString();
    } else {
        input.value = Math.round(kilos * 1000).toString();
    }
    updateBarcodeLiveTotal();
}

function updateBarcodeLiveTotal() {
    const id = document.getElementById('barcode-prod-id')?.value;
    const prod = products.find(p => p.id === id);
    const totalEl = document.getElementById('barcode-live-total');
    if (!prod || !totalEl) return;
    const raw = (document.getElementById('barcode-weight')?.value || '').trim().replace(',', '.');
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) {
        totalEl.textContent = '$0.00';
        return;
    }
    let kilos = currentBarcodeUnit === 'kg' ? val : val / 1000;
    const total = kilos * (prod.precio || 0);
    totalEl.textContent = `$${total.toFixed(2)}`;
}

function openBarcodeModal(id) {
    const prod = products.find(p => p.id === id);
    if (!prod) return;
    document.getElementById('barcode-prod-id').value = id;
    const titleEl = document.getElementById('barcode-prod-title');
    if (titleEl) titleEl.textContent = prod.nombre;
    const badgeEl = document.getElementById('barcode-prod-price-badge');
    if (badgeEl) badgeEl.textContent = `$${(prod.precio || 0).toFixed(2)} / Kg`;
    document.getElementById('barcode-weight').value = '';
    setBarcodeUnit('kg');
    const m = document.getElementById('barcode-modal');
    const c = document.getElementById('barcode-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        if (c) c.classList.remove('scale-95');
        document.getElementById('barcode-weight').focus();
    }, 10);
}

function closeBarcodeModal() {
    const m = document.getElementById('barcode-modal');
    const c = document.getElementById('barcode-modal-content');
    m.classList.add('opacity-0');
    if (c) c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

function printBarcode() {
    const id = document.getElementById('barcode-prod-id').value;
    const prod = products.find(p => p.id === id);
    if (!prod) return Swal.fire('Error', 'Producto no encontrado', 'error');
    const weightInput = (document.getElementById('barcode-weight').value || '').trim();
    if (!weightInput) return Swal.fire('Atención', 'Ingresa el peso', 'warning');
    const pesoNum = parseFloat(weightInput.replace(',', '.'));
    if (isNaN(pesoNum) || pesoNum <= 0) return Swal.fire('Error', 'Peso inválido', 'error');
    let weightGrams = 0;
    if (currentBarcodeUnit === 'kg') {
        weightGrams = pesoNum > 25 ? Math.round(pesoNum) : Math.round(pesoNum * 1000);
    } else {
        weightGrams = Math.round(pesoNum);
    }
    if (weightGrams <= 0) return Swal.fire('Error', 'Peso debe ser > 0', 'error');
    let codigoProd = (prod.codigo || '').trim();
    if (!codigoProd) {
        codigoProd = prod.id ? prod.id.slice(-4).toLowerCase() : '0001';
        try {
            getDb('products').doc(prod.id).update({ codigo: codigoProd });
            prod.codigo = codigoProd;
        } catch (e) {}
    }
    const barcodeVal = `p-${codigoProd}-${weightGrams}`;
    const vencStr = prod.fechaVencimiento ? `<p style="margin:2px 0 0 0; font-size:11px; font-weight:700; color:#dc2626;">VENCE: ${prod.fechaVencimiento}</p>` : '';
    const fechaEmpaque = new Date().toLocaleDateString('es-VE');

    // Generar código de barras en un svg virtual para obtener un Data URL limpio
    const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    try {
        JsBarcode(tempSvg, barcodeVal, { width: 2, height: 45, fontSize: 12, margin: 0, fontOptions: "bold" });
    } catch (e) {
        console.error("Error al generar código de barras:", e);
    }
    const svgXml = new XMLSerializer().serializeToString(tempSvg);
    const barcodeSvgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgXml);

    closeBarcodeModal();

    const labelHtml = `
        <div style="text-align:center; font-family: 'Plus Jakarta Sans', Arial, sans-serif; padding: 4px; width: 60mm; margin: 0 auto;">
            <h4 style="margin: 0 0 2px 0; font-size: 14px; text-transform: uppercase; font-weight: 800;">${prod.nombre}</h4>
            <p style="margin: 0; font-size: 10px; color: #555;">Empacado: ${fechaEmpaque}</p>
            ${vencStr}
            <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 3px 0; margin: 4px 0;">
                <span>Peso: ${(weightGrams / 1000).toFixed(3)} Kg</span>
                <span>$${(prod.precio || 0).toFixed(2)}/Kg</span>
            </div>
            <div style="display: flex; justify-content: center; margin: 4px 0;">
                <img src="${barcodeSvgDataUrl}" style="max-width: 100%; height: 45px; display: block; margin: 0 auto;" alt="Código">
            </div>
            <p style="margin: 3px 0 0 0; font-size: 16px; font-weight: 900;">Total: $${((prod.precio || 0) * (weightGrams / 1000)).toFixed(2)}</p>
        </div>`;

    imprimirTicketAislado(labelHtml, { width: '60mm' });
}

// =====================================================
// POS Y ESCÁNER
// =====================================================
function procesarCodigoEscaneado(val) {
    if (!val) return false;
    val = val.trim();
    
    // Soporte para multiplicador rápido de cantidad (ej: "3*harina", "10*75912345", "2.5*queso", "5xharina")
    let multiplier = 1;
    const multMatch = val.match(/^([0-9]+(?:[\.,][0-9]+)?)\s*[\*xX]\s*(.+)$/);
    if (multMatch) {
        const parsedMult = parseFloat(multMatch[1].replace(',', '.'));
        if (parsedMult > 0) {
            multiplier = parsedMult;
            val = multMatch[2].trim();
        }
    }

    val = val.toLowerCase();
    if (val.startsWith('p-')) {
        const parts = val.split('-');
        if (parts.length === 3) {
            const code = parts[1];
            const grams = parseInt(parts[2]);
            const m = products.find(p => p.codigo && p.codigo.toLowerCase() === code);
            if (m) {
                const finalKg = (grams / 1000) * multiplier;
                addToCart(m, finalKg);
                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `${m.nombre} (${finalKg.toFixed(3)} Kg)`, timer: 1500, showConfirmButton: false });
                return true;
            }
        }
    }
    const m = products.find(p => p.codigo && p.codigo.toLowerCase() === val);
    if (m) {
        if (m.tipo === 'Unidad') {
            addToCart(m, multiplier);
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `${multiplier > 1 ? multiplier + 'x ' : ''}${m.nombre} agregado`, timer: 1500, showConfirmButton: false });
        } else {
            if (multiplier > 1) {
                addToCart(m, multiplier);
            } else {
                addToCartPrompt(m.id);
            }
        }
        return true;
    }
    const filtered = products.filter(p =>
        (p.nombre || '').toLowerCase().includes(val) ||
        (p.categoria || '').toLowerCase().includes(val) ||
        (p.codigo || '').toLowerCase().includes(val)
    );
    if (filtered.length >= 1) {
        const f = filtered[0];
        if (f.tipo === 'Unidad') {
            addToCart(f, multiplier);
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `${multiplier > 1 ? multiplier + 'x ' : ''}${f.nombre} agregado`, timer: 1500, showConfirmButton: false });
        } else {
            if (multiplier > 1) {
                addToCart(f, multiplier);
            } else {
                addToCartPrompt(f.id);
            }
        }
        return true;
    }
    return false;
}

async function openCameraScanner() {
    const modal = document.getElementById('camera-scanner-modal');
    const content = document.getElementById('camera-scanner-modal-content');
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        if (content) content.classList.remove('scale-95');
    }, 10);
    if (typeof Html5Qrcode === 'undefined') {
        document.getElementById('camera-reader').innerHTML = '<p class="text-rose-400 p-4">Librería no disponible.</p>';
        return;
    }
    try {
        if (html5QrScannerInstance) {
            try { await html5QrScannerInstance.stop(); } catch (e) {}
            html5QrScannerInstance = null;
        }
        html5QrScannerInstance = new Html5Qrcode("camera-reader");
        const config = { fps: 15, qrBox: { width: 250, height: 250 }, aspectRatio: 1.0 };
        await html5QrScannerInstance.start(
            { facingMode: "environment" },
            config,
            (decodedText) => {
                const encontrado = procesarCodigoEscaneado(decodedText);
                if (encontrado) closeCameraScanner();
                else Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: `No encontrado: ${decodedText}`, timer: 2000, showConfirmButton: false });
            },
            () => {}
        );
    } catch (err) {
        document.getElementById('camera-reader').innerHTML = `<div class="p-4 text-center text-rose-300"><i class="fa-solid fa-triangle-exclamation text-2xl mb-2"></i><p>No se pudo acceder a la cámara.</p><p class="text-[10px] text-slate-400 mt-1">${err.message || 'Verifica permisos'}</p></div>`;
    }
}

async function closeCameraScanner() {
    if (html5QrScannerInstance) {
        try { await html5QrScannerInstance.stop(); } catch (e) {}
        html5QrScannerInstance = null;
    }
    const modal = document.getElementById('camera-scanner-modal');
    const content = document.getElementById('camera-scanner-modal-content');
    if (modal) {
        modal.classList.add('opacity-0');
        if (content) content.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
}

function setupBarcodeScanner() {
    const input = document.getElementById('search-pos');
    if (!input) return;
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = input.value.trim();
            if (!val) return;
            const exito = procesarCodigoEscaneado(val);
            if (exito) {
                input.value = '';
                triggerSearch('');
            }
        }
    });
    input.addEventListener('input', (e) => triggerSearch(e.target.value.toLowerCase()));
}

function triggerSearch(t) {
    const cards = document.getElementById('pos-products-grid')?.children;
    if (!cards) return;
    products.forEach((p, i) => {
        if (cards[i]) {
            const nom = (p.nombre || '').toLowerCase();
            const cat = (p.categoria || '').toLowerCase();
            const cod = (p.codigo || '').toLowerCase();
            const matchesText = !t || (nom.includes(t) || cat.includes(t) || cod.includes(t));
            const matchesCat = (currentPOSCategory === 'Todos') || (p.categoria === currentPOSCategory);
            cards[i].style.display = (matchesText && matchesCat) ? 'flex' : 'none';
        }
    });
}

function renderPOSCategoryChips() {
    const container = document.getElementById('pos-category-chips');
    if (!container) return;
    
    const catSet = new Set();
    products.forEach(p => {
        if (p.categoria && p.categoria.trim()) catSet.add(p.categoria.trim());
    });
    const categories = ['Todos', ...Array.from(catSet).sort()];
    
    container.innerHTML = categories.map(cat => {
        const isActive = (currentPOSCategory === cat);
        const activeClass = isActive 
            ? 'bg-primary-600 text-white font-black shadow-xs' 
            : 'bg-white/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 border border-slate-200/70 dark:border-slate-700/60 font-bold';
        return `<button type="button" onclick="filterPOSByCategory('${encodeURIComponent(cat)}')" class="px-3 py-1.5 rounded-xl text-xs transition-all whitespace-nowrap active:scale-95 ${activeClass}">${cat}</button>`;
    }).join('');
}
window.renderPOSCategoryChips = renderPOSCategoryChips;

function filterPOSByCategory(catEncoded) {
    currentPOSCategory = decodeURIComponent(catEncoded);
    renderPOSCategoryChips();
    
    const searchVal = document.getElementById('search-pos')?.value.toLowerCase().trim() || '';
    const cards = document.getElementById('pos-products-grid')?.children;
    if (!cards) return;
    
    products.forEach((p, i) => {
        if (cards[i]) {
            const nom = (p.nombre || '').toLowerCase();
            const cat = (p.categoria || '').toLowerCase();
            const cod = (p.codigo || '').toLowerCase();
            const matchesText = !searchVal || (nom.includes(searchVal) || cat.includes(searchVal) || cod.includes(searchVal));
            const matchesCat = (currentPOSCategory === 'Todos') || (p.categoria === currentPOSCategory);
            cards[i].style.display = (matchesText && matchesCat) ? 'flex' : 'none';
        }
    });
}
window.filterPOSByCategory = filterPOSByCategory;

function renderPOSProducts() {
    const grid = document.getElementById('pos-products-grid');
    if (!grid) return;
    grid.innerHTML = '';
    renderPOSCategoryChips();
    const currentBcv = rates.bcv || 1;
    products.forEach(p => {
        const precioNum = parseFloat(p.precio) || 0;
        const stockNum = parseFloat(p.stock) || 0;
        const precioBs = (precioNum * currentBcv).toFixed(2);
        const vencInfo = getVencimientoInfo(p.fechaVencimiento);
        let vencBadge = '';
        if (vencInfo && (vencInfo.status === 'critico' || vencInfo.status === 'vencido')) {
            vencBadge = `<span class="ml-1 text-[9px] font-black px-1.5 py-0.5 rounded-md ${vencInfo.status === 'vencido' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}">${vencInfo.status === 'vencido' ? 'VENCIDO' : vencInfo.dias + 'd'}</span>`;
        }
        const c = document.createElement('div');
        c.className = "animated-card group bg-white/90 dark:bg-slate-800/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-700/60 rounded-2xl p-4 cursor-pointer flex flex-col justify-between shadow-xs hover:shadow-md transition-all active:scale-[0.98]";
        c.onclick = () => {
            if (!p.stock || p.stock <= 0) return Swal.fire('Error', 'No hay stock disponible', 'error');
            if (vencInfo && vencInfo.status === 'critico') {
                Swal.fire({ toast: true, position: 'top-end', icon: 'warning', title: `Atención: Vence en ${vencInfo.dias} días`, timer: 2000, showConfirmButton: false });
            }
            const tipoLower = String(p.tipo || '').toLowerCase().trim();
            const isUnidad = !p.tipo || ['unidad', 'und', 'unid', 'pz', 'pieza'].includes(tipoLower);
            if (isUnidad || storeConfig.businessType === 'comida_rapida') {
                addToCart(p, 1);
            } else {
                addToCartPrompt(p.id);
            }
        };

        const imgBannerHtml = p.imagen ? `
            <div class="w-full h-24 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-700/60 mb-2.5 relative flex items-center justify-center border border-slate-100 dark:border-slate-700/50">
                <img src="${p.imagen}" alt="${p.nombre}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onerror="this.parentElement.style.display='none';">
            </div>
        ` : '';

        c.innerHTML = `
            <div>
                ${imgBannerHtml}
                <div class="flex items-center justify-between gap-1">
                    <span class="text-[10px] text-primary-600 dark:text-primary-400 font-extrabold uppercase tracking-wider bg-primary-50 dark:bg-primary-950/60 px-2 py-0.5 rounded-lg border border-primary-100/60 dark:border-primary-900/40 truncate max-w-[110px]">${p.categoria || 'General'}</span>
                    <div class="flex items-center gap-1">
                        ${p.marca ? `<span class="text-[9px] font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/40 truncate max-w-[80px]">${p.marca}</span>` : ''}
                        ${vencBadge}
                    </div>
                </div>
                <h4 class="font-extrabold text-slate-800 dark:text-slate-100 text-sm mt-2 leading-snug group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors line-clamp-2">${p.nombre}</h4>
            </div>
            <div class="mt-3.5 pt-2.5 border-t border-slate-100 dark:border-slate-700/60 flex justify-between items-end">
                <div>
                    <div class="text-emerald-600 dark:text-emerald-400 font-black text-xl tabular-nums leading-tight">$${precioNum.toFixed(2)}</div>
                    <div class="text-[11px] font-bold text-slate-400 dark:text-slate-500 tabular-nums">Bs ${precioBs}</div>
                </div>
                <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/60 px-2.5 py-1 rounded-xl tabular-nums shrink-0">${stockNum.toFixed(1)} ${p.tipo}</span>
            </div>`;
        grid.appendChild(c);
    });

    // Si había una categoría seleccionada previamente, aplicarla al re-renderizar
    if (currentPOSCategory !== 'Todos') {
        filterPOSByCategory(encodeURIComponent(currentPOSCategory));
    }
}

// =====================================================
// TICKET EN ESPERA (PARK / HOLD CART) & ATAJOS GLOBALES
// =====================================================
function toggleHoldTicket() {
    const badgeEl = document.getElementById('hold-cart-badge');
    const labelEl = document.getElementById('hold-cart-label');

    if (cart.length > 0) {
        if (heldTicket && heldTicket.items && heldTicket.items.length > 0) {
            Swal.fire({
                title: 'Ticket en Espera',
                text: 'Ya tienes un ticket en espera guardado. ¿Deseas intercambiarlo con el ticket actual?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Sí, intercambiar',
                cancelButtonText: 'Cancelar'
            }).then(res => {
                if (res.isConfirmed) {
                    const temp = [...cart];
                    cart.length = 0;
                    cart.push(...heldTicket.items);
                    heldTicket = { items: temp, timestamp: Date.now() };
                    updateCartUI();
                    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Ticket restaurado (el otro quedó en espera)', timer: 1800, showConfirmButton: false });
                }
            });
            return;
        }

        heldTicket = {
            items: [...cart],
            timestamp: Date.now()
        };
        cart.length = 0;
        updateCartUI();
        if (badgeEl) {
            badgeEl.classList.remove('hidden');
            badgeEl.textContent = '1';
        }
        if (labelEl) labelEl.textContent = 'Recuperar (F8)';
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'info',
            title: '⏸️ Ticket puesto en espera (F8)',
            timer: 2000,
            showConfirmButton: false
        });
        const s = document.getElementById('search-pos');
        if (s) s.focus();
    } else if (heldTicket && heldTicket.items && heldTicket.items.length > 0) {
        cart.push(...heldTicket.items);
        heldTicket = null;
        updateCartUI();
        if (badgeEl) badgeEl.classList.add('hidden');
        if (labelEl) labelEl.textContent = 'Pausar (F8)';
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: '▶️ Ticket restaurado',
            timer: 1800,
            showConfirmButton: false
        });
        const s = document.getElementById('search-pos');
        if (s) s.focus();
    } else {
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'warning',
            title: 'Ticket vacío (agrega productos antes de pausar)',
            timer: 2000,
            showConfirmButton: false
        });
    }
}
window.toggleHoldTicket = toggleHoldTicket;

function setupKeyboardShortcuts() {
    if (window._keyboardShortcutsInitialized) return;
    window._keyboardShortcutsInitialized = true;

    document.addEventListener('keydown', (e) => {
        if (typeof Swal !== 'undefined' && Swal.isVisible()) {
            if (e.key === 'Escape') Swal.close();
            return;
        }

        const activeEl = document.activeElement;
        const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT');
        const paymentModal = document.getElementById('payment-modal');
        const isPaymentOpen = paymentModal && !paymentModal.classList.contains('hidden');

        // Escape: cerrar modales abiertos
        if (e.key === 'Escape') {
            if (isPaymentOpen) {
                closePaymentModal();
                return;
            }
            const cameraModal = document.getElementById('camera-scanner-modal');
            if (cameraModal && !cameraModal.classList.contains('hidden')) {
                closeCameraScanner();
                return;
            }
            const searchPos = document.getElementById('search-pos');
            if (searchPos && activeEl === searchPos && searchPos.value) {
                searchPos.value = '';
                triggerSearch('');
                return;
            }
        }

        // Si el Terminal de Cobro está abierto:
        if (isPaymentOpen) {
            if (e.key === 'Enter') {
                const btnConfirm = document.getElementById('btn-confirm-sale');
                if (btnConfirm && !btnConfirm.disabled) {
                    e.preventDefault();
                    confirmSale();
                    return;
                }
            }
            if (!isInput) {
                if (e.key === '1' || e.key === 'F1') {
                    e.preventDefault();
                    quickExactPayment('usd');
                } else if (e.key === '2' || e.key === 'F2') {
                    e.preventDefault();
                    quickExactPayment('pago-movil');
                } else if (e.key === '3' || e.key === 'F3') {
                    e.preventDefault();
                    quickExactPayment('punto');
                } else if (e.key === '4' || e.key === 'F4') {
                    e.preventDefault();
                    quickExactPayment('efectivo-bs');
                }
            }
            return;
        }

        // F2 o '/': Enfocar buscador de POS
        if (e.key === 'F2' || (!isInput && e.key === '/')) {
            e.preventDefault();
            switchTab('ventas');
            const search = document.getElementById('search-pos');
            if (search) {
                search.focus();
                search.select();
            }
            return;
        }

        // F4 o Barra Espaciadora (cuando no escribe en un input): Abrir Terminal de Cobro
        if (e.key === 'F4' || (!isInput && e.key === ' ')) {
            if (cart.length > 0) {
                e.preventDefault();
                openPaymentModal();
            }
            return;
        }

        // F8: Poner ticket en espera / Recuperar
        if (e.key === 'F8') {
            e.preventDefault();
            toggleHoldTicket();
            return;
        }

        // F9: Venta Rápida
        if (e.key === 'F9') {
            e.preventDefault();
            openVentaRapidaModal();
            return;
        }
    });
}
window.setupKeyboardShortcuts = setupKeyboardShortcuts;

async function openVentaRapidaModal() {
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    
    const { value: formValues } = await Swal.fire({
        title: '⚡ Venta Rápida / Varios',
        html: `
            <div class="space-y-3 text-left">
                <p class="text-xs text-slate-500 dark:text-slate-400">Ingresa un monto directo para cobrar sin registrar el producto en inventario.</p>
                <div>
                    <label class="block text-[11px] font-bold uppercase text-slate-500 mb-1">Concepto / Descripción</label>
                    <input id="swal-vr-desc" type="text" placeholder="Ej: Hielo, Cigarrillo suelto, Venta rápida..." value="Venta Rápida" class="swal2-input !m-0 !w-full !text-sm">
                </div>
                <div class="grid grid-cols-2 gap-2 mt-2">
                    <div>
                        <label class="block text-[11px] font-bold uppercase text-emerald-600 mb-1">Monto en Dólares ($)</label>
                        <input id="swal-vr-usd" type="number" step="0.01" placeholder="0.00" class="swal2-input !m-0 !w-full !text-base !font-black !text-emerald-600">
                    </div>
                    <div>
                        <label class="block text-[11px] font-bold uppercase text-teal-600 mb-1">Monto en Bolívares (Bs)</label>
                        <input id="swal-vr-bs" type="number" step="0.1" placeholder="0.00" class="swal2-input !m-0 !w-full !text-base !font-black !text-teal-600">
                    </div>
                </div>
                <p class="text-[10px] text-slate-400 font-semibold text-center mt-1">Tasa activa: Bs ${tasa.toFixed(2)} por $</p>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-plus mr-1"></i> Agregar al Ticket',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#f59e0b',
        didOpen: () => {
            const inUsd = document.getElementById('swal-vr-usd');
            const inBs = document.getElementById('swal-vr-bs');
            if (inUsd && inBs) {
                inUsd.focus();
                inUsd.addEventListener('input', () => {
                    const u = parseFloat(inUsd.value) || 0;
                    inBs.value = u > 0 ? (u * tasa).toFixed(2) : '';
                });
                inBs.addEventListener('input', () => {
                    const b = parseFloat(inBs.value) || 0;
                    inUsd.value = b > 0 ? (b / tasa).toFixed(2) : '';
                });
            }
        },
        preConfirm: () => {
            const desc = document.getElementById('swal-vr-desc').value.trim() || 'Venta Rápida';
            const usd = parseFloat(document.getElementById('swal-vr-usd').value) || 0;
            if (usd <= 0) {
                Swal.showValidationMessage('Ingresa un monto válido mayor a 0');
                return false;
            }
            return { desc, usd };
        }
    });

    if (formValues) {
        const itemRapido = {
            id: 'rapido_' + Date.now(),
            codigo: 'VAR-00',
            nombre: formValues.desc,
            marca: 'Varios',
            categoria: 'Varios',
            precio: roundMoney(formValues.usd),
            costo: 0,
            stock: 9999,
            tipo: 'Unidad'
        };
        addToCart(itemRapido, 1);
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: `Agregado: ${formValues.desc} ($${formValues.usd.toFixed(2)})`,
            timer: 1500,
            showConfirmButton: false
        });
    }
}

async function addToCartPrompt(id) {
    const prod = products.find(p => p.id === id);
    if (!prod || prod.stock <= 0) return Swal.fire('Error', 'No hay stock', 'error');
    const { value: qty } = await Swal.fire({
        title: prod.nombre,
        input: 'number',
        inputValue: '1',
        showCancelButton: true,
        inputAttributes: {
            min: prod.tipo === 'Kg' ? '0.01' : '1',
            max: prod.stock,
            step: prod.tipo === 'Kg' ? 'any' : '1'
        }
    });
    if (qty) addToCart(prod, parseFloat(qty));
    document.getElementById('search-pos').focus();
}

function addToCart(prod, q) {
    const isComida = storeConfig.businessType === 'comida_rapida';
    const cant = Math.max(1, q || 1);

    if (isComida) {
        // En comida rápida, cada plato preparado es independiente para que si hay 2 personas en una mesa
        // (ej: una quiere burger "con todo" y la otra "sin vegetales"), cada plato tenga sus propias salsas/notas.
        const totalActualMismoProd = cart.filter(x => x.id === prod.id).reduce((acc, x) => acc + x.qty, 0);
        if (totalActualMismoProd + cant > (prod.stock || Infinity)) {
            return Swal.fire('Error', 'Supera stock disponible', 'error');
        }
        for (let n = 0; n < cant; n++) {
            cart.push({
                ...prod,
                cartItemId: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                precioBase: Number(prod.precio),
                qty: 1,
                modificadores: null
            });
        }
    } else {
        const ex = cart.find(i => i.id === prod.id && !i.modificadores);
        if (ex) {
            if (ex.qty + cant > prod.stock) return Swal.fire('Error', 'Supera stock disponible', 'error');
            ex.qty += cant;
        } else {
            cart.push({
                ...prod,
                cartItemId: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                precioBase: Number(prod.precio),
                qty: cant,
                modificadores: null
            });
        }
    }
    updateCartUI();
    const cartEl = document.getElementById('cart-items');
    if (cartEl) {
        setTimeout(() => {
            cartEl.scrollTop = cartEl.scrollHeight;
        }, 50);
    }
}

function separarPlatoEnItems(idx) {
    const item = cart[idx];
    if (!item || item.qty <= 1) return;
    const totalQty = Math.floor(item.qty);
    const baseMods = item.modificadores ? JSON.parse(JSON.stringify(item.modificadores)) : null;
    item.qty = 1;
    const newItems = [];
    for (let i = 1; i < totalQty; i++) {
        newItems.push({
            ...item,
            cartItemId: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            qty: 1,
            modificadores: baseMods ? JSON.parse(JSON.stringify(baseMods)) : null
        });
    }
    cart.splice(idx + 1, 0, ...newItems);
    updateCartUI();
    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `Separado en ${totalQty} platos individuales para personalizar`,
        timer: 1500,
        showConfirmButton: false
    });
}

function editCartQty(idx) {
    const i = cart[idx];
    const prod = products.find(p => p.id === i.id);
    if (!prod) return;
    Swal.fire({
        title: 'Editar Cantidad',
        input: 'number',
        inputValue: i.qty,
        showCancelButton: true,
        inputAttributes: {
            min: prod.tipo === 'Kg' ? '0.01' : '1',
            max: prod.stock,
            step: prod.tipo === 'Kg' ? 'any' : '1'
        }
    }).then(res => {
        if (res.isConfirmed && res.value) {
            const val = parseFloat(res.value);
            if (val > prod.stock) return Swal.fire('Error', 'Supera stock', 'error');
            if (val <= 0) cart.splice(idx, 1);
            else cart[idx].qty = val;
            updateCartUI();
        }
    });
}

function changeCartQty(idx, delta) {
    const item = cart[idx];
    if (!item) return;
    const prod = products.find(p => p.id === item.id);
    const maxStock = prod ? parseFloat(prod.stock) : Infinity;

    // En comida rápida, si el usuario pulsa '+' para sumar otro plato del mismo tipo,
    // creamos un nuevo plato independiente para que se pueda personalizar por separado (ej: uno con todo, otro sin vegetales)
    if (storeConfig.businessType === 'comida_rapida' && delta > 0) {
        const totalActualMismoProd = cart.filter(x => x.id === item.id).reduce((acc, x) => acc + x.qty, 0);
        if (totalActualMismoProd + 1 > maxStock) {
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'warning',
                title: `Stock máximo: ${maxStock} ${item.tipo}`,
                timer: 2000,
                showConfirmButton: false
            });
            return;
        }
        const clone = {
            ...item,
            cartItemId: 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            qty: 1,
            modificadores: item.modificadores ? JSON.parse(JSON.stringify(item.modificadores)) : null
        };
        cart.splice(idx + 1, 0, clone);
        updateCartUI();
        return;
    }

    let step = delta;
    if (item.tipo === 'Kg' && Math.abs(item.qty) < 1 && Math.abs(delta) === 1) {
        step = delta * 0.25;
    }

    let newQty = Math.round((item.qty + step) * 1000) / 1000;
    if (newQty <= 0) {
        cart.splice(idx, 1);
        updateCartUI();
        return;
    }
    if (newQty > maxStock) {
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'warning',
            title: `Stock máximo: ${maxStock} ${item.tipo}`,
            timer: 2000,
            showConfirmButton: false
        });
        return;
    }
    item.qty = newQty;
    updateCartUI();
}

function updateCartUI() {
    const el = document.getElementById('cart-items');
    if (!el) return;
    el.innerHTML = '';
    currentSaleTotal = 0;
    let subtotal = 0;
    const currentBcv = rates.bcv || 1;

    // Actualizar badge en la cabecera del ticket
    const badgeEl = document.getElementById('ticket-item-count');
    if (badgeEl) {
        if (cart.length > 0) {
            badgeEl.classList.remove('hidden');
            badgeEl.textContent = `${cart.length} ${cart.length === 1 ? 'prod' : 'prods'}`;
        } else {
            badgeEl.classList.add('hidden');
        }
    }

    if (cart.length === 0) {
        el.innerHTML = `
            <div class="flex flex-col items-center justify-center text-center py-6 px-4">
                <div class="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center mb-2 shadow-inner">
                    <i class="fa-solid fa-basket-shopping text-base"></i>
                </div>
                <h5 class="font-extrabold text-slate-700 dark:text-slate-300 text-xs">Ticket Vacío</h5>
                <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 max-w-[170px]">Haz clic en un producto para añadir al cobro</p>
            </div>`;
    } else {
        cart.forEach((i, idx) => {
            const baseUnit = Number(i.precioBase !== undefined ? i.precioBase : i.precio);
            const extraUnit = i.modificadores?.extraCost ? Number(i.modificadores.extraCost) : 0;
            const precioUnitarioNum = roundMoney(baseUnit + extraUnit);
            i.precio = precioUnitarioNum;
            const sub = roundMoney(precioUnitarioNum * i.qty);
            subtotal += sub;
            const subBs = (sub * currentBcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const precioUnitario = precioUnitarioNum.toFixed(2);
            const marcaBadge = i.marca ? `<span class="inline-block text-[9px] font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/40">${i.marca}</span>` : '';

            const imgCartHtml = i.imagen ? `
                <div class="w-9 h-9 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-700 shrink-0 border border-slate-200 dark:border-slate-700 self-center">
                    <img src="${i.imagen}" class="w-full h-full object-cover" onerror="this.parentElement.style.display='none'">
                </div>
            ` : '';

            // Badges visuales de modificadores para comida rápida
            let modBadgesHtml = '';
            if (i.modificadores) {
                const parts = [];
                if (i.modificadores.salsas && i.modificadores.salsas.length > 0) {
                    parts.push(`<span class="inline-flex items-center gap-1 text-[9px] font-black text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-900/40">🍯 ${i.modificadores.salsas.join(', ')}</span>`);
                }
                if (i.modificadores.sin && i.modificadores.sin.length > 0) {
                    parts.push(`<span class="inline-flex items-center gap-1 text-[9px] font-black text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-200 dark:border-rose-900/40">🚫 Sin: ${i.modificadores.sin.join(', ')}</span>`);
                }
                if (i.modificadores.extras && i.modificadores.extras.length > 0) {
                    parts.push(`<span class="inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-900/40">✨ +${i.modificadores.extras.map(e => e.name).join(', +')} (+$${i.modificadores.extraCost.toFixed(2)})</span>`);
                }
                if (i.modificadores.nota) {
                    parts.push(`<span class="inline-flex items-center gap-1 text-[9px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">📝 "${escHtml(i.modificadores.nota)}"</span>`);
                }
                if (parts.length > 0) {
                    modBadgesHtml = `<div class="mt-1.5 flex flex-wrap gap-1">${parts.join('')}</div>`;
                }
            }

            const isComidaMode = storeConfig.businessType === 'comida_rapida';
            const countSame = cart.filter(x => x.id === i.id).length;
            let itemIndexSuffix = '';
            if (isComidaMode && countSame > 1) {
                const itemNumber = cart.slice(0, idx + 1).filter(x => x.id === i.id).length;
                itemIndexSuffix = ` <span class="text-[9px] text-orange-600 dark:text-orange-400 font-black bg-orange-100 dark:bg-orange-950/70 border border-orange-200 dark:border-orange-900/40 px-1.5 py-0.5 rounded-md ml-1 whitespace-nowrap">Plato #${itemNumber}</span>`;
            }

            const customizeBtnHtml = isComidaMode ? `
                <div class="mt-2 pt-1 border-t border-slate-100 dark:border-slate-700/40 flex items-center gap-1 flex-wrap">
                    <button type="button" onclick="aplicarModificadorRapido(${idx}, 'con_todo')" class="py-1 px-1.5 rounded-lg bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/60 dark:hover:bg-orange-900/60 text-orange-800 dark:text-orange-300 font-black text-[9px] transition-all flex items-center justify-center gap-1 active:scale-95" title="Aplicar todas las salsas clásicas en 1 toque">
                        <i class="fa-solid fa-check-double text-[8px]"></i> Con Todo
                    </button>
                    <button type="button" onclick="aplicarModificadorRapido(${idx}, 'sin_vegetales')" class="py-1 px-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-extrabold text-[9px] border border-emerald-200 dark:border-emerald-800/50 transition-all flex items-center gap-1 active:scale-95" title="Sin vegetales (sin cebolla, repollo ni tomate)">
                        <i class="fa-solid fa-leaf text-[8px]"></i> Sin Vegetales
                    </button>
                    <button type="button" onclick="aplicarModificadorRapido(${idx}, 'sin_cebolla')" class="py-1 px-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 font-extrabold text-[9px] transition-all flex items-center gap-1 active:scale-95" title="Quitar cebolla">
                        <i class="fa-solid fa-ban text-[8px]"></i> Sin Cebolla
                    </button>
                    <button type="button" onclick="aplicarModificadorRapido(${idx}, 'salsas_aparte')" class="py-1 px-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-extrabold text-[9px] transition-all flex items-center gap-1 active:scale-95" title="Salsas en potes aparte">
                        <i class="fa-solid fa-box text-[8px]"></i> Aparte
                    </button>
                    <button type="button" onclick="openModificadoresModal(${idx})" class="p-1 px-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[9px] transition-all flex items-center justify-center shadow-2xs active:scale-95" title="Más salsas y extras con costo">
                        <i class="fa-solid fa-sliders text-[9px]"></i>
                    </button>
                    ${i.qty > 1 ? `
                    <button type="button" onclick="separarPlatoEnItems(${idx})" class="w-full mt-1 py-1 px-2 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-black text-[9px] border border-purple-200 dark:border-purple-800/60 transition-all flex items-center justify-center gap-1 active:scale-95" title="Separar en platos individuales para personalizar cada uno">
                        <i class="fa-solid fa-arrows-split-up-and-left text-[9px]"></i> Separar en ${i.qty} platos individuales
                    </button>
                    ` : ''}
                </div>
            ` : `
                <button type="button" onclick="openModificadoresModal(${idx})" class="mt-2 w-full py-1 px-2.5 rounded-xl bg-orange-50/80 hover:bg-orange-100 dark:bg-orange-950/50 dark:hover:bg-orange-900/60 text-orange-700 dark:text-orange-300 font-bold text-[10px] flex items-center justify-between border border-orange-200/80 dark:border-orange-800/50 transition-colors">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-wand-magic-sparkles text-orange-500"></i> ${i.modificadores ? 'Modificar Salsas / Extras' : 'Personalizar Salsas / Extras'}</span>
                    <i class="fa-solid fa-chevron-right text-[8px]"></i>
                </button>`;

            el.innerHTML += `
                <div class="group bg-white/95 dark:bg-slate-800/95 hover:bg-white dark:hover:bg-slate-800 p-3.5 rounded-2xl shadow-xs border border-slate-200/70 dark:border-slate-700/60 mb-2.5 transition-all">
                    <!-- Fila 1: Imagen (si tiene) + Título completo + Marca + Botón Eliminar -->
                    <div class="flex items-start justify-between gap-2.5">
                        <div class="flex items-center gap-2.5 flex-1 min-w-0 pr-1">
                            ${imgCartHtml}
                            <div class="flex-1 min-w-0">
                                <h5 class="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm leading-snug break-words">
                                    ${i.nombre}${itemIndexSuffix}
                                </h5>
                                ${marcaBadge ? `<div class="mt-0.5">${marcaBadge}</div>` : ''}
                                ${modBadgesHtml}
                            </div>
                        </div>
                        <button onclick="cart.splice(${idx}, 1); updateCartUI()" class="w-6 h-6 rounded-lg bg-slate-100 hover:bg-rose-50 dark:bg-slate-700/60 dark:hover:bg-rose-950/50 text-slate-400 hover:text-rose-500 transition-colors flex items-center justify-center shrink-0 active:scale-90" title="Eliminar del ticket">
                            <i class="fa-solid fa-xmark text-xs"></i>
                        </button>
                    </div>

                    <!-- Botón para Personalizar Salsas/Extras -->
                    ${customizeBtnHtml}

                    <!-- Fila 2: Stepper de Cantidad (+/-) y Precios ($ / Bs) -->
                    <div class="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-700/40 flex items-center justify-between gap-2">
                        <!-- Stepper de Cantidad estilo Apple/Square -->
                        <div class="flex items-center bg-slate-100 dark:bg-slate-700/60 rounded-xl p-0.5 border border-slate-200/60 dark:border-slate-600/50">
                            <button type="button" onclick="changeCartQty(${idx}, -1)" class="w-6 h-6 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-slate-700 font-bold text-xs flex items-center justify-center shadow-2xs active:scale-90 transition-all" title="Restar">
                                <i class="fa-solid fa-minus text-[9px]"></i>
                            </button>
                            <div onclick="editCartQty(${idx})" class="px-2 py-0.5 text-center cursor-pointer select-none hover:bg-white/50 dark:hover:bg-slate-600/30 rounded-md transition-colors" title="Clic para escribir cantidad exacta">
                                <span class="text-xs font-black text-slate-800 dark:text-slate-100 tabular-nums">${i.qty}</span>
                                <span class="text-[9px] font-bold text-slate-400 dark:text-slate-400 ml-0.5">${i.tipo}</span>
                            </div>
                            <button type="button" onclick="changeCartQty(${idx}, 1)" class="w-6 h-6 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-slate-700 font-bold text-xs flex items-center justify-center shadow-2xs active:scale-90 transition-all" title="Sumar">
                                <i class="fa-solid fa-plus text-[9px]"></i>
                            </button>
                        </div>

                        <!-- Precios Bimonetarios alineados a la derecha -->
                        <div class="text-right">
                            <div class="font-black text-slate-900 dark:text-white text-xs sm:text-sm tabular-nums leading-tight">
                                $${sub.toFixed(2)}
                            </div>
                            <div class="text-[10px] font-semibold text-slate-400 dark:text-slate-400 tabular-nums leading-tight mt-0.5">
                                Bs ${subBs}
                            </div>
                            ${i.qty > 1 ? `<div class="text-[9px] text-slate-400 dark:text-slate-500 font-medium leading-none mt-0.5">($${precioUnitario} c/u)</div>` : ''}
                        </div>
                    </div>
                </div>`;
        });
    }
    if (currentDiscount > subtotal) currentDiscount = subtotal;
    currentSaleTotal = subtotal - currentDiscount;
    const subEl = document.getElementById('cart-subtotal');
    const discEl = document.getElementById('cart-discount');
    const totEl = document.getElementById('cart-total');
    const totBsEl = document.getElementById('cart-total-bs');
    if (subEl) subEl.textContent = '$' + subtotal.toFixed(2);
    if (discEl) discEl.textContent = '-$' + currentDiscount.toFixed(2);
    if (totEl) totEl.textContent = '$' + currentSaleTotal.toFixed(2);
    if (totBsEl) totBsEl.textContent = 'Bs ' + (currentSaleTotal * currentBcv).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// =====================================================
// DESCUENTOS
// =====================================================
async function promptDiscount() {
    if (cart.length === 0) return Swal.fire('Ticket vacío', 'Agrega productos primero', 'info');
    const maxDiscount = isAdmin ? 100 : 10;
    const subtotal = cart.reduce((acc, i) => acc + ((i.precio || 0) * i.qty), 0);
    const { value: formValues } = await Swal.fire({
        title: '💸 Aplicar Descuento',
        html: `
            <p style="font-size:12px; color:#64748b; margin-bottom:8px;">Subtotal: <strong style="color:#10b981;">$${subtotal.toFixed(2)}</strong></p>
            <p style="font-size:11px; color:#94a3b8; margin-bottom:10px;">Límite: <strong>${maxDiscount}%</strong></p>
            <select id="swal-disc-type" class="swal2-input" style="width:80%; margin-bottom:10px;">
                <option value="porcentaje">📊 Porcentaje (%)</option>
                <option value="fijo">💵 Monto Fijo ($)</option>
            </select>
            <input id="swal-disc-val" type="number" step="0.01" min="0" class="swal2-input" placeholder="Valor" style="width:80%">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-check"></i> Aplicar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#f59e0b',
        preConfirm: () => {
            return {
                type: document.getElementById('swal-disc-type').value,
                val: parseFloat(document.getElementById('swal-disc-val').value) || 0
            };
        }
    });
    if (formValues) {
        let finalDiscount = 0;
        if (formValues.type === 'porcentaje') {
            if (formValues.val > maxDiscount) return Swal.fire('Error', `Límite: ${maxDiscount}%`, 'error');
            finalDiscount = subtotal * (formValues.val / 100);
        } else {
            const maxFijo = subtotal * (maxDiscount / 100);
            if (formValues.val > maxFijo) return Swal.fire('Error', `Límite: $${maxFijo.toFixed(2)}`, 'error');
            finalDiscount = formValues.val;
        }
        if (finalDiscount > subtotal) finalDiscount = subtotal;
        currentDiscount = finalDiscount;
        updateCartUI();
        Swal.fire({
            icon: 'success',
            title: 'Descuento aplicado',
            html: `<p>Descuento: <strong style="color:#f59e0b;">$${finalDiscount.toFixed(2)}</strong></p><p style="font-size:12px; color:#64748b;">Total: $${currentSaleTotal.toFixed(2)}</p>`,
            timer: 1500,
            showConfirmButton: false
        });
    }
}

function clearCart() {
    cart = [];
    currentDiscount = 0;
    puntosCanjeadosVenta = 0;
    updateCartUI();
}

// =====================================================
// FIDELIZACIÓN (PUNTOS)
// =====================================================
function getClienteNivel(puntos) {
    const pts = Math.max(0, parseInt(puntos) || 0);
    if (pts >= 1500) {
        return {
            nivel: 'Oro',
            badge: `<span class="px-2.5 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-300 inline-flex items-center gap-1"><i class="fa-solid fa-crown text-amber-500"></i> ${pts} pts (Oro)</span>`,
            puntos: pts
        };
    } else if (pts >= 500) {
        return {
            nivel: 'Plata',
            badge: `<span class="px-2.5 py-1 rounded-full text-xs font-black bg-slate-200 text-slate-700 border border-slate-300 inline-flex items-center gap-1"><i class="fa-solid fa-medal text-slate-500"></i> ${pts} pts (Plata)</span>`,
            puntos: pts
        };
    } else {
        return {
            nivel: 'Bronce',
            badge: `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1"><i class="fa-solid fa-shield text-amber-600"></i> ${pts} pts (Bronce)</span>`,
            puntos: pts
        };
    }
}

function onClienteSelectChange() {
    const sel = document.getElementById('pay-cliente');
    const badge = document.getElementById('cliente-puntos-badge');
    const canjearBtnCont = document.getElementById('canjear-puntos-container');
    const saldoFavorBanner = document.getElementById('cliente-saldo-favor-banner');
    const saldoFavorText = document.getElementById('cliente-saldo-favor-text');
    const btnAplicarSaldo = document.getElementById('btn-aplicar-saldo-favor');

    if (!sel) return;
    const cid = sel.value;
    if (!cid) {
        if (badge) badge.classList.add('hidden');
        if (canjearBtnCont) canjearBtnCont.classList.add('hidden');
        if (saldoFavorBanner) saldoFavorBanner.classList.add('hidden');
        saldoFavorAplicadoVenta = 0;
        calculateChange();
        return;
    }
    const c = clientes.find(x => x.id === cid);
    if (!c) {
        if (badge) badge.classList.add('hidden');
        if (canjearBtnCont) canjearBtnCont.classList.add('hidden');
        if (saldoFavorBanner) saldoFavorBanner.classList.add('hidden');
        saldoFavorAplicadoVenta = 0;
        calculateChange();
        return;
    }

    const pts = c.puntos || 0;
    const n = getClienteNivel(pts);
    if (badge) {
        badge.innerHTML = `<i class="fa-solid fa-gift mr-1 text-amber-500"></i>${pts} pts (${n.nivel})`;
        badge.classList.remove('hidden');
    }
    if (canjearBtnCont) {
        if (pts >= 100 && currentSaleTotal > 0) canjearBtnCont.classList.remove('hidden');
        else canjearBtnCont.classList.add('hidden');
    }

    // Saldo a Favor
    const saldoFavor = c.saldoFavorUsd || 0;
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;

    if (saldoFavorBanner && saldoFavorText && btnAplicarSaldo) {
        if (saldoFavor > 0) {
            saldoFavorBanner.classList.remove('hidden');
            if (saldoFavorAplicadoVenta > 0) {
                saldoFavorText.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-extrabold">Aplicado: $${saldoFavorAplicadoVenta.toFixed(2)}</span> <span class="text-slate-400 text-[10px]">(Disp: $${(saldoFavor - saldoFavorAplicadoVenta).toFixed(2)})</span>`;
                btnAplicarSaldo.className = "px-3 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black shadow-xs transition-all flex items-center gap-1 active:scale-95 shrink-0";
                btnAplicarSaldo.innerHTML = '<i class="fa-solid fa-xmark"></i> Quitar';
            } else {
                const saldoBs = (saldoFavor * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2 });
                saldoFavorText.innerHTML = `$${saldoFavor.toFixed(2)} <span class="text-slate-400 text-[10px] font-normal">(Bs ${saldoBs})</span>`;
                btnAplicarSaldo.className = "px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-xs transition-all flex items-center gap-1 active:scale-95 shrink-0";
                btnAplicarSaldo.innerHTML = '<i class="fa-solid fa-bolt"></i> Usar Saldo';
            }
        } else {
            saldoFavorBanner.classList.add('hidden');
            saldoFavorAplicadoVenta = 0;
        }
    }

    calculateChange();
}

function toggleAplicarSaldoFavor() {
    const sel = document.getElementById('pay-cliente');
    if (!sel || !sel.value) return;
    const c = clientes.find(x => x.id === sel.value);
    if (!c || !c.saldoFavorUsd || c.saldoFavorUsd <= 0) return;

    if (saldoFavorAplicadoVenta > 0) {
        saldoFavorAplicadoVenta = 0;
    } else {
        saldoFavorAplicadoVenta = Math.min(c.saldoFavorUsd, currentSaleTotal);
    }
    onClienteSelectChange();
    calculateChange();
}

async function canjearPuntos() {
    const sel = document.getElementById('pay-cliente');
    if (!sel || !sel.value) return Swal.fire('Error', 'Selecciona un cliente', 'warning');
    const c = clientes.find(x => x.id === sel.value);
    if (!c) return;
    const ptsDisponibles = (c.puntos || 0) - puntosCanjeadosVenta;
    if (ptsDisponibles < 100) return Swal.fire('Puntos Insuficientes', 'Mínimo 100 puntos ($1)', 'info');
    const maxDescuentoUsd = Math.min(Math.floor(ptsDisponibles / 100), Math.floor(currentSaleTotal));
    if (maxDescuentoUsd < 1) return Swal.fire('Atención', 'No aplica más descuento', 'info');
    const { value: montoUsd } = await Swal.fire({
        title: '🎁 Canjear Puntos',
        html: `<p class="text-sm text-slate-600 mb-2">Cliente: <b>${c.nombre}</b><br>Puntos: <b>${ptsDisponibles}</b> (= $${(ptsDisponibles / 100).toFixed(2)})</p><p class="text-xs text-slate-500 mb-4">100 pts = $1.00</p>`,
        input: 'number',
        inputLabel: `Monto en $ (Máx: $${maxDescuentoUsd})`,
        inputValue: '1',
        inputAttributes: { min: '1', max: maxDescuentoUsd.toString(), step: '1' },
        showCancelButton: true,
        confirmButtonText: 'Aplicar',
        cancelButtonText: 'Cancelar'
    });
    if (montoUsd) {
        const descUsd = parseInt(montoUsd);
        if (isNaN(descUsd) || descUsd <= 0 || descUsd > maxDescuentoUsd) return Swal.fire('Error', 'Monto inválido', 'error');
        const puntosAUsar = descUsd * 100;
        puntosCanjeadosVenta += puntosAUsar;
        currentDiscount += descUsd;
        updateCartUI();
        document.getElementById('pay-total-usd').textContent = `$${currentSaleTotal.toFixed(2)}`;
        document.getElementById('pay-total-bs').textContent = `Bs ${(currentSaleTotal * rates.bcv).toFixed(2)}`;
        calculateChange();
        onClienteSelectChange();
        Swal.fire('¡Canjeado!', `Descuento $${descUsd} por ${puntosAUsar} pts`, 'success');
    }
}

// =====================================================
// PAGOS Y ASISTENTE DE VUELTO INTELIGENTE
// =====================================================
function openPaymentModal() {
    if (cart.length === 0) return Swal.fire('Ticket vacío', '', 'info');
    puntosCanjeadosVenta = 0;
    saldoFavorAplicadoVenta = 0;
    selectedVueltoOption = 'efectivoUsd';

    document.getElementById('pay-total-usd').textContent = `$${currentSaleTotal.toFixed(2)}`;
    document.getElementById('pay-total-bs').textContent = `Bs ${(currentSaleTotal * rates.bcv).toFixed(2)}`;
    ['efectivo-usd', 'zelle-usd', 'efectivo-bs', 'punto-bs', 'pago-movil-bs'].forEach(id => {
        const el = document.getElementById(`pay-${id}`);
        if (el) el.value = '';
    });
    onClienteSelectChange();
    calculateChange();
    const m = document.getElementById('payment-modal');
    const c = document.getElementById('payment-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
        document.getElementById('pay-efectivo-usd').focus();
    }, 10);
}

function closePaymentModal() {
    const m = document.getElementById('payment-modal');
    const c = document.getElementById('payment-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => {
        m.classList.add('hidden');
        const s = document.getElementById('search-pos');
        if (s) s.focus();
    }, 300);
}

function setExactUsdBill(amount) {
    const el = document.getElementById('pay-efectivo-usd');
    if (!el) return;
    el.value = Number(amount).toFixed(2);
    ['zelle-usd', 'efectivo-bs', 'punto-bs', 'pago-movil-bs'].forEach(id => {
        const other = document.getElementById(`pay-${id}`);
        if (other) other.value = '';
    });
    calculateChange();
}
window.setExactUsdBill = setExactUsdBill;

function quickExactPayment(method) {
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    const netoACobrarUsd = Math.max(0, roundMoney(currentSaleTotal - saldoFavorAplicadoVenta));
    const totalBs = roundMoney(netoACobrarUsd * tasa);

    document.getElementById('pay-efectivo-usd').value = '';
    document.getElementById('pay-zelle-usd').value = '';
    document.getElementById('pay-efectivo-bs').value = '';
    document.getElementById('pay-punto-bs').value = '';
    document.getElementById('pay-pago-movil-bs').value = '';

    if (method === 'usd') {
        document.getElementById('pay-efectivo-usd').value = netoACobrarUsd.toFixed(2);
    } else if (method === 'pago-movil') {
        document.getElementById('pay-pago-movil-bs').value = totalBs.toFixed(2);
        const bankContainer = document.getElementById('bank-selection-container');
        if (bankContainer) bankContainer.classList.remove('hidden');
    } else if (method === 'punto') {
        document.getElementById('pay-punto-bs').value = totalBs.toFixed(2);
    } else if (method === 'efectivo-bs') {
        document.getElementById('pay-efectivo-bs').value = totalBs.toFixed(2);
    }

    calculateChange();
}

function autoFillRemaining(method) {
    const usdEfectivo = parseFloat(document.getElementById('pay-efectivo-usd').value) || 0;
    const usdZelle = parseFloat(document.getElementById('pay-zelle-usd').value) || 0;
    const bsEfectivo = parseFloat(document.getElementById('pay-efectivo-bs').value) || 0;
    const bsPunto = parseFloat(document.getElementById('pay-punto-bs').value) || 0;
    const bsPMovil = parseFloat(document.getElementById('pay-pago-movil-bs').value) || 0;
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;

    const totalBsPagados = bsEfectivo + bsPunto + bsPMovil;
    const totalUsdPagado = roundMoney(usdEfectivo + usdZelle + saldoFavorAplicadoVenta + (totalBsPagados / tasa));
    const faltaUsd = roundMoney(currentSaleTotal - totalUsdPagado);

    if (faltaUsd <= 0.001) return;

    const faltaBs = roundMoney(faltaUsd * tasa);

    if (method === 'pago-movil') {
        const cur = parseFloat(document.getElementById('pay-pago-movil-bs').value) || 0;
        document.getElementById('pay-pago-movil-bs').value = (cur + faltaBs).toFixed(2);
        const bankContainer = document.getElementById('bank-selection-container');
        if (bankContainer) bankContainer.classList.remove('hidden');
    } else if (method === 'punto') {
        const cur = parseFloat(document.getElementById('pay-punto-bs').value) || 0;
        document.getElementById('pay-punto-bs').value = (cur + faltaBs).toFixed(2);
    } else if (method === 'usd') {
        const cur = parseFloat(document.getElementById('pay-efectivo-usd').value) || 0;
        document.getElementById('pay-efectivo-usd').value = (cur + faltaUsd).toFixed(2);
    } else if (method === 'efectivo-bs') {
        const cur = parseFloat(document.getElementById('pay-efectivo-bs').value) || 0;
        document.getElementById('pay-efectivo-bs').value = (cur + faltaBs).toFixed(2);
    }

    calculateChange();
}

function getDenominacionesSugeridasUsd(monto) {
    let m = Math.floor(monto);
    const b20 = Math.floor(m / 20); m %= 20;
    const b10 = Math.floor(m / 10); m %= 10;
    const b5 = Math.floor(m / 5); m %= 5;
    const b1 = m;
    const parts = [];
    if (b20 > 0) parts.push(`${b20}x $20`);
    if (b10 > 0) parts.push(`${b10}x $10`);
    if (b5 > 0) parts.push(`${b5}x $5`);
    if (b1 > 0) parts.push(`${b1}x $1`);
    const centavos = Math.round((monto - Math.floor(monto)) * 100);
    if (centavos > 0) parts.push(`+ ${centavos}¢ (difícil en efectivo $)`);
    return parts.length > 0 ? parts.join(', ') : `$${monto.toFixed(2)}`;
}

function seleccionarOpcionVuelto(metodo) {
    selectedVueltoOption = metodo;
    calculateChange();
}

function renderAsistenteVueltoHtml(diff, tasa, cliente) {
    const vueltoBsFormatted = (diff * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2 });
    const denominacionesUsd = getDenominacionesSugeridasUsd(diff);

    const clienteTel = cliente?.telefono || '';
    const clienteCi = cliente?.cedula || '';
    const clienteBanco = cliente?.banco || 'Banco de Venezuela';

    const tabClass = (opt) => selectedVueltoOption === opt 
        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm border-2 border-primary-500 font-black' 
        : 'bg-slate-100/80 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border border-transparent font-bold hover:bg-slate-200/60 dark:hover:bg-slate-700/60';

    let panelContent = '';

    if (selectedVueltoOption === 'efectivoUsd') {
        panelContent = `
            <div class="bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl p-3 text-left">
                <div class="flex items-center justify-between mb-1.5">
                    <span class="text-[11px] font-black uppercase text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <i class="fa-solid fa-dollar-sign text-emerald-500"></i> Entregar en Billetes USD
                    </span>
                    <span class="text-base font-black text-emerald-600 dark:text-emerald-400 tabular-nums">$${diff.toFixed(2)}</span>
                </div>
                <div class="text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white/70 dark:bg-slate-900/60 p-2 rounded-lg border border-emerald-100 dark:border-emerald-900/50">
                    <span class="font-extrabold text-slate-800 dark:text-slate-200">Billetes sugeridos:</span> ${denominacionesUsd}
                </div>
                <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 italic font-medium">
                    💡 Si no tienes billetes de $1 o sencillo, puedes usar <b>Efectivo Bs</b>, <b>Pago Móvil</b> o <b>Saldo a Favor</b>.
                </p>
            </div>
        `;
    } else if (selectedVueltoOption === 'efectivoBs') {
        panelContent = `
            <div class="bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-xl p-3 text-left">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-[11px] font-black uppercase text-blue-700 dark:text-blue-400 flex items-center gap-1">
                        <i class="fa-solid fa-money-bill-1-wave text-blue-500"></i> Entregar en Efectivo Bolívares
                    </span>
                    <span class="text-base font-black text-blue-600 dark:text-blue-400 tabular-nums">Bs ${vueltoBsFormatted}</span>
                </div>
                <div class="text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-white/70 dark:bg-slate-900/60 p-2 rounded-lg border border-blue-100 dark:border-blue-900/50 flex justify-between items-center">
                    <span>Equivalente en USD: <b class="text-slate-800 dark:text-slate-100">$${diff.toFixed(2)}</b></span>
                    <span class="text-[10px] text-slate-400 font-bold">Tasa: Bs ${tasa.toFixed(2)}</span>
                </div>
                <p class="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5 italic font-medium">
                    💵 Entrega el monto exacto en bolívares en efectivo desde tu gaveta.
                </p>
            </div>
        `;
    } else if (selectedVueltoOption === 'pagoMovil') {
        panelContent = `
            <div class="bg-teal-50/80 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/60 rounded-xl p-3 text-left space-y-2">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-black uppercase text-teal-700 dark:text-teal-400 flex items-center gap-1">
                        <i class="fa-solid fa-mobile-screen text-teal-500"></i> Transferir por Pago Móvil
                    </span>
                    <span class="text-base font-black text-teal-600 dark:text-teal-400 tabular-nums">Bs ${vueltoBsFormatted}</span>
                </div>
                
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">Teléfono Cliente</label>
                        <input type="text" id="vuelto-pm-telefono" value="${clienteTel}" placeholder="04121234567" class="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold outline-none focus:border-teal-500">
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">Cédula (V- / E-)</label>
                        <input type="text" id="vuelto-pm-cedula" value="${clienteCi}" placeholder="V-12345678" class="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold outline-none focus:border-teal-500">
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-2 text-xs">
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">Banco Destino</label>
                        <select id="vuelto-pm-banco" class="w-full px-2 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-[11px] font-bold outline-none focus:border-teal-500">
                            <option value="Banco de Venezuela" ${clienteBanco === 'Banco de Venezuela' ? 'selected' : ''}>Venezuela (0102)</option>
                            <option value="Banesco" ${clienteBanco === 'Banesco' ? 'selected' : ''}>Banesco (0134)</option>
                            <option value="Mercantil" ${clienteBanco === 'Mercantil' ? 'selected' : ''}>Mercantil (0105)</option>
                            <option value="BBVA Provincial" ${clienteBanco === 'BBVA Provincial' ? 'selected' : ''}>Provincial (0108)</option>
                            <option value="B.N.C" ${clienteBanco === 'B.N.C' ? 'selected' : ''}>BNC (0191)</option>
                            <option value="Bancaribe" ${clienteBanco === 'Bancaribe' ? 'selected' : ''}>Bancaribe (0114)</option>
                            <option value="Banco Exterior" ${clienteBanco === 'Banco Exterior' ? 'selected' : ''}>Exterior (0115)</option>
                            <option value="Otro">Otro</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-0.5">Ref. Emitida (Opcional)</label>
                        <input type="text" id="vuelto-pm-ref" placeholder="Últimos 4 dígitos" class="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold outline-none focus:border-teal-500">
                    </div>
                </div>

                <div class="flex items-center gap-2 pt-1">
                    <button type="button" id="btn-copy-pm-vuelto" onclick="copiarDatosPagoMovilVuelto()" class="flex-1 py-2 px-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-[11px] font-black shadow-xs transition-all flex items-center justify-center gap-1 active:scale-95">
                        <i class="fa-solid fa-copy"></i> Copiar para Banca
                    </button>
                    <button type="button" onclick="notificarVueltoPagoMovilWhatsApp()" class="py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[11px] font-black shadow-xs transition-all flex items-center justify-center gap-1 active:scale-95" title="Enviar comprobante por WhatsApp">
                        <i class="fa-brands fa-whatsapp"></i> Notificar
                    </button>
                </div>
            </div>
        `;
    } else if (selectedVueltoOption === 'saldoFavor') {
        if (cliente) {
            const deudaActual = cliente.deudaUsd || 0;
            const tieneDeuda = deudaActual > 0;
            panelContent = `
                <div class="bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 rounded-xl p-3 text-left">
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="text-[11px] font-black uppercase text-purple-700 dark:text-purple-400 flex items-center gap-1">
                            <i class="fa-solid fa-gift text-purple-500"></i> Acreditar a Favor del Cliente
                        </span>
                        <span class="text-base font-black text-purple-600 dark:text-purple-400 tabular-nums">+$${diff.toFixed(2)}</span>
                    </div>
                    <div class="bg-white/70 dark:bg-slate-900/60 p-2.5 rounded-lg border border-purple-100 dark:border-purple-900/50 space-y-1">
                        <p class="text-xs font-bold text-slate-800 dark:text-slate-200">
                            Cliente: <span class="font-black text-primary-600 dark:text-primary-400">${cliente.nombre}</span>
                        </p>
                        ${tieneDeuda ? `
                            <p class="text-[11px] font-extrabold text-amber-600 dark:text-amber-400">
                                ⚠️ Amortizará su deuda pendiente ($${deudaActual.toFixed(2)}).
                            </p>
                        ` : `
                            <p class="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                Saldo actual: <b class="text-emerald-600">$${(cliente.saldoFavorUsd || 0).toFixed(2)}</b> ➔ Nuevo saldo: <b class="text-purple-600">$${((cliente.saldoFavorUsd || 0) + diff).toFixed(2)}</b>
                            </p>
                        `}
                    </div>
                    <p class="text-[10px] text-purple-700 dark:text-purple-300 mt-2 font-bold flex items-center gap-1">
                        <i class="fa-solid fa-check-circle text-purple-500"></i> ¡Listo! En su próxima visita se le sugerirá y descontará automáticamente.
                    </p>
                </div>
            `;
        } else {
            panelContent = `
                <div class="bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 rounded-xl p-3 text-left">
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="text-[11px] font-black uppercase text-purple-700 dark:text-purple-400 flex items-center gap-1">
                            <i class="fa-solid fa-gift text-purple-500"></i> Saldo a Favor ($${diff.toFixed(2)})
                        </span>
                    </div>
                    <p class="text-xs text-slate-600 dark:text-slate-300 mb-2.5 font-medium">
                        Para guardar el vuelto a favor, asigna un cliente existente o regístralo en 3 segundos:
                    </p>
                    <button type="button" onclick="crearClienteRapidoDesdeCobro()" class="w-full py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-black shadow-xs transition-all flex items-center justify-center gap-1.5 active:scale-95">
                        <i class="fa-solid fa-user-plus"></i> Registrar / Seleccionar Cliente Rápido
                    </button>
                </div>
            `;
        }
    }

    return `
        <div class="space-y-2">
            <!-- Header Vuelto -->
            <div class="flex items-center justify-between px-1">
                <span class="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <i class="fa-solid fa-wand-magic-sparkles text-amber-500"></i> Asistente de Vuelto
                </span>
                <span class="text-xs font-black text-slate-900 dark:text-white tabular-nums">
                    Vuelto: <b class="text-indigo-600 dark:text-indigo-400">$${diff.toFixed(2)}</b> (Bs ${vueltoBsFormatted})
                </span>
            </div>

            <!-- Chips Selector de 4 Opciones -->
            <div class="grid grid-cols-4 gap-1 text-[11px]">
                <button type="button" onclick="seleccionarOpcionVuelto('efectivoUsd')" class="py-2 px-1 rounded-xl transition-all flex flex-col items-center justify-center gap-0.5 active:scale-95 ${tabClass('efectivoUsd')}">
                    <i class="fa-solid fa-dollar-sign text-emerald-500 text-xs"></i>
                    <span class="text-[10px] leading-tight">Efectivo $</span>
                </button>
                <button type="button" onclick="seleccionarOpcionVuelto('efectivoBs')" class="py-2 px-1 rounded-xl transition-all flex flex-col items-center justify-center gap-0.5 active:scale-95 ${tabClass('efectivoBs')}">
                    <i class="fa-solid fa-money-bill-1-wave text-blue-500 text-xs"></i>
                    <span class="text-[10px] leading-tight">Efectivo Bs</span>
                </button>
                <button type="button" onclick="seleccionarOpcionVuelto('pagoMovil')" class="py-2 px-1 rounded-xl transition-all flex flex-col items-center justify-center gap-0.5 active:scale-95 ${tabClass('pagoMovil')}">
                    <i class="fa-solid fa-mobile-screen text-teal-500 text-xs"></i>
                    <span class="text-[10px] leading-tight">Pago Móvil</span>
                </button>
                <button type="button" onclick="seleccionarOpcionVuelto('saldoFavor')" class="py-2 px-1 rounded-xl transition-all flex flex-col items-center justify-center gap-0.5 active:scale-95 ${tabClass('saldoFavor')}">
                    <i class="fa-solid fa-gift text-purple-500 text-xs"></i>
                    <span class="text-[10px] leading-tight">Saldo Favor</span>
                </button>
            </div>

            <!-- Panel de Contenido Dinámico -->
            ${panelContent}
        </div>
    `;
}

function copiarDatosPagoMovilVuelto() {
    const tel = document.getElementById('vuelto-pm-telefono')?.value.trim() || '';
    const ci = document.getElementById('vuelto-pm-cedula')?.value.trim() || '';
    const banco = document.getElementById('vuelto-pm-banco')?.value || 'Banco';
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;

    const usdEfectivo = parseFloat(document.getElementById('pay-efectivo-usd').value) || 0;
    const usdZelle = parseFloat(document.getElementById('pay-zelle-usd').value) || 0;
    const bsEfectivo = parseFloat(document.getElementById('pay-efectivo-bs').value) || 0;
    const bsPunto = parseFloat(document.getElementById('pay-punto-bs').value) || 0;
    const bsPMovil = parseFloat(document.getElementById('pay-pago-movil-bs').value) || 0;
    const totalBsPagados = bsEfectivo + bsPunto + bsPMovil;
    const totalUsd = roundMoney(usdEfectivo + usdZelle + saldoFavorAplicadoVenta + (totalBsPagados / tasa));
    const diff = roundMoney(totalUsd - currentSaleTotal);
    const montoBs = roundMoney(diff * tasa).toFixed(2);

    const textoCopiado = `${banco} | CI: ${ci || 'N/A'} | Tel: ${tel || 'N/A'} | Monto: Bs ${montoBs}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textoCopiado).then(() => {
            const btn = document.getElementById('btn-copy-pm-vuelto');
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-check text-emerald-400"></i> ¡Copiado!';
                setTimeout(() => { btn.innerHTML = orig; }, 1800);
            }
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: `Copiado: Bs ${montoBs}`,
                showConfirmButton: false,
                timer: 2000
            });
        }).catch(() => {
            prompt('Copia manualmente los datos para el banco:', textoCopiado);
        });
    } else {
        prompt('Copia manualmente los datos para el banco:', textoCopiado);
    }
}

function notificarVueltoPagoMovilWhatsApp() {
    const tel = document.getElementById('vuelto-pm-telefono')?.value.replace(/[^0-9]/g, '') || '';
    const ci = document.getElementById('vuelto-pm-cedula')?.value.trim() || '';
    const banco = document.getElementById('vuelto-pm-banco')?.value || '';
    const ref = document.getElementById('vuelto-pm-ref')?.value.trim() || '';
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;

    const usdEfectivo = parseFloat(document.getElementById('pay-efectivo-usd').value) || 0;
    const usdZelle = parseFloat(document.getElementById('pay-zelle-usd').value) || 0;
    const bsEfectivo = parseFloat(document.getElementById('pay-efectivo-bs').value) || 0;
    const bsPunto = parseFloat(document.getElementById('pay-punto-bs').value) || 0;
    const bsPMovil = parseFloat(document.getElementById('pay-pago-movil-bs').value) || 0;
    const totalBsPagados = bsEfectivo + bsPunto + bsPMovil;
    const totalUsd = roundMoney(usdEfectivo + usdZelle + saldoFavorAplicadoVenta + (totalBsPagados / tasa));
    const diff = roundMoney(totalUsd - currentSaleTotal);
    const montoBs = roundMoney(diff * tasa).toFixed(2);
    const storeName = storeConfig?.name || 'Mi Negocio';

    let msg = `*COMPROBANTE DE VUELTO POR PAGO MÓVIL*\n`;
    msg += `🏪 *${storeName.toUpperCase()}*\n`;
    msg += `📅 *Fecha:* ${new Date().toLocaleString()}\n`;
    msg += `---------------------------------\n`;
    msg += `💵 *Vuelto Total:* $${diff.toFixed(2)}\n`;
    msg += `🇻🇪 *Monto Transferido:* *Bs ${montoBs}*\n`;
    msg += `🏦 *Banco:* ${banco}\n`;
    if (ci) msg += `🪪 *Cédula:* ${ci}\n`;
    if (ref) msg += `🔢 *Nro Referencia:* ${ref}\n`;
    msg += `---------------------------------\n`;
    msg += `¡Gracias por tu compra!`;

    if (tel) {
        // enlaceWhatsApp añade el código del país si falta: antes, un número
        // guardado como '0414...' generaba wa.me/0414... y no abría nada.
        window.open(enlaceWhatsApp(tel, msg), '_blank');
    } else {
        Swal.fire({
            title: 'Notificar Vuelto por WhatsApp',
            input: 'text',
            inputLabel: 'Número del cliente (basta el local, ej: 04121234567):',
            showCancelButton: true,
            confirmButtonText: 'Enviar'
        }).then(res => {
            if (res.isConfirmed && res.value) {
                const destino = normalizarTelefono(res.value);
                if (destino) window.open(enlaceWhatsApp(destino, msg), '_blank');
                else Swal.fire('Número inválido', 'Escribe al menos un número de teléfono.', 'warning');
            }
        });
    }
}

async function crearClienteRapidoDesdeCobro() {
    const { value: formValues } = await Swal.fire({
        title: '👤 Cliente Rápido',
        html: `
            <div class="text-left space-y-3 pt-2">
                <div>
                    <label class="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Nombre Completo *</label>
                    <input id="swal-cliente-nombre" class="swal2-input !m-0 !w-full !text-sm" placeholder="Ej. Carlos Mendoza">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Cédula (V- / E-)</label>
                    <input id="swal-cliente-cedula" class="swal2-input !m-0 !w-full !text-sm" placeholder="Ej. V-18456789">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Teléfono / WhatsApp</label>
                    <input id="swal-cliente-telefono" class="swal2-input !m-0 !w-full !text-sm" placeholder="Ej. 04121234567">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">Banco Principal (Pago Móvil)</label>
                    <select id="swal-cliente-banco" class="swal2-select !m-0 !w-full !text-sm">
                        <option value="Banco de Venezuela">Banco de Venezuela (0102)</option>
                        <option value="Banesco">Banesco (0134)</option>
                        <option value="Mercantil">Mercantil (0105)</option>
                        <option value="BBVA Provincial">BBVA Provincial (0108)</option>
                        <option value="B.N.C">B.N.C (0191)</option>
                        <option value="Bancaribe">Bancaribe (0114)</option>
                        <option value="Banco Exterior">Banco Exterior (0115)</option>
                        <option value="Otro">Otro</option>
                    </select>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-check"></i> Guardar y Seleccionar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const nombre = document.getElementById('swal-cliente-nombre').value.trim();
            const cedula = document.getElementById('swal-cliente-cedula').value.trim();
            const telefono = normalizarTelefono(document.getElementById('swal-cliente-telefono').value);
            const banco = document.getElementById('swal-cliente-banco').value;
            if (!nombre) {
                Swal.showValidationMessage('El nombre del cliente es obligatorio');
                return false;
            }
            return { nombre, cedula, telefono, banco };
        }
    });

    if (formValues) {
        try {
            const docRef = await getDb('clientes').add({
                nombre: formValues.nombre,
                cedula: formValues.cedula || '',
                telefono: formValues.telefono || '',
                banco: formValues.banco || '',
                deudaUsd: 0,
                saldoFavorUsd: 0,
                puntos: 0,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            const newClient = {
                id: docRef.id,
                nombre: formValues.nombre,
                cedula: formValues.cedula || '',
                telefono: formValues.telefono || '',
                banco: formValues.banco || '',
                deudaUsd: 0,
                saldoFavorUsd: 0,
                puntos: 0
            };
            if (!clientes.some(c => c.id === docRef.id)) {
                clientes.push(newClient);
            }
            populateClientesSelect();
            const sel = document.getElementById('pay-cliente');
            if (sel) sel.value = docRef.id;
            onClienteSelectChange();
            Swal.fire({
                title: 'Cliente Asignado',
                text: `${formValues.nombre} seleccionado para la venta.`,
                icon: 'success',
                timer: 1500,
                showConfirmButton: false
            });
        } catch (e) {
            Swal.fire('Error', e.message, 'error');
        }
    }
}

function calculateChange() {
    const usdEfectivo = parseFloat(document.getElementById('pay-efectivo-usd').value) || 0;
    const usdZelle = parseFloat(document.getElementById('pay-zelle-usd').value) || 0;
    const bsEfectivo = parseFloat(document.getElementById('pay-efectivo-bs').value) || 0;
    const bsPunto = parseFloat(document.getElementById('pay-punto-bs').value) || 0;
    const bsPMovil = parseFloat(document.getElementById('pay-pago-movil-bs').value) || 0;
    const clienteId = document.getElementById('pay-cliente')?.value || '';
    const cliente = clientes.find(x => x.id === clienteId);
    const bankContainer = document.getElementById('bank-selection-container');
    if (bsPMovil > 0) bankContainer.classList.remove('hidden');
    else bankContainer.classList.add('hidden');

    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    const totalBsPagados = bsEfectivo + bsPunto + bsPMovil;
    const totalUsd = roundMoney(usdEfectivo + usdZelle + saldoFavorAplicadoVenta + (totalBsPagados / tasa));
    const diff = roundMoney(totalUsd - currentSaleTotal);
    const sBox = document.getElementById('pay-status-box');
    const btn = document.getElementById('btn-confirm-sale');

    if (diff >= -0.01 || clienteId) {
        btn.disabled = false;
        btn.className = "w-full animated-btn bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-600/25 transition-all text-base";
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Procesar Venta <span class="hidden sm:inline-block ml-2 text-xs font-mono font-bold bg-emerald-700/60 px-2 py-0.5 rounded-lg border border-emerald-400/40">[Enter ↵]</span>';
        if (diff < -0.01 && clienteId) {
            sBox.className = "p-3.5 rounded-2xl mb-4 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 font-extrabold text-xs border border-amber-200 dark:border-amber-800/60";
            sBox.innerHTML = `<i class="fa-solid fa-handshake mr-1 text-amber-600"></i> Venta a Crédito (Fiado): <b>$${Math.abs(diff).toFixed(2)}</b> (Bs ${(Math.abs(diff) * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2 })})`;
        } else if (diff > 0.02) {
            sBox.className = "p-3.5 rounded-2xl mb-4 bg-indigo-50/50 dark:bg-indigo-950/40 text-slate-800 dark:text-slate-100 font-extrabold text-xs border border-indigo-200/80 dark:border-indigo-800/60 transition-all";
            sBox.innerHTML = renderAsistenteVueltoHtml(diff, tasa, cliente);
        } else {
            sBox.className = "p-3.5 rounded-2xl mb-4 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 font-black text-xs border border-emerald-200 dark:border-emerald-800/60";
            let exactMsg = '<i class="fa-solid fa-circle-check mr-1 text-emerald-600"></i> Pago Completo Exacto';
            if (saldoFavorAplicadoVenta > 0) {
                exactMsg += ` (incluye $${saldoFavorAplicadoVenta.toFixed(2)} saldo a favor)`;
            }
            sBox.innerHTML = exactMsg;
        }
    } else {
        btn.disabled = true;
        btn.className = "w-full bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 font-black py-4 rounded-2xl text-base";
        btn.innerHTML = '<i class="fa-solid fa-lock"></i> Procesar';
        const f = roundMoney(currentSaleTotal - totalUsd);
        const fBs = roundMoney(f * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2 });
        sBox.className = "p-3.5 rounded-2xl mb-4 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800/60 text-xs";
        sBox.innerHTML = `
            <div class="font-extrabold mb-2 text-center text-rose-600 dark:text-rose-400">
                <i class="fa-solid fa-triangle-exclamation mr-1"></i> Falta cobrar: <b>$${f.toFixed(2)}</b> (Bs ${fBs})
                ${saldoFavorAplicadoVenta > 0 ? `<div class="text-[10px] text-emerald-600 font-bold mt-0.5">🎁 Saldo a favor usado: -$${saldoFavorAplicadoVenta.toFixed(2)}</div>` : ''}
            </div>
            <div class="text-[10px] font-bold text-slate-500 uppercase tracking-wide text-center mb-1.5">⚡ Completar restante en 1 toque:</div>
            <div class="flex flex-wrap gap-1.5 justify-center">
                <button type="button" onclick="autoFillRemaining('pago-movil')" class="px-2.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-black text-[10px] shadow-xs transition-all active:scale-95 flex items-center gap-1">
                    <i class="fa-solid fa-mobile-screen"></i> Pago Móvil (Bs ${fBs})
                </button>
                <button type="button" onclick="autoFillRemaining('punto')" class="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[10px] shadow-xs transition-all active:scale-95 flex items-center gap-1">
                    <i class="fa-solid fa-credit-card"></i> Punto Bs (Bs ${fBs})
                </button>
                <button type="button" onclick="autoFillRemaining('usd')" class="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] shadow-xs transition-all active:scale-95 flex items-center gap-1">
                    <i class="fa-solid fa-dollar-sign"></i> Efectivo $ ($${f.toFixed(2)})
                </button>
            </div>
        `;
    }
}

async function confirmSale() {
    const btn = document.getElementById('btn-confirm-sale');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';

    // 1. Validación estricta previa de stock
    for (const item of cart) {
        const prodDb = products.find(p => p.id === item.id);
        if (prodDb && typeof prodDb.stock === 'number' && prodDb.stock < item.qty) {
            btn.disabled = false;
            btn.className = "w-full animated-btn bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-600/25 transition-all text-base";
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Procesar Venta';
            return Swal.fire({
                title: 'Stock Insuficiente',
                text: `El producto "${item.nombre}" cuenta con ${prodDb.stock} unidades en inventario (intentas vender: ${item.qty}).`,
                icon: 'warning'
            });
        }
    }

    // El costo se acumula SOLO con los artículos que tienen costo capturado.
    // Antes, un artículo sin costo contaba como 0 y la ganancia de esa venta
    // salía igual al importe completo: beneficio inflado. Ahora, si falta
    // algún costo, la venta se marca y NO se inventa la ganancia.
    let totalCosto = 0;
    let costoIncompleto = false;
    cart.forEach(i => {
        const c = (i.costo === null || i.costo === undefined || i.costo === '') ? null : Number(i.costo);
        if (c === null || Number.isNaN(c)) costoIncompleto = true;
        else totalCosto += c * i.qty;
    });
    const subtotalVenta = roundMoney(cart.reduce((acc, i) => acc + ((i.precio || 0) * i.qty), 0));

    const usdEfectivo = parseFloat(document.getElementById('pay-efectivo-usd').value) || 0;
    const usdZelle = parseFloat(document.getElementById('pay-zelle-usd').value) || 0;
    const bsEfectivo = parseFloat(document.getElementById('pay-efectivo-bs').value) || 0;
    const bsPunto = parseFloat(document.getElementById('pay-punto-bs').value) || 0;
    const bsPMovil = parseFloat(document.getElementById('pay-pago-movil-bs').value) || 0;
    const bancoPM = document.getElementById('pay-banco-pm').value || 'Otro';
    const clienteId = document.getElementById('pay-cliente').value;

    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    const totalBsPagados = bsEfectivo + bsPunto + bsPMovil;
    const totalPagadoUsd = roundMoney(usdEfectivo + usdZelle + saldoFavorAplicadoVenta + (totalBsPagados / tasa));
    const vueltoUsd = roundMoney(totalPagadoUsd > currentSaleTotal ? totalPagadoUsd - currentSaleTotal : 0);

    // Validación: si eligió guardar Saldo a Favor pero no hay cliente asignado
    if (vueltoUsd > 0 && selectedVueltoOption === 'saldoFavor' && !clienteId) {
        btn.disabled = false;
        btn.className = "w-full animated-btn bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-600/25 transition-all text-base";
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Procesar Venta';
        return Swal.fire({
            title: 'Cliente Requerido',
            text: 'Para guardar el vuelto como Saldo a Favor, debes asignar o registrar un cliente.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '<i class="fa-solid fa-user-plus"></i> Registrar Cliente Rápido',
            cancelButtonText: 'Cancelar'
        }).then(r => {
            if (r.isConfirmed) crearClienteRapidoDesdeCobro();
        });
    }

    // Ajuste inteligente del efectivo en caja según cómo se entregó el vuelto
    let efectivoUsdNeto = usdEfectivo;
    let efectivoBsNeto = bsEfectivo;
    if (vueltoUsd > 0) {
        if (selectedVueltoOption === 'efectivoUsd') {
            efectivoUsdNeto = roundMoney(usdEfectivo - vueltoUsd);
        } else if (selectedVueltoOption === 'efectivoBs') {
            const vueltoBs = roundMoney(vueltoUsd * tasa);
            efectivoBsNeto = roundMoney(bsEfectivo - vueltoBs);
        }
    }

    let fiadoUsd = 0;
    let clienteNombre = "";
    if (clienteId) {
        const cliente = clientes.find(c => c.id === clienteId);
        if (cliente) clienteNombre = cliente.nombre;
        if (totalPagadoUsd < currentSaleTotal) {
            fiadoUsd = roundMoney(currentSaleTotal - totalPagadoUsd);
        }
    }

    const puntosGanados = clienteId ? Math.floor(currentSaleTotal) : 0;
    const nextFactura = ((storeConfig.nroFactura || 1000) + 1);

    const saleData = {
        nroFactura: nextFactura,
        fechaStr: new Date().toLocaleString(),
        cajero: currentUser ? currentUser.email : 'cajero',
        items: [...cart],
        status: 'abierto',
        subtotalUsd: subtotalVenta,
        descuentoUsd: roundMoney(currentDiscount),
        totalUsd: roundMoney(currentSaleTotal),
        costoTotalUsd: roundMoney(totalCosto),
        costoIncompleto: costoIncompleto,
        // null = no se puede calcular (falta el costo de algún artículo). La
        // Torre de Control lo aparta del margen en vez de estimarlo.
        gananciaBrutaUsd: costoIncompleto ? null : roundMoney(currentSaleTotal - totalCosto),
        puntosGanados: puntosGanados,
        puntosCanjeados: puntosCanjeadosVenta,
        saldoFavorAplicadoUsd: saldoFavorAplicadoVenta,
        vuelto: {
            montoUsd: vueltoUsd,
            montoBs: roundMoney(vueltoUsd * tasa),
            metodo: selectedVueltoOption,
            pagoMovilDetalle: selectedVueltoOption === 'pagoMovil' ? {
                telefono: document.getElementById('vuelto-pm-telefono')?.value || '',
                cedula: document.getElementById('vuelto-pm-cedula')?.value || '',
                banco: document.getElementById('vuelto-pm-banco')?.value || '',
                ref: document.getElementById('vuelto-pm-ref')?.value || ''
            } : null
        },
        pagos: {
            efectivoUsd: efectivoUsdNeto,
            zelleUsd: usdZelle,
            efectivoBs: efectivoBsNeto,
            puntoBs: bsPunto,
            pagoMovilBs: bsPMovil,
            bancoPM: bancoPM,
            saldoFavorUsd: saldoFavorAplicadoVenta
        },
        tasaBCV: tasa,
        clienteId: clienteId || null,
        clienteNombre: clienteNombre,
        fiadoUsd: fiadoUsd
    };

    // RUTA DIRECTA OFFLINE: si no hay conexión a internet
    if (!navigator.onLine) {
        return procesarVentaOffline(saleData, [...cart], clienteId, saldoFavorAplicadoVenta, vueltoUsd, selectedVueltoOption);
    }

    // RUTA ONLINE CON FALLBACK AUTOMÁTICO
    // `ventaConfirmada` es la clave: si el batch llegó a confirmarse, NO se
    // puede volver a procesar la venta como offline. Antes, cualquier fallo
    // POSTERIOR al commit (generar el ticket, enviar el WhatsApp) caía en el
    // mismo catch y el respaldo offline la registraba otra vez: venta
    // duplicada, doble descuento de stock, doble deuda del cliente y doble
    // puntos. Y si el error no parecía de red, el carrito quedaba sin limpiar
    // y un segundo clic del cajero la duplicaba igual.
    let ventaConfirmada = false;
    let saleRef = null;
    let onlineSaleData = null;
    try {
        const batch = db.batch();
        cart.forEach(i => {
            const prodRef = getDb('products').doc(i.id);
            const prodData = products.find(p => p.id === i.id);
            if (prodData) {
                const { id, ...dataSinId } = prodData;
                batch.set(prodRef, {
                    ...dataSinId,
                    stock: firebase.firestore.FieldValue.increment(-i.qty)
                }, { merge: true });
            } else {
                batch.set(prodRef, { stock: firebase.firestore.FieldValue.increment(-i.qty) }, { merge: true });
            }
        });

        if (clienteId) {
            if (fiadoUsd > 0) {
                batch.update(getDb('clientes').doc(clienteId), { deudaUsd: firebase.firestore.FieldValue.increment(fiadoUsd) });
            }
            if (saldoFavorAplicadoVenta > 0) {
                batch.update(getDb('clientes').doc(clienteId), { saldoFavorUsd: firebase.firestore.FieldValue.increment(-saldoFavorAplicadoVenta) });
            }
            if (vueltoUsd > 0 && selectedVueltoOption === 'saldoFavor') {
                const cliente = clientes.find(c => c.id === clienteId);
                const deudaActual = cliente?.deudaUsd || 0;
                if (deudaActual > 0) {
                    // Se usa `<` y no `<=` a propósito: cuando el vuelto cubre
                    // toda la deuda conocida, se escribe 0 ABSOLUTO en vez de
                    // un incremento negativo. Si la caché del cliente está
                    // desactualizada, el incremento dejaba la deuda en
                    // negativo y las reglas de Firestore rechazaban el lote
                    // completo, tumbando la venta.
                    if (vueltoUsd < deudaActual) {
                        batch.update(getDb('clientes').doc(clienteId), { deudaUsd: firebase.firestore.FieldValue.increment(-vueltoUsd) });
                    } else {
                        const remanente = roundMoney(vueltoUsd - deudaActual);
                        batch.update(getDb('clientes').doc(clienteId), {
                            deudaUsd: 0,
                            saldoFavorUsd: firebase.firestore.FieldValue.increment(remanente)
                        });
                    }
                } else {
                    batch.update(getDb('clientes').doc(clienteId), { saldoFavorUsd: firebase.firestore.FieldValue.increment(vueltoUsd) });
                }
            }
            const deltaPuntos = puntosGanados - (puntosCanjeadosVenta || 0);
            batch.update(getDb('clientes').doc(clienteId), { puntos: firebase.firestore.FieldValue.increment(deltaPuntos) });
        }

        storeConfig.nroFactura = nextFactura;
        batch.set(getDb('settings').doc('general'), { nroFactura: nextFactura }, { merge: true });

        saleRef = getDb('sales').doc();
        onlineSaleData = {
            ...saleData,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };

        batch.set(saleRef, onlineSaleData);
        await batch.commit();
        ventaConfirmada = true;
    } catch (e) {
        // El respaldo offline SOLO es válido si el batch NO se confirmó.
        if (!ventaConfirmada && (!navigator.onLine || e.code === 'unavailable' || (e.message && (e.message.toLowerCase().includes('offline') || e.message.toLowerCase().includes('network') || e.message.toLowerCase().includes('failed to fetch'))))) {
            console.warn("Fallo en Firestore online, activando respaldo offline automático:", e);
            return procesarVentaOffline(saleData, [...cart], clienteId, saldoFavorAplicadoVenta, vueltoUsd, selectedVueltoOption);
        }
        console.error("Error al procesar la venta:", e);
        Swal.fire('Error', e.message || 'Fallo de conexión al procesar la venta.', 'error');
        btn.disabled = false;
        btn.className = "w-full animated-btn bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl shadow-lg shadow-emerald-600/25 transition-all text-base";
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Procesar Venta';
        return;
    }

    // ---- POST-COMMIT: la venta YA está guardada en la nube ----
    // A partir de aquí nada puede deshacerla ni reintentarla. Si el ticket o el
    // WhatsApp fallan, se informa, pero la venta queda registrada y el carrito
    // se limpia igual.
    try {
        if (document.getElementById('pay-print-ticket')?.checked) {
            generateReceipt({ ...onlineSaleData, id: saleRef.id });
        }
        const waCheckbox = document.getElementById('pay-send-whatsapp');
        if (waCheckbox && waCheckbox.checked) {
            enviarTicketWhatsApp({ ...onlineSaleData, id: saleRef.id });
        }
    } catch (eTicket) {
        console.error('La venta se guardó, pero falló el ticket o el WhatsApp:', eTicket);
        Swal.fire('Venta guardada', 'La venta se registró correctamente, pero no se pudo generar el ticket o el mensaje de WhatsApp.', 'warning');
    }

    // Comanda de Cocina para Modo Comida Rápida
    if (typeof crearComandaCocina === 'function') {
        crearComandaCocina(onlineSaleData, saleRef.id);
    }

    clearCart();
    closePaymentModal();

    if (typeof marcarCajaAbiertaPorVenta === 'function') {
        marcarCajaAbiertaPorVenta(currentNegocioId);
    }

    let msgExito = '¡Venta Procesada!';
    if (vueltoUsd > 0 && selectedVueltoOption === 'saldoFavor') {
        msgExito = `¡Venta Procesada! Se acreditaron $${vueltoUsd.toFixed(2)} de saldo a favor.`;
    }
    Swal.fire({ title: msgExito, icon: 'success', timer: 1400, showConfirmButton: false });
    setTimeout(() => {
        const s = document.getElementById('search-pos');
        if (s) {
            s.focus();
            s.select();
        }
    }, 300);
}

// =====================================================
// TICKET Y WHATSAPP
// =====================================================
function enviarTicketWhatsApp(s) {
    let phone = '';
    if (s.clienteId) {
        const c = clientes.find(x => x.id === s.clienteId);
        if (c && c.telefono) phone = c.telefono.replace(/[^0-9]/g, '');
    }
    const storeName = (storeConfig && storeConfig.name) ? storeConfig.name : 'Mi Negocio';
    let lineas = s.items.map(i => `• ${i.qty} ${i.tipo} ${i.nombre} - $${(i.qty * i.precio).toFixed(2)}`).join('\n');
    let msg = `*${storeName.toUpperCase()}*\n🧾 *TICKET:* #${s.id.slice(-6).toUpperCase()}\n📅 *Fecha:* ${s.fechaStr}\n`;
    if (s.clienteNombre) msg += `👤 *Cliente:* ${s.clienteNombre}\n`;
    msg += `---------------------------\n${lineas}\n---------------------------\n`;
    if (s.descuentoUsd > 0) msg += `🏷️ *Descuento:* -$${s.descuentoUsd.toFixed(2)}\n`;
    if (s.saldoFavorAplicadoUsd > 0) msg += `🎁 *Saldo a Favor Usado:* -$${s.saldoFavorAplicadoUsd.toFixed(2)}\n`;
    msg += `*TOTAL: $${s.totalUsd.toFixed(2)} (Bs ${(s.totalUsd * s.tasaBCV).toFixed(2)})*\n`;
    if (s.vuelto && s.vuelto.montoUsd > 0) {
        const metodoLabels = {
            efectivoUsd: 'Efectivo $',
            efectivoBs: 'Efectivo Bs',
            pagoMovil: 'Pago Móvil',
            saldoFavor: 'Saldo a Favor Guardado'
        };
        const mLabel = metodoLabels[s.vuelto.metodo] || 'Efectivo';
        msg += `💵 *Vuelto (${mLabel}):* $${s.vuelto.montoUsd.toFixed(2)} (Bs ${s.vuelto.montoBs.toFixed(2)})\n`;
        if (s.vuelto.metodo === 'saldoFavor') {
            msg += `🎉 *¡Guardado como Saldo a Favor para tu próxima compra!*\n`;
        }
    }
    if (s.fiadoUsd > 0) msg += `⚠️ *Fiado:* $${s.fiadoUsd.toFixed(2)}\n`;
    if (s.puntosGanados > 0) msg += `🎁 *Puntos ganados:* +${s.puntosGanados} pts\n`;
    msg += `\n¡Gracias por su preferencia!`;
    if (phone) {
        window.open(enlaceWhatsApp(phone, msg), '_blank');
    } else {
        Swal.fire({
            title: 'Enviar Ticket por WhatsApp',
            input: 'text',
            inputLabel: 'Número (basta el local, ej: 04121234567):',
            showCancelButton: true,
            confirmButtonText: 'Enviar'
        }).then(res => {
            if (res.isConfirmed && res.value) {
                const destino = normalizarTelefono(res.value);
                if (destino) window.open(enlaceWhatsApp(destino, msg), '_blank');
                else Swal.fire('Número inválido', 'Escribe al menos un número de teléfono.', 'warning');
            }
        });
    }
}

/**
 * Motor de impresión 100% aislado para tickets POS
 * Utiliza un iframe invisible para evitar alterar el DOM de la aplicación o causar parpadeos,
 * pantallas oscurecidas o desfases en la pantalla del usuario.
 */
function imprimirTicketAislado(htmlContent, options = {}) {
    const width = options.width || '78mm';
    const isLandscape = options.landscape || false;

    // Crear o reutilizar un iframe invisible fuera de la pantalla
    let iframe = document.getElementById('ticket-silent-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'ticket-silent-iframe';
        iframe.setAttribute('style', 'position: fixed !important; top: -10000px !important; left: -10000px !important; width: 0px !important; height: 0px !important; border: 0 !important; opacity: 0 !important; pointer-events: none !important; z-index: -9999 !important;');
        document.body.appendChild(iframe);
    }

    try {
        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Ticket</title>
                <style>
                    @page {
                        margin: 0;
                        size: ${isLandscape ? 'auto landscape' : 'auto'};
                    }
                    * {
                        box-sizing: border-box;
                        margin: 0;
                        padding: 0;
                    }
                    body {
                        font-family: 'Courier New', Courier, monospace, sans-serif;
                        color: #000000 !important;
                        background: #ffffff !important;
                        width: ${width};
                        max-width: ${width};
                        margin: 0 auto;
                        padding: 4mm 3mm;
                        font-size: 12px;
                        line-height: 1.35;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    img {
                        max-width: 100%;
                        height: auto;
                        display: block;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    hr {
                        border: none;
                        border-top: 1px dashed #000;
                        margin: 6px 0;
                    }
                </style>
            </head>
            <body>
                ${htmlContent}
            </body>
            </html>
        `);
        doc.close();

        const images = doc.images;
        let loaded = 0;
        const totalImages = images.length;

        const triggerPrint = () => {
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (err) {
                console.warn("Fallo al imprimir por iframe, usando fallback:", err);
                imprimirFallbackNativo(htmlContent);
            }
        };

        if (totalImages === 0) {
            setTimeout(triggerPrint, 150);
        } else {
            let triggered = false;
            const checkDone = () => {
                if (triggered) return;
                loaded++;
                if (loaded >= totalImages) {
                    triggered = true;
                    setTimeout(triggerPrint, 100);
                }
            };
            for (let i = 0; i < totalImages; i++) {
                if (images[i].complete) {
                    checkDone();
                } else {
                    images[i].onload = checkDone;
                    images[i].onerror = checkDone;
                }
            }
            setTimeout(() => {
                if (!triggered) {
                    triggered = true;
                    triggerPrint();
                }
            }, 600);
        }

    } catch (e) {
        console.warn("Excepción al escribir en iframe:", e);
        imprimirFallbackNativo(htmlContent);
    }
}

function imprimirFallbackNativo(htmlContent) {
    const el = document.getElementById('print-section');
    if (!el) return;
    el.innerHTML = htmlContent;
    window.print();
    setTimeout(() => {
        el.innerHTML = '';
    }, 1000);
}

function generateReceipt(s) {
    let logoHtml = '';
    if (storeConfig.logo) {
        logoHtml = `<div style="text-align:center; margin-bottom: 5px;"><img src="${storeConfig.logo}" style="max-height: 60px; width: auto; filter: grayscale(100%);"></div>`;
    }

    const metodoLabels = {
        efectivoUsd: 'EFECTIVO $',
        efectivoBs: 'EFECTIVO BS',
        pagoMovil: 'PAGO MÓVIL',
        saldoFavor: 'SALDO A FAVOR'
    };

    const receiptHtml = `
        <div style="text-align:center; margin-bottom:10px; border-bottom:1px dashed #000; padding-bottom:10px; font-family: 'Courier New', Courier, monospace; color: black;">
            ${logoHtml}
            <h2 style="margin:0; font-size:18px; font-weight:900; text-transform:uppercase;">${storeConfig.name}</h2>
            ${storeConfig.rif ? `<p style="margin:0; font-size:12px; font-weight:bold;">RIF: ${storeConfig.rif}</p>` : ''}
            <p style="margin:4px 0 0 0; font-size:12px; font-weight:bold;">TICKET DE VENTA</p>
            <p style="margin:4px 0 0 0; font-size:11px;">Ref: #${(s.numeroFactura || s.id.slice(-6)).toUpperCase()}</p>
            <p style="margin:0; font-size:11px;">Fecha: ${s.fechaStr}</p>
            <p style="margin:0; font-size:11px;">Cajero: ${s.cajero}</p>
            ${s.clienteNombre ? `<p style="margin:0; font-size:11px; font-weight:bold;">Cliente: ${s.clienteNombre}</p>` : ''}
        </div>
        <div style="border-bottom:1px dashed #000; padding-bottom:10px; margin-bottom:10px; font-family: 'Courier New', Courier, monospace; color: black;">
            ${s.items.map(i => `<div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold; margin-bottom:4px;"><span style="flex:1; text-align:left;">${i.qty} ${i.tipo} - ${i.nombre}</span><span>$${(i.qty * i.precio).toFixed(2)}</span></div>`).join('')}
        </div>
        ${s.descuentoUsd > 0 ? `
            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold; margin-bottom:4px; font-family: 'Courier New', monospace;"><span>SUBTOTAL:</span><span>$${(s.totalUsd + s.descuentoUsd).toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold; margin-bottom:4px; font-family: 'Courier New', monospace; color: #dc2626;"><span>DESCUENTO:</span><span>-$${s.descuentoUsd.toFixed(2)}</span></div>
        ` : ''}
        ${s.saldoFavorAplicadoUsd > 0 ? `
            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold; margin-bottom:4px; font-family: 'Courier New', monospace; color: #059669;"><span>SALDO A FAVOR USADO:</span><span>-$${s.saldoFavorAplicadoUsd.toFixed(2)}</span></div>
        ` : ''}
        <div style="font-weight:900; display:flex; justify-content:space-between; font-family: 'Courier New', monospace; font-size:16px; color: black;"><span>TOTAL:</span><span>$${s.totalUsd.toFixed(2)}</span></div>
        ${(s.tasaBCV && s.tasaBCV > 0) ? `
            <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:bold; font-family: 'Courier New', monospace; color: black; margin-top:2px;"><span>EQUIV. BCV (Tasa ${s.tasaBCV.toFixed(2)}):</span><span>Bs ${(s.totalUsd * s.tasaBCV).toFixed(2)}</span></div>
        ` : ''}
        ${s.vuelto && s.vuelto.montoUsd > 0 ? `
            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold; margin-top:4px; font-family: 'Courier New', monospace;"><span>VUELTO (${metodoLabels[s.vuelto.metodo] || 'EFECTIVO'}):</span><span>$${s.vuelto.montoUsd.toFixed(2)} (Bs ${s.vuelto.montoBs.toFixed(2)})</span></div>
            ${s.vuelto.metodo === 'saldoFavor' ? '<div style="text-align:center; font-size:10px; font-weight:bold; margin:2px 0; color:#2563eb;">* ACREDITADO A CUENTA DE CLIENTE *</div>' : ''}
        ` : ''}
        ${s.fiadoUsd > 0 ? `<div style="font-weight:bold; display:flex; justify-content:space-between; font-family: 'Courier New', monospace; font-size:14px; color:#b91c1c;"><span>FIADO:</span><span>$${s.fiadoUsd.toFixed(2)}</span></div>` : ''}
        <div style="text-align:center; margin-top:12px; padding-top:8px; border-top:1px dashed #000;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&margin=0&data=${encodeURIComponent(`TICKET:${(s.numeroFactura || s.id.slice(-6)).toUpperCase()}|TOTAL:$${s.totalUsd.toFixed(2)}|FECHA:${s.fechaStr}`)}" style="width:85px; height:85px; margin:0 auto; display:block;" alt="QR" />
            <p style="margin:4px 0 0 0; font-size:10px; font-family:'Courier New', monospace;">Escanear para verificar</p>
        </div>
        <div style="text-align:center; margin-top:8px; font-size:12px; font-family: 'Courier New', monospace; font-weight:bold;"><p>¡Gracias por su compra!</p></div>`;

    imprimirTicketAislado(receiptHtml);
}

// =====================================================
// GASTOS Y CAJA CHICA
// =====================================================
function openGastoModal() {
    document.getElementById('gasto-concepto').value = '';
    document.getElementById('gasto-monto').value = '';
    const cat = document.getElementById('gasto-categoria');
    if (cat) cat.selectedIndex = 0;
    const ori = document.getElementById('gasto-origen');
    if (ori) ori.selectedIndex = 0;
    const m = document.getElementById('gasto-modal');
    const c = document.getElementById('gasto-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
        document.getElementById('gasto-concepto').focus();
    }, 10);
}

function closeGastoModal() {
    const m = document.getElementById('gasto-modal');
    const c = document.getElementById('gasto-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

async function guardarGasto() {
    const categoria = document.getElementById('gasto-categoria') ? document.getElementById('gasto-categoria').value : 'Otros Gastos';
    const origen = document.getElementById('gasto-origen') ? document.getElementById('gasto-origen').value : 'Gaveta Efectivo USD';
    const concepto = document.getElementById('gasto-concepto').value.trim();
    const monto = parseFloat(document.getElementById('gasto-monto').value);
    const moneda = document.getElementById('gasto-moneda').value;
    if (!concepto || isNaN(monto) || monto <= 0) return Swal.fire('Atención', 'Datos inválidos', 'warning');
    let montoUsd = moneda === 'BS' ? monto / rates.bcv : monto;
    try {
        await getDb('gastos').add({
            concepto, categoria, origen, montoOriginal: monto, moneda, montoUsd, status: 'abierto',
            cajero: currentUser.email,
            fechaStr: new Date().toLocaleString(),
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeGastoModal();
        Swal.fire({ title: 'Registrado', text: `Salida $${montoUsd.toFixed(2)} (${categoria})`, icon: 'success', timer: 1500, showConfirmButton: false });
    } catch (e) {
        Swal.fire('Error', 'Fallo conexión', 'error');
    }
}

function verCajaChica() {
    const m = document.getElementById('caja-chica-modal');
    const c = document.getElementById('caja-chica-modal-content');
    if (!m) return;
    let totalGastosUsd = 0;
    const tbody = document.getElementById('caja-chica-table-body');
    if (tbody) tbody.innerHTML = '';
    const gastosActivos = gastosHistory.filter(g => g.status === 'abierto' || !g.status);
    gastosActivos.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    gastosActivos.forEach(g => {
        const usd = g.montoUsd || (g.moneda === 'BS' ? g.montoOriginal / rates.bcv : g.montoOriginal) || 0;
        totalGastosUsd += usd;
        if (tbody) {
            tbody.innerHTML += `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="p-3 text-slate-500 whitespace-nowrap">${g.fechaStr ? g.fechaStr.split(',')[1] || g.fechaStr : 'Hoy'}</td>
                    <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">${g.categoria || 'Gasto Menor'}</span></td>
                    <td class="p-3 font-semibold text-slate-800">${g.concepto}</td>
                    <td class="p-3 text-slate-500 text-[11px]">${g.origen || 'Gaveta'}</td>
                    <td class="p-3 text-right font-black text-rose-600">-$${usd.toFixed(2)}<br><span class="text-[10px] font-normal text-slate-400">Bs ${(usd * rates.bcv).toFixed(2)}</span></td>
                    <td class="p-3 text-center admin-only">
                        ${isAdmin ? `<button onclick="eliminarGasto('${g.id}')" class="w-7 h-7 rounded-full bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-colors"><i class="fa-solid fa-trash text-xs"></i></button>` : ''}
                    </td>
                </tr>`;
        }
    });
    if (gastosActivos.length === 0 && tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400">Sin movimientos</td></tr>`;
    }
    const totalUsdEl = document.getElementById('caja-chica-total-usd');
    const totalBsEl = document.getElementById('caja-chica-total-bs');
    if (totalUsdEl) totalUsdEl.textContent = `-$${totalGastosUsd.toFixed(2)}`;
    if (totalBsEl) totalBsEl.textContent = `-Bs ${(totalGastosUsd * rates.bcv).toFixed(2)}`;
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        if (c) c.classList.remove('scale-95');
    }, 10);
}

function closeCajaChicaModal() {
    const m = document.getElementById('caja-chica-modal');
    const c = document.getElementById('caja-chica-modal-content');
    if (!m) return;
    m.classList.add('opacity-0');
    if (c) c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

function eliminarGasto(id) {
    if (!isAdmin) return;
    Swal.fire({
        title: '¿Anular Salida?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sí, anular'
    }).then(async r => {
        if (r.isConfirmed) {
            try {
                await getDb('gastos').doc(id).delete();
                Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Anulado', timer: 1500, showConfirmButton: false });
                setTimeout(verCajaChica, 300);
            } catch (e) {
                Swal.fire('Error', e.message, 'error');
            }
        }
    });
}

// =====================================================
// REPORTES Y GRÁFICOS
// =====================================================
function renderReports() {
    setTimeout(updateDashboardCharts, 500);
    if (!isAdmin) return;
    let tVentas = 0, tGananciaBruta = 0, tMermas = 0, tGastos = 0, tFiados = 0, tDescuentos = 0;
    let ventasSinCosto = 0;
    let cajEfectivoUsd = 0, cajZelle = 0, cajEfectivoBs = 0, cajPunto = 0, cajPMovil = 0;
    let saldosBancarios = {};
    let historyMerged = [
        ...salesHistory.map(s => ({ ...s, _type: 'Venta' })),
        ...gastosHistory.map(g => ({ ...g, _type: 'Gasto' })),
        ...abonosHistory.map(a => ({ ...a, _type: 'Abono' }))
    ];
    historyMerged.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    const t = document.getElementById('sales-table-body');
    if (t) t.innerHTML = '';
    historyMerged.forEach((item) => {
        if (item._type === 'Venta') {
            tVentas += item.totalUsd || 0;
            tDescuentos += item.descuentoUsd || 0;
            // Las ventas con costo incompleto se guardan con
            // gananciaBrutaUsd = null. Se cuentan aparte para poder avisar, en
            // vez de sumar 0 en silencio y mostrar una ganancia que parece
            // exacta cuando no lo es.
            if (item.gananciaBrutaUsd === null || item.gananciaBrutaUsd === undefined) ventasSinCosto++;
            else tGananciaBruta += item.gananciaBrutaUsd;
            tFiados += item.fiadoUsd || 0;
            cajEfectivoUsd += item.pagos?.efectivoUsd || 0;
            cajZelle += item.pagos?.zelleUsd || 0;
            cajEfectivoBs += item.pagos?.efectivoBs || 0;
            cajPunto += item.pagos?.puntoBs || 0;
            cajPMovil += item.pagos?.pagoMovilBs || 0;
            if (item.pagos?.pagoMovilBs > 0 && item.pagos?.bancoPM) {
                saldosBancarios[item.pagos.bancoPM] = (saldosBancarios[item.pagos.bancoPM] || 0) + item.pagos.pagoMovilBs;
            }
            if (t) t.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-100">
                    <td class="py-3 text-xs text-slate-500">${item.fechaStr.split(', ')[1] || item.fechaStr}</td>
                    <td class="py-3 text-xs font-bold text-emerald-500">Venta</td>
                    <td class="py-3 text-xs font-medium text-slate-700">${item.items.map(i => `${i.qty}x ${i.nombre}`).join(', ')}</td>
                    <td class="py-3 font-black text-slate-800 text-right">+$${(item.totalUsd || 0).toFixed(2)}</td>
                    <td class="py-3 text-center"><button onclick="deleteSale('${item.id}')" class="text-rose-500 hover:bg-rose-100 p-2 rounded-lg"><i class="fa-solid fa-trash"></i></button></td>
                </tr>`;
        } else if (item._type === 'Gasto') {
            tGastos += item.montoUsd || 0;
            if (item.moneda === 'USD') cajEfectivoUsd -= item.montoOriginal;
            else cajEfectivoBs -= item.montoOriginal;
            if (t) t.innerHTML += `
                <tr class="hover:bg-amber-50 border-b border-slate-100">
                    <td class="py-3 text-xs text-slate-500">${item.fechaStr.split(', ')[1] || item.fechaStr}</td>
                    <td class="py-3 text-xs font-bold text-amber-600">Gasto</td>
                    <td class="py-3 text-xs font-medium text-amber-800">${item.concepto}</td>
                    <td class="py-3 font-black text-rose-600 text-right">-$${(item.montoUsd || 0).toFixed(2)}</td>
                    <td class="py-3 text-center"><button onclick="deleteGasto('${item.id}')" class="text-rose-500 hover:bg-rose-100 p-2 rounded-lg"><i class="fa-solid fa-trash"></i></button></td>
                </tr>`;
        } else if (item._type === 'Abono') {
            if (item.metodoUsado === 'efectivoUsd') cajEfectivoUsd += item.montoUsd;
            if (item.metodoUsado === 'zelleUsd') cajZelle += item.montoUsd;
            if (item.metodoUsado === 'efectivoBs') cajEfectivoBs += (item.montoUsd * item.tasaBCV);
            if (item.metodoUsado === 'puntoBs') cajPunto += (item.montoUsd * item.tasaBCV);
            if (item.metodoUsado === 'pagoMovilBs') {
                cajPMovil += (item.montoUsd * item.tasaBCV);
                if (item.bancoDestino) {
                    saldosBancarios[item.bancoDestino] = (saldosBancarios[item.bancoDestino] || 0) + (item.montoUsd * item.tasaBCV);
                }
            }
            if (t) t.innerHTML += `
                <tr class="hover:bg-blue-50 border-b border-slate-100">
                    <td class="py-3 text-xs text-slate-500">${item.fechaStr.split(', ')[1] || item.fechaStr}</td>
                    <td class="py-3 text-xs font-bold text-blue-500">Abono</td>
                    <td class="py-3 text-xs font-medium text-blue-800">Deuda de ${item.clienteNombre}</td>
                    <td class="py-3 font-black text-blue-600 text-right">+$${(item.montoUsd || 0).toFixed(2)}</td>
                    <td class="py-3 text-center"><button onclick="deleteAbono('${item.id}')" class="text-rose-500 hover:bg-rose-100 p-2 rounded-lg"><i class="fa-solid fa-trash"></i></button></td>
                </tr>`;
        }
    });
    tMermas = mermasHistory.reduce((a, m) => a + (m.costoPerdida || 0), 0);
    const ventasContado = tVentas - tFiados;
    const utilBruta = tGananciaBruta;
    const utilNetaEfectiva = (ventasContado - (tVentas - tGananciaBruta)) - tGastos - tMermas;
    
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('rep-total-ventas', `$${tVentas.toFixed(2)}`);
    setTxt('rep-total-ventas-bs', `Bs ${(tVentas * rates.bcv).toFixed(2)}`);
    setTxt('rep-ventas-contado', `$${ventasContado.toFixed(2)}`);
    setTxt('rep-ventas-contado-bs', `Bs ${(ventasContado * rates.bcv).toFixed(2)}`);
    setTxt('rep-total-ganancia', `$${utilBruta.toFixed(2)}`);
    setTxt('rep-total-ganancia-bs', `Bs ${(utilBruta * rates.bcv).toFixed(2)}`);
    // Aviso honesto: de dónde sale —y de dónde NO— la ganancia mostrada.
    const notaGanancia = document.getElementById('rep-ganancia-nota');
    if (notaGanancia) {
        if (ventasSinCosto > 0) {
            notaGanancia.textContent = `${ventasSinCosto} venta(s) sin costo capturado quedan fuera de la ganancia`;
            notaGanancia.classList.remove('hidden');
        } else {
            notaGanancia.textContent = '';
            notaGanancia.classList.add('hidden');
        }
    }
    setTxt('rep-total-gastos', `-$${tGastos.toFixed(2)}`);
    setTxt('rep-total-gastos-bs', `Bs ${(tGastos * rates.bcv).toFixed(2)}`);
    setTxt('rep-mermas-usd', `-$${tMermas.toFixed(2)}`);
    setTxt('rep-mermas-usd-bs', `Bs ${(tMermas * rates.bcv).toFixed(2)}`);
    setTxt('rep-ganancia-neta', `$${utilNetaEfectiva.toFixed(2)}`);
    setTxt('rep-ganancia-neta-bs', `Bs ${(utilNetaEfectiva * rates.bcv).toFixed(2)}`);
    setTxt('rep-fiados', `$${tFiados.toFixed(2)}`);
    setTxt('rep-fiados-bs', `Bs ${(tFiados * rates.bcv).toFixed(2)}`);
    setTxt('rep-descuentos', `-$${tDescuentos.toFixed(2)}`);
    setTxt('rep-descuentos-bs', `Bs ${(tDescuentos * rates.bcv).toFixed(2)}`);
    const gn = document.getElementById('rep-ganancia-neta');
    if (gn) gn.className = utilNetaEfectiva >= 0 ? "text-2xl font-black text-emerald-400" : "text-2xl font-black text-rose-400";
    setTxt('caja-efectivo-usd', `$${cajEfectivoUsd.toFixed(2)}`);
    setTxt('caja-zelle', `$${cajZelle.toFixed(2)}`);
    setTxt('caja-efectivo-bs', `Bs ${cajEfectivoBs.toFixed(2)}`);
    setTxt('caja-efectivo-bs-usd', `$${(cajEfectivoBs / rates.bcv).toFixed(2)}`);
    setTxt('caja-punto', `Bs ${cajPunto.toFixed(2)}`);
    setTxt('caja-punto-usd', `$${(cajPunto / rates.bcv).toFixed(2)}`);
    const bc = document.getElementById('saldos-bancarios-container');
    if (bc) {
        bc.innerHTML = '';
        let foundBank = false;
        for (let banco in saldosBancarios) {
            if (saldosBancarios[banco] > 0) {
                foundBank = true;
                bc.innerHTML += `
                    <div class="flex justify-between items-center bg-white border border-slate-100 p-2 rounded-lg mb-1">
                        <span class="text-xs font-bold text-slate-700">${banco}</span>
                        <div class="text-right">
                            <span class="font-black text-blue-600">Bs ${saldosBancarios[banco].toFixed(2)}</span>
                            <p class="text-[10px] font-bold text-slate-400">$${(saldosBancarios[banco] / rates.bcv).toFixed(2)}</p>
                        </div>
                    </div>`;
            }
        }
        if (!foundBank) bc.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">Sin transferencias</p>';
    }
}

async function updateDashboardCharts() {
    if (!isAdmin) return;
    if (typeof Chart === 'undefined') return;
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : '#f1f5f9';
    const productCounts = {};
    salesHistory.forEach(s => {
        if (s.items) {
            s.items.forEach(i => {
                if (!productCounts[i.nombre]) productCounts[i.nombre] = 0;
                productCounts[i.nombre] += (i.qty || 0);
            });
        }
    });
    const sortedProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topLabels = sortedProducts.map(p => p[0]);
    const topData = sortedProducts.map(p => p[1]);
    const ctxTop = document.getElementById('topProductosChart');
    if (ctxTop) {
        if (chartTop) chartTop.destroy();
        if (topLabels.length === 0) {
            topLabels.push("Sin ventas");
            topData.push(1);
        }
        chartTop = new Chart(ctxTop, {
            type: 'doughnut',
            data: {
                labels: topLabels,
                datasets: [{
                    data: topData,
                    backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'],
                    borderWidth: isDark ? 2 : 0,
                    borderColor: isDark ? '#1e293b' : '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { color: textColor, font: { family: "'Inter', sans-serif" } } } }
            }
        });
    }
    try {
        const snap = await getDb('cierres').orderBy('timestamp', 'desc').limit(7).get();
        const cierres = [];
        snap.forEach(doc => cierres.push(doc.data()));
        cierres.reverse();
        const labels = cierres.map(c => {
            const d = c.timestamp ? c.timestamp.toDate() : new Date();
            return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
        });
        const data = cierres.map(c => c.ventasTotalesUsd || 0);
        const currentSalesUsd = parseFloat(document.getElementById('rep-total-ventas')?.textContent.replace('$', '') || 0);
        labels.push('Hoy');
        data.push(currentSalesUsd);
        const ctxVentas = document.getElementById('ventasChart');
        if (ctxVentas) {
            if (chartVentas) chartVentas.destroy();
            chartVentas = new Chart(ctxVentas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Ventas USD ($)',
                        data: data,
                        borderColor: '#6366f1',
                        backgroundColor: isDark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: isDark ? '#1e293b' : '#ffffff',
                        pointBorderColor: '#6366f1',
                        pointBorderWidth: 2,
                        pointRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, ticks: { color: textColor }, grid: { borderDash: [4, 4], color: gridColor } },
                        x: { ticks: { color: textColor }, grid: { display: false } }
                    }
                }
            });
        }
    } catch (error) {
        console.error("Error gráficos:", error);
    }
}

// =====================================================
// ARQUEO DE CAJA DIARIO EN 30 SEGUNDOS (CORTE Z)
// =====================================================
let arqueoEsperado = {
    efectivoUsd: 0,
    efectivoBs: 0,
    puntoBs: 0,
    pagoMovilBs: 0,
    zelleUsd: 0,
    totalUsd: 0,
    ventasTotalUsd: 0,
    gananciaNetaUsd: 0,
    gastosUsd: 0
};

function cerrarCaja() {
    abrirModalArqueo30Seg();
}

function abrirModalArqueo30Seg() {
    const modal = document.getElementById('arqueo-modal');
    const content = document.getElementById('arqueo-modal-content');
    if (!modal) return;

    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;

    // Calcular montos esperados por el sistema para el turno abierto actual
    let espEfUsd = 0;
    let espEfBs = 0;
    let espPuntoBs = 0;
    let espPMBs = 0;
    let espZelleUsd = 0;
    let tVentasUsd = 0;
    let tGastosUsd = 0;
    let tGananciaBruta = 0;
    let tFiadosUsd = 0;

    salesHistory.forEach(s => {
        tVentasUsd += s.totalUsd || 0;
        tGananciaBruta += s.gananciaBrutaUsd || 0;
        tFiadosUsd += s.fiadoUsd || 0;
        espEfUsd += s.pagos?.efectivoUsd || 0;
        espZelleUsd += s.pagos?.zelleUsd || 0;
        espEfBs += s.pagos?.efectivoBs || 0;
        espPuntoBs += s.pagos?.puntoBs || 0;
        espPMBs += s.pagos?.pagoMovilBs || 0;
    });

    gastosHistory.forEach(g => {
        tGastosUsd += g.montoUsd || 0;
        if (g.moneda === 'USD') espEfUsd -= (g.montoOriginal || g.montoUsd || 0);
        else espEfBs -= (g.montoOriginal || (g.montoUsd * tasa) || 0);
    });

    abonosHistory.forEach(a => {
        if (a.metodoUsado === 'efectivoUsd') espEfUsd += a.montoUsd;
        if (a.metodoUsado === 'zelleUsd') espZelleUsd += a.montoUsd;
        if (a.metodoUsado === 'efectivoBs') espEfBs += (a.montoUsd * (a.tasaBCV || tasa));
        if (a.metodoUsado === 'puntoBs') espPuntoBs += (a.montoUsd * (a.tasaBCV || tasa));
        if (a.metodoUsado === 'pagoMovilBs') espPMBs += (a.montoUsd * (a.tasaBCV || tasa));
    });

    const mermasTotal = mermasHistory.reduce((acc, m) => acc + (m.costoPerdida || 0), 0);
    const ventasContado = tVentasUsd - tFiadosUsd;
    const utilNeta = (ventasContado - (tVentasUsd - tGananciaBruta)) - tGastosUsd - mermasTotal;

    const totalEsperadoConsolidadoUsd = espEfUsd + espZelleUsd + (espEfBs / tasa) + (espPuntoBs / tasa) + (espPMBs / tasa);

    arqueoEsperado = {
        efectivoUsd: roundMoney(espEfUsd),
        efectivoBs: roundMoney(espEfBs),
        puntoBs: roundMoney(espPuntoBs),
        pagoMovilBs: roundMoney(espPMBs),
        zelleUsd: roundMoney(espZelleUsd),
        totalUsd: roundMoney(totalEsperadoConsolidadoUsd),
        ventasTotalUsd: roundMoney(tVentasUsd),
        gananciaNetaUsd: roundMoney(utilNeta),
        gastosUsd: roundMoney(tGastosUsd)
    };

    // Actualizar UI del modal
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('arq-esp-usd', `$${arqueoEsperado.efectivoUsd.toFixed(2)}`);
    setEl('arq-esp-bs', `Bs ${arqueoEsperado.efectivoBs.toFixed(2)}`);
    setEl('arq-esp-bs-usd', `($${(arqueoEsperado.efectivoBs / tasa).toFixed(2)})`);
    setEl('arq-esp-punto', `Bs ${arqueoEsperado.puntoBs.toFixed(2)}`);
    setEl('arq-esp-punto-usd', `($${(arqueoEsperado.puntoBs / tasa).toFixed(2)})`);
    setEl('arq-esp-pm', `Bs ${arqueoEsperado.pagoMovilBs.toFixed(2)}`);
    setEl('arq-esp-pm-usd', `($${(arqueoEsperado.pagoMovilBs / tasa).toFixed(2)})`);
    setEl('arq-esp-zelle', `$${arqueoEsperado.zelleUsd.toFixed(2)}`);
    setEl('arq-esp-total-usd', `$${arqueoEsperado.totalUsd.toFixed(2)}`);
    setEl('arq-tasa-indicador', `Tasa BCV: Bs ${tasa.toFixed(2)}`);
    setEl('arqueo-turno-subtitle', `Cajero: ${currentUser?.email || 'Principal'} • Fecha: ${new Date().toLocaleDateString('es-VE')}`);

    // Limpiar campos físicos
    ['arq-fis-usd', 'arq-fis-bs', 'arq-fis-punto', 'arq-fis-pm', 'arq-fis-zelle', 'arq-observaciones'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    ['b-100', 'b-50', 'b-20', 'b-10', 'b-5', 'b-1'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('desglose-billetes-box')?.classList.add('hidden');

    calcularDiferenciasArqueo();

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        if (content) {
            content.classList.remove('scale-95');
            content.classList.add('scale-100');
        }
    });
}

function cerrarModalArqueo() {
    const modal = document.getElementById('arqueo-modal');
    const content = document.getElementById('arqueo-modal-content');
    if (!modal) return;
    modal.classList.add('opacity-0');
    if (content) {
        content.classList.remove('scale-100');
        content.classList.add('scale-95');
    }
    setTimeout(() => modal.classList.add('hidden'), 250);
}

function toggleBilletesDesglose() {
    const box = document.getElementById('desglose-billetes-box');
    if (box) box.classList.toggle('hidden');
}

function sumarDesgloseBilletes() {
    const b100 = (parseInt(document.getElementById('b-100')?.value) || 0) * 100;
    const b50 = (parseInt(document.getElementById('b-50')?.value) || 0) * 50;
    const b20 = (parseInt(document.getElementById('b-20')?.value) || 0) * 20;
    const b10 = (parseInt(document.getElementById('b-10')?.value) || 0) * 10;
    const b5 = (parseInt(document.getElementById('b-5')?.value) || 0) * 5;
    const b1 = (parseInt(document.getElementById('b-1')?.value) || 0) * 1;

    const total = b100 + b50 + b20 + b10 + b5 + b1;
    const inputUsd = document.getElementById('arq-fis-usd');
    if (inputUsd) {
        inputUsd.value = total > 0 ? total.toFixed(2) : '';
    }
    calcularDiferenciasArqueo();
}

function calcularDiferenciasArqueo() {
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;

    const fisUsd = parseFloat(document.getElementById('arq-fis-usd')?.value) || 0;
    const fisBs = parseFloat(document.getElementById('arq-fis-bs')?.value) || 0;
    const fisPunto = parseFloat(document.getElementById('arq-fis-punto')?.value) || 0;
    const fisPM = parseFloat(document.getElementById('arq-fis-pm')?.value) || 0;
    const fisZelle = parseFloat(document.getElementById('arq-fis-zelle')?.value) || 0;

    const totalFisicoUsd = fisUsd + fisZelle + (fisBs / tasa) + (fisPunto / tasa) + (fisPM / tasa);
    const difTotalUsd = roundMoney(totalFisicoUsd - arqueoEsperado.totalUsd);
    const difTotalBs = roundMoney(difTotalUsd * tasa);

    const elDifUsd = document.getElementById('arq-dif-total-usd');
    const elDifBs = document.getElementById('arq-dif-total-bs');
    const cardDiag = document.getElementById('arq-diagnostico-card');
    const iconDiag = document.getElementById('arq-diagnostico-icon');
    const titDiag = document.getElementById('arq-diagnostico-titulo');
    const descDiag = document.getElementById('arq-diagnostico-desc');

    if (elDifUsd) elDifUsd.textContent = `${difTotalUsd >= 0 ? '+' : ''}$${difTotalUsd.toFixed(2)}`;
    if (elDifBs) elDifBs.textContent = `${difTotalBs >= 0 ? '+' : ''}Bs ${difTotalBs.toFixed(2)}`;

    const noInputs = !document.getElementById('arq-fis-usd')?.value && !document.getElementById('arq-fis-bs')?.value && !document.getElementById('arq-fis-punto')?.value;

    if (noInputs) {
        cardDiag.className = "p-4 rounded-2xl border transition-all flex flex-col md:flex-row justify-between items-center gap-3 bg-slate-50 dark:bg-slate-800/80 border-slate-200/80 dark:border-slate-700/80";
        iconDiag.className = "w-10 h-10 rounded-2xl bg-slate-500/10 text-slate-500 flex items-center justify-center text-lg shrink-0";
        iconDiag.innerHTML = '<i class="fa-solid fa-calculator"></i>';
        titDiag.textContent = "Conteo en Proceso";
        descDiag.textContent = "Ingresa lo que tienes en físico para validar si la caja cuadra.";
        if (elDifUsd) elDifUsd.className = "text-lg font-black text-slate-500 tabular-nums";
    } else if (Math.abs(difTotalUsd) < 0.05) {
        cardDiag.className = "p-4 rounded-2xl border transition-all flex flex-col md:flex-row justify-between items-center gap-3 bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800";
        iconDiag.className = "w-10 h-10 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-lg shrink-0";
        iconDiag.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        titDiag.textContent = "✨ ¡Caja Cuadrada Exactamente!";
        descDiag.textContent = "El dinero físico coincide perfectamente con lo registrado por el sistema.";
        if (elDifUsd) elDifUsd.className = "text-lg font-black text-emerald-600 dark:text-emerald-400 tabular-nums";
    } else if (difTotalUsd > 0) {
        cardDiag.className = "p-4 rounded-2xl border transition-all flex flex-col md:flex-row justify-between items-center gap-3 bg-teal-50/80 dark:bg-teal-950/40 border-teal-300 dark:border-teal-800";
        iconDiag.className = "w-10 h-10 rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center text-lg shrink-0";
        iconDiag.innerHTML = '<i class="fa-solid fa-plus"></i>';
        titDiag.textContent = `🟢 Sobrante en Caja: +$${difTotalUsd.toFixed(2)}`;
        descDiag.textContent = "Hay más dinero en físico que lo reportado en ventas (posible propina o dinero extra).";
        if (elDifUsd) elDifUsd.className = "text-lg font-black text-teal-600 dark:text-teal-400 tabular-nums";
    } else {
        cardDiag.className = "p-4 rounded-2xl border transition-all flex flex-col md:flex-row justify-between items-center gap-3 bg-rose-50/80 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800";
        iconDiag.className = "w-10 h-10 rounded-2xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center text-lg shrink-0";
        iconDiag.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
        titDiag.textContent = `🔴 Faltante en Caja: -$${Math.abs(difTotalUsd).toFixed(2)}`;
        descDiag.textContent = "Falta dinero físico. Verifica si hubo gastos no registrados o errores en vueltos.";
        if (elDifUsd) elDifUsd.className = "text-lg font-black text-rose-600 dark:text-rose-400 tabular-nums";
    }
}

function imprimirArqueoCorteZ() {
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    const fisUsd = parseFloat(document.getElementById('arq-fis-usd')?.value) || 0;
    const fisBs = parseFloat(document.getElementById('arq-fis-bs')?.value) || 0;
    const fisPunto = parseFloat(document.getElementById('arq-fis-punto')?.value) || 0;
    const fisPM = parseFloat(document.getElementById('arq-fis-pm')?.value) || 0;
    const fisZelle = parseFloat(document.getElementById('arq-fis-zelle')?.value) || 0;
    const obs = document.getElementById('arq-observaciones')?.value || '';

    const totalFisUsd = fisUsd + fisZelle + (fisBs / tasa) + (fisPunto / tasa) + (fisPM / tasa);
    const difUsd = roundMoney(totalFisUsd - arqueoEsperado.totalUsd);

    const fecha = new Date().toLocaleString('es-VE');
    let logoHtml = '';
    if (storeConfig.logo) {
        logoHtml = `<div style="text-align:center; margin-bottom: 5px;"><img src="${storeConfig.logo}" style="max-height: 50px; width: auto; filter: grayscale(100%);"></div>`;
    }

    const corteZHtml = `
        <div style="width: 100%; max-width: 300px; margin: 0 auto; font-family: monospace; font-size: 11px; line-height: 1.4;">
            ${logoHtml}
            <h2 style="text-align:center; font-size:15px; font-weight:bold; margin-bottom: 2px;">${storeConfig.name.toUpperCase()}</h2>
            ${storeConfig.rif ? `<p style="text-align:center; font-size:10px; margin-bottom: 3px;">RIF: ${storeConfig.rif}</p>` : ''}
            <h3 style="text-align:center; font-size:13px; font-weight:bold; border-top: 1px dashed #000; padding-top: 4px; margin-bottom: 2px;">ARQUEO DE CAJA DIARIO (CORTE Z)</h3>
            <p style="text-align:center; border-bottom: 1px dashed #000; padding-bottom:4px; margin-bottom: 8px;">${fecha}<br>Cajero: ${currentUser?.email || 'Principal'}<br>Tasa BCV: Bs ${tasa.toFixed(2)}</p>

            <h4 style="font-weight:bold; margin: 4px 0;">1. SISTEMA ESPERA:</h4>
            <div style="display:flex; justify-content:space-between;"><span>• Efectivo USD:</span><span>$${arqueoEsperado.efectivoUsd.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>• Efectivo Bs:</span><span>Bs ${arqueoEsperado.efectivoBs.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>• Punto Venta Bs:</span><span>Bs ${arqueoEsperado.puntoBs.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>• Pago Móvil Bs:</span><span>Bs ${arqueoEsperado.pagoMovilBs.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>• Zelle USD:</span><span>$${arqueoEsperado.zelleUsd.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; border-top: 1px dotted #000; margin-top:2px;"><span>TOTAL ESPERADO:</span><span>$${arqueoEsperado.totalUsd.toFixed(2)}</span></div>

            <h4 style="font-weight:bold; margin: 8px 0 4px 0; border-top: 1px dashed #000; padding-top: 4px;">2. CONTEO FÍSICO REAL:</h4>
            <div style="display:flex; justify-content:space-between;"><span>• Efectivo USD:</span><span>$${fisUsd.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>• Efectivo Bs:</span><span>Bs ${fisBs.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>• Punto Venta Bs:</span><span>Bs ${fisPunto.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>• Pago Móvil Bs:</span><span>Bs ${fisPM.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between;"><span>• Zelle USD:</span><span>$${fisZelle.toFixed(2)}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; border-top: 1px dotted #000; margin-top:2px;"><span>TOTAL FÍSICO:</span><span>$${totalFisUsd.toFixed(2)}</span></div>

            <div style="border: 1px solid #000; padding: 4px; margin: 8px 0; text-align:center;">
                <p style="font-weight:bold; font-size:12px;">DIFERENCIA: ${difUsd >= 0 ? '+' : ''}$${difUsd.toFixed(2)} (Bs ${(difUsd * tasa).toFixed(2)})</p>
                <p style="font-size:10px;">${Math.abs(difUsd) < 0.05 ? 'CUADRE EXACTO' : (difUsd > 0 ? 'SOBRANTE' : 'FALTANTE')}</p>
            </div>

            ${obs ? `<p style="font-size:10px; margin-bottom: 5px;"><b>Obs:</b> ${obs}</p>` : ''}

            <div style="border-top: 1px dashed #000; padding-top: 5px; margin-top: 5px;">
                <div style="display:flex; justify-content:space-between;"><span>Ventas del Turno:</span><span>$${arqueoEsperado.ventasTotalUsd.toFixed(2)}</span></div>
                <div style="display:flex; justify-content:space-between;"><span>Gastos del Turno:</span><span>-$${arqueoEsperado.gastosUsd.toFixed(2)}</span></div>
                <div style="display:flex; justify-content:space-between; font-weight:bold;"><span>Ganancia Neta:</span><span>$${arqueoEsperado.gananciaNetaUsd.toFixed(2)}</span></div>
            </div>

            <br><br>
            <p style="text-align:center; font-size:10px; border-top: 1px solid #000; width: 80%; margin: 20px auto 0 auto; padding-top: 3px;">Firma del Cajero</p>
        </div>
    `;

    imprimirTicketAislado(corteZHtml, { width: '80mm' });
}

function imprimirCorteZ() {
    abrirModalArqueo30Seg();
}

function enviarArqueoWhatsApp() {
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    const fisUsd = parseFloat(document.getElementById('arq-fis-usd')?.value) || 0;
    const fisBs = parseFloat(document.getElementById('arq-fis-bs')?.value) || 0;
    const fisPunto = parseFloat(document.getElementById('arq-fis-punto')?.value) || 0;
    const fisPM = parseFloat(document.getElementById('arq-fis-pm')?.value) || 0;
    const fisZelle = parseFloat(document.getElementById('arq-fis-zelle')?.value) || 0;
    const obs = document.getElementById('arq-observaciones')?.value || '';

    const totalFisUsd = fisUsd + fisZelle + (fisBs / tasa) + (fisPunto / tasa) + (fisPM / tasa);
    const difUsd = roundMoney(totalFisUsd - arqueoEsperado.totalUsd);
    const estadoCuadre = Math.abs(difUsd) < 0.05 ? '✅ CUADRE PERFECTO' : (difUsd > 0 ? `🟢 SOBRANTE (+$${difUsd.toFixed(2)})` : `🔴 FALTANTE (-$${Math.abs(difUsd).toFixed(2)})`);

    let msg = `*⚡ ARQUEO Y CIERRE DE CAJA — ${storeConfig.name.toUpperCase()}*\n`;
    msg += `📅 *Fecha:* ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}\n`;
    msg += `👤 *Cajero:* ${currentUser?.email || 'Principal'}\n`;
    msg += `🇻🇪 *Tasa BCV:* Bs ${tasa.toFixed(2)}\n`;
    msg += `--------------------------------\n`;
    msg += `*📊 RESULTADO DEL CUADRE:*\n`;
    msg += `• Estado: *${estadoCuadre}*\n`;
    msg += `• Sistema Esperaba: *$${arqueoEsperado.totalUsd.toFixed(2)}*\n`;
    msg += `• Físico Contado: *$${totalFisUsd.toFixed(2)}*\n`;
    msg += `• Diferencia Neta: *${difUsd >= 0 ? '+' : ''}$${difUsd.toFixed(2)}* (Bs ${(difUsd * tasa).toFixed(2)})\n`;
    msg += `--------------------------------\n`;
    msg += `*💵 CONTEO FÍSICO DETALLADO:*\n`;
    msg += `• Billetes USD Gaveta: $${fisUsd.toFixed(2)}\n`;
    msg += `• Efectivo Bs Gaveta: Bs ${fisBs.toFixed(2)}\n`;
    msg += `• Voucher Punto Venta: Bs ${fisPunto.toFixed(2)}\n`;
    msg += `• Pago Móvil Banco: Bs ${fisPM.toFixed(2)}\n`;
    msg += `• Zelle Verificado: $${fisZelle.toFixed(2)}\n`;
    msg += `--------------------------------\n`;
    msg += `*📈 RESULTADOS FINANCIEROS:* \n`;
    msg += `• Ventas Brutas: *$${arqueoEsperado.ventasTotalUsd.toFixed(2)}*\n`;
    msg += `• Gastos Turno: -$${arqueoEsperado.gastosUsd.toFixed(2)}\n`;
    msg += `• Utilidad Neta: *$${arqueoEsperado.gananciaNetaUsd.toFixed(2)}*\n`;
    if (obs) msg += `📝 *Nota del Cajero:* ${obs}\n`;
    msg += `--------------------------------\n`;
    msg += `✅ *Cierre auditado desde GestiónPro POS*`;

    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
}

function enviarCierreWhatsApp() {
    enviarArqueoWhatsApp();
}

async function confirmarCierreArqueo() {
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    const fisUsd = parseFloat(document.getElementById('arq-fis-usd')?.value) || 0;
    const fisBs = parseFloat(document.getElementById('arq-fis-bs')?.value) || 0;
    const fisPunto = parseFloat(document.getElementById('arq-fis-punto')?.value) || 0;
    const fisPM = parseFloat(document.getElementById('arq-fis-pm')?.value) || 0;
    const fisZelle = parseFloat(document.getElementById('arq-fis-zelle')?.value) || 0;
    const obs = document.getElementById('arq-observaciones')?.value || '';

    const totalFisUsd = fisUsd + fisZelle + (fisBs / tasa) + (fisPunto / tasa) + (fisPM / tasa);
    const difUsd = roundMoney(totalFisUsd - arqueoEsperado.totalUsd);

    const btn = document.getElementById('btn-confirmar-arqueo');
    if (btn) btn.disabled = true;

    try {
        const batch = db.batch();
        const cierreRef = getDb('cierres').doc();
        const curBranch = (typeof holdingBranches !== 'undefined' && holdingBranches.find(b => b.id === currentNegocioId)) || { nombre: 'Bodega Principal' };
        const cierreData = {
            fechaStr: new Date().toLocaleString('es-VE'),
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            cajero: currentUser?.email || 'cajero',
            sucursalId: currentNegocioId,
            sucursalNombre: curBranch.nombre,
            tasaBCV: tasa,
            esperado: { ...arqueoEsperado },
            fisico: {
                efectivoUsd: fisUsd,
                efectivoBs: fisBs,
                puntoBs: fisPunto,
                pagoMovilBs: fisPM,
                zelleUsd: fisZelle,
                totalUsd: roundMoney(totalFisUsd)
            },
            diferenciaUsd: difUsd,
            diferenciaBs: roundMoney(difUsd * tasa),
            observaciones: obs,
            ventasTotalesUsd: arqueoEsperado.ventasTotalUsd,
            gananciaNetaUsd: arqueoEsperado.gananciaNetaUsd,
            totalGastosUsd: arqueoEsperado.gastosUsd
        };

        batch.set(cierreRef, cierreData);

        // Marcar ventas, gastos y abonos como cerrados.
        // OJO: antes se saltaba cualquier id que empezara por 'OFF-'. Ahora las
        // ventas ya sincronizadas TAMBIÉN usan ese id (es determinista, para
        // poder ser idempotentes), así que el criterio correcto es si la venta
        // sigue pendiente de subir. Si no, quedarían 'abierto' para siempre y
        // se recontarían en cada arqueo futuro.
        salesHistory.forEach(s => {
            if (s.id && !s.pendingSync) {
                batch.update(getDb('sales').doc(s.id), { status: 'cerrado', idCierre: cierreRef.id });
            }
        });
        gastosHistory.forEach(g => {
            if (g.id) {
                batch.update(getDb('gastos').doc(g.id), { status: 'cerrado', idCierre: cierreRef.id });
            }
        });
        abonosHistory.forEach(a => {
            if (a.id) {
                batch.update(getDb('abonos').doc(a.id), { status: 'cerrado', idCierre: cierreRef.id });
            }
        });

        await batch.commit();

        // 1. Guardar estado de caja como CERRADA en tiempo real
        if (typeof guardarEstadoCajaSucursal === 'function') {
            guardarEstadoCajaSucursal(currentNegocioId, {
                estado: 'cerrada',
                ultimoCierre: {
                    fechaStr: cierreData.fechaStr,
                    cajero: cierreData.cajero,
                    totalUsd: roundMoney(totalFisUsd),
                    diferenciaUsd: difUsd,
                    idCierre: cierreRef.id
                },
                ultimaApertura: null
            });
        }

        // 2. Limpiar ventas del turno en memoria local inmediatamente
        salesHistory = [];
        gastosHistory = [];
        abonosHistory = [];

        cerrarModalArqueo();

        // 3. Refrescar interfaz y Torre de Control en vivo
        if (typeof renderTorreControl === 'function') renderTorreControl();
        if (typeof renderBranchDropdown === 'function') renderBranchDropdown();
        if (typeof updatePOSDashboard === 'function') updatePOSDashboard();
        if (typeof renderReports === 'function') renderReports();

        Swal.fire({
            icon: 'success',
            title: '¡Cierre de Caja Exitoso!',
            html: `
                <div class="text-left text-xs space-y-2 mt-2">
                    <p class="font-bold text-slate-700 dark:text-slate-200">Arqueo guardado en el historial de cierres de <b>${curBranch.nombre}</b>.</p>
                    <p class="text-slate-500">Diferencia final: <b>${difUsd >= 0 ? '+' : ''}$${difUsd.toFixed(2)}</b>.</p>
                    <p class="text-[11px] text-rose-500 font-bold"><i class="fa-solid fa-lock mr-1"></i> Caja registrada como CERRADA en Torre de Control.</p>
                </div>
            `,
            confirmButtonText: 'Excelente'
        });

    } catch (e) {
        console.error('Error al guardar arqueo de caja:', e);
        Swal.fire('Error', e.message || 'No se pudo completar el cierre en la nube.', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function verHistorialCierres() {
    if (!isAdmin) return;
    const m = document.getElementById('cierres-modal');
    const c = document.getElementById('cierres-modal-content');
    const tbody = document.getElementById('cierres-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-slate-500">Cargando...</td></tr>';
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
    getDb('cierres').orderBy('timestamp', 'desc').limit(30).get().then(snapshot => {
        tbody.innerHTML = '';
        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-slate-500">Sin cierres</td></tr>';
            return;
        }
        snapshot.forEach(doc => {
            const d = doc.data();
            tbody.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-slate-100">
                    <td class="py-3 font-bold text-slate-700">${d.fechaStr}</td>
                    <td class="py-3 text-slate-500">${d.cajero}</td>
                    <td class="py-3 font-black text-emerald-600 text-right">$${(d.ventasTotalesUsd || 0).toFixed(2)}</td>
                    <td class="py-3 font-black text-blue-600 text-right">$${(d.gananciaNetaUsd || 0).toFixed(2)}</td>
                    <td class="py-3 text-center"><span class="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">Cerrado</span></td>
                </tr>`;
        });
    });
}

function closeCierresModal() {
    const m = document.getElementById('cierres-modal');
    const c = document.getElementById('cierres-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

// =====================================================
// MERMAS
// =====================================================
function populateMermasSelect() {
    const s = document.getElementById('merma-product');
    if (!s) return;
    s.innerHTML = '<option value="">Seleccione...</option>';
    products.forEach(p => {
        const stockVal = p.stock || 0;
        s.innerHTML += `<option value="${p.id}">${p.nombre || 'Sin nombre'} (Disp: ${stockVal.toFixed(2)} ${p.tipo || 'Kg'})</option>`;
    });
}

function calcularMerma() {
    const id = document.getElementById('merma-product').value;
    const ini = parseFloat(document.getElementById('merma-peso-inicial').value);
    const fin = parseFloat(document.getElementById('merma-peso-final').value);
    if (!id || isNaN(ini) || isNaN(fin)) return Swal.fire('Error', 'Ingrese todos los datos', 'error');
    const p = products.find(x => x.id === id);
    if (!p) return;
    let vendidoHoy = 0;
    salesHistory.forEach(s => {
        if (s.status === 'abierto') {
            s.items.forEach(i => {
                if (i.id === id) vendidoHoy += i.qty;
            });
        }
    });
    const esperado = ini - vendidoHoy;
    const diff = esperado - fin;
    if (diff < 0) {
        Swal.fire('Atención', `Peso final MAYOR al esperado. Tienes ${Math.abs(diff).toFixed(3)} Kg más.`, 'warning');
        return;
    }
    activeMermaCalc = {
        idProd: p.id,
        nombre: p.nombre,
        fechaStr: new Date().toLocaleString(),
        mermaKg: diff,
        costoPerdida: diff * (p.costo || p.precio),
        inicial: ini,
        vendido: vendidoHoy,
        esperado: esperado,
        final: fin
    };
    document.getElementById('res-vendido').textContent = `${vendidoHoy.toFixed(3)} Kg`;
    document.getElementById('res-esperado').textContent = `${esperado.toFixed(3)} Kg`;
    document.getElementById('res-dif-peso').textContent = `${diff.toFixed(3)} Kg`;
    document.getElementById('res-perdida-usd').textContent = `$${activeMermaCalc.costoPerdida.toFixed(2)}`;
    document.getElementById('merma-resultado').classList.remove('hidden');
}

function guardarMerma() {
    if (!activeMermaCalc) return;
    const b = db.batch();
    b.update(getDb('products').doc(activeMermaCalc.idProd), { stock: firebase.firestore.FieldValue.increment(-activeMermaCalc.mermaKg) });
    b.set(getDb('mermas').doc(), { ...activeMermaCalc, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    b.commit().then(() => {
        document.getElementById('merma-resultado').classList.add('hidden');
        activeMermaCalc = null;
        Swal.fire('OK', '', 'success');
    });
}

function renderMermasHistory() {
    const c = document.getElementById('mermas-history');
    if (!c) return;
    c.innerHTML = '';
    mermasHistory.forEach(m => {
        let det = '';
        if (m.inicial !== undefined && m.vendido !== undefined) {
            det = `<div class="mt-1 flex gap-2 text-[10px] uppercase font-bold text-slate-400">
                <span class="bg-slate-100 px-1.5 py-0.5 rounded">Ini: ${m.inicial}</span>
                <span class="bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">Vendido: ${m.vendido}</span>
                <span class="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Fin: ${m.final}</span>
            </div>`;
        }
        c.innerHTML += `
            <div class="bg-white/50 border border-slate-100 rounded-xl p-4 flex justify-between items-center shadow-sm hover:bg-white transition-colors mb-3">
                <div>
                    <p class="font-bold text-slate-800">${m.nombre}</p>
                    <p class="text-xs text-slate-500">${m.fechaStr} | Merma: <span class="font-bold text-rose-500">${m.mermaKg.toFixed(3)} Kg</span></p>
                    ${det}
                </div>
                <div class="flex items-center gap-4">
                    <div class="text-right">
                        <p class="text-[10px] font-bold uppercase text-slate-400">Pérdida</p>
                        <span class="text-rose-600 font-black">-$${(m.costoPerdida || 0).toFixed(2)}</span>
                    </div>
                    <button onclick="deleteMerma('${m.id}')" class="text-rose-400 hover:text-rose-600 w-8 h-8 rounded-full bg-white border border-slate-100 shadow-sm flex items-center justify-center"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
    });
}

function deleteMerma(id) {
    Swal.fire({
        title: '¿Eliminar merma?',
        text: 'Los kilos regresarán al inventario.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sí'
    }).then(async r => {
        if (r.isConfirmed) {
            const m = mermasHistory.find(x => x.id === id);
            if (!m) return;
            try {
                const b = db.batch();
                const prodId = m.idProd || m.productoId;
                const mermaKg = parseFloat(m.mermaKg !== undefined ? m.mermaKg : (m.kilosPerdidos || 0));
                if (prodId) {
                    const pRef = getDb('products').doc(prodId);
                    const pDoc = await pRef.get();
                    if (pDoc.exists) {
                        b.update(pRef, { stock: firebase.firestore.FieldValue.increment(mermaKg) });
                    }
                }
                b.delete(getDb('mermas').doc(id));
                await b.commit();
                Swal.fire('Eliminada', 'Stock restaurado.', 'success');
            } catch (e) {
                Swal.fire('Error', e.message, 'error');
            }
        }
    });
}

// =====================================================
// USUARIOS
// =====================================================
function renderUsers() {
    const t = document.getElementById('users-table-body');
    if (!t) return;

    if (!usersList || usersList.length === 0) {
        // La tabla tiene 4 columnas (Correo, Rol, Fecha, Acciones).
        t.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400 font-bold">Aún no has creado usuarios</td></tr>`;
        return;
    }

    // Se acumula en un array y se asigna de una sola vez. Antes era
    // `innerHTML +=` dentro del bucle, lo que reconstruía la tabla entera en
    // cada fila.
    t.innerHTML = usersList.map(u => {
        const email = escHtml(u.email);
        const esYo = currentUser && u.id === currentUser.uid;
        const esAdminFila = u.role === 'admin';
        return `
            <tr class="hover:bg-white/60 border-b border-white/40">
                <td class="p-4 font-bold text-slate-800">
                    ${email}
                    ${esYo ? '<span class="ml-1 text-[10px] font-black text-primary-600">(tú)</span>' : ''}
                </td>
                <td class="p-4">
                    ${esAdminFila
                        ? '<span class="bg-primary-100 text-primary-700 px-2 rounded-md text-xs font-bold">Admin</span>'
                        : '<span class="bg-slate-100 text-slate-700 px-2 rounded-md text-xs font-bold">Cajero</span>'}
                </td>
                <td class="p-4 text-xs text-slate-500 font-medium">${fechaCorta(u.fechaCreacion)}</td>
                <td class="p-4 text-center whitespace-nowrap">
                    <button type="button" onclick="enviarEnlacePassword('${u.id}')" title="Enviar un correo para que esta persona cree su propia contraseña" class="text-indigo-500 hover:text-indigo-700 px-2 transition-colors">
                        <i class="fa-solid fa-key"></i>
                    </button>
                    <button type="button" onclick="deleteUserDoc('${u.id}')" title="Eliminar su perfil de este negocio" class="text-rose-500 hover:text-rose-700 px-2 transition-colors">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>`;
    }).join('');
}

// Envía al usuario el correo de Firebase para que establezca su propia
// contraseña. Resuelve el problema de que el dueño tenga que repartir
// contraseñas a mano y no haya forma de que el cajero la cambie.
//
// No necesita Admin SDK, ni Cloud Functions, ni plan de pago: es una llamada
// directa al SDK de Auth desde el cliente. El correo lo manda Firebase con su
// plantilla (se puede traducir al español en Authentication > Templates).
async function enviarEnlacePassword(uid) {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Solo el dueño/administrador puede enviar enlaces de contraseña.', 'warning');
    }
    const u = (usersList || []).find(x => x.id === uid);
    if (!u || !u.email) {
        return Swal.fire('Error', 'No se encontró el correo de ese usuario.', 'error');
    }

    const r = await Swal.fire({
        title: '¿Enviar enlace de contraseña?',
        html: `<p class="text-xs text-slate-600 dark:text-slate-300">Se enviará un correo a <b>${escHtml(u.email)}</b> con un enlace para que esa persona <b>cree su propia contraseña</b>.</p>
               <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">Si ese correo no es real, el mensaje no llegará. Compruébalo antes.</p>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#4f46e5',
        confirmButtonText: 'Enviar enlace',
        cancelButtonText: 'Cancelar'
    });
    if (!r.isConfirmed) return;

    try {
        await auth.sendPasswordResetEmail(u.email);
        Swal.fire('Enlace enviado', `Pídele a ${escHtml(u.email)} que revise su correo (y la carpeta de spam).`, 'success');
    } catch (e) {
        console.error('Error enviando el enlace de contraseña:', e);
        let msg = e.message || 'No se pudo enviar el correo.';
        if (e.code === 'auth/invalid-email') msg = 'El correo guardado no tiene un formato válido.';
        if (e.code === 'auth/user-not-found') msg = 'Esa cuenta ya no existe en Authentication.';
        if (e.code === 'auth/too-many-requests') msg = 'Demasiados intentos seguidos. Espera unos minutos.';
        Swal.fire('Error', msg, 'error');
    }
}

function openUserModal() {
    document.getElementById('new-user-email').value = '';
    document.getElementById('new-user-pass').value = '';
    const m = document.getElementById('user-modal');
    const c = document.getElementById('user-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
}

function closeUserModal() {
    const m = document.getElementById('user-modal');
    const c = document.getElementById('user-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

// Alta de cajeros/administradores por el DUEÑO, desde la pestaña Usuarios.
//
// Este flujo es el que encaja con las reglas de Firestore:
//   1. La cuenta se crea en la app SECUNDARIA, para no desloguear al
//      administrador que la está creando.
//   2. El perfil en `usuarios/{uid}` lo escribe el administrador con la app
//      PRIMARIA, donde ya está autenticado. La regla lo permite por la rama
//      (b): esAdminDe(negocioId) && role in ['admin','cajero'].
// Así que con las reglas publicadas esto sigue funcionando igual.
async function createUser() {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Solo el dueño/administrador puede crear usuarios.', 'warning');
    }
    const email = document.getElementById('new-user-email').value.trim();
    const pass = document.getElementById('new-user-pass').value;
    const role = document.getElementById('new-user-role').value;

    if (!email || !email.includes('@')) return Swal.fire('Error', 'Escribe un correo válido', 'error');
    if (!pass || pass.length < 6) return Swal.fire('Error', 'La contraseña debe tener al menos 6 caracteres', 'error');
    if (!currentNegocioId) return Swal.fire('Error', 'No hay un negocio activo. Vuelve a iniciar sesión.', 'error');
    // La regla de Firestore solo acepta exactamente estas dos cadenas.
    if (!['admin', 'cajero'].includes(role)) return Swal.fire('Error', 'Rol no válido', 'error');

    const btn = document.getElementById('btn-create-user');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando...';
    }

    let uidNuevo = null;
    try {
        const cred = await secondaryAuth.createUserWithEmailAndPassword(email, pass);
        uidNuevo = cred.user.uid;

        await db.collection('usuarios').doc(uidNuevo).set({
            email, role, negocioId: currentNegocioId, fechaCreacion: new Date().toISOString()
        });

        await secondaryAuth.signOut();
        closeUserModal();
        Swal.fire('Usuario creado', `${email} ya puede iniciar sesión como ${role}.`, 'success');
    } catch (e) {
        // No dejar cuentas huérfanas: si la cuenta se creó pero el perfil no,
        // esa persona podría iniciar sesión y quedaría con "Acceso denegado"
        // sin que nadie sepa por qué.
        if (uidNuevo) {
            try {
                if (secondaryAuth.currentUser) await secondaryAuth.currentUser.delete();
                else await secondaryAuth.signOut();
            } catch (err) {
                try { await secondaryAuth.signOut(); } catch (e2) {}
            }
        }
        let msg = e.message || 'Error desconocido';
        if (e.code === 'auth/email-already-in-use') msg = 'Ese correo ya tiene una cuenta. Si es un cajero tuyo, bórralo del listado antes de volver a crearlo.';
        if (e.code === 'auth/invalid-email') msg = 'El correo no es válido.';
        if (e.code === 'auth/weak-password') msg = 'La contraseña es demasiado débil.';
        if (e.code === 'permission-denied') msg = 'Las reglas de Firestore rechazaron el alta del perfil. Comprueba que sigues como administrador de este negocio.';
        Swal.fire('Error', msg, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Registrar';
        }
    }
}

function deleteUserDoc(uid) {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Solo el dueño/administrador puede eliminar usuarios.', 'warning');
    }
    if (currentUser && uid === currentUser.uid) {
        return Swal.fire('No permitido', 'No puedes eliminar tu propio perfil: perderías el acceso al sistema.', 'warning');
    }
    Swal.fire({
        title: '¿Eliminar este usuario?',
        html: `<p class="text-xs text-slate-600 dark:text-slate-300">Se borra su <b>perfil</b>, así que ya no podrá entrar al sistema.</p>
               <p class="text-xs text-amber-600 dark:text-amber-400 mt-2"><b>Importante:</b> la cuenta de acceso (correo y contraseña) NO se elimina desde aquí. Para revocarla del todo, deshabilítala en Firebase Console → Authentication.</p>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Eliminar perfil'
    }).then(async r => {
        if (!r.isConfirmed) return;
        try {
            await db.collection('usuarios').doc(uid).delete();
            Swal.fire('Perfil eliminado', 'Ese usuario ya no podrá resolver su sesión.', 'success');
        } catch (err) {
            console.error('Error eliminando el perfil:', err);
            Swal.fire('Error', 'No se pudo eliminar el perfil: ' + (err.message || 'error desconocido'), 'error');
        }
    });
}

function deleteSale(id) {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Anular ventas es una acción del dueño/administrador.', 'warning');
    }
    Swal.fire({
        title: '¿Anular Venta?',
        text: 'Se devolverá el stock.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Anular'
    }).then(async r => {
        if (r.isConfirmed) {
            const s = salesHistory.find(x => x.id === id);
            if (!s) return;
            try {
                const b = db.batch();
                s.items.forEach(i => {
                    if (i.id) {
                        b.set(getDb('products').doc(i.id), { stock: firebase.firestore.FieldValue.increment(i.qty || 0) }, { merge: true });
                    }
                });
                b.delete(getDb('sales').doc(id));
                await b.commit();
                Swal.fire('Anulada', 'Venta anulada.', 'success');
            } catch (e) {
                Swal.fire('Error', e.message, 'error');
            }
        }
    });
}

function exportToExcel() {
    if (typeof XLSX === 'undefined') return Swal.fire('Error', 'Librería XLSX no cargada', 'error');
    if (!products || products.length === 0) return Swal.fire('Sin datos', 'No hay productos', 'info');
    const wsData = [
        ['REPORTE INVENTARIO - ' + (storeConfig.name || 'GESTIÓNPRO').toUpperCase()],
        ['Fecha: ' + new Date().toLocaleString()],
        [],
        ['Código', 'Producto', 'Categoría', 'Tipo', 'Stock', 'Costo ($)', 'Precio ($)', 'Vencimiento']
    ];
    products.forEach(p => {
        wsData.push([
            p.codigo || '', p.nombre || '', p.categoria || '', p.tipo || 'unid',
            parseFloat(p.stock || 0), parseFloat(p.costo || 0), parseFloat(p.precio || 0),
            p.fechaVencimiento || 'N/A'
        ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, `Inventario_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Swal.fire('¡Exportado!', 'Inventario descargado.', 'success');
}

// =====================================================
// IMPORTACIÓN DE INVENTARIO DESDE EXCEL (.XLSX / .XLS / .CSV)
// =====================================================
let parsedExcelProducts = [];
let currentExcelFilter = 'todos';
let excelDropzoneConfigured = false;

function openImportarExcelModal() {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Solo administradores pueden importar inventario.', 'warning');
    }
    const m = document.getElementById('import-excel-modal');
    const c = document.getElementById('import-excel-content');
    if (!m || !c) return;

    resetImportExcelState();
    setupExcelDropzone();

    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
}

function closeImportarExcelModal() {
    const m = document.getElementById('import-excel-modal');
    const c = document.getElementById('import-excel-content');
    if (!m || !c) return;
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

function resetImportExcelState() {
    parsedExcelProducts = [];
    currentExcelFilter = 'todos';
    const input = document.getElementById('excel-file-input');
    if (input) input.value = '';

    const previewContainer = document.getElementById('excel-preview-container');
    if (previewContainer) previewContainer.classList.add('hidden');

    const dropContainer = document.getElementById('excel-drop-zone-container');
    if (dropContainer) dropContainer.classList.remove('hidden');

    const progressContainer = document.getElementById('excel-progress-container');
    if (progressContainer) progressContainer.classList.add('hidden');

    const btn = document.getElementById('btn-ejecutar-importacion');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-file-import"></i> Confirmar e Importar (<span id="excel-btn-count">0</span>)';
    }
}

function setupExcelDropzone() {
    if (excelDropzoneConfigured) return;
    const dropzone = document.getElementById('excel-dropzone');
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('border-emerald-500', 'bg-emerald-100/60', 'scale-[1.01]');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('border-emerald-500', 'bg-emerald-100/60', 'scale-[1.01]');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            handleExcelFile(files[0]);
        }
    }, false);

    excelDropzoneConfigured = true;
}

function handleExcelFileSelect(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
        handleExcelFile(files[0]);
    }
}

function descargarPlantillaExcel() {
    if (typeof XLSX === 'undefined') return Swal.fire('Error', 'Librería XLSX no cargada', 'error');
    const plantilla = [
        ['Código', 'Producto', 'Categoría', 'Marca', 'Tipo', 'Stock', 'Costo ($)', 'Precio ($)', 'Vencimiento'],
        ['759100100001', 'Harina PAN Blanca 1kg', 'Víveres', 'PAN', 'unid', 50, 1.15, 1.45, '2026-12-31'],
        ['759100100002', 'Arroz Mary Tradicional 1kg', 'Víveres', 'Mary', 'unid', 40, 0.95, 1.30, '2026-11-30'],
        ['759100100003', 'Queso Llanero Duro', 'Charcutería', '', 'peso', 15.5, 3.80, 5.20, ''],
        ['759100100004', 'Aceite Vegetal Vatel 1L', 'Víveres', 'Vatel', 'unid', 24, 2.10, 2.75, '2026-10-15'],
        ['759100100005', 'Detergente Las Llaves 1kg', 'Limpieza', 'Las Llaves', 'unid', 30, 1.60, 2.10, '']
    ];
    const ws = XLSX.utils.aoa_to_sheet(plantilla);
    ws['!cols'] = [
        { wch: 16 },
        { wch: 32 },
        { wch: 16 },
        { wch: 14 },
        { wch: 10 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventario");
    XLSX.writeFile(wb, "Plantilla_Inventario_GestionPro.xlsx");
}

function normalizarTextoCabecera(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

function parseNumeroExcel(val) {
    if (val === null || val === undefined || val === '') return NaN;
    if (typeof val === 'number') return isNaN(val) ? NaN : val;
    let s = String(val).trim().replace(/[$Bs\s]/gi, '');
    if (s.includes(',') && !s.includes('.')) {
        s = s.replace(',', '.');
    } else if (s.includes(',') && s.includes('.')) {
        s = s.replace(/,/g, '');
    }
    const num = parseFloat(s);
    return isNaN(num) ? NaN : num;
}

function detectarIndiceCabeceras(rawRows) {
    const palabrasClave = ['codigo', 'producto', 'nombre', 'articulo', 'descripcion', 'precio', 'costo', 'stock', 'cantidad', 'categoria', 'marca', 'tipo'];
    let mejorIndice = 0;
    let maxCoincidencias = 0;

    const limiteFilas = Math.min(rawRows.length, 15);
    for (let r = 0; r < limiteFilas; r++) {
        const fila = rawRows[r];
        if (!Array.isArray(fila)) continue;
        let coincidencias = 0;
        fila.forEach(celda => {
            const normalizado = normalizarTextoCabecera(celda);
            if (!normalizado) return;
            if (palabrasClave.some(p => normalizado.includes(p))) {
                coincidencias++;
            }
        });
        if (coincidencias > maxCoincidencias && coincidencias >= 2) {
            maxCoincidencias = coincidencias;
            mejorIndice = r;
        }
    }
    return mejorIndice;
}

function parsearFilasExcel(rawRows) {
    if (!rawRows || rawRows.length < 2) return [];
    const headerRowIdx = detectarIndiceCabeceras(rawRows);
    const cabeceras = rawRows[headerRowIdx] || [];

    let colCodigo = -1;
    let colNombre = -1;
    let colMarca = -1;
    let colCategoria = -1;
    let colTipo = -1;
    let colStock = -1;
    let colCosto = -1;
    let colPrecio = -1;
    let colVencimiento = -1;

    cabeceras.forEach((c, idx) => {
        const norm = normalizarTextoCabecera(c);
        if (!norm) return;

        if (colCodigo === -1 && (norm.includes('codigo') || norm.includes('barcode') || norm.includes('barra') || norm.includes('sku') || norm === 'cod' || norm === 'ref')) {
            colCodigo = idx;
        } else if (colNombre === -1 && (norm.includes('producto') || norm.includes('nombre') || norm.includes('articulo') || norm.includes('descripcion') || norm === 'item' || norm === 'name')) {
            colNombre = idx;
        } else if (colMarca === -1 && (norm.includes('marca') || norm.includes('brand'))) {
            colMarca = idx;
        } else if (colCategoria === -1 && (norm.includes('categoria') || norm.includes('rubro') || norm.includes('departamento') || norm.includes('category') || norm === 'grupo')) {
            colCategoria = idx;
        } else if (colTipo === -1 && (norm.includes('tipo') || norm.includes('unidad') || norm.includes('medida'))) {
            colTipo = idx;
        } else if (colStock === -1 && (norm.includes('stock') || norm.includes('cantidad') || norm === 'cant' || norm.includes('existencia') || norm === 'qty' || norm.includes('inventario'))) {
            colStock = idx;
        } else if (colCosto === -1 && (norm.includes('costo') || norm.includes('compra') || norm === 'cost' || norm.includes('pcosto'))) {
            colCosto = idx;
        } else if (colPrecio === -1 && (norm.includes('precio') || norm.includes('pvp') || norm.includes('venta') || norm === 'price')) {
            colPrecio = idx;
        } else if (colVencimiento === -1 && (norm.includes('vencimiento') || norm.includes('caducidad') || norm.includes('vence') || norm.includes('expiry'))) {
            colVencimiento = idx;
        }
    });

    const parsed = [];
    const existingList = Array.isArray(products) ? products : [];

    for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!Array.isArray(row) || row.length === 0) continue;
        const todaVacia = row.every(cell => cell === '' || cell === null || cell === undefined);
        if (todaVacia) continue;

        const rawCodigo = colCodigo !== -1 && row[colCodigo] !== undefined ? String(row[colCodigo]).trim() : '';
        const rawNombre = colNombre !== -1 && row[colNombre] !== undefined ? String(row[colNombre]).trim() : '';
        const rawMarca = colMarca !== -1 && row[colMarca] !== undefined ? String(row[colMarca]).trim() : '';
        const rawCategoria = colCategoria !== -1 && row[colCategoria] !== undefined ? String(row[colCategoria]).trim() : '';
        const rawTipo = colTipo !== -1 && row[colTipo] !== undefined ? String(row[colTipo]).trim() : '';
        const rawStock = colStock !== -1 && row[colStock] !== undefined ? row[colStock] : 0;
        const rawCosto = colCosto !== -1 && row[colCosto] !== undefined ? row[colCosto] : 0;
        const rawPrecio = colPrecio !== -1 && row[colPrecio] !== undefined ? row[colPrecio] : NaN;
        const rawVenc = colVencimiento !== -1 && row[colVencimiento] !== undefined ? row[colVencimiento] : null;

        let numPrecio = parseNumeroExcel(rawPrecio);
        let numCosto = parseNumeroExcel(rawCosto);
        if (isNaN(numCosto) || numCosto < 0) numCosto = 0;
        let numStock = parseNumeroExcel(rawStock);
        if (isNaN(numStock)) numStock = 0;

        let tipoNormalizado = 'unid';
        const tipoLower = rawTipo.toLowerCase();
        if (tipoLower.includes('peso') || tipoLower.includes('kg') || tipoLower.includes('kilo') || tipoLower.includes('gramo')) {
            tipoNormalizado = 'peso';
        }

        let fechaVenc = null;
        if (rawVenc instanceof Date && !isNaN(rawVenc.getTime())) {
            fechaVenc = rawVenc.toISOString().slice(0, 10);
        } else if (rawVenc && typeof rawVenc === 'string' && rawVenc.trim().length >= 4) {
            fechaVenc = rawVenc.trim().slice(0, 10);
        }

        let isValid = true;
        let errorReason = '';

        if (!rawNombre || rawNombre.length < 2) {
            isValid = false;
            errorReason = 'Falta el nombre o descripción del producto';
        } else if (isNaN(numPrecio) || numPrecio < 0) {
            isValid = false;
            errorReason = 'Precio inválido o vacío';
        }

        let match = null;
        if (rawCodigo) {
            match = existingList.find(p => p.codigo && String(p.codigo).trim().toLowerCase() === rawCodigo.toLowerCase());
        }
        if (!match && rawNombre) {
            match = existingList.find(p => p.nombre && p.nombre.trim().toLowerCase() === rawNombre.toLowerCase());
        }

        let status = 'nuevo';
        if (!isValid) {
            status = 'invalido';
        } else if (match) {
            status = 'actualizar';
        }

        parsed.push({
            id: 'row_' + i,
            rowNum: i + 1,
            selected: isValid,
            isValid,
            status,
            error: errorReason,
            codigo: rawCodigo,
            nombre: rawNombre,
            categoria: rawCategoria || 'Víveres',
            marca: rawMarca,
            tipo: tipoNormalizado,
            stock: numStock,
            costo: Math.round((numCosto + Number.EPSILON) * 100) / 100,
            precio: Math.round((numPrecio + Number.EPSILON) * 100) / 100,
            fechaVencimiento: fechaVenc,
            existingId: match ? match.id : null,
            existingStock: match ? parseFloat(match.stock || 0) : 0,
            existingProduct: match
        });
    }

    return parsed;
}

function handleExcelFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        return Swal.fire('Formato no soportado', 'Por favor selecciona un archivo .xlsx, .xls o .csv', 'warning');
    }
    if (typeof XLSX === 'undefined') {
        return Swal.fire('Error', 'La librería SheetJS (XLSX) aún no está cargada.', 'error');
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
                return Swal.fire('Archivo vacío', 'El libro de Excel no contiene hojas de datos.', 'info');
            }
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

            if (!rawRows || rawRows.length === 0) {
                return Swal.fire('Archivo vacío', 'No se encontraron datos en la primera hoja del archivo.', 'info');
            }

            parsedExcelProducts = parsearFilasExcel(rawRows);

            if (parsedExcelProducts.length === 0) {
                return Swal.fire('Sin productos', 'No se detectaron filas de productos válidas en el archivo.', 'info');
            }

            document.getElementById('excel-filename').textContent = file.name;
            document.getElementById('excel-fileinfo').textContent = `${(file.size / 1024).toFixed(1)} KB · ${parsedExcelProducts.length} filas leídas`;

            document.getElementById('excel-drop-zone-container').classList.add('hidden');
            document.getElementById('excel-preview-container').classList.remove('hidden');

            currentExcelFilter = 'todos';
            actualizarPreviewExcel();

        } catch (err) {
            console.error('Error leyendo archivo Excel:', err);
            Swal.fire('Error de lectura', `No se pudo procesar el archivo Excel: ${err.message}`, 'error');
        }
    };
    reader.onerror = function() {
        Swal.fire('Error', 'Error al leer el archivo en el navegador.', 'error');
    };
    reader.readAsArrayBuffer(file);
}

function filtrarVistaPreview(filtro) {
    currentExcelFilter = filtro;
    const tabBtns = {
        'todos': document.getElementById('filter-excel-todos'),
        'nuevos': document.getElementById('filter-excel-nuevos'),
        'actualizar': document.getElementById('filter-excel-actualizar'),
        'invalidos': document.getElementById('filter-excel-invalidos')
    };

    Object.keys(tabBtns).forEach(k => {
        const btn = tabBtns[k];
        if (!btn) return;
        if (k === filtro) {
            btn.className = 'px-2.5 py-1 rounded-lg font-bold bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[11px] shadow-xs';
        } else {
            let colorCls = 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800';
            if (k === 'nuevos') colorCls = 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40';
            if (k === 'actualizar') colorCls = 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40';
            if (k === 'invalidos') colorCls = 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40';
            btn.className = `px-2.5 py-1 rounded-lg font-bold ${colorCls} text-[11px] transition-colors`;
        }
    });

    renderExcelPreviewRows();
}

function actualizarPreviewExcel() {
    const importMode = document.getElementById('excel-import-mode')?.value || 'upsert';

    parsedExcelProducts.forEach(item => {
        if (!item.isValid) {
            item.selected = false;
        } else if (importMode === 'only-new' && item.status === 'actualizar') {
            item.selected = false;
        }
    });

    const countTodos = parsedExcelProducts.length;
    const countNuevos = parsedExcelProducts.filter(p => p.status === 'nuevo').length;
    const countActualizar = parsedExcelProducts.filter(p => p.status === 'actualizar').length;
    const countInvalidos = parsedExcelProducts.filter(p => p.status === 'invalido').length;
    const countSelected = parsedExcelProducts.filter(p => p.selected).length;

    const elTodos = document.getElementById('excel-cnt-todos');
    const elNuevos = document.getElementById('excel-cnt-nuevos');
    const elAct = document.getElementById('excel-cnt-actualizar');
    const elInv = document.getElementById('excel-cnt-invalidos');
    const elSel = document.getElementById('excel-selected-count');
    const elBtnCnt = document.getElementById('excel-btn-count');
    const btnEjecutar = document.getElementById('btn-ejecutar-importacion');

    if (elTodos) elTodos.textContent = countTodos;
    if (elNuevos) elNuevos.textContent = countNuevos;
    if (elAct) elAct.textContent = countActualizar;
    if (elInv) elInv.textContent = countInvalidos;
    if (elSel) elSel.textContent = countSelected;
    if (elBtnCnt) elBtnCnt.textContent = countSelected;

    if (btnEjecutar) {
        btnEjecutar.disabled = countSelected === 0;
    }

    renderExcelPreviewRows();
}

function renderExcelPreviewRows() {
    const tbody = document.getElementById('excel-preview-tbody');
    if (!tbody) return;

    const stockMode = document.getElementById('excel-stock-mode')?.value || 'replace';
    const importMode = document.getElementById('excel-import-mode')?.value || 'upsert';

    let filtrados = parsedExcelProducts;
    if (currentExcelFilter === 'nuevos') {
        filtrados = parsedExcelProducts.filter(p => p.status === 'nuevo');
    } else if (currentExcelFilter === 'actualizar') {
        filtrados = parsedExcelProducts.filter(p => p.status === 'actualizar');
    } else if (currentExcelFilter === 'invalidos') {
        filtrados = parsedExcelProducts.filter(p => p.status === 'invalido');
    }

    if (filtrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="9" class="p-8 text-center text-slate-400">
                    <i class="fa-solid fa-inbox text-3xl mb-2 block opacity-40"></i>
                    No hay productos para mostrar en este filtro.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtrados.map(item => {
        let badgeEstado = '';
        if (item.status === 'nuevo') {
            badgeEstado = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"><i class="fa-solid fa-plus-circle text-[9px]"></i> Nuevo</span>`;
        } else if (item.status === 'actualizar') {
            const deshabilitadoPorModo = importMode === 'only-new';
            badgeEstado = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black ${deshabilitadoPorModo ? 'bg-slate-100 text-slate-400 dark:bg-slate-800' : 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-200 dark:border-blue-800'}"><i class="fa-solid fa-pen text-[9px]"></i> Actualizar</span>`;
        } else {
            badgeEstado = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200 dark:border-rose-800" title="${item.error}"><i class="fa-solid fa-triangle-exclamation text-[9px]"></i> Error</span>`;
        }

        let stockDisplay = '';
        if (item.status === 'actualizar') {
            if (stockMode === 'sum') {
                const nuevoTotal = (item.existingStock || 0) + item.stock;
                stockDisplay = `<span class="text-slate-400 font-normal">${item.existingStock} +</span> <span class="font-extrabold text-blue-600">${item.stock}</span> <span class="text-[10px] text-slate-400">(=${nuevoTotal})</span>`;
            } else {
                stockDisplay = `<span class="font-extrabold text-blue-600">${item.stock}</span> <span class="text-[10px] text-slate-400">(era ${item.existingStock})</span>`;
            }
        } else {
            stockDisplay = `<span class="font-bold text-slate-700 dark:text-slate-200">${item.stock}</span>`;
        }

        const checkboxDisabled = !item.isValid || (importMode === 'only-new' && item.status === 'actualizar');

        return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${!item.isValid ? 'opacity-60 bg-rose-50/30 dark:bg-rose-950/10' : ''}">
                <td class="p-2.5 text-center">
                    <input type="checkbox" ${item.selected ? 'checked' : ''} ${checkboxDisabled ? 'disabled' : ''} 
                           onchange="toggleExcelItemSelection('${item.id}', this.checked)"
                           class="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-30">
                </td>
                <td class="p-2.5 whitespace-nowrap">${badgeEstado}</td>
                <td class="p-2.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">${item.codigo || '<span class="italic text-slate-300 dark:text-slate-600">Autogenerar</span>'}</td>
                <td class="p-2.5">
                    <p class="font-bold text-slate-800 dark:text-white leading-snug">${item.nombre || '<span class="text-rose-500 italic">Sin nombre</span>'}</p>
                    ${item.marca ? `<p class="text-[10px] text-slate-400">${item.marca}</p>` : ''}
                    ${item.error ? `<p class="text-[10px] text-rose-500 font-semibold mt-0.5"><i class="fa-solid fa-circle-exclamation mr-1"></i>${item.error}</p>` : ''}
                </td>
                <td class="p-2.5 whitespace-nowrap">
                    <span class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300">${item.categoria}</span>
                </td>
                <td class="p-2.5 whitespace-nowrap">
                    <span class="text-[11px] font-semibold ${item.tipo === 'peso' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}">
                        ${item.tipo === 'peso' ? '<i class="fa-solid fa-scale-balanced mr-1"></i>Por Peso (Kg)' : '<i class="fa-solid fa-box mr-1"></i>Unidad'}
                    </span>
                </td>
                <td class="p-2.5 text-right font-mono whitespace-nowrap">${stockDisplay}</td>
                <td class="p-2.5 text-right font-mono font-medium text-slate-500 whitespace-nowrap">$${Number(item.costo || 0).toFixed(2)}</td>
                <td class="p-2.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    ${isNaN(item.precio) ? '<span class="text-rose-500 font-bold">Error</span>' : '$' + Number(item.precio).toFixed(2)}
                </td>
            </tr>
        `;
    }).join('');

    const selectAllBox = document.getElementById('excel-select-all');
    if (selectAllBox) {
        const seleccionables = filtrados.filter(p => p.isValid && !(importMode === 'only-new' && p.status === 'actualizar'));
        selectAllBox.checked = seleccionables.length > 0 && seleccionables.every(p => p.selected);
    }
}

function toggleExcelItemSelection(itemId, isChecked) {
    const item = parsedExcelProducts.find(p => p.id === itemId);
    if (item && item.isValid) {
        item.selected = isChecked;
        const countSelected = parsedExcelProducts.filter(p => p.selected).length;
        const elSel = document.getElementById('excel-selected-count');
        const elBtnCnt = document.getElementById('excel-btn-count');
        const btnEjecutar = document.getElementById('btn-ejecutar-importacion');
        if (elSel) elSel.textContent = countSelected;
        if (elBtnCnt) elBtnCnt.textContent = countSelected;
        if (btnEjecutar) btnEjecutar.disabled = countSelected === 0;

        const selectAllBox = document.getElementById('excel-select-all');
        if (selectAllBox) {
            const importMode = document.getElementById('excel-import-mode')?.value || 'upsert';
            const seleccionables = parsedExcelProducts.filter(p => p.isValid && !(importMode === 'only-new' && p.status === 'actualizar'));
            selectAllBox.checked = seleccionables.length > 0 && seleccionables.every(p => p.selected);
        }
    }
}

function toggleSelectAllExcel(isChecked) {
    const importMode = document.getElementById('excel-import-mode')?.value || 'upsert';
    let targetItems = parsedExcelProducts;
    if (currentExcelFilter === 'nuevos') {
        targetItems = parsedExcelProducts.filter(p => p.status === 'nuevo');
    } else if (currentExcelFilter === 'actualizar') {
        targetItems = parsedExcelProducts.filter(p => p.status === 'actualizar');
    } else if (currentExcelFilter === 'invalidos') {
        targetItems = parsedExcelProducts.filter(p => p.status === 'invalido');
    }

    targetItems.forEach(item => {
        if (!item.isValid) {
            item.selected = false;
        } else if (importMode === 'only-new' && item.status === 'actualizar') {
            item.selected = false;
        } else {
            item.selected = isChecked;
        }
    });

    actualizarPreviewExcel();
}

async function ejecutarImportacionExcel() {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Solo administradores pueden importar inventario.', 'warning');
    }

    const itemsToImport = parsedExcelProducts.filter(p => p.selected && p.isValid);
    if (itemsToImport.length === 0) {
        return Swal.fire('Sin selección', 'No has seleccionado ningún producto válido para importar.', 'info');
    }

    const stockMode = document.getElementById('excel-stock-mode')?.value || 'replace';

    const nuevosCount = itemsToImport.filter(p => p.status === 'nuevo').length;
    const actualizarCount = itemsToImport.filter(p => p.status === 'actualizar').length;

    const confirmRes = await Swal.fire({
        title: '¿Confirmar Importación?',
        html: `
            <div class="space-y-3 text-left text-xs bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                <p class="font-bold text-slate-800 dark:text-white text-sm">Se procesarán <b>${itemsToImport.length}</b> productos en tu tienda:</p>
                <div class="space-y-1 pl-2">
                    <p class="text-emerald-600 font-semibold"><i class="fa-solid fa-circle-plus mr-1"></i> <b>${nuevosCount}</b> nuevos productos a registrar.</p>
                    <p class="text-blue-600 font-semibold"><i class="fa-solid fa-pen-to-square mr-1"></i> <b>${actualizarCount}</b> productos existentes a actualizar.</p>
                    <p class="text-slate-500 font-medium"><i class="fa-solid fa-cubes-stacked mr-1"></i> Modo stock: <b>${stockMode === 'sum' ? 'Sumar al stock existente' : 'Reemplazar stock por el valor de Excel'}</b>.</p>
                </div>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, Importar Ahora',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b'
    });

    if (!confirmRes.isConfirmed) return;

    const btn = document.getElementById('btn-ejecutar-importacion');
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Importando...';
    }

    const progressContainer = document.getElementById('excel-progress-container');
    const progressBar = document.getElementById('excel-progress-bar');
    const progressLabel = document.getElementById('excel-progress-label');
    const progressPercent = document.getElementById('excel-progress-percent');

    if (progressContainer) progressContainer.classList.remove('hidden');

    try {
        let importadosNuevos = 0;
        let actualizados = 0;
        const total = itemsToImport.length;
        const batchSize = 350;

        for (let i = 0; i < total; i += batchSize) {
            const chunk = itemsToImport.slice(i, i + batchSize);
            const batch = db.batch();

            chunk.forEach(item => {
                let codigoFinal = item.codigo;
                if (!codigoFinal) {
                    codigoFinal = 'IMP' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
                }

                if (item.status === 'nuevo') {
                    const docRef = getDb('products').doc();
                    batch.set(docRef, {
                        codigo: codigoFinal,
                        nombre: item.nombre,
                        marca: item.marca || '',
                        categoria: item.categoria || 'Víveres',
                        tipo: item.tipo || 'unid',
                        stock: Number(item.stock) || 0,
                        costo: Number(item.costo) || 0,
                        precio: Number(item.precio),
                        fechaVencimiento: item.fechaVencimiento || null,
                        imagen: ''
                    });
                    importadosNuevos++;
                } else if (item.status === 'actualizar' && item.existingId) {
                    const docRef = getDb('products').doc(item.existingId);
                    const updatePayload = {
                        nombre: item.nombre,
                        categoria: item.categoria || (item.existingProduct?.categoria || 'Víveres'),
                        tipo: item.tipo || (item.existingProduct?.tipo || 'unid'),
                        precio: Number(item.precio),
                        costo: Number(item.costo) || 0
                    };
                    if (item.codigo) updatePayload.codigo = item.codigo;
                    if (item.marca) updatePayload.marca = item.marca;
                    if (item.fechaVencimiento) updatePayload.fechaVencimiento = item.fechaVencimiento;

                    if (stockMode === 'sum') {
                        updatePayload.stock = firebase.firestore.FieldValue.increment(Number(item.stock) || 0);
                    } else {
                        updatePayload.stock = Number(item.stock) || 0;
                    }

                    batch.set(docRef, updatePayload, { merge: true });
                    actualizados++;
                }
            });

            await batch.commit();

            const procesadosHastaAhora = Math.min(i + batchSize, total);
            const pct = Math.round((procesadosHastaAhora / total) * 100);
            if (progressBar) progressBar.style.width = pct + '%';
            if (progressPercent) progressPercent.textContent = pct + '%';
            if (progressLabel) progressLabel.textContent = `Procesando: ${procesadosHastaAhora} de ${total} productos...`;
        }

        closeImportarExcelModal();

        Swal.fire({
            title: '¡Inventario Importado!',
            html: `
                <div class="space-y-2 text-left text-xs bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                    <p class="text-emerald-600 font-bold"><i class="fa-solid fa-circle-check mr-1"></i> <b>${importadosNuevos}</b> productos nuevos creados con éxito.</p>
                    ${actualizados > 0 ? `<p class="text-blue-600 font-bold"><i class="fa-solid fa-check-double mr-1"></i> <b>${actualizados}</b> productos existentes actualizados.</p>` : ''}
                    <p class="text-slate-400 text-[11px] mt-2">Los cambios ya están reflejados en tu catálogo y punto de venta.</p>
                </div>
            `,
            icon: 'success',
            confirmButtonColor: '#059669'
        });

    } catch (err) {
        console.error('Error importando inventario desde Excel:', err);
        Swal.fire('Error en importación', `Ocurrió un error al guardar los productos: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalBtnHtml;
            btn.disabled = false;
        }
        if (progressContainer) progressContainer.classList.add('hidden');
    }
}

// =====================================================
// CLIENTES Y ABONOS
// =====================================================
// =====================================================
// CUADERNO DIGITAL DE FIADOS Y GESTIÓN DE CLIENTES
// =====================================================
let currentCobroClienteId = null;
let currentCobroTemplate = 'amable';
let currentFiltroFiados = 'deuda';

/**
 * Sanitiza números de teléfono venezolanos al formato internacional requerido por WhatsApp:
 * 04121234567 -> 584121234567
 * 4121234567  -> 584121234567
 * +584121234567 -> 584121234567
 */
function formatPhoneVzla(phoneRaw) {
    // Delegado en normalizarTelefono(): UNA sola implementación.
    // Antes esta era una copia paralela que solo aplicaba al botón de cobro por
    // WhatsApp, así que el resto de enlaces (ticket, proveedor, pedidos
    // online) salían sin el código de país y wa.me los rechazaba.
    return normalizarTelefono(phoneRaw);
}

/**
 * Actualiza el contador reactivo en la barra lateral
 */
function updateBadgeFiados() {
    const badge = document.getElementById('badge-fiados');
    if (!badge) return;
    const conDeuda = (clientes || []).filter(c => (c.deudaUsd || 0) > 0.009).length;
    if (conDeuda > 0) {
        badge.textContent = conDeuda;
        badge.classList.remove('hidden');
    } else {
        badge.textContent = '0';
        badge.classList.add('hidden');
    }
}

/**
 * Cambia la categoría de filtro del Cuaderno de Fiados
 */
function setFiltroFiados(filtro) {
    currentFiltroFiados = filtro;
    const pillKeys = ['deuda', 'alta', 'critica', 'saldoFavor', 'todos'];
    pillKeys.forEach(k => {
        const el = document.getElementById(`pill-fiados-${k}`);
        if (!el) return;
        if (k === filtro) {
            el.className = 'pill-fiado active px-3.5 py-1.5 rounded-full text-xs font-black bg-amber-500 text-white shadow-xs transition-all shrink-0';
        } else {
            el.className = 'pill-fiado px-3.5 py-1.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all shrink-0';
        }
    });
    filtrarCuadernoFiados();
}

/**
 * Disparador de filtrado por caja de búsqueda
 */
function filtrarCuadernoFiados() {
    const q = (document.getElementById('search-fiados')?.value || document.getElementById('search-fiados-input')?.value || '').toLowerCase().trim();
    renderCuadernoFiados(q, currentFiltroFiados);
}

/**
 * Renderiza el Cuaderno Digital de Fiados con KPIs, tarjetas interactivas y estados
 */
function renderCuadernoFiados(searchQuery = '', filtro = currentFiltroFiados) {
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;

    // 1. Cálculo de KPIs globales de la calle
    const totalDeudaUsd = (clientes || []).reduce((acc, c) => acc + (c.deudaUsd || 0), 0);
    const totalDeudaBs = totalDeudaUsd * tasa;
    const deudoresActivos = (clientes || []).filter(c => (c.deudaUsd || 0) > 0.009).length;
    const totalSaldoFavor = (clientes || []).reduce((acc, c) => acc + (c.saldoFavorUsd || 0), 0);
    const promedioDeuda = deudoresActivos > 0 ? totalDeudaUsd / deudoresActivos : 0;

    const elTotalUsd = document.getElementById('fiados-total-usd') || document.getElementById('kpi-fiados-total-usd');
    if (elTotalUsd) elTotalUsd.textContent = `$${totalDeudaUsd.toFixed(2)}`;

    const elTotalBs = document.getElementById('fiados-total-bs') || document.getElementById('kpi-fiados-total-bs');
    if (elTotalBs) elTotalBs.textContent = `Bs ${totalDeudaBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const elCount = document.getElementById('fiados-count-deudores') || document.getElementById('kpi-fiados-cant-deudores');
    if (elCount) elCount.textContent = `${deudoresActivos}`;

    const elPromedio = document.getElementById('fiados-promedio-deuda');
    if (elPromedio) elPromedio.textContent = `Promedio: $${promedioDeuda.toFixed(2)}`;

    const elFavor = document.getElementById('fiados-total-saldofavor') || document.getElementById('kpi-fiados-saldo-favor');
    if (elFavor) elFavor.textContent = `$${totalSaldoFavor.toFixed(2)}`;

    const elTasa = document.getElementById('fiados-tasa-bcv') || document.getElementById('kpi-fiados-tasa-bcv');
    if (elTasa) elTasa.textContent = `Bs ${tasa.toFixed(2)}`;

    // 2. Filtrado de clientes para la vista de tarjetas
    let lista = [...(clientes || [])];

    if (searchQuery) {
        lista = lista.filter(c => 
            (c.nombre && c.nombre.toLowerCase().includes(searchQuery)) ||
            (c.cedula && c.cedula.toLowerCase().includes(searchQuery)) ||
            (c.telefono && c.telefono.includes(searchQuery))
        );
    }

    if (filtro === 'deuda' || filtro === 'con_deuda') {
        lista = lista.filter(c => (c.deudaUsd || 0) > 0.009);
    } else if (filtro === 'alta' || filtro === 'deuda_mayor') {
        lista = lista.filter(c => (c.deudaUsd || 0) >= 10);
    } else if (filtro === 'critica' || filtro === 'deuda_critica') {
        lista = lista.filter(c => (c.deudaUsd || 0) >= 25);
    } else if (filtro === 'saldoFavor' || filtro === 'saldo_favor') {
        lista = lista.filter(c => (c.saldoFavorUsd || 0) > 0.009);
    }

    // Ordenar: mayor deuda primero, luego por saldo a favor, luego alfabético
    lista.sort((a, b) => {
        const dDiff = (b.deudaUsd || 0) - (a.deudaUsd || 0);
        if (Math.abs(dDiff) > 0.001) return dDiff;
        return (b.saldoFavorUsd || 0) - (a.saldoFavorUsd || 0);
    });

    const grid = document.getElementById('fiados-grid');
    const empty = document.getElementById('fiados-empty');
    if (!grid) return;

    if (lista.length === 0) {
        grid.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        return;
    }
    if (empty) empty.classList.add('hidden');

    grid.innerHTML = lista.map(c => {
        const deuda = c.deudaUsd || 0;
        const tieneDeuda = deuda > 0.009;
        const deudaBs = deuda * tasa;
        const saldoFavor = c.saldoFavorUsd || 0;
        const nivelInfo = getClienteNivel(c.puntos || 0);
        const initials = (c.nombre || 'C').split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();

        return `
        <div class="bg-white/85 dark:bg-slate-900/85 backdrop-blur-md rounded-2xl p-4 border ${tieneDeuda ? 'border-amber-200/90 dark:border-amber-900/50 shadow-sm hover:shadow-md' : 'border-slate-200/80 dark:border-slate-800'} transition-all flex flex-col justify-between group">
            <div>
                <!-- Header Tarjeta -->
                <div class="flex items-start justify-between gap-2 mb-3">
                    <div class="flex items-center gap-2.5 overflow-hidden">
                        <div class="w-10 h-10 rounded-xl ${tieneDeuda ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'} flex items-center justify-center font-black text-sm shrink-0">
                            ${initials || 'CL'}
                        </div>
                        <div class="overflow-hidden">
                            <h4 class="font-bold text-sm text-slate-900 dark:text-white truncate" title="${c.nombre}">${c.nombre}</h4>
                            <div class="flex items-center gap-1.5 text-[11px] text-slate-400">
                                ${c.cedula ? `<span>CI: ${c.cedula}</span>` : ''}
                                ${c.cedula && c.telefono ? `<span>•</span>` : ''}
                                ${c.telefono ? `<span class="truncate"><i class="fa-solid fa-phone text-[9px]"></i> ${c.telefono}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="shrink-0">
                        ${nivelInfo.badge}
                    </div>
                </div>

                <!-- Bloque Montos -->
                <div class="p-3 rounded-xl mb-3 ${tieneDeuda ? 'bg-rose-50/70 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40' : 'bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800'}">
                    <div class="flex justify-between items-baseline mb-0.5">
                        <span class="text-[10px] font-black uppercase tracking-wider ${tieneDeuda ? 'text-rose-500 dark:text-rose-400' : 'text-slate-400'}">
                            ${tieneDeuda ? 'Deuda Pendiente' : 'Al Día'}
                        </span>
                        <span class="font-black text-base tabular-nums ${tieneDeuda ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}">
                            $${deuda.toFixed(2)}
                        </span>
                    </div>
                    <div class="flex justify-between items-center text-[11px]">
                        <span class="text-slate-400">Equivalente BCV:</span>
                        <span class="font-bold tabular-nums ${tieneDeuda ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400'}">
                            Bs ${deudaBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </div>
                    ${saldoFavor > 0 ? `
                    <div class="mt-2 pt-2 border-t border-rose-100/80 dark:border-rose-900/40 flex justify-between items-center text-[11px]">
                        <span class="text-emerald-600 dark:text-emerald-400 font-bold"><i class="fa-solid fa-gift"></i> Saldo a Favor:</span>
                        <span class="font-black text-emerald-600 dark:text-emerald-400">+$${saldoFavor.toFixed(2)}</span>
                    </div>` : ''}
                </div>
            </div>

            <!-- Botones de Acción Rápida -->
            <div class="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div class="grid grid-cols-2 gap-1.5">
                    ${tieneDeuda ? `
                    <button onclick="openModalCobroWhatsApp('${c.id}')" class="px-2.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5">
                        <i class="fa-brands fa-whatsapp text-sm"></i> Cobrar WS
                    </button>
                    <button onclick="openAbonoModal('${c.id}')" class="px-2.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50 dark:text-emerald-300 font-bold text-xs transition-colors flex items-center justify-center gap-1.5">
                        <i class="fa-solid fa-hand-holding-dollar text-xs"></i> Abonar
                    </button>
                    ` : `
                    <button onclick="openModalCobroWhatsApp('${c.id}')" class="px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-bold text-xs transition-colors flex items-center justify-center gap-1.5">
                        <i class="fa-brands fa-whatsapp text-sm text-emerald-500"></i> Mensaje WS
                    </button>
                    <button onclick="openAbonoModal('${c.id}')" class="px-2.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-400 dark:text-slate-500 font-bold text-xs transition-colors flex items-center justify-center gap-1.5" disabled>
                        <i class="fa-solid fa-check text-xs text-emerald-500"></i> Al Día
                    </button>
                    `}
                </div>
                <div class="flex items-center justify-between text-xs pt-1 px-1 text-slate-400">
                    <button onclick="verHistorialComprasCliente('${c.id}')" class="hover:text-primary-500 font-medium text-[11px] flex items-center gap-1 transition-colors">
                        <i class="fa-solid fa-receipt text-[10px]"></i> Ver Compras
                    </button>
                    <button onclick="editarCliente('${c.id}')" class="hover:text-slate-600 dark:hover:text-slate-200 text-[11px] flex items-center gap-1 transition-colors">
                        <i class="fa-solid fa-pen text-[10px]"></i> Editar
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

/**
 * Abre el modal de Cobro por WhatsApp con datos precargados y plantilla
 */
function openModalCobroWhatsApp(clienteId) {
    const c = clientes.find(x => x.id === clienteId);
    if (!c) return Swal.fire('Error', 'Cliente no encontrado', 'error');

    currentCobroClienteId = clienteId;
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    const deudaUsd = c.deudaUsd || 0;
    const deudaBs = deudaUsd * tasa;

    const elNombre = document.getElementById('cobro-ws-cliente-nombre');
    if (elNombre) elNombre.textContent = c.nombre;

    const elTlf = document.getElementById('cobro-ws-cliente-tlf');
    if (elTlf) {
        // Formato legible para mostrar: 584141234567 -> +58 414-1234567
        elTlf.textContent = `Teléfono: ${formatearTelefono(c.telefono) || 'No registrado'}`;
    }

    const elUsd = document.getElementById('cobro-ws-deuda-usd');
    if (elUsd) elUsd.textContent = `$${deudaUsd.toFixed(2)}`;

    const elBs = document.getElementById('cobro-ws-deuda-bs');
    if (elBs) elBs.textContent = `Bs ${deudaBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    setCobroTemplate(currentCobroTemplate || 'amable');

    const m = document.getElementById('cobro-whatsapp-modal');
    const cont = document.getElementById('cobro-whatsapp-modal-content');
    if (m && cont) {
        m.classList.remove('hidden');
        setTimeout(() => {
            m.classList.remove('opacity-0');
            cont.classList.remove('scale-95');
        }, 10);
    }
}

/**
 * Cierra el modal de cobro por WhatsApp
 */
function closeModalCobroWhatsApp() {
    const m = document.getElementById('cobro-whatsapp-modal');
    const cont = document.getElementById('cobro-whatsapp-modal-content');
    if (m && cont) {
        m.classList.add('opacity-0');
        cont.classList.add('scale-95');
        setTimeout(() => m.classList.add('hidden'), 300);
    }
}

/**
 * Selecciona la plantilla de cobranza deseada y actualiza el área de texto
 */
function setCobroTemplate(tplKey) {
    currentCobroTemplate = tplKey;
    const btns = {
        amable: document.getElementById('btn-tpl-amable'),
        quincena: document.getElementById('btn-tpl-quincena'),
        detallado: document.getElementById('btn-tpl-detallado')
    };

    Object.keys(btns).forEach(k => {
        const btn = btns[k];
        if (!btn) return;
        if (k === tplKey) {
            btn.className = 'px-2.5 py-2 rounded-xl text-[11px] font-bold border transition-all text-center bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-700 dark:text-emerald-300 shadow-xs';
        } else {
            btn.className = 'px-2.5 py-2 rounded-xl text-[11px] font-bold border transition-all text-center bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300';
        }
    });

    const c = clientes.find(x => x.id === currentCobroClienteId);
    if (c) {
        const textarea = document.getElementById('cobro-ws-textarea');
        if (textarea) textarea.value = generarTextoCobro(c, tplKey);
    }
}

/**
 * Genera el mensaje formateado para WhatsApp adaptado a la cultura comercial venezolana
 */
function generarTextoCobro(c, tplKey) {
    const storeName = (storeConfig && storeConfig.name) ? storeConfig.name : 'Nuestra Tienda';
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    const deuda = (c.deudaUsd || 0);
    const deudaBs = (deuda * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const primerNombre = (c.nombre || 'Cliente').split(' ').filter(Boolean)[0] || 'Cliente';

    if (tplKey === 'amable') {
        return `Hola ${primerNombre}, ¡espero que estés muy bien! Te saludamos de *${storeName}* 😊.\n\nTe escribimos con mucho gusto para recordarte tu saldo pendiente de fiado:\n💵 *${deuda.toFixed(2)} USD* (equivale a *Bs ${deudaBs}* a la tasa oficial BCV de hoy Bs ${tasa.toFixed(2)}).\n\nSi deseas pasar a abonar en el negocio o transferir por Pago Móvil, estamos a tu completa disposición. ¡Muchas gracias por tu preferencia y feliz día! ✨`;
    } else if (tplKey === 'quincena') {
        return `Estimado(a) ${c.nombre}, un cordial saludo de parte del equipo de *${storeName}* 📋.\n\nAprovechamos estas fechas para recordarte tu saldo en cuenta:\n💰 Saldo pendiente: *$${deuda.toFixed(2)} USD* / *Bs ${deudaBs}* (Tasa BCV: ${tasa.toFixed(2)}).\n\nAgradecemos mucho tu puntualidad para que podamos seguir brindándote el mejor servicio y crédito de confianza. ¡Que tengas una excelente jornada! 🤝`;
    } else {
        // 'detallado'
        let texto = `🧾 *ESTADO DE CUENTA - ${storeName.toUpperCase()}*\n`;
        texto += `━━━━━━━━━━━━━━━━━━━━━\n`;
        texto += `👤 Cliente: *${c.nombre}*\n`;
        if (c.cedula) texto += `🆔 Cédula: ${c.cedula}\n`;
        texto += `💰 Saldo Pendiente: *$${deuda.toFixed(2)} USD*\n`;
        texto += `🇻🇪 Total en Bolívares: *Bs ${deudaBs}*\n`;
        texto += `📊 Tasa Oficial BCV: Bs ${tasa.toFixed(2)}\n`;
        if ((c.saldoFavorUsd || 0) > 0) {
            texto += `🎁 Saldo a Favor: +$${c.saldoFavorUsd.toFixed(2)}\n`;
        }
        texto += `━━━━━━━━━━━━━━━━━━━━━\n`;
        texto += `💳 *Métodos de Pago Aceptados:*\n`;
        texto += `• Efectivo ($ / Bs) o Punto de Venta en tienda.\n`;
        texto += `• Pago Móvil disponible.\n\n`;
        texto += `¡Muchas gracias por tu confianza continua! 🌟`;
        return texto;
    }
}

/**
 * Dispara el envío directo a WhatsApp en 1 toque
 */
function enviarMensajeCobroWhatsAppActual() {
    const c = clientes.find(x => x.id === currentCobroClienteId);
    if (!c) return Swal.fire('Error', 'Cliente no seleccionado', 'error');

    const phoneRaw = c.telefono;
    const phoneClean = formatPhoneVzla(phoneRaw);
    if (!phoneClean || phoneClean.length < 8) {
        return Swal.fire({
            title: 'Teléfono no válido',
            text: `El cliente ${c.nombre} no tiene un número celular registrado o es inválido (${c.telefono || 'sin número'}). Edita el cliente para agregar su WhatsApp.`,
            icon: 'warning'
        });
    }

    const text = document.getElementById('cobro-ws-textarea')?.value || '';
    window.open(enlaceWhatsApp(phoneClean, text), '_blank');
    closeModalCobroWhatsApp();
}

/**
 * Copia el mensaje actual al portapapeles
 */
function copiarMensajeCobro() {
    const text = document.getElementById('cobro-ws-textarea')?.value || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btn-copiar-msg-cobro');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check text-emerald-500"></i> ¡Mensaje Copiado!';
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
        }
    }).catch(() => {
        Swal.fire('Error', 'No se pudo copiar al portapapeles', 'error');
    });
}

/**
 * Envía el reporte consolidado de todos los fiados en la calle al WhatsApp del dueño
 */
function enviarListaCobroWhatsApp() {
    const deudores = (clientes || []).filter(c => (c.deudaUsd || 0) > 0.009);
    if (deudores.length === 0) {
        return Swal.fire('¡Excelente!', 'No hay clientes con deuda pendiente en la calle.', 'info');
    }
    const storeName = (storeConfig && storeConfig.name) ? storeConfig.name : 'Nuestra Tienda';
    const tasa = (rates && rates.bcv > 0) ? rates.bcv : 36.5;
    const totalUsd = deudores.reduce((acc, c) => acc + (c.deudaUsd || 0), 0);
    const totalBs = totalUsd * tasa;

    deudores.sort((a, b) => (b.deudaUsd || 0) - (a.deudaUsd || 0));

    let msg = `📋 *REPORTE DE FIADOS EN LA CALLE - ${storeName.toUpperCase()}*\n`;
    msg += `📅 Fecha: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n`;
    msg += `📊 Tasa BCV: Bs ${tasa.toFixed(2)}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💵 *TOTAL POR COBRAR:* *$${totalUsd.toFixed(2)} USD*\n`;
    msg += `🇻🇪 *TOTAL EN BOLÍVARES:* *Bs ${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}*\n`;
    msg += `👥 Clientes con deuda: *${deudores.length}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `*DETALLE DE CLIENTES:*\n`;

    deudores.forEach((c, idx) => {
        const bs = ((c.deudaUsd || 0) * tasa).toFixed(2);
        msg += `${idx + 1}. *${c.nombre}*: $${(c.deudaUsd || 0).toFixed(2)} (Bs ${bs})`;
        if (c.telefono) msg += ` • Tlf: ${c.telefono}`;
        msg += `\n`;
    });

    msg += `\n_Generado automáticamente desde el Cuaderno Digital de Fiados._`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

/**
 * Muestra el historial completo de compras, tickets fiados y abonos del cliente
 */
function verHistorialComprasCliente(clienteId) {
    const c = clientes.find(x => x.id === clienteId);
    if (!c) return Swal.fire('Error', 'Cliente no encontrado', 'error');

    const modalTitle = document.getElementById('historial-cliente-modal-title');
    if (modalTitle) modalTitle.textContent = `Compras y Abonos: ${c.nombre}`;

    const modalSubtitle = document.getElementById('historial-cliente-modal-subtitle');
    if (modalSubtitle) {
        const saldo = (c.deudaUsd || 0) > 0 ? `Deuda activa: $${c.deudaUsd.toFixed(2)}` : 'Sin deudas pendientes';
        modalSubtitle.textContent = `${c.cedula ? 'CI: ' + c.cedula + ' • ' : ''}${saldo}`;
    }

    const lista = document.getElementById('historial-cliente-lista');
    if (!lista) return;

    const compras = (salesHistory || []).filter(v => v.clienteId === clienteId);
    const abonos = (abonosHistory || []).filter(a => a.clienteId === clienteId);

    const timeline = [];

    compras.forEach(v => {
        timeline.push({
            tipo: 'compra',
            fecha: v.timestamp ? (v.timestamp.toDate ? v.timestamp.toDate() : new Date(v.timestamp)) : (v.fechaStr ? new Date(v.fechaStr) : new Date(0)),
            fechaStr: v.fechaStr || 'Fecha N/A',
            ticket: v.numeroFactura || (v.id ? v.id.slice(-6) : 'Ticket'),
            totalUsd: v.totalUsd || 0,
            fiadoUsd: v.fiadoUsd || 0,
            items: v.items || [],
            pagos: v.pagos || {}
        });
    });

    abonos.forEach(a => {
        timeline.push({
            tipo: 'abono',
            fecha: a.timestamp ? (a.timestamp.toDate ? a.timestamp.toDate() : new Date(a.timestamp)) : (a.fechaStr ? new Date(a.fechaStr) : new Date(0)),
            fechaStr: a.fechaStr || 'Fecha N/A',
            montoUsd: a.montoUsd || 0,
            metodo: a.metodoUsado || 'Efectivo',
            banco: a.bancoDestino || ''
        });
    });

    timeline.sort((a, b) => b.fecha - a.fecha);

    if (timeline.length === 0) {
        lista.innerHTML = `
            <div class="text-center py-10 text-slate-400">
                <i class="fa-solid fa-receipt text-3xl mb-2 text-slate-300"></i>
                <p class="font-bold text-sm">Sin movimientos recientes</p>
                <p class="text-xs">No se han registrado compras o abonos para este cliente en el historial actual.</p>
            </div>`;
    } else {
        lista.innerHTML = timeline.map(item => {
            if (item.tipo === 'compra') {
                const tieneFiado = (item.fiadoUsd || 0) > 0.009;
                const itemNames = (item.items || []).map(i => `${i.qty}x ${i.nombre}`).join(', ');
                return `
                <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-start justify-between gap-3">
                    <div class="flex items-start gap-3">
                        <div class="w-8 h-8 rounded-xl ${tieneFiado ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-primary-500/10 text-primary-600 dark:text-primary-400'} flex items-center justify-center shrink-0 mt-0.5">
                            <i class="fa-solid fa-bag-shopping text-xs"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-xs text-slate-800 dark:text-slate-100">Compra #${item.ticket}</span>
                                ${tieneFiado ? '<span class="text-[10px] font-black bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">FIADO</span>' : '<span class="text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded">CONTADO</span>'}
                            </div>
                            <p class="text-[11px] text-slate-400 mt-0.5">${item.fechaStr}</p>
                            ${itemNames ? `<p class="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">${itemNames}</p>` : ''}
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <span class="font-black text-sm text-slate-800 dark:text-slate-100">$${item.totalUsd.toFixed(2)}</span>
                        ${tieneFiado ? `<div class="text-[11px] font-bold text-rose-500">Quedó debiendo: $${item.fiadoUsd.toFixed(2)}</div>` : ''}
                    </div>
                </div>`;
            } else {
                return `
                <div class="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-800/40 flex items-start justify-between gap-3">
                    <div class="flex items-start gap-3">
                        <div class="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                            <i class="fa-solid fa-hand-holding-dollar text-xs"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-xs text-emerald-800 dark:text-emerald-200">Abono a Deuda</span>
                                <span class="text-[10px] font-bold text-emerald-600 uppercase">${item.metodo}${item.banco ? ' • ' + item.banco : ''}</span>
                            </div>
                            <p class="text-[11px] text-slate-400 mt-0.5">${item.fechaStr}</p>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <span class="font-black text-sm text-emerald-600 dark:text-emerald-400">+$${item.montoUsd.toFixed(2)}</span>
                    </div>
                </div>`;
            }
        }).join('');
    }

    const m = document.getElementById('historial-compras-cliente-modal');
    const cont = document.getElementById('historial-compras-cliente-content');
    if (m && cont) {
        m.classList.remove('hidden');
        setTimeout(() => {
            m.classList.remove('opacity-0');
            cont.classList.remove('scale-95');
        }, 10);
    }
}

/**
 * Cierra el modal de historial de compras del cliente
 */
function closeHistorialComprasClienteModal() {
    const m = document.getElementById('historial-compras-cliente-modal');
    const cont = document.getElementById('historial-compras-cliente-content');
    if (m && cont) {
        m.classList.add('opacity-0');
        cont.classList.add('scale-95');
        setTimeout(() => m.classList.add('hidden'), 300);
    }
}

/**
 * Alias de compatibilidad hacia atrás
 */
function enviarCobroWhatsApp(id) {
    openModalCobroWhatsApp(id);
}

function populateClientesSelect() {
    const s = document.getElementById('pay-cliente');
    if (!s) return;
    s.innerHTML = '<option value="">Cliente Ocasional (Venta Contado)</option>';
    clientes.forEach(c => {
        const saldoFavor = c.saldoFavorUsd || 0;
        const deuda = c.deudaUsd || 0;
        let badgeInfo = `${c.puntos || 0} pts`;
        if (saldoFavor > 0) badgeInfo += ` • 🎁 Saldo a favor: $${saldoFavor.toFixed(2)}`;
        if (deuda > 0) badgeInfo += ` • ⚠️ Deuda: $${deuda.toFixed(2)}`;
        s.innerHTML += `<option value="${c.id}">${c.nombre} (${badgeInfo})</option>`;
    });
}

function renderClientes() {
    const t = document.getElementById('clientes-table-body');
    if (!t) return;
    t.innerHTML = '';
    clientes.forEach(c => {
        const nivelInfo = getClienteNivel(c.puntos);
        const tieneDeuda = (c.deudaUsd || 0) > 0;
        const saldoFavor = c.saldoFavorUsd || 0;
        t.innerHTML += `
            <tr class="hover:bg-white/60 border-b border-white/40">
                <td class="p-4 font-bold text-slate-800">
                    <div>${c.nombre}</div>
                    ${c.cedula ? `<div class="text-[11px] font-semibold text-slate-400">CI: ${c.cedula}</div>` : ''}
                </td>
                <td class="p-4 text-slate-600 text-xs">${c.telefono || 'N/A'}</td>
                <td class="p-4 text-center">${nivelInfo.badge}</td>
                <td class="p-4 text-right font-black ${tieneDeuda ? 'text-rose-500' : 'text-slate-400 text-xs'}">$${(c.deudaUsd || 0).toFixed(2)}</td>
                <td class="p-4 text-right font-black ${saldoFavor > 0 ? 'text-emerald-600' : 'text-slate-400 text-xs'}">${saldoFavor > 0 ? `+$${saldoFavor.toFixed(2)}` : '$0.00'}</td>
                <td class="p-4 text-center">
                    <button onclick="openAbonoModal('${c.id}')" class="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-3 py-1 rounded-lg font-bold text-xs mr-2 shadow-xs"><i class="fa-solid fa-hand-holding-dollar"></i> Abonar</button>
                    ${tieneDeuda && c.telefono ? `<button onclick="openModalCobroWhatsApp('${c.id}')" class="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white mx-1" title="Cobrar por WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>` : ''}
                    <button onclick="verHistorialComprasCliente('${c.id}')" class="text-indigo-500 hover:text-indigo-700 mx-1" title="Ver Compras"><i class="fa-solid fa-receipt"></i></button>
                    <button onclick="editarCliente('${c.id}')" class="text-primary-500 hover:text-primary-700 mx-1" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="eliminarCliente('${c.id}')" class="text-rose-400 hover:text-rose-600 mx-1" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
    });
}

function openClienteModal() {
    document.getElementById('cliente-id').value = '';
    document.getElementById('cliente-nombre').value = '';
    document.getElementById('cliente-cedula').value = '';
    document.getElementById('cliente-telefono').value = '';
    document.getElementById('cliente-banco').value = 'Banco de Venezuela';
    const m = document.getElementById('cliente-modal');
    const c = document.getElementById('cliente-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
}

function closeClienteModal() {
    const m = document.getElementById('cliente-modal');
    const c = document.getElementById('cliente-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

function editarCliente(id) {
    const c = clientes.find(x => x.id === id);
    if (!c) return;
    document.getElementById('cliente-id').value = c.id;
    document.getElementById('cliente-nombre').value = c.nombre;
    document.getElementById('cliente-cedula').value = c.cedula || '';
    document.getElementById('cliente-telefono').value = normalizarTelefono(c.telefono);
    document.getElementById('cliente-banco').value = c.banco || 'Banco de Venezuela';
    const m = document.getElementById('cliente-modal');
    const cont = document.getElementById('cliente-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        cont.classList.remove('scale-95');
    }, 10);
}

async function guardarCliente() {
    const id = document.getElementById('cliente-id').value;
    const nombre = document.getElementById('cliente-nombre').value.trim();
    const cedula = document.getElementById('cliente-cedula').value.trim();
    const telefono = normalizarTelefono(document.getElementById('cliente-telefono').value);
    const banco = document.getElementById('cliente-banco').value;
    if (!nombre) return Swal.fire('Error', 'Nombre obligatorio', 'error');
    try {
        if (id) {
            await getDb('clientes').doc(id).update({ nombre, cedula, telefono, banco });
            Swal.fire('Actualizado', 'Cliente modificado', 'success');
        } else {
            await getDb('clientes').add({ 
                nombre, 
                cedula, 
                telefono, 
                banco, 
                deudaUsd: 0, 
                saldoFavorUsd: 0, 
                puntos: 0, 
                timestamp: firebase.firestore.FieldValue.serverTimestamp() 
            });
            Swal.fire('Guardado', 'Cliente registrado', 'success');
        }
        closeClienteModal();
    } catch (e) {
        Swal.fire('Error', e.message, 'error');
    }
}

function eliminarCliente(id) {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Eliminar un cliente es una acción del dueño/administrador: borra su historial de deudas.', 'warning');
    }
    const c = clientes.find(x => x.id === id);
    if (c && c.deudaUsd > 0) return Swal.fire('Denegado', 'Tiene deudas pendientes', 'error');
    Swal.fire({ title: '¿Eliminar?', icon: 'warning', showCancelButton: true }).then(async r => {
        if (!r.isConfirmed) return;
        try {
            await getDb('clientes').doc(id).delete();
            Swal.fire('Borrado', '', 'success');
        } catch (err) {
            console.error('Error eliminando cliente:', err);
            Swal.fire('Error', 'No se pudo eliminar el cliente: ' + (err.message || 'error desconocido'), 'error');
        }
    });
}

function openAbonoModal(clienteId) {
    const c = clientes.find(x => x.id === clienteId);
    if (!c) return;
    if ((c.deudaUsd || 0) <= 0) return Swal.fire('Info', 'Sin deudas', 'info');
    document.getElementById('abono-cliente-id').value = clienteId;
    document.getElementById('abono-deuda-actual').textContent = `$${c.deudaUsd.toFixed(2)}`;
    document.getElementById('abono-monto').value = '';
    const m = document.getElementById('abono-modal');
    const cont = document.getElementById('abono-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        cont.classList.remove('scale-95');
    }, 10);
}

function closeAbonoModal() {
    const m = document.getElementById('abono-modal');
    const c = document.getElementById('abono-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

async function procesarAbono() {
    const id = document.getElementById('abono-cliente-id').value;
    const monto = parseFloat(document.getElementById('abono-monto').value);
    const metodo = document.getElementById('abono-metodo').value;
    const banco = document.getElementById('abono-banco').value;
    if (!id || isNaN(monto) || monto <= 0) return Swal.fire('Atención', 'Monto inválido', 'warning');
    if (metodo === 'pagoMovilBs' && !banco) return Swal.fire('Error', 'Seleccione banco', 'error');
    const c = clientes.find(x => x.id === id);
    if (monto > c.deudaUsd + 0.05) return Swal.fire('Atención', 'Supera la deuda', 'warning');
    try {
        const batch = db.batch();
        batch.update(getDb('clientes').doc(id), { deudaUsd: firebase.firestore.FieldValue.increment(-monto) });
        batch.set(getDb('abonos').doc(), {
            clienteId: id, clienteNombre: c.nombre,
            montoUsd: monto, metodoUsado: metodo, bancoDestino: banco || null,
            cajero: currentUser.email, status: 'abierto',
            fechaStr: new Date().toLocaleString(),
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            tasaBCV: rates.bcv
        });
        await batch.commit();
        closeAbonoModal();
        Swal.fire('¡Éxito!', 'Abono registrado.', 'success');
    } catch (e) {
        Swal.fire('Error', e.message, 'error');
    }
}

function deleteAbono(id) {
    if (!isAdmin) return;
    const a = abonosHistory.find(x => x.id === id);
    if (!a) return;
    Swal.fire({
        title: '¿Eliminar Abono?',
        text: 'Se devolverá la deuda al cliente.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sí'
    }).then(async r => {
        if (r.isConfirmed) {
            try {
                const batch = db.batch();
                if (a.clienteId) {
                    batch.set(getDb('clientes').doc(a.clienteId), { deudaUsd: firebase.firestore.FieldValue.increment(a.montoUsd) }, { merge: true });
                }
                batch.delete(getDb('abonos').doc(id));
                await batch.commit();
                Swal.fire('Eliminado', 'Abono anulado', 'success');
            } catch (e) {
                Swal.fire('Error', e.message, 'error');
            }
        }
    });
}

function deleteGasto(id) {
    if (!isAdmin) return;
    Swal.fire({
        title: '¿Eliminar Gasto?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sí'
    }).then(r => {
        if (r.isConfirmed) {
            getDb('gastos').doc(id).delete()
                .then(() => Swal.fire('Eliminado', '', 'success'))
                .catch(() => Swal.fire('Error', '', 'error'));
        }
    });
}

// =====================================================
// SETTINGS
// =====================================================
function openSettingsModal() {
    if (!isAdmin) return;
    document.getElementById('settings-name').value = storeConfig.name === 'GestiónPro' ? '' : storeConfig.name;
    document.getElementById('settings-rif').value = storeConfig.rif || '';
    if (document.getElementById('settings-phone')) document.getElementById('settings-phone').value = normalizarTelefono(storeConfig.phone);
    if (document.getElementById('settings-nro-factura')) document.getElementById('settings-nro-factura').value = storeConfig.nroFactura || 1001;
    if (document.getElementById('settings-nro-control')) document.getElementById('settings-nro-control').value = storeConfig.nroControl || '00-001001';
    if (storeConfig.logo) {
        document.getElementById('settings-logo-preview').src = storeConfig.logo;
        document.getElementById('settings-logo-preview').classList.remove('hidden');
    } else {
        document.getElementById('settings-logo-preview').classList.add('hidden');
    }
    const m = document.getElementById('settings-modal');
    const c = document.getElementById('settings-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
}

function closeSettingsModal() {
    const m = document.getElementById('settings-modal');
    const c = document.getElementById('settings-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

function previewLogo(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.getElementById('settings-logo-preview').src = e.target.result;
            document.getElementById('settings-logo-preview').classList.remove('hidden');
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function saveSettings() {
    const name = document.getElementById('settings-name').value.trim();
    const rif = document.getElementById('settings-rif').value.trim();
    const phone = normalizarTelefono(document.getElementById('settings-phone')?.value || '');
    const nroFactura = parseInt(document.getElementById('settings-nro-factura')?.value || 1001);
    const nroControl = document.getElementById('settings-nro-control')?.value.trim() || '00-001001';
    const logoInput = document.getElementById('settings-logo-input');
    let logoData = storeConfig.logo;
    if (logoInput.files && logoInput.files[0]) {
        logoData = document.getElementById('settings-logo-preview').src;
    }
    try {
        const payload = { nroFactura, nroControl };
        if (name) payload.storeName = name; else payload.storeName = firebase.firestore.FieldValue.delete();
        if (rif) payload.storeRif = rif; else payload.storeRif = firebase.firestore.FieldValue.delete();
        if (phone) payload.storePhone = phone; else payload.storePhone = firebase.firestore.FieldValue.delete();
        if (logoData) payload.storeLogo = logoData; else payload.storeLogo = firebase.firestore.FieldValue.delete();
        await getDb('settings').doc('general').set(payload, { merge: true });
        Swal.fire('Guardado', 'Datos actualizados', 'success');
        closeSettingsModal();
    } catch (e) {
        Swal.fire('Error', 'No se pudo guardar', 'error');
    }
}

// =====================================================
// SAAS - REGISTRO
// =====================================================
function toggleAuthTab(tab) {
    if (tab === 'login') {
        document.getElementById('form-login').classList.remove('hidden');
        document.getElementById('form-register').classList.add('hidden');
        document.getElementById('tab-login').classList.replace('text-slate-400', 'text-white');
        document.getElementById('tab-login').classList.add('bg-primary-600', 'shadow-sm');
        document.getElementById('tab-register').classList.replace('text-white', 'text-slate-400');
        document.getElementById('tab-register').classList.remove('bg-primary-600', 'shadow-sm');
    } else {
        document.getElementById('form-login').classList.add('hidden');
        document.getElementById('form-register').classList.remove('hidden');
        document.getElementById('tab-register').classList.replace('text-slate-400', 'text-white');
        document.getElementById('tab-register').classList.add('bg-primary-600', 'shadow-sm');
        document.getElementById('tab-login').classList.replace('text-white', 'text-slate-400');
        document.getElementById('tab-login').classList.remove('bg-primary-600', 'shadow-sm');
    }
}

async function registrarNuevoNegocio() {
    const businessType = document.querySelector('input[name="reg-business-type"]:checked')?.value || 'bodega';
    const nombre = document.getElementById('reg-nombre').value.trim();
    const rif = document.getElementById('reg-rif').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-password').value;
    if (!nombre || !rif || !email || !pass) return Swal.fire('Error', 'Completa todos los campos', 'error');
    const btn = document.getElementById('btn-register');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando...';
    let uidNuevo = null;
    try {
        // 1. Crear la cuenta en la app SECUNDARIA, para no desloguear al
        //    usuario que ya esté dentro.
        const cred = await secondaryAuth.createUserWithEmailAndPassword(email, pass);
        uidNuevo = cred.user.uid;

        // 2. Escribir con la app SECUNDARIA, que ya está autenticada como el
        //    nuevo usuario. Antes se escribía con `db` (app primaria) ANTES de
        //    iniciar sesión, así que request.auth era null y Firestore lo
        //    rechazaba con permission-denied: el alta nunca funcionó.
        //    Va en UN SOLO batch porque la regla usa getAfter(), que solo ve
        //    los documentos escritos en el mismo batch.
        const sdb = secondaryApp.firestore();
        const negocioRef = sdb.collection('negocios').doc();
        const batch = sdb.batch();
        batch.set(negocioRef, {
            nombre, rif,
            businessType: businessType,
            tipoNegocio: businessType,
            fechaCreacion: new Date().toISOString(),
            ownerId: uidNuevo,
            plan: 'gratis'
        });
        batch.set(sdb.collection('usuarios').doc(uidNuevo), {
            email, role: 'admin',
            negocioId: negocioRef.id,
            nombre: 'Admin ' + nombre,
            fechaCreacion: new Date().toISOString()
        });
        batch.set(negocioRef.collection('settings').doc('general'), {
            name: nombre,
            rif: rif,
            businessType: businessType,
            nroFactura: 1001
        }, { merge: true });

        // Si eligió Comida Rápida, precargar menú callejero criollo de inmediato
        if (businessType === 'comida_rapida') {
            const allDemoItems = Object.values(DEMO_CATEGORIAS_COMIDA).flatMap(c => c.items);
            allDemoItems.forEach(item => {
                const { id, ...dataSinId } = item;
                batch.set(negocioRef.collection('products').doc(item.id), dataSinId, { merge: true });
            });
        }

        await batch.commit();

        localStorage.setItem('pos_business_mode', businessType);
        storeConfig.businessType = businessType;

        // 3. Ahora sí, entrar por la app principal. El perfil ya existe, así
        //    que onAuthStateChanged lo resuelve sin caer en el error de
        //    "usuario sin negocio asignado".
        await secondaryAuth.signOut();
        await auth.signInWithEmailAndPassword(email, pass);
        Swal.fire('¡Felicidades!', 'Negocio registrado.', 'success');
    } catch (e) {
        // No dejar cuentas huérfanas: sin perfil, el usuario quedaría creado
        // en Authentication pero sin acceso posible.
        if (uidNuevo) {
            try {
                if (secondaryAuth.currentUser) await secondaryAuth.currentUser.delete();
                else await secondaryAuth.signOut();
            } catch (err) {
                try { await secondaryAuth.signOut(); } catch (e2) {}
            }
        }
        let msg = 'Error al registrar.';
        if (e.code === 'auth/email-already-in-use') msg = 'Ese correo ya está registrado.';
        if (e.code === 'auth/weak-password') msg = 'La contraseña debe tener al menos 6 caracteres.';
        if (e.code === 'auth/invalid-email') msg = 'El correo no es válido.';
        if (e.code === 'permission-denied') msg = 'Las reglas de Firestore rechazaron el registro. Verifica que estén publicadas.';
        Swal.fire('Error', msg, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Registrar y Entrar <i class="fa-solid fa-rocket"></i>';
    }
}

// =====================================================
// PROVEEDORES Y ÓRDENES DE COMPRA
// =====================================================
function listenProveedores() {
    activeListeners.push(getDb('proveedores').onSnapshot(snap => {
        proveedores = [];
        snap.forEach(doc => proveedores.push({ id: doc.id, ...doc.data() }));
        renderProveedores();
    }));
}

function listenOrdenes() {
    activeListeners.push(getDb('ordenesCompra').orderBy('createdAt', 'desc').limit(50).onSnapshot(snap => {
        ordenesCompra = [];
        snap.forEach(doc => ordenesCompra.push({ id: doc.id, ...doc.data() }));
        renderOrdenesCompra();
    }));
}

function renderProveedores() {
    const list = document.getElementById('proveedores-list');
    if (!list) return;
    list.innerHTML = '';
    if (proveedores.length === 0) {
        list.innerHTML = '<p class="text-slate-400 text-sm">Sin proveedores.</p>';
        return;
    }
    proveedores.forEach(p => {
        list.innerHTML += `
            <div class="bg-white/50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm flex justify-between items-start transition-all hover:bg-white dark:hover:bg-slate-800">
                <div>
                    <h4 class="font-bold text-slate-800 dark:text-white">${p.nombre}</h4>
                    <p class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-user text-slate-400 mr-1"></i> ${p.contacto || 'N/A'}</p>
                    <p class="text-xs text-slate-500"><i class="fa-solid fa-phone text-slate-400 mr-1"></i> ${p.telefono || 'N/A'}</p>
                </div>
                <div class="flex items-center">
                    <button onclick="editProveedor('${p.id}')" class="text-primary-500 hover:bg-primary-50 p-2 rounded-full"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="deleteProveedor('${p.id}')" class="text-rose-500 hover:bg-rose-50 p-2 rounded-full"><i class="fa-regular fa-trash-can"></i></button>
                </div>
            </div>`;
    });
}

function renderOrdenesCompra() {
    const tbody = document.getElementById('ordenes-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (ordenesCompra.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4">Sin órdenes</td></tr>';
        return;
    }
    ordenesCompra.forEach(o => {
        let statusBadge = '';
        if (o.estado === 'Pendiente') statusBadge = '<span class="bg-amber-100 text-amber-700 px-2 py-1 rounded-full text-xs font-bold">Pendiente</span>';
        else if (o.estado === 'Recibida') statusBadge = '<span class="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full text-xs font-bold">Recibida</span>';
        else statusBadge = '<span class="bg-rose-100 text-rose-700 px-2 py-1 rounded-full text-xs font-bold">Cancelada</span>';
        const btnRecibir = o.estado === 'Pendiente' ? `<button onclick="recibirOrden('${o.id}')" class="text-emerald-600 font-bold text-xs bg-emerald-50 px-3 py-1.5 rounded-lg mr-2">Recibir</button>` : '';
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50/50 transition-colors">
                <td class="p-4">${o.createdAt ? new Date(o.createdAt.toDate()).toLocaleDateString() : ''}</td>
                <td class="p-4 font-bold text-slate-700">${o.proveedorNombre}</td>
                <td class="p-4 font-black">$${(o.total || 0).toFixed(2)}</td>
                <td class="p-4 text-center">${statusBadge}</td>
                <td class="p-4 text-center">${btnRecibir}<button onclick="verOrden('${o.id}')" class="text-slate-400 hover:text-primary-500"><i class="fa-solid fa-eye"></i></button></td>
            </tr>`;
    });
}

function openProveedorModal() {
    if (!isAdmin) return Swal.fire('Error', 'Solo admins', 'error');
    document.getElementById('proveedor-form').reset();
    document.getElementById('prov-id').value = '';
    const m = document.getElementById('proveedor-modal');
    const c = document.getElementById('proveedor-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
}

function closeProveedorModal() {
    const m = document.getElementById('proveedor-modal');
    const c = document.getElementById('proveedor-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

document.addEventListener('DOMContentLoaded', () => {
    const pForm = document.getElementById('proveedor-form');
    if (pForm) {
        pForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('prov-id').value;
            const data = {
                nombre: document.getElementById('prov-nombre').value.trim(),
                contacto: document.getElementById('prov-contacto').value.trim(),
                telefono: normalizarTelefono(document.getElementById('prov-telefono').value),
                direccion: document.getElementById('prov-direccion').value.trim()
            };
            if (!data.nombre) return;
            Swal.fire({ title: 'Guardando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            try {
                if (id) await getDb('proveedores').doc(id).update(data);
                else {
                    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    await getDb('proveedores').add(data);
                }
                closeProveedorModal();
                Swal.fire('Guardado', 'Proveedor guardado', 'success');
            } catch (error) {
                Swal.fire('Error', 'No se pudo guardar', 'error');
            }
        });
    }
});

function deleteProveedor(id) {
    Swal.fire({
        title: '¿Eliminar proveedor?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        confirmButtonText: 'Sí'
    }).then(async r => {
        if (r.isConfirmed) {
            await getDb('proveedores').doc(id).delete();
            Swal.fire('Eliminado', '', 'success');
        }
    });
}

function editProveedor(id) {
    if (!isAdmin) return;
    const p = proveedores.find(x => x.id === id);
    if (!p) return;
    document.getElementById('prov-id').value = p.id;
    document.getElementById('prov-nombre').value = p.nombre || '';
    document.getElementById('prov-contacto').value = p.contacto || '';
    document.getElementById('prov-telefono').value = normalizarTelefono(p.telefono);
    document.getElementById('prov-direccion').value = p.direccion || '';
    const m = document.getElementById('proveedor-modal');
    const c = document.getElementById('proveedor-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
}

function openOrdenCompraModal() {
    if (!isAdmin) return Swal.fire('Error', 'Solo admins', 'error');
    if (proveedores.length === 0) return Swal.fire('Sin proveedores', 'Agrega uno primero', 'warning');
    const sel = document.getElementById('orden-proveedor');
    sel.innerHTML = '';
    proveedores.forEach(p => {
        sel.innerHTML += `<option value="${p.id}">${p.nombre}</option>`;
    });
    currentOrdenItems = [];
    document.getElementById('orden-buscar-prod').value = '';
    renderOrdenItemsUI();
    const m = document.getElementById('orden-modal');
    const c = document.getElementById('orden-modal-content');
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
}

function closeOrdenCompraModal() {
    const m = document.getElementById('orden-modal');
    const c = document.getElementById('orden-modal-content');
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

function buscarProdParaOrden() {
    const q = document.getElementById('orden-buscar-prod').value.toLowerCase();
    const res = document.getElementById('orden-search-results');
    res.innerHTML = '';
    if (q.length < 2) { res.classList.add('hidden'); return; }
    const matches = products.filter(p => p.nombre.toLowerCase().includes(q) || p.codigo.includes(q)).slice(0, 5);
    if (matches.length === 0) {
        res.innerHTML = '<div class="p-3 text-slate-500">No encontrado</div>';
    } else {
        matches.forEach(p => {
            res.innerHTML += `
                <div class="p-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50" onclick="addProdToOrden('${p.id}')">
                    <div class="font-bold text-slate-700">${p.nombre}</div>
                    <div class="text-[10px] text-slate-400">Stock: ${p.stock} | Costo: $${p.costo || 0}</div>
                </div>`;
        });
    }
    res.classList.remove('hidden');
}

function addProdToOrden(id) {
    const p = products.find(x => x.id === id);
    if (!p) return;
    document.getElementById('orden-search-results').classList.add('hidden');
    document.getElementById('orden-buscar-prod').value = '';
    const ex = currentOrdenItems.find(x => x.productoId === id);
    if (ex) ex.cantidad += 1;
    else currentOrdenItems.push({ productoId: id, productoNombre: p.nombre, cantidad: 1, costoUnitario: p.costo || 0 });
    renderOrdenItemsUI();
}

function renderOrdenItemsUI() {
    const tb = document.getElementById('orden-items-body');
    let total = 0;
    tb.innerHTML = '';
    if (currentOrdenItems.length === 0) {
        tb.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-slate-400">Sin items</td></tr>';
    } else {
        currentOrdenItems.forEach((i, idx) => {
            const sub = i.cantidad * i.costoUnitario;
            total += sub;
            tb.innerHTML += `
                <tr>
                    <td class="py-2 font-bold">${i.productoNombre}</td>
                    <td class="py-2"><input type="number" step="any" min="0.1" value="${i.cantidad}" onchange="currentOrdenItems[${idx}].cantidad=parseFloat(this.value)||1; renderOrdenItemsUI()" class="w-16 px-2 py-1 text-right bg-white border border-slate-200 rounded"></td>
                    <td class="py-2"><input type="number" step="0.01" min="0" value="${i.costoUnitario}" onchange="currentOrdenItems[${idx}].costoUnitario=parseFloat(this.value)||0; renderOrdenItemsUI()" class="w-20 px-2 py-1 text-right bg-white border border-slate-200 rounded"></td>
                    <td class="py-2 text-right font-bold">$${sub.toFixed(2)}</td>
                    <td class="py-2 text-center"><button onclick="currentOrdenItems.splice(${idx},1); renderOrdenItemsUI()" class="text-rose-500"><i class="fa-solid fa-xmark"></i></button></td>
                </tr>`;
        });
    }
    document.getElementById('orden-total-usd').textContent = `$${total.toFixed(2)}`;
}

async function procesarOrdenCompra() {
    if (currentOrdenItems.length === 0) return Swal.fire('Error', 'Agrega productos', 'error');
    const provId = document.getElementById('orden-proveedor').value;
    const prov = proveedores.find(p => p.id === provId);
    if (!prov) return;
    let total = currentOrdenItems.reduce((acc, val) => acc + (val.cantidad * val.costoUnitario), 0);
    Swal.fire({ title: 'Generando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    try {
        await getDb('ordenesCompra').add({
            proveedorId: prov.id,
            proveedorNombre: prov.nombre,
            items: currentOrdenItems,
            total: total,
            estado: 'Pendiente',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            creadaPor: auth.currentUser ? auth.currentUser.email : 'Unknown'
        });
        closeOrdenCompraModal();
        Swal.fire('¡Emitida!', 'Orden generada.', 'success');
    } catch (e) {
        Swal.fire('Error', 'No se pudo generar', 'error');
    }
}

async function recibirOrden(id) {
    const orden = ordenesCompra.find(o => o.id === id);
    if (!orden) return;
    Swal.fire({
        title: '¿Recibir Orden?',
        text: 'Se actualizará stock y costos.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Sí, recibir',
        confirmButtonColor: '#10b981'
    }).then(async r => {
        if (r.isConfirmed) {
            Swal.fire({ title: 'Procesando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            try {
                const batch = db.batch();
                batch.update(getDb('ordenesCompra').doc(id), {
                    estado: 'Recibida',
                    recibidaEn: firebase.firestore.FieldValue.serverTimestamp(),
                    recibidaPor: auth.currentUser.email
                });
                orden.items.forEach(i => {
                    const prodRef = getDb('products').doc(i.productoId);
                    batch.update(prodRef, {
                        stock: firebase.firestore.FieldValue.increment(i.cantidad),
                        costo: i.costoUnitario
                    });
                });
                await batch.commit();
                Swal.fire('Completado', 'Stock ingresado', 'success');
            } catch (e) {
                Swal.fire('Error', 'No se pudo procesar', 'error');
            }
        }
    });
}

function verOrden(id) {
    const o = ordenesCompra.find(x => x.id === id);
    if (!o) return;
    let itemsHtml = o.items.map(i => `<li>${i.productoNombre} - ${i.cantidad} x $${i.costoUnitario} = $${(i.cantidad * i.costoUnitario).toFixed(2)}</li>`).join('');
    Swal.fire({
        title: `Orden a ${o.proveedorNombre}`,
        html: `<div style="text-align:left;"><p><b>Fecha:</b> ${o.createdAt ? new Date(o.createdAt.toDate()).toLocaleString() : ''}</p><p><b>Estado:</b> ${o.estado}</p><p><b>Total:</b> $${(o.total || 0).toFixed(2)}</p><ul style="margin-top:10px;">${itemsHtml}</ul></div>`,
        width: 500
    });
}

// =====================================================
// TIENDA ONLINE
// =====================================================
function getStoreCatalogUrl() {
    const origin = window.location.origin;
    let path = window.location.pathname;
    if (path.endsWith('index.html')) path = path.slice(0, -10);
    else if (!path.endsWith('/')) path = path.substring(0, path.lastIndexOf('/') + 1);
    const negocioParam = currentNegocioId || 'bodega-demo';
    return `${origin}${path}catalogo.html?negocio=${encodeURIComponent(negocioParam)}`;
}

function openTiendaOnlineModal() {
    const url = getStoreCatalogUrl();
    const input = document.getElementById('tienda-url-input');
    if (input) input.value = url;
    const qrContainer = document.getElementById('tienda-qr-target');
    if (qrContainer) {
        qrContainer.innerHTML = '';
        if (window.QRCode) {
            try {
                new QRCode(qrContainer, {
                    text: url, width: 160, height: 160,
                    colorDark: "#0f172a", colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.M
                });
            } catch (e) {
                qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}" class="w-40 h-40">`;
            }
        } else {
            qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}" class="w-40 h-40">`;
        }
    }
    const m = document.getElementById('tienda-online-modal');
    const c = document.getElementById('tienda-online-modal-content');
    if (m && c) {
        m.classList.remove('hidden');
        setTimeout(() => {
            m.classList.remove('opacity-0');
            c.classList.remove('scale-95');
        }, 10);
    }
}

function closeTiendaOnlineModal() {
    const m = document.getElementById('tienda-online-modal');
    const c = document.getElementById('tienda-online-modal-content');
    if (m && c) {
        m.classList.add('opacity-0');
        c.classList.add('scale-95');
        setTimeout(() => m.classList.add('hidden'), 300);
    }
}

function copiarEnlaceTienda() {
    const url = getStoreCatalogUrl();
    navigator.clipboard.writeText(url).then(() => {
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: '¡Enlace copiado!', timer: 2000, showConfirmButton: false });
    }).catch(() => {
        Swal.fire('Enlace', url, 'info');
    });
}

function abrirTiendaEnNuevaPestana() {
    window.open(getStoreCatalogUrl(), '_blank');
}

function compartirTiendaWhatsApp() {
    const url = getStoreCatalogUrl();
    const nombre = storeConfig.name || 'Nuestra Tienda';
    const msg = `👋 ¡Hola! Te invito a conocer nuestro catálogo de *${nombre}*.\n\n👉 ${url}\n\n¡Haz tus pedidos!`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

function imprimirCartelQR() {
    const url = getStoreCatalogUrl();
    const storeName = storeConfig.name || 'Nuestra Tienda';
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}`;
    const cartelHtml = `
        <div style="text-align: center; font-family: 'Plus Jakarta Sans', Arial, sans-serif; padding: 15px; border: 2px dashed #000; border-radius: 15px; width: 80mm; margin: 0 auto; box-sizing: border-box;">
            ${storeConfig.logo ? `<img src="${storeConfig.logo}" style="max-height: 50px; margin: 0 auto 10px auto; display: block;">` : ''}
            <h1 style="font-size: 18px; font-weight: 900; margin: 0 0 5px 0; text-transform: uppercase;">${storeName}</h1>
            <p style="font-size: 12px; font-weight: bold; margin: 0 0 10px 0;">¡CATÁLOGO DIGITAL!</p>
            <div style="background: #fff; padding: 8px; display: inline-block; border: 1px solid #ddd; border-radius: 10px;">
                <img src="${qrImgUrl}" style="width: 160px; height: 160px; display: block; margin: 0 auto;" alt="QR">
            </div>
            <p style="font-size: 11px; font-weight: bold; margin: 12px 0 4px 0;">📲 ESCANEA CON TU CÁMARA</p>
            <p style="font-size: 10px; margin: 0;">Haz pedidos directo a WhatsApp.</p>
            <div style="margin-top: 12px; border-top: 1px solid #ccc; padding-top: 6px; font-size: 9px; font-family: monospace; word-break: break-all;">${url}</div>
        </div>`;

    imprimirTicketAislado(cartelHtml, { width: '80mm' });
}

// =====================================================
// SUGERENCIAS IA
// =====================================================
function abrirSugerenciasComprasModal() {
    try { calcularSugerenciasCompras(); } catch (err) { console.error(err); }
    const m = document.getElementById('sugerencias-compras-modal');
    const c = document.getElementById('sugerencias-compras-modal-content');
    if (m && c) {
        m.classList.remove('hidden');
        setTimeout(() => {
            m.classList.remove('opacity-0');
            c.classList.remove('scale-95');
        }, 10);
    }
}

function closeSugerenciasComprasModal() {
    const m = document.getElementById('sugerencias-compras-modal');
    const c = document.getElementById('sugerencias-compras-modal-content');
    if (m && c) {
        m.classList.add('opacity-0');
        c.classList.add('scale-95');
        setTimeout(() => m.classList.add('hidden'), 300);
    }
}

function calcularSugerenciasCompras() {
    const ventasPorProducto = {};
    const hoy = new Date();
    const hace14Dias = new Date(hoy.getTime() - (14 * 24 * 60 * 60 * 1000));
    salesHistory.forEach(s => {
        let fechaVenta = new Date();
        if (s.timestamp && typeof s.timestamp.toDate === 'function') {
            try { fechaVenta = s.timestamp.toDate(); } catch (e) {}
        } else if (s.fechaStr) {
            const parsed = new Date(s.fechaStr);
            if (!isNaN(parsed.getTime())) fechaVenta = parsed;
        }
        if (fechaVenta >= hace14Dias && s.items) {
            s.items.forEach(i => {
                const id = i.id || i.nombre;
                if (!ventasPorProducto[id]) ventasPorProducto[id] = 0;
                ventasPorProducto[id] += parseFloat(i.qty || 0);
            });
        }
    });
    const diasAnalisis = 14;
    sugerenciasData = [];
    let criticos = 0, medios = 0, inversionTotal = 0, sinCostoCount = 0;
    products.forEach(p => {
        const stockActual = parseFloat(p.stock || 0);
        // Costo REAL. Antes se inventaba un 75% del precio de venta cuando el
        // producto no tenía costo, y esa cifra entraba en la "inversión
        // estimada" que se le muestra al dueño para salir a comprar.
        const costoCapturado = parseFloat(p.costo);
        const tieneCosto = !Number.isNaN(costoCapturado) && costoCapturado > 0;
        const costo = tieneCosto ? costoCapturado : 0;
        const totalVendido = ventasPorProducto[p.id] || ventasPorProducto[p.nombre] || 0;
        const ritmoDiario = totalVendido / diasAnalisis;
        let diasRestantes = 999;
        if (ritmoDiario > 0) diasRestantes = Math.max(0, stockActual / ritmoDiario);
        else if (stockActual <= 0) diasRestantes = 0;
        let cantSugerida = 0;
        if (ritmoDiario > 0) {
            cantSugerida = Math.max(0, Math.ceil((ritmoDiario * 15) - stockActual));
        } else if (stockActual <= (p.stockMinimo || 3)) {
            cantSugerida = Math.max(0, 12 - stockActual);
        }
        let nivel = 'optimo';
        if (stockActual <= 0 || diasRestantes < 3) { nivel = 'critico'; criticos++; }
        else if (diasRestantes <= 7 || stockActual <= (p.stockMinimo || 5)) { nivel = 'medio'; medios++; }
        if (cantSugerida > 0 || nivel === 'critico' || nivel === 'medio') {
            const costoEstimado = cantSugerida * costo;
            inversionTotal += costoEstimado;
            if (!tieneCosto) sinCostoCount++;
            sugerenciasData.push({
                id: p.id, codigo: p.codigo || '', nombre: p.nombre,
                categoria: p.categoria || 'General', tipo: p.tipo || 'unid',
                stockActual, ritmoDiario, diasRestantes, cantSugerida,
                costo, costoEstimado, tieneCosto, nivel, selected: true
            });
        }
    });
    sugerenciasData.sort((a, b) => {
        if (a.nivel === 'critico' && b.nivel !== 'critico') return -1;
        if (a.nivel !== 'critico' && b.nivel === 'critico') return 1;
        return a.diasRestantes - b.diasRestantes;
    });
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('sug-metric-criticos', criticos);
    setTxt('sug-metric-medio', medios);
    setTxt('sug-metric-inversion', `$${inversionTotal.toFixed(2)}`);
    // La inversión estimada es un PISO: no incluye los productos sin costo.
    // Se dice explícitamente en vez de rellenar el hueco con un costo inventado.
    const elInv = document.getElementById('sug-metric-inversion');
    if (elInv) {
        elInv.title = sinCostoCount > 0
            ? `${sinCostoCount} producto(s) sugerido(s) no tienen costo capturado y quedan fuera de esta estimación.`
            : 'Todos los productos sugeridos tienen costo capturado.';
    }
    const notaInv = document.getElementById('sug-metric-inversion-nota');
    if (notaInv) {
        if (sinCostoCount > 0) {
            notaInv.textContent = `+ ${sinCostoCount} sin costo capturado`;
            notaInv.classList.remove('hidden');
        } else {
            notaInv.textContent = '';
            notaInv.classList.add('hidden');
        }
    }
    renderSugerenciasTable();
}

function renderSugerenciasTable() {
    const tbody = document.getElementById('sugerencias-table-body');
    if (!tbody) return;
    if (sugerenciasData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 font-bold">Inventario óptimo</td></tr>`;
        actualizarSelectedCountSugerencias();
        return;
    }
    tbody.innerHTML = sugerenciasData.map((item, idx) => {
        let badge = '';
        if (item.nivel === 'critico') badge = `<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-black text-[10px]"><i class="fa-solid fa-triangle-exclamation"></i> ${item.diasRestantes < 1 ? 'Agotado' : item.diasRestantes.toFixed(1) + 'd'}</span>`;
        else if (item.nivel === 'medio') badge = `<span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-black text-[10px]"><i class="fa-solid fa-clock"></i> ${item.diasRestantes.toFixed(1)}d</span>`;
        else badge = `<span class="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-black text-[10px]">${item.diasRestantes.toFixed(1)}d</span>`;
        const ritmoText = item.ritmoDiario > 0 ? `${item.ritmoDiario.toFixed(1)} ${item.tipo}/día` : 'Sin rotación';
        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="p-3 text-center"><input type="checkbox" ${item.selected ? 'checked' : ''} onchange="toggleSugerenciaItem(${idx}, this.checked)"></td>
                <td class="p-3"><div class="font-extrabold text-slate-800">${item.nombre}</div><div class="text-[10px] text-slate-400">${item.categoria} ${item.codigo ? '• ' + item.codigo : ''}</div></td>
                <td class="p-3 text-right font-bold">${item.stockActual} <span class="text-[10px] text-slate-400">${item.tipo}</span></td>
                <td class="p-3 text-right text-slate-500 font-medium text-xs">${ritmoText}</td>
                <td class="p-3 text-center">${badge}</td>
                <td class="p-3 text-right"><input type="number" min="1" step="1" value="${item.cantSugerida}" onchange="updateSugerenciaQty(${idx}, this.value)" class="w-20 p-1.5 text-right bg-slate-100 border border-slate-200 rounded-lg font-bold text-xs"></td>
                <td class="p-3 text-right font-black">${item.tieneCosto
                    ? '$' + item.costoEstimado.toFixed(2)
                    : '<span class="text-rose-500 font-bold text-[10px]" title="Este producto no tiene costo capturado, así que no entra en la inversión estimada. Captúralo para que el cálculo sea exacto.">sin costo</span>'}</td>
            </tr>`;
    }).join('');
    actualizarSelectedCountSugerencias();
}

function toggleSugerenciaItem(idx, checked) {
    if (sugerenciasData[idx]) {
        sugerenciasData[idx].selected = checked;
        actualizarSelectedCountSugerencias();
    }
}

function updateSugerenciaQty(idx, val) {
    const q = parseFloat(val) || 0;
    if (sugerenciasData[idx]) {
        sugerenciasData[idx].cantSugerida = q;
        sugerenciasData[idx].costoEstimado = q * (sugerenciasData[idx].costo || 0);
        renderSugerenciasTable();
    }
}

function actualizarSelectedCountSugerencias() {
    const selected = sugerenciasData.filter(i => i.selected);
    const countEl = document.getElementById('sug-selected-count');
    if (countEl) countEl.textContent = selected.length;
}

function copiarPedidoProveedor() {
    const selected = sugerenciasData.filter(i => i.selected && i.cantSugerida > 0);
    if (selected.length === 0) return Swal.fire('Atención', 'Selecciona productos', 'warning');
    const storeName = storeConfig.name || 'Nuestra Bodega';
    const fecha = new Date().toLocaleDateString('es-VE');
    let text = `📦 *PEDIDO - ${storeName.toUpperCase()}*\n📅 ${fecha}\n---\n`;
    selected.forEach(i => { text += `• ${i.nombre}: *${i.cantSugerida} ${i.tipo}*\n`; });
    const totalEst = selected.reduce((sum, i) => sum + i.costoEstimado, 0);
    text += `---\nTotal estimado: $${totalEst.toFixed(2)}`;
    navigator.clipboard.writeText(text).then(() => {
        Swal.fire('¡Copiado!', 'Lista lista para WhatsApp', 'success');
    });
}

function enviarPedidoProveedorWhatsApp() {
    const selected = sugerenciasData.filter(i => i.selected && i.cantSugerida > 0);
    if (selected.length === 0) return Swal.fire('Atención', 'Selecciona productos', 'warning');
    const storeName = storeConfig.name || 'Nuestra Bodega';
    let text = `📦 *PEDIDO - ${storeName.toUpperCase()}*\n`;
    selected.forEach(i => { text += `• ${i.nombre}: *${i.cantSugerida} ${i.tipo}*\n`; });
    let optionsHtml = '';
    if (proveedores.length > 0) {
        optionsHtml = proveedores.map(p => `<option value="${p.telefono || ''}">${p.nombre}</option>`).join('');
    }
    Swal.fire({
        title: 'Enviar por WhatsApp',
        html: `
            ${proveedores.length > 0 ? `<select id="swal-prov-select" class="w-full p-2.5 bg-slate-100 rounded-xl mb-3 text-xs" onchange="document.getElementById('swal-prov-phone').value = this.value"><option value="">Proveedor...</option>${optionsHtml}</select>` : ''}
            <input type="text" id="swal-prov-phone" placeholder="584121234567" class="w-full p-2.5 border border-slate-200 rounded-xl text-xs">
        `,
        showCancelButton: true,
        confirmButtonText: 'Abrir WhatsApp',
        confirmButtonColor: '#10b981',
        preConfirm: () => {
            const phone = normalizarTelefono(document.getElementById('swal-prov-phone').value);
            if (!phone || phone.length < 8) { Swal.showValidationMessage('Escribe un número de teléfono válido'); return false; }
            return phone;
        }
    }).then(r => {
        if (r.isConfirmed && r.value) {
            window.open(enlaceWhatsApp(r.value, text), '_blank');
        }
    });
}

function cargarPedidoACompras() {
    const selected = sugerenciasData.filter(i => i.selected && i.cantSugerida > 0);
    if (selected.length === 0) return Swal.fire('Atención', 'Selecciona productos', 'warning');
    closeSugerenciasComprasModal();
    switchTab('compras');
    if (typeof openOrdenCompraModal === 'function') openOrdenCompraModal();
    currentOrdenItems = selected.map(i => ({
        productoId: i.id, productoNombre: i.nombre,
        cantidad: i.cantSugerida, costoUnitario: i.costo || 0
    }));
    if (typeof renderOrdenItemsUI === 'function') renderOrdenItemsUI();
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: `${selected.length} productos cargados`, timer: 2500, showConfirmButton: false });
}

// =====================================================
// LIBRO FISCAL SENIAT
// =====================================================
function openLibroVentasModal() {
    if (!isAdmin) return;
    const hoy = new Date();
    const selMes = document.getElementById('libro-mes');
    const selAnio = document.getElementById('libro-anio');
    if (selMes) selMes.value = hoy.getMonth();
    if (selAnio) selAnio.value = hoy.getFullYear();
    renderLibroVentas();
    const m = document.getElementById('libro-ventas-modal');
    const c = document.getElementById('libro-ventas-modal-content');
    if (m && c) {
        m.classList.remove('hidden');
        setTimeout(() => {
            m.classList.remove('opacity-0');
            c.classList.remove('scale-95');
        }, 10);
    }
}

function closeLibroVentasModal() {
    const m = document.getElementById('libro-ventas-modal');
    const c = document.getElementById('libro-ventas-modal-content');
    if (m && c) {
        m.classList.add('opacity-0');
        c.classList.add('scale-95');
        setTimeout(() => m.classList.add('hidden'), 300);
    }
}

function renderLibroVentas() {
    const mes = parseInt(document.getElementById('libro-mes')?.value || new Date().getMonth());
    const anio = parseInt(document.getElementById('libro-anio')?.value || new Date().getFullYear());
    libroVentasData = [];
    let correlativo = storeConfig.nroFactura || 1001;
    let totalFacturadoBs = 0, totalExentoBs = 0, totalBaseBs = 0, totalIvaBs = 0, totalFacturadoUsd = 0;
    salesHistory.forEach(s => {
        let fecha = new Date();
        if (s.timestamp && typeof s.timestamp.toDate === 'function') {
            try { fecha = s.timestamp.toDate(); } catch (e) {}
        } else if (s.fechaStr) {
            const parsed = new Date(s.fechaStr);
            if (!isNaN(parsed.getTime())) fecha = parsed;
        }
        if (fecha.getMonth() === mes && fecha.getFullYear() === anio) {
            const tasa = s.tasaBCV || rates.bcv || 36.5;
            const montoTotalUsd = parseFloat(s.totalUsd || s.total || 0);
            const montoTotalBs = montoTotalUsd * tasa;
            let exentoBs = 0, gravadoBs = 0;
            if (s.items && Array.isArray(s.items)) {
                s.items.forEach(i => {
                    const itemTotalBs = (parseFloat(i.qty || 1) * parseFloat(i.precio || 0)) * tasa;
                    const cat = (i.categoria || '').toLowerCase();
                    if (cat.includes('charcuter') || cat.includes('carne') || cat.includes('pollo') || cat.includes('vívere') || cat.includes('verdura')) {
                        exentoBs += itemTotalBs;
                    } else {
                        gravadoBs += itemTotalBs;
                    }
                });
            } else {
                exentoBs = montoTotalBs * 0.6;
                gravadoBs = montoTotalBs * 0.4;
            }
            const baseImponibleBs = gravadoBs / 1.16;
            const ivaBs = gravadoBs - baseImponibleBs;
            totalFacturadoBs += montoTotalBs;
            totalExentoBs += exentoBs;
            totalBaseBs += baseImponibleBs;
            totalIvaBs += ivaBs;
            totalFacturadoUsd += montoTotalUsd;
            libroVentasData.push({
                op: libroVentasData.length + 1,
                fecha: fecha.toLocaleDateString('es-VE'),
                nroFactura: s.nroFactura || correlativo++,
                nroControl: s.nroControl || `00-${String(correlativo - 1).padStart(6, '0')}`,
                rif: s.clienteRif || s.clienteCedula || 'V-00000000-0',
                cliente: s.clienteNombre || 'CLIENTE CONTADO',
                totalBs: montoTotalBs, exentoBs, baseBs: baseImponibleBs, ivaBs, totalUsd: montoTotalUsd
            });
        }
    });
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('libro-total-ventas', `Bs ${totalFacturadoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTxt('libro-total-usd', `$${totalFacturadoUsd.toFixed(2)} USD`);
    setTxt('libro-total-exento', `Bs ${totalExentoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTxt('libro-total-base', `Bs ${totalBaseBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTxt('libro-total-iva', `Bs ${totalIvaBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTxt('libro-operaciones-count', libroVentasData.length);
    const tbody = document.getElementById('libro-table-body');
    if (!tbody) return;
    if (libroVentasData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400">Sin operaciones</td></tr>`;
        return;
    }
    tbody.innerHTML = libroVentasData.map(r => `
        <tr class="hover:bg-slate-50 transition-colors">
            <td class="p-2.5 text-center font-bold text-slate-400">${r.op}</td>
            <td class="p-2.5 font-medium">${r.fecha}</td>
            <td class="p-2.5 font-bold font-mono">${r.nroFactura}</td>
            <td class="p-2.5 font-mono text-slate-500">${r.nroControl}</td>
            <td class="p-2.5 font-mono font-bold">${r.rif}</td>
            <td class="p-2.5 font-bold truncate max-w-[160px]">${r.cliente}</td>
            <td class="p-2.5 text-right font-black">${r.totalBs.toFixed(2)}</td>
            <td class="p-2.5 text-right font-medium text-emerald-700">${r.exentoBs.toFixed(2)}</td>
            <td class="p-2.5 text-right font-medium text-blue-700">${r.baseBs.toFixed(2)}</td>
            <td class="p-2.5 text-right font-bold text-indigo-700">${r.ivaBs.toFixed(2)}</td>
        </tr>
    `).join('');
}

function exportarLibroVentasExcel() {
    if (typeof XLSX === 'undefined') return Swal.fire('Error', 'Librería XLSX no cargada', 'error');
    if (libroVentasData.length === 0) return Swal.fire('Sin datos', 'No hay registros', 'info');
    const mesEl = document.getElementById('libro-mes');
    const anioEl = document.getElementById('libro-anio');
    const mesNombre = mesEl ? mesEl.options[mesEl.selectedIndex].text : 'Mes';
    const anio = anioEl ? anioEl.value : '2026';
    const storeName = storeConfig.name || 'Mi Negocio';
    const storeRif = storeConfig.rif || 'J-00000000-0';
    const dataForSheet = [
        ['LIBRO DE VENTAS SENIAT'],
        [`RAZÓN SOCIAL: ${storeName}`],
        [`RIF: ${storeRif}`],
        [`PERÍODO: ${mesNombre.toUpperCase()} ${anio}`],
        [],
        ['N° Op', 'Fecha', 'N° Factura', 'N° Control', 'RIF/C.I.', 'Cliente', 'Total (Bs)', 'Exento', 'Base Imp.', '% IVA', 'IVA (Bs)']
    ];
    libroVentasData.forEach(r => {
        dataForSheet.push([r.op, r.fecha, r.nroFactura, r.nroControl, r.rif, r.cliente,
            parseFloat(r.totalBs.toFixed(2)), parseFloat(r.exentoBs.toFixed(2)),
            parseFloat(r.baseBs.toFixed(2)), '16%', parseFloat(r.ivaBs.toFixed(2))]);
    });
    const sumTotal = libroVentasData.reduce((s, r) => s + r.totalBs, 0);
    const sumExento = libroVentasData.reduce((s, r) => s + r.exentoBs, 0);
    const sumBase = libroVentasData.reduce((s, r) => s + r.baseBs, 0);
    const sumIva = libroVentasData.reduce((s, r) => s + r.ivaBs, 0);
    dataForSheet.push([], ['TOTALES', '', '', '', '', '',
        parseFloat(sumTotal.toFixed(2)), parseFloat(sumExento.toFixed(2)),
        parseFloat(sumBase.toFixed(2)), '', parseFloat(sumIva.toFixed(2))]);
    const ws = XLSX.utils.aoa_to_sheet(dataForSheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Libro Ventas");
    XLSX.writeFile(wb, `Libro_Ventas_SENIAT_${mesNombre}_${anio}.xlsx`);
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Libro exportado', timer: 2500, showConfirmButton: false });
}

function imprimirLibroVentas() {
    if (libroVentasData.length === 0) return Swal.fire('Sin datos', '', 'info');
    const mesEl = document.getElementById('libro-mes');
    const anioEl = document.getElementById('libro-anio');
    const mesNombre = mesEl ? mesEl.options[mesEl.selectedIndex].text : 'Mes';
    const anio = anioEl ? anioEl.value : '2026';
    const sumTotal = libroVentasData.reduce((s, r) => s + r.totalBs, 0);
    const sumExento = libroVentasData.reduce((s, r) => s + r.exentoBs, 0);
    const sumBase = libroVentasData.reduce((s, r) => s + r.baseBs, 0);
    const sumIva = libroVentasData.reduce((s, r) => s + r.ivaBs, 0);
    const libroHtml = `
        <div style="font-family: Arial, sans-serif; font-size: 11px; padding: 10px; width: 100%;">
            <div style="text-align: center; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 10px;">
                <h2 style="margin: 0; font-size: 16px;">${storeConfig.name.toUpperCase()}</h2>
                <p style="margin: 2px 0;">RIF: ${storeConfig.rif || 'J-00000000-0'}</p>
                <h3 style="margin: 5px 0 0 0; font-size: 13px;">LIBRO DE VENTAS (SENIAT)</h3>
                <p style="margin: 2px 0; font-weight: bold;">Período: ${mesNombre.toUpperCase()} ${anio}</p>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
                <thead>
                    <tr style="border-bottom: 1px solid #000; text-align: left;">
                        <th style="padding: 3px;">N°</th>
                        <th style="padding: 3px;">Fecha</th>
                        <th style="padding: 3px;">Factura</th>
                        <th style="padding: 3px;">RIF</th>
                        <th style="padding: 3px;">Cliente</th>
                        <th style="padding: 3px; text-align: right;">Total</th>
                        <th style="padding: 3px; text-align: right;">Exento</th>
                        <th style="padding: 3px; text-align: right;">Base</th>
                        <th style="padding: 3px; text-align: right;">IVA</th>
                    </tr>
                </thead>
                <tbody>
                    ${libroVentasData.map(r => `
                        <tr style="border-bottom: 1px dotted #ccc;">
                            <td style="padding: 3px;">${r.op}</td>
                            <td style="padding: 3px;">${r.fecha}</td>
                            <td style="padding: 3px;">${r.nroFactura}</td>
                            <td style="padding: 3px;">${r.rif}</td>
                            <td style="padding: 3px;">${r.cliente}</td>
                            <td style="padding: 3px; text-align: right;">${r.totalBs.toFixed(2)}</td>
                            <td style="padding: 3px; text-align: right;">${r.exentoBs.toFixed(2)}</td>
                            <td style="padding: 3px; text-align: right;">${r.baseBs.toFixed(2)}</td>
                            <td style="padding: 3px; text-align: right;">${r.ivaBs.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                    <tr style="border-top: 2px solid #000; font-weight: bold;">
                        <td colspan="5" style="padding: 5px 3px;">TOTALES</td>
                        <td style="padding: 5px 3px; text-align: right;">Bs ${sumTotal.toFixed(2)}</td>
                        <td style="padding: 5px 3px; text-align: right;">Bs ${sumExento.toFixed(2)}</td>
                        <td style="padding: 5px 3px; text-align: right;">Bs ${sumBase.toFixed(2)}</td>
                        <td style="padding: 5px 3px; text-align: right;">Bs ${sumIva.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
        </div>`;

    imprimirTicketAislado(libroHtml, { width: '210mm', landscape: true });
}

// =====================================================
// CATÁLOGO MAESTRO - PRODUCTOS TOP MERCADO VENEZOLANO
// =====================================================
// CATÁLOGO MAESTRO VENEZOLANO AMPLIADO (145+ PRODUCTOS TOP)
// =====================================================
const VENEZUELA_MASTER_CATALOG = [
    // --- VÍVERES Y DESPENSA ---
    { codigo: "CAT-VIV-001", nombre: "Harina P.A.N. Blanca 1 Kg", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.10, precioSugerido: 1.45, stockInicial: 30 },
    { codigo: "CAT-VIV-002", nombre: "Harina P.A.N. Amarilla 1 Kg", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.15, precioSugerido: 1.50, stockInicial: 24 },
    { codigo: "CAT-VIV-003", nombre: "Harina P.A.N. Mezcla Integral 1 Kg", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.30, precioSugerido: 1.70, stockInicial: 15 },
    { codigo: "CAT-VIV-004", nombre: "Harina de Maíz Kaly 1 Kg", marca: "Kaly", categoria: "Víveres", tipo: "Unidad", costoEstimado: 0.95, precioSugerido: 1.25, stockInicial: 30 },
    { codigo: "CAT-VIV-005", nombre: "Harina de Trigo Robin Hood Leudante 1 Kg", marca: "Robin Hood", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.35, precioSugerido: 1.75, stockInicial: 24 },
    { codigo: "CAT-VIV-006", nombre: "Harina de Trigo Robin Hood Todo Uso 1 Kg", marca: "Robin Hood", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.30, precioSugerido: 1.70, stockInicial: 24 },
    { codigo: "CAT-VIV-007", nombre: "Harina de Trigo Todo Uso Ronco 1 Kg", marca: "Ronco", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.25, precioSugerido: 1.65, stockInicial: 20 },
    { codigo: "CAT-VIV-008", nombre: "Avena en Hojuelas Quaker 400g", marca: "Quaker", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.20, precioSugerido: 1.60, stockInicial: 24 },
    { codigo: "CAT-VIV-009", nombre: "Avena Molida Quaker 400g", marca: "Quaker", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.20, precioSugerido: 1.60, stockInicial: 24 },
    { codigo: "CAT-VIV-010", nombre: "Arroz Blanco Primor Clásico 1 Kg", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.20, precioSugerido: 1.55, stockInicial: 30 },
    { codigo: "CAT-VIV-011", nombre: "Arroz Mary Esmeralda Tipo 1 1 Kg", marca: "Mary", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.15, precioSugerido: 1.50, stockInicial: 30 },
    { codigo: "CAT-VIV-012", nombre: "Arroz Blanco Kaly Tradicional 1 Kg", marca: "Kaly", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.05, precioSugerido: 1.35, stockInicial: 30 },
    { codigo: "CAT-VIV-013", nombre: "Pasta Primor Espagueti 1 Kg", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.35, precioSugerido: 1.75, stockInicial: 24 },
    { codigo: "CAT-VIV-014", nombre: "Pasta Capri Plumitas 1 Kg", marca: "Capri", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.30, precioSugerido: 1.70, stockInicial: 20 },
    { codigo: "CAT-VIV-015", nombre: "Pasta Mary Corta Tornillo 1 Kg", marca: "Mary", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.25, precioSugerido: 1.65, stockInicial: 20 },
    { codigo: "CAT-VIV-016", nombre: "Pasta Ronco Espagueti Largo 1 Kg", marca: "Ronco", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.30, precioSugerido: 1.70, stockInicial: 20 },
    { codigo: "CAT-VIV-017", nombre: "Pasta Sindoni Coditos 1 Kg", marca: "Sindoni", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.20, precioSugerido: 1.60, stockInicial: 20 },
    { codigo: "CAT-VIV-018", nombre: "Aceite Vegetal Vatel 1 Lt", marca: "Cargill", categoria: "Víveres", tipo: "Unidad", costoEstimado: 2.10, precioSugerido: 2.70, stockInicial: 15 },
    { codigo: "CAT-VIV-019", nombre: "Aceite Vegetal Mary Soya 1 Lt", marca: "Mary", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.95, precioSugerido: 2.50, stockInicial: 15 },
    { codigo: "CAT-VIV-020", nombre: "Aceite Vegetal Kaly 900ml", marca: "Kaly", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.90, precioSugerido: 2.45, stockInicial: 15 },
    { codigo: "CAT-VIV-021", nombre: "Margarina Mavesa con Sal 500g", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.80, precioSugerido: 2.30, stockInicial: 24 },
    { codigo: "CAT-VIV-022", nombre: "Margarina Mirasol 500g", marca: "Cargill", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.70, precioSugerido: 2.20, stockInicial: 18 },
    { codigo: "CAT-VIV-023", nombre: "Mayonesa Mavesa Tradicional 445g", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 2.20, precioSugerido: 2.85, stockInicial: 16 },
    { codigo: "CAT-VIV-024", nombre: "Mayonesa Kraft Clásica 445g", marca: "Kraft", categoria: "Víveres", tipo: "Unidad", costoEstimado: 2.40, precioSugerido: 3.10, stockInicial: 14 },
    { codigo: "CAT-VIV-025", nombre: "Salsa de Tomate Ketchup Pampero 397g", marca: "Pampero", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.40, precioSugerido: 1.85, stockInicial: 20 },
    { codigo: "CAT-VIV-026", nombre: "Salsa de Tomate Heinz 397g", marca: "Heinz", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.65, precioSugerido: 2.20, stockInicial: 18 },
    { codigo: "CAT-VIV-027", nombre: "Mostaza Mavesa Frasco 250g", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.10, precioSugerido: 1.50, stockInicial: 16 },
    { codigo: "CAT-VIV-028", nombre: "Salsa de Soya Iberia 150ml", marca: "Iberia", categoria: "Víveres", tipo: "Unidad", costoEstimado: 0.85, precioSugerido: 1.20, stockInicial: 20 },
    { codigo: "CAT-VIV-029", nombre: "Salsa Inglesa Iberia 150ml", marca: "Iberia", categoria: "Víveres", tipo: "Unidad", costoEstimado: 0.85, precioSugerido: 1.20, stockInicial: 20 },
    { codigo: "CAT-VIV-030", nombre: "Adobo La Comadre con Pimienta 200g", marca: "La Comadre", categoria: "Víveres", tipo: "Unidad", costoEstimado: 0.95, precioSugerido: 1.35, stockInicial: 30 },
    { codigo: "CAT-VIV-031", nombre: "Cubitos de Pollo Maggi Cajita 6 un.", marca: "Nestlé", categoria: "Víveres", tipo: "Unidad", costoEstimado: 0.80, precioSugerido: 1.15, stockInicial: 40 },
    { codigo: "CAT-VIV-032", nombre: "Diablitos Underwood Jamón Endiablado 120g", marca: "Underwood", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.60, precioSugerido: 2.10, stockInicial: 36 },
    { codigo: "CAT-VIV-033", nombre: "Diablitos Underwood Mini 54g", marca: "Underwood", categoria: "Víveres", tipo: "Unidad", costoEstimado: 0.85, precioSugerido: 1.20, stockInicial: 48 },
    { codigo: "CAT-VIV-034", nombre: "Atún Margarita en Aceite 140g", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.60, precioSugerido: 2.10, stockInicial: 24 },
    { codigo: "CAT-VIV-035", nombre: "Atún Margarita al Natural 140g", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.60, precioSugerido: 2.10, stockInicial: 24 },
    { codigo: "CAT-VIV-036", nombre: "Sardinas en Tomate La Gaviota 170g", marca: "La Gaviota", categoria: "Víveres", tipo: "Unidad", costoEstimado: 0.80, precioSugerido: 1.15, stockInicial: 30 },
    { codigo: "CAT-VIV-037", nombre: "Caraotas Negras Mary Seleccionadas 500g", marca: "Mary", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.10, precioSugerido: 1.50, stockInicial: 24 },
    { codigo: "CAT-VIV-038", nombre: "Caraotas Rojas Mary Seleccionadas 500g", marca: "Mary", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.20, precioSugerido: 1.60, stockInicial: 20 },
    { codigo: "CAT-VIV-039", nombre: "Lentejas Mary Tipo 1 500g", marca: "Mary", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.15, precioSugerido: 1.55, stockInicial: 20 },
    { codigo: "CAT-VIV-040", nombre: "Garbanzos Mary Seleccionados 500g", marca: "Mary", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.30, precioSugerido: 1.75, stockInicial: 16 },
    { codigo: "CAT-VIV-041", nombre: "Azúcar Refinada Montalbán 1 Kg", marca: "Montalbán", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.30, precioSugerido: 1.65, stockInicial: 35 },
    { codigo: "CAT-VIV-042", nombre: "Sal Marina Refinada Montalbán 1 Kg", marca: "Montalbán", categoria: "Víveres", tipo: "Unidad", costoEstimado: 0.50, precioSugerido: 0.75, stockInicial: 30 },
    { codigo: "CAT-VIV-043", nombre: "Café Fama de América Clásico 250g", marca: "Fama de América", categoria: "Víveres", tipo: "Unidad", costoEstimado: 2.10, precioSugerido: 2.75, stockInicial: 25 },
    { codigo: "CAT-VIV-044", nombre: "Café Madrid Tostado y Molido 250g", marca: "Fama de América", categoria: "Víveres", tipo: "Unidad", costoEstimado: 2.00, precioSugerido: 2.60, stockInicial: 25 },
    { codigo: "CAT-VIV-045", nombre: "Café El Peñón Tostado y Molido 250g", marca: "El Peñón", categoria: "Víveres", tipo: "Unidad", costoEstimado: 1.95, precioSugerido: 2.55, stockInicial: 20 },
    { codigo: "CAT-VIV-046", nombre: "Rikesa Untable Cheddar 300g", marca: "Polar", categoria: "Víveres", tipo: "Unidad", costoEstimado: 2.60, precioSugerido: 3.40, stockInicial: 16 },
    { codigo: "CAT-VIV-047", nombre: "Cheez Whiz Kraft Frasco 300g", marca: "Kraft", categoria: "Víveres", tipo: "Unidad", costoEstimado: 2.80, precioSugerido: 3.65, stockInicial: 14 },
    { codigo: "CAT-VIV-048", nombre: "Vinagre Blanco Los Andes 500ml", marca: "Los Andes", categoria: "Víveres", tipo: "Unidad", costoEstimado: 0.70, precioSugerido: 1.05, stockInicial: 20 },

    // --- LÁCTEOS Y HUEVOS ---
    { codigo: "CAT-LAC-001", nombre: "Cartón de Huevos Frescos (30 Unidades)", marca: "Del Campo", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 4.80, precioSugerido: 6.20, stockInicial: 25 },
    { codigo: "CAT-LAC-002", nombre: "Medio Cartón de Huevos (15 Unidades)", marca: "Del Campo", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 2.50, precioSugerido: 3.25, stockInicial: 20 },
    { codigo: "CAT-LAC-003", nombre: "Leche en Polvo Completa La Campiña 1 Kg", marca: "La Campiña", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 7.50, precioSugerido: 9.20, stockInicial: 15 },
    { codigo: "CAT-LAC-004", nombre: "Leche en Polvo Completa Purísima 900g", marca: "Purísima", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 6.80, precioSugerido: 8.50, stockInicial: 12 },
    { codigo: "CAT-LAC-005", nombre: "Leche Líquida Pasteurizada Mi Vaca 1 Lt", marca: "Mi Vaca", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 1.50, precioSugerido: 2.00, stockInicial: 20 },
    { codigo: "CAT-LAC-006", nombre: "Leche Líquida Los Andes Completa 1 Lt", marca: "Los Andes", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 1.45, precioSugerido: 1.95, stockInicial: 20 },
    { codigo: "CAT-LAC-007", nombre: "Suero Criollo Carora Tradicional 1 Lt", marca: "Carora", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 1.60, precioSugerido: 2.20, stockInicial: 18 },
    { codigo: "CAT-LAC-008", nombre: "Suero Criollo La Pastoreña 1 Lt", marca: "La Pastoreña", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 1.55, precioSugerido: 2.15, stockInicial: 18 },
    { codigo: "CAT-LAC-009", nombre: "Natilla Criolla Paisa Pote 250g", marca: "Paisa", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 1.70, precioSugerido: 2.30, stockInicial: 15 },
    { codigo: "CAT-LAC-010", nombre: "Mantequilla Maracay con Sal 200g", marca: "Maracay", categoria: "Lácteos", tipo: "Unidad", costoEstimado: 1.65, precioSugerido: 2.25, stockInicial: 16 },
    { codigo: "CAT-LAC-011", nombre: "Queso Blanco Llanero Duro (Kg)", marca: "Del Campo", categoria: "Lácteos", tipo: "Kg", costoEstimado: 4.80, precioSugerido: 6.20, stockInicial: 25 },
    { codigo: "CAT-LAC-012", nombre: "Queso Blanco Palmita Fresco (Kg)", marca: "Del Campo", categoria: "Lácteos", tipo: "Kg", costoEstimado: 5.20, precioSugerido: 6.80, stockInicial: 15 },
    { codigo: "CAT-LAC-013", nombre: "Queso Blanco Telita / Guayanés (Kg)", marca: "Del Campo", categoria: "Lácteos", tipo: "Kg", costoEstimado: 5.50, precioSugerido: 7.20, stockInicial: 12 },
    { codigo: "CAT-LAC-014", nombre: "Queso Blanco Pasteurizado Paisa (Kg)", marca: "Paisa", categoria: "Lácteos", tipo: "Kg", costoEstimado: 8.20, precioSugerido: 10.50, stockInicial: 10 },
    { codigo: "CAT-LAC-015", nombre: "Queso Amarillo Tipo Gouda Torondoy (Kg)", marca: "Torondoy", categoria: "Lácteos", tipo: "Kg", costoEstimado: 8.90, precioSugerido: 11.50, stockInicial: 10 },
    { codigo: "CAT-LAC-016", nombre: "Queso Mozzarella Barra Torondoy (Kg)", marca: "Torondoy", categoria: "Lácteos", tipo: "Kg", costoEstimado: 7.80, precioSugerido: 9.90, stockInicial: 10 },

    // --- CARNES DE RES ---
    { codigo: "CAT-CAR-001", nombre: "Carne de Res — Solomo de Cuerito", marca: "Del Campo", categoria: "Carnes", tipo: "Kg", costoEstimado: 6.20, precioSugerido: 7.80, stockInicial: 15 },
    { codigo: "CAT-CAR-002", nombre: "Carne de Res — Punta Trasera", marca: "Del Campo", categoria: "Carnes", tipo: "Kg", costoEstimado: 7.50, precioSugerido: 9.50, stockInicial: 12 },
    { codigo: "CAT-CAR-003", nombre: "Carne de Res — Pulpa Negra / Bistec", marca: "Del Campo", categoria: "Carnes", tipo: "Kg", costoEstimado: 6.00, precioSugerido: 7.50, stockInicial: 20 },
    { codigo: "CAT-CAR-004", nombre: "Carne de Res — Molida de Primera", marca: "Del Campo", categoria: "Carnes", tipo: "Kg", costoEstimado: 5.20, precioSugerido: 6.50, stockInicial: 25 },
    { codigo: "CAT-CAR-005", nombre: "Carne de Res — Para Mechar (Falda)", marca: "Del Campo", categoria: "Carnes", tipo: "Kg", costoEstimado: 5.80, precioSugerido: 7.20, stockInicial: 18 },
    { codigo: "CAT-CAR-006", nombre: "Carne de Res — Costilla para Sopa", marca: "Del Campo", categoria: "Carnes", tipo: "Kg", costoEstimado: 3.50, precioSugerido: 4.80, stockInicial: 18 },
    { codigo: "CAT-CAR-007", nombre: "Carne de Res — Lagarto con Hueso", marca: "Del Campo", categoria: "Carnes", tipo: "Kg", costoEstimado: 3.20, precioSugerido: 4.50, stockInicial: 16 },

    // --- POLLO & MARCA QUÉ POLLO ---
    { codigo: "CAT-QP-001", nombre: "Pollo Entero Beneficiado Congelado Qué Pollo", marca: "Qué Pollo", categoria: "Pollo", tipo: "Kg", costoEstimado: 2.45, precioSugerido: 3.25, stockInicial: 40 },
    { codigo: "CAT-QP-002", nombre: "Pollo Entero Beneficiado Fresco Qué Pollo", marca: "Qué Pollo", categoria: "Pollo", tipo: "Kg", costoEstimado: 2.50, precioSugerido: 3.30, stockInicial: 35 },
    { codigo: "CAT-QP-003", nombre: "Milanesa de Pechuga Fileteada Qué Pollo", marca: "Qué Pollo", categoria: "Pollo", tipo: "Kg", costoEstimado: 5.30, precioSugerido: 6.90, stockInicial: 25 },
    { codigo: "CAT-QP-004", nombre: "Pechuga de Pollo con Hueso Qué Pollo", marca: "Qué Pollo", categoria: "Pollo", tipo: "Kg", costoEstimado: 3.70, precioSugerido: 4.90, stockInicial: 30 },
    { codigo: "CAT-QP-005", nombre: "Muslos de Pollo Enteros Qué Pollo", marca: "Qué Pollo", categoria: "Pollo", tipo: "Kg", costoEstimado: 2.65, precioSugerido: 3.45, stockInicial: 30 },
    { codigo: "CAT-QP-006", nombre: "Alas de Pollo Frescas Qué Pollo", marca: "Qué Pollo", categoria: "Pollo", tipo: "Kg", costoEstimado: 2.85, precioSugerido: 3.75, stockInicial: 20 },
    { codigo: "CAT-QP-007", nombre: "Nuggets de Pollo Qué Pollo Paquete 400g", marca: "Qué Pollo", categoria: "Pollo", tipo: "Unidad", costoEstimado: 2.40, precioSugerido: 3.20, stockInicial: 20 },
    { codigo: "CAT-QP-008", nombre: "Tenders / Deditos de Pollo Apanados Qué Pollo 500g", marca: "Qué Pollo", categoria: "Pollo", tipo: "Unidad", costoEstimado: 2.80, precioSugerido: 3.75, stockInicial: 18 },
    { codigo: "CAT-QP-009", nombre: "Salchichas de Pollo Qué Pollo Paquete 12 un.", marca: "Qué Pollo", categoria: "Charcutería", tipo: "Unidad", costoEstimado: 1.75, precioSugerido: 2.35, stockInicial: 25 },
    { codigo: "CAT-QP-010", nombre: "Mollejas de Pollo Limpias Qué Pollo", marca: "Qué Pollo", categoria: "Pollo", tipo: "Kg", costoEstimado: 1.60, precioSugerido: 2.30, stockInicial: 15 },
    { codigo: "CAT-POL-001", nombre: "Pollo Entero Beneficiado Fresco", marca: "Del Campo", categoria: "Pollo", tipo: "Kg", costoEstimado: 2.40, precioSugerido: 3.20, stockInicial: 35 },
    { codigo: "CAT-POL-002", nombre: "Pechuga de Pollo con Hueso", marca: "Del Campo", categoria: "Pollo", tipo: "Kg", costoEstimado: 3.60, precioSugerido: 4.80, stockInicial: 25 },
    { codigo: "CAT-POL-003", nombre: "Milanesa de Pechuga Fileteada", marca: "Del Campo", categoria: "Pollo", tipo: "Kg", costoEstimado: 5.20, precioSugerido: 6.80, stockInicial: 20 },
    { codigo: "CAT-POL-004", nombre: "Muslos de Pollo Enteros", marca: "Del Campo", categoria: "Pollo", tipo: "Kg", costoEstimado: 2.60, precioSugerido: 3.40, stockInicial: 28 },
    { codigo: "CAT-POL-005", nombre: "Alas de Pollo Frescas", marca: "Del Campo", categoria: "Pollo", tipo: "Kg", costoEstimado: 2.80, precioSugerido: 3.70, stockInicial: 18 },
    { codigo: "CAT-POL-006", nombre: "Menudencias de Pollo / Mollejas", marca: "Del Campo", categoria: "Pollo", tipo: "Kg", costoEstimado: 1.50, precioSugerido: 2.20, stockInicial: 15 },

    // --- CERDO ---
    { codigo: "CAT-CER-001", nombre: "Chuleta de Cerdo Fresca", marca: "Del Campo", categoria: "Cerdo", tipo: "Kg", costoEstimado: 4.50, precioSugerido: 5.90, stockInicial: 18 },
    { codigo: "CAT-CER-002", nombre: "Chuleta Ahumada de Cerdo Plumrose", marca: "Plumrose", categoria: "Cerdo", tipo: "Kg", costoEstimado: 6.20, precioSugerido: 7.90, stockInicial: 18 },
    { codigo: "CAT-CER-003", nombre: "Chuleta Ahumada Hermo", marca: "Hermo", categoria: "Cerdo", tipo: "Kg", costoEstimado: 5.90, precioSugerido: 7.50, stockInicial: 18 },
    { codigo: "CAT-CER-004", nombre: "Costillitas de Cerdo Frescas", marca: "Del Campo", categoria: "Cerdo", tipo: "Kg", costoEstimado: 5.20, precioSugerido: 6.80, stockInicial: 15 },
    { codigo: "CAT-CER-005", nombre: "Pernil de Cerdo con Hueso", marca: "Del Campo", categoria: "Cerdo", tipo: "Kg", costoEstimado: 4.20, precioSugerido: 5.50, stockInicial: 22 },
    { codigo: "CAT-CER-006", nombre: "Tocino de Cerdo Fresco", marca: "Del Campo", categoria: "Cerdo", tipo: "Kg", costoEstimado: 2.50, precioSugerido: 3.40, stockInicial: 12 },

    // --- CHARCUTERÍA ---
    { codigo: "CAT-CHA-001", nombre: "Jamón Cocido Superior Plumrose", marca: "Plumrose", categoria: "Charcutería", tipo: "Kg", costoEstimado: 8.50, precioSugerido: 10.90, stockInicial: 12 },
    { codigo: "CAT-CHA-002", nombre: "Jamón de Pierna Especial Hermo", marca: "Hermo", categoria: "Charcutería", tipo: "Kg", costoEstimado: 7.90, precioSugerido: 10.20, stockInicial: 12 },
    { codigo: "CAT-CHA-003", nombre: "Jamón de Espalda Plumrose", marca: "Plumrose", categoria: "Charcutería", tipo: "Kg", costoEstimado: 5.80, precioSugerido: 7.60, stockInicial: 15 },
    { codigo: "CAT-CHA-004", nombre: "Salchichas Viena Plumrose Paq. 12", marca: "Plumrose", categoria: "Charcutería", tipo: "Unidad", costoEstimado: 2.10, precioSugerido: 2.80, stockInicial: 24 },
    { codigo: "CAT-CHA-005", nombre: "Salchichas de Pollo Hermo Paq. 12", marca: "Hermo", categoria: "Charcutería", tipo: "Unidad", costoEstimado: 1.85, precioSugerido: 2.45, stockInicial: 24 },
    { codigo: "CAT-CHA-006", nombre: "Tocineta Ahumada Plumrose (Kg)", marca: "Plumrose", categoria: "Charcutería", tipo: "Kg", costoEstimado: 9.20, precioSugerido: 12.00, stockInicial: 10 },
    { codigo: "CAT-CHA-007", nombre: "Mortadela Especial de Pollo Hermo 500g", marca: "Hermo", categoria: "Charcutería", tipo: "Unidad", costoEstimado: 1.40, precioSugerido: 1.95, stockInicial: 25 },
    { codigo: "CAT-CHA-008", nombre: "Mortadela Tapara Plumrose 1 Kg", marca: "Plumrose", categoria: "Charcutería", tipo: "Unidad", costoEstimado: 2.80, precioSugerido: 3.70, stockInicial: 18 },
    { codigo: "CAT-CHA-009", nombre: "Chorizo Ahumado Parrillero La Montserratina 400g", marca: "La Montserratina", categoria: "Charcutería", tipo: "Unidad", costoEstimado: 3.40, precioSugerido: 4.50, stockInicial: 14 },
    { codigo: "CAT-CHA-010", nombre: "Salchicha Blanca Tradicional La Montserratina 400g", marca: "La Montserratina", categoria: "Charcutería", tipo: "Unidad", costoEstimado: 3.30, precioSugerido: 4.40, stockInicial: 14 },

    // --- HIGIENE PERSONAL Y LIMPIEZA DEL HOGAR ---
    { codigo: "CAT-LIM-001", nombre: "Jabón Azul en Panela Las Llaves 250g", marca: "Las Llaves", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 0.85, precioSugerido: 1.25, stockInicial: 50 },
    { codigo: "CAT-LIM-002", nombre: "Detergente en Polvo Las Llaves 1 Kg", marca: "Las Llaves", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 2.10, precioSugerido: 2.80, stockInicial: 25 },
    { codigo: "CAT-LIM-003", nombre: "Detergente en Polvo Ariel Regular 1 Kg", marca: "Procter & Gamble", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 2.60, precioSugerido: 3.40, stockInicial: 20 },
    { codigo: "CAT-LIM-004", nombre: "Detergente en Polvo Ace 1 Kg", marca: "Procter & Gamble", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 2.30, precioSugerido: 3.00, stockInicial: 20 },
    { codigo: "CAT-LIM-005", nombre: "Jabón de Baño Protex Antibacterial 110g", marca: "Colgate", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 0.90, precioSugerido: 1.30, stockInicial: 35 },
    { codigo: "CAT-LIM-006", nombre: "Jabón de Baño Palmolive Naturals 110g", marca: "Colgate", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 0.85, precioSugerido: 1.25, stockInicial: 35 },
    { codigo: "CAT-LIM-007", nombre: "Jabón de Baño Las Llaves Blanco 110g", marca: "Las Llaves", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 0.80, precioSugerido: 1.15, stockInicial: 35 },
    { codigo: "CAT-LIM-008", nombre: "Cloro Líquido Nevex Clásico 1 Lt", marca: "Nevex", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.10, precioSugerido: 1.55, stockInicial: 24 },
    { codigo: "CAT-LIM-009", nombre: "Desinfectante Mistolín Fragancia Lavanda 1 Lt", marca: "Colgate", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.30, precioSugerido: 1.80, stockInicial: 24 },
    { codigo: "CAT-LIM-010", nombre: "Desinfectante Poett Primavera 1 Lt", marca: "Poett", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.35, precioSugerido: 1.85, stockInicial: 20 },
    { codigo: "CAT-LIM-011", nombre: "Lavaplatos en Crema Axión Limón 450g", marca: "Colgate", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.40, precioSugerido: 1.95, stockInicial: 25 },
    { codigo: "CAT-LIM-012", nombre: "Papel Higiénico Rosal Paquete 4 Rollos", marca: "Manpa", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.50, precioSugerido: 2.10, stockInicial: 30 },
    { codigo: "CAT-LIM-013", nombre: "Papel Higiénico Suave Gold 4 Rollos", marca: "Suave", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.65, precioSugerido: 2.30, stockInicial: 25 },
    { codigo: "CAT-LIM-014", nombre: "Crema Dental Colgate Triple Acción 100ml", marca: "Colgate", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.20, precioSugerido: 1.70, stockInicial: 30 },
    { codigo: "CAT-LIM-015", nombre: "Crema Dental Colgate Total 12 75ml", marca: "Colgate", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.80, precioSugerido: 2.45, stockInicial: 20 },
    { codigo: "CAT-LIM-016", nombre: "Champú Pantene Restauración 300ml", marca: "Procter & Gamble", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 3.20, precioSugerido: 4.20, stockInicial: 16 },
    { codigo: "CAT-LIM-017", nombre: "Champú Drene Brillo y Sedosidad 350ml", marca: "Drene", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 2.50, precioSugerido: 3.35, stockInicial: 18 },
    { codigo: "CAT-LIM-018", nombre: "Toallas Sanitarias Always Noche con Alas Paq. 8", marca: "Always", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.40, precioSugerido: 1.95, stockInicial: 24 },
    { codigo: "CAT-LIM-019", nombre: "Toallas Sanitarias Kotex Normal con Alas Paq. 10", marca: "Kotex", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 1.35, precioSugerido: 1.90, stockInicial: 24 },
    { codigo: "CAT-LIM-020", nombre: "Desodorante Speed Stick Barra Original 50g", marca: "Colgate", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 2.10, precioSugerido: 2.85, stockInicial: 18 },
    { codigo: "CAT-LIM-021", nombre: "Desodorante Lady Speed Stick Barra 45g", marca: "Colgate", categoria: "Limpieza", tipo: "Unidad", costoEstimado: 2.10, precioSugerido: 2.85, stockInicial: 18 },

    // --- BEBIDAS Y LICORES ---
    { codigo: "CAT-BEB-001", nombre: "Malta Polar Botella Vidrio 207ml", marca: "Polar", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 0.60, precioSugerido: 0.90, stockInicial: 48 },
    { codigo: "CAT-BEB-002", nombre: "Malta Polar Lata 355ml", marca: "Polar", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 0.85, precioSugerido: 1.25, stockInicial: 48 },
    { codigo: "CAT-BEB-003", nombre: "Cerveza Polar Pilsen Botella 222ml", marca: "Polar", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 0.80, precioSugerido: 1.20, stockInicial: 72 },
    { codigo: "CAT-BEB-004", nombre: "Cerveza Polar Light Botella 222ml", marca: "Polar", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 0.80, precioSugerido: 1.20, stockInicial: 72 },
    { codigo: "CAT-BEB-005", nombre: "Cerveza Solera Premium Verde Botella 222ml", marca: "Polar", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 0.95, precioSugerido: 1.40, stockInicial: 48 },
    { codigo: "CAT-BEB-006", nombre: "Pepsi-Cola Botella PET 1.5 Lt", marca: "Pepsi", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 1.35, precioSugerido: 1.85, stockInicial: 24 },
    { codigo: "CAT-BEB-007", nombre: "Pepsi-Cola Lata 355ml", marca: "Pepsi", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 0.70, precioSugerido: 1.00, stockInicial: 36 },
    { codigo: "CAT-BEB-008", nombre: "7Up Refresco PET 1.5 Litros", marca: "Pepsi", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 1.35, precioSugerido: 1.85, stockInicial: 24 },
    { codigo: "CAT-BEB-009", nombre: "Coca-Cola Sabor Clásico 1.5 Lt", marca: "Coca-Cola", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 1.50, precioSugerido: 2.10, stockInicial: 24 },
    { codigo: "CAT-BEB-010", nombre: "Refresco Glup / Dumbo Sabor Colita 2 Lt", marca: "Glup", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 1.10, precioSugerido: 1.50, stockInicial: 24 },
    { codigo: "CAT-BEB-011", nombre: "Refresco Glup / Dumbo Sabor Naranja 2 Lt", marca: "Glup", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 1.10, precioSugerido: 1.50, stockInicial: 24 },
    { codigo: "CAT-BEB-012", nombre: "Toddy Polvo de Chocolate 400g", marca: "Polar", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 3.20, precioSugerido: 4.10, stockInicial: 18 },
    { codigo: "CAT-BEB-013", nombre: "Chicha Criolla El Chichero 1 Lt", marca: "Polar", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 2.20, precioSugerido: 2.95, stockInicial: 16 },
    { codigo: "CAT-BEB-014", nombre: "Yukery Jugo Naranja Pasteurizado 1.5 Lt", marca: "Polar", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 1.70, precioSugerido: 2.30, stockInicial: 20 },
    { codigo: "CAT-BEB-015", nombre: "Yukery Jugo Durazno Pasteurizado 1.5 Lt", marca: "Polar", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 1.70, precioSugerido: 2.30, stockInicial: 20 },
    { codigo: "CAT-BEB-016", nombre: "Agua Mineral Minalba sin Gas 1.5 Lt", marca: "Minalba", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 0.75, precioSugerido: 1.10, stockInicial: 30 },
    { codigo: "CAT-BEB-017", nombre: "Ron Pampero Especial Añejo Botella 0.75 Lt", marca: "Pampero", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 5.50, precioSugerido: 7.20, stockInicial: 12 },
    { codigo: "CAT-BEB-018", nombre: "Ron Santa Teresa Gran Reserva 0.75 Lt", marca: "Santa Teresa", categoria: "Bebidas", tipo: "Unidad", costoEstimado: 6.80, precioSugerido: 8.80, stockInicial: 12 },

    // --- PANADERÍA Y GALLETAS ---
    { codigo: "CAT-PAN-001", nombre: "Pan Cuadrado Blanco Bimbo Grande 450g", marca: "Bimbo", categoria: "Panadería", tipo: "Unidad", costoEstimado: 2.20, precioSugerido: 2.90, stockInicial: 20 },
    { codigo: "CAT-PAN-002", nombre: "Pan Cuadrado Integral Bimbo 450g", marca: "Bimbo", categoria: "Panadería", tipo: "Unidad", costoEstimado: 2.40, precioSugerido: 3.15, stockInicial: 16 },
    { codigo: "CAT-PAN-003", nombre: "Pan de Perro Caliente Bimbo Paq. 8 un.", marca: "Bimbo", categoria: "Panadería", tipo: "Unidad", costoEstimado: 1.80, precioSugerido: 2.45, stockInicial: 18 },
    { codigo: "CAT-PAN-004", nombre: "Pan de Hamburguesa Bimbo con Ajonjolí Paq. 8 un.", marca: "Bimbo", categoria: "Panadería", tipo: "Unidad", costoEstimado: 1.95, precioSugerido: 2.65, stockInicial: 18 },
    { codigo: "CAT-PAN-005", nombre: "Galletas María Puig Paquete 100g", marca: "Puig", categoria: "Panadería", tipo: "Unidad", costoEstimado: 0.65, precioSugerido: 0.95, stockInicial: 45 },
    { codigo: "CAT-PAN-006", nombre: "Galletas Kraker Bran Puig 180g", marca: "Puig", categoria: "Panadería", tipo: "Unidad", costoEstimado: 0.90, precioSugerido: 1.30, stockInicial: 35 },
    { codigo: "CAT-PAN-007", nombre: "Galletas Soda Puig Clásicas 120g", marca: "Puig", categoria: "Panadería", tipo: "Unidad", costoEstimado: 0.70, precioSugerido: 1.05, stockInicial: 35 },
    { codigo: "CAT-PAN-008", nombre: "Galletas Club Social Original Paq. 6 un.", marca: "Nabisco", categoria: "Panadería", tipo: "Unidad", costoEstimado: 1.30, precioSugerido: 1.80, stockInicial: 30 },

    // --- SNACKS Y DULCES ---
    { codigo: "CAT-SNK-001", nombre: "Pepito Snack de Maíz con Queso 80g", marca: "Pepsi", categoria: "Snacks", tipo: "Unidad", costoEstimado: 0.75, precioSugerido: 1.10, stockInicial: 36 },
    { codigo: "CAT-SNK-002", nombre: "Doritos Mega Queso 140g", marca: "Pepsi", categoria: "Snacks", tipo: "Unidad", costoEstimado: 1.60, precioSugerido: 2.25, stockInicial: 25 },
    { codigo: "CAT-SNK-003", nombre: "Ruffles Papas Onduladas 120g", marca: "Pepsi", categoria: "Snacks", tipo: "Unidad", costoEstimado: 1.60, precioSugerido: 2.25, stockInicial: 25 },
    { codigo: "CAT-SNK-004", nombre: "Cheese Tris Snack de Queso 150g", marca: "Pepsi", categoria: "Snacks", tipo: "Unidad", costoEstimado: 1.40, precioSugerido: 1.95, stockInicial: 28 },
    { codigo: "CAT-SNK-005", nombre: "Nucita Tubita Crema de Avellana y Chocolate 35g", marca: "Nucita", categoria: "Snacks", tipo: "Unidad", costoEstimado: 0.50, precioSugerido: 0.75, stockInicial: 50 },
    { codigo: "CAT-SNK-006", nombre: "Pirulín Lata Tradicional 300g", marca: "Nucita", categoria: "Snacks", tipo: "Unidad", costoEstimado: 4.20, precioSugerido: 5.60, stockInicial: 15 },
    { codigo: "CAT-SNK-007", nombre: "Chocolate Cri-Cri Savoy con Arroz Inflado 130g", marca: "Savoy", categoria: "Snacks", tipo: "Unidad", costoEstimado: 1.80, precioSugerido: 2.45, stockInicial: 25 },
    { codigo: "CAT-SNK-008", nombre: "Chocolate con Leche Savoy Barra 130g", marca: "Savoy", categoria: "Snacks", tipo: "Unidad", costoEstimado: 1.80, precioSugerido: 2.45, stockInicial: 25 },
    { codigo: "CAT-SNK-009", nombre: "Galleta Susy Savoy Chocolate y Vainilla 50g", marca: "Savoy", categoria: "Snacks", tipo: "Unidad", costoEstimado: 0.65, precioSugerido: 0.95, stockInicial: 45 },
    { codigo: "CAT-SNK-010", nombre: "Galleta Cocosette Savoy Rellena de Coco 50g", marca: "Savoy", categoria: "Snacks", tipo: "Unidad", costoEstimado: 0.65, precioSugerido: 0.95, stockInicial: 45 },
    { codigo: "CAT-SNK-011", nombre: "Samba de Fresa Savoy Galleta Bañada 32g", marca: "Savoy", categoria: "Snacks", tipo: "Unidad", costoEstimado: 0.60, precioSugerido: 0.90, stockInicial: 45 }
];

// Estado de Selección y Filtros del Catálogo Maestro
let masterCategoryFilter = 'todas';
let masterBrandFilter = 'todas';
let masterSelectedCodes = new Set();

function openCatalogoMaestroModal() {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Solo administradores pueden gestionar la importación de catálogo.', 'warning');
    }
    const m = document.getElementById('catalogo-maestro-modal');
    const c = document.getElementById('catalogo-maestro-content');
    if (!m || !c) return;
    
    // Resetear filtros si están vacíos o mantener coherencia
    const searchInput = document.getElementById('master-search-input');
    if (searchInput) searchInput.value = '';
    
    m.classList.remove('hidden');
    setTimeout(() => {
        m.classList.remove('opacity-0');
        c.classList.remove('scale-95');
    }, 10);
    renderMasterCatalogItems();
}

function closeCatalogoMaestroModal() {
    const m = document.getElementById('catalogo-maestro-modal');
    const c = document.getElementById('catalogo-maestro-content');
    if (!m || !c) return;
    m.classList.add('opacity-0');
    c.classList.add('scale-95');
    setTimeout(() => m.classList.add('hidden'), 300);
}

function filterMasterCategory(cat) {
    masterCategoryFilter = cat;
    const buttons = document.querySelectorAll('.master-cat-btn');
    buttons.forEach(btn => {
        const txt = btn.textContent.trim();
        const isTarget = (cat === 'todas' && txt === 'Todas') || 
                         (cat !== 'todas' && txt.toLowerCase().includes(cat.toLowerCase()));
        if (isTarget) {
            btn.className = 'master-cat-btn active px-3 py-1.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs transition-all shrink-0';
        } else {
            btn.className = 'master-cat-btn px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all shrink-0';
        }
    });
    renderMasterCatalogItems();
}

function filterMasterBrand(marca) {
    masterBrandFilter = marca;
    const buttons = document.querySelectorAll('.master-brand-btn');
    buttons.forEach(btn => {
        const txt = btn.textContent.trim();
        const isTarget = (marca === 'todas' && txt === 'Todas') || 
                         (marca !== 'todas' && txt.toLowerCase().includes(marca.toLowerCase()));
        if (isTarget) {
            btn.className = 'master-brand-btn active px-3 py-1 rounded-xl bg-indigo-600 text-white shadow-xs transition-all shrink-0';
        } else {
            btn.className = 'master-brand-btn px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all shrink-0';
        }
    });
    renderMasterCatalogItems();
}

function renderMasterCatalogItems() {
    const tbody = document.getElementById('master-catalog-table-body');
    if (!tbody) return;
    
    const norm = str => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const searchVal = norm(document.getElementById('master-search-input')?.value || '');
    
    const filtered = VENEZUELA_MASTER_CATALOG.filter(item => {
        // Filtro Categoría
        if (masterCategoryFilter !== 'todas' && norm(item.categoria) !== norm(masterCategoryFilter)) {
            return false;
        }
        // Filtro Marca
        if (masterBrandFilter !== 'todas' && !norm(item.marca).includes(norm(masterBrandFilter))) {
            return false;
        }
        // Filtro Buscador
        if (searchVal) {
            const matchCod = norm(item.codigo).includes(searchVal);
            const matchNom = norm(item.nombre).includes(searchVal);
            const matchMar = norm(item.marca).includes(searchVal);
            const matchCat = norm(item.categoria).includes(searchVal);
            if (!matchCod && !matchNom && !matchMar && !matchCat) return false;
        }
        return true;
    });

    tbody.innerHTML = '';
    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-8 text-slate-400">
                    <i class="fa-solid fa-boxes-packing text-3xl mb-2 block opacity-40"></i>
                    No se encontraron productos coincidentes en el catálogo maestro.
                </td>
            </tr>`;
    } else {
        filtered.forEach(p => {
            const alreadyInStore = products.some(prod => 
                (prod.codigo && prod.codigo.toLowerCase() === p.codigo.toLowerCase()) || 
                (prod.nombre.toLowerCase().trim() === p.nombre.toLowerCase().trim())
            );
            const isChecked = masterSelectedCodes.has(p.codigo);
            const rowClass = isChecked ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40';
            
            const statusBadge = alreadyInStore 
                ? `<span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-extrabold text-[10px] border border-emerald-200 dark:border-emerald-800/70"><i class="fa-solid fa-check mr-1"></i>En Tienda</span>`
                : `<span class="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold text-[10px]">Disponible</span>`;

            tbody.innerHTML += `
                <tr class="transition border-b border-slate-100 dark:border-slate-800/60 ${rowClass}">
                    <td class="p-3 text-center">
                        <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleMasterItemCheck('${p.codigo}')" class="w-4 h-4 rounded text-indigo-600 cursor-pointer">
                    </td>
                    <td class="p-3 font-bold text-slate-800 dark:text-slate-100">
                        <div>${p.nombre}</div>
                        <span class="text-[10px] text-slate-400 font-normal">Cód: ${p.codigo}</span>
                    </td>
                    <td class="p-3">
                        <span class="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-black text-[10px] border border-indigo-100 dark:border-indigo-900/50">${p.marca}</span>
                    </td>
                    <td class="p-3">
                        <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-[10px]">${p.categoria}</span>
                    </td>
                    <td class="p-3 text-center">
                        <span class="px-2 py-0.5 rounded-md ${p.tipo === 'Kg' ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400'} font-black text-[10px]">${p.tipo}</span>
                    </td>
                    <td class="p-3 text-right font-semibold text-slate-500 dark:text-slate-400">$${p.costoEstimado.toFixed(2)}</td>
                    <td class="p-3 text-right font-black text-emerald-600 dark:text-emerald-400">$${p.precioSugerido.toFixed(2)}</td>
                    <td class="p-3 text-center">${statusBadge}</td>
                </tr>`;
        });
    }

    // Actualizar contadores
    const countEl = document.getElementById('master-selected-count');
    const badgeEl = document.getElementById('master-items-selected-badge');
    if (countEl) countEl.textContent = masterSelectedCodes.size;
    if (badgeEl) badgeEl.textContent = masterSelectedCodes.size;

    // Actualizar checkbox "seleccionar todos"
    const selectAllCheckbox = document.getElementById('master-select-all');
    if (selectAllCheckbox && filtered.length > 0) {
        const allFilteredSelected = filtered.every(item => masterSelectedCodes.has(item.codigo));
        selectAllCheckbox.checked = allFilteredSelected;
    }
}

function toggleMasterItemCheck(codigo) {
    if (masterSelectedCodes.has(codigo)) {
        masterSelectedCodes.delete(codigo);
    } else {
        masterSelectedCodes.add(codigo);
    }
    renderMasterCatalogItems();
}

function toggleSelectAllMaster(checkboxEl) {
    const norm = str => (str || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const searchVal = norm(document.getElementById('master-search-input')?.value || '');
    const filtered = VENEZUELA_MASTER_CATALOG.filter(item => {
        if (masterCategoryFilter !== 'todas' && norm(item.categoria) !== norm(masterCategoryFilter)) return false;
        if (masterBrandFilter !== 'todas' && !norm(item.marca).includes(norm(masterBrandFilter))) return false;
        if (searchVal) {
            const matchCod = norm(item.codigo).includes(searchVal);
            const matchNom = norm(item.nombre).includes(searchVal);
            const matchMar = norm(item.marca).includes(searchVal);
            const matchCat = norm(item.categoria).includes(searchVal);
            if (!matchCod && !matchNom && !matchMar && !matchCat) return false;
        }
        return true;
    });

    if (checkboxEl.checked) {
        filtered.forEach(item => masterSelectedCodes.add(item.codigo));
    } else {
        filtered.forEach(item => masterSelectedCodes.delete(item.codigo));
    }
    renderMasterCatalogItems();
}

function deseleccionarTodosMaster() {
    masterSelectedCodes.clear();
    renderMasterCatalogItems();
}

async function importarProductosSeleccionados() {
    if (!isAdmin) return;
    if (masterSelectedCodes.size === 0) {
        return Swal.fire('Sin Selección', 'Por favor selecciona al menos un producto del catálogo para importar.', 'info');
    }

    const confirmRes = await Swal.fire({
        title: `¿Importar ${masterSelectedCodes.size} productos?`,
        html: `<p class="text-xs text-slate-600 dark:text-slate-300">Los productos seleccionados se agregarán al inventario activo de tu negocio con sus marcas, categorías y precios sugeridos.</p>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: '<i class="fa-solid fa-file-import mr-1"></i> Sí, Importar Ahora',
        cancelButtonText: 'Cancelar'
    });

    if (!confirmRes.isConfirmed) return;

    const btn = document.getElementById('btn-import-master');
    const originalBtnHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Importando...';
        btn.disabled = true;
    }

    try {
        let countImportados = 0;
        let countOmitidos = 0;
        const selectedList = VENEZUELA_MASTER_CATALOG.filter(item => masterSelectedCodes.has(item.codigo));
        
        for (const item of selectedList) {
            // Verificación para evitar duplicados si ya existe
            const exists = products.some(p => 
                (p.codigo && p.codigo.toLowerCase() === item.codigo.toLowerCase()) ||
                (p.nombre.toLowerCase().trim() === item.nombre.toLowerCase().trim())
            );

            if (exists) {
                countOmitidos++;
                continue;
            }

            const newProduct = {
                codigo: item.codigo,
                nombre: item.nombre,
                marca: item.marca,
                categoria: item.categoria,
                precio: item.precioSugerido,
                costo: item.costoEstimado,
                stock: item.stockInicial || 10,
                tipo: item.tipo,
                fechaVencimiento: null,
                imagen: item.imagen || ''
            };

            await getDb('products').add(newProduct);
            countImportados++;
        }

        masterSelectedCodes.clear();
        closeCatalogoMaestroModal();

        Swal.fire({
            title: '¡Importación Finalizada!',
            html: `
                <div class="space-y-2 text-left text-xs bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                    <p class="text-emerald-600 font-bold"><i class="fa-solid fa-circle-check mr-1"></i> <b>${countImportados}</b> productos agregados con éxito al inventario.</p>
                    ${countOmitidos > 0 ? `<p class="text-amber-600 font-semibold"><i class="fa-solid fa-triangle-exclamation mr-1"></i> <b>${countOmitidos}</b> productos omitidos porque ya estaban registrados en la tienda.</p>` : ''}
                </div>
            `,
            icon: 'success',
            confirmButtonColor: '#4f46e5'
        });

    } catch (err) {
        console.error('Error importando catálogo maestro:', err);
        Swal.fire('Error de Importación', `Ocurrió un inconveniente: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.innerHTML = originalBtnHtml;
            btn.disabled = false;
        }
    }
}

console.log("✅ GestiónPro 2026 cargado correctamente con Catálogo Maestro Venezolano");

// ======================================================================================
// SUITE MULTI-SUCURSAL Y TORRE DE CONTROL (FINANZAS GLOBALES, SUCURSALES Y CAJEROS)
// ======================================================================================

// Estado global de sucursales del holding.
//
// ANTES estas tres listas venían PRECARGADAS con datos inventados: 3
// sucursales ("Bodega Norte", "Mini Market Express"), 2 traspasos
// (TRF-101/102) y 3 cajeros (carlos@bodega.com, maria@bodega.com,
// jose@bodega.com), y se guardaban en el localStorage del equipo. Una bodega
// real los veía como si fueran suyos, con nombres, direcciones y teléfonos que
// no existen, y podía "traspasar" mercancía a una sucursal ficticia.
//
// Ahora empiezan VACÍAS. La única sucursal que se garantiza es el negocio que
// el usuario está usando de verdad (su negocioId), que añade
// initMultiBranchSuite().
let holdingBranches = [];


let holdingTransfers = [];


let cajerosList = [];

// Identificadores de los datos de DEMO que quedaron guardados en el
// localStorage de los equipos ya instalados. Se purgan al arrancar para que
// dejen de aparecer en la Torre de Control como si fueran reales.
// Incluye 'bodega-demo' a propósito: es el id de la sucursal de demo
// "Bodega Principal" (dirección "Calle Comercio #12, Casco Central", cajero
// "Admin / Tienda Central"). El filtro de purgarDatosDemo() NUNCA descarta la
// sucursal activa, así que si 'bodega-demo' resulta ser el negocio real del
// usuario, se conserva; si no, es la ficha de demo y se elimina.
const IDS_SUCURSAL_DEMO = ['bodega-demo', 'bodega-norte', 'minimarket-oeste'];
const IDS_TRASPASO_DEMO = ['TRF-101', 'TRF-102'];
const EMAILS_CAJERO_DEMO = ['carlos@bodega.com', 'maria@bodega.com', 'jose@bodega.com'];

function purgarDatosDemo() {
    const antes = {
        s: (holdingBranches || []).length,
        t: (holdingTransfers || []).length,
        c: (cajerosList || []).length
    };
    // La sucursal ACTIVA nunca se descarta, aunque su id coincida con un id de
    // demo: si el negocio real del usuario se llama 'bodega-demo', es suyo.
    holdingBranches = (holdingBranches || []).filter(b =>
        b && b.id && (b.id === currentNegocioId || !IDS_SUCURSAL_DEMO.includes(b.id))
    );
    holdingTransfers = (holdingTransfers || []).filter(t => t && !IDS_TRASPASO_DEMO.includes(t.id));
    cajerosList = (cajerosList || []).filter(c =>
        c && c.usuario && !EMAILS_CAJERO_DEMO.includes(String(c.usuario).toLowerCase())
    );
    const quitados = (antes.s - holdingBranches.length)
        + (antes.t - holdingTransfers.length)
        + (antes.c - cajerosList.length);
    if (quitados > 0) {
        console.warn(`Suite multi-sucursal: se purgaron ${quitados} registro(s) de demo.`);
    }
    return quitados;
}

// Inicialización de la Suite Multi-Sucursal
function initMultiBranchSuite() {
    try {
        // Lectura tolerante: si el JSON está corrupto, se sigue con listas
        // vacías en vez de romper el arranque.
        holdingBranches = leerListaLocal('holding_branches');
        holdingTransfers = leerListaLocal('holding_transfers');
        cajerosList = leerListaLocal('holding_cajeros');

        // Limpieza única de los datos de demo de versiones anteriores.
        purgarDatosDemo();

        // La sucursal ACTIVA siempre debe estar en la lista: es la única cuyos
        // datos reales puede leer este dispositivo, porque el negocioId del
        // usuario ES la sucursal y las reglas de Firestore solo dan acceso a
        // ese inquilino.
        if (currentNegocioId && !holdingBranches.some(b => b.id === currentNegocioId)) {
            holdingBranches.unshift({
                id: currentNegocioId,
                nombre: (storeConfig && storeConfig.name) || 'Mi negocio',
                direccion: '',
                telefono: (storeConfig && storeConfig.phone) || '',
                fondoCaja: 0,
                cajeroAsignado: (currentUser && currentUser.email) || '',
                esPrincipal: true
            });
        }

        guardarListaLocal('holding_branches', holdingBranches);
        guardarListaLocal('holding_transfers', holdingTransfers);
        guardarListaLocal('holding_cajeros', cajerosList);

        // El inquilino real ya lo resolvió resolverSesion() desde
        // usuarios/{uid}, y con las reglas de Firestore es LO ÚNICO a lo que
        // este usuario tiene acceso.
        //
        // ANTES aquí se sobreescribía currentNegocioId con dos valores del
        // localStorage del equipo:
        //   - `holding_cajeros`, que en el dispositivo del cajero no existe,
        //     así que la restricción de sucursal nunca se aplicaba;
        //   - `active_branch_id`, que podía apuntar a una sucursal ficticia
        //     ('bodega-norte') o a un negocio ajeno. Con las reglas nuevas eso
        //     dejaría TODA la aplicación en permission-denied.
        // Por eso ya no se toca currentNegocioId aquí.
        if (!isAdmin) {
            // Bloquear visualmente el selector de sucursales para cajeros.
            const switcherBtn = document.getElementById('btn-current-branch');
            if (switcherBtn) {
                switcherBtn.classList.add('opacity-80', 'cursor-not-allowed');
                switcherBtn.title = 'Acceso restringido: estás asignado a esta sucursal exclusivamente';
            }
        }

        // Actualizar nombres e interfaz
        actualizarIndicadorSucursalActiva();
        renderBranchDropdown();

        // Cerrar dropdown al hacer click fuera
        document.addEventListener('click', (e) => {
            const container = document.getElementById('branch-switcher-container');
            const menu = document.getElementById('branch-dropdown-menu');
            if (container && menu && !container.contains(e.target)) {
                menu.classList.add('hidden');
            }
        });

    } catch (err) {
        console.error('Error inicializando Suite Multi-Sucursal:', err);
    }
}

// Actualiza el botón de sucursal activa en el header y sidebar
function actualizarIndicadorSucursalActiva() {
    const curBranch = holdingBranches.find(b => b.id === currentNegocioId) || holdingBranches[0];
    const nameEl = document.getElementById('current-branch-name');
    if (nameEl && curBranch) {
        nameEl.textContent = curBranch.nombre;
    }
    // El nombre del negocio en la barra lateral lo pinta fetchRates() con
    // pintarNombreTienda(). Antes esta función lo sobreescribía con
    // innerHTML usando el nombre de la SUCURSAL, así que se peleaban entre sí
    // y además era otro punto de inyección de HTML.
    const countEl = document.getElementById('branch-total-count');
    if (countEl) {
        countEl.textContent = `${holdingBranches.length} Tiendas`;
    }
}

// Abre o cierra el dropdown selector de sucursales
function toggleBranchDropdown(event) {
    if (event) event.stopPropagation();
    if (!isAdmin) {
        const curBranch = holdingBranches.find(b => b.id === currentNegocioId) || holdingBranches[0];
        return Swal.fire({
            title: 'Acceso Restringido a Cajero',
            html: `<p class="text-xs text-slate-600 dark:text-slate-300">Tienes asignada exclusivamente la <b>${curBranch.nombre}</b>.<br>El cambio de tienda y supervisión multi-sucursal está restringido al Dueño/Administrador.</p>`,
            icon: 'info',
            confirmButtonColor: '#4f46e5'
        });
    }
    const menu = document.getElementById('branch-dropdown-menu');
    if (menu) {
        menu.classList.toggle('hidden');
    }
}

// ======================================================================================
// GESTIÓN DEL ESTADO DE CAJAS POR SUCURSAL (TIEMPO REAL / MULTI-SUCURSAL)
// ======================================================================================

// Estado de caja del turno por sucursal.
//
// ANTES, si no había ningún registro, se DEVOLVÍA 'abierta' con una apertura de
// hoy y un fondo inicial de $20.00 INVENTADOS. Así, una sucursal que nunca
// abrió caja aparecía como "🟢 Caja Abierta" con un fondo que nadie declaró.
// Ahora, sin registro, el estado es explícitamente 'sin_registro'.
function obtenerEstadoCajaSucursal(branchId) {
    const key = `caja_status_${branchId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
        try {
            const st = JSON.parse(raw);
            if (st && typeof st === 'object' && st.estado) return st;
        } catch (e) {}
    }
    return {
        estado: 'sin_registro',
        ultimoCierre: null,
        ultimaApertura: null
    };
}

function guardarEstadoCajaSucursal(branchId, estadoData) {
    const key = `caja_status_${branchId}`;
    localStorage.setItem(key, JSON.stringify(estadoData));
    try {
        if (db && typeof db.collection === 'function') {
            db.collection('cajas_sucursales').doc(branchId).set(estadoData, { merge: true }).catch(() => {});
        }
    } catch(e) {}
}

function marcarCajaAbiertaPorVenta(branchId) {
    const st = obtenerEstadoCajaSucursal(branchId);
    if (st.estado === 'cerrada') {
        const curBranch = (holdingBranches && holdingBranches.find(b => b.id === branchId)) || {};
        guardarEstadoCajaSucursal(branchId, {
            estado: 'abierta',
            ultimaApertura: {
                fechaStr: new Date().toLocaleString('es-VE'),
                cajero: curBranch.cajeroAsignado || currentUser?.email || 'Cajero',
                fondoInicial: curBranch.fondoCaja || 0
            },
            ultimoCierre: st.ultimoCierre
        });
        if (typeof renderTorreControl === 'function') renderTorreControl();
        if (typeof renderBranchDropdown === 'function') renderBranchDropdown();
    }
}

async function abrirCajaTurnoSucursal(branchId) {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Solo administradores pueden abrir o reiniciar turnos de caja.', 'warning');
    }
    const branch = holdingBranches.find(b => b.id === branchId);
    if (!branch) return;

    const { value: fondo } = await Swal.fire({
        title: `🔓 Abrir Caja — ${branch.nombre}`,
        html: `
            <div class="text-left space-y-3">
                <p class="text-xs text-slate-500 dark:text-slate-400">Ingresa el fondo inicial en efectivo (cambio / sencillo) para el inicio de este turno:</p>
                <div>
                    <label class="block text-[11px] font-black uppercase text-slate-400 mb-1">Fondo de Caja Inicial ($)</label>
                    <input id="swal-fondo-inicial" type="number" step="any" value="${branch.fondoCaja || 0}" class="swal2-input !m-0 !w-full !text-base font-bold">
                </div>
            </div>
        `,
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: '<i class="fa-solid fa-lock-open mr-1"></i> Abrir Caja Ahora',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            const v = document.getElementById('swal-fondo-inicial')?.value;
            return parseFloat(v) || 0;
        }
    });

    if (fondo === undefined) return;

    const stPrevio = obtenerEstadoCajaSucursal(branchId);
    const nuevoEstado = {
        estado: 'abierta',
        ultimaApertura: {
            fechaStr: new Date().toLocaleString('es-VE'),
            cajero: branch.cajeroAsignado || currentUser?.email || 'Administrador',
            fondoInicial: fondo
        },
        ultimoCierre: stPrevio.ultimoCierre
    };

    guardarEstadoCajaSucursal(branchId, nuevoEstado);

    branch.fondoCaja = fondo;
    localStorage.setItem('holding_branches', JSON.stringify(holdingBranches));

    renderTorreControl();
    renderBranchDropdown();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `🟢 Caja Abierta: ${branch.nombre}`,
        text: `Fondo inicial registrado: $${fondo.toFixed(2)}`,
        showConfirmButton: false,
        timer: 2500
    });
}

function cerrarCajaDirectoTorre(branchId) {
    if (branchId !== currentNegocioId) {
        cambiarSucursalActiva(branchId, true);
    }
    abrirModalArqueo30Seg();
}

// Renderiza las opciones de sucursal en el menú desplegable del header
function renderBranchDropdown() {
    const listEl = document.getElementById('branch-dropdown-list');
    if (!listEl) return;

    listEl.innerHTML = holdingBranches.map(branch => {
        const isSelected = branch.id === currentNegocioId;
        const estadoCaja = obtenerEstadoCajaSucursal(branch.id);
        const estaCerrada = estadoCaja.estado === 'cerrada';
        const sinRegistro = estadoCaja.estado === 'sin_registro';
        const accesible = branch.id === negocioAsignado;
        return `
            <div onclick="cambiarSucursalActiva('${branch.id}')" 
                 class="group/item p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between ${
                     isSelected 
                     ? 'bg-primary-500/10 border border-primary-500/30 text-primary-700 dark:text-primary-300 font-bold' 
                     : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium'
                 }">
                <div class="flex items-center gap-2.5 overflow-hidden flex-1 mr-2">
                    <div class="w-8 h-8 rounded-lg ${isSelected ? 'bg-primary-500 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'} flex items-center justify-center text-xs shrink-0">
                        <i class="fa-solid fa-store"></i>
                    </div>
                    <div class="truncate flex-1">
                        <div class="flex items-center gap-1.5">
                            <p class="text-xs font-black truncate">${branch.nombre}</p>
                            <span class="w-2 h-2 rounded-full shrink-0 ${sinRegistro ? 'bg-slate-400' : (estaCerrada ? 'bg-rose-500' : 'bg-emerald-500')}" title="${sinRegistro ? 'Sin registro de caja' : (estaCerrada ? 'Caja Cerrada' : 'Caja Abierta')}"></span>
                            ${accesible ? '' : '<span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700 text-slate-500 dark:text-slate-300 shrink-0" title="Solo consultable desde una cuenta asignada a esa sucursal">otro equipo</span>'}
                        </div>
                        <p class="text-[10px] text-slate-400 dark:text-slate-500 truncate">${branch.direccion || 'Sin dirección'}</p>
                    </div>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" onclick="event.stopPropagation(); abrirModalEditarSucursal('${branch.id}')" title="Editar sucursal" class="w-6 h-6 rounded-lg bg-slate-200/60 hover:bg-indigo-100 dark:bg-slate-700 dark:hover:bg-indigo-950 text-slate-500 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-300 flex items-center justify-center text-[10px] transition-colors">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    ${!branch.esPrincipal ? `
                    <button type="button" onclick="event.stopPropagation(); eliminarSucursal('${branch.id}')" title="Eliminar sucursal" class="w-6 h-6 rounded-lg bg-slate-200/60 hover:bg-rose-100 dark:bg-slate-700 dark:hover:bg-rose-950 text-slate-500 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-300 flex items-center justify-center text-[10px] transition-colors">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>` : ''}
                    ${isSelected ? '<span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-primary-500 text-white shrink-0 ml-0.5">Activa</span>' : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Cambia la sucursal activa en 1 toque
function cambiarSucursalActiva(newBranchId, silent = false) {
    if (!isAdmin) {
        return Swal.fire('Error', 'Sólo el Administrador puede cambiar de sucursal.', 'error');
    }
    const targetBranch = holdingBranches.find(b => b.id === newBranchId);
    if (!targetBranch) return;
    if (newBranchId === currentNegocioId) return;

    // Con el aislamiento por inquilino en las reglas, un usuario solo puede
    // leer y escribir SU negocio. Cada sucursal se guarda como un negocio
    // distinto, así que cambiar a una sucursal a la que no se pertenece
    // dejaría TODA la aplicación en permission-denied.
    // Antes el cambio se hacía sin comprobar nada, porque las reglas
    // permitían leer y escribir cualquier negocio.
    if (newBranchId !== negocioAsignado) {
        return Swal.fire({
            title: 'Sucursal no accesible',
            html: `<p class="text-xs text-slate-600 dark:text-slate-300">Tu usuario está asignado a <b>${negocioAsignado || 'su negocio'}</b>.</p>
                   <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">Sus datos solo se pueden consultar desde un dispositivo con una cuenta asignada a esa sucursal.</p>`,
            icon: 'info',
            confirmButtonColor: '#4f46e5'
        });
    }

    localStorage.setItem('active_branch_id', newBranchId);

    // Ocultar menú
    const menu = document.getElementById('branch-dropdown-menu');
    if (menu) menu.classList.add('hidden');

    actualizarIndicadorSucursalActiva();
    renderBranchDropdown();

    // Limpiar carrito de ventas para no mezclar productos de tiendas distintas
    cart = [];
    if (typeof renderCart === 'function') renderCart();

    // Recargar listeners de Firebase para la sucursal destino
    setupFirebaseListeners();

    // Si está en la Torre de Control, refrescarla
    if (document.getElementById('tab-torre-control')?.classList.contains('active')) {
        renderTorreControl();
    }

    if (!silent) {
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: `🏪 Cambiado a: ${targetBranch.nombre}`,
            text: 'Inventario, clientes y caja cambiados en tiempo real',
            showConfirmButton: false,
            timer: 2500
        });
    }
}

// ======================================================================================
// MOTOR DE LA TORRE DE CONTROL (CONSOLIDADO GLOBAL DE FINANZAS Y MONITOREO EN VIVO)
// ======================================================================================

// Métricas por sucursal.
//
// QUÉ ESTABA MAL Y POR QUÉ:
//  1. Para cualquier sucursal que NO fuera la activa se devolvían cifras
//     HARDCODEADAS (385.50 / 260.00 de ventas, 140/85 de fiados, 8/5 deudores,
//     3150/2400 de inventario). Se sumaban al "consolidado global" y el dueño
//     las veía como si fueran reales.
//  2. La ganancia usaba `s.profit`, campo que NO EXISTE en ninguna venta (se
//     guarda `gananciaBrutaUsd`), así que el ternario caía SIEMPRE en
//     `vUsd * 0.28`: un margen del 28% inventado.
//  3. Los fiados leían `c.saldoDeudor`, que tampoco existe (el campo real es
//     `deudaUsd`). Por eso los fiados de la sucursal activa salían en 0 y el
//     único número "creíble" del panel era el falso.
//  4. El inventario valorado inventaba un costo del 70% del precio cuando el
//     producto no tenía costo capturado.
//
// Solo la sucursal ACTIVA tiene datos reales, porque el negocioId del usuario
// ES la sucursal y las reglas de Firestore solo le dan acceso a ese inquilino.
// Las demás se marcan con `tieneDatos: false`.
function obtenerMetricasSucursal(branch) {
    const isCurrent = branch.id === currentNegocioId;
    const estadoCaja = obtenerEstadoCajaSucursal(branch.id);
    const estaCerrada = estadoCaja.estado === 'cerrada';
    const sinRegistro = estadoCaja.estado === 'sin_registro';

    if (isCurrent) {
        let ventasUsd = 0;
        let gananciaUsd = 0;
        let ventasSinCostoUsd = 0;

        if (!estaCerrada) {
            salesHistory.forEach(s => {
                if (s.status !== 'cerrado') {
                    const vUsd = Number(s.totalUsd || 0);
                    ventasUsd += vUsd;
                    if (s.gananciaBrutaUsd !== undefined && s.gananciaBrutaUsd !== null) {
                        gananciaUsd += Number(s.gananciaBrutaUsd) || 0;
                    } else {
                        // Venta antigua sin costo capturado: se excluye del
                        // margen en vez de inventarle un 28%.
                        ventasSinCostoUsd += vUsd;
                    }
                }
            });
        }

        let fiadosUsd = 0;
        let debtorCount = 0;
        (clientes || []).forEach(c => {
            const deuda = Number(c.deudaUsd || 0);
            if (deuda > 0) {
                fiadosUsd += deuda;
                debtorCount++;
            }
        });

        // Valor de inventario: solo productos CON costo capturado.
        let invValUsd = 0;
        let skusSinCosto = 0;
        (products || []).forEach(p => {
            const stock = Number(p.stock || 0);
            if (stock <= 0) return;
            const costo = Number(p.costo || 0);
            if (costo > 0) invValUsd += costo * stock;
            else skusSinCosto++;
        });

        return {
            id: branch.id,
            nombre: branch.nombre,
            direccion: branch.direccion,
            telefono: branch.telefono,
            fondoCaja: branch.fondoCaja,
            cajero: branch.cajeroAsignado || 'Operador',
            ventasUsd: roundMoney(ventasUsd),
            gananciaUsd: roundMoney(gananciaUsd),
            fiadosUsd: roundMoney(fiadosUsd),
            deudores: debtorCount,
            invValUsd: roundMoney(invValUsd),
            skus: (products || []).length,
            estado: sinRegistro
                ? '⚪ Sin registro de caja'
                : (estaCerrada ? '🔴 Caja Cerrada' : '🟢 Caja Abierta'),
            estaCerrada: estaCerrada,
            sinRegistro: sinRegistro,
            ultimoCierre: estadoCaja.ultimoCierre,
            ultimaApertura: estadoCaja.ultimaApertura,
            esPrincipal: !!branch.esPrincipal,
            tieneDatos: true,
            ventasSinCostoUsd: roundMoney(ventasSinCostoUsd),
            skusSinCosto: skusSinCosto
        };
    }

    // Sucursal NO activa: este dispositivo no puede leer sus datos. Se
    // devuelve sin cifras en lugar de inventarlas.
    return {
        id: branch.id,
        nombre: branch.nombre,
        direccion: branch.direccion,
        telefono: branch.telefono,
        fondoCaja: branch.fondoCaja,
        cajero: branch.cajeroAsignado || '',
        ventasUsd: 0,
        gananciaUsd: 0,
        fiadosUsd: 0,
        deudores: 0,
        invValUsd: 0,
        skus: 0,
        estado: sinRegistro
            ? '⚪ Sin registro de caja'
            : (estaCerrada ? '🔴 Caja Cerrada' : '🟢 Caja Abierta'),
        estaCerrada: estaCerrada,
        sinRegistro: sinRegistro,
        ultimoCierre: estadoCaja.ultimoCierre,
        ultimaApertura: estadoCaja.ultimaApertura,
        esPrincipal: !!branch.esPrincipal,
        tieneDatos: false,
        ventasSinCostoUsd: 0,
        skusSinCosto: 0
    };
}

// Renderiza toda la Torre de Control
function renderTorreControl() {
    if (!isAdmin) return;

    const rate = Number(autoRates.bcv) || 36.5;
    const branchMetrics = holdingBranches.map(b => obtenerMetricasSucursal(b));

    // El consolidado suma SOLO las sucursales cuyos datos se pueden leer de
    // verdad. Antes se sumaban también las cifras hardcodeadas de las demás,
    // así que el "total de la red" era en buena parte ficción.
    const conDatos = branchMetrics.filter(m => m.tieneDatos);
    const sinDatos = branchMetrics.length - conDatos.length;

    let globalVentasUsd = 0;
    let globalGananciaUsd = 0;
    let globalFiadosUsd = 0;
    let globalDeudores = 0;
    let globalInvValUsd = 0;
    let globalSkus = 0;
    let ventasSinCostoUsd = 0;
    let skusSinCosto = 0;
    let cajasAbiertasCount = 0;
    let cajasCerradasCount = 0;
    let cajasSinRegistroCount = 0;

    conDatos.forEach(m => {
        globalVentasUsd += m.ventasUsd;
        globalGananciaUsd += m.gananciaUsd;
        globalFiadosUsd += m.fiadosUsd;
        globalDeudores += m.deudores;
        globalInvValUsd += m.invValUsd;
        globalSkus += m.skus;
        ventasSinCostoUsd += m.ventasSinCostoUsd || 0;
        skusSinCosto += m.skusSinCosto || 0;
        if (m.sinRegistro) cajasSinRegistroCount++;
        else if (m.estaCerrada) cajasCerradasCount++;
        else cajasAbiertasCount++;
    });

    const globalVentasBs = globalVentasUsd * rate;
    const margenGlobalPct = globalVentasUsd > 0 ? ((globalGananciaUsd / globalVentasUsd) * 100).toFixed(1) : 0;

    // Actualizar los KPIs. Los rótulos dicen explícitamente sobre cuántas
    // sucursales se está calculando: antes se presentaban como "Global" y "de
    // la red" cuando buena parte del número era inventado.
    const cobertura = sinDatos > 0
        ? ` (${conDatos.length}/${branchMetrics.length} sucursales)`
        : '';

    const elVentasUsd = document.getElementById('kpi-global-ventas-usd');
    if (elVentasUsd) elVentasUsd.textContent = `$${globalVentasUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const elVentasBs = document.getElementById('kpi-global-ventas-bs');
    if (elVentasBs) elVentasBs.textContent = `Bs ${globalVentasBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const elGananciaUsd = document.getElementById('kpi-global-ganancia-usd');
    if (elGananciaUsd) elGananciaUsd.textContent = `$${globalGananciaUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const elMargen = document.getElementById('kpi-global-margen');
    if (elMargen) {
        elMargen.textContent = globalVentasUsd > 0
            ? `Margen real: ${margenGlobalPct}%${cobertura}`
            : 'Margen real: sin ventas en el turno';
    }

    const elFiadosUsd = document.getElementById('kpi-global-fiados-usd');
    if (elFiadosUsd) elFiadosUsd.textContent = `$${globalFiadosUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const elFiadosClientes = document.getElementById('kpi-global-fiados-clientes');
    if (elFiadosClientes) elFiadosClientes.textContent = `${globalDeudores} cliente(s) con deuda`;

    const elInvVal = document.getElementById('kpi-global-valor-inventario');
    if (elInvVal) elInvVal.textContent = `$${globalInvValUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const elSkus = document.getElementById('kpi-global-total-skus');
    if (elSkus) elSkus.textContent = `${globalSkus} producto(s)${skusSinCosto > 0 ? ` · ${skusSinCosto} sin costo` : ''}`;

    const elSucursales = document.getElementById('kpi-global-sucursales-count');
    if (elSucursales) elSucursales.textContent = `${holdingBranches.length} sucursal(es)`;

    const elCajasAbiertas = document.getElementById('kpi-global-cajas-abiertas');
    if (elCajasAbiertas) {
        const partes = [];
        if (cajasAbiertasCount > 0) partes.push(`<span class="text-emerald-600 dark:text-emerald-400">🟢 ${cajasAbiertasCount} abierta(s)</span>`);
        if (cajasCerradasCount > 0) partes.push(`<span class="text-rose-600 dark:text-rose-400">🔴 ${cajasCerradasCount} cerrada(s)</span>`);
        if (cajasSinRegistroCount > 0) partes.push(`<span class="text-slate-500 dark:text-slate-400">⚪ ${cajasSinRegistroCount} sin registro</span>`);
        elCajasAbiertas.innerHTML = partes.length > 0
            ? partes.join(' / ')
            : '<span class="text-slate-400">Sin datos de caja</span>';
    }

    // Aviso honesto: qué NO está incluido en las cifras de arriba.
    const avisoEl = document.getElementById('torre-aviso-datos');
    if (avisoEl) {
        const partes = [];
        if (sinDatos > 0) {
            partes.push(`El consolidado incluye <b>${conDatos.length}</b> de <b>${branchMetrics.length}</b> sucursal(es). Las demás no se pueden leer desde este dispositivo, porque cada sucursal es un negocio distinto en la base de datos: usa <b>Entrar a esta Bodega</b> para consultarlas una por una.`);
        }
        if (ventasSinCostoUsd > 0) {
            partes.push(`La ganancia excluye <b>$${ventasSinCostoUsd.toFixed(2)}</b> en ventas de productos sin costo capturado (no se estima).`);
        }
        if (skusSinCosto > 0) {
            partes.push(`El inventario valorado excluye <b>${skusSinCosto}</b> producto(s) sin costo capturado.`);
        }
        if (cajasSinRegistroCount > 0) {
            partes.push(`<b>${cajasSinRegistroCount}</b> sucursal(es) no tienen un turno de caja abierto registrado.`);
        }
        if (partes.length === 0) {
            avisoEl.innerHTML = '';
            avisoEl.classList.add('hidden');
        } else {
            avisoEl.classList.remove('hidden');
            avisoEl.innerHTML = `
                <div class="p-3.5 rounded-2xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/60 mb-6 relative z-10 flex items-start gap-2.5">
                    <i class="fa-solid fa-circle-info text-amber-500 text-sm mt-0.5 shrink-0"></i>
                    <div class="text-[11px] leading-relaxed text-amber-800 dark:text-amber-200 font-medium">${partes.join('<br>')}</div>
                </div>`;
        }
    }

    // Renderizar Monitor de Tarjetas de Sucursal
    const gridEl = document.getElementById('torre-sucursales-grid');
    if (gridEl) {
        gridEl.innerHTML = branchMetrics.map(m => {
            const isCurrent = m.id === currentNegocioId;
            const ventasBs = m.ventasUsd * rate;
            // Tres estados reales: cerrada, abierta y SIN REGISTRO. Antes una
            // sucursal que nunca abrió caja se mostraba como "Caja Abierta".
            const badgeCaja = m.sinRegistro
                ? `<span class="text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-300 border border-slate-200 dark:border-slate-600/60 flex items-center gap-1.5"><i class="fa-solid fa-circle-question text-[9px]"></i> Sin registro</span>`
                : m.estaCerrada
                ? `<span class="text-[10px] font-black px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60 flex items-center gap-1.5"><i class="fa-solid fa-lock text-[9px]"></i> Caja Cerrada</span>`
                : `<span class="text-[10px] font-black px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60 flex items-center gap-1.5"><i class="fa-solid fa-circle text-[8px] text-emerald-500 animate-pulse"></i> Caja Abierta</span>`;

            // Sucursal cuyos datos no se pueden leer desde este equipo: se
            // muestra "—" en vez de ceros, que se leerían como "no vendió nada".
            const sinDatosBranch = !m.tieneDatos;
            const dash = '<span class="text-slate-300 dark:text-slate-600">—</span>';

            const infoCierreHtml = (m.estaCerrada && m.ultimoCierre) ? `
                <div class="mb-3 p-2.5 rounded-xl bg-rose-50/70 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 flex items-center justify-between text-[11px]">
                    <div class="truncate mr-2">
                        <span class="text-rose-600 dark:text-rose-400 font-bold block truncate"><i class="fa-solid fa-receipt mr-1"></i> Cerrada: ${m.ultimoCierre.fechaStr}</span>
                        <span class="text-[10px] text-slate-400 block truncate">Por: ${m.ultimoCierre.cajero}</span>
                    </div>
                    <span class="font-black text-rose-600 dark:text-rose-400 shrink-0">$${m.ultimoCierre.totalUsd ? m.ultimoCierre.totalUsd.toFixed(2) : '0.00'}</span>
                </div>
            ` : '';

            return `
                <div class="bg-white/90 dark:bg-slate-800/90 rounded-2xl p-5 border ${isCurrent ? 'border-primary-500 ring-2 ring-primary-500/20' : 'border-slate-200/80 dark:border-slate-700/80'} shadow-xs flex flex-col justify-between transition-all hover:shadow-md">
                    <div>
                        <div class="flex items-start justify-between mb-3 gap-2">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <h4 class="font-black text-slate-900 dark:text-white text-base truncate">${m.nombre}</h4>
                                    ${isCurrent ? '<span class="bg-emerald-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shrink-0">ACTIVA</span>' : ''}
                                </div>
                                <p class="text-[11px] text-slate-400 mt-0.5 truncate"><i class="fa-solid fa-location-dot mr-1"></i> ${m.direccion || 'Principal'}</p>
                            </div>
                            <div class="flex items-center gap-1 shrink-0">
                                <button type="button" onclick="abrirModalEditarSucursal('${m.id}')" title="Editar sucursal" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-indigo-50 dark:bg-slate-700/60 dark:hover:bg-indigo-950/50 text-slate-500 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-400 flex items-center justify-center text-xs transition-colors">
                                    <i class="fa-solid fa-pen-to-square"></i>
                                </button>
                                ${!m.esPrincipal ? `
                                <button type="button" onclick="eliminarSucursal('${m.id}')" title="Eliminar sucursal" class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-rose-50 dark:bg-slate-700/60 dark:hover:bg-rose-950/50 text-slate-500 hover:text-rose-600 dark:text-slate-300 dark:hover:text-rose-400 flex items-center justify-center text-xs transition-colors">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>` : ''}
                                ${badgeCaja}
                            </div>
                        </div>

                        ${infoCierreHtml}

                        <!-- Indicador de Cajero en Turno -->
                        <div class="flex items-center gap-2 mb-4 p-2 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs">
                            <i class="fa-solid fa-user-tag text-indigo-500 text-xs"></i>
                            <span class="text-slate-400 font-bold">Cajero en Turno:</span>
                            <span class="font-black text-slate-800 dark:text-slate-200 truncate">${m.cajero}</span>
                        </div>

                        <!-- Métricas de la tienda -->
                        <div class="grid grid-cols-2 gap-2.5 mb-4">
                            <div class="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/40">
                                <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 block">${m.estaCerrada ? 'Ventas Turno (Cerrado)' : 'Ventas Hoy (Turno)'}</span>
                                <span class="text-base font-black text-slate-900 dark:text-white tabular-nums">${sinDatosBranch ? dash : '$' + m.ventasUsd.toFixed(2)}</span>
                                <span class="text-[10px] text-slate-400 block">${sinDatosBranch ? 'Sin datos en este equipo' : 'Bs ' + ventasBs.toFixed(2)}</span>
                            </div>
                            <div class="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/40">
                                <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Fiados en Calle</span>
                                <span class="text-base font-black text-amber-600 dark:text-amber-400 tabular-nums">${sinDatosBranch ? dash : '$' + m.fiadosUsd.toFixed(2)}</span>
                                <span class="text-[10px] text-slate-400 block">${sinDatosBranch ? 'Sin datos en este equipo' : m.deudores + ' cliente(s)'}</span>
                            </div>
                            <div class="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/40 col-span-2 flex justify-between items-center">
                                <div>
                                    <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Inventario Valorado</span>
                                    <span class="text-xs font-black text-slate-700 dark:text-slate-300 tabular-nums">${sinDatosBranch ? dash : '$' + m.invValUsd.toFixed(2)}</span>
                                </div>
                                <span class="text-xs font-bold text-slate-400">${sinDatosBranch ? 'Sin datos' : m.skus + ' producto(s)' + (m.skusSinCosto > 0 ? ` · ${m.skusSinCosto} sin costo` : '')}</span>
                            </div>
                        </div>
                    </div>

                    <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2">
                        <div class="flex items-center gap-2">
                            ${sinDatosBranch ? `
                                <span class="flex-1 py-2 text-center text-[11px] font-bold text-slate-400">Su caja se gestiona desde su propio dispositivo</span>
                            ` : (m.estaCerrada || m.sinRegistro) ? `
                                <button type="button" onclick="abrirCajaTurnoSucursal('${m.id}')" class="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors">
                                    <i class="fa-solid fa-lock-open text-xs"></i> Abrir Nueva Caja
                                </button>
                            ` : `
                                <button type="button" onclick="cerrarCajaDirectoTorre('${m.id}')" class="flex-1 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 font-black text-xs flex items-center justify-center gap-1.5 border border-rose-200 dark:border-rose-800 transition-colors">
                                    <i class="fa-solid fa-calculator text-xs"></i> Arqueo / Cierre
                                </button>
                            `}
                        </div>
                        <div class="flex items-center gap-2">
                            ${!isCurrent ? `
                                <button type="button" onclick="cambiarSucursalActiva('${m.id}')" class="w-full py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors">
                                    <i class="fa-solid fa-arrow-right-to-bracket text-xs"></i> Entrar a esta Bodega
                                </button>
                            ` : `
                                <button type="button" onclick="switchTab('ventas')" class="w-full py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-black text-xs flex items-center justify-center gap-1.5 transition-colors">
                                    <i class="fa-solid fa-cash-register text-xs"></i> Ir a Facturar (POS)
                                </button>
                            `}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Renderizar Barras de Participación de Ventas
    const barrasEl = document.getElementById('torre-comparativa-barras');
    if (barrasEl) {
        barrasEl.innerHTML = branchMetrics.map(m => {
            // Las sucursales sin datos no entran en el reparto de porcentajes:
            // un 0% se leería como "no vendió", cuando en realidad es "no se
            // puede leer desde este equipo".
            if (!m.tieneDatos) {
                return `
                    <div class="opacity-60">
                        <div class="flex justify-between items-center text-xs font-bold mb-1">
                            <span class="text-slate-500 dark:text-slate-400 flex items-center gap-2">
                                <i class="fa-solid fa-store text-slate-400 text-xs"></i> ${m.nombre}
                            </span>
                            <span class="text-slate-400 font-medium">Sin datos en este equipo</span>
                        </div>
                        <div class="w-full h-2.5 bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden"></div>
                    </div>
                `;
            }
            const pct = globalVentasUsd > 0 ? ((m.ventasUsd / globalVentasUsd) * 100).toFixed(1) : 0;
            return `
                <div>
                    <div class="flex justify-between items-center text-xs font-bold mb-1">
                        <span class="text-slate-800 dark:text-slate-200 flex items-center gap-2">
                            <i class="fa-solid fa-store text-primary-500 text-xs"></i> ${m.nombre}
                        </span>
                        <span class="text-slate-600 dark:text-slate-300 tabular-nums">$${m.ventasUsd.toFixed(2)} <span class="text-primary-600 font-black">(${pct}%)</span></span>
                    </div>
                    <div class="w-full h-2.5 bg-slate-100 dark:bg-slate-700/60 rounded-full overflow-hidden">
                        <div class="h-full bg-gradient-to-r from-primary-500 to-indigo-600 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Renderizar Historial de Traspasos
    renderTablaTraspasos();
}

// Actualiza manualmente con feedback visual
function actualizarTorreControl() {
    renderTorreControl();
    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'info',
        title: '📊 Torre de Control Actualizada',
        text: 'Datos consolidados sincronizados',
        showConfirmButton: false,
        timer: 1500
    });
}

// Renderiza la tabla de traspasos en la Torre de Control
function renderTablaTraspasos() {
    const tbody = document.getElementById('tabla-traspasos-body');
    if (!tbody) return;

    if (!holdingTransfers || holdingTransfers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-slate-400">Sin traspasos registrados</td></tr>`;
        return;
    }

    tbody.innerHTML = holdingTransfers.slice(0, 10).map(t => `
        <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors">
            <td class="py-2.5 text-slate-500 text-[11px]">${t.fecha}</td>
            <td class="py-2.5 font-bold text-rose-600 dark:text-rose-400">
                <i class="fa-solid fa-arrow-up-right-from-square text-[10px] mr-1"></i>${t.origenNombre}
            </td>
            <td class="py-2.5 font-bold text-emerald-600 dark:text-emerald-400">
                <i class="fa-solid fa-arrow-down-left-and-up-right-to-center text-[10px] mr-1"></i>${t.destinoNombre}
            </td>
            <td class="py-2.5 font-black text-slate-800 dark:text-slate-100">${t.producto}</td>
            <td class="py-2.5 text-right font-black tabular-nums text-slate-900 dark:text-white">${t.cantidad} un.</td>
            <td class="py-2.5 text-slate-400 text-[11px]">${t.motivo || 'Traspaso de stock'}</td>
        </tr>
    `).join('');
}

// ======================================================================================
// MOTOR DE TRASPASO DE MERCANCÍA ENTRE BODEGAS
// ======================================================================================

function abrirModalTraspasoStock() {
    const modal = document.getElementById('traspaso-stock-modal');
    if (!modal) return;

    // Llenar selects de origen y destino
    const origenSel = document.getElementById('traspaso-origen');
    const destinoSel = document.getElementById('traspaso-destino');

    if (origenSel && destinoSel) {
        origenSel.innerHTML = holdingBranches.map(b => 
            `<option value="${b.id}" ${b.id === currentNegocioId ? 'selected' : ''}>${b.nombre}</option>`
        ).join('');

        destinoSel.innerHTML = holdingBranches.map((b, idx) => 
            `<option value="${b.id}" ${b.id !== currentNegocioId ? 'selected' : ''}>${b.nombre}</option>`
        ).join('');
    }

    actualizarProductosTraspaso();

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div')?.classList.remove('scale-95');
    }, 10);
}

function cerrarModalTraspasoStock() {
    const modal = document.getElementById('traspaso-stock-modal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    modal.querySelector('div')?.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 250);
}

// Llena los productos de la sucursal de origen elegida
function actualizarProductosTraspaso() {
    const origenId = document.getElementById('traspaso-origen')?.value;
    const prodSel = document.getElementById('traspaso-producto');
    if (!prodSel) return;

    // Si el origen es la sucursal activa, tomamos los productos en memoria
    let listaProds = [];
    if (origenId === currentNegocioId) {
        listaProds = products.filter(p => (Number(p.stock) || 0) > 0);
    } else {
        // Obtenemos del catálogo maestro / cache local
        listaProds = products.length > 0 ? products : (typeof VENEZUELA_MASTER_CATALOG !== 'undefined' ? VENEZUELA_MASTER_CATALOG.map(v => ({ id: v.codigo, nombre: v.nombre, stock: 20 })) : []);
    }

    if (listaProds.length === 0) {
        prodSel.innerHTML = `<option value="">No hay productos con stock en esta bodega</option>`;
        mostrarStockTraspaso();
        return;
    }

    prodSel.innerHTML = `
        <option value="">Selecciona un producto...</option>
        ${listaProds.map(p => `<option value="${p.id}" data-stock="${p.stock || 0}" data-nombre="${p.nombre}">${p.nombre} (Stock: ${p.stock || 0})</option>`).join('')}
    `;

    mostrarStockTraspaso();
}

function mostrarStockTraspaso() {
    const prodSel = document.getElementById('traspaso-producto');
    const badge = document.getElementById('traspaso-stock-disponible');
    if (!prodSel || !badge) return;

    const opt = prodSel.options[prodSel.selectedIndex];
    const stock = opt ? Number(opt.getAttribute('data-stock') || 0) : 0;
    badge.textContent = `Stock disponible: ${stock}`;
}

// Ejecuta el traspaso atómico entre bodegas
async function ejecutarTraspasoStock(event) {
    if (event) event.preventDefault();

    const origenId = document.getElementById('traspaso-origen')?.value;
    const destinoId = document.getElementById('traspaso-destino')?.value;
    const prodSel = document.getElementById('traspaso-producto');
    const cantInput = document.getElementById('traspaso-cantidad');
    const motivoInput = document.getElementById('traspaso-motivo');

    if (!origenId || !destinoId || !prodSel || !cantInput) return;

    if (origenId === destinoId) {
        return Swal.fire('Error', 'La bodega de origen y destino deben ser distintas.', 'warning');
    }

    // Con el aislamiento por inquilino, este dispositivo solo puede escribir en
    // SU negocio. Cada sucursal es un negocio distinto, así que un traspaso real
    // entre dos sucursales no se puede completar desde aquí.
    //
    // ANTES el código solo ajustaba el stock del lado que coincidía con la
    // tienda activa; como origen y destino son distintos, a lo sumo uno de los
    // dos se tocaba. Aun así mostraba "¡Traspaso Completado!" y "Inventario
    // recalculado en ambas tiendas": o el stock desaparecía del origen, o se
    // creaba de la nada en el destino. Encima escribía un valor ABSOLUTO de
    // stock calculado sobre la caché local, que podía pisar ventas concurrentes.
    if (origenId !== negocioAsignado || destinoId !== negocioAsignado) {
        return Swal.fire({
            title: 'Traspaso no disponible',
            html: `<p class="text-xs text-slate-600 dark:text-slate-300">Este dispositivo solo puede modificar el inventario de <b>${negocioAsignado || 'su negocio'}</b>.</p>
                   <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">Un traspaso mueve mercancía entre dos negocios distintos, y las reglas de seguridad impiden escribir en el negocio ajeno. Hace falta el modelo de holding para habilitarlo.</p>`,
            icon: 'info',
            confirmButtonColor: '#4f46e5'
        });
    }

    const prodId = prodSel.value;
    const opt = prodSel.options[prodSel.selectedIndex];
    const prodNombre = opt?.getAttribute('data-nombre') || 'Producto';
    const stockDisp = Number(opt?.getAttribute('data-stock') || 0);
    const cantidad = parseFloat(cantInput.value || 0);

    if (!prodId) {
        return Swal.fire('Atención', 'Por favor selecciona un producto a traspasar.', 'warning');
    }

    if (cantidad <= 0) {
        return Swal.fire('Atención', 'Ingresa una cantidad mayor a cero.', 'warning');
    }

    if (cantidad > stockDisp) {
        return Swal.fire('Stock Insuficiente', `La bodega de origen solo dispone de ${stockDisp} unidades de este producto.`, 'error');
    }

    const origenBranch = holdingBranches.find(b => b.id === origenId) || { nombre: origenId };
    const destinoBranch = holdingBranches.find(b => b.id === destinoId) || { nombre: destinoId };
    const motivo = (motivoInput?.value || '').trim() || 'Traspaso entre bodegas';

    // Descontar en origen si es la tienda activa
    if (origenId === currentNegocioId) {
        const prod = products.find(p => p.id === prodId);
        if (prod) {
            prod.stock = Math.max(0, (Number(prod.stock) || 0) - cantidad);
            try {
                if (navigator.onLine && db) {
                    await getDb('products').doc(prodId).update({ stock: prod.stock });
                }
            } catch (err) {
                console.warn('Error sincronizando decremento en Firestore:', err);
            }
        }
    }

    // Incrementar en destino si es la tienda activa
    if (destinoId === currentNegocioId) {
        const prodDest = products.find(p => p.id === prodId || p.nombre.toLowerCase() === prodNombre.toLowerCase());
        if (prodDest) {
            prodDest.stock = (Number(prodDest.stock) || 0) + cantidad;
            try {
                if (navigator.onLine && db) {
                    await getDb('products').doc(prodDest.id).update({ stock: prodDest.stock });
                }
            } catch (err) {
                console.warn('Error sincronizando incremento en Firestore:', err);
            }
        }
    }

    // Registrar en el log de traspasos
    const now = new Date();
    const fechaStr = `${now.toLocaleDateString('es-VE')} ${now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`;
    const nuevoTraspaso = {
        id: `TRF-${Date.now().toString().slice(-4)}`,
        fecha: fechaStr,
        origenId: origenId,
        origenNombre: origenBranch.nombre,
        destinoId: destinoId,
        destinoNombre: destinoBranch.nombre,
        producto: prodNombre,
        cantidad: cantidad,
        motivo: motivo
    };

    holdingTransfers.unshift(nuevoTraspaso);
    localStorage.setItem('holding_transfers', JSON.stringify(holdingTransfers));

    cerrarModalTraspasoStock();

    Swal.fire({
        title: '¡Traspaso Completado!',
        html: `
            <div class="text-left text-xs space-y-2 bg-slate-50 dark:bg-slate-800 p-4 rounded-xl">
                <p><b>Producto:</b> ${prodNombre}</p>
                <p><b>Cantidad:</b> ${cantidad} unidades</p>
                <p><b>Origen:</b> <span class="text-rose-600 font-bold">${origenBranch.nombre}</span> (-${cantidad})</p>
                <p><b>Destino:</b> <span class="text-emerald-600 font-bold">${destinoBranch.nombre}</span> (+${cantidad})</p>
                <p class="text-slate-400 mt-2">Inventario recalculado en ambas tiendas.</p>
            </div>
        `,
        icon: 'success',
        confirmButtonColor: '#0d9488'
    });

    renderTorreControl();
    if (typeof renderInventory === 'function') renderInventory();
}

// ======================================================================================
// GESTIÓN DE NUEVA SUCURSAL / BODEGA
// ======================================================================================

function abrirModalNuevaSucursal() {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Solo administradores pueden agregar sucursales.', 'warning');
    }
    const modal = document.getElementById('nueva-sucursal-modal');
    if (!modal) return;

    document.getElementById('suc-edit-mode').value = 'crear';
    document.getElementById('modal-sucursal-titulo').textContent = 'Nueva Sucursal';
    document.getElementById('modal-sucursal-subtitulo').textContent = 'Agregar un nuevo punto de venta / minimarket';

    document.getElementById('nueva-suc-nombre').value = '';
    const idInput = document.getElementById('nueva-suc-id');
    if (idInput) {
        idInput.value = '';
        idInput.disabled = false;
    }
    document.getElementById('nueva-suc-direccion').value = '';
    document.getElementById('nueva-suc-telefono').value = '';
    document.getElementById('nueva-suc-fondo').value = '20.00';

    const selCajero = document.getElementById('nueva-suc-cajero');
    if (selCajero) {
        selCajero.innerHTML = `
            <option value="Sin asignar">Sin cajero asignado</option>
            ${(typeof cajerosList !== 'undefined' ? cajerosList : []).map(c => `
                <option value="${c.nombre}">${c.nombre} (${c.usuario})</option>
            `).join('')}
        `;
    }

    const btnText = document.getElementById('btn-submit-sucursal-text');
    if (btnText) btnText.textContent = 'Crear Sucursal';
    const btnIcon = document.getElementById('btn-submit-sucursal-icon');
    if (btnIcon) btnIcon.className = 'fa-solid fa-plus';

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div')?.classList.remove('scale-95');
    }, 10);
}

function abrirModalEditarSucursal(branchId) {
    if (!isAdmin) {
        return Swal.fire('Acceso Restringido', 'Solo administradores pueden editar sucursales.', 'warning');
    }
    const branch = holdingBranches.find(b => b.id === branchId);
    if (!branch) return;

    const modal = document.getElementById('nueva-sucursal-modal');
    if (!modal) return;

    document.getElementById('suc-edit-mode').value = branch.id;
    document.getElementById('modal-sucursal-titulo').textContent = `Editar ${branch.nombre}`;
    document.getElementById('modal-sucursal-subtitulo').textContent = 'Modifica los datos operativos de esta sucursal';

    document.getElementById('nueva-suc-nombre').value = branch.nombre;
    const idInput = document.getElementById('nueva-suc-id');
    if (idInput) {
        idInput.value = branch.id;
        idInput.disabled = true;
    }
    document.getElementById('nueva-suc-direccion').value = branch.direccion || '';
    document.getElementById('nueva-suc-telefono').value = normalizarTelefono(branch.telefono);
    // Sin fondo inventado: antes ponía 20 por defecto aunque nadie lo hubiera
    // declarado.
    document.getElementById('nueva-suc-fondo').value = branch.fondoCaja || 0;

    const selCajero = document.getElementById('nueva-suc-cajero');
    if (selCajero) {
        selCajero.innerHTML = `
            <option value="Sin asignar">Sin cajero asignado</option>
            ${(typeof cajerosList !== 'undefined' ? cajerosList : []).map(c => `
                <option value="${c.nombre}" ${branch.cajeroAsignado === c.nombre ? 'selected' : ''}>${c.nombre} (${c.usuario})</option>
            `).join('')}
        `;
    }

    const btnText = document.getElementById('btn-submit-sucursal-text');
    if (btnText) btnText.textContent = 'Guardar Cambios';
    const btnIcon = document.getElementById('btn-submit-sucursal-icon');
    if (btnIcon) btnIcon.className = 'fa-solid fa-floppy-disk';

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div')?.classList.remove('scale-95');
    }, 10);
}

function cerrarModalNuevaSucursal() {
    const modal = document.getElementById('nueva-sucursal-modal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    modal.querySelector('div')?.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 250);
}

function guardarNuevaSucursal(event) {
    if (event) event.preventDefault();

    const editMode = document.getElementById('suc-edit-mode')?.value || 'crear';
    const nombre = (document.getElementById('nueva-suc-nombre')?.value || '').trim();
    const direccion = (document.getElementById('nueva-suc-direccion')?.value || '').trim();
    const telefono = normalizarTelefono(document.getElementById('nueva-suc-telefono')?.value || '');
    const fondo = parseFloat(document.getElementById('nueva-suc-fondo')?.value || 0);
    const cajero = document.getElementById('nueva-suc-cajero')?.value || 'Sin asignar';

    if (!nombre) {
        return Swal.fire('Error', 'Completa el nombre de la sucursal.', 'warning');
    }

    if (editMode === 'crear') {
        const idRaw = (document.getElementById('nueva-suc-id')?.value || '').trim().toLowerCase().replace(/\s+/g, '-');
        if (!idRaw) {
            return Swal.fire('Error', 'Completa el ID único de la sucursal.', 'warning');
        }
        if (holdingBranches.some(b => b.id === idRaw)) {
            return Swal.fire('Error', 'Ya existe una sucursal con ese ID en el holding.', 'error');
        }

        const nuevaSuc = {
            id: idRaw,
            nombre: nombre,
            direccion: direccion || 'Sin dirección',
            telefono: telefono || '',
            fondoCaja: fondo,
            cajeroAsignado: cajero,
            esPrincipal: false
        };

        holdingBranches.push(nuevaSuc);
        guardarListaLocal('holding_branches', holdingBranches);

        // NO se inventa un turno de caja abierto. Antes se guardaba estado
        // 'abierta' con la fecha de hoy y el fondo tecleado, aunque nadie
        // hubiera abierto nada. La sucursal queda en 'sin_registro' hasta que
        // se abra la caja de verdad.

        cerrarModalNuevaSucursal();
        actualizarIndicadorSucursalActiva();
        renderBranchDropdown();
        renderTorreControl();

        Swal.fire({
            title: 'Sucursal agregada a la lista',
            html: `<p class="text-xs text-slate-600 dark:text-slate-300">Se registró <b>${nombre}</b> (ID: <code>${idRaw}</code>) en la lista local de sucursales.</p>
                   <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">Ojo: <b>esto no crea un negocio nuevo</b> en la base de datos, solo añade la ficha. Sus ventas, inventario y clientes se verán cuando exista una cuenta asignada a esa sucursal.</p>`,
            icon: 'info',
            confirmButtonColor: '#4f46e5'
        });
    } else {
        const branchIdx = holdingBranches.findIndex(b => b.id === editMode);
        if (branchIdx === -1) return;

        holdingBranches[branchIdx].nombre = nombre;
        holdingBranches[branchIdx].direccion = direccion || 'Sin dirección';
        holdingBranches[branchIdx].telefono = telefono || '';
        holdingBranches[branchIdx].fondoCaja = fondo;
        holdingBranches[branchIdx].cajeroAsignado = cajero;

        localStorage.setItem('holding_branches', JSON.stringify(holdingBranches));

        cerrarModalNuevaSucursal();
        actualizarIndicadorSucursalActiva();
        renderBranchDropdown();
        renderTorreControl();

        Swal.fire({
            title: '¡Sucursal Actualizada!',
            text: `Los datos de "${nombre}" fueron guardados exitosamente.`,
            icon: 'success',
            timer: 2000,
            showConfirmButton: false
        });
    }
}

async function eliminarSucursal(branchId) {
    if (!isAdmin) {
        return Swal.fire('Acceso Denegado', 'Solo el Dueño/Administrador puede eliminar sucursales.', 'error');
    }
    const branch = holdingBranches.find(b => b.id === branchId);
    if (!branch) return;

    if (branch.esPrincipal) {
        return Swal.fire({
            title: 'Sucursal Principal Protegida',
            text: `"${branch.nombre}" es la sede matriz del holding y no puede ser eliminada. Puedes editar su nombre, dirección o teléfono si lo deseas.`,
            icon: 'info',
            confirmButtonColor: '#4f46e5'
        });
    }

    if (holdingBranches.length <= 1) {
        return Swal.fire('Aviso', 'Debes tener al menos una sucursal activa en el sistema.', 'warning');
    }

    const confirmRes = await Swal.fire({
        title: `¿Eliminar "${branch.nombre}"?`,
        html: `
            <div class="text-left text-xs space-y-2 text-slate-600 dark:text-slate-300">
                <p>Esta acción desvinculará la sucursal <b>${branch.nombre}</b> de la Torre de Control y de la red de tiendas.</p>
                <p class="text-rose-500 font-bold"><i class="fa-solid fa-triangle-exclamation mr-1"></i> Esta acción no se puede deshacer.</p>
            </div>
        `,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#e11d48',
        cancelButtonColor: '#64748b',
        confirmButtonText: '<i class="fa-solid fa-trash-can mr-1"></i> Sí, Eliminar Tienda',
        cancelButtonText: 'Cancelar'
    });

    if (!confirmRes.isConfirmed) return;

    // Si es la tienda activa actual, cambiar a la principal antes de eliminar
    if (currentNegocioId === branchId) {
        const fallbackBranch = holdingBranches.find(b => b.id !== branchId) || holdingBranches[0];
        currentNegocioId = fallbackBranch.id;
        localStorage.setItem('active_branch_id', fallbackBranch.id);
        setupFirebaseListeners();
    }

    holdingBranches = holdingBranches.filter(b => b.id !== branchId);
    localStorage.setItem('holding_branches', JSON.stringify(holdingBranches));
    localStorage.removeItem(`caja_status_${branchId}`);
    localStorage.removeItem(`branch_metrics_${branchId}`);

    try {
        if (db && typeof db.collection === 'function') {
            db.collection('cajas_sucursales').doc(branchId).delete().catch(() => {});
        }
    } catch(e) {}

    actualizarIndicadorSucursalActiva();
    renderBranchDropdown();
    if (typeof renderTorreControl === 'function') renderTorreControl();

    Swal.fire({
        title: '¡Sucursal Eliminada!',
        text: `La sucursal "${branch.nombre}" fue removida exitosamente.`,
        icon: 'success',
        timer: 2000,
        showConfirmButton: false
    });
}

// ======================================================================================
// GESTIÓN DE CAJEROS INDEPENDIENTES POR SUCURSAL
// ======================================================================================

function abrirModalGestionCajeros() {
    const modal = document.getElementById('gestion-cajeros-modal');
    if (!modal) return;

    // Llenar select de sucursales
    const sucursalSel = document.getElementById('cajero-sucursal');
    if (sucursalSel) {
        sucursalSel.innerHTML = holdingBranches.map(b => 
            `<option value="${b.id}">${b.nombre}</option>`
        ).join('');
    }

    renderTablaCajeros();

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div')?.classList.remove('scale-95');
    }, 10);
}

function cerrarModalGestionCajeros() {
    const modal = document.getElementById('gestion-cajeros-modal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    modal.querySelector('div')?.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 250);
}

function renderTablaCajeros() {
    const tbody = document.getElementById('tabla-cajeros-body');
    if (!tbody) return;

    if (!cajerosList || cajerosList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">Sin cajeros asignados actualmente</td></tr>`;
        return;
    }

    tbody.innerHTML = cajerosList.map(c => {
        const branch = holdingBranches.find(b => b.id === c.sucursalId) || { nombre: c.sucursalId };
        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors">
                <td class="p-3">
                    <p class="font-bold text-slate-900 dark:text-white">${c.nombre}</p>
                    <p class="text-[10px] text-slate-400">${c.usuario}</p>
                </td>
                <td class="p-3">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                        <i class="fa-solid fa-store text-[9px]"></i> ${branch.nombre}
                    </span>
                </td>
                <td class="p-3 font-semibold text-xs text-slate-600 dark:text-slate-400">${c.rol}</td>
                <td class="p-3 text-right">
                    <button type="button" onclick="eliminarCajeroAsignado('${c.id}')" class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors" title="Desvincular cajero">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function guardarNuevoCajeroAsignado(event) {
    if (event) event.preventDefault();

    const nombre = (document.getElementById('cajero-nombre')?.value || '').trim();
    const usuario = (document.getElementById('cajero-usuario')?.value || '').trim();
    const sucursalId = document.getElementById('cajero-sucursal')?.value;
    const pin = document.getElementById('cajero-pin')?.value;

    if (!nombre || !usuario || !sucursalId || !pin) {
        return Swal.fire('Error', 'Completa todos los campos para asignar el cajero.', 'warning');
    }

    const branch = holdingBranches.find(b => b.id === sucursalId);

    const nuevoCajero = {
        id: `caj-${Date.now()}`,
        nombre: nombre,
        usuario: usuario,
        sucursalId: sucursalId,
        rol: 'Cajero',
        activo: true
    };

    cajerosList.push(nuevoCajero);
    localStorage.setItem('holding_cajeros', JSON.stringify(cajerosList));

    // Asignar al branch el nombre del cajero
    if (branch) {
        branch.cajeroAsignado = nombre;
        localStorage.setItem('holding_branches', JSON.stringify(holdingBranches));
    }

    // Resetear formulario
    document.getElementById('cajero-nombre').value = '';
    document.getElementById('cajero-usuario').value = '';
    document.getElementById('cajero-pin').value = '';

    renderTablaCajeros();
    renderTorreControl();

    Swal.fire({
        title: '¡Cajero Asignado!',
        text: `${nombre} fue asignado exclusivamente a ${branch?.nombre}. Solo tendrá acceso al inventario y ventas de dicha sucursal.`,
        icon: 'success',
        confirmButtonColor: '#4f46e5'
    });
}

function eliminarCajeroAsignado(id) {
    Swal.fire({
        title: '¿Desvincular Cajero?',
        text: 'El cajero perderá el acceso a la sucursal.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, desvincular',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#e11d48'
    }).then(res => {
        if (res.isConfirmed) {
            cajerosList = cajerosList.filter(c => c.id !== id);
            localStorage.setItem('holding_cajeros', JSON.stringify(cajerosList));
            renderTablaCajeros();
            Swal.fire('Desvinculado', 'El cajero ha sido removido.', 'success');
        }
    });
}

// Inicializar la suite en DOMContentLoaded también por seguridad
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initMultiBranchSuite, 300);
    });
} else {
    setTimeout(initMultiBranchSuite, 300);
}

// ======================================================================================
// CENTRO DE PEDIDOS ONLINE EN TIEMPO REAL (CATÁLOGO WEB & WHATSAPP)
// ======================================================================================

let pedidosOnlineList = [];
let filtroPedidosOnline = 'pendientes';
let audioCtx = null;
let knownPedidoIds = new Set();
let sessionStartTime = Date.now();

// Chime melódico sintetizado con Web Audio API (Cero dependencias externas de audio)
function reproducirChimeNuevoPedido() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const now = audioCtx.currentTime;
        // Tono 1: Sol 5 (783.99 Hz)
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(783.99, now);
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.35, now + 0.04);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.start(now);
        osc1.stop(now + 0.35);

        // Tono 2: Do 6 (1046.50 Hz) - efecto campana brillante
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1046.50, now + 0.15);
        gain2.gain.setValueAtTime(0, now + 0.15);
        gain2.gain.linearRampToValueAtTime(0.4, now + 0.20);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.70);
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.start(now + 0.15);
        osc2.stop(now + 0.70);
    } catch (e) {
        console.warn("Aviso de audio:", e);
    }
}

function probarNotificacionSonido() {
    reproducirChimeNuevoPedido();
    Swal.fire({
        title: '¡Timbre de Notificación Activo!',
        text: 'Este es el sonido que escucharás al recibir un pedido del catálogo online.',
        icon: 'success',
        timer: 1800,
        showConfirmButton: false
    });
}

// Muestra Toast flotante con animación en pantalla
function mostrarToastNuevoPedido(pedido) {
    reproducirChimeNuevoPedido();

    // Notificación nativa del navegador si la pestaña está en segundo plano
    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            new Notification('🛍️ ¡Nuevo Pedido Web Recibido!', {
                body: `${pedido.cliente} • $${pedido.totalUsd?.toFixed(2)} (${pedido.entrega || 'Delivery'})`,
                icon: 'https://cdn-icons-png.flaticon.com/512/3081/3081840.png'
            });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
        }
    }

    const container = document.getElementById('toast-pedidos-online-container');
    if (!container) return;

    const toastId = 'toast-' + pedido.id + '-' + Date.now();
    const itemsPreview = (pedido.items || []).slice(0, 2).map(i => `${i.qty}x ${i.nombre}`).join(', ');
    const itemsExtra = (pedido.items || []).length > 2 ? ` (+${pedido.items.length - 2} más)` : '';

    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = "pointer-events-auto bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border-2 border-indigo-500/80 rounded-2xl p-4 shadow-2xl shadow-indigo-500/20 transform translate-x-8 opacity-0 transition-all duration-300 flex flex-col gap-2.5";
    toast.innerHTML = `
        <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-xl bg-indigo-500 text-white flex items-center justify-center text-xs animate-bounce shadow-xs">
                    <i class="fa-solid fa-bell"></i>
                </div>
                <div>
                    <h5 class="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span>¡Nuevo Pedido Online!</span>
                        <span class="text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.2 rounded-md">#${pedido.id}</span>
                    </h5>
                    <p class="text-[11px] text-slate-400 font-bold">${pedido.fechaStr || 'Hace un momento'}</p>
                </div>
            </div>
            <button onclick="document.getElementById('${toastId}')?.remove()" class="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1 text-xs transition-colors">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>

        <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-800 text-xs">
            <div class="flex items-center justify-between font-black text-slate-800 dark:text-slate-100 mb-1">
                <span class="truncate mr-2"><i class="fa-solid fa-user text-indigo-500 mr-1 text-[11px]"></i>${pedido.cliente}</span>
                <span class="text-emerald-600 dark:text-emerald-400 shrink-0">$${(pedido.totalUsd || 0).toFixed(2)}</span>
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate">${itemsPreview}${itemsExtra}</p>
            <div class="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px] font-bold text-slate-400">
                <span><i class="fa-solid fa-motorcycle text-indigo-400 mr-1"></i>${pedido.entrega || 'Delivery'}</span>
                <span>•</span>
                <span><i class="fa-solid fa-wallet text-amber-500 mr-1"></i>${pedido.formaPago || 'Pago Móvil'}</span>
            </div>
        </div>

        <div class="flex items-center gap-2 pt-1">
            <button onclick="cargarPedidoAlPOS('${pedido.id}'); document.getElementById('${toastId}')?.remove();" class="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-[11px] flex items-center justify-center gap-1.5 shadow-xs transition-colors">
                <i class="fa-solid fa-cash-register text-[10px]"></i> Cargar al POS
            </button>
            <button onclick="abrirModalPedidosOnline(); document.getElementById('${toastId}')?.remove();" class="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[11px] transition-colors">
                Ver Todo
            </button>
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('translate-x-8', 'opacity-0');
    }, 20);

    // Auto-remover a los 16 segundos
    setTimeout(() => {
        if (toast && toast.parentNode) {
            toast.classList.add('opacity-0', 'translate-x-8');
            setTimeout(() => toast.remove(), 350);
        }
    }, 16000);
}

// Actualiza el indicador en el header
function actualizarBadgePedidosOnline() {
    const badge = document.getElementById('badge-pedidos-online');
    const ping = document.getElementById('ping-pedidos-online');
    const dot = document.getElementById('dot-pedidos-online');
    const countTab = document.getElementById('count-filtro-pendientes');
    const badgeTotalModal = document.getElementById('pedidos-online-total-badge');

    const pendientes = pedidosOnlineList.filter(p => p.estado === 'pendiente');
    const count = pendientes.length;

    if (countTab) countTab.textContent = count;
    if (badgeTotalModal) badgeTotalModal.textContent = `${pedidosOnlineList.length} pedidos (${count} pendientes)`;

    if (badge) {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.classList.remove('hidden');
            if (ping) ping.classList.remove('hidden');
            if (dot) dot.className = "inline-flex rounded-full h-2 w-2 bg-rose-500";
        } else {
            badge.classList.add('hidden');
            if (ping) ping.classList.add('hidden');
            if (dot) dot.className = "inline-flex rounded-full h-2 w-2 bg-indigo-500";
        }
    }
}

// Suscripción en tiempo real a la colección de pedidos online
function listenPedidosOnline() {
    if (!currentNegocioId) return;

    try {
        const unsubscribe = getDb('pedidos_online')
            .orderBy('timestamp', 'desc')
            .limit(60)
            .onSnapshot((snapshot) => {
                let nuevosPedidosDetectados = [];
                const nuevaLista = [];

                snapshot.forEach(doc => {
                    const data = { id: doc.id, ...doc.data() };
                    nuevaLista.push(data);

                    if (!knownPedidoIds.has(doc.id)) {
                        knownPedidoIds.add(doc.id);
                        // Si es nuevo, está pendiente y se creó recientemente (en esta sesión o hace menos de 10 min)
                        if (data.estado === 'pendiente') {
                            const tiempoPedido = data.timestamp ? (data.timestamp.toMillis ? data.timestamp.toMillis() : Date.now()) : Date.now();
                            if (tiempoPedido >= (sessionStartTime - 600000)) {
                                nuevosPedidosDetectados.push(data);
                            }
                        }
                    }
                });

                pedidosOnlineList = nuevaLista;
                actualizarBadgePedidosOnline();
                renderPedidosOnlineList();

                // Disparar alertas para cada pedido nuevo entrante
                nuevosPedidosDetectados.forEach(pedido => {
                    mostrarToastNuevoPedido(pedido);
                });
            }, (error) => {
                console.warn("Aviso al escuchar pedidos_online:", error);
            });

        if (typeof activeListeners !== 'undefined') {
            activeListeners.push(unsubscribe);
        }
    } catch (e) {
        console.warn("Fallo en listener de pedidos online:", e);
    }
}

// Escuchador BroadcastChannel para pestañas cruzadas en vivo
try {
    const pedidosChannel = new BroadcastChannel('pos_pedidos_channel');
    pedidosChannel.onmessage = (event) => {
        if (event.data && event.data.type === 'NUEVO_PEDIDO') {
            const pedido = event.data.pedido;
            if (pedido && (!currentNegocioId || pedido.negocioId === currentNegocioId)) {
                if (!knownPedidoIds.has(pedido.id)) {
                    knownPedidoIds.add(pedido.id);
                    pedidosOnlineList.unshift(pedido);
                    mostrarToastNuevoPedido(pedido);
                    actualizarBadgePedidosOnline();
                    renderPedidosOnlineList();
                }
            }
        }
    };
} catch(e) {}

// Escuchador Storage fallback para navegadores que compartan almacenamiento
window.addEventListener('storage', (e) => {
    if (e.key === 'ultimo_pedido_timestamp') {
        const raw = localStorage.getItem('ultimo_pedido_online_' + currentNegocioId);
        if (raw) {
            try {
                const pedido = JSON.parse(raw);
                if (pedido && !knownPedidoIds.has(pedido.id)) {
                    knownPedidoIds.add(pedido.id);
                    pedidosOnlineList.unshift(pedido);
                    mostrarToastNuevoPedido(pedido);
                    actualizarBadgePedidosOnline();
                    renderPedidosOnlineList();
                }
            } catch(err) {}
        }
    }
});

function abrirModalPedidosOnline() {
    const modal = document.getElementById('pedidos-online-modal');
    if (!modal) return;
    renderPedidosOnlineList();
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div')?.classList.remove('scale-95');
    }, 10);
}

function cerrarModalPedidosOnline() {
    const modal = document.getElementById('pedidos-online-modal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    modal.querySelector('div')?.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 250);
}

function setFiltroPedidosOnline(filtro) {
    filtroPedidosOnline = filtro;
    const tabs = ['pendientes', 'completados', 'todos'];
    tabs.forEach(t => {
        const btn = document.getElementById('tab-filtro-' + t);
        if (btn) {
            if (t === filtro) {
                btn.className = "px-3.5 py-1.5 rounded-xl text-xs font-black transition-all bg-indigo-600 text-white shadow-xs";
            } else {
                btn.className = "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300";
            }
        }
    });
    renderPedidosOnlineList();
}

function renderPedidosOnlineList() {
    const listEl = document.getElementById('pedidos-online-lista');
    if (!listEl) return;

    let filtrados = pedidosOnlineList;
    if (filtroPedidosOnline === 'pendientes') {
        filtrados = pedidosOnlineList.filter(p => p.estado === 'pendiente');
    } else if (filtroPedidosOnline === 'completados') {
        filtrados = pedidosOnlineList.filter(p => p.estado === 'completado');
    }

    if (filtrados.length === 0) {
        listEl.innerHTML = `
            <div class="py-12 text-center text-slate-400">
                <i class="fa-solid fa-receipt text-3xl mb-2 text-slate-300 dark:text-slate-600"></i>
                <p class="font-bold text-xs">No hay pedidos en la vista seleccionada.</p>
                <p class="text-[11px] text-slate-400 mt-0.5">Los nuevos pedidos realizados desde el catálogo web aparecerán aquí en vivo.</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = filtrados.map(p => {
        const isPendiente = p.estado === 'pendiente';
        const isCompletado = p.estado === 'completado';
        const badgeEstado = isPendiente 
            ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60 flex items-center gap-1"><i class="fa-solid fa-clock text-[9px] animate-pulse"></i> Pendiente</span>`
            : isCompletado
            ? `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60 flex items-center gap-1"><i class="fa-solid fa-check text-[9px]"></i> Despachado</span>`
            : `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-500 border border-slate-200 flex items-center gap-1"><i class="fa-solid fa-ban text-[9px]"></i> Cancelado</span>`;

        const waPhone = normalizarTelefono(p.telefono || '');
        const waLink = waPhone ? enlaceWhatsApp(waPhone, 'Hola ' + p.cliente + ', te contactamos de la tienda sobre tu pedido #' + p.id) : null;

        const itemsHtml = (p.items || []).map(i => `
            <div class="flex items-center justify-between text-xs py-1 border-b border-slate-100/60 dark:border-slate-800/60 last:border-none">
                <span class="font-bold text-slate-800 dark:text-slate-200"><span class="text-indigo-600 dark:text-indigo-400 font-black mr-1">${i.qty}x</span> ${i.nombre}</span>
                <span class="font-black text-slate-700 dark:text-slate-300 tabular-nums">$${(i.total || (i.precio * i.qty)).toFixed(2)}</span>
            </div>
        `).join('');

        return `
            <div class="bg-white/90 dark:bg-slate-800/90 rounded-2xl p-4 md:p-5 border ${isPendiente ? 'border-indigo-400/80 shadow-md ring-2 ring-indigo-500/10' : 'border-slate-200/80 dark:border-slate-700/80'} transition-all flex flex-col justify-between gap-3">
                <div>
                    <!-- Encabezado de la Tarjeta -->
                    <div class="flex items-start justify-between gap-2 mb-2">
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-mono font-black text-xs text-indigo-600 dark:text-indigo-400">#${p.id}</span>
                                <span class="text-[11px] text-slate-400 font-bold"><i class="fa-regular fa-clock mr-1"></i>${p.fechaStr || ''}</span>
                            </div>
                            <h4 class="text-sm font-black text-slate-900 dark:text-white mt-0.5">${p.cliente}</h4>
                        </div>
                        <div class="flex items-center gap-1.5 shrink-0">
                            ${badgeEstado}
                        </div>
                    </div>

                    <!-- Datos de Entrega y Pago -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-xs mb-3">
                        <div>
                            <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Modalidad & Contacto</span>
                            <p class="font-bold text-slate-800 dark:text-slate-200 mt-0.5"><i class="fa-solid fa-motorcycle text-indigo-500 mr-1"></i>${p.entrega || 'Delivery'} ${p.telefono ? '• Tel: ' + p.telefono : ''}</p>
                            <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5"><i class="fa-solid fa-location-dot text-rose-500 mr-1"></i>${p.direccion || 'Sin dirección'}</p>
                        </div>
                        <div>
                            <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Forma de Pago</span>
                            <p class="font-bold text-slate-800 dark:text-slate-200 mt-0.5"><i class="fa-solid fa-wallet text-amber-500 mr-1"></i>${p.formaPago || 'Pago Móvil'}</p>
                            <p class="text-[11px] text-emerald-600 dark:text-emerald-400 font-black mt-0.5">Total: $${(p.totalUsd || 0).toFixed(2)} / Bs ${(p.totalBs || 0).toFixed(2)}</p>
                        </div>
                    </div>

                    <!-- Detalle de Productos -->
                    <div class="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700/60">
                        <span class="text-[10px] font-black uppercase tracking-wider text-slate-400 block mb-1.5">Productos Pedidos:</span>
                        <div class="space-y-0.5">
                            ${itemsHtml}
                        </div>
                    </div>
                </div>

                <!-- Botones de Acción -->
                <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5">
                        ${waLink ? `
                            <a href="${waLink}" target="_blank" class="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs flex items-center gap-1.5 transition-colors">
                                <i class="fa-brands fa-whatsapp"></i> Chat WhatsApp
                            </a>
                        ` : ''}
                        ${isPendiente ? `
                            <button type="button" onclick="marcarPedidoCompletado('${p.id}')" class="px-3 py-2 rounded-xl bg-slate-100 hover:bg-emerald-100 dark:bg-slate-700 dark:hover:bg-emerald-950 text-slate-700 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-300 font-bold text-xs flex items-center gap-1.5 transition-colors" title="Marcar como despachado">
                                <i class="fa-solid fa-check text-xs"></i> Despachado
                            </button>
                            <button type="button" onclick="cancelarPedidoOnline('${p.id}')" class="px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-rose-100 dark:bg-slate-700 dark:hover:bg-rose-950 text-slate-400 hover:text-rose-600 font-bold text-xs transition-colors" title="Cancelar pedido">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        ` : ''}
                    </div>

                    <button type="button" onclick="cargarPedidoAlPOS('${p.id}')" class="animated-btn px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs flex items-center gap-2 shadow-md shadow-indigo-600/20 transition-all">
                        <i class="fa-solid fa-cash-register text-xs"></i> Cargar al Carrito (POS)
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Carga directa de los productos del pedido online al carrito de facturación (POS)
function cargarPedidoAlPOS(pedidoId) {
    const pedido = pedidosOnlineList.find(p => p.id === pedidoId);
    if (!pedido) return;

    if (cart && cart.length > 0) {
        Swal.fire({
            title: '¿Reemplazar Carrito Actual?',
            text: 'Tienes productos en el punto de venta. ¿Deseas agregar los productos de este pedido web?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, cargar pedido',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#4f46e5'
        }).then(res => {
            if (res.isConfirmed) {
                ejecutarCargaCarritoPOS(pedido);
            }
        });
    } else {
        ejecutarCargaCarritoPOS(pedido);
    }
}

function ejecutarCargaCarritoPOS(pedido) {
    cart = [];
    const faltantes = [];

    (pedido.items || []).forEach(item => {
        const cant = Math.max(1, parseInt(item.qty) || 1);
        const nombreItem = String(item.nombre || '').trim();

        // Búsqueda tolerante: antes hacía `x.nombre.toLowerCase()` sin
        // comprobar, así que un producto sin nombre lanzaba TypeError y tumbaba
        // TODA la carga del pedido.
        const pInv = products.find(x => {
            if (item.id && x.id === item.id) return true;
            const nombreProd = String(x.nombre || '').trim().toLowerCase();
            return nombreProd !== '' && nombreProd === nombreItem.toLowerCase();
        });

        if (pInv) {
            // Se carga el producto COMPLETO, igual que addToCart(): así el
            // ticket y el resto del POS tienen los mismos campos (tipo, marca,
            // imagen, código...).
            // ANTES se construía un objeto parcial con `unit` en vez de `tipo`,
            // y el ticket imprime `${i.qty} ${i.tipo} - ${i.nombre}`: salía
            // "undefined" en cada línea.
            cart.push({ ...pInv, qty: cant });
        } else {
            // No está en el inventario: se carga igual, pero marcado, para que
            // el cajero sepa que ese artículo no va a descontar stock.
            faltantes.push(nombreItem || 'Producto sin nombre');
            cart.push({
                id: item.id || ('WEB-' + Date.now() + '-' + cart.length),
                nombre: nombreItem || 'Producto del pedido web',
                precio: parseFloat(item.precio) || 0,
                costo: null,            // desconocido: no se inventa
                tipo: 'unidad',
                qty: cant,
                iva: false,
                noInventario: true
            });
        }
    });

    // updateCartUI es la función REAL que pinta el carrito.
    // Antes se llamaba a renderCart(), que NO EXISTE en el proyecto: lanzaba
    // ReferenceError, el carrito se llenaba en memoria pero nunca se dibujaba,
    // y por eso el pedido "no aparecía" en el ticket del POS.
    updateCartUI();
    cerrarModalPedidosOnline();
    switchTab('ventas');

    const cartEl = document.getElementById('cart-items');
    if (cartEl) setTimeout(() => { cartEl.scrollTop = cartEl.scrollHeight; }, 60);

    const aviso = faltantes.length > 0;
    Swal.fire(Object.assign({
        icon: aviso ? 'warning' : 'success',
        title: aviso ? 'Pedido cargado con avisos' : '¡Pedido Cargado al POS!',
        html: `
            <div class="text-xs text-left space-y-1.5 mt-2">
                <p>Se transfirieron los <b>${cart.length} producto(s)</b> del pedido <b>#${escHtml(pedido.id)}</b> de <b>${escHtml(pedido.cliente)}</b>.</p>
                <p class="text-indigo-600 font-bold"><i class="fa-solid fa-cart-shopping mr-1"></i> Ya están en el ticket: revisa el panel de la derecha antes de cobrar.</p>
                ${aviso ? `<p class="text-amber-600 font-bold mt-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i> ${faltantes.length} artículo(s) no están en tu inventario, así que <b>no descontarán stock</b>: ${escHtml(faltantes.join(', '))}</p>` : ''}
            </div>
        `
    }, aviso
        ? { confirmButtonText: 'Entendido', confirmButtonColor: '#4f46e5' }
        : { timer: 2600, showConfirmButton: false }
    ));
}

async function marcarPedidoCompletado(pedidoId) {
    const pedido = pedidosOnlineList.find(p => p.id === pedidoId);
    if (!pedido) return;

    try {
        if (db && currentNegocioId) {
            await getDb('pedidos_online').doc(pedidoId).update({
                estado: 'completado',
                completadoEn: firebase.firestore.FieldValue.serverTimestamp(),
                despachadoPor: currentUser?.email || 'operador'
            });
        }
    } catch(e) {
        console.warn("Aviso al actualizar en Firestore:", e);
    }

    pedido.estado = 'completado';
    actualizarBadgePedidosOnline();
    renderPedidosOnlineList();

    Swal.fire({
        title: '¡Pedido Despachado!',
        text: `El pedido #${pedidoId} de ${pedido.cliente} fue marcado como completado.`,
        icon: 'success',
        timer: 1600,
        showConfirmButton: false
    });
}

async function cancelarPedidoOnline(pedidoId) {
    const confirmRes = await Swal.fire({
        title: '¿Cancelar Pedido?',
        text: 'El pedido pasará a estado cancelado.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, cancelar pedido',
        cancelButtonText: 'Volver',
        confirmButtonColor: '#e11d48'
    });

    if (!confirmRes.isConfirmed) return;

    try {
        if (db && currentNegocioId) {
            await getDb('pedidos_online').doc(pedidoId).update({
                estado: 'cancelado'
            });
        }
    } catch(e) {}

    const pedido = pedidosOnlineList.find(p => p.id === pedidoId);
    if (pedido) pedido.estado = 'cancelado';
    actualizarBadgePedidosOnline();
    renderPedidosOnlineList();
}

// =====================================================
// MÓDULO COMIDA RÁPIDA / FOOD TRUCK & KDS COCINA
// =====================================================

function onBusinessTypeChange(type) {
    const lblBodega = document.getElementById('label-type-bodega');
    const lblComida = document.getElementById('label-type-comida');
    const lblNombre = document.getElementById('label-reg-nombre');
    const inputNombre = document.getElementById('reg-nombre');
    const inputEmail = document.getElementById('reg-email');

    if (type === 'comida_rapida') {
        if (lblComida) {
            lblComida.className = 'cursor-pointer p-3 rounded-2xl border-2 border-amber-500 bg-amber-500/10 text-white flex flex-col items-center text-center gap-1.5 transition-all select-none shadow-md shadow-amber-500/20';
        }
        if (lblBodega) {
            lblBodega.className = 'cursor-pointer p-3 rounded-2xl border-2 border-slate-700 bg-slate-800/40 text-slate-400 hover:text-white hover:border-slate-600 flex flex-col items-center text-center gap-1.5 transition-all select-none';
        }
        if (lblNombre) lblNombre.textContent = 'Nombre del Puesto / Food Truck';
        if (inputNombre) inputNombre.placeholder = 'Ej. Hamburguesas & Perros El Catire';
        if (inputEmail) inputEmail.placeholder = 'contacto@elcatire.com';
    } else {
        if (lblBodega) {
            lblBodega.className = 'cursor-pointer p-3 rounded-2xl border-2 border-primary-500 bg-primary-500/10 text-white flex flex-col items-center text-center gap-1.5 transition-all select-none shadow-md shadow-primary-500/20';
        }
        if (lblComida) {
            lblComida.className = 'cursor-pointer p-3 rounded-2xl border-2 border-slate-700 bg-slate-800/40 text-slate-400 hover:text-white hover:border-slate-600 flex flex-col items-center text-center gap-1.5 transition-all select-none';
        }
        if (lblNombre) lblNombre.textContent = 'Nombre Comercial';
        if (inputNombre) inputNombre.placeholder = 'Ej. Bodega La Bendición';
        if (inputEmail) inputEmail.placeholder = 'admin@bodega.com';
    }
}

function initBusinessMode() {
    const mode = localStorage.getItem('pos_business_mode') || storeConfig.businessType || 'bodega';
    storeConfig.businessType = mode;
    
    const label = document.getElementById('business-mode-label');
    const icon = document.getElementById('business-mode-icon');
    const orderBar = document.getElementById('fast-food-order-bar');
    const btnCocina = document.getElementById('btn-cocina');
    const btnMermas = document.getElementById('btn-mermas');
    const badgeNum = document.getElementById('current-order-number-badge');

    if (mode === 'comida_rapida') {
        if (label) label.textContent = 'Comida Rápida';
        if (icon) icon.className = 'fa-solid fa-hotdog text-amber-500';
        if (orderBar) orderBar.classList.remove('hidden');
        if (btnCocina) btnCocina.classList.remove('hidden');
        // Ocultar mermas para puestos de comida callejera (no aplican en comida rápida)
        if (btnMermas) btnMermas.classList.add('hidden');
        setOrderType(currentOrderType || 'llevar');
    } else {
        if (label) label.textContent = 'Modo Bodega';
        if (icon) icon.className = 'fa-solid fa-shop text-primary-500';
        if (orderBar) orderBar.classList.add('hidden');
        if (btnCocina && activeComandas.length === 0) btnCocina.classList.add('hidden');
        if (btnMermas) btnMermas.classList.remove('hidden');
    }

    if (badgeNum) {
        badgeNum.textContent = `ORDEN #${String(dailyOrderNumber).padStart(2, '0')}`;
    }
}

function toggleBusinessMode() {
    const current = storeConfig.businessType || 'bodega';
    const nextMode = current === 'bodega' ? 'comida_rapida' : 'bodega';
    storeConfig.businessType = nextMode;
    localStorage.setItem('pos_business_mode', nextMode);
    
    initBusinessMode();
    renderPOSCategoryChips();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: nextMode === 'comida_rapida' ? '🌭 ¡Modo Comida Rápida y Plancha Activado!' : '🏪 Modo Bodega Tradicional Activado',
        timer: 2000,
        showConfirmButton: false
    });
}

function setOrderType(type) {
    currentOrderType = type;
    const btnLlevar = document.getElementById('btn-ordertype-llevar');
    const btnAqui = document.getElementById('btn-ordertype-aqui');
    const btnDelivery = document.getElementById('btn-ordertype-delivery');

    [btnLlevar, btnAqui, btnDelivery].forEach(b => {
        if (!b) return;
        b.className = 'order-type-btn px-3 py-1.5 rounded-xl bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold hover:bg-white dark:hover:bg-slate-700 transition-all flex items-center gap-1.5 active:scale-95 text-xs';
    });

    const activeBtn = document.getElementById(`btn-ordertype-${type}`);
    if (activeBtn) {
        activeBtn.className = 'order-type-btn px-3 py-1.5 rounded-xl bg-orange-600 text-white font-black shadow-xs transition-all flex items-center gap-1.5 active:scale-95 text-xs';
    }
}

function getNextDailyOrderNumber() {
    const num = dailyOrderNumber;
    dailyOrderNumber++;
    localStorage.setItem('pos_daily_order_num', dailyOrderNumber);
    const badgeNum = document.getElementById('current-order-number-badge');
    if (badgeNum) {
        badgeNum.textContent = `ORDEN #${String(dailyOrderNumber).padStart(2, '0')}`;
    }
    return `ORDEN #${String(num).padStart(2, '0')}`;
}

// ---- Modificadores Ultra-Rápidos de 1-Touch para Hora Pico y Ruido Callejero ----
function aplicarModificadorRapido(cartIdx, accion) {
    const item = cart[cartIdx];
    if (!item) return;

    if (!item.modificadores) {
        item.modificadores = {
            salsas: ['Kétchup', 'Mayonesa', 'Mostaza', 'Salsa de Maíz', 'Salsa de Ajo', 'Tártara', 'Rosada'],
            sin: [],
            extras: [],
            nota: '',
            extraCost: 0
        };
    }

    if (accion === 'con_todo') {
        item.modificadores.salsas = ['Kétchup', 'Mayonesa', 'Mostaza', 'Salsa de Maíz', 'Salsa de Ajo', 'Tártara', 'Rosada'];
        item.modificadores.sin = [];
    } else if (accion === 'sin_vegetales') {
        const veggies = ['Cebolla', 'Repollo / Ensalada', 'Tomate'];
        const yaTieneVeggies = veggies.every(v => item.modificadores.sin.includes(v));
        if (yaTieneVeggies) {
            item.modificadores.sin = item.modificadores.sin.filter(s => !veggies.includes(s));
        } else {
            veggies.forEach(v => {
                if (!item.modificadores.sin.includes(v)) item.modificadores.sin.push(v);
            });
        }
    } else if (accion === 'sin_cebolla') {
        if (item.modificadores.sin.includes('Cebolla')) {
            item.modificadores.sin = item.modificadores.sin.filter(s => s !== 'Cebolla');
        } else {
            item.modificadores.sin.push('Cebolla');
        }
    } else if (accion === 'salsas_aparte') {
        const nota = item.modificadores.nota || '';
        item.modificadores.nota = nota ? `${nota}, salsas aparte` : 'Salsas en envase aparte';
    }

    updateCartUI();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: accion === 'con_todo' ? '🌭 ¡Con Todo!' : accion === 'sin_vegetales' ? '🥗 Sin Vegetales aplicado' : accion === 'sin_cebolla' ? '🚫 Sin Cebolla aplicado' : '🥡 Salsas aparte anotado',
        timer: 1000,
        showConfirmButton: false
    });
}

// ---- Cantar Turno en Pantalla Gigante para Ruido Callejero ----
function cantarTurnoActual() {
    const cmdLista = activeComandas.find(c => c.estado === 'listo');
    const orderNum = cmdLista ? cmdLista.orderNumber : (document.getElementById('current-order-number-badge')?.textContent || 'ORDEN #01');
    const customerNote = (document.getElementById('pos-customer-note')?.value || '').trim();
    const clientName = cmdLista ? cmdLista.clienteNombre : (customerNote || 'Cliente Mostrador');
    const tipo = cmdLista ? cmdLista.orderType.toUpperCase() : (currentOrderType || 'LLEVAR').toUpperCase();

    playLoudChimeSound();

    Swal.fire({
        html: `
            <div class="py-4 text-center select-none">
                <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-100 dark:bg-orange-950/70 text-orange-600 mb-3 animate-bounce">
                    <i class="fa-solid fa-bullhorn text-2xl"></i>
                </div>
                <div class="text-5xl sm:text-6xl font-black text-orange-600 dark:text-orange-400 tracking-wider mb-2 tabular-nums">${orderNum}</div>
                <div class="text-xl sm:text-2xl font-black text-slate-800 dark:text-white uppercase mb-1">${escHtml(clientName)}</div>
                <span class="inline-block px-3.5 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-orange-500/10 text-orange-700 dark:text-orange-300 border border-orange-500/30">
                    ${tipo}
                </span>
                <p class="text-xs text-slate-400 font-bold mt-4 animate-pulse">¡Su pedido está listo para retirar en el mostrador! 🌭</p>
            </div>
        `,
        confirmButtonText: '¡Entendido / Cantado! 📢',
        confirmButtonColor: '#ea580c',
        backdrop: 'rgba(0,0,0,0.85)'
    });
}

function playLoudChimeSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const now = ctx.currentTime;
        
        // 3 notas enérgicas ascendentes para cortar la bulla de la calle (Do5, Mi5, Sol5)
        [523.25, 659.25, 783.99].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + (idx * 0.12));
            gain.gain.setValueAtTime(0.4, now + (idx * 0.12));
            gain.gain.exponentialRampToValueAtTime(0.001, now + (idx * 0.12) + 0.3);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + (idx * 0.12));
            osc.stop(now + (idx * 0.12) + 0.32);
        });
    } catch(e) {}
}

// ---- Modificadores (Salsas, Sin..., Extras) ----
function openModificadoresModal(cartIdx) {
    const item = cart[cartIdx];
    if (!item) return;

    const modal = document.getElementById('modal-modificadores-comida');
    const content = document.getElementById('modal-modificadores-content');
    const inputIdx = document.getElementById('mod-cart-index');
    const title = document.getElementById('mod-product-title');
    const subtitle = document.getElementById('mod-product-subtitle');
    const nota = document.getElementById('mod-nota-especial');

    if (inputIdx) inputIdx.value = cartIdx;
    if (title) title.textContent = item.nombre;
    const baseP = Number(item.precioBase !== undefined ? item.precioBase : item.precio);
    if (subtitle) subtitle.textContent = `Precio base: $${baseP.toFixed(2)}`;

    // Resetear checkboxes
    document.querySelectorAll('input[name="mod-salsa"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('input[name="mod-sin"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('input[name="mod-extra"]').forEach(cb => cb.checked = false);
    if (nota) nota.value = '';

    // Cargar selección previa si existe
    if (item.modificadores) {
        if (Array.isArray(item.modificadores.salsas)) {
            item.modificadores.salsas.forEach(s => {
                const cb = document.querySelector(`input[name="mod-salsa"][value="${s}"]`);
                if (cb) cb.checked = true;
            });
        }
        if (Array.isArray(item.modificadores.sin)) {
            item.modificadores.sin.forEach(s => {
                const cb = document.querySelector(`input[name="mod-sin"][value="${s}"]`);
                if (cb) cb.checked = true;
            });
        }
        if (Array.isArray(item.modificadores.extras)) {
            item.modificadores.extras.forEach(e => {
                const cb = document.querySelector(`input[name="mod-extra"][value="${e.name}"]`);
                if (cb) cb.checked = true;
            });
        }
        if (nota && item.modificadores.nota) {
            nota.value = item.modificadores.nota;
        }
    } else {
        // Por defecto en comida venezolana: marcar salsas clásicas
        aplicarPresetSalsas('todo');
    }

    actualizarCostoModificadores();

    if (modal && content) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            content.classList.remove('scale-95');
        }, 10);
    }
}

function closeModificadoresModal() {
    const modal = document.getElementById('modal-modificadores-comida');
    const content = document.getElementById('modal-modificadores-content');
    if (!modal) return;
    modal.classList.add('opacity-0');
    if (content) content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 200);
}

function aplicarPresetSalsas(preset) {
    const clasicas = ['Kétchup', 'Mayonesa', 'Mostaza', 'Salsa de Maíz', 'Salsa de Ajo', 'Tártara', 'Rosada'];
    document.querySelectorAll('input[name="mod-salsa"]').forEach(cb => {
        if (preset === 'todo') {
            cb.checked = clasicas.includes(cb.value);
        } else if (preset === 'nada') {
            cb.checked = false;
        }
    });
}

function aplicarPresetSin(preset) {
    if (preset === 'vegetales') {
        const veggies = ['Cebolla', 'Repollo / Ensalada', 'Tomate'];
        const cbs = Array.from(document.querySelectorAll('input[name="mod-sin"]')).filter(cb => veggies.includes(cb.value));
        const todosMarcados = cbs.length > 0 && cbs.every(cb => cb.checked);
        cbs.forEach(cb => cb.checked = !todosMarcados);
    }
}

function actualizarCostoModificadores() {
    let extraCost = 0;
    document.querySelectorAll('input[name="mod-extra"]:checked').forEach(cb => {
        extraCost += parseFloat(cb.getAttribute('data-price') || 0);
    });
    const totalEl = document.getElementById('mod-total-extras');
    if (totalEl) totalEl.textContent = `+$${extraCost.toFixed(2)}`;
    return extraCost;
}

function guardarModificadores() {
    const inputIdx = document.getElementById('mod-cart-index');
    const idx = parseInt(inputIdx?.value, 10);
    if (isNaN(idx) || !cart[idx]) return closeModificadoresModal();

    const salsas = [];
    document.querySelectorAll('input[name="mod-salsa"]:checked').forEach(cb => salsas.push(cb.value));

    const sin = [];
    document.querySelectorAll('input[name="mod-sin"]:checked').forEach(cb => sin.push(cb.value));

    const extras = [];
    let extraCost = 0;
    document.querySelectorAll('input[name="mod-extra"]:checked').forEach(cb => {
        const cost = parseFloat(cb.getAttribute('data-price') || 0);
        extras.push({ name: cb.value, price: cost });
        extraCost += cost;
    });

    const nota = (document.getElementById('mod-nota-especial')?.value || '').trim();

    cart[idx].modificadores = {
        salsas: salsas,
        sin: sin,
        extras: extras,
        nota: nota,
        extraCost: roundMoney(extraCost)
    };

    updateCartUI();
    closeModificadoresModal();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: '¡Plato personalizado!',
        timer: 1200,
        showConfirmButton: false
    });
}

// ---- Audio y KDS Monitor de Cocina ----
function toggleKitchenSound() {
    kitchenSoundEnabled = !kitchenSoundEnabled;
    localStorage.setItem('pos_kitchen_sound', kitchenSoundEnabled);
    const icon = document.getElementById('icon-kitchen-sound');
    if (icon) {
        icon.className = kitchenSoundEnabled ? 'fa-solid fa-volume-high text-orange-500' : 'fa-solid fa-volume-xmark text-slate-400';
    }
    if (kitchenSoundEnabled) playKitchenAlertSound();
}

function playKitchenAlertSound() {
    if (!kitchenSoundEnabled) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        const now = ctx.currentTime;
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now); // Re (D5)
        osc1.frequency.setValueAtTime(880, now + 0.12); // La (A5)
        gain1.gain.setValueAtTime(0.3, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.36);
    } catch (e) {
        console.warn('AudioContext alert note failed:', e);
    }
}

function crearComandaCocina(saleData, saleId) {
    if (!saleData || !saleData.items || saleData.items.length === 0) return;

    const orderNum = getNextDailyOrderNumber();
    const customerNoteInput = document.getElementById('pos-customer-note');
    const customerNote = customerNoteInput ? customerNoteInput.value.trim() : '';
    if (customerNoteInput) customerNoteInput.value = '';

    const clienteNombre = customerNote || saleData.clienteNombre || 'Cliente Mostrador';

    const comanda = {
        id: 'cmd_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        orderNumber: orderNum,
        saleId: saleId || null,
        orderType: currentOrderType || 'llevar',
        clienteNombre: clienteNombre,
        items: saleData.items.map(item => ({
            nombre: item.nombre,
            qty: item.qty,
            tipo: item.tipo,
            modificadores: item.modificadores || null
        })),
        estado: 'cola', // 'cola' | 'plancha' | 'listo' | 'entregado'
        createdAt: Date.now()
    };

    activeComandas.unshift(comanda);
    localStorage.setItem('pos_active_comandas', JSON.stringify(activeComandas));

    // Si hay conexión y Firestore, guardar también en colección remota
    try {
        if (db && currentNegocioId && navigator.onLine) {
            getDb('comandas_cocina').doc(comanda.id).set({
                ...comanda,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.warn('Aviso guardando comanda en Firestore:', e));
        }
    } catch (e) {}

    playKitchenAlertSound();
    renderKitchenDisplay();

    Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: `🔥 ${orderNum} (${clienteNombre}) a Cocina`,
        timer: 2000,
        showConfirmButton: false
    });
}

function renderKitchenDisplay() {
    const colCola = document.getElementById('kds-container-cola');
    const colPlancha = document.getElementById('kds-container-plancha');
    const colListo = document.getElementById('kds-container-listo');
    if (!colCola || !colPlancha || !colListo) return;

    colCola.innerHTML = '';
    colPlancha.innerHTML = '';
    colListo.innerHTML = '';

    const listCola = activeComandas.filter(c => c.estado === 'cola');
    const listPlancha = activeComandas.filter(c => c.estado === 'plancha');
    const listListo = activeComandas.filter(c => c.estado === 'listo');

    // Actualizar contadores
    const countCola = document.getElementById('kds-count-cola');
    const countPlancha = document.getElementById('kds-count-plancha');
    const countListo = document.getElementById('kds-count-listo');
    const badgeCola = document.getElementById('badge-col-cola');
    const badgePlancha = document.getElementById('badge-col-plancha');
    const badgeListo = document.getElementById('badge-col-listo');
    const badgeCocinaSidebar = document.getElementById('badge-cocina');

    if (countCola) countCola.textContent = listCola.length;
    if (countPlancha) countPlancha.textContent = listPlancha.length;
    if (countListo) countListo.textContent = listListo.length;
    if (badgeCola) badgeCola.textContent = listCola.length;
    if (badgePlancha) badgePlancha.textContent = listPlancha.length;
    if (badgeListo) badgeListo.textContent = listListo.length;

    const totalActivas = listCola.length + listPlancha.length;
    if (badgeCocinaSidebar) {
        if (totalActivas > 0) {
            badgeCocinaSidebar.classList.remove('hidden');
            badgeCocinaSidebar.textContent = totalActivas;
        } else {
            badgeCocinaSidebar.classList.add('hidden');
        }
    }

    const formatElapsed = (createdAt) => {
        const mins = Math.floor((Date.now() - createdAt) / 60000);
        if (mins < 1) return 'Hace un instante';
        if (mins >= 8) return `<span class="text-rose-600 dark:text-rose-400 font-black animate-pulse">⏰ ${mins}m ¡RETRASO!</span>`;
        return `Hace ${mins} min`;
    };

    const buildCardHtml = (cmd) => {
        const mins = Math.floor((Date.now() - cmd.createdAt) / 60000);
        const isDelayed = mins >= 8 && cmd.estado !== 'listo';

        const typeLabels = {
            llevar: '<span class="px-2 py-0.5 rounded-lg bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-400 font-extrabold text-[10px]"><i class="fa-solid fa-bag-shopping"></i> Para Llevar</span>',
            aqui: '<span class="px-2 py-0.5 rounded-lg bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 font-extrabold text-[10px]"><i class="fa-solid fa-utensils"></i> Comer Aquí</span>',
            delivery: '<span class="px-2 py-0.5 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 font-extrabold text-[10px]"><i class="fa-solid fa-motorcycle"></i> Delivery</span>'
        };

        const itemsHtml = cmd.items.map(item => {
            let modsHtml = '';
            if (item.modificadores) {
                const subParts = [];
                if (item.modificadores.salsas && item.modificadores.salsas.length > 0) {
                    subParts.push(`<div class="text-[10px] font-bold text-amber-700 dark:text-amber-300">🍯 ${escHtml(item.modificadores.salsas.join(', '))}</div>`);
                }
                if (item.modificadores.sin && item.modificadores.sin.length > 0) {
                    subParts.push(`<div class="text-[10px] font-black text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 px-1 rounded">🚫 Sin: ${escHtml(item.modificadores.sin.join(', '))}</div>`);
                }
                if (item.modificadores.extras && item.modificadores.extras.length > 0) {
                    subParts.push(`<div class="text-[10px] font-black text-emerald-600 dark:text-emerald-400">✨ +${escHtml(item.modificadores.extras.map(e => e.name).join(', +'))}</div>`);
                }
                if (item.modificadores.nota) {
                    subParts.push(`<div class="text-[10px] italic text-slate-500">📝 "${escHtml(item.modificadores.nota)}"</div>`);
                }
                if (subParts.length > 0) {
                    modsHtml = `<div class="mt-1 pl-2 border-l-2 border-amber-400/60 space-y-0.5">${subParts.join('')}</div>`;
                }
            }

            return `
                <div class="py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                    <div class="flex items-center justify-between text-xs">
                        <span class="font-black text-slate-800 dark:text-white">${item.qty}x ${escHtml(item.nombre)}</span>
                    </div>
                    ${modsHtml}
                </div>`;
        }).join('');

        let actionsHtml = '';
        if (cmd.estado === 'cola') {
            actionsHtml = `
                <button type="button" onclick="cambiarEstadoComanda('${cmd.id}', 'plancha')" class="flex-1 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95">
                    <i class="fa-solid fa-fire text-xs"></i> A Plancha 🔥
                </button>`;
        } else if (cmd.estado === 'plancha') {
            actionsHtml = `
                <button type="button" onclick="cambiarEstadoComanda('${cmd.id}', 'listo')" class="flex-1 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95">
                    <i class="fa-solid fa-circle-check text-xs"></i> Listo ✅
                </button>`;
        } else if (cmd.estado === 'listo') {
            actionsHtml = `
                <button type="button" onclick="cambiarEstadoComanda('${cmd.id}', 'entregado')" class="flex-1 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-xs flex items-center justify-center gap-1.5 shadow-xs transition-all active:scale-95">
                    <i class="fa-solid fa-flag-checkered text-xs"></i> Despachado 🏁
                </button>`;
        }

        const borderClass = isDelayed ? 'border-2 border-rose-500/80 shadow-rose-500/20' : 'border border-slate-200 dark:border-slate-700 shadow-sm';

        return `
            <div class="bg-white dark:bg-slate-800 p-3.5 rounded-2xl ${borderClass} transition-all hover:shadow-md">
                <div class="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100 dark:border-slate-700/60">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="text-sm font-black text-slate-900 dark:text-white tracking-wide">${escHtml(cmd.orderNumber)}</span>
                            ${isDelayed ? '<span class="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-rose-500 text-white animate-pulse">RETRASO</span>' : ''}
                        </div>
                        <p class="text-[10px] text-amber-600 dark:text-amber-400 font-extrabold uppercase mt-0.5">${escHtml(cmd.clienteNombre)}</p>
                    </div>
                    <div class="text-right">
                        ${typeLabels[cmd.orderType] || typeLabels.llevar}
                        <div class="text-[10px] text-slate-400 font-bold mt-0.5">${formatElapsed(cmd.createdAt)}</div>
                    </div>
                </div>

                <div class="my-2 divide-y divide-slate-100 dark:divide-slate-800">
                    ${itemsHtml}
                </div>

                <div class="mt-3 pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center gap-2">
                    <button type="button" onclick="imprimirComandaCocina('${cmd.id}')" class="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 font-bold text-xs" title="Imprimir Comanda">
                        <i class="fa-solid fa-print"></i>
                    </button>
                    ${actionsHtml}
                </div>
            </div>`;
    };

    if (listCola.length === 0) {
        colCola.innerHTML = `
            <div class="py-10 text-center text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-bowl-rice text-2xl mb-1 text-slate-300 dark:text-slate-600"></i>
                <p class="text-xs font-bold">Sin pedidos en cola</p>
            </div>`;
    } else {
        listCola.forEach(cmd => colCola.innerHTML += buildCardHtml(cmd));
    }

    if (listPlancha.length === 0) {
        colPlancha.innerHTML = `
            <div class="py-10 text-center text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-fire text-2xl mb-1 text-slate-300 dark:text-slate-600"></i>
                <p class="text-xs font-bold">Plancha despejada</p>
            </div>`;
    } else {
        listPlancha.forEach(cmd => colPlancha.innerHTML += buildCardHtml(cmd));
    }

    if (listListo.length === 0) {
        colListo.innerHTML = `
            <div class="py-10 text-center text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-bell-concierge text-2xl mb-1 text-slate-300 dark:text-slate-600"></i>
                <p class="text-xs font-bold">Sin platos por entregar</p>
            </div>`;
    } else {
        listListo.forEach(cmd => colListo.innerHTML += buildCardHtml(cmd));
    }
}

function cambiarEstadoComanda(comandaId, nuevoEstado) {
    const cmd = activeComandas.find(c => c.id === comandaId);
    if (!cmd) return;

    if (nuevoEstado === 'entregado') {
        activeComandas = activeComandas.filter(c => c.id !== comandaId);
    } else {
        cmd.estado = nuevoEstado;
        if (nuevoEstado === 'listo') playKitchenAlertSound();
    }

    localStorage.setItem('pos_active_comandas', JSON.stringify(activeComandas));

    try {
        if (db && currentNegocioId && navigator.onLine) {
            getDb('comandas_cocina').doc(comandaId).update({
                estado: nuevoEstado
            }).catch(e => {});
        }
    } catch(e) {}

    renderKitchenDisplay();
}

function imprimirComandaCocina(comandaId) {
    const cmd = activeComandas.find(c => c.id === comandaId);
    if (!cmd) return;

    const win = window.open('', 'PRINT', 'height=600,width=400');
    if (!win) return Swal.fire('Aviso', 'Permite ventanas emergentes para imprimir comanda', 'warning');

    let itemsHtml = cmd.items.map(item => {
        let details = [];
        if (item.modificadores) {
            if (item.modificadores.salsas?.length) details.push(`Salsas: ${item.modificadores.salsas.join(', ')}`);
            if (item.modificadores.sin?.length) details.push(`<b>SIN: ${item.modificadores.sin.join(', ')}</b>`);
            if (item.modificadores.extras?.length) details.push(`EXTRAS: +${item.modificadores.extras.map(e => e.name).join(', +')}`);
            if (item.modificadores.nota) details.push(`NOTA: "${item.modificadores.nota}"`);
        }
        return `
            <div style="margin-bottom: 8px; border-bottom: 1px dashed #ccc; padding-bottom: 6px;">
                <div style="font-size: 16px; font-weight: bold;">${item.qty}x ${escHtml(item.nombre)}</div>
                ${details.length ? `<div style="font-size: 13px; margin-top: 3px; color: #222;">${details.join('<br>')}</div>` : ''}
            </div>`;
    }).join('');

    win.document.write(`
        <html>
        <head>
            <title>Comanda ${cmd.orderNumber}</title>
            <style>
                body { font-family: monospace; padding: 10px; margin: 0; color: #000; width: 280px; }
                h1 { font-size: 24px; margin: 0 0 5px 0; text-align: center; }
                .center { text-align: center; font-size: 14px; }
                hr { border: none; border-top: 2px dashed #000; margin: 8px 0; }
            </style>
        </head>
        <body>
            <h1>${cmd.orderNumber}</h1>
            <div class="center"><b>TIPO:</b> ${cmd.orderType.toUpperCase()}</div>
            <div class="center"><b>CLIENTE:</b> ${escHtml(cmd.clienteNombre)}</div>
            <div class="center">${new Date(cmd.createdAt).toLocaleTimeString()}</div>
            <hr>
            ${itemsHtml}
            <hr>
            <div class="center" style="font-size: 12px;">*** PLANCHA & COCINA ***</div>
        </body>
        </html>
    `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
}

// =====================================================
// MENÚ DEMO CALLEJERO CRIOLLO POR CATEGORÍAS SELECCIONABLES
// =====================================================
const DEMO_CATEGORIAS_COMIDA = {
    hamburguesas: {
        id: 'hamburguesas',
        nombre: 'Hamburguesas',
        icon: '🍔',
        color: 'from-amber-500/20 to-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30',
        desc: 'Burger Clásica, Mixta (Carne + Pollo + Huevo), Doble Carne Especial',
        items: [
            { id: 'cr_burg_01', nombre: 'Hamburguesa Clásica de Carne', categoria: 'Hamburguesas', precio: 3.50, stock: 50, tipo: 'Und', costo: 1.50, codigo: 'BURGER-01' },
            { id: 'cr_burg_02', nombre: 'Hamburguesa Mixta (Carne + Pollo + Huevo)', categoria: 'Hamburguesas', precio: 5.50, stock: 40, tipo: 'Und', costo: 2.30, codigo: 'BURGER-02' },
            { id: 'cr_burg_03', nombre: 'Hamburguesa Doble Carne Especial', categoria: 'Hamburguesas', precio: 6.50, stock: 35, tipo: 'Und', costo: 2.80, codigo: 'BURGER-03' }
        ]
    },
    perros: {
        id: 'perros',
        nombre: 'Perros Calientes',
        icon: '🌭',
        color: 'from-red-500/20 to-amber-500/20 text-red-600 dark:text-red-400 border-red-500/30',
        desc: 'Perro Tradicional, Especial (Queso y Tocineta), Jumbo Polaco',
        items: [
            { id: 'cr_perr_01', nombre: 'Perro Caliente Tradicional', categoria: 'Perros', precio: 1.50, stock: 100, tipo: 'Und', costo: 0.60, codigo: 'PERRO-01' },
            { id: 'cr_perr_02', nombre: 'Perro Caliente Especial (Queso y Tocineta)', categoria: 'Perros', precio: 2.50, stock: 80, tipo: 'Und', costo: 1.10, codigo: 'PERRO-02' },
            { id: 'cr_perr_03', nombre: 'Perro Caliente Jumbo Polaco', categoria: 'Perros', precio: 3.00, stock: 60, tipo: 'Und', costo: 1.30, codigo: 'PERRO-03' }
        ]
    },
    pepitos: {
        id: 'pepitos',
        nombre: 'Pepitos',
        icon: '🥖',
        color: 'from-yellow-500/20 to-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30',
        desc: 'Pepito Mixto Especial (Carne, Pollo, Tocineta), Pepito Gratinado 4 Quesos',
        items: [
            { id: 'cr_pep_01', nombre: 'Pepito Mixto Especial (Carne, Pollo, Tocineta)', categoria: 'Pepitos', precio: 7.00, stock: 35, tipo: 'Und', costo: 3.00, codigo: 'PEPITO-01' },
            { id: 'cr_pep_02', nombre: 'Pepito Gratinado 4 Quesos', categoria: 'Pepitos', precio: 8.00, stock: 30, tipo: 'Und', costo: 3.50, codigo: 'PEPITO-02' }
        ]
    },
    arepas: {
        id: 'arepas',
        nombre: 'Arepas',
        icon: '🫓',
        color: 'from-emerald-500/20 to-teal-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
        desc: 'Reina Pepiada, Pelúa (Carne Mechada y Queso Amarillo), Catira',
        items: [
            { id: 'cr_arep_01', nombre: 'Arepa Reina Pepiada', categoria: 'Arepas', precio: 3.00, stock: 45, tipo: 'Und', costo: 1.20, codigo: 'AREPA-01' },
            { id: 'cr_arep_02', nombre: 'Arepa Pelúa (Carne Mechada y Queso Amarillo)', categoria: 'Arepas', precio: 3.50, stock: 45, tipo: 'Und', costo: 1.40, codigo: 'AREPA-02' },
            { id: 'cr_arep_03', nombre: 'Arepa Catira (Pollo Mechado y Queso Amarillo)', categoria: 'Arepas', precio: 3.50, stock: 40, tipo: 'Und', costo: 1.40, codigo: 'AREPA-03' }
        ]
    },
    patacones: {
        id: 'patacones',
        nombre: 'Patacones',
        icon: '🍌',
        color: 'from-amber-400/20 to-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
        desc: 'Patacón Zuliano Mixto (Carne y Pollo), Patacón Mechada con Queso de Mano',
        items: [
            { id: 'cr_pat_01', nombre: 'Patacón Zuliano Mixto (Carne y Pollo)', categoria: 'Patacones', precio: 5.00, stock: 35, tipo: 'Und', costo: 2.10, codigo: 'PAT-01' },
            { id: 'cr_pat_02', nombre: 'Patacón de Carne Mechada y Queso de Mano', categoria: 'Patacones', precio: 4.50, stock: 35, tipo: 'Und', costo: 1.90, codigo: 'PAT-02' }
        ]
    },
    empanadas: {
        id: 'empanadas',
        nombre: 'Empanadas y Pasapalos',
        icon: '🥟',
        color: 'from-orange-500/20 to-rose-500/20 text-orange-700 dark:text-orange-400 border-orange-500/30',
        desc: 'Empanada Mechada, Cazón, Queso Blanco, Ración de Tequeños x5',
        items: [
            { id: 'cr_emp_01', nombre: 'Empanada de Carne Mechada', categoria: 'Empanadas', precio: 1.20, stock: 60, tipo: 'Und', costo: 0.50, codigo: 'EMP-01' },
            { id: 'cr_emp_02', nombre: 'Empanada de Cazón Margariteño', categoria: 'Empanadas', precio: 1.50, stock: 50, tipo: 'Und', costo: 0.60, codigo: 'EMP-02' },
            { id: 'cr_emp_03', nombre: 'Empanada de Queso Blanco', categoria: 'Empanadas', precio: 1.00, stock: 60, tipo: 'Und', costo: 0.40, codigo: 'EMP-03' },
            { id: 'cr_emp_04', nombre: 'Ración de Tequeños (5 Uds)', categoria: 'Entradas', precio: 3.00, stock: 60, tipo: 'Und', costo: 1.00, codigo: 'TEQUE-01' }
        ]
    },
    pizzas: {
        id: 'pizzas',
        nombre: 'Pizzas',
        icon: '🍕',
        color: 'from-rose-500/20 to-red-600/20 text-rose-700 dark:text-rose-400 border-rose-500/30',
        desc: 'Pizza Margarita Individual, Pepperoni Especial, Jamón y Maíz',
        items: [
            { id: 'cr_piz_01', nombre: 'Pizza Margarita Individual', categoria: 'Pizzas', precio: 6.00, stock: 30, tipo: 'Und', costo: 2.50, codigo: 'PIZ-01' },
            { id: 'cr_piz_02', nombre: 'Pizza Pepperoni Especial', categoria: 'Pizzas', precio: 7.50, stock: 25, tipo: 'Und', costo: 3.10, codigo: 'PIZ-02' },
            { id: 'cr_piz_03', nombre: 'Pizza Jamón y Maíz Tocineta', categoria: 'Pizzas', precio: 7.00, stock: 25, tipo: 'Und', costo: 2.90, codigo: 'PIZ-03' }
        ]
    },
    bebidas: {
        id: 'bebidas',
        nombre: 'Bebidas Frías',
        icon: '🥤',
        color: 'from-blue-500/20 to-cyan-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30',
        desc: 'Refresco 1.5 Litros, Malta Polar 330ml, Papelón con Limón Frío',
        items: [
            { id: 'cr_beb_01', nombre: 'Refresco 1.5 Litros', categoria: 'Bebidas', precio: 2.00, stock: 50, tipo: 'Und', costo: 1.20, codigo: 'REF-1.5' },
            { id: 'cr_beb_02', nombre: 'Malta Polar 330ml', categoria: 'Bebidas', precio: 1.00, stock: 70, tipo: 'Und', costo: 0.55, codigo: 'MALTA-01' },
            { id: 'cr_beb_03', nombre: 'Papelón con Limón Frío', categoria: 'Bebidas', precio: 1.00, stock: 50, tipo: 'Und', costo: 0.30, codigo: 'PAPELON-01' }
        ]
    }
};

function abrirModalDemoCategorias() {
    const modal = document.getElementById('modal-demo-categories');
    const content = document.getElementById('modal-demo-categories-content');
    renderDemoCategoriesList();
    if (modal && content) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            content.classList.remove('scale-95');
        }, 10);
    }
}

function cerrarModalDemoCategorias() {
    const modal = document.getElementById('modal-demo-categories');
    const content = document.getElementById('modal-demo-categories-content');
    if (!modal) return;
    modal.classList.add('opacity-0');
    if (content) content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 200);
}

function renderDemoCategoriesList() {
    const container = document.getElementById('demo-categories-list');
    if (!container) return;

    // Detectar si ya existen productos cargados en memoria
    const existingCats = new Set((products || []).map(p => (p.categoria || '').toLowerCase()));

    container.innerHTML = Object.values(DEMO_CATEGORIAS_COMIDA).map(cat => {
        const isChecked = existingCats.has(cat.nombre.toLowerCase()) || ['hamburguesas', 'perros'].includes(cat.id);
        return `
            <label class="demo-cat-card flex items-center justify-between p-3 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-800/70 hover:bg-white dark:hover:bg-slate-800 cursor-pointer transition-all select-none group">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-gradient-to-br ${cat.color} flex items-center justify-center text-xl shrink-0 border shadow-2xs">
                        ${cat.icon}
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="font-black text-slate-800 dark:text-white text-xs sm:text-sm group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">${cat.nombre}</h4>
                            <span class="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-700/60 px-2 py-0.2 rounded-full">${cat.items.length} productos</span>
                        </div>
                        <p class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">${cat.desc}</p>
                    </div>
                </div>
                <input type="checkbox" name="demo-cat-checkbox" value="${cat.id}" ${isChecked ? 'checked' : ''} onchange="actualizarContadorDemoCategorias()" class="w-5 h-5 rounded-lg text-amber-600 focus:ring-0 cursor-pointer">
            </label>
        `;
    }).join('');

    actualizarContadorDemoCategorias();
}

function actualizarContadorDemoCategorias() {
    const checked = document.querySelectorAll('input[name="demo-cat-checkbox"]:checked');
    const badge = document.getElementById('demo-categories-selected-count');
    if (badge) {
        badge.textContent = `${checked.length} ${checked.length === 1 ? 'categoría seleccionada' : 'categorías seleccionadas'}`;
    }
}

function seleccionarTodasDemoCategorias(val) {
    document.querySelectorAll('input[name="demo-cat-checkbox"]').forEach(cb => cb.checked = !!val);
    actualizarContadorDemoCategorias();
}

function seleccionarSoloPerrosYBurgers() {
    document.querySelectorAll('input[name="demo-cat-checkbox"]').forEach(cb => {
        cb.checked = (cb.value === 'perros' || cb.value === 'hamburguesas');
    });
    actualizarContadorDemoCategorias();
}

function ejecutarCargaCategoriasSeleccionadas() {
    const checked = Array.from(document.querySelectorAll('input[name="demo-cat-checkbox"]:checked')).map(cb => cb.value);
    if (checked.length === 0) {
        return Swal.fire({
            title: 'Ninguna categoría seleccionada',
            text: 'Por favor marca al menos una categoría de comida (ej: Perros Calientes o Hamburguesas).',
            icon: 'info',
            confirmButtonColor: '#ea580c'
        });
    }

    cargarDemoCategorias(checked);
    cerrarModalDemoCategorias();
}

function cargarDemoCategorias(categoriaKeys = []) {
    let itemsACargar = [];
    categoriaKeys.forEach(k => {
        if (DEMO_CATEGORIAS_COMIDA[k] && DEMO_CATEGORIAS_COMIDA[k].items) {
            itemsACargar = itemsACargar.concat(DEMO_CATEGORIAS_COMIDA[k].items);
        }
    });

    if (itemsACargar.length === 0) return;

    itemsACargar.forEach(item => {
        const exIdx = products.findIndex(p => p.codigo === item.codigo);
        if (exIdx >= 0) {
            products[exIdx] = { ...products[exIdx], ...item };
        } else {
            products.push(item);
        }
    });

    guardarCache('products', products);

    // Persistir en Firestore para que existan en la base de datos del negocio
    try {
        if (db && currentNegocioId && navigator.onLine) {
            const batch = db.batch();
            itemsACargar.forEach(item => {
                const { id, ...dataSinId } = item;
                batch.set(getDb('products').doc(item.id), dataSinId, { merge: true });
            });
            batch.commit().catch(e => console.warn('Aviso guardando demo items en Firestore:', e));
        }
    } catch(e) {}

    storeConfig.businessType = 'comida_rapida';
    localStorage.setItem('pos_business_mode', 'comida_rapida');

    initBusinessMode();
    renderPOSCategoryChips();
    renderPOSProducts();
    if (typeof renderInventory === 'function') renderInventory();

    const nombresCategorias = categoriaKeys.map(k => DEMO_CATEGORIAS_COMIDA[k]?.nombre || k).join(', ');

    Swal.fire({
        title: '¡Menú Actualizado!',
        html: `Se cargaron <b>${itemsACargar.length} productos</b> de las categorías:<br><b class="text-orange-600">${nombresCategorias}</b>.`,
        icon: 'success',
        confirmButtonColor: '#ea580c'
    });
}

function cargarDemoComidaRapidaPrompt() {
    abrirModalDemoCategorias();
}

function cargarDemoComidaRapida() {
    // Carga todas las categorías disponibles por defecto
    cargarDemoCategorias(Object.keys(DEMO_CATEGORIAS_COMIDA));
}

