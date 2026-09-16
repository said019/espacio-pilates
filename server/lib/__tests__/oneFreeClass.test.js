import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, it, expect } from 'vitest';

// Isolated disposable schema: no production user, class or booking is modified.
describe.skipIf(!process.env.TEST_DATABASE_URL)('one lifetime free class (PostgreSQL)', () => {
  it('enforces history, both branches, waitlist, admin inserts, cancellation and simultaneous requests', async () => {
    const schema='test_free_'+randomUUID().replaceAll('-','');
    const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
    const other=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});
    await db.connect(); await other.connect();
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      for(const client of [db,other]) await client.query(`SET search_path TO ${schema}, public`);
      await db.query(`CREATE TABLE users(id uuid PRIMARY KEY);
        CREATE TABLE classes(id uuid PRIMARY KEY, branch text, is_walk_in boolean, walk_in_requires_inscription boolean);
        CREATE TABLE bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, class_id uuid, membership_id uuid,
          status text DEFAULT 'confirmed', created_at timestamptz DEFAULT now());`);
      const [villa,pozos,paid,enrollment]=Array.from({length:4},randomUUID);
      await db.query(`INSERT INTO classes VALUES ($1,'villa',true,false),($2,'pozos',true,false),($3,'villa',false,true),($4,'pozos',true,true)`,[villa,pozos,paid,enrollment]);
      const users=Array.from({length:7},randomUUID);
      for(const id of users) await db.query('INSERT INTO users VALUES ($1)',[id]);
      const book=(user,cls,status='confirmed',client=db)=>client.query('INSERT INTO bookings(user_id,class_id,status) VALUES ($1,$2,$3) RETURNING id',[user,cls,status]);
      // Pre-existing multiple bookings stay in place, but exhaust the benefit.
      await book(users[0],villa); await book(users[0],pozos);
      const migration=readFileSync('supabase/migrations/202609150001_one_free_class.sql','utf8');
      await db.query(migration); await db.query(migration);
      expect((await db.query('SELECT count(*)::int AS n FROM bookings WHERE user_id=$1',[users[0]])).rows[0].n).toBe(2);
      await expect(book(users[0],villa)).rejects.toMatchObject({code:'PFC01'});
      // Membership-backed visits may repeat even after the free benefit is spent.
      for (const cls of [villa, pozos, villa]) {
        await db.query('INSERT INTO bookings(user_id,class_id,membership_id) VALUES ($1,$2,$3)', [users[0],cls,randomUUID()]);
      }
      // Paid visits do not consume a new user's free entitlement.
      await db.query('INSERT INTO bookings(user_id,class_id,membership_id) VALUES ($1,$2,$3)', [users[1],villa,randomUUID()]);
      await db.query(migration);
      expect((await db.query('SELECT * FROM free_class_claims WHERE user_id=$1',[users[1]])).rows).toHaveLength(0);

      const first=(await book(users[1],villa)).rows[0].id;
      await expect(book(users[1],pozos)).rejects.toMatchObject({code:'PFC01', message:'Ya utilizaste tu clase gratis. Para volver a tomar clase, compra una visita o adquiere una membresía. ¡Te esperamos!'});
      await db.query('UPDATE bookings SET class_id=$1 WHERE id=$2',[pozos,first]);
      await db.query("UPDATE bookings SET status='cancelled' WHERE id=$1",[first]);
      await expect(book(users[1],villa)).rejects.toMatchObject({code:'PFC01'});
      await book(users[1],paid); await book(users[1],paid);
      await book(users[1],enrollment); await book(users[1],enrollment);

      await book(users[2],villa,'waitlist');
      await expect(book(users[2],pozos)).rejects.toMatchObject({code:'PFC01'});
      const concurrent=await Promise.allSettled([book(users[3],villa,'confirmed',db),book(users[3],pozos,'confirmed',other)]);
      expect(concurrent.filter(r=>r.status==='fulfilled')).toHaveLength(1);
      expect(concurrent.find(r=>r.status==='rejected').reason.code).toBe('PFC01');

      await db.query('BEGIN'); await book(users[4],villa); await db.query('ROLLBACK');
      await book(users[4],pozos);
      const guest1=(await book(null,villa)).rows[0].id, guest2=(await book(null,pozos)).rows[0].id;
      await db.query('UPDATE bookings SET user_id=$1 WHERE id IN ($2,$3)',[users[5],guest1,guest2]);
      await expect(book(users[5],villa)).rejects.toMatchObject({code:'PFC01'});

      // Editing a previous free class back to paid cannot restore the benefit.
      await book(users[6],villa);
      await db.query('UPDATE classes SET is_walk_in=false WHERE id=$1',[villa]);
      await expect(book(users[6],pozos)).rejects.toMatchObject({code:'PFC01'});
    } finally {
      await other.end();
      await db.query('ROLLBACK');
      await db.query('SET search_path TO public');
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await db.end();
    }
  },60000);
});
