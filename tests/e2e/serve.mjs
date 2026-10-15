// Minimal static file server for Playwright runs (no build step, no extra deps).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.env.PORT) || 4173;

const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.chopro': 'text/plain; charset=utf-8',
    '.chorpro': 'text/plain; charset=utf-8'
};

createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    let filePath = normalize(join(root, decodeURIComponent(pathname)));
    if (!filePath.startsWith(root) || filePath.includes('node_modules')) {
        res.writeHead(403).end();
        return;
    }
    if (pathname.endsWith('/')) filePath = join(filePath, 'index.html');
    try {
        const body = await readFile(filePath);
        res.writeHead(200, {
            'Content-Type': types[extname(filePath)] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        res.end(body);
    } catch (_) {
        res.writeHead(404).end('Not found');
    }
}).listen(port, () => {
    console.log(`StageChord test server on http://localhost:${port}`);
});
