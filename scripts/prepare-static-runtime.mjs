// Build-time only: pin and verify the official Caddy release, then precompress
// the existing Vite output. No dependency, application or API changes.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile, chmod, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const version = '2.11.4';
// SHA-512 from caddyserver/caddy v2.11.4's official checksums.txt.
export const artifacts = {
    'linux-x64': ['linux_amd64', '8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9'],
    'linux-arm64': ['linux_arm64', 'd5a7c423853c24a799765e0e8210d5c7c22a8f56ed37a3cae2fb9f58be138853c02b4efd6b59d576e6d8c7c0d30b9c1592deeaa6a536ff69bcca23b8c1ea709c'],
    'darwin-arm64': ['mac_arm64', '3190ae0df98b59ab4b6021556fa35adc3c526a4f3e138776b0eaec8a037cc26121cbbb1ad53453f565551b47d37d5ba4755e2c2c3652256737fe2ce9e53c8ec0'],
};

export function verifyArchive(bytes, expected) {
    if (createHash('sha512').update(bytes).digest('hex') !== expected) {
        throw new Error('Caddy archive checksum mismatch; refusing to install');
    }
}

export async function precompress(directory) {
    const result = { files: 0, originalBytes: 0, brotliBytes: 0, gzipBytes: 0 };
    async function visit(dir) {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isSymbolicLink()) throw new Error('Static output must not contain symlinks');
            if (entry.isDirectory()) { await visit(path); continue; }
            if (!entry.isFile() || !['.html', '.js', '.css', '.json', '.svg', '.txt'].includes(extname(path))) continue;
            const bytes = await readFile(path);
            if (bytes.length < 1024) continue;
            // Match serve/compression's Brotli quality 4, without runtime work.
            const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
            const gz = gzipSync(bytes);
            if (br.length < bytes.length) await writeFile(path + '.br', br);
            if (gz.length < bytes.length) await writeFile(path + '.gz', gz);
            result.files++;
            result.originalBytes += bytes.length;
            result.brotliBytes += Math.min(br.length, bytes.length);
            result.gzipBytes += Math.min(gz.length, bytes.length);
        }
    }
    await visit(directory);
    return result;
}

async function main() {
    const artifact = artifacts[`${process.platform}-${process.arch}`];
    if (!artifact) throw new Error('Unsupported platform for pinned Caddy runtime');
    const [platform, checksum] = artifact;
    const url = `https://github.com/caddyserver/caddy/releases/download/v${version}/caddy_${version}_${platform}.tar.gz`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Caddy download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    verifyArchive(bytes, checksum);
    const temp = await mkdtemp(join(tmpdir(), 'espacio-caddy-verified-'));
    try {
        const archive = join(temp, 'release.tar.gz');
        await writeFile(archive, bytes);
        execFileSync('tar', ['-xzf', archive, '-C', temp, 'caddy', 'LICENSE']);
        await mkdir('.runtime', { recursive: true });
        await copyFile(join(temp, 'caddy'), '.runtime/caddy');
        await copyFile(join(temp, 'LICENSE'), '.runtime/CADDY-LICENSE');
        await chmod('.runtime/caddy', 0o755);
    } finally {
        // Only this freshly created build-temp directory; never app data.
        await rm(temp, { recursive: true, force: true });
    }
    console.log(JSON.stringify({ caddy: version, compression: await precompress('dist') }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
