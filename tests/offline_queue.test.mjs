import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Simulación de cola offline conforme a app.js
class OfflineQueueEngine {
    constructor(initialQueue = [], lastInvoice = 1000) {
        this.queue = [...initialQueue];
        this.lastInvoice = lastInvoice;
    }

    enqueueSale(saleData) {
        this.lastInvoice += 1;
        const offlineSale = {
            ...saleData,
            id: 'off_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            nroFactura: this.lastInvoice,
            isOffline: true,
            pendingSync: true,
            createdAt: new Date().toISOString()
        };
        this.queue.push(offlineSale);
        return offlineSale;
    }

    prepareBatchForFirestore() {
        let maxFactura = this.lastInvoice;
        const uploadPayloads = this.queue.map(sale => {
            const { isOffline, pendingSync, ...cleanSale } = sale;
            if (sale.nroFactura > maxFactura) {
                maxFactura = sale.nroFactura;
            }
            return {
                ...cleanSale,
                offlineOriginId: sale.id,
                status: 'abierto',
                sincronizadoEn: new Date().toISOString()
            };
        });

        return {
            payloads: uploadPayloads,
            newLastInvoice: maxFactura,
            itemsCount: uploadPayloads.length
        };
    }

    confirmSyncSuccess() {
        const processedCount = this.queue.length;
        this.queue = [];
        return processedCount;
    }
}

describe('Motor Offline & Sincronización: TC-005, TC-006', () => {
    let engine;

    beforeEach(() => {
        engine = new OfflineQueueEngine([], 1000);
    });

    test('TC-005: Encolado de ventas genera IDs únicos y correlativo consecutivo', () => {
        const sale1 = engine.enqueueSale({
            totalUsd: 15.50,
            items: [{ id: 'p1', nombre: 'Harina PAN', qty: 2 }]
        });
        const sale2 = engine.enqueueSale({
            totalUsd: 8.20,
            items: [{ id: 'p2', nombre: 'Arroz Mary', qty: 1 }]
        });

        assert.equal(engine.queue.length, 2);
        assert.equal(sale1.nroFactura, 1001);
        assert.equal(sale2.nroFactura, 1002);
        assert.notEqual(sale1.id, sale2.id);
        assert.equal(sale1.isOffline, true);
        assert.equal(sale1.pendingSync, true);
    });

    test('TC-006: Preparación de lote Firestore elimina flags temporales locales', () => {
        engine.enqueueSale({ totalUsd: 25.00, items: [{ id: 'p3', qty: 5 }] });
        const batchData = engine.prepareBatchForFirestore();

        assert.equal(batchData.itemsCount, 1);
        const payload = batchData.payloads[0];
        assert.equal(payload.isOffline, undefined);
        assert.equal(payload.pendingSync, undefined);
        assert.ok(payload.offlineOriginId.startsWith('off_'));
        assert.ok(payload.sincronizadoEn);
        assert.equal(batchData.newLastInvoice, 1001);
    });

    test('TC-006-B: Conciliación exitosa vacía la cola local de forma segura', () => {
        engine.enqueueSale({ totalUsd: 10.00 });
        engine.enqueueSale({ totalUsd: 20.00 });
        assert.equal(engine.queue.length, 2);

        const syncCount = engine.confirmSyncSuccess();
        assert.equal(syncCount, 2);
        assert.equal(engine.queue.length, 0);
    });
});
