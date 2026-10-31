import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Modo Comida Rápida: Alternancia de tipo de negocio', () => {
    let storeConfig = { businessType: 'bodega' };
    const toggleBusinessMode = (cfg) => {
        cfg.businessType = cfg.businessType === 'bodega' ? 'comida_rapida' : 'bodega';
        return cfg.businessType;
    };

    assert.equal(toggleBusinessMode(storeConfig), 'comida_rapida');
    assert.equal(storeConfig.businessType, 'comida_rapida');
    assert.equal(toggleBusinessMode(storeConfig), 'bodega');
    assert.equal(storeConfig.businessType, 'bodega');
});

test('Modo Comida Rápida: Generación secuencial de Orden diaria', () => {
    let dailyNum = 1;
    const getNextOrder = () => {
        const str = `ORDEN #${String(dailyNum).padStart(2, '0')}`;
        dailyNum++;
        return str;
    };

    assert.equal(getNextOrder(), 'ORDEN #01');
    assert.equal(getNextOrder(), 'ORDEN #02');
    assert.equal(getNextOrder(), 'ORDEN #03');
    assert.equal(dailyNum, 4);
});

test('Modificadores de Comida: Cálculo preciso de extras y precio final', () => {
    const roundMoney = (num) => Math.round((Number(num || 0) + Number.EPSILON) * 100) / 100;

    const basePrice = 2.50; // Perro Caliente Especial
    const extras = [
        { name: 'Tocineta Crujiente', price: 1.00 },
        { name: 'Huevo Frito', price: 0.50 }
    ];

    const extraCost = roundMoney(extras.reduce((acc, e) => acc + e.price, 0));
    assert.equal(extraCost, 1.50);

    const unitPrice = roundMoney(basePrice + extraCost);
    assert.equal(unitPrice, 4.00);

    const qty = 3;
    const subtotalUsd = roundMoney(unitPrice * qty);
    assert.equal(subtotalUsd, 12.00);

    const bcvRate = 36.50;
    const subtotalBs = roundMoney(subtotalUsd * bcvRate);
    assert.equal(subtotalBs, 438.00);
});

test('KDS Cocina: Ciclo de vida de comandas (Cola -> Plancha -> Listo -> Despachado)', () => {
    let activeComandas = [];

    const crearComanda = (orderNumber, orderType, items) => {
        const cmd = {
            id: 'cmd_' + Date.now() + '_' + Math.floor(Math.random() * 100),
            orderNumber,
            orderType,
            items,
            estado: 'cola'
        };
        activeComandas.push(cmd);
        return cmd;
    };

    const cambiarEstado = (id, nuevoEstado) => {
        if (nuevoEstado === 'entregado') {
            activeComandas = activeComandas.filter(c => c.id !== id);
        } else {
            const found = activeComandas.find(c => c.id === id);
            if (found) found.estado = nuevoEstado;
        }
    };

    // 1. Crear comanda
    const cmd1 = crearComanda('ORDEN #01', 'llevar', [
        {
            nombre: 'Hamburguesa Mixta',
            qty: 1,
            modificadores: {
                salsas: ['Maíz', 'Ajo', 'Tártara'],
                sin: ['Cebolla'],
                extras: [{ name: 'Huevo Frito', price: 0.50 }],
                extraCost: 0.50
            }
        }
    ]);

    assert.equal(activeComandas.length, 1);
    assert.equal(cmd1.estado, 'cola');

    // 2. Mover a plancha
    cambiarEstado(cmd1.id, 'plancha');
    assert.equal(activeComandas[0].estado, 'plancha');

    // 3. Mover a listo
    cambiarEstado(cmd1.id, 'listo');
    assert.equal(activeComandas[0].estado, 'listo');

    // 4. Despachar / Entregar
    cambiarEstado(cmd1.id, 'entregado');
    assert.equal(activeComandas.length, 0);
});

