import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import { isWalkInClass, walkInRequiresInscription, shouldConsumeCredit } from '../classWalkIn.js';

// Execute the production handlers without booting the server or contacting
// production. Only database/auth/notification boundaries are substituted.
const source = readFileSync('server/index.js', 'utf8');

describe('membership preview', () => {
  it.each([true, false])('returns only the eligible account package (eligible=%s)', async eligible => {
    let handler;
    const start = source.indexOf('app.get("/api/bookings/eligibility",');
    const end = source.indexOf('\n});', start) + '\n});'.length;
    const select = vi.fn(async () => ({id:'member',plan_name:'Paquete 9 Clases',classes_remaining:5}));
    vm.runInNewContext(source.slice(start,end), {
      app:{get:(_path,...handlers)=>{handler=handlers.at(-1);}}, authMiddleware(){}, console,
      pool:{query:async()=>({rows:[{id:'class',branch_id:'pozos',class_category:'reformer',date:'2026-09-18',start_time:'07:00',is_walk_in:true,walk_in_requires_inscription:false}]})},
      isWalkInClass,walkInRequiresInscription,selectMembershipForClass:select,
      membershipCanBookClass:()=>eligible,checkPlanTimeRestriction:()=>({allowed:true}),
      isTrialPlan:()=>false,isUnlimitedClasses:()=>false,
    });
    const res={set:vi.fn(),json:vi.fn(),status(){return this;}};
    await handler({userId:'gloria',query:{classId:'class'}},res);
    expect(select).toHaveBeenCalledWith(expect.objectContaining({userId:'gloria',branchId:'pozos',classCategory:'reformer'}));
    expect(res.json).toHaveBeenCalledWith({membership:eligible?{id:'member',name:'Paquete 9 Clases',classesRemaining:5}:null});
    expect(res.set).toHaveBeenCalledWith('Cache-Control','no-store');
  });
});

describe('soft class waitlist promotion', () => {
  it.each(['free', 'member', 'expired'])('revalidates and charges the correct booking mode: %s', async mode => {
    const consumeMembershipCredit = vi.fn();
    const query = vi.fn(async sql => {
      if (sql.includes('FROM classes c')) return { rows: [{ id:'class', is_walk_in:true, walk_in_requires_inscription:false, current_bookings:0, max_capacity:6, class_category:'pilates' }] };
      if (sql.includes('FROM bookings')) return { rows: [{ id:'booking', user_id:'user', membership_id:mode === 'free' ? null : 'member' }] };
      if (sql.includes('FROM memberships')) return { rows: [{ id:'member' }] };
      return { rows: [] };
    });
    const start = source.indexOf('async function promoteWaitlist(classId)');
    const end = source.indexOf('\nasync function areEmailNotificationsEnabled', start);
    const promote = vm.runInNewContext(source.slice(start,end) + '\npromoteWaitlist;', {
      getCancellationConfig: async () => ({waitlist_cutoff_hours:0}),
      pool: {connect: async () => ({query, release() {}})}, console,
      normalizeClassCategory: value => value, isWalkInClass, walkInRequiresInscription,
      membershipIsEligibleForClass: () => mode !== 'expired',
      checkPlanTimeRestriction: () => ({allowed:true}), consumeMembershipCredit,
    });
    const result = await promote('class');
    expect(Boolean(result)).toBe(mode !== 'expired');
    expect(consumeMembershipCredit).toHaveBeenCalledTimes(mode === 'member' ? 1 : 0);
    if (mode === 'member') expect(query.mock.calls.some(([sql]) => sql.includes('membership_id = NULL'))).toBe(false);
  });
});

