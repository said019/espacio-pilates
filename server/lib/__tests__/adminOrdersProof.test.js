import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

// Los comprobantes subidos se guardan como data URL base64 (cientos de KB cada
// uno). /api/admin/orders los devolvía en línea para hasta 100 órdenes, así que
// cada carga del dashboard o de Pagos mandaba ~5 MB al navegador.
const source = readFileSync('server/index.js', 'utf8');
function route(method, path, query) {
  let handler;
  const start = source.indexOf(`app.${method}("${path}",`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n});', start) + 4;
  vm.runInNewContext(source.slice(start, end), {
    app: { [method]: (_path, ...handlers) => { handler = handlers.at(-1); } },
    adminMiddleware() {}, pool: { query }, console,
    resolveRequestBranch: async () => ({ id: 'branch-a' }),
  });
  return handler;
}
function response() {
  return { code: 200, body: null, set: vi.fn(), status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
}

describe('admin orders payment proofs', () => {
  it('lists orders without inlining base64 proofs and flags which ones have one', async () => {
    const query = vi.fn(async (sql) => {
      if (!sql.includes('FROM orders o')) return { rows: [] };
      expect(sql).not.toContain('pp.file_url AS proof_url');
      expect(sql).toContain("CASE WHEN pp.file_url LIKE 'data:%' THEN NULL ELSE pp.file_url END AS proof_url");
      return { rows: [
        { id: 'inline', proof_url: null, has_proof: true },
        { id: 'drive', proof_url: 'https://drive.example/proof.jpg', has_proof: true },
        { id: 'cash', proof_url: null, has_proof: false },
      ] };
    });
    const res = response();
    await route('get', '/api/admin/orders', query)({ query: { status: 'pending_verification' } }, res);
    expect(res.code).toBe(200);
    expect(res.body.data.map(o => [o.id, o.proofUrl, o.hasProof])).toEqual([
      ['inline', null, true],
      ['drive', 'https://drive.example/proof.jpg', true],
      ['cash', null, false],
    ]);
  });

  it('serves a single proof on demand', async () => {
    const query = vi.fn(async (sql, args) => {
      expect(sql).toContain('FROM payment_proofs WHERE order_id = $1');
      expect(args).toEqual(['order-a']);
      return { rows: [{ file_url: 'data:image/jpeg;base64,AAAA', mime_type: 'image/jpeg' }] };
    });
    const res = response();
    await route('get', '/api/admin/orders/:id/proof', query)({ params: { id: 'order-a' } }, res);
    expect(res.code).toBe(200);
    expect(res.body.data).toEqual({ url: 'data:image/jpeg;base64,AAAA', mimeType: 'image/jpeg' });
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('returns 404 when the order has no proof', async () => {
    const res = response();
    await route('get', '/api/admin/orders/:id/proof', vi.fn(async () => ({ rows: [] })))({ params: { id: 'order-b' } }, res);
    expect(res.code).toBe(404);
  });
});
