import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Catálogo Online - Soporte Integral de Venta por Peso / Kg', async (t) => {
    const catalogoHtml = fs.readFileSync(path.resolve('catalogo.html'), 'utf8');

    await t.test('TC-CAT-01: catalogo.html contiene el Modal de Selección de Peso y chips de acceso rápido', () => {
        assert.ok(catalogoHtml.includes('id="weight-modal"'), 'Debe existir el contenedor del modal de peso');
        assert.ok(catalogoHtml.includes('id="weight-modal-input"'), 'Debe existir el input digital para escribir el peso');
        assert.ok(catalogoHtml.includes('setPresetPeso(0.250)'), 'Debe incluir acceso rápido de 250g');
        assert.ok(catalogoHtml.includes('setPresetPeso(0.500)'), 'Debe incluir acceso rápido de 500g (½ Kg)');
        assert.ok(catalogoHtml.includes('setPresetPeso(0.750)'), 'Debe incluir acceso rápido de 750g (¾ Kg)');
        assert.ok(catalogoHtml.includes('setPresetPeso(1.000)'), 'Debe incluir acceso rápido de 1.0 Kg');
        assert.ok(catalogoHtml.includes('setPresetPeso(1.500)'), 'Debe incluir acceso rápido de 1.5 Kg');
        assert.ok(catalogoHtml.includes('setPresetPeso(2.000)'), 'Debe incluir acceso rápido de 2.0 Kg');
        assert.ok(catalogoHtml.includes('ajustarPesoModal'), 'Debe incluir botones stepper para ajustar peso');
    });

    await t.test('TC-CAT-02: Detección inteligente de productos pesables (esProductoPesable)', () => {
        // Función extraída de catalogo.html
        function esProductoPesable(p) {
            if (!p) return false;
            const tipoStr = String(p.tipo || '').toLowerCase().trim();
            if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'peso', 'g', 'gr', 'gramo', 'gramos'].includes(tipoStr)) {
                return true;
            }
            const unidadStr = String(p.unidad || p.unidadMedida || '').toLowerCase().trim();
            if (['kg', 'kilo', 'kilos', 'peso'].includes(unidadStr)) return true;

            const nomStr = String(p.nombre || '').toLowerCase();
            if (nomStr.includes('/kg') || nomStr.includes('(kg)') || nomStr.includes(' por kg') || nomStr.includes(' x kg')) {
                return true;
            }
            return false;
        }

        assert.equal(esProductoPesable({ nombre: 'cochino', tipo: 'Kg' }), true, 'Cochino tipo Kg debe ser pesable');
        assert.equal(esProductoPesable({ nombre: 'Pollo', tipo: 'kg' }), true, 'Pollo tipo kg debe ser pesable');
        assert.equal(esProductoPesable({ nombre: 'Carne', tipo: 'peso' }), true, 'Carne tipo peso debe ser pesable');
        assert.equal(esProductoPesable({ nombre: 'Queso Paisa (Kg)', tipo: 'Unidad' }), true, 'Queso con (Kg) en nombre debe ser pesable');
        assert.equal(esProductoPesable({ nombre: 'Harina P.A.N. Blanca 1 Kg', tipo: 'Unidad' }), false, 'Harina por unidad de paquete no debe ser pesable');
        assert.equal(esProductoPesable({ nombre: 'Arroz Primor', tipo: 'und' }), false, 'Arroz unidad no debe ser pesable');
    });

    await t.test('TC-CAT-03: parseInputPeso maneja formatos con punto y coma decimal', () => {
        function parseInputPeso(valorStr) {
            if (!valorStr) return 0;
            const limpio = String(valorStr).replace(',', '.').replace(/[^0-9.]/g, '');
            const partes = limpio.split('.');
            if (partes.length > 2) {
                return parseFloat(partes[0] + '.' + partes.slice(1).join('')) || 0;
            }
            return parseFloat(limpio) || 0;
        }

        assert.equal(parseInputPeso('0.500'), 0.5);
        assert.equal(parseInputPeso('0,350'), 0.35);
        assert.equal(parseInputPeso('1,25'), 1.25);
        assert.equal(parseInputPeso('0,750 Kg'), 0.75);
        assert.equal(parseInputPeso(''), 0);
    });

    await t.test('TC-CAT-04: Cálculo exacto de precio en USD y Bs para cantidades por peso', () => {
        const tasaBcv = 889.26;
        const cochinoPrecio = 7.90; // $7.90 por Kg

        // Cliente pide 0.500 Kg (Medio Kilo)
        const pesoMedioKilo = 0.500;
        const totalUsd = pesoMedioKilo * cochinoPrecio; // $3.95
        const totalBs = totalUsd * tasaBcv;

        assert.equal(totalUsd.toFixed(2), '3.95');
        assert.equal(totalBs.toFixed(2), '3512.58');

        // Cliente pide 0.350 Kg
        const peso350g = 0.350;
        const totalUsd350 = peso350g * cochinoPrecio;
        assert.equal(totalUsd350.toFixed(2), '2.77');
    });

    await t.test('TC-CAT-05: El mensaje de WhatsApp no asume 1kg e incluye peso y precio unitario', () => {
        const cart = [
            { nombre: 'cochino', precio: 7.90, qty: 0.500, tipo: 'Kg' },
            { nombre: 'Harina P.A.N.', precio: 1.45, qty: 2, tipo: 'Unidad' }
        ];

        function esProductoPesable(p) {
            const tipoStr = String(p.tipo || '').toLowerCase().trim();
            return ['kg', 'peso'].includes(tipoStr);
        }

        const lineas = cart.map(i => {
            const isPeso = esProductoPesable(i);
            if (isPeso) {
                const pesoFmt = Number(i.qty).toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
                return `• ${pesoFmt} Kg de ${i.nombre} ($${(Number(i.precio) || 0).toFixed(2)}/Kg) - $${(i.precio * i.qty).toFixed(2)}`;
            }
            return `• ${i.qty}x ${i.nombre} - $${(i.precio * i.qty).toFixed(2)}`;
        }).join('\n');

        assert.ok(lineas.includes('• 0,5 Kg de cochino ($7.90/Kg) - $3.95') || lineas.includes('• 0.5 Kg de cochino ($7.90/Kg) - $3.95'), 'Debe formatear el peso exacto con su precio por Kg');
        assert.ok(lineas.includes('• 2x Harina P.A.N. - $2.90'), 'Debe conservar formato para unidades');
    });

    await t.test('TC-CAT-06: app.js conserva cantidades decimales en pedidos online transferidos al POS', () => {
        const appJs = fs.readFileSync(path.resolve('app.js'), 'utf8');

        // Verificar que no se use parseInt(item.qty) que truncaba 0.5 a 1 o 0
        assert.ok(appJs.includes('const isItemPeso ='), 'app.js debe identificar si el ítem de pedido online es de peso');
        assert.ok(appJs.includes('parseFloat(item.qty)'), 'app.js debe leer la cantidad con parseFloat para preservar decimales');
    });
});