test('Menú Demo Comida Rápida: Estructura de productos y categorías callejeras', () => {
    const demoItems = [
        { id: 'cr_01', nombre: 'Perro Caliente Tradicional', categoria: 'Perros', precio: 1.50 },
        { id: 'cr_03', nombre: 'Hamburguesa Clásica de Carne', categoria: 'Hamburguesas', precio: 3.50 },
        { id: 'cr_05', nombre: 'Pepito Mixto Especial', categoria: 'Pepitos', precio: 7.00 },
        { id: 'cr_06', nombre: 'Arepa Reina Pepiada', categoria: 'Arepas', precio: 3.00 },
        { id: 'cr_10', nombre: 'Malta Polar 330ml', categoria: 'Bebidas', precio: 1.00 }
    ];

    const categorias = [...new Set(demoItems.map(p => p.categoria))];
    assert.ok(categorias.includes('Perros'));
    assert.ok(categorias.includes('Hamburguesas'));
    assert.ok(categorias.includes('Pepitos'));
    assert.ok(categorias.includes('Arepas'));
    assert.ok(categorias.includes('Bebidas'));
    assert.equal(demoItems.length, 5);
});

test('Filtrado Inteligente de Opciones: Mermas se oculta en Comida Rápida y se muestra en Bodega', () => {
    const resolverVisibilidadModulos = (businessType) => {
        return {
            mostrarMermas: businessType === 'bodega',
            mostrarCocina: businessType === 'comida_rapida',
            mostrarBarraTurnos: businessType === 'comida_rapida'
        };
    };

    const configComida = resolverVisibilidadModulos('comida_rapida');
    assert.equal(configComida.mostrarMermas, false, 'En comida rápida las mermas deben estar ocultas');
    assert.equal(configComida.mostrarCocina, true);
    assert.equal(configComida.mostrarBarraTurnos, true);

    const configBodega = resolverVisibilidadModulos('bodega');
    assert.equal(configBodega.mostrarMermas, true, 'En bodega las mermas deben estar visibles');
    assert.equal(configBodega.mostrarCocina, false);
    assert.equal(configBodega.mostrarBarraTurnos, false);
});

test('Agilidad en Calle: Modificadores 1-Touch para Hora Pico', () => {
    let item = {
        nombre: 'Perro Caliente',
        precio: 1.50,
        qty: 1,
        modificadores: null
    };

    const aplicar1Touch = (itemRef, accion) => {
        if (!itemRef.modificadores) {
            itemRef.modificadores = {
                salsas: ['Kétchup', 'Mayonesa', 'Mostaza', 'Salsa de Maíz', 'Salsa de Ajo', 'Tártara', 'Rosada'],
                sin: [],
                extras: [],
                nota: '',
                extraCost: 0
            };
        }
        if (accion === 'con_todo') {
            itemRef.modificadores.salsas = ['Kétchup', 'Mayonesa', 'Mostaza', 'Salsa de Maíz', 'Salsa de Ajo', 'Tártara', 'Rosada'];
            itemRef.modificadores.sin = [];
        } else if (accion === 'sin_cebolla') {
            itemRef.modificadores.sin.push('Cebolla');
        } else if (accion === 'salsas_aparte') {
            itemRef.modificadores.nota = 'Salsas en envase aparte';
        }
    };

    // 1-clic Con Todo
    aplicar1Touch(item, 'con_todo');
    assert.equal(item.modificadores.salsas.length, 7);
    assert.equal(item.modificadores.sin.length, 0);

    // 1-clic Sin Cebolla
    aplicar1Touch(item, 'sin_cebolla');
    assert.ok(item.modificadores.sin.includes('Cebolla'));

    // 1-clic Salsas Aparte
    aplicar1Touch(item, 'salsas_aparte');
    assert.equal(item.modificadores.nota, 'Salsas en envase aparte');
});

