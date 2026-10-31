import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

function roundMoney(num) {
    return Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;
}

class ClienteAccount {
    constructor({ id, nombre, deudaUsd = 0, saldoFavorUsd = 0, puntos = 0 }) {
        this.id = id;
        this.nombre = nombre;
        this.deudaUsd = roundMoney(deudaUsd);
        this.saldoFavorUsd = roundMoney(saldoFavorUsd);
        this.puntos = puntos;
    }

    agregarFiado(montoUsd) {
        if (montoUsd <= 0) throw new Error('El monto de fiado debe ser positivo');
        this.deudaUsd = roundMoney(this.deudaUsd + montoUsd);
        return this.deudaUsd;
    }

    registrarAbono(montoAbonoUsd) {
        if (montoAbonoUsd <= 0) throw new Error('El abono debe ser mayor a cero');

        if (montoAbonoUsd > this.deudaUsd) {
            // El sobrante pasa a saldo a favor
            const excedente = roundMoney(montoAbonoUsd - this.deudaUsd);
            this.deudaUsd = 0;
            this.saldoFavorUsd = roundMoney(this.saldoFavorUsd + excedente);
        } else {
            this.deudaUsd = roundMoney(this.deudaUsd - montoAbonoUsd);
        }

        return {
            deudaRestante: this.deudaUsd,
            saldoFavorAcumulado: this.saldoFavorUsd
        };
    }

    aplicarSaldoAFavorEnVenta(totalVentaUsd) {
        if (this.saldoFavorUsd <= 0) return { descuentoAplicado: 0, totalPagar: totalVentaUsd };

        if (this.saldoFavorUsd >= totalVentaUsd) {
            this.saldoFavorUsd = roundMoney(this.saldoFavorUsd - totalVentaUsd);
            return { descuentoAplicado: totalVentaUsd, totalPagar: 0 };
        } else {
            const aplicado = this.saldoFavorUsd;
            this.saldoFavorUsd = 0;
            return { descuentoAplicado: aplicado, totalPagar: roundMoney(totalVentaUsd - aplicado) };
        }
    }

    sumarPuntosPorCompra(totalUsd, factorPuntos = 1) {
        const ganados = Math.floor(totalUsd * factorPuntos);
        this.puntos += ganados;
        return ganados;
    }
}

describe('Módulo de Clientes, Fiados y Abonos: TC-004, TC-008', () => {
    test('TC-008: Acumulación de deuda y abonos parciales en Cuaderno de Fiados', () => {
        const cliente = new ClienteAccount({ id: 'c1', nombre: 'Carlos Gomez', deudaUsd: 10.00 });
        cliente.agregarFiado(15.00); // 10 + 15 = 25
        assert.equal(cliente.deudaUsd, 25.00);

        const abonoResult = cliente.registrarAbono(8.00); // 25 - 8 = 17
        assert.equal(abonoResult.deudaRestante, 17.00);
        assert.equal(abonoResult.saldoFavorAcumulado, 0);
    });

    test('TC-008-B: Abono mayor a la deuda genera Saldo a Favor automáticamente', () => {
        const cliente = new ClienteAccount({ id: 'c2', nombre: 'Maria Perez', deudaUsd: 12.00 });
        const res = cliente.registrarAbono(20.00); // Pagó con billete de 20
        assert.equal(res.deudaRestante, 0.00);
        assert.equal(res.saldoFavorAcumulado, 8.00);
        assert.equal(cliente.saldoFavorUsd, 8.00);
    });

    test('TC-004: Aplicación de Saldo a Favor como descuento directo en carrito', () => {
        const cliente = new ClienteAccount({ id: 'c3', nombre: 'Juan Soto', saldoFavorUsd: 5.00 });
        const venta = cliente.aplicarSaldoAFavorEnVenta(12.50);

        assert.equal(venta.descuentoAplicado, 5.00);
        assert.equal(venta.totalPagar, 7.50);
        assert.equal(cliente.saldoFavorUsd, 0.00);
    });

    test('TC-004-B: Compra cubierta al 100% con saldo a favor remanente', () => {
        const cliente = new ClienteAccount({ id: 'c4', nombre: 'Ana Rivas', saldoFavorUsd: 25.00 });
        const venta = cliente.aplicarSaldoAFavorEnVenta(10.00);

        assert.equal(venta.descuentoAplicado, 10.00);
        assert.equal(venta.totalPagar, 0.00);
        assert.equal(cliente.saldoFavorUsd, 15.00);
    });

    test('TC-Fidelidad: Puntos de fidelidad ganados por volumen de compra', () => {
        const cliente = new ClienteAccount({ id: 'c5', nombre: 'Pedro Diaz', puntos: 50 });
        const puntosNuevos = cliente.sumarPuntosPorCompra(45.80, 1); // 1 punto por cada $1
        assert.equal(puntosNuevos, 45);
        assert.equal(cliente.puntos, 95);
    });
});
