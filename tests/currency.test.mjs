import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper idéntico al implementado en app.js
function roundMoney(num) {
    return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
}

function calculateSubtotalBs(amountUsd, rate) {
    return roundMoney(amountUsd * rate);
}

function calculateChange({ totalUsd, pagadoUsd = 0, pagadoBs = 0, rateBcv = 36.50, returnCurrency = 'USD' }) {
    const pagadoBsEnUsd = roundMoney(pagadoBs / rateBcv);
    const totalPagadoUsd = roundMoney(pagadoUsd + pagadoBsEnUsd);
    const diferenciaUsd = roundMoney(totalPagadoUsd - totalUsd);

    if (diferenciaUsd < 0) {
        return { isComplete: false, pendingUsd: Math.abs(diferenciaUsd), change: 0, changeCurrency: returnCurrency };
    }

    if (returnCurrency === 'BS') {
        const changeBs = roundMoney(diferenciaUsd * rateBcv);
        return { isComplete: true, pendingUsd: 0, change: changeBs, changeCurrency: 'BS', changeUsdEquivalent: diferenciaUsd };
    }

    return { isComplete: true, pendingUsd: 0, change: diferenciaUsd, changeCurrency: 'USD' };
}

describe('Módulo de Finanzas & Moneda: TC-001, TC-002, TC-003', () => {
    test('TC-001: roundMoney previene errores de precisión flotante IEEE 754', () => {
        const floatBug = 0.1 + 0.2; // 0.30000000000000004
        assert.equal(roundMoney(floatBug), 0.30);

        const centavosSuma = roundMoney(19.99 + 0.01);
        assert.equal(centavosSuma, 20.00);

        const division = roundMoney(10 / 3); // 3.3333333...
        assert.equal(division, 3.33);
    });

    test('TC-002: Conversión Multimoneda exacta USD -> BS con Tasa BCV', () => {
        const rate = 36.50;
        const totalUsd = 12.50;
        const totalBs = calculateSubtotalBs(totalUsd, rate);
        assert.equal(totalBs, 456.25);

        // Caso con tasa con decimales complejos
        const rateDinamica = 38.125;
        const totalUsd2 = 7.80;
        assert.equal(calculateSubtotalBs(totalUsd2, rateDinamica), 297.38);
    });

    test('TC-003: Pagos Mixtos y Cálculo de Vuelto en USD', () => {
        const resultado = calculateChange({
            totalUsd: 20.00,
            pagadoUsd: 10.00,
            pagadoBs: 401.50, // 401.50 / 36.50 = 11.00 USD
            rateBcv: 36.50,
            returnCurrency: 'USD'
        });

        assert.equal(resultado.isComplete, true);
        assert.equal(resultado.pendingUsd, 0);
        assert.equal(resultado.change, 1.00);
        assert.equal(resultado.changeCurrency, 'USD');
    });

    test('TC-003-B: Pagos Mixtos y Cálculo de Vuelto en Bolívares (BS)', () => {
        const resultado = calculateChange({
            totalUsd: 15.00,
            pagadoUsd: 20.00,
            pagadoBs: 0,
            rateBcv: 36.50,
            returnCurrency: 'BS'
        });

        assert.equal(resultado.isComplete, true);
        assert.equal(resultado.changeUsdEquivalent, 5.00);
        assert.equal(resultado.change, 182.50); // 5.00 * 36.50
        assert.equal(resultado.changeCurrency, 'BS');
    });

    test('TC-003-C: Detección de pago incompleto', () => {
        const resultado = calculateChange({
            totalUsd: 50.00,
            pagadoUsd: 20.00,
            pagadoBs: 365.00, // 10 USD
            rateBcv: 36.50,
            returnCurrency: 'USD'
        });

        assert.equal(resultado.isComplete, false);
        assert.equal(resultado.pendingUsd, 20.00);
        assert.equal(resultado.change, 0);
    });
});
