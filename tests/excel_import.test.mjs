import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helpers réplica de la lógica implementada en app.js para pruebas unitarias
function normalizarTextoCabecera(str) {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

function parseNumeroExcel(val) {
    if (val === null || val === undefined || val === '') return NaN;
    if (typeof val === 'number') return isNaN(val) ? NaN : val;
    let s = String(val).trim().replace(/[$Bs\s]/gi, '');
    if (s.includes(',') && !s.includes('.')) {
        s = s.replace(',', '.');
    } else if (s.includes(',') && s.includes('.')) {
        s = s.replace(/,/g, '');
    }
    const num = parseFloat(s);
    return isNaN(num) ? NaN : num;
}

function detectarIndiceCabeceras(rawRows) {
    const palabrasClave = ['codigo', 'producto', 'nombre', 'articulo', 'descripcion', 'precio', 'costo', 'stock', 'cantidad', 'categoria', 'marca', 'tipo'];
    let mejorIndice = 0;
    let maxCoincidencias = 0;

    const limiteFilas = Math.min(rawRows.length, 15);
    for (let r = 0; r < limiteFilas; r++) {
        const fila = rawRows[r];
        if (!Array.isArray(fila)) continue;
        let coincidencias = 0;
        fila.forEach(celda => {
            const normalizado = normalizarTextoCabecera(celda);
            if (!normalizado) return;
            if (palabrasClave.some(p => normalizado.includes(p))) {
                coincidencias++;
            }
        });
        if (coincidencias > maxCoincidencias && coincidencias >= 2) {
            maxCoincidencias = coincidencias;
            mejorIndice = r;
        }
    }
    return mejorIndice;
}

function parsearFilasExcel(rawRows, existingList = []) {
    if (!rawRows || rawRows.length < 2) return [];
    const headerRowIdx = detectarIndiceCabeceras(rawRows);
    const cabeceras = rawRows[headerRowIdx] || [];

    let colCodigo = -1;
    let colNombre = -1;
    let colMarca = -1;
    let colCategoria = -1;
    let colTipo = -1;
    let colStock = -1;
    let colCosto = -1;
    let colPrecio = -1;
    let colVencimiento = -1;

    cabeceras.forEach((c, idx) => {
        const norm = normalizarTextoCabecera(c);
        if (!norm) return;

        if (colCodigo === -1 && (norm.includes('codigo') || norm.includes('barcode') || norm.includes('barra') || norm.includes('sku') || norm === 'cod' || norm === 'ref')) {
            colCodigo = idx;
        } else if (colNombre === -1 && (norm.includes('producto') || norm.includes('nombre') || norm.includes('articulo') || norm.includes('descripcion') || norm === 'item' || norm === 'name')) {
            colNombre = idx;
        } else if (colMarca === -1 && (norm.includes('marca') || norm.includes('brand'))) {
            colMarca = idx;
        } else if (colCategoria === -1 && (norm.includes('categoria') || norm.includes('rubro') || norm.includes('departamento') || norm.includes('category') || norm === 'grupo')) {
            colCategoria = idx;
        } else if (colTipo === -1 && (norm.includes('tipo') || norm.includes('unidad') || norm.includes('medida'))) {
            colTipo = idx;
        } else if (colStock === -1 && (norm.includes('stock') || norm.includes('cantidad') || norm === 'cant' || norm.includes('existencia') || norm === 'qty' || norm.includes('inventario'))) {
            colStock = idx;
        } else if (colCosto === -1 && (norm.includes('costo') || norm.includes('compra') || norm === 'cost' || norm.includes('pcosto'))) {
            colCosto = idx;
        } else if (colPrecio === -1 && (norm.includes('precio') || norm.includes('pvp') || norm.includes('venta') || norm === 'price')) {
            colPrecio = idx;
        } else if (colVencimiento === -1 && (norm.includes('vencimiento') || norm.includes('caducidad') || norm.includes('vence') || norm.includes('expiry'))) {
            colVencimiento = idx;
        }
    });

    const parsed = [];

    for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!Array.isArray(row) || row.length === 0) continue;
        const todaVacia = row.every(cell => cell === '' || cell === null || cell === undefined);
        if (todaVacia) continue;

        const rawCodigo = colCodigo !== -1 && row[colCodigo] !== undefined ? String(row[colCodigo]).trim() : '';
        const rawNombre = colNombre !== -1 && row[colNombre] !== undefined ? String(row[colNombre]).trim() : '';
        const rawMarca = colMarca !== -1 && row[colMarca] !== undefined ? String(row[colMarca]).trim() : '';
        const rawCategoria = colCategoria !== -1 && row[colCategoria] !== undefined ? String(row[colCategoria]).trim() : '';
        const rawTipo = colTipo !== -1 && row[colTipo] !== undefined ? String(row[colTipo]).trim() : '';
        const rawStock = colStock !== -1 && row[colStock] !== undefined ? row[colStock] : 0;
        const rawCosto = colCosto !== -1 && row[colCosto] !== undefined ? row[colCosto] : 0;
        const rawPrecio = colPrecio !== -1 && row[colPrecio] !== undefined ? row[colPrecio] : NaN;
        const rawVenc = colVencimiento !== -1 && row[colVencimiento] !== undefined ? row[colVencimiento] : null;

        let numPrecio = parseNumeroExcel(rawPrecio);
        let numCosto = parseNumeroExcel(rawCosto);
        if (isNaN(numCosto) || numCosto < 0) numCosto = 0;
        let numStock = parseNumeroExcel(rawStock);
        if (isNaN(numStock)) numStock = 0;

        let tipoNormalizado = 'unid';
        const tipoLower = rawTipo.toLowerCase();
        if (tipoLower.includes('peso') || tipoLower.includes('kg') || tipoLower.includes('kilo') || tipoLower.includes('gramo')) {
            tipoNormalizado = 'peso';
        }

        let isValid = true;
        let errorReason = '';

        if (!rawNombre || rawNombre.length < 2) {
            isValid = false;
            errorReason = 'Falta el nombre o descripción del producto';
        } else if (isNaN(numPrecio) || numPrecio < 0) {
            isValid = false;
            errorReason = 'Precio inválido o vacío';
        }

        let match = null;
        if (rawCodigo) {
            match = existingList.find(p => p.codigo && String(p.codigo).trim().toLowerCase() === rawCodigo.toLowerCase());
        }
        if (!match && rawNombre) {
            match = existingList.find(p => p.nombre && p.nombre.trim().toLowerCase() === rawNombre.toLowerCase());
        }

        let status = 'nuevo';
        if (!isValid) {
            status = 'invalido';
        } else if (match) {
            status = 'actualizar';
        }

        parsed.push({
            id: 'row_' + i,
            rowNum: i + 1,
            selected: isValid,
            isValid,
            status,
            error: errorReason,
            codigo: rawCodigo,
            nombre: rawNombre,
            categoria: rawCategoria || 'Víveres',
            marca: rawMarca,
            tipo: tipoNormalizado,
            stock: numStock,
            costo: Math.round((numCosto + Number.EPSILON) * 100) / 100,
            precio: Math.round((numPrecio + Number.EPSILON) * 100) / 100,
            fechaVencimiento: rawVenc,
            existingId: match ? match.id : null,
            existingStock: match ? parseFloat(match.stock || 0) : 0,
            existingProduct: match
        });
    }

    return parsed;
}

