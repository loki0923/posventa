import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Bloque C: Pantallas, UX, Métricas, Formato Numérico y Navegación', () => {
    const indexHtml = fs.readFileSync('index.html', 'utf8');
    const appJs = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');

    test('TC-UX-01: Métricas Financieras - Ganancia Neta es Hero destacada y 6 tarjetas neutras', () => {
        // Tarjeta Hero de Ganancia Neta
        assert.ok(indexHtml.includes('id="rep-ganancia-neta"'), 'Debe existir rep-ganancia-neta');
        assert.ok(indexHtml.includes('id="rep-ganancia-neta-bs"'), 'Debe existir rep-ganancia-neta-bs');
        assert.ok(indexHtml.includes('Métrica Principal'), 'Debe tener distintivo visual de Métrica Principal');
        
        // 6 tarjetas neutras
        const neutralCardIds = [
            'rep-total-ventas',
            'rep-ventas-contado',
            'rep-total-ganancia',
            'rep-total-descuentos',
            'rep-total-gastos',
            'rep-mermas-usd'
        ];
        neutralCardIds.forEach(id => {
            assert.ok(indexHtml.includes(`id="${id}"`), `Debe existir tarjeta neutra con id ${id}`);
        });

        // 1 solo botón principal de Arqueo Diario y el resto secundarios
        assert.ok(indexHtml.includes('Arqueo Diario (30 Segs)'), 'Debe existir botón principal de Arqueo Diario');
        assert.ok(indexHtml.includes('bg-gradient-to-r from-rose-600 via-rose-500 to-amber-600'), 'Botón Arqueo debe tener gradiente hero');
    });

    test('TC-UX-02: Gráficos vacíos tienen estado amigable con botón al POS', () => {
        assert.ok(indexHtml.includes('id="empty-state-ventas"'), 'Debe existir contenedor empty-state-ventas');
        assert.ok(indexHtml.includes('id="empty-state-top"'), 'Debe existir contenedor empty-state-top');
        assert.ok(indexHtml.includes('Aún no hay ventas registradas'), 'Debe contener mensaje explicativo de ventas vacías');
        assert.ok(indexHtml.includes('Ir al Punto de Venta'), 'Debe ofrecer botón para ir al POS en ventas');
        assert.ok(indexHtml.includes('Vender Ahora'), 'Debe ofrecer botón de venta en top productos');

        // app.js conmuta la visibilidad en updateDashboardCharts
        assert.ok(appJs.includes('const hasTopData = topLabels.length > 0'), 'app.js debe evaluar si hay datos en top productos');
        assert.ok(appJs.includes('const hasVentasData = data.some(v => v > 0)'), 'app.js debe evaluar si hay datos en ventas semanales');
    });

    test('TC-UX-03: Menú lateral estructurado en 4 secciones y Cajero restringido a POS, Fiados y Cierre', () => {
        assert.ok(indexHtml.includes('<!-- SECCIÓN: VENDER -->'), 'Debe existir sección Vender');
        assert.ok(indexHtml.includes('<!-- SECCIÓN: INVENTARIO -->'), 'Debe existir sección Inventario');
        assert.ok(indexHtml.includes('<!-- SECCIÓN: FINANZAS -->'), 'Debe existir sección Finanzas');
        assert.ok(indexHtml.includes('<!-- SECCIÓN: ADMINISTRACIÓN -->'), 'Debe existir sección Administración');

        // Secciones Inventario y Administración tienen clase admin-only
        assert.ok(indexHtml.includes('<div class="sidebar-section admin-only">'), 'Secciones administrativas deben tener clase admin-only');

        // app.js actualiza texto a "Cierre de Caja" para cajeros y redirige tab reportes a arqueo
        assert.ok(appJs.includes("repBtnSpan.textContent = isAdmin ? 'Reportes & Cierre' : 'Cierre de Caja'"), 'Texto de botón debe adaptarse a Cierre de Caja para cajero');
        assert.ok(appJs.includes("if (!isAdmin && tabId === 'reportes') {\n        abrirModalArqueo30Seg();"), 'Cajero al pulsar reportes debe abrir modal de arqueo');
    });

    test('TC-UX-04: Botón Nuevo Proveedor tiene alto contraste y botón Salir superior fue retirado', () => {
        // Botón nuevo proveedor en Compras
        assert.ok(indexHtml.includes('id="btn-nuevo-proveedor"'), 'Debe existir id btn-nuevo-proveedor');
        assert.ok(indexHtml.includes('text-slate-700 dark:text-slate-200'), 'Botón Nuevo Proveedor debe tener texto de alto contraste');

        // Botón Salir superior fue retirado del header
        const topHeaderArea = indexHtml.substring(0, indexHtml.indexOf('<main'));
        assert.ok(!topHeaderArea.includes('title="Cerrar Sesión del Turno"'), 'El botón Salir redundante no debe estar en la cabecera');
    });

    test('TC-UX-05: Título neutro "GestiónPro"', () => {
        assert.ok(indexHtml.includes('<title>GestiónPro</title>'), 'El title en index.html debe ser GestiónPro');
        assert.ok(!indexHtml.includes('<title>GestiónPro - Bodegas</title>'), 'No debe existir el title restringido a bodegas');
        assert.ok(appJs.includes("document.title = (storeConfig.name && storeConfig.name !== 'GestiónPro') ? `${storeConfig.name} — GestiónPro` : 'GestiónPro'"), 'app.js debe aplicar título neutro dinámicamente');
    });

    test('TC-UX-06: Tarjeta de producto cumple contraste WCAG AA y mínimo 12px (text-xs)', () => {
        // Categoría mínima 12px (text-xs) y contraste AA (primary-700 / primary-300)
        assert.ok(appJs.includes('text-xs text-primary-700 dark:text-primary-300'), 'Categoría debe tener text-xs y alto contraste');
        // Precio Bs mínimo 12px (text-xs) y contraste AA (slate-600 / slate-300)
        assert.ok(appJs.includes('text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums'), 'Precio en Bs debe tener text-xs y alto contraste');
        // Stock mínimo 12px (text-xs) y contraste AA (slate-700 / slate-200)
        assert.ok(appJs.includes('text-xs font-extrabold text-slate-700 dark:text-slate-200 bg-slate-100'), 'Stock debe tener text-xs y alto contraste');
    });

    test('TC-UX-07: Prevención de -$0,00 y consistencia de formateadores de moneda', () => {
        assert.ok(appJs.includes("tGastos > 0 ? `-${formatUSD(tGastos)}` : formatUSD(0)"), 'Gastos debe ser $0,00 si es 0, sin signo negativo');
        assert.ok(appJs.includes("tMermas > 0 ? `-${formatUSD(tMermas)}` : formatUSD(0)"), 'Mermas debe ser $0,00 si es 0, sin signo negativo');
        assert.ok(appJs.includes("tDescuentos > 0 ? `-${formatUSD(tDescuentos)}` : formatUSD(0)"), 'Descuentos debe ser $0,00 si es 0, sin signo negativo');
        assert.ok(appJs.includes("const vueltoBsFormatted = formatBs(usdToBs(diff));"), 'Vuelto debe formatearse con formatBs(usdToBs(diff))');
    });
});
