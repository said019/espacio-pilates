import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import { instructorPhotoSql, publicApiUrl, decodeInlinePhoto, inlineInstructorPhotoPath, UUID_RE } from '../instructorPhoto.js';

// Las fotos de coach subidas sin Drive quedaron como data URL base64. /api/classes
// las repetía en cada clase de la semana: ~5.3 MB por carga del calendario.
const source = readFileSync('server/index.js', 'utf8');
function route(method, path, query) {
  let handler;
  const start = source.indexOf(`app.${method}("${path}",`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n});', start) + 4;
  vm.runInNewContext(source.slice(start, end), {
    app: { [method]: (_path, ...handlers) => { handler = handlers.at(-1); } },
    authMiddleware() {}, adminMiddleware() {}, pool: { query }, console, Buffer,
    resolveRequestBranch: async () => ({ id: 'branch-a' }),
    camelRows: rows => rows.map(r => ({ id: r.id, photoUrl: r.photo_url })),
    instructorPhotoSql, publicApiUrl, decodeInlinePhoto, inlineInstructorPhotoPath, UUID_RE,
  });
  return handler;
}
function response() {
  return { code: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; },
    type(t) { this.headers['Content-Type'] = t; return this; }, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, end() { return this; } };
}
const req = (extra = {}) => ({ query: {}, params: {}, get: (h) => (h === 'host' ? 'api.test' : undefined), ...extra });

describe('instructor photos', () => {
  it('lists classes with a cacheable photo URL instead of the inline base64', async () => {
    const query = vi.fn(async (sql) => {
      expect(sql).not.toContain('i.photo_url    AS instructor_photo');
      expect(sql).toContain(`${instructorPhotoSql('i')} AS instructor_photo`);
      return { rows: [
        { id: 'c1', date: '2026-10-27', instructor_photo: '/api/public/instructors/i1/photo?v=1' },
        { id: 'c2', date: '2026-10-27', instructor_photo: 'https://lh3.googleusercontent.com/d/x=w1600' },
      ] };
    });
    const res = response();
    await route('get', '/api/classes', query)(req({ query: { start: '2026-10-26', end: '2026-11-01' } }), res);
    expect(res.body.data.map(c => c.instructor_photo)).toEqual([
      '//api.test/api/public/instructors/i1/photo?v=1',
      'https://lh3.googleusercontent.com/d/x=w1600',
    ]);
  });

  it.each(['/api/classes/:id', '/api/bookings/my-bookings'])('%s uses the same photo URL', async (path) => {
    const query = vi.fn(async (sql) => {
      if (sql.includes('instructor_photo')) {
        expect(sql).toContain(`${instructorPhotoSql('i')} AS instructor_photo`);
        return { rows: [{ id: 'x', instructor_photo: '/api/public/instructors/i1/photo?v=1' }] };
      }
      return { rows: [] };
    });
    const res = response();
    await route('get', path, query)(req({ params: { id: 'c1' }, userId: 'u1' }), res);
    expect(res.body.data.at?.(0)?.instructor_photo ?? res.body.data.instructor_photo)
      .toBe('//api.test/api/public/instructors/i1/photo?v=1');
  });

  it.each(['/api/public/instructors', '/api/instructors'])('%s replaces inline photos with the URL', async (path) => {
    const query = vi.fn(async () => ({ rows: [
      { id: 'i1', photo_url: 'data:image/jpeg;base64,AAAA', updated_at: new Date(5000) },
      { id: 'i2', photo_url: 'https://drive.example/p.jpg', updated_at: null },
    ] }));
    const res = response();
    await route('get', path, query)(req(), res);
    expect(res.body.data.map(i => i.photoUrl)).toEqual([
      '//api.test/api/public/instructors/i1/photo?v=5000', 'https://drive.example/p.jpg',
    ]);
  });

  it('serves the inline photo as a long-cached image', async () => {
    const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
    const query = vi.fn(async (sql, args) => {
      expect(args).toEqual([id]);
      return { rows: [{ photo_url: `data:image/png;base64,${Buffer.from('png').toString('base64')}` }] };
    });
    const res = response();
    await route('get', '/api/public/instructors/:id/photo', query)(req({ params: { id } }), res);
    expect(res.code).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(Buffer.from(res.body).toString()).toBe('png');
  });

  it('never serves non-image data URLs and skips the query for invalid ids', async () => {
    expect(decodeInlinePhoto('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(decodeInlinePhoto('data:text/html;base64,PGI+')).toBeNull();
    const query = vi.fn();
    const res = response();
    await route('get', '/api/public/instructors/:id/photo', query)(req({ params: { id: '../x' } }), res);
    expect(res.code).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps non-API values untouched', () => {
    expect(publicApiUrl(req(), null)).toBeNull();
    expect(publicApiUrl(req(), 'https://x/y.jpg')).toBe('https://x/y.jpg');
    expect(inlineInstructorPhotoPath('i9', 'https://x/y.jpg', null)).toBe('https://x/y.jpg');
  });
});
