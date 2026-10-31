import test from 'node:test';
import assert from 'node:assert/strict';

function roundMoney(num) {
    return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
}

test('Fase 4: Torre de Control, Arqueo Z y Caja Chica', async (t) => {
    await t.test('TC-F4-01: Descuento exacto de fondos en arqueo según origen del gasto', () => {
        const tasa = 40.0;
        let espEfUsd = 100.0;
        let espEfBs = 2000.0;
        let espPMBs = 5000.0;

        const mockGastos = [
            { origen: 'Gaveta Efectivo USD', moneda: 'USD', montoOriginal: 15.0, montoUsd: 15.0 },
            { origen: 'Gaveta Efectivo Bs', moneda: 'BS', montoOriginal: 400.0, montoUsd: 10.0 },
            { origen: 'Pago Móvil / Banco', moneda: 'BS', montoOriginal: 1000.0, montoUsd: 25.0 }
        ];

        mockGastos.forEach(g => {
            const origen = String(g.origen || '').toLowerCase();
            const montoOrig = parseFloat(g.montoOriginal || g.montoUsd || 0);
            if (origen.includes('pago móvil') || origen.includes('pago movil') || origen.includes('banco')) {
                espPMBs -= (g.moneda === 'BS' ? montoOrig : montoOrig * tasa);
            } else if (origen.includes('efectivo bs')) {
                espEfBs -= (g.moneda === 'BS' ? montoOrig : montoOrig * tasa);
            } else {
                espEfUsd -= (g.moneda === 'USD' ? montoOrig : (tasa > 0 ? montoOrig / tasa : 0));
            }
        });

        // Verificaciones
        assert.equal(espEfUsd, 85.0, 'Efectivo USD debe restar exactamente $15');
        assert.equal(espEfBs, 1600.0, 'Efectivo Bs debe restar exactamente 400 Bs');
        assert.equal(espPMBs, 4000.0, 'Pago Móvil debe restar exactamente 1000 Bs');
    });

    await t.test('TC-F4-02: Diagnóstico de diferencias en Arqueo Z (Exacto, Sobrante, Faltante)', () => {
        const tasa = 40.0;
        const esperadoUsd = 150.0;

        function diagnosticar(fisUsd, fisBs) {
            const totalFisUsd = fisUsd + (fisBs / tasa);
            const difUsd = roundMoney(totalFisUsd - esperadoUsd);
            let estado = 'cuadrado';
            if (difUsd > 0.05) estado = 'sobrante';
            else if (difUsd < -0.05) estado = 'faltante';
            return { difUsd, estado };
        }

        // Caso 1: Exacto
        const r1 = diagnosticar(150.0, 0);
        assert.equal(r1.estado, 'cuadrado');
        assert.equal(r1.difUsd, 0);

        // Caso 2: Sobrante de $5
        const r2 = diagnosticar(155.0, 0);
        assert.equal(r2.estado, 'sobrante');
        assert.equal(r2.difUsd, 5.0);

        // Caso 3: Faltante de $10
        const r3 = diagnosticar(140.0, 0);
        assert.equal(r3.estado, 'faltante');
        assert.equal(r3.difUsd, -10.0);
    });

    await t.test('TC-F4-03: Formato de ticket térmico Corte Z dual (58mm vs 80mm)', () => {
        function getCorteZConfig(storeConfig) {
            const is58mm = (storeConfig && storeConfig.ticketWidth === '58mm');
            return {
                width: is58mm ? '58mm' : '80mm',
                maxWidth: is58mm ? '58mm' : '300px',
                fontSize: is58mm ? '10px' : '11px',
                headerSize: is58mm ? '13px' : '15px'
            };
        }

        const config58 = getCorteZConfig({ ticketWidth: '58mm' });
        assert.equal(config58.width, '58mm');
        assert.equal(config58.fontSize, '10px');

        const config80 = getCorteZConfig({ ticketWidth: '80mm' });
        assert.equal(config80.width, '80mm');
        assert.equal(config80.fontSize, '11px');
    });

    await t.test('TC-F4-04: Enlace WhatsApp inteligente para Arqueo de Caja', () => {
        function generarUrlWhatsApp(phoneRaw, msg) {
            const cleanPhone = phoneRaw ? phoneRaw.replace(/\D/g, '') : '';
            return cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
        }

        const msg = 'ARQUEO DE CAJA DIARIO';
        const urlConTelefono = generarUrlWhatsApp('04121234567', msg);
        assert.ok(urlConTelefono.includes('https://wa.me/04121234567?text='), 'Debe incluir el número directo');

        const urlSinTelefono = generarUrlWhatsApp('', msg);
        assert.ok(urlSinTelefono.startsWith('https://wa.me/?text='), 'Debe usar link universal');
    });

    await t.test('TC-F4-05: Consolidación limpia en Torre de Control sin datos inventados', () => {
        const branches = [
            { id: 'b1', nombre: 'Sede Principal', tieneDatos: true, ventasUsd: 350.0, gananciaUsd: 110.0, estaCerrada: false, sinRegistro: false },
            { id: 'b2', nombre: 'Sede Este', tieneDatos: true, ventasUsd: 220.0, gananciaUsd: 75.0, estaCerrada: true, sinRegistro: false },
            { id: 'b3', nombre: 'Sede Oeste (Remota)', tieneDatos: false, ventasUsd: 0, gananciaUsd: 0, estaCerrada: false, sinRegistro: true }
        ];

        let totalVentas = 0;
        let totalGanancia = 0;
        let abiertas = 0;
        let cerradas = 0;
        let sinRegistro = 0;

        branches.forEach(b => {
            if (b.tieneDatos) {
                totalVentas += b.ventasUsd;
                totalGanancia += b.gananciaUsd;
            }
            if (b.sinRegistro) sinRegistro++;
            else if (b.estaCerrada) cerradas++;
            else abiertas++;
        });

        assert.equal(totalVentas, 570.0, 'Suma solo sucursales con datos reales');
        assert.equal(totalGanancia, 185.0);
        assert.equal(abiertas, 1);
        assert.equal(cerradas, 1);
        assert.equal(sinRegistro, 1);
    });
});
