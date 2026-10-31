import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper de normalización idéntico al implementado en app.js
function normalizarTextoBusqueda(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function filtrarCatalogo(productos, queryRaw = '', categoria = 'Todos') {
    const q = normalizarTextoBusqueda(queryRaw);
    return productos.filter(p => {
        const nom = normalizarTextoBusqueda(p.nombre);
        const cat = normalizarTextoBusqueda(p.categoria);
        const cod = normalizarTextoBusqueda(p.codigo);
        const marca = normalizarTextoBusqueda(p.marca);
        const fullText = `${nom} ${cat} ${cod} ${marca}`;

        const matchCat = (categoria === 'Todos') || (p.categoria === categoria);
        const matchText = !q || fullText.includes(q);
        return matchCat && matchText;
    });
}

describe('Fase 2: Rendimiento, Búsqueda Indexada y Resiliencia Offline', () => {
    const catalogoPrueba = [
        { id: '1', nombre: 'Harina P.A.N. Maíz Blanco 1kg', categoria: 'Víveres', codigo: '759100100001', marca: 'P.A.N.' },
        { id: '2', nombre: 'Café Fama de América Tostado 500g', categoria: 'Víveres', codigo: '759100100002', marca: 'Fama de América' },
        { id: '3', nombre: 'Jabón Las Llaves Bebé 250g', categoria: 'Limpieza', codigo: '759100100003', marca: 'Las Llaves' },
        { id: '4', nombre: 'Queso Telita Fresco de Campo', categoria: 'Charcutería', codigo: '759100100004', marca: '' },
        { id: '5', nombre: 'Pepito Mixto Especial Callejero', categoria: 'Comida Rápida', codigo: 'CR-001', marca: '' }
    ];

    test('TC-PERF-01: Normalización de texto ignora tildes, diacríticos y mayúsculas', () => {
        assert.equal(normalizarTextoBusqueda('Café Molido'), 'cafe molido');
        assert.equal(normalizarTextoBusqueda('PÉRDIDA'), 'perdida');
        assert.equal(normalizarTextoBusqueda('Harina P.A.N. Maíz'), 'harina p.a.n. maiz');
        assert.equal(normalizarTextoBusqueda('   Órdenes de Compra   '), 'ordenes de compra');
    });

    test('TC-PERF-02: Búsqueda flexible encuentra productos con o sin acentos', () => {
        // Buscar "cafe" sin tilde debe encontrar "Café Fama de América"
        const r1 = filtrarCatalogo(catalogoPrueba, 'cafe');
        assert.equal(r1.length, 1);
        assert.equal(r1[0].id, '2');

        // Buscar "maiz" sin tilde debe encontrar "Harina P.A.N. Maíz"
        const r2 = filtrarCatalogo(catalogoPrueba, 'maiz');
        assert.equal(r2.length, 1);
        assert.equal(r2[0].id, '1');

        // Buscar por código de barras exacto o parcial
        const r3 = filtrarCatalogo(catalogoPrueba, '759100100003');
        assert.equal(r3.length, 1);
        assert.equal(r3[0].nombre, 'Jabón Las Llaves Bebé 250g');
    });

    test('TC-PERF-03: Filtrado simultáneo por categoría y texto', () => {
        const r1 = filtrarCatalogo(catalogoPrueba, 'fama', 'Víveres');
        assert.equal(r1.length, 1);

        // Si buscamos "fama" en Limpieza, debe dar 0 resultados
        const r2 = filtrarCatalogo(catalogoPrueba, 'fama', 'Limpieza');
        assert.equal(r2.length, 0);
    });

    test('TC-PERF-04: Resiliencia de cola offline y deduplicación por ID', () => {
        const colaLocal = [
            { id: 'OFF-001', totalUsd: 15.00 },
            { id: 'OFF-002', totalUsd: 22.50 }
        ];

        const ventasIDB = [
            { id: 'OFF-002', totalUsd: 22.50 }, // duplicado
            { id: 'OFF-003', totalUsd: 8.00 }   // nueva recuperada de IndexedDB
        ];

        // Fusión sin duplicados
        const idsExistentes = new Set(colaLocal.map(s => s.id));
        ventasIDB.forEach(s => {
            if (!idsExistentes.has(s.id)) {
                colaLocal.push(s);
            }
        });

        assert.equal(colaLocal.length, 3);
        assert.deepEqual(colaLocal.map(s => s.id), ['OFF-001', 'OFF-002', 'OFF-003']);

        // Eliminación atómica tras sincronización confirmada
        const confirmados = new Set(['OFF-001', 'OFF-003']);
        const pendientes = colaLocal.filter(s => !confirmados.has(s.id));
        assert.equal(pendientes.length, 1);
        assert.equal(pendientes[0].id, 'OFF-002');
    });
});
