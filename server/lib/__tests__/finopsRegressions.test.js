import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';

const source = readFileSync('server/index.js', 'utf8');
function route(method, path, query) {
  let handler;
  const start = source.indexOf(`app.${method}("${path}",`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n});', start) + 4;
  vm.runInNewContext(source.slice(start, end), {
    app: { [method]: (_path, ...handlers) => { handler = handlers.at(-1); } },
    authMiddleware() {}, pool: { query }, console,
    APPLE_AUTH_TOKEN: 'secret', APPLE_PASS_TYPE_ID: 'pass.example',
  });
  return handler;
}
function response() {
  return { code: 200, body: null, set: vi.fn(), status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
}

describe('Apple Wallet update list', () => {
  const path = '/api/wallet/v1/devices/:deviceId/registrations/:passTypeId';
  const req = { headers: {}, params: { deviceId: 'device-a', passTypeId: 'pass.example' }, query: {} };
  it('accepts the tokenless Apple request and scopes serials to registered device and pass type', async () => {
    const query = vi.fn(async (sql, args) => {
      expect(sql).toContain('WHERE device_id = $1 AND pass_type_id = $2');
      expect(args).toEqual(['device-a', 'pass.example']);
      return { rows: [{ serial_number: 'serial-a', updated_at: '2026-09-19T12:00:00Z' }] };
    });
    const res = response();
    await route('get', path, query)(req, res);
    expect(res.code).toBe(200);
    expect(res.body.serialNumbers).toEqual(['serial-a']);
    expect(res.body.lastUpdated).toBe('2026-09-19T12:00:00.000Z');
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it('returns no content for an unknown device or no changes since the update tag', async () => {
    const query = vi.fn(async (sql, args) => {
      expect(sql).toContain('updated_at > $3');
      expect(args[2]).toBe('2026-09-19T12:00:00.000Z');
      return { rows: [] };
    });
    const res = response();
    await route('get', path, query)({ ...req, query: { passesUpdatedSince: '2026-09-19T12:00:00Z' } }, res);
    expect(res.code).toBe(204);
    expect(res.body).toBeUndefined();
  });
  it.each([
    ['post', `${path}/:serial`], ['delete', `${path}/:serial`],
    ['get', '/api/wallet/v1/passes/:passTypeId/:serial'],
  ])('keeps authentication on %s %s', async (method, protectedPath) => {
    const query = vi.fn();
    const res = response();
    await route(method, protectedPath, query)({ ...req, params: { ...req.params, serial: 'serial-a' } }, res);
    expect(res.code).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('notifications orders schema and statuses', () => {
  it('uses total_amount and preserves stored, approved, rejected and pending notifications', async () => {
    const query = vi.fn(async (sql, args) => {
      expect(args).toEqual(['user-a']);
      if (sql.includes('FROM notifications')) return { rows: [{ id:'notice', title:'Aviso', body:'Hola', time:'2026-09-19', is_read:false }] };
      if (sql.includes('FROM orders')) {
        expect(sql).toContain('o.total_amount AS total');
        expect(sql).not.toMatch(/o\.total[,\s]/);
        expect(sql).toContain('WHERE o.user_id = $1');
        return { rows: ['approved', 'rejected', 'pending_verification'].map(status => ({id:status,status,total:'1050.00',plan_name:'Paquete 9 Clases',branch_name:'Pozos',updated_at:'2026-09-19',created_at:'2026-09-19'})) };
      }
      return { rows: [] };
    });
    const res = response();
    await route('get', '/api/notifications', query)({userId:'user-a'}, res);
    expect(res.code).toBe(200);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.data.find(n => n.title === 'Pago aprobado').body).toContain('$1050.00');
    expect(res.body.data.map(n => n.title)).toContain('Pago en revisión');
    expect(res.body.data.map(n => n.title)).toContain('Pago rechazado');
  });
});
