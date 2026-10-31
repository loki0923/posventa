# Mantenimiento y Rendimiento en Render (Plan Gratuito vs Producción)

## 1. El Comportamiento de "Hibernación" en Render Free Tier

En el plan gratuito de **Render**, los servicios web se suspenden (*spin down*) automáticamente tras **15 minutos consecutivos de inactividad** (sin tráfico HTTP entrante).

Cuando un cliente o cajero abre la aplicación tras un periodo de inactividad:
* El contenedor de Node.js debe arrancar desde cero (*cold start*).
* Este arranque toma típicamente entre **30 y 50 segundos**.
* Durante ese lapso, la interfaz PWA de GestiónPro ahora muestra un indicador amigable:
  > *"Iniciando servidor en la nube... El plan gratuito de Render puede tomar unos segundos en reactivarse tras inactividad. Tus datos locales y ventas están seguros."*

---

## 2. Endpoint de Salud (Health Check) Implementado

Para facilitar el monitoreo del servidor y permitir pings automáticos que eviten la hibernación, `server.mjs` expone el siguiente endpoint liviano:

* **Ruta**: `GET /api/health` o `GET /health`
* **Respuesta**:
```json
{
  "status": "ok",
  "uptime": 1420,
  "timestamp": 1730350800000,
  "version": "v1.0.0"
}
```
* **Características**:
  * No consulta base de datos (respuesta en < 5 ms).
  * No consume cuota de lecturas de Firestore.
  * Encabezados con `Cache-Control: no-cache, no-store`.

---

## 3. Estrategias para Mantener el Servidor Activo 24/7

### Opción A (100% Gratuita): UptimeRobot o Cron-Job.org
Puedes configurar un monitor HTTP gratuito para que envíe una solicitud cada 10 minutos al endpoint de salud:

1. Crea una cuenta gratuita en [cron-job.org](https://cron-job.org) o [UptimeRobot](https://uptimerobot.com).
2. Añade un nuevo monitor tipo **HTTP(s)**:
   * **URL**: `https://tu-app-en-render.onrender.com/api/health`
   * **Intervalo**: Cada 10 o 12 minutos (debe ser menor a 15 minutos).
   * **Método**: `GET`
3. Con esto, el servidor recibirá un ping periódico y nunca entrará en suspensión durante el horario de operación de tu negocio.

### Opción B (GitHub Actions Cron Gratuito)
Si tu repositorio está en GitHub, puedes crear un workflow `.github/workflows/keepalive.yml`:
```yaml
name: Keepalive Ping
on:
  schedule:
    - cron: '*/12 10-23 * * *' # Cada 12 minutos durante horas de trabajo
  workflow_dispatch:

jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: Ping Render Backend
        run: curl -sS https://tu-app-en-render.onrender.com/api/health
```

### Opción C (Recomendada para Producción en Cadena de Tiendas): Render Individual
* Si el negocio maneja múltiples cajeros simultáneos y alto volumen, actualizar la instancia en Render al plan **Starter** ($7 USD/mes).
* Esto garantiza:
  * CPU y memoria dedicadas sin suspensión (Zero downtime).
  * Conexiones persistentes instantáneas sin retraso de cold-start.

---

## 4. Optimizaciones de Red Implementadas en Fase 2
* **Compresión Gzip nativa**: Todos los recursos HTML, CSS, JavaScript y JSON se transmiten comprimidos con nivel 6, reduciendo el peso de transferencia en un ~75%.
* **Lazy loading de scripts**: Librerías pesadas (`Chart.js`, `SheetJS XLSX`, `Html5Qrcode`) ya no bloquean la carga inicial en el `<head>`; se cargan bajo demanda al abrir reportes, escanear o exportar.
* **Caché PWA Network-First**: El Service Worker actualiza el shell automáticamente al haber conexión y garantiza carga inmediata en menos de 2 segundos.
