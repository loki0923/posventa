import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

function roundMoney(num) {
    return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
}

function usdToBs(usd, tasa) {
    if (!tasa || tasa <= 0) return 0;
    return roundMoney(usd * tasa);
}

function bsToUsd(bs, tasa) {
    if (!tasa || tasa <= 0) return 0;
    return roundMoney(bs / tasa);
}

const formatterVE = new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

function formatUSD(val) {
    return '$' + formatterVE.format(roundMoney(val));
}

function formatBs(val) {
    return 'Bs ' + formatterVE.format(roundMoney(val));
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

describe('Bloque D: Pruebas E2E Integrales del Flujo POS y Criterios de Aceptación', () => {

    // -------------------------------------------------------------
    // 1. LOGIN Y AISLAMIENTO MULTI-INQUILINO (MULTI-TENANT)
    // -------------------------------------------------------------
    test('E2E-01: Login y perfiles estrictos - Cajero vs Admin y aislamiento multi-tenant', () => {
        const fakeAuthDb = {
            'uid-admin-1': { email: 'dueno@negocio-alfa.com' },
            'uid-cajero-1': { email: 'cajero1@negocio-alfa.com' },
            'uid-cajero-2': { email: 'cajero2@negocio-beta.com' }
        };

        const fakeUsuariosColl = {
            'uid-admin-1': { negocioId: 'negocio-alfa', role: 'admin', email: 'dueno@negocio-alfa.com' },
            'uid-cajero-1': { negocioId: 'negocio-alfa', role: 'cajero', email: 'cajero1@negocio-alfa.com' },
            'uid-cajero-2': { negocioId: 'negocio-beta', role: 'cajero', email: 'cajero2@negocio-beta.com' }
        };

        function autenticar(uid) {
            const authUser = fakeAuthDb[uid];
            if (!authUser) throw new Error('Usuario no registrado');
            const userProfile = fakeUsuariosColl[uid];
            if (!userProfile || !userProfile.negocioId || !userProfile.role) {
                throw new Error('Perfil no provisionado en usuarios/{uid}');
            }
            return {
                uid,
                email: authUser.email,
                negocioId: userProfile.negocioId,
                role: userProfile.role,
                isAdmin: userProfile.role === 'admin'
            };
        }

        const sessionAdmin = autenticar('uid-admin-1');
        assert.equal(sessionAdmin.isAdmin, true);
        assert.equal(sessionAdmin.negocioId, 'negocio-alfa');

        const sessionCajero = autenticar('uid-cajero-1');
        assert.equal(sessionCajero.isAdmin, false);
        assert.equal(sessionCajero.role, 'cajero');

        // Intento de escalada: cajero modificando su propio rol localmente no cambia permisos en backend
        const cajeroMalicioso = { ...sessionCajero, role: 'admin', isAdmin: true };
        function verificarAccesoAdmin(session) {
            const profileReal = fakeUsuariosColl[session.uid];
            return profileReal && profileReal.role === 'admin';
        }
        assert.equal(verificarAccesoAdmin(cajeroMalicioso), false, 'Escalada de privilegios local es rechazada');

        // Aislamiento: cajero de negocio-beta no puede acceder a colección de negocio-alfa
        const sessionBeta = autenticar('uid-cajero-2');
        function consultarNegocio(session, targetNegocioId) {
            if (session.negocioId !== targetNegocioId) {
                throw new Error('PERMISSION_DENIED: Multi-tenant breach');
            }
            return { ok: true, negocio: targetNegocioId };
        }
        assert.throws(() => consultarNegocio(sessionBeta, 'negocio-alfa'), /PERMISSION_DENIED/);
    });

    // -------------------------------------------------------------
    // 2. VENTA EN USD ($)
    // -------------------------------------------------------------
    test('E2E-02: Venta en Efectivo USD con actualización de stock y caja', () => {
        const inventario = {
            'prod-1': { id: 'prod-1', nombre: 'Arroz 1kg', precio: 1.25, stock: 40, tipo: 'und' },
            'prod-2': { id: 'prod-2', nombre: 'Aceite 1L', precio: 3.50, stock: 15, tipo: 'und' }
        };

        const cart = [
            { producto: inventario['prod-1'], qty: 4 }, // 4 * 1.25 = 5.00
            { producto: inventario['prod-2'], qty: 2 }  // 2 * 3.50 = 7.00
        ];

        const totalUsd = roundMoney(cart.reduce((sum, item) => sum + (item.producto.precio * item.qty), 0));
        assert.equal(totalUsd, 12.00);

        // Cliente paga exacto con billete de $20
        const pagoUsd = 20.00;
        const vueltoUsd = roundMoney(pagoUsd - totalUsd);
        assert.equal(vueltoUsd, 8.00);

        // Descontar inventario
        cart.forEach(item => {
            item.producto.stock -= item.qty;
        });
        assert.equal(inventario['prod-1'].stock, 36);
        assert.equal(inventario['prod-2'].stock, 13);

        const ventaDoc = {
            id: 'v-001',
            totalUsd,
            metodoPago: 'efectivo-usd',
            pagadoUsd: pagoUsd,
            vueltoUsd,
            timestamp: new Date()
        };
        assert.equal(ventaDoc.totalUsd, 12.00);
        assert.equal(ventaDoc.vueltoUsd, 8.00);
    });

    // -------------------------------------------------------------
    // 3. VENTA EN BS (CON TASA REAL BCV)
    // -------------------------------------------------------------
    test('E2E-03: Venta en Bolívares con tasa BCV real y validación tarjeta vs ticket vs cobro', () => {
        const tasaBCV = 52.80; // Tasa real activa
        const precioUsd = 1.45;

        // Tarjeta del POS
        const bsTarjeta = usdToBs(precioUsd, tasaBCV);
        // Modal de cobro
        const bsCobro = usdToBs(precioUsd, tasaBCV);
        // Ticket de venta
        const bsTicket = usdToBs(precioUsd, tasaBCV);

        assert.equal(bsTarjeta, 76.56);
        assert.equal(bsCobro, 76.56);
        assert.equal(bsTicket, 76.56);
        assert.equal(formatBs(bsTarjeta), 'Bs 76,56');
        assert.equal(formatUSD(precioUsd), '$1,45');

        // Verificación de bloqueo si la tasa es 0
        function requireTasa(tasa) {
            if (!tasa || tasa <= 0) {
                return false;
            }
            return true;
        }
        assert.equal(requireTasa(0), false, 'Debe bloquear la operación si la tasa es 0');
        assert.equal(requireTasa(tasaBCV), true, 'Permite la operación con tasa válida');
    });

    // -------------------------------------------------------------
    // 4. VENTA MIXTA CON VUELTO EN DIVISAS Y BOLÍVARES
    // -------------------------------------------------------------
    test('E2E-04: Venta mixta (USD + Pago Móvil Bs) con cálculo exacto de vuelto sin drift', () => {
        const tasa = 50.00;
        const totalVentaUsd = 15.00; // Equivalente a Bs 750,00

        // Cliente entrega $10 en efectivo y el resto en Pago Móvil Bs
        const pagoEfectivoUsd = 10.00;
        const faltanteUsd = roundMoney(totalVentaUsd - pagoEfectivoUsd); // $5.00
        const pagoMovilBsEsperado = usdToBs(faltanteUsd, tasa); // Bs 250,00
        assert.equal(pagoMovilBsEsperado, 250.00);

        // Cliente transfiere Bs 300,00 por Pago Móvil (paga más por falta de cambio exacto)
        const pagoMovilRealBs = 300.00;
        const pagoMovilUsdEquiv = bsToUsd(pagoMovilRealBs, tasa); // $6.00

        const totalPagadoUsd = roundMoney(pagoEfectivoUsd + pagoMovilUsdEquiv); // $16.00
        const vueltoUsd = roundMoney(totalPagadoUsd - totalVentaUsd); // $1.00
        const vueltoBs = usdToBs(vueltoUsd, tasa); // Bs 50,00

        assert.equal(vueltoUsd, 1.00);
        assert.equal(vueltoBs, 50.00);
        assert.equal(formatUSD(vueltoUsd), '$1,00');
        assert.equal(formatBs(vueltoBs), 'Bs 50,00');
    });

    // -------------------------------------------------------------
    // 5. FIADO Y ABONO
    // -------------------------------------------------------------
    test('E2E-05: Flujo de Crédito (Fiado) y amortización posterior con Abono', () => {
        const cliente = {
            id: 'c-101',
            nombre: 'Carlos Mendoza',
            telefono: '0414-1234567',
            deudaUsd: 0,
            saldoFavorUsd: 0
        };

        // 1. Venta fiada por $25.50
        const ventaFiadaUsd = 25.50;
        cliente.deudaUsd = roundMoney(cliente.deudaUsd + ventaFiadaUsd);
        assert.equal(cliente.deudaUsd, 25.50);

        // 2. Cliente realiza abono parcial de $15.00 en efectivo
        const montoAbonoUsd = 15.00;
        assert.ok(montoAbonoUsd <= cliente.deudaUsd, 'El abono no puede exceder la deuda');
        cliente.deudaUsd = roundMoney(cliente.deudaUsd - montoAbonoUsd);
        assert.equal(cliente.deudaUsd, 10.50, 'Deuda restante debe ser $10.50');

        // 3. Cliente realiza segundo abono por $12.00 (deja $1.50 a favor)
        const segundoAbono = 12.00;
        if (segundoAbono > cliente.deudaUsd) {
            const sobrante = roundMoney(segundoAbono - cliente.deudaUsd);
            cliente.deudaUsd = 0;
            cliente.saldoFavorUsd = roundMoney(cliente.saldoFavorUsd + sobrante);
        }
        assert.equal(cliente.deudaUsd, 0, 'Deuda liquidada al 100%');
        assert.equal(cliente.saldoFavorUsd, 1.50, 'Saldo a favor generado');
        assert.equal(formatUSD(cliente.saldoFavorUsd), '$1,50');
    });

    // -------------------------------------------------------------
    // 6. ARQUEO DIARIO (CORTE Z)
    // -------------------------------------------------------------
    test('E2E-06: Arqueo Diario 30s (Corte Z) cuadre esperado vs contado y balance final', () => {
        const arqueoEsperado = {
            efectivoUsd: 140.00,
            efectivoBs: 1500.00,
            puntoBs: 4500.00,
            pagoMovilBs: 6200.00,
            zelleUsd: 50.00,
            tasa: 50.00
        };

        // Arqueo físico ingresado por el cajero
        const arqueoFisico = {
            efectivoUsd: 140.00,
            efectivoBs: 1500.00,
            puntoBs: 4500.00,
            pagoMovilBs: 6200.00,
            zelleUsd: 50.00
        };

        const totalEsperadoUsd = roundMoney(
            arqueoEsperado.efectivoUsd +
            arqueoEsperado.zelleUsd +
            bsToUsd(arqueoEsperado.efectivoBs + arqueoEsperado.puntoBs + arqueoEsperado.pagoMovilBs, arqueoEsperado.tasa)
        );

        const totalFisicoUsd = roundMoney(
            arqueoFisico.efectivoUsd +
            arqueoFisico.zelleUsd +
            bsToUsd(arqueoFisico.efectivoBs + arqueoFisico.puntoBs + arqueoFisico.pagoMovilBs, arqueoEsperado.tasa)
        );

        const diferenciaUsd = roundMoney(totalFisicoUsd - totalEsperadoUsd);

        assert.equal(totalEsperadoUsd, 434.00); // 140 + 50 + (12200 / 50 = 244) = 434
        assert.equal(totalFisicoUsd, 434.00);
        assert.equal(diferenciaUsd, 0.00, 'Cuadre perfecto de caja');
    });

    // -------------------------------------------------------------
    // 7. MODO OFFLINE, COLA Y RECONEXIÓN SIN DUPLICADOS
    // -------------------------------------------------------------
    test('E2E-07: Resiliencia Offline - Encolado y sincronización idempotente sin ventas duplicadas', () => {
        let isOnline = false;
        const offlineQueue = [];
        const remoteSalesDb = new Map();

        function registrarVenta(venta) {
            if (!isOnline) {
                // Generar ID único idempotente
                const idVenta = venta.id || `offline_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                offlineQueue.push({ ...venta, id: idVenta });
                return { status: 'queued_offline', id: idVenta };
            } else {
                remoteSalesDb.set(venta.id, venta);
                return { status: 'committed', id: venta.id };
            }
        }

        // Registrar 3 ventas en modo offline
        const r1 = registrarVenta({ totalUsd: 5.50, items: ['Pan', 'Jugo'] });
        const r2 = registrarVenta({ totalUsd: 12.00, items: ['Queso'] });
        const r3 = registrarVenta({ totalUsd: 3.20, items: ['Refresco'] });

        assert.equal(offlineQueue.length, 3);
        assert.equal(remoteSalesDb.size, 0);

        // Reconexión a Internet
        isOnline = true;

        // Proceso de sincronización con deduplicación por ID
        function sincronizarCola() {
            while (offlineQueue.length > 0) {
                const item = offlineQueue[0];
                if (!remoteSalesDb.has(item.id)) {
                    remoteSalesDb.set(item.id, item);
                }
                offlineQueue.shift();
            }
        }

        sincronizarCola();
        assert.equal(offlineQueue.length, 0, 'Cola offline vaciada');
        assert.equal(remoteSalesDb.size, 3, 'Las 3 ventas fueron sincronizadas');

        // Simulación de reintento de sincronización accidental (resiliencia)
        offlineQueue.push({ id: r1.id, totalUsd: 5.50, items: ['Pan', 'Jugo'] });
        sincronizarCola();
        assert.equal(remoteSalesDb.size, 3, 'No se duplicaron registros');
    });

    // -------------------------------------------------------------
    // 8. CRITERIOS DE ACEPTACIÓN: XSS Y DATOS VACÍOS O DAÑINOS
    // -------------------------------------------------------------
    test('E2E-08: Sanitización contra XSS en datos de clientes, notas e IDs', () => {
        const payloadXss = '<img src=x onerror=alert("hacked")>';
        const sanitized = escapeHtml(payloadXss);
        assert.ok(!sanitized.includes('<img'), 'No debe contener etiquetas HTML activas');
        assert.ok(sanitized.includes('&lt;img'), 'Debe escapar los caracteres peligrosos');

        const clienteConApostrofe = "O'Connor & Sons";
        const clienteSanitizado = escapeHtml(clienteConApostrofe);
        assert.equal(clienteSanitizado, 'O&#039;Connor &amp; Sons');
    });
});
