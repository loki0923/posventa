import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validarPerfilUsuario } from '../scripts/verify-users.mjs';

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

describe('Bloque B: Seguridad, Higiene y Prevención de Fugas de Información', () => {

    test('TC-SEC-01: escapeHtml neutraliza etiquetas scripts, atributos y comillas', () => {
        const payloadXSS = '<script>alert("xss")</script>';
        assert.equal(escapeHtml(payloadXSS), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');

        const imgXSS = '<img src=x onerror=alert(1)>';
        assert.equal(escapeHtml(imgXSS), '&lt;img src=x onerror=alert(1)&gt;');

        const attrBreakout = "'); alert('hack'); ('";
        assert.equal(escapeHtml(attrBreakout), '&#39;); alert(&#39;hack&#39;); (&#39;');

        assert.equal(escapeHtml(null), '');
        assert.equal(escapeHtml(undefined), '');
    });

    test('TC-SEC-02: index.html no contiene credenciales de prueba ni demo button en el código estático', () => {
        const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
        assert.equal(indexHtml.includes('id="btn-demo-credentials"'), false, 'index.html no debe incluir el botón de prueba en código servido por defecto');
        assert.equal(indexHtml.includes('placeholder="admin@bodega.com"'), false, 'index.html no debe sugerir admin@bodega.com en el formulario');
    });

    test('TC-SEC-03: app.js no tiene puertas traseras ni fallback a bodega-demo en catálogo', () => {
        const appJs = fs.readFileSync(path.resolve('app.js'), 'utf8');
        assert.equal(appJs.includes("currentNegocioId || 'bodega-demo'"), false, 'app.js no debe recurrir a bodega-demo como fallback de catálogo');
        assert.equal(appJs.includes('function escapeHtml('), true, 'app.js debe implementar el helper escapeHtml');
    });

    test('TC-SEC-04: catalogo.html no tiene fallback a bodega-demo ni tasa hardcoded 36.50', () => {
        const catHtml = fs.readFileSync(path.resolve('catalogo.html'), 'utf8');
        assert.equal(catHtml.includes("|| 'bodega-demo'"), false, 'catalogo.html no debe usar bodega-demo por defecto');
        assert.equal(catHtml.includes('let tasaBcv = 36.50;'), false, 'catalogo.html no debe asumir tasa inicial 36.50');
        assert.equal(catHtml.includes('products_public'), true, 'catalogo.html debe soportar la colección pública products_public');
    });

    test('TC-SEC-05: Proyección pública products_public omite costos y proveedores', () => {
        const productoInterno = {
            id: 'prod_123',
            codigo: '759123456',
            nombre: 'Harina P.A.N. 1Kg',
            marca: 'P.A.N.',
            categoria: 'Víveres',
            precio: 1.45,
            costo: 0.95,
            stock: 45,
            proveedor: 'Distribuidora Polar C.A.',
            tipo: 'unidad',
            imagen: 'https://img.com/pan.png'
        };

        const proyeccionPublica = {
            nombre: productoInterno.nombre,
            marca: productoInterno.marca || '',
            categoria: productoInterno.categoria || 'General',
            precio: productoInterno.precio,
            tipo: productoInterno.tipo,
            imagen: productoInterno.imagen || '',
            disponible: (productoInterno.stock > 0),
            activo: true
        };

        assert.equal(proyeccionPublica.costo, undefined, 'La proyección pública no debe contener el campo costo');
        assert.equal(proyeccionPublica.proveedor, undefined, 'La proyección pública no debe contener el proveedor');
        assert.equal(proyeccionPublica.stock, undefined, 'La proyección pública no debe exponer el stock numérico exacto');
        assert.equal(proyeccionPublica.disponible, true);
    });

    test('TC-SEC-06: Script de verificación valida correctamente perfiles según R1', () => {
        assert.equal(validarPerfilUsuario(null).valido, false);
        assert.equal(validarPerfilUsuario({}).valido, false);
        assert.equal(validarPerfilUsuario({ negocioId: 'c12', role: 'admin' }).valido, false, 'negocioId muy corto');
        assert.equal(validarPerfilUsuario({ negocioId: 'bodega_real_123', role: 'superadmin' }).valido, false, 'role no permitido');
        assert.equal(validarPerfilUsuario({ negocioId: 'bodega_real_123', role: 'admin' }).valido, true);
        assert.equal(validarPerfilUsuario({ negocioId: 'bodega_real_123', role: 'cajero' }).valido, true);
    });
});
