/**
 * Database schema tests: runs the real supabase/migrations in PGlite (embedded Postgres 17)
 * on top of a minimal Supabase stub, then checks the write path and row-level security.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import * as D from '../../src/domain';

const root = join(import.meta.dirname, '..', '..');
const migrations = readdirSync(join(root, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

let db: PGlite;
const users = {
  owner: '00000000-0000-4000-8000-000000000001',
  manager: '00000000-0000-4000-8000-000000000002',
  staff: '00000000-0000-4000-8000-000000000003',
  outsider: '00000000-0000-4000-8000-000000000004',
};
let shopA: string;
let shopB: string;

type Role = 'anon' | 'authenticated' | 'service_role';

/** Run `fn` as an API role (and JWT subject), always rolled back. */
async function as<T>(
  role: Role,
  sub: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  let result: T;
  let error: unknown;
  await db
    .transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub ?? '']);
      await tx.exec(`set local role ${role}`);
      try {
        result = await fn(tx);
      } catch (e) {
        error = e;
      }
      await tx.rollback();
    })
    .catch(() => {});
  if (error) throw error;
  return result!;
}

const rows = async (tx: Transaction, sql: string, params: unknown[] = []) =>
  (await tx.query<Record<string, unknown>>(sql, params)).rows;

/** Service-role call that persists (not rolled back). */
async function service<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return (await tx.query<T>(sql, params)).rows;
  });
}

async function commit(
  shop: string,
  actor: string,
  role: string,
  expected: number,
  next: D.ShopState,
  key: string | null = null,
) {
  const [r] = await service<{ result: { status: string; revision: number } }>(
    `select public.commit_shop_action($1, $2, $3::public.member_role, 'test', '{}'::jsonb, $4, $5::jsonb, $6) as result`,
    [shop, actor, role, expected, JSON.stringify(next), key],
  );
  return r!.result;
}

const state = async (shop: string) =>
  (
    await db.query<{ revision: number; data: D.ShopState }>(
      `select revision, data from public.shop_state where shop_id = $1`,
      [shop],
    )
  ).rows[0]!;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, 'supabase-stub.sql'), 'utf8'));
  for (const f of migrations)
    await db.exec(readFileSync(join(root, 'supabase', 'migrations', f), 'utf8'));
  for (const [name, id] of Object.entries(users))
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [
      id,
      `${name}@daldal.test`,
    ]);
  const seed = JSON.stringify(D.seed());
  shopA = (
    await service<{ id: string }>(
      `select public.bootstrap_shop($1, 'ดัลดัล สาขา 1', 'เจ้าของ', $2::jsonb) as id`,
      [users.owner, seed],
    )
  )[0]!.id;
  shopB = (
    await service<{ id: string }>(
      `select public.bootstrap_shop($1, 'ร้านอื่น', 'คนนอก', $2::jsonb) as id`,
      [users.outsider, seed],
    )
  )[0]!.id;
  await db.query(
    `insert into public.shop_members (shop_id, user_id, role, display_name) values ($1, $2, 'manager', 'ผู้จัดการ'), ($1, $3, 'staff', 'พนักงาน')`,
    [shopA, users.manager, users.staff],
  );
}, 60_000);

describe('migrations', () => {
  it(`apply cleanly (${migrations.length} files) and create the evidence bucket`, async () => {
    const { rows: b } = await db.query(`select id, public from storage.buckets`);
    expect(b).toEqual([{ id: 'evidence', public: false }]);
  });

  it('bootstrap_shop creates the owner membership, the state document and an audit row', async () => {
    expect((await state(shopA)).revision).toBe(0);
    const { rows: m } = await db.query(
      `select role from public.shop_members where shop_id = $1 and user_id = $2`,
      [shopA, users.owner],
    );
    expect(m).toEqual([{ role: 'owner' }]);
    const { rows: a } = await db.query(`select action from public.audit_log where shop_id = $1`, [
      shopA,
    ]);
    expect(a).toEqual([{ action: 'bootstrapShop' }]);
  });

  it('rejects documents whose revision does not match, or that are not v6', async () => {
    await expect(
      db.query(
        `update public.shop_state set data = jsonb_set(data, '{revision}', '5') where shop_id = $1`,
        [shopA],
      ),
    ).rejects.toThrow(/shop_state_document/);
    await expect(
      db.query(
        `update public.shop_state set data = jsonb_set(data, '{schemaVersion}', '5') where shop_id = $1`,
        [shopA],
      ),
    ).rejects.toThrow(/shop_state_document/);
  });
});

