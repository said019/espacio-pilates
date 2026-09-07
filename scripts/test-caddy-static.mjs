// Offline contract test: same built app behind the current Node server and Caddy.
// Never logs in, subscribes to push, calls an API, or changes production data.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { precompress, verifyArchive } from './prepare-static-runtime.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runtimeCommand = 'sh start.sh';
const railway = JSON.parse(await readFile('railway.json', 'utf8'));
assert.equal(railway.deploy.startCommand, runtimeCommand, 'Railway JSON overrides the Nixpacks start command');
assert.ok((await readFile('nixpacks.toml', 'utf8')).includes('cmd = "' + runtimeCommand + '"'));
assert.equal(JSON.parse(await readFile('package.json', 'utf8')).scripts.start,
    'node server/index.js', 'Retain backend npm start');
assert.throws(() => verifyArchive(Buffer.from('corrupt'), 'not-a-valid-hash'), /checksum mismatch/);
const files = [];
async function collect(dir, prefix = '') {
    for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink()) throw new Error('Unsafe symlink in static output');
        if (e.isDirectory()) await collect(dir + '/' + e.name, prefix + e.name + '/');
        else if (!/\.(br|gz)$/.test(e.name)) files.push(prefix + e.name);
    }
}
await collect('dist');
const originalHashes = await Promise.all(files.map(async p => hash(await readFile('dist/' + p))));
const compression = await precompress('dist');
assert.deepEqual(await Promise.all(files.map(async p => hash(await readFile('dist/' + p)))), originalHashes);
assert.equal(await readFile('public/sw.js', 'utf8'), await readFile('dist/sw.js', 'utf8'), 'Worker must remain exactly unchanged');
const sharedStart = await readFile('start.sh', 'utf8');
assert.match(sharedStart, /else\s+echo "▶ Backend API"\s+exec node server\/index\.js\s+fi/);
assert.ok(sharedStart.includes('exec ./.runtime/caddy run --config Caddyfile --adapter caddyfile'));
const app = await readFile('src/App.tsx', 'utf8');
const routes = [...new Set([...app.matchAll(/path="([^"]+)"/g)].map(m => m[1])
    .filter(p => p.startsWith('/')).map(p => p.replace(/:[^/]+/g, 'local-contract-test').replace('*', 'unknown')))];