test('Ruido Callejero: Captura de Apodo/Mesa y Detección de Demora en Plancha', () => {
    // Apodo/Mesa
    const inputCustomerNote = 'El Catire - Mesa 4';
    const saleClienteNombre = '';
    const clienteFinal = inputCustomerNote.trim() || saleClienteNombre || 'Cliente Mostrador';
    assert.equal(clienteFinal, 'El Catire - Mesa 4');

    // Detección de Retraso (> 7 min)
    const verificarRetraso = (createdAt, estado) => {
        const mins = Math.floor((Date.now() - createdAt) / 60000);
        return mins >= 8 && estado !== 'listo';
    };

    const hace10Minutos = Date.now() - (10 * 60 * 1000);
    const hace2Minutos = Date.now() - (2 * 60 * 1000);

    assert.equal(verificarRetraso(hace10Minutos, 'plancha'), true, 'Debe alertar retraso');
    assert.equal(verificarRetraso(hace2Minutos, 'plancha'), false, 'Dentro de tiempo normal');
    assert.equal(verificarRetraso(hace10Minutos, 'listo'), false, 'Si ya está listo no marca retraso en plancha');
});

test('Resiliencia de Inventario: batch.set con merge previene error "No document to update"', () => {
    // Simulación de Firestore DB
    const firestoreDocs = new Map();

    const mockBatchSet = (docId, data, options) => {
        const existing = firestoreDocs.get(docId) || {};
        if (options?.merge) {
            firestoreDocs.set(docId, { ...existing, ...data });
        } else {
            firestoreDocs.set(docId, data);
        }
    };

    // Caso: El producto cr_01 fue creado en cliente pero no existía aún en el documento Firestore
    const prodId = 'cr_01';
    const prodLocal = { nombre: 'Perro Caliente Tradicional', precio: 1.50, stock: 100 };
    const qtyVendida = 2;

    assert.equal(firestoreDocs.has(prodId), false, 'No existía en Firestore previamente');

    // Al usar batch.set(..., { merge: true }) con los datos locales:
    mockBatchSet(prodId, {
        ...prodLocal,
        stock: prodLocal.stock - qtyVendida
    }, { merge: true });

    assert.equal(firestoreDocs.has(prodId), true, 'Ahora existe sin lanzar excepción');
    assert.equal(firestoreDocs.get(prodId).stock, 98, 'El stock se actualiza correctamente');
    assert.equal(firestoreDocs.get(prodId).nombre, 'Perro Caliente Tradicional');
});

test('Mesa con 2 Personas: Personalización Independiente de Platos (1 Con Todo y 1 Sin Vegetales)', () => {
    // Simular carrito de comida rápida
    const cart = [];
    const burgerProd = { id: 'cr_burg_01', nombre: 'Hamburguesa Clásica de Carne', precio: 3.50, stock: 50 };

    // En comida rápida, cuando se agregan 2 unidades, se generan 2 platos independientes
    const addToCartComidaRapida = (prod, q = 1) => {
        for (let n = 0; n < q; n++) {
            cart.push({
                ...prod,
                cartItemId: 'item_' + Date.now() + '_' + n,
                precioBase: prod.precio,
                qty: 1,
                modificadores: null
            });
        }
    };

    addToCartComidaRapida(burgerProd, 2);

    assert.equal(cart.length, 2, 'Deben crearse 2 entradas individuales en el carrito');
    assert.notEqual(cart[0].cartItemId, cart[1].cartItemId, 'Cada plato tiene ID de ticket único');

    // Persona 1: Quiere la hamburguesa "Con Todo"
    const aplicar1Touch = (item, accion) => {
        if (!item.modificadores) {
            item.modificadores = { salsas: [], sin: [], extras: [], extraCost: 0, nota: '' };
        }
        if (accion === 'con_todo') {
            item.modificadores.salsas = ['Kétchup', 'Mayonesa', 'Mostaza', 'Salsa de Maíz', 'Salsa de Ajo', 'Tártara', 'Rosada'];
            item.modificadores.sin = [];
        } else if (accion === 'sin_vegetales') {
            const veggies = ['Cebolla', 'Repollo / Ensalada', 'Tomate'];
            veggies.forEach(v => {
                if (!item.modificadores.sin.includes(v)) item.modificadores.sin.push(v);
            });
            item.modificadores.salsas = ['Kétchup', 'Mayonesa', 'Mostaza', 'Salsa de Maíz', 'Salsa de Ajo', 'Tártara', 'Rosada'];
        }
    };

    aplicar1Touch(cart[0], 'con_todo');
    // Persona 2: Quiere la hamburguesa "Sin Vegetales"
    aplicar1Touch(cart[1], 'sin_vegetales');

    // Validar independencia
    assert.equal(cart[0].modificadores.sin.length, 0, 'Hamburguesa 1 no tiene ingredientes removidos');
    assert.equal(cart[0].modificadores.salsas.length, 7, 'Hamburguesa 1 tiene todas las salsas');

    assert.ok(cart[1].modificadores.sin.includes('Cebolla'), 'Hamburguesa 2 no tiene cebolla');
    assert.ok(cart[1].modificadores.sin.includes('Repollo / Ensalada'), 'Hamburguesa 2 no tiene repollo');
    assert.ok(cart[1].modificadores.sin.includes('Tomate'), 'Hamburguesa 2 no tiene tomate');
    assert.equal(cart[1].modificadores.sin.length, 3, 'Hamburguesa 2 tiene los 3 vegetales excluidos');
});

