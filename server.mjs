import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

const COMPRESSIBLE_EXTS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

const server = http.createServer((req, res) => {
    try {
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        let pathname = decodeURIComponent(parsedUrl.pathname);

        // Endpoint de configuración dinámica (ej. Demo Mode)
        if (pathname === '/api/config') {
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            return res.end(JSON.stringify({
                demoMode: process.env.DEMO_MODE === 'true'
            }));
        }

        // Endpoint de salud (Health Check) para evitar hibernación en Render y monitoreo
        if (pathname === '/api/health' || pathname === '/health') {
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            });
            return res.end(JSON.stringify({
                status: 'ok',
                uptime: Math.round(process.uptime()),
                timestamp: Date.now(),
                version: 'v1.0.0'
            }));
        }

        if (pathname === '/' || pathname === '') {
            pathname = '/index.html';
        }

        const safePath = path.normalize(path.join(__dirname, pathname));
        if (!safePath.startsWith(__dirname)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Acceso denegado');
        }

        fs.stat(safePath, (err, stats) => {
            if (err || !stats.isFile()) {
                const indexPath = path.join(__dirname, 'index.html');
                fs.readFile(indexPath, (indexErr, indexData) => {
                    if (indexErr) {
                        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                        return res.end('Archivo no encontrado');
                    }
                    res.writeHead(200, {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(indexData);
                });
                return;
            }

            const ext = path.extname(safePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            const headers = { 'Content-Type': contentType };

            // Control de caché inteligente
            if (pathname === '/sw.js') {
                headers['Service-Worker-Allowed'] = '/';
                headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            } else if (pathname === '/index.html' || pathname === '/catalogo.html') {
                headers['Cache-Control'] = 'no-cache, must-revalidate';
            } else if (['.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif'].includes(ext)) {
                headers['Cache-Control'] = 'public, max-age=86400'; // 1 día de caché para imágenes
            } else {
                headers['Cache-Control'] = 'public, max-age=3600';
            }

            // Compresión Gzip para archivos de texto y código si el cliente lo soporta
            const acceptEncoding = req.headers['accept-encoding'] || '';
            const shouldGzip = COMPRESSIBLE_EXTS.has(ext) && acceptEncoding.includes('gzip');

            if (shouldGzip) {
                headers['Content-Encoding'] = 'gzip';
                headers['Vary'] = 'Accept-Encoding';
                res.writeHead(200, headers);
                const rawStream = fs.createReadStream(safePath);
                const gzipStream = zlib.createGzip({ level: 6 });
                rawStream.pipe(gzipStream).pipe(res);
            } else {
                res.writeHead(200, headers);
                fs.createReadStream(safePath).pipe(res);
            }
        });
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Error interno del servidor');
    }
});

server.listen(PORT, () => {
    console.log(`GestiónPro activo en el puerto ${PORT}`);
});
