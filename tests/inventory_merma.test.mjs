import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

function roundWeight(num) {
    return Math.round((Number(num || 0) + Number.EPSILON) * 1000) / 1000;
}

function calculateItemSubtotal({ precioPorUnidad, cantidad, unidad = 'unidad' }) {
    if (unidad === 'g') {
        // Si el precio está en USD/kg y la cantidad pesada en gramos
        const kg = cantidad / 1000;
        return {
            pesoKg: roundWeight(kg),
            subtotalUsd: Math.round((kg * precioPorUnidad + Number.EPSILON) * 100) / 100
        };
    }
    // unidad o kg directos
    return {
        pesoKg: roundWeight(cantidad),
        subtotalUsd: Math.round((cantidad * precioPorUnidad + Number.EPSILON) * 100) / 100
    };
}

function calculateMermaLoss({ costoUSD, pesoInicial, pesoFinal, motivo }) {
    const perdidaKg = roundWeight(pesoInicial - pesoFinal);
    if (perdidaKg < 0) {
        throw new Error('El peso final no puede superar al peso inicial');
    }
    const perdidaDineroUsd = Math.round((perdidaKg * costoUSD + Number.EPSILON) * 100) / 100;
    return {
        perdidaKg,
        perdidaDineroUsd,
        motivo,
        porcentajeMerma: Math.round(((perdidaKg / pesoInicial) * 100 + Number.EPSILON) * 10) / 10
    };
}

describe('Módulo de Inventario, Balanza y Mermas: TC-007', () => {
    test('TC-007: Venta por balanza con precisión de 3 decimales en Kg', () => {
        const item = {
            precioPorUnidad: 4.50, // $4.50 por kg
            cantidad: 1.450,       // 1.450 kg
            unidad: 'kg'
        };

        const res = calculateItemSubtotal(item);
        assert.equal(res.pesoKg, 1.450);
        assert.equal(res.subtotalUsd, 6.53); // 1.450 * 4.50 = 6.525 => 6.53
    });

    test('TC-007-B: Conversión de gramos de balanza a USD/Kg', () => {
        const item = {
            precioPorUnidad: 12.00, // $12.00 por kg de queso
            cantidad: 350,          // 350 gramos
            unidad: 'g'
        };

        const res = calculateItemSubtotal(item);
        assert.equal(res.pesoKg, 0.350);
        assert.equal(res.subtotalUsd, 4.20); // 0.35 * 12.00 = 4.20
    });

    test('TC-007-C: Registro y cálculo de costo financiero por Mermas', () => {
        const merma = calculateMermaLoss({
            costoUSD: 3.20,
            pesoInicial: 50.000, // Saco de 50 kg de papas
            pesoFinal: 47.500,   // Peso útil tras limpieza
            motivo: 'Pudrición / Deshidratación natural'
        });

        assert.equal(merma.perdidaKg, 2.500);
        assert.equal(merma.perdidaDineroUsd, 8.00); // 2.5 * 3.20
        assert.equal(merma.porcentajeMerma, 5.0);   // 5% de merma
    });

    test('TC-007-D: Soporte de pesos menores a 1 Kg (Ej: 0.300 Kg o 0,300 Kg) en carrito de bodega', () => {
        const isWeighedType = (t) => ['kg', 'kilo', 'kilos', 'g', 'gr', 'gramos', 'peso'].includes(String(t || '').toLowerCase().trim());
        const parseInputQty = (input) => {
            const raw = typeof input === 'string' ? parseFloat(input.replace(',', '.')) : Number(input);
            return isNaN(raw) ? 0 : raw;
        };

        const prodPollo = { id: 'p_pollo', nombre: 'Pollo', precio: 4.01, tipo: 'Kg', stock: 50 };

        const simularAddToCart = (cart, prod, inputQty) => {
            const isWeight = isWeighedType(prod.tipo);
            const rawQ = parseInputQty(inputQty);
            const cant = isWeight ? Math.round(rawQ * 1000) / 1000 : (rawQ > 0 ? rawQ : 1);
            cart.push({ ...prod, qty: cant });
            return cant;
        };

        // 1. Ingreso con punto decimal (0.300)
        const cart1 = [];
        simularAddToCart(cart1, prodPollo, '0.300');
        assert.equal(cart1[0].qty, 0.3);
        const subtotal1 = Math.round(cart1[0].qty * cart1[0].precio * 100) / 100;
        assert.equal(subtotal1, 1.20); // 0.3 * 4.01 = 1.203 => 1.20

        // 2. Ingreso con coma decimal (0,300)
        const cart2 = [];
        simularAddToCart(cart2, prodPollo, '0,300');
        assert.equal(cart2[0].qty, 0.3);

        // 3. Ingreso de 150 gramos (0.150 Kg)
        const cart3 = [];
        simularAddToCart(cart3, prodPollo, 0.15);
        assert.equal(cart3[0].qty, 0.15);
    });

    test('TC-007-E: En Modo Bodega no debe mostrarse el botón Personalizar Salsas / Extras en el ticket', () => {
        const renderCustomizeBtn = (isComidaMode, item) => {
            if (isComidaMode) {
                return '<button class="quick-mods">Con Todo</button>';
            }
            return ''; // En bodega NO existe botón de salsas ni extras
        };

        const itemPollo = { nombre: 'Pollo', tipo: 'Kg', qty: 0.3 };
        const btnHtmlBodega = renderCustomizeBtn(false, itemPollo);
        assert.equal(btnHtmlBodega, '', 'En modo bodega el botón de salsas debe ser cadena vacía');
        assert.equal(btnHtmlBodega.includes('Personalizar Salsas'), false);

        const btnHtmlComida = renderCustomizeBtn(true, itemPollo);
        assert.ok(btnHtmlComida.length > 0, 'En comida rápida sí debe existir');
    });

    test('TC-007-F: Integridad de updateCartUI y prevención de ReferenceError en TDZ', async () => {
        const fs = await import('fs');
        const code = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

        // Extraer cuerpo de updateCartUI
        const startIdx = code.indexOf('function updateCartUI()');
        assert.ok(startIdx > -1, 'updateCartUI debe existir en app.js');
        const slice = code.slice(startIdx, startIdx + 3000);

        const firstDecl = slice.indexOf('const isComidaMode');
        const firstUse = slice.indexOf('if (isComidaMode');

        assert.ok(firstDecl > -1, 'isComidaMode debe estar declarado');
        assert.ok(firstUse > -1, 'isComidaMode debe usarse en updateCartUI');
        assert.ok(firstDecl < firstUse, 'isComidaMode DEBE declararse antes de su primer uso para evitar TDZ ReferenceError');
    });
});