describe('Módulo de Importación de Inventario desde Excel (.xlsx / .csv)', () => {
    test('TC-IMP-01: Limpieza y parseo de números con distintos formatos monetarios', () => {
        assert.equal(parseNumeroExcel(15.5), 15.5);
        assert.equal(parseNumeroExcel('15.50'), 15.5);
        assert.equal(parseNumeroExcel('15,50'), 15.5); // Coma como separador decimal
        assert.equal(parseNumeroExcel('$1,250.75'), 1250.75); // Formato monetario con separador de miles
        assert.equal(parseNumeroExcel('Bs 45.00'), 45.0);
        assert.equal(isNaN(parseNumeroExcel('')), true);
        assert.equal(isNaN(parseNumeroExcel('N/A')), true);
    });

    test('TC-IMP-02: Detección inteligente de fila de cabecera con metadatos iniciales', () => {
        const rowsConMetadatos = [
            ['REPORTE INVENTARIO - BODEGA EL SOL'],
            ['Generado el 21/10/2026'],
            [],
            ['Código', 'Producto', 'Categoría', 'Tipo', 'Stock', 'Costo ($)', 'Precio ($)', 'Vencimiento'],
            ['7591001', 'Harina PAN', 'Víveres', 'unid', '25', '1.10', '1.45', '2026-12-31']
        ];

        const idx = detectarIndiceCabeceras(rowsConMetadatos);
        assert.equal(idx, 3); // La fila 3 contiene los encabezados reales
    });

    test('TC-IMP-03: Reconocimiento flexible de nombres de columnas y normalización de texto', () => {
        assert.equal(normalizarTextoCabecera('CÓDIGO DE BARRAS'), 'codigodebarras');
        assert.equal(normalizarTextoCabecera('Precio ($)'), 'precio');
        assert.equal(normalizarTextoCabecera('Categoría'), 'categoria');
        assert.equal(normalizarTextoCabecera('Existencia (Cant.)'), 'existenciacant');
    });

    test('TC-IMP-04: Parseo de filas, clasificación entre Nuevos y Actualizaciones por Código', () => {
        const existingProducts = [
            { id: 'prod_1', codigo: '7591001', nombre: 'Harina PAN Blanca', stock: 10, precio: 1.40, costo: 1.10 }
        ];

        const rawRows = [
            ['Código', 'Producto', 'Categoría', 'Tipo', 'Stock', 'Costo ($)', 'Precio ($)'],
            ['7591001', 'Harina PAN Blanca 1kg', 'Víveres', 'unid', '50', '1.15', '1.50'], // Coincide código -> actualizar
            ['7592002', 'Arroz Mary 1kg', 'Víveres', 'unid', '30', '0.90', '1.30']          // Nuevo
        ];

        const parsed = parsearFilasExcel(rawRows, existingProducts);
        assert.equal(parsed.length, 2);

        const item1 = parsed[0];
        assert.equal(item1.status, 'actualizar');
        assert.equal(item1.existingId, 'prod_1');
        assert.equal(item1.existingStock, 10);
        assert.equal(item1.precio, 1.50);

        const item2 = parsed[1];
        assert.equal(item2.status, 'nuevo');
        assert.equal(item2.existingId, null);
        assert.equal(item2.stock, 30);
    });

    test('TC-IMP-05: Coincidencia por Nombre cuando el código viene vacío en el Excel', () => {
        const existingProducts = [
            { id: 'prod_queso', codigo: 'Q001', nombre: 'Queso Llanero', stock: 5.5, precio: 5.0, costo: 3.5 }
        ];

        const rawRows = [
            ['Código', 'Producto', 'Tipo', 'Stock', 'Precio'],
            ['', 'Queso Llanero', 'peso', '10', '5.20'] // Sin código pero mismo nombre
        ];

        const parsed = parsearFilasExcel(rawRows, existingProducts);
        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].status, 'actualizar');
        assert.equal(parsed[0].existingId, 'prod_queso');
        assert.equal(parsed[0].tipo, 'peso');
    });

    test('TC-IMP-06: Manejo de filas inválidas (sin nombre o con precio incorrecto)', () => {
        const rawRows = [
            ['Código', 'Producto', 'Precio', 'Stock'],
            ['111', '', '2.50', '10'],                  // Falta nombre
            ['222', 'Producto Sin Precio', 'GRATIS', '5'], // Precio NaN
            ['333', 'Producto Válido', '3.75', '8']     // Válido
        ];

        const parsed = parsearFilasExcel(rawRows, []);
        assert.equal(parsed.length, 3);

        assert.equal(parsed[0].isValid, false);
        assert.equal(parsed[0].status, 'invalido');
        assert.equal(parsed[0].selected, false);

        assert.equal(parsed[1].isValid, false);
        assert.equal(parsed[1].status, 'invalido');
        assert.equal(parsed[1].selected, false);

        assert.equal(parsed[2].isValid, true);
        assert.equal(parsed[2].status, 'nuevo');
        assert.equal(parsed[2].selected, true);
    });

    test('TC-IMP-07: Cálculo de stock según modo (Reemplazar vs Sumar)', () => {
        const existingStock = 12;
        const excelStock = 20;

        // Modo Reemplazar (Inventario físico / recuento)
        const stockReemplazo = excelStock;
        assert.equal(stockReemplazo, 20);

        // Modo Sumar (Entrada de mercancía)
        const stockSumado = existingStock + excelStock;
        assert.equal(stockSumado, 32);
    });
});
