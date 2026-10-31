#!/usr/bin/env node
// =====================================================================
// SUBIR LA VERSIÓN DE GESTIÓPROPOS
// ---------------------------------------------------------------------
// Hay TRES sitios que tienen que ir siempre juntos:
//
//   1. sw.js        -> CACHE_NAME = 'gestionpro-pos-vN'   (borra la caché vieja)
//   2. index.html   -> <script src="app.js?v=N">          (rompe la caché del SW)
//   3. app.js       -> APP_VERSION = 'vN · fecha'         (lo que ves en pantalla)
//
// Si se te olvida uno, el navegador sigue ejecutando código viejo desde la
// caché del service worker durante una carga completa, y parece que los
// cambios "no se aplicaron". Ese fue exactamente el problema que costó varias
// rondas de diagnóstico.
//
// USO:
//   node bump-version.mjs                  -> autoincrementa (v4 -> v5)
//   node bump-version.mjs 9                -> fuerza v9
//   node bump-version.mjs 9 "torre de control"   -> añade una nota
//   npm run bump
// =====================================================================

import { readFileSync, writeFileSync } from 'node:fs';

const ARCHIVO_SW = 'sw.js';
const ARCHIVO_HTML = 'index.html';
const ARCHIVO_APP = 'app.js';

const leer = (f) => readFileSync(f, 'utf8');

// ---------------------------------------------------------------------
// 1) Leer la versión actual desde sw.js (es la fuente de verdad)
// ---------------------------------------------------------------------
const swOriginal = leer(ARCHIVO_SW);
const encontrado = swOriginal.match(/CACHE_NAME\s*=\s*'gestionpro-pos-v(\d+)'/);
if (!encontrado) {
    console.error("ERROR: no encontré CACHE_NAME = 'gestionpro-pos-vN' en sw.js");
    process.exit(1);
}

const actual = Number(encontrado[1]);

// Acepta tres formas:
//   node bump-version.mjs 9 "nota"   -> fuerza la version 9
//   node bump-version.mjs "nota"     -> autoincrementa y usa "nota"
//   node bump-version.mjs            -> solo autoincrementa
const arg1 = process.argv[2];
const arg2 = process.argv[3];
const arg1EsNumero = arg1 !== undefined && /^\d+$/.test(arg1);

const nuevo = arg1EsNumero ? Number(arg1) : actual + 1;
const textoNota = arg1EsNumero ? arg2 : arg1;

if (!Number.isInteger(nuevo) || nuevo <= 0) {
    console.error(`ERROR: versión inválida "${arg1}". Usa un entero positivo.`);
    process.exit(1);
}
if (nuevo === actual) {
    console.error(`ERROR: la versión ya es v${actual}. Nada que hacer.`);
    process.exit(1);
}

const nota = textoNota ? ` · ${textoNota}` : '';
const fecha = new Date().toLocaleDateString('es-VE', {
    day: '2-digit', month: '2-digit', year: 'numeric'
});
const etiqueta = `v${nuevo} · ${fecha}${nota}`;

// ---------------------------------------------------------------------
// 2) sw.js
// ---------------------------------------------------------------------
writeFileSync(
    ARCHIVO_SW,
    swOriginal.replace(/CACHE_NAME\s*=\s*'gestionpro-pos-v\d+'/, `CACHE_NAME = 'gestionpro-pos-v${nuevo}'`),
    'utf8'
);

// ---------------------------------------------------------------------
// 3) index.html
// ---------------------------------------------------------------------
const htmlOriginal = leer(ARCHIVO_HTML);
if (!/app\.js\?v=\d+/.test(htmlOriginal)) {
    console.error('ERROR: no encontré app.js?v=N en index.html (¿se perdió el cache-buster?)');
    process.exit(1);
}
writeFileSync(ARCHIVO_HTML, htmlOriginal.replace(/app\.js\?v=\d+/, `app.js?v=${nuevo}`), 'utf8');

// ---------------------------------------------------------------------
// 4) app.js
// ---------------------------------------------------------------------
const appOriginal = leer(ARCHIVO_APP);
if (!/const APP_VERSION = '[^']*';/.test(appOriginal)) {
    console.error('ERROR: no encontré APP_VERSION en app.js');
    process.exit(1);
}
writeFileSync(
    ARCHIVO_APP,
    appOriginal.replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${etiqueta}';`),
    'utf8'
);

// ---------------------------------------------------------------------
console.log(`Versión subida: v${actual} -> v${nuevo}\n`);
console.log(`  sw.js        CACHE_NAME = 'gestionpro-pos-v${nuevo}'`);
console.log(`  index.html   <script src="app.js?v=${nuevo}">`);
console.log(`  app.js       APP_VERSION = '${etiqueta}'`);
console.log('\nRecarga la app (el shell va network-first) y comprueba la versión en la barra lateral.');
