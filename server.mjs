import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

const server = http.createServer((req, res) => {
    try {
        const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        let pathname = decodeURIComponent(parsedUrl.pathname);

        if (pathname === '/' || pathname === '') {
            pathname = '/index.html';
        }

        const safePath = path.normalize(path.join(__dirname, pathname));
        if (!safePath.startsWith(__dirname)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Acceso denegado');
        }

        fs.stat(safePath, (err, stats) => {
            if (err || !stats.isFile()) {
                const indexPath = path.join(__dirname, 'index.html');
                fs.readFile(indexPath, (indexErr, indexData) => {
                    if (indexErr) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        return res.end('Archivo no encontrado');
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(indexData);
                });
                return;
            }

            const ext = path.extname(safePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            const headers = { 'Content-Type': contentType };
            if (pathname === '/sw.js') {
                headers['Service-Worker-Allowed'] = '/';
                headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
            }

            res.writeHead(200, headers);
            fs.createReadStream(safePath).pipe(res);
        });
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error interno del servidor');
    }
});

server.listen(PORT, () => {
    console.log(`GestiónPro activo en el puerto ${PORT}`);
});
