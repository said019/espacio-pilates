import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import pg from 'pg';
import { expect, it, vi } from 'vitest';

it.skipIf(!process.env.TEST_DATABASE_URL)('executes attendance and admin moves against PostgreSQL without duplicate seats or points', async () => {
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  try {
    // All tables are session-local; route COMMITs cannot persist real data.
    await db.query(`CREATE TEMP TABLE class_types(id text,category text);
      CREATE TEMP TABLE classes(id text,class_type_id text,status text,max_capacity int,current_bookings int);
      CREATE TEMP TABLE bookings(id text,user_id text,class_id text,membership_id text,status varchar(20),checked_in_at timestamptz);
      CREATE TEMP TABLE settings(key text,value jsonb);
      CREATE TEMP TABLE loyalty_transactions(user_id text,type text,points int,description text);
      INSERT INTO class_types VALUES ('type','pilates');
      INSERT INTO classes VALUES ('class','type','scheduled',1,0);
      INSERT INTO bookings VALUES ('first','u1','class',NULL,'waitlist',NULL),('second','u2','class',NULL,'waitlist',NULL);
      INSERT INTO settings VALUES ('loyalty_config','{"enabled":true,"points_per_class":10}');`);
    const source = readFileSync('server/index.js', 'utf8');
    const start = source.indexOf('app.put("/api/bookings/:id/check-in",');
    let handler;
    const notify = vi.fn(async () => {});
    vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
      app: { put: (_path, _auth, fn) => { handler = fn; } }, adminMiddleware() {}, console,
      pool: { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) },
      isWalkInClass: () => true, walkInRequiresInscription: () => false,
      normalizeClassCategory: () => 'pilates', notifyWaitlistPromotion: notify, triggerWalletPassSync() {},
    });
    const move = async (id, targetStatus) => {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ params: { id }, body: { targetStatus } }, res);
      return res;
    };
    expect((await move('first', 'confirmed')).code).toBe(200);
    expect((await db.query('SELECT current_bookings FROM classes')).rows[0].current_bookings).toBe(1);
    expect((await move('second', 'confirmed')).code).toBe(409);
    expect((await move('first', 'checked_in')).code).toBe(200);
    expect((await move('first', 'checked_in')).code).toBe(200);
    expect((await db.query('SELECT * FROM loyalty_transactions')).rowCount).toBe(1);
    expect((await db.query('SELECT current_bookings FROM classes')).rows[0].current_bookings).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((await move('first', 'waitlist')).code).toBe(409); // cannot undo attendance
    await db.query("UPDATE bookings SET status='confirmed' WHERE id='first'");
    expect((await move('first', 'waitlist')).code).toBe(200);
    expect((await db.query('SELECT current_bookings FROM classes')).rows[0].current_bookings).toBe(0);
    expect((await move('second', 'confirmed')).code).toBe(200);
    expect(notify).toHaveBeenCalledTimes(2);
  } finally { await db.end(); }
}, 30000);