test('Separar Plato en Ítems Individuales: split de cantidad agrupada', () => {
    const itemAgrupado = {
        id: 'cr_burg_01',
        nombre: 'Hamburguesa Clásica',
        qty: 3,
        modificadores: { salsas: ['Kétchup'], sin: [], extras: [], extraCost: 0, nota: '' }
    };

    const cart = [itemAgrupado];

    // Función equivalente a separarPlatoEnItems
    const totalQty = Math.floor(cart[0].qty);
    const baseMods = JSON.parse(JSON.stringify(cart[0].modificadores));
    cart[0].qty = 1;
    for (let i = 1; i < totalQty; i++) {
        cart.push({
            ...cart[0],
            cartItemId: 'item_' + i,
            qty: 1,
            modificadores: JSON.parse(JSON.stringify(baseMods))
        });
    }

    assert.equal(cart.length, 3, 'Debe haber 3 platos de cantidad 1');
    assert.equal(cart.every(x => x.qty === 1), true, 'Todos deben ser de qty 1');
});

test('Carga Selectiva de Categorías de Menú Demo Callejero', () => {
    const demoCategorias = {
        hamburguesas: {
            nombre: 'Hamburguesas',
            items: [
                { id: 'cr_burg_01', nombre: 'Hamburguesa Clásica', categoria: 'Hamburguesas', codigo: 'BURGER-01' },
                { id: 'cr_burg_02', nombre: 'Hamburguesa Mixta', categoria: 'Hamburguesas', codigo: 'BURGER-02' }
            ]
        },
        perros: {
            nombre: 'Perros Calientes',
            items: [
                { id: 'cr_perr_01', nombre: 'Perro Caliente Tradicional', categoria: 'Perros', codigo: 'PERRO-01' }
            ]
        },
        arepas: {
            nombre: 'Arepas',
            items: [
                { id: 'cr_arep_01', nombre: 'Arepa Reina Pepiada', categoria: 'Arepas', codigo: 'AREPA-01' }
            ]
        },
        pizzas: {
            nombre: 'Pizzas',
            items: [
                { id: 'cr_piz_01', nombre: 'Pizza Margarita', categoria: 'Pizzas', codigo: 'PIZ-01' }
            ]
        }
    };

    // Vendedor que solo vende Perros y Hamburguesas
    const categoriasSeleccionadas = ['hamburguesas', 'perros'];
    const productosCargados = [];

    categoriasSeleccionadas.forEach(catKey => {
        if (demoCategorias[catKey]) {
            productosCargados.push(...demoCategorias[catKey].items);
        }
    });

    assert.equal(productosCargados.length, 3, 'Solo deben cargarse 2 hamburguesas y 1 perro');
    assert.equal(productosCargados.some(p => p.categoria === 'Arepas'), false, 'NO deben incluirse Arepas');
    assert.equal(productosCargados.some(p => p.categoria === 'Pizzas'), false, 'NO deben incluirse Pizzas');
    assert.equal(productosCargados.every(p => ['Hamburguesas', 'Perros'].includes(p.categoria)), true);
});