async function book(path, { walkIn = true, requiresInscription = false, paid = false, full = false, alreadyUsed = false, member = null, compatible = true, requestedMembershipId } = {}) {
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
    if (sql.includes('FROM memberships')) return { rows: member ? [member] : [] };
    if (sql.includes('INSERT INTO bookings')) {
      if (alreadyUsed && !args[2]) throw Object.assign(new Error('Ya utilizaste tu clase gratis.'), {code:'PFC01'});
      const booking = { id: 'booking', class_id: args[0], user_id: args[1], membership_id: args[2], status: args[3] };
      bookings.push(booking);
      return { rows: [booking] };
    }
    if (sql.startsWith('UPDATE classes SET current_bookings')) { occupied++; return { rows: [] }; }
    if (sql.includes('COUNT(*)::int AS pos')) return { rows: [{ pos: 1 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const client = { query, release: vi.fn() };
  const selectMembershipForClass = vi.fn().mockResolvedValue(member);
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
    membershipCanBookClass: () => compatible, isTrialPlan: () => false,
    checkPlanTimeRestriction: () => ({ allowed: true }),
    isUnlimitedClasses: value => value == null || value >= 9999,
    getCancellationConfig: async () => ({}), triggerWalletPassSync() {},
  });
  const res = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { classId: 'class', userId: 'user-without-membership', membershipId: requestedMembershipId }, userId: 'user-without-membership' }, res);
  expect(client.release).toHaveBeenCalledOnce();
  return { res, bookings, occupied, query, selectMembershipForClass, clientHasPaidWalkInInscription, consumeMembershipCredit };
}

describe('explicit membership confirmation', () => {
  it('does not fall back to free when the selected package is unavailable', async () => {
    const result = await book('/api/bookings', {requestedMembershipId:'missing'});
    expect(result.res.body.code).toBe('MEMBERSHIP_UNAVAILABLE');
    expect(result.bookings).toHaveLength(0);
  });
  it('uses the previewed membership despite a previous free visit', async () => {
    const result = await book('/api/bookings', {requestedMembershipId:'member',member:{id:'member',classes_remaining:5},alreadyUsed:true});
    expect(result.res.code).toBe(201);
    expect(result.bookings[0].membership_id).toBe('member');
    expect(result.consumeMembershipCredit).toHaveBeenCalledOnce();
  });
});

describe.each(['/api/bookings', '/api/admin/bookings/assign'])('%s walk-in access', path => {
  it.each([false, true])('uses membership after the free visit, charging only confirmed seats (full=%s)', async full => {
    const result = await book(path, { full, alreadyUsed: true, member: { id: 'member', classes_remaining: 5 } });
    expect(result.res.code).toBe(201);
    expect(result.bookings[0].membership_id).toBe('member');
    expect(result.consumeMembershipCredit).toHaveBeenCalledTimes(full ? 0 : 1);
    expect(result.selectMembershipForClass).toHaveBeenCalledWith(expect.objectContaining({branchId:'pozos',classCategory:'pilates'}));
  });
  it('rejects an incompatible membership even for a soft class', async () => {
    const result = await book(path, { member: { id: 'member', classes_remaining: 5 }, compatible: false });
    expect(result.res.code).toBe(403);
    expect(result.res.body.code).toBe('MEMBERSHIP_CLASS_MISMATCH');
    expect(result.bookings).toHaveLength(0);
  });
  it('rejects credits exhausted between selection and locking', async () => {
    const result = await book(path, { member: { id: 'member', classes_remaining: 0 } });
    expect(result.res.code).toBe(403);
    expect(result.bookings).toHaveLength(0);
  });
  it('returns a clear rejection and rolls back when the lifetime free class was used', async () => {
    const result=await book(path,{alreadyUsed:true});
    expect(result.res.code).toBe(403);
    expect(result.res.body.code).toBe('FREE_CLASS_ALREADY_USED');
    expect(result.bookings).toHaveLength(0);
    expect(result.occupied).toBe(0);
    expect(result.query).toHaveBeenCalledWith('ROLLBACK');
    expect(result.query).not.toHaveBeenCalledWith('COMMIT');
  });
  it.each([false, true])('free walk-in books without membership or enrollment (full=%s)', async full => {
    const result = await book(path, { full });
    expect(result.res.code).toBe(201);
    expect(result.bookings).toEqual([expect.objectContaining({ membership_id: null, status: full ? 'waitlist' : 'confirmed' })]);
    expect(result.occupied).toBe(full ? 6 : 1);
    expect(result.selectMembershipForClass).toHaveBeenCalledOnce();
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