async function freePort() {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}
function raw(port, path, headers = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port, path: encodeURI(path), method, headers: { 'Accept-Encoding': 'identity', ...headers } }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('error', reject);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
        req.on('error', reject);
        req.end();
    });
}
function rss(pid) {
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim());
}
const children = [];
async function start(binary, args) {
    const port = await freePort();
    const child = spawn(binary, args(port), { env: { ...process.env, SERVE_MODE: 'frontend', PORT: String(port), NO_UPDATE_CHECK: '1' }, stdio: 'ignore' });
    children.push(child);
    for (let attempt = 0; attempt < 100; attempt++) {
        assert.equal(child.exitCode, null, 'Server exited during startup');
        try { if ((await raw(port, '/')).status === 200) return { port, pid: child.pid }; } catch {}
        await delay(100);
    }
    throw new Error('Local server never became ready');
}
function contentType(type) {
    const base = (type || '').split(';')[0];
    return ['application/javascript', 'text/javascript'].includes(base) ? 'javascript' : base;
}
try {
    const node = await start(process.execPath, port => ['node_modules/serve/build/main.js', 'dist', '-s', '-p', String(port)]);
    const caddy = await start('/bin/sh', () => ['start.sh']);
    const paths = [...new Set([...routes, ...files.map(p => '/' + p), '/index.html?foo=bar', '/index', '/login/', '/sw.js/', '/missing-file.js', '/.env', '/server/package.json', '/../package.json'])];
    for (const path of paths) {
        const [a, b] = await Promise.all([raw(node.port, path), raw(caddy.port, path)]);
        if (path === '/sw.js/') {
            // Invalid file URL: Caddy canonicalizes it. The actual registration
            // URL is /sw.js, tested byte-for-byte and for JavaScript MIME below.
            assert.equal(a.status, 200);
            assert.equal(b.status, 308);
            assert.equal(b.headers.location, '/sw.js');
            continue;
        }
        if (path === '/../package.json') {
            assert.equal(a.status, 400);
            assert.equal(b.status, 200);
            assert.equal(hash(b.body), hash(await readFile('dist/index.html')), 'Traversal must only return public SPA, never repository files');
            continue;
        }
        assert.equal(b.status, a.status, path + ': status');
        assert.equal(b.headers.location, a.headers.location, path + ': redirect destination');
        if (a.status >= 300 && a.status < 400) continue;
        assert.equal(hash(b.body), hash(a.body), path + ': unchanged content');
        assert.equal(contentType(b.headers['content-type']), contentType(a.headers['content-type']), path + ': MIME');
        assert.equal(b.headers['cache-control'], a.headers['cache-control'], path + ': cache policy');
    }
    const js = (await readFile('dist/index.html', 'utf8')).match(/<script\b[^>]*src="\/([^"]+\.js)"/)?.[1];
    assert.ok(js, 'Vite JavaScript asset required');
    const wire = [];
    for (const path of ['/', '/sw.js', '/' + js]) {
        const original = (await raw(node.port, path)).body;
        for (const [encoding, decompress] of [['br', brotliDecompressSync], ['gzip', gunzipSync]]) {
            const a = await raw(node.port, path, { 'Accept-Encoding': encoding });
            const b = await raw(caddy.port, path, { 'Accept-Encoding': encoding });
            assert.equal(b.headers['content-encoding'], encoding, path + ': compression');
            assert.equal(hash(decompress(b.body)), hash(original), path + ': decoded bytes');
            assert.ok(b.body.length <= a.body.length * 1.02 + 32, path + ': wire size must not regress');
            assert.match(b.headers.vary || '', /Accept-Encoding/i);
            wire.push({ path, encoding, nodeBytes: a.body.length, caddyBytes: b.body.length });
        }
    }
    for (const path of ['/sw.js', '/icon-192.png', '/tep-logo.png', '/' + js]) {
        const a = await raw(node.port, path, { Range: 'bytes=0-99' });
        const b = await raw(caddy.port, path, { Range: 'bytes=0-99' });
        assert.equal(b.status, 206);
        assert.equal(hash(b.body), hash(a.body));
        const full = await raw(caddy.port, path);
        assert.equal((await raw(caddy.port, path, { 'If-None-Match': full.headers.etag })).status, 304);
        const head = await raw(caddy.port, path, {}, 'HEAD');
        assert.equal(head.status, 200);
        assert.equal(head.body.length, 0);
    }
    // Modest local-only repeated serving, never a production load test.
    for (let i = 0; i < 100; i++) {
        for (const server of [node, caddy]) await raw(server.port, '/' + js, { 'Accept-Encoding': 'br' });
    }
    const sw = await raw(caddy.port, '/sw.js');
    assert.equal(contentType(sw.headers['content-type']), 'javascript');
    console.log(JSON.stringify({ result: 'PASS', routes: routes.length, files: files.length,
        equivalentGetPaths: paths.length - 2, originalFilesUnchanged: true, workerExactlyUnchanged: true, backendBranchUnchanged: true,
        documentedDifferences: ['Invalid /sw.js/ redirects 308 to /sw.js; valid worker URL unchanged.', 'Traversal /../package.json returns only public SPA instead of 400, never repository contents.', 'Directory browsing is not enabled.'],
        rangesAndHeadAndConditionalPaths: 4, compression, wire,
        localRssKiB: { node: rss(node.pid), caddy: rss(caddy.pid) },
        caveat: 'Local macOS comparison only, not measured Railway billing savings; no production writes.' }, null, 2));
} finally {
    for (const child of children) {
        if (child.exitCode !== null) continue;
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        if (!await Promise.race([exited.then(() => true), delay(2000).then(() => false)])) child.kill('SIGKILL');
    }
}
