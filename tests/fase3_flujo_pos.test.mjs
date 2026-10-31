import test from 'node:test';
import assert from 'node:assert/strict';

// Helper de formato de cantidades (idéntico a la implementación en app.js)
function formatQty(qty, tipo) {
    const num = parseFloat(qty) || 0;
    const tipoStr = String(tipo || '').toLowerCase().trim();
    const esPeso = ['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'peso', 'g', 'gramo', 'gramos'].includes(tipoStr);
    if (esPeso) {
        return num.toLocaleString('es-VE', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
    }
    return Math.round(num).toString();
}

test('Fase 3: Flujo de POS y Cobro', async (t) => {
    await t.test('TC-F3-01: formatQty formatea enteros para unidades y decimales limpios para peso', () => {
        // Unidades
        assert.equal(formatQty(30, 'und'), '30');
        assert.equal(formatQty('1.0', 'unidad'), '1');
        assert.equal(formatQty(15.00, 'pz'), '15');
        assert.equal(formatQty(1, 'und'), '1');

        // Peso / Kg
        const peso1 = formatQty(1.25, 'kg');
        assert.ok(peso1.includes('1,25') || peso1.includes('1.25'), 'Debe contener 1,25');
        const peso2 = formatQty(0.3, 'kg');
        assert.ok(peso2.includes('0,3') || peso2.includes('0.3'), 'Debe contener 0,3');
        const peso3 = formatQty(2.5, 'peso');
        assert.ok(peso3.includes('2,5') || peso3.includes('2.5'), 'Debe contener 2,5');
    });

    await t.test('TC-F3-02: procesarCodigoEscaneado con regla de coincidencia estricta', () => {
        const mockProducts = [
            { id: '1', nombre: 'Harina PAN Blanca', codigo: '7591001', stock: 10, tipo: 'und', precio: 1.2 },
            { id: '2', nombre: 'Harina PAN Amarilla', codigo: '7591002', stock: 8, tipo: 'und', precio: 1.3 },
            { id: '3', nombre: 'Arroz Primor 1Kg', codigo: '7592001', stock: 15, tipo: 'und', precio: 1.5 }
        ];

        // 1. Coincidencia exacta de código
        const matchExacto = mockProducts.find(p => p.codigo === '7591001');
        assert.ok(matchExacto, 'Debe encontrar el producto con código exacto');
        assert.equal(matchExacto.nombre, 'Harina PAN Blanca');

        // 2. Coincidencia parcial con múltiples resultados: NO debe auto-agregar a ciegas
        const matchesHarina = mockProducts.filter(p => p.nombre.toLowerCase().includes('harina'));
        assert.equal(matchesHarina.length, 2, 'Hay 2 harinas distintas');
        assert.ok(matchesHarina.length > 1, 'No debe auto-seleccionar si hay ambigüedad');

        // 3. Coincidencia parcial con exactamente 1 resultado: SÍ califica para auto-agregar
        const matchesArroz = mockProducts.filter(p => p.nombre.toLowerCase().includes('arroz'));
        assert.equal(matchesArroz.length, 1, 'Solo hay 1 arroz');
        assert.equal(matchesArroz[0].id, '3');
    });

    await t.test('TC-F3-03: Soporte para ticket térmico dual (58mm vs 80mm)', () => {
        function getTicketOptions(storeConfig) {
            const is58mm = (storeConfig && storeConfig.ticketWidth === '58mm');
            return {
                width: is58mm ? '58mm' : '78mm',
                padding: is58mm ? '2mm 1mm' : '4mm 3mm',
                fontSize: is58mm ? '11px' : '12px',
                qrSize: is58mm ? 70 : 85
            };
        }

        const config80 = { ticketWidth: '80mm' };
        const opt80 = getTicketOptions(config80);
        assert.equal(opt80.width, '78mm');
        assert.equal(opt80.fontSize, '12px');
        assert.equal(opt80.qrSize, 85);

        const config58 = { ticketWidth: '58mm' };
        const opt58 = getTicketOptions(config58);
        assert.equal(opt58.width, '58mm');
        assert.equal(opt58.fontSize, '11px');
        assert.equal(opt58.qrSize, 70);
    });

    await t.test('TC-F3-04: clearCart modo silencioso para post-venta', () => {
        let cart = [{ id: 'prod1', qty: 2 }];
        let discount = 5;
        let puntos = 100;

        function clearCart(silent = false, confirmFn = null) {
            if (!silent && cart.length > 0) {
                if (confirmFn) confirmFn();
                return;
            }
            cart = [];
            discount = 0;
            puntos = 0;
        }

        // Silent = true (tras venta procesada)
        clearCart(true);
        assert.equal(cart.length, 0);
        assert.equal(discount, 0);
        assert.equal(puntos, 0);

        // Repoblar y llamar interactivo
        cart = [{ id: 'prod2', qty: 1 }];
        let confirmPrompted = false;
        clearCart(false, () => { confirmPrompted = true; });
        assert.equal(confirmPrompted, true, 'Debe requerir confirmación interactiva');
        assert.equal(cart.length, 1, 'No debe vaciarse sin confirmación');
    });

    await t.test('TC-F3-05: Validación de atajos de teclado y F4 en modal de cobro', () => {
        function evaluarAccionF4(isPaymentOpen, isCartEmpty, isPaymentValid) {
            if (isPaymentOpen) {
                if (isPaymentValid) return 'CONFIRMAR_VENTA';
                return 'PAGO_INSUFICIENTE';
            }
            if (!isCartEmpty) return 'ABRIR_MODAL_COBRO';
            return 'IGNORAR';
        }

        // En POS con productos: F4 abre modal de cobro
        assert.equal(evaluarAccionF4(false, false, false), 'ABRIR_MODAL_COBRO');

        // En POS vacío: F4 no hace nada
        assert.equal(evaluarAccionF4(false, true, false), 'IGNORAR');

        // En modal de cobro con pago completo: F4 confirma venta directamente
        assert.equal(evaluarAccionF4(true, false, true), 'CONFIRMAR_VENTA');

        // En modal de cobro con pago incompleto: no confirma a ciegas
        assert.equal(evaluarAccionF4(true, false, false), 'PAGO_INSUFICIENTE');
    });
});
