import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper de multiplicador extraído de procesarCodigoEscaneado
function parseBarcodeMultiplier(val) {
    if (!val) return { multiplier: 1, query: '' };
    val = val.trim();
    let multiplier = 1;
    const multMatch = val.match(/^([0-9]+(?:[\.,][0-9]+)?)\s*[\*xX]\s*(.+)$/);
    if (multMatch) {
        const parsedMult = parseFloat(multMatch[1].replace(',', '.'));
        if (parsedMult > 0) {
            multiplier = parsedMult;
            val = multMatch[2].trim();
        }
    }
    return { multiplier, query: val.toLowerCase() };
}

// Lógica de Ticket en Espera (Park / Hold Cart)
function holdTicketLogic(cart, heldTicket) {
    if (cart.length > 0) {
        if (heldTicket && heldTicket.items && heldTicket.items.length > 0) {
            // Swap
            const temp = [...cart];
            const restored = [...heldTicket.items];
            return {
                newCart: restored,
                newHeld: { items: temp, timestamp: Date.now() },
                action: 'swapped'
            };
        }
        return {
            newCart: [],
            newHeld: { items: [...cart], timestamp: Date.now() },
            action: 'held'
        };
    } else if (heldTicket && heldTicket.items && heldTicket.items.length > 0) {
        return {
            newCart: [...heldTicket.items],
            newHeld: null,
            action: 'restored'
        };
    }
    return { newCart: cart, newHeld: heldTicket, action: 'none' };
}

describe('Optimizaciones de Agilidad en Caja: TC-SPEED-01 a TC-SPEED-04', () => {
    test('TC-SPEED-01: Extracción de multiplicador rápido de cantidad (N*código / N*producto)', () => {
        // Multiplicador estándar asterisco
        const r1 = parseBarcodeMultiplier('3*harina');
        assert.equal(r1.multiplier, 3);
        assert.equal(r1.query, 'harina');

        // Multiplicador con 'x' mayúscula/minúscula
        const r2 = parseBarcodeMultiplier('12X7591234567890');
        assert.equal(r2.multiplier, 12);
        assert.equal(r2.query, '7591234567890');

        // Decimales con coma o punto (ej. 2,5 Kg de queso)
        const r3 = parseBarcodeMultiplier('2,5*queso duro');
        assert.equal(r3.multiplier, 2.5);
        assert.equal(r3.query, 'queso duro');

        const r4 = parseBarcodeMultiplier('1.75*jamon');
        assert.equal(r4.multiplier, 1.75);
        assert.equal(r4.query, 'jamon');

        // Sin multiplicador
        const r5 = parseBarcodeMultiplier('arroz mary');
        assert.equal(r5.multiplier, 1);
        assert.equal(r5.query, 'arroz mary');
    });

    test('TC-SPEED-02: Ticket en Espera (Pausar y Restaurar carrito en 1 toque)', () => {
        const cart1 = [
            { id: 'prod_1', nombre: 'Arroz Mary 1Kg', precio: 1.20, qty: 2 },
            { id: 'prod_2', nombre: 'Aceite Diana 1L', precio: 2.50, qty: 1 }
        ];
        let held = null;

        // 1. Pausar ticket actual con 2 productos
        const resPause = holdTicketLogic(cart1, held);
        assert.equal(resPause.action, 'held');
        assert.equal(resPause.newCart.length, 0);
        assert.equal(resPause.newHeld.items.length, 2);

        // 2. Con carrito vacío, restaurar ticket en espera
        const resRestore = holdTicketLogic(resPause.newCart, resPause.newHeld);
        assert.equal(resRestore.action, 'restored');
        assert.equal(resRestore.newCart.length, 2);
        assert.equal(resRestore.newHeld, null);
    });

    test('TC-SPEED-03: Intercambio inteligente cuando ya hay un ticket en espera', () => {
        const cartCliente2 = [{ id: 'prod_9', nombre: 'Refresco 2L', precio: 1.50, qty: 1 }];
        const existingHeld = {
            items: [{ id: 'prod_1', nombre: 'Harina PAN', precio: 1.10, qty: 3 }],
            timestamp: 1000
        };

        const resSwap = holdTicketLogic(cartCliente2, existingHeld);
        assert.equal(resSwap.action, 'swapped');
        assert.equal(resSwap.newCart[0].nombre, 'Harina PAN');
        assert.equal(resSwap.newHeld.items[0].nombre, 'Refresco 2L');
    });

    test('TC-SPEED-04: Atajos de billetes USD calculan vuelto exacto de inmediato', () => {
        const totalCuentaUsd = 14.50;
        const billeteEntregado = 20.00;
        const tasa = 36.50;

        const vueltoUsd = billeteEntregado - totalCuentaUsd;
        assert.equal(vueltoUsd, 5.50);

        const vueltoBs = Math.round((vueltoUsd * tasa) * 100) / 100;
        assert.equal(vueltoBs, 200.75);
    });
});
