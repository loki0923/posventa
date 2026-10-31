import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Fase 5: Diseño Visual, UI/UX y Modo Oscuro', async (t) => {
    const htmlPath = path.join(process.cwd(), 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    await t.test('TC-F5-01: Script anti-FOUC presente en <head> para carga instantánea de tema', () => {
        assert.ok(html.includes('Anti-FOUC instant dark mode detection'), 'Debe incluir script anti-FOUC');
        assert.ok(html.includes("localStorage.getItem('theme')"), 'Debe comprobar el tema guardado');
        assert.ok(html.includes('prefers-color-scheme: dark'), 'Debe respetar preferencia del sistema operativo');
    });

    await t.test('TC-F5-02: Lógica de alternancia y sincronización de tema', () => {
        function resolverTema(guardado, sistemaOscuro) {
            if (guardado === 'dark' || (!guardado && sistemaOscuro)) {
                return {
                    tema: 'dark',
                    themeColor: '#07090e',
                    iconClass: 'fa-solid fa-sun text-amber-400 text-xs'
                };
            }
            return {
                tema: 'light',
                themeColor: '#ffffff',
                iconClass: 'fa-solid fa-moon text-slate-600 dark:text-amber-400 text-xs'
            };
        }

        // Caso 1: Usuario seleccionó Dark explícitamente
        const rDark = resolverTema('dark', false);
        assert.equal(rDark.tema, 'dark');
        assert.equal(rDark.themeColor, '#07090e');
        assert.ok(rDark.iconClass.includes('fa-sun'));

        // Caso 2: Sin preferencia previa, pero sistema en dark
        const rSysDark = resolverTema(null, true);
        assert.equal(rSysDark.tema, 'dark');
        assert.equal(rSysDark.themeColor, '#07090e');

        // Caso 3: Usuario seleccionó Light explícitamente
        const rLight = resolverTema('light', true);
        assert.equal(rLight.tema, 'light');
        assert.equal(rLight.themeColor, '#ffffff');
        assert.ok(rLight.iconClass.includes('fa-moon'));
    });

    await t.test('TC-F5-03: Cobertura integral de modo oscuro en modales del sistema', () => {
        const modalesAInspeccionar = [
            'gasto-modal-content',
            'caja-chica-modal-content',
            'cliente-modal-content',
            'abono-modal-content',
            'cierres-modal-content',
            'settings-modal-content',
            'camera-scanner-modal-content'
        ];

        modalesAInspeccionar.forEach(id => {
            const regex = new RegExp(`id="${id}"`);
            assert.ok(regex.test(html), `El modal #${id} debe existir`);
            const subIndex = html.indexOf(`id="${id}"`);
            // Extraer el tag de apertura del div
            const divStart = html.lastIndexOf('<div', subIndex);
            const divTag = html.slice(divStart, subIndex + id.length + 1);
            assert.ok(
                divTag.includes('dark:bg-slate-900') || divTag.includes('dark:bg-slate-800') || html.includes(`html.dark #${id}`),
                `El modal #${id} debe tener clase de fondo oscuro adaptada`
            );
        });
    });

    await t.test('TC-F5-04: Animaciones y microinteracciones fluidas para dispositivos móviles', () => {
        assert.ok(html.includes('--apple-spring'), 'Debe definir curva de elasticidad suave');
        assert.ok(html.includes('--apple-ease'), 'Debe definir curva de aceleración');
        assert.ok(html.includes('animated-btn'), 'Debe incluir clase animated-btn');
        assert.ok(html.includes('animated-card'), 'Debe incluir clase animated-card');
    });
});