describe('commit_shop_action (atomic write path)', () => {
  it('commits a domain operation, bumps the revision and writes audit', async () => {
    const before = await state(shopA);
    const next = D.saveUnit(before.data, { name: 'ลัง', symbol: 'ลัง', type: 'จำนวน' }, 'manager');
    const r = await commit(shopA, users.manager, 'manager', before.revision, next);
    expect(r).toEqual({ status: 'committed', revision: before.revision + 1 });
    const after = await state(shopA);
    expect(after.data.units.at(-1)!.name).toBe('ลัง');
    const { rows } = await db.query(
      `select actor_role, revision_before, revision_after from public.audit_log where shop_id = $1 order by id desc limit 1`,
      [shopA],
    );
    expect(rows[0]).toEqual({
      actor_role: 'manager',
      revision_before: before.revision,
      revision_after: after.revision,
    });
  });

  it('a stale revision is a conflict and changes nothing (concurrent edits never overwrite)', async () => {
    const base = await state(shopA);
    const mine = D.saveUnit(base.data, { name: 'กล่อง', symbol: 'กล่อง', type: 'จำนวน' }, 'owner');
    const theirs = D.saveUnit(base.data, { name: 'โหล', symbol: 'โหล', type: 'จำนวน' }, 'manager');
    expect((await commit(shopA, users.manager, 'manager', base.revision, theirs)).status).toBe(
      'committed',
    );
    expect(await commit(shopA, users.owner, 'owner', base.revision, mine)).toEqual({
      status: 'conflict',
      revision: base.revision + 1,
    });
    expect((await state(shopA)).data.units.map((u) => u.name)).not.toContain('กล่อง');
  });

  it('the same idempotency key is applied once and then replayed', async () => {
    const base = await state(shopA);
    const next = D.toggle(base.data, 'i-2', 'manager');
    const key = 'retry-key-0001';
    expect((await commit(shopA, users.manager, 'manager', base.revision, next, key)).status).toBe(
      'committed',
    );
    expect(await commit(shopA, users.manager, 'manager', base.revision, next, key)).toEqual({
      status: 'replayed',
      revision: base.revision + 1,
    });
    expect((await state(shopA)).revision).toBe(base.revision + 1);
  });

  it('refuses actors who are not active members with that role', async () => {
    const base = await state(shopA);
    const next = D.toggle(base.data, 'i-3', 'owner');
    await expect(commit(shopA, users.staff, 'owner', base.revision, next)).rejects.toThrow(
      /not an active owner/,
    );
    await expect(commit(shopA, users.outsider, 'owner', base.revision, next)).rejects.toThrow(
      /not an active/,
    );
    await db.query(
      `update public.shop_members set active = false where shop_id = $1 and user_id = $2`,
      [shopA, users.manager],
    );
    await expect(commit(shopA, users.manager, 'manager', base.revision, next)).rejects.toThrow(
      /not an active/,
    );
    await db.query(
      `update public.shop_members set active = true where shop_id = $1 and user_id = $2`,
      [shopA, users.manager],
    );
  });

  it('the next revision must increase', async () => {
    const base = await state(shopA);
    await expect(commit(shopA, users.owner, 'owner', base.revision, base.data)).rejects.toThrow(
      /must be greater/,
    );
  });

  it('audit_log is append-only', async () => {
    await expect(db.query(`update public.audit_log set action = 'x'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query(`delete from public.audit_log`)).rejects.toThrow(/append-only/);
  });
});

describe('row-level security', () => {
  it('clients cannot call the write path', async () => {
    for (const role of ['anon', 'authenticated'] as const)
      await expect(
        as(role, users.owner, (tx) =>
          rows(tx, `select public.commit_shop_action($1, $2, 'owner', 'x', '{}', 0, '{}', null)`, [
            shopA,
            users.owner,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    await expect(
      as('authenticated', users.owner, (tx) =>
        rows(tx, `select public.bootstrap_shop($1, 'x', 'x', '{}')`, [users.owner]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('nobody reads or writes shop_state directly (finance data is filtered by /api)', async () => {
    await expect(
      as('authenticated', users.owner, (tx) => rows(tx, `select * from public.shop_state`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as('authenticated', users.owner, (tx) =>
        rows(tx, `update public.shop_state set revision = revision`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as('anon', null, (tx) => rows(tx, `select * from public.shop_state`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('members see only their own shop and colleagues', async () => {
    const shops = await as('authenticated', users.staff, (tx) =>
      rows(tx, `select id from public.shops`),
    );
    expect(shops).toEqual([{ id: shopA }]);
    const members = await as('authenticated', users.staff, (tx) =>
      rows(tx, `select display_name from public.shop_members order by display_name`),
    );
    expect(members.map((m) => m.display_name)).toEqual(['ผู้จัดการ', 'พนักงาน', 'เจ้าของ']);
    const outsider = await as('authenticated', users.outsider, (tx) =>
      rows(tx, `select id from public.shops`),
    );
    expect(outsider).toEqual([{ id: shopB }]);
    expect(
      await as('anon', null, (tx) => rows(tx, `select * from public.shops`).catch(() => [])),
    ).toEqual([]);
  });

  it('clients cannot change membership (no self-promotion)', async () => {
    await expect(
      as('authenticated', users.staff, (tx) =>
        rows(tx, `update public.shop_members set role = 'owner' where user_id = $1`, [users.staff]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as('authenticated', users.outsider, (tx) =>
        rows(tx, `insert into public.shop_members values ($1, $2, 'owner', 'แฮก')`, [
          shopA,
          users.outsider,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('audit is visible to owners and managers of the shop, not to staff', async () => {
    const owner = await as('authenticated', users.owner, (tx) =>
      rows(tx, `select distinct shop_id from public.audit_log`),
    );
    expect(owner).toEqual([{ shop_id: shopA }]);
    expect(
      await as('authenticated', users.manager, (tx) =>
        rows(tx, `select 1 from public.audit_log limit 1`),
      ),
    ).toHaveLength(1);
    expect(
      await as('authenticated', users.staff, (tx) => rows(tx, `select 1 from public.audit_log`)),
    ).toEqual([]);
  });

  it('evidence files are readable by reviewers of the owning shop only', async () => {
    const hash = 'a'.repeat(64);
    await db.query(
      `insert into public.evidence (shop_id, object_path, sha256, mime, size_bytes, original_name) values ($1::uuid, $1::text || '/bill-1', $2, 'image/png', 100, 'bill.png')`,
      [shopA, hash],
    );
    await db.query(
      `insert into storage.objects (bucket_id, name) values ('evidence', $1::text || '/bill-1'), ('evidence', 'junk/file')`,
      [shopA],
    );
    const read = (who: string) =>
      as('authenticated', who, async (tx) => ({
        meta: (await rows(tx, `select original_name from public.evidence`)).length,
        files: (await rows(tx, `select name from storage.objects`)).length,
      }));
    expect(await read(users.owner)).toEqual({ meta: 1, files: 1 });
    expect(await read(users.manager)).toEqual({ meta: 1, files: 1 });
    expect(await read(users.staff)).toEqual({ meta: 0, files: 0 });
    expect(await read(users.outsider)).toEqual({ meta: 0, files: 0 });
  });

  it('evidence paths must live under the shop folder; a file is stored once per shop', async () => {
    await expect(
      db.query(
        `insert into public.evidence (shop_id, object_path, sha256, mime, size_bytes, original_name) values ($1::uuid, $2::text || '/x', $3, 'image/png', 1, 'x.png')`,
        [shopA, shopB, 'b'.repeat(64)],
      ),
    ).rejects.toThrow(/evidence_path_in_shop/);
    await expect(
      db.query(
        `insert into public.evidence (shop_id, object_path, sha256, mime, size_bytes, original_name) values ($1::uuid, $1::text || '/bill-2', $2, 'image/png', 1, 'x.png')`,
        [shopA, 'a'.repeat(64)],
      ),
    ).rejects.toThrow(/unique|duplicate/);
  });
});