test('Modo de Negocio Fijo: Bodega permanece en bodega y no se puede alternar', () => {
    let storeConfig = { businessType: 'bodega' };
    const currentNegocioId = 'negocio_bodega_123';

    const intentarCambiarModo = (cfg, negocioId) => {
        if (negocioId) {
            // Negocio registrado: inmutable
            return cfg.businessType;
        }
        cfg.businessType = cfg.businessType === 'bodega' ? 'comida_rapida' : 'bodega';
        return cfg.businessType;
    };

    assert.equal(intentarCambiarModo(storeConfig, currentNegocioId), 'bodega');
    assert.equal(storeConfig.businessType, 'bodega', 'Una vez bodega, se queda en bodega');
});

test('Modo de Negocio Fijo: Comida Rápida permanece en comida rápida y no se puede alternar', () => {
    let storeConfig = { businessType: 'comida_rapida' };
    const currentNegocioId = 'negocio_fastfood_456';

    const intentarCambiarModo = (cfg, negocioId) => {
        if (negocioId) {
            // Negocio registrado: inmutable
            return cfg.businessType;
        }
        cfg.businessType = cfg.businessType === 'bodega' ? 'comida_rapida' : 'bodega';
        return cfg.businessType;
    };

    assert.equal(intentarCambiarModo(storeConfig, currentNegocioId), 'comida_rapida');
    assert.equal(storeConfig.businessType, 'comida_rapida', 'Una vez comida rápida, se queda en comida rápida');
});



test('Resolución de Modo Bodega: Fallback a bodega para negocios preexistentes sin businessType explícito', () => {
    const resolverTipoNegocio = (nData, settingsData, currentCfg) => {
        return (nData && (nData.businessType || nData.tipoNegocio)) ||
               (settingsData && (settingsData.businessType || settingsData.tipoNegocio)) ||
               currentCfg?.businessType ||
               'bodega';
    };

    // Caso 1: Negocio tradicional sin businessType en documento ni en settings
    assert.equal(resolverTipoNegocio({}, {}, { businessType: 'bodega' }), 'bodega');

    // Caso 2: Documento en Firestore no tiene campos definidos
    assert.equal(resolverTipoNegocio(null, null, null), 'bodega');

    // Caso 3: Negocio con comida rápida explícito
    assert.equal(resolverTipoNegocio({ businessType: 'comida_rapida' }, {}, null), 'comida_rapida');
});

test('Seguridad de Modo Bodega: No se crean comandas ni se muestran elementos de cocina en bodega', () => {
    let activeComandas = [];
    const storeConfig = { businessType: 'bodega' };

    const crearComandaCocina = (saleData) => {
        if (storeConfig.businessType !== 'comida_rapida') return null;
        if (!saleData || !saleData.items || saleData.items.length === 0) return null;
        const cmd = { id: 'cmd_1', items: saleData.items };
        activeComandas.push(cmd);
        return cmd;
    };

    const res = crearComandaCocina({ items: [{ nombre: 'Harina PAN', qty: 2 }] });
    assert.equal(res, null);
    assert.equal(activeComandas.length, 0, 'No debe crearse comanda en modo bodega');

    // Comprobación de visibilidad estricta: cocina y barra de turnos deben estar ocultas
    const UIState = {
        cocinaHidden: storeConfig.businessType !== 'comida_rapida',
        orderBarHidden: storeConfig.businessType !== 'comida_rapida',
        badgeCocinaHidden: storeConfig.businessType !== 'comida_rapida' || activeComandas.length === 0
    };

    assert.equal(UIState.cocinaHidden, true, 'El botón de cocina debe estar oculto en bodega');
    assert.equal(UIState.orderBarHidden, true, 'La barra de orden debe estar oculta en bodega');
    assert.equal(UIState.badgeCocinaHidden, true, 'El badge de cocina debe estar oculto en bodega');
});
