import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import { isWalkInClass, walkInRequiresInscription, shouldConsumeCredit } from '../classWalkIn.js';

// Execute the production handlers without booting the server or contacting
// production. Only database/auth/notification boundaries are substituted.
const source = readFileSync('server/index.js', 'utf8');
async function book(path, { walkIn = true, requiresInscription = false, paid = false, full = false } = {}) {
  let handler;
  const bookings = [];
  let occupied = full ? 6 : 0;
  const query = vi.fn(async (sql, args) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM classes c')) return { rows: [{
      id: 'class', branch_id: 'pozos', class_category: 'pilates', status: 'scheduled',
      date: '2099-09-07', start_time: '17:30', max_capacity: 6, current_bookings: occupied,
      is_walk_in: walkIn, walk_in_requires_inscription: requiresInscription,
    }] };
    if (sql.startsWith('SELECT id FROM bookings')) return { rows: [] };
    if (sql.includes('INSERT INTO bookings')) {
      const booking = { id: 'booking', class_id: args[0], user_id: args[1], membership_id: args[2], status: args[3] };
      bookings.push(booking);
      return { rows: [booking] };
    }
    if (sql.startsWith('UPDATE classes SET current_bookings')) { occupied++; return { rows: [] }; }
    if (sql.includes('COUNT(*)::int AS pos')) return { rows: [{ pos: 1 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const client = { query, release: vi.fn() };
  const selectMembershipForClass = vi.fn().mockResolvedValue(null);
  const clientHasPaidWalkInInscription = vi.fn().mockResolvedValue(paid);
  const consumeMembershipCredit = vi.fn();
  const start = source.indexOf(`app.post("${path}",`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('\n});', start) + '\n});'.length;
  vm.runInNewContext(source.slice(start, end), {
    app: { post: (_path, ...handlers) => { handler = handlers.at(-1); } },
    consentGuard: () => () => {},
    authMiddleware() {}, adminMiddleware() {}, console,
    pool: { connect: async () => client, query: async () => ({ rows: [] }) },
    isWalkInClass, walkInRequiresInscription, shouldConsumeCredit,
    normalizeClassCategory: value => value, programForClassCategory: value => value,
    selectMembershipForClass, clientHasPaidWalkInInscription, consumeMembershipCredit,
    getCancellationConfig: async () => ({}), triggerWalletPassSync() {},
  });
  const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { classId: 'class', userId: 'user-without-membership' }, userId: 'user-without-membership' }, res);
  expect(client.release).toHaveBeenCalledOnce();
  return { res, bookings, occupied, query, selectMembershipForClass, clientHasPaidWalkInInscription, consumeMembershipCredit };
}

describe.each(['/api/bookings', '/api/admin/bookings/assign'])('%s walk-in access', path => {
  it.each([false, true])('free walk-in books without membership or enrollment (full=%s)', async full => {
    const result = await book(path, { full });
    expect(result.res.code).toBe(201);
    expect(result.bookings).toEqual([expect.objectContaining({ membership_id: null, status: full ? 'waitlist' : 'confirmed' })]);
    expect(result.occupied).toBe(full ? 6 : 1);
    expect(result.selectMembershipForClass).not.toHaveBeenCalled();
    expect(result.clientHasPaidWalkInInscription).not.toHaveBeenCalled();
    expect(result.consumeMembershipCredit).not.toHaveBeenCalled();
    expect(result.query).toHaveBeenCalledWith('COMMIT');
  });
  it('still rejects a regular class without membership', async () => {
    const result = await book(path, { walkIn: false });
    expect(result.res.code).toBe(403);
    expect(result.selectMembershipForClass).toHaveBeenCalledOnce();
    expect(result.bookings).toHaveLength(0);
    expect(result.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('still requires enrollment when configured', async () => {
    const result = await book(path, { requiresInscription: true });
    expect(result.res.code).toBe(403);
    expect(result.res.body.code).toBe('WALK_IN_REQUIRES_INSCRIPTION');
    expect(result.bookings).toHaveLength(0);
  });
  it('allows enrollment-paid walk-in without a membership or credits', async () => {
    const result = await book(path, { requiresInscription: true, paid: true });
    expect(result.res.code).toBe(201);
    expect(result.selectMembershipForClass).not.toHaveBeenCalled();
    expect(result.consumeMembershipCredit).not.toHaveBeenCalled();
  });
});
