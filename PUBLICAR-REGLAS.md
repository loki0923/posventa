# Publicar las reglas de Firestore — Guía paso a paso

> Objetivo: cerrar el agujero por el que **cualquier persona que se registre**
> puede leer y borrar las ventas, clientes y deudas de **todas** las bodegas.
>
> Archivos implicados:
> - `firestore.rules` ← lo que vas a publicar
> - `firestore.rules.original.backup` ← **tu marcha atrás**

---

## Lo que hay que entender antes de tocar nada

1. **Publicar reglas inválidas no rompe nada.** La consola las valida antes de
   aplicarlas. Si hay un error de sintaxis te lo muestra y **conserva las reglas
   anteriores**. Puedes pegarlas sin miedo a equivocarte de coma.

2. **Publicar reglas válidas sí cambia el comportamiento al instante** (tarda
   ~1 minuto en propagarse). A partir de ese momento, quien no tenga perfil
   válido **no entra**.

3. **La marcha atrás es instantánea:** vuelves a pegar el contenido de
   `firestore.rules.original.backup` y publicas. Nada de esto es irreversible.

---

## Paso 1 — Inventario de usuarios ⚠️ EL ÚNICO PASO QUE PUEDE DEJARTE FUERA

Las reglas nuevas resuelven el inquilino leyendo `usuarios/{uid}.negocioId`.
**Si un usuario no tiene ese documento, o le falta `negocioId` o `role`, queda
fuera del sistema.**

### 1.1 Lista las cuentas de acceso

Firebase Console → **Authentication** → pestaña **Users**

Apunta cada **UID** y su correo. (Si solo tienes tu cuenta, ya está: salta al paso 2.)

### 1.2 Compara con los perfiles

Firebase Console → **Firestore Database** → colección **`usuarios`**

Para **cada UID** de la lista anterior debe existir un documento `usuarios/{UID}`
que contenga **al menos**:

| Campo | Valor esperado | Ejemplo |
|---|---|---|
| `negocioId` | El ID del negocio al que pertenece | `"mini-market-yj"` |
| `role` | Exactamente `admin` o `cajero` | `"cajero"` |
| `email` | Su correo | `"yule@viveres.com"` |

> **Ojo con `role`:** la regla solo acepta la cadena `admin` o `cajero` en
> minúsculas. Si un perfil tiene `"Admin"`, `"Administrador"` o `"Cajera"`, esa
> persona **no** tendrá permisos de dueño (entrará, pero como cajero).

### 1.3 Rellena lo que falte

Para cada UID sin perfil, crea el documento a mano:

1. En la colección `usuarios` → **Add document**
2. **Document ID**: pega el **UID** (no el correo)
3. Añade los campos `email` (string), `negocioId` (string), `role` (string)

> `negocioId` debe ser **exactamente** el ID del negocio al que debe acceder.
> Para saber cuál es el correcto, mira el perfil de un usuario que ya funciona,
> o la ruta de sus documentos: `negocios/{negocioId}/products/...`

---

## Paso 2 — Publicar

1. Abre `firestore.rules` en el editor y **copia todo el contenido**.
2. Firebase Console → **Firestore Database** → pestaña **Reglas** (Rules).
3. Selecciona todo lo que haya y **pega** encima.
4. Pulsa **Publicar** (Publish).
5. Espera ~1 minuto.

Si la consola muestra un error, no se aplicó nada: mándamelo y lo corrijo.

---

## Paso 3 — Verificación (hazla, no la asumas)

Abre la aplicación y **recarga con Ctrl + Shift + R**.

### 3.1 Comprobación visual

- La barra lateral debe decir **`Versión v5 · 12/10/2026 · ...`**
- La pantalla de login (si cierras sesión) también.

### 3.2 Como DUEÑO (`role: "admin"`)

| Prueba | Resultado esperado |
|---|---|
| Entrar | Entra sin mensajes de error |
| Abrir la **Torre de Control** | Se abre |
| Abrir **Inventario** | Se carga la lista |
| Hacer **una venta** de prueba | Se guarda |
| Abrir **Reportes & Cierre** | Muestra datos |

### 3.3 Como CAJERO (`role: "cajero"`) — si tienes uno

| Prueba | Resultado esperado |
|---|---|
| Entrar | Entra, y ve solo las pestañas de ventas |
| Hacer **una venta** | Se guarda (los cajeros venden) |
| Intentar abrir **Inventario** | "Acceso Restringido" |
| Editar **Ajustes** (nombre, RIF, logo) | "No se pudo guardar" ← **correcto**, ahora es solo del dueño |

### 3.4 Pruebas de seguridad reales (las importantes)

Abre **F12 → Console** en la aplicación ya cargada y pega estos fragmentos uno a
uno. `db` y `currentNegocioId` son globales del script, así que están
disponibles directamente.

**a) ¿Puedo leer las ventas de OTRA bodega?** → debe FALLAR

```js
db.collection('negocios').doc('un-id-de-otra-bodega').collection('sales').get()
  .then(s => console.log('❌ FUGA: se leyeron', s.size, 'ventas ajenas'))
  .catch(e => console.log('✅ OK, denegado:', e.code));
```

**b) ¿Puedo ascenderme a admin yo mismo?** → debe FALLAR

```js
db.collection('usuarios').doc(firebase.auth().currentUser.uid).update({ role: 'admin' })
  .then(() => console.log('❌ FALLO: te ascendiste a admin'))
  .catch(e => console.log('✅ OK, denegado:', e.code));
```

**c) ¿Puedo listar todos los negocios de la plataforma?** → debe FALLAR

```js
db.collection('negocios').get()
  .then(s => console.log('❌ FUGA: se listaron', s.size, 'negocios'))
  .catch(e => console.log('✅ OK, denegado:', e.code));
```

**d) ¿Puedo leer un usuario que no es el mío?** → debe FALLAR

```js
db.collection('usuarios').doc('cualquier-uid-que-no-sea-el-tuyo').get()
  .then(d => console.log('❌ FUGA:', d.exists))
  .catch(e => console.log('✅ OK, denegado:', e.code));
```

**e) El catálogo público debe SEGUIR funcionando** → debe FUNCIONAR

Abre en una pestaña nueva, **sin sesión (incógnito)**:

```
http://127.0.0.1:5500/catalogo.html?negocio=TU_NEGOCIO_ID
```

Debe cargar el nombre de la tienda y los productos. Si sale vacío, avísame:
sería un problema de la FASE 1 y hay que ajustarlo.

---

## Si algo sale mal

**Marcha atrás, en 30 segundos:**

1. Abre `firestore.rules.original.backup`
2. Copia todo
3. Consola → Firestore → Reglas → pega → **Publicar**

Vuelves exactamente al estado anterior (con el agujero abierto, pero funcionando).

---

## Lo que ESTAS reglas todavía NO cierran (sé honesto contigo mismo)

No te vendas una seguridad que no tienes:

1. **`costo` y `stock` siguen siendo legibles por cualquiera** desde la API, sin
   cuenta. Firestore **no permite ocultar campos en lectura**, así que no se
   arregla con reglas: hace falta una colección de proyección pública (FASE 2).
   Cualquiera que adivine el ID de tu negocio puede ver tus precios de compra.
2. **Un admin puede listar los perfiles de otros negocios** (email, rol,
   negocioId). Las reglas no permiten inspeccionar el `where` de la consulta.
   Se corrige moviendo el personal a `negocios/{negocioId}/usuarios/` (FASE 2).
3. **Un cajero puede escribir una venta con cualquier importe.** Las reglas
   validan *forma* (números, rangos, listas no vacías), no *lógica de negocio*.
   La verificación real necesita transacciones en servidor (FASE 2).
4. **Los pedidos online siguen deshabilitados** (`create: false`) a propósito.
   Abrirlos sin escapar HTML en el render sería un XSS almacenado en tu sesión.
5. **`cajas_sucursales` sigue denegada**, igual que antes: ese estado vive solo
   en el localStorage del equipo.

Todo esto está anotado como FASE 2 al final de `firestore.rules`.
