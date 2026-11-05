/**
 * API integration: the real app (src/server/app.ts) + real migrations/RPCs in PGlite.
 * One shop, three members, exercised through the HTTP contract the frontend will use.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { InlineAttachment, ShopState } from '../../src/domain';
import { demoProof } from '../../src/domain/demo-proof';
import { legacy, legacyDemo, legacyLayer } from '../oracle';
import { harness, type Harness } from './harness';

let h: Harness;
let owner: { userId: string; token: string };
let manager: { userId: string; token: string };
let staff: { userId: string; token: string };
let outsider: { userId: string; token: string };
let shopId: string;
let n = 0;
const key = () => `test-key-${++n}-${Date.now()}`;

const state = async (as: string) => (await h.call('GET', `/api/state?shop=${shopId}`, { as })).body;
async function act(
  as: string,
  type: string,
  payload: unknown,
  opts: { baseRevision?: number; idempotencyKey?: string } = {},
) {
  const baseRevision = opts.baseRevision ?? (await state(owner.token)).revision;
  return h.call('POST', '/api/action', {
    as,
    body: { shopId, type, payload, baseRevision, idempotencyKey: opts.idempotencyKey ?? key() },
  });
}

beforeAll(async () => {
  h = await harness();
  owner = await h.signUp('owner@daldal.test');
  manager = await h.signUp('manager@daldal.test');
  staff = await h.signUp('staff@daldal.test');
  outsider = await h.signUp('outsider@daldal.test');
}, 60_000);

describe('auth and routing', () => {
  it('health is public; everything else needs a valid token', async () => {
    expect((await h.call('GET', '/api/health')).body).toEqual({ ok: true });
    expect((await h.call('GET', '/api/me')).status).toBe(401);
    expect((await h.call('GET', '/api/me', { as: 'forged' })).status).toBe(401);
    expect((await h.call('GET', '/api/nope', { as: owner.token })).status).toBe(404);
    expect((await h.call('DELETE', '/api/state', { as: owner.token })).status).toBe(405);
  });
});

describe('shops and members', () => {
  it('a signed-in user creates a shop from the demo template and becomes owner', async () => {
    const r = await h.call('POST', '/api/shops', {
      as: owner.token,
      body: { name: 'ดัลดัล สาขา 1', displayName: 'พี่เจ', template: 'demo' },
    });
    expect(r.status).toBe(201);
    shopId = r.body.shopId;
    expect(r.body.state.purchasePolicy.approver).toBe('พี่เจ');
    const me = await h.call('GET', '/api/me', { as: owner.token });
    expect(me.body.memberships).toMatchObject([
      { shopId, role: 'owner', displayName: 'พี่เจ', shopName: 'ดัลดัล สาขา 1' },
    ]);
  });

  it('only the owner invites members; display names are unique', async () => {
    const invite = (as: string, email: string, displayName: string, role: string) =>
      h.call('POST', '/api/members', { as, body: { shopId, email, displayName, role } });
    expect((await invite(owner.token, 'manager@daldal.test', 'มุก', 'manager')).status).toBe(201);
    expect((await invite(owner.token, 'staff@daldal.test', 'ต้น', 'staff')).status).toBe(201);
    expect((await invite(manager.token, 'x@daldal.test', 'X', 'staff')).status).toBe(403);
    expect((await invite(owner.token, 'other@daldal.test', 'มุก', 'staff')).status).toBe(409);
    expect((await invite(owner.token, 'staff@daldal.test', 'ต้น 2', 'staff')).status).toBe(409);
    const list = await h.call('GET', `/api/members?shop=${shopId}`, { as: staff.token });
    expect(list.body.members.map((m: { displayName: string }) => m.displayName)).toEqual([
      'พี่เจ',
      'มุก',
      'ต้น',
    ]);
  });

  it('outsiders cannot read the shop', async () => {
    expect((await h.call('GET', `/api/state?shop=${shopId}`, { as: outsider.token })).status).toBe(
      403,
    );
    expect((await h.call('GET', `/api/state?shop=not-a-uuid`, { as: owner.token })).status).toBe(
      400,
    );
  });
});

describe('actions', () => {
  it('the server decides who acted: history shows the member name and role', async () => {
    const r = await act(staff.token, 'addMovement', {
      ingredientId: 'i-7',
      kind: 'use',
      qty: 1,
      reason: 'เบิกชาม',
    });
    expect(r.status).toBe(200);
    const m = r.body.state.movements.at(-1);
    expect(m).toMatchObject({ person: 'ต้น', role: 'staff', kind: 'use' });
  });

  it('clients cannot smuggle a person or role into the payload', async () => {
    const r = await act(staff.token, 'addMovement', {
      ingredientId: 'i-7',
      kind: 'use',
      qty: 1,
      reason: 'x',
      person: 'พี่เจ',
    });
    expect(r.status).toBe(400);
    expect((await act(staff.token, 'noSuchAction', {})).status).toBe(400);
  });

  it('business rules come back as 422 with the Thai message', async () => {
    const r = await act(staff.token, 'addMovement', {
      ingredientId: 'i-7',
      kind: 'increase',
      qty: 1,
      reason: 'x',
    });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ error: 'rule', message: 'บทบาทนี้ทำรายการนี้ไม่ได้' });
  });

  it('a stale revision is rejected with 409 and the current revision', async () => {
    const current = (await state(owner.token)).revision;
    const r = await act(
      manager.token,
      'addMovement',
      { ingredientId: 'i-7', kind: 'use', qty: 1, reason: 'x' },
      { baseRevision: current - 1 },
    );
    expect(r.status).toBe(409);
    expect(r.body.revision).toBe(current);
  });

  it('retrying with the same idempotency key applies once', async () => {
    const before = await state(owner.token);
    const k = key();
    const payload = { ingredientId: 'i-7', kind: 'increase', qty: 1, reason: 'retry' };
    const first = await act(manager.token, 'addMovement', payload, {
      baseRevision: before.revision,
      idempotencyKey: k,
    });
    const again = await act(manager.token, 'addMovement', payload, {
      baseRevision: before.revision,
      idempotencyKey: k,
    });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.revision).toBe(before.revision + 1);
    expect((await state(owner.token)).state.movements.length).toBe(
      before.state.movements.length + 1,
    );
  });

  it('only the configured approver can approve; approvers are chosen among members', async () => {
    const s = (await state(owner.token)).state as ShopState;
    const pending = s.purchaseOrders.find((o) => o.status === 'pending')!;
    const decide = (as: string) =>
      act(as, 'decideOrder', { orderId: pending.id, decision: 'approve', reason: 'ok' });
    expect((await decide(manager.token)).status).toBe(422);
    const ok = await decide(owner.token);
    expect(ok.status).toBe(200);
    expect(
      ok.body.state.purchaseOrders.find((o: { id: string }) => o.id === pending.id).decision.person,
    ).toBe('พี่เจ');

    expect(
      (
        await act(owner.token, 'savePurchasePolicy', {
          currency: 'THB',
          mode: 'above',
          threshold: '1000',
          approverUserId: staff.userId,
          note: 'x',
          checked: true,
        })
      ).status,
    ).toBe(422);
    const set = await act(owner.token, 'savePurchasePolicy', {
      currency: 'THB',
      mode: 'above',
      threshold: '1000',
      approverUserId: manager.userId,
      note: 'ผู้จัดการอนุมัติเกิน 1,000 บาท',
      checked: true,
    });
    expect(set.status).toBe(200);
    expect(set.body.state.purchasePolicy).toMatchObject({
      approver: 'มุก',
      approverRole: 'manager',
      threshold: 100000,
    });
  });

  it('an action that changes nothing is not committed', async () => {
    const s = await state(owner.token);
    const r = await act(staff.token, 'startCount', { title: 'นับเย็น' });
    expect(r.status).toBe(200);
    const round = r.body.state.countRounds.at(-1);
    const updates = round.lines.map((l: { ingredientId: string }) => ({
      ingredientId: l.ingredientId,
      qty: null,
    }));
    const noop = await act(staff.token, 'saveCount', { roundId: round.id, updates });
    expect(noop.body.unchanged).toBe(true);
    expect(noop.body.revision).toBe(s.revision + 1);
    expect(
      (await act(manager.token, 'cancelCount', { roundId: round.id, reason: 'ทดสอบ' })).status,
    ).toBe(200);
  });
});

describe('role-filtered state and reports', () => {
  it('staff never receive finance data', async () => {
    const view = await state(staff.token);
    expect(view.redacted).toBe(true);
    expect(view.state.expenses).toEqual([]);
    expect(view.state.purchasePolicy).toBeNull();
    const ordered = view.state.purchaseOrders.find(
      (o: { status: string }) => o.status === 'ordered',
    );
    expect(ordered.offers).toEqual([]);
    expect(ordered.decision).toBeNull();
    expect(ordered.purchase.total).toBeUndefined();
    expect(ordered.purchase.orderedQty).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toMatch(/packPrice|"total"/);

    const full = await state(manager.token);
    expect(full.redacted).toBe(false);
    expect(full.state.expenses.length).toBeGreaterThan(0);
  });

  it('reports are computed on the server per role', async () => {
    const s = await h.call('GET', `/api/report?shop=${shopId}`, { as: staff.token });
    expect(s.body.finance).toBeNull();
    expect(s.body.stock.length).toBe(8);
    const o = await h.call('GET', `/api/report?shop=${shopId}`, { as: owner.token });
    expect(o.body.finance.expenseTotals.THB.total).toBe(50000);
    expect(
      (await h.call('GET', `/api/report?shop=${shopId}&kind=expenses`, { as: staff.token })).status,
    ).toBe(422);
    const csv = await h.call('GET', `/api/report?shop=${shopId}&kind=purchases&from=2020-01-01`, {
      as: owner.token,
    });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.body).toMatch(/^"DALDAL","purchases"/); // Response.text() strips the BOM
    expect(csv.bom).toBe(true); // …but it is there for Excel
    expect(
      (await h.call('GET', `/api/report?shop=${shopId}&from=2026-13-01`, { as: owner.token }))
        .status,
    ).toBe(422);
  });
});

describe('evidence files', () => {
  const bytes = Uint8Array.from(Buffer.from((demoProof as InlineAttachment).data.split(',')[1]!, 'base64'));
  const meta = { name: 'bill.png', type: 'image/png', size: bytes.length, sha256: demoProof.hash };
  let evidenceId: string;
  let uploadToken: string;

  const saveExpense = (evidence: string | null | undefined) =>
    act(manager.token, 'saveExpense', {
      vendor: 'ร้านหลักฐาน',
      date: '2026-11-01',
      amount: '77',
      currency: 'THB',
      category: 'อื่น ๆ',
      funding: 'shop',
      payer: 'มุก',
      note: 'บิลทดสอบ',
      evidenceId: evidence,
      noEvidenceReason: evidence ? '' : 'ไม่มี',
    });

  it('staff cannot upload finance evidence', async () => {
    expect(
      (await h.call('POST', '/api/evidence', { as: staff.token, body: { shopId, ...meta } }))
        .status,
    ).toBe(403);
  });

  it('issues a signed upload; the file must arrive and match before it can be attached', async () => {
    const r = await h.call('POST', '/api/evidence', {
      as: manager.token,
      body: { shopId, ...meta },
    });
    expect(r.status).toBe(201);
    evidenceId = r.body.evidenceId;
    uploadToken = r.body.upload.token;
    expect(r.body.path).toBe(`${shopId}/${evidenceId}`);

    expect((await saveExpense(evidenceId)).body.message).toMatch('ยังอัปโหลด');
    h.upload(uploadToken, bytes.slice(0, 100));
    expect((await saveExpense(evidenceId)).body.message).toMatch('ไม่ตรงกับที่แจ้ง');
    h.upload(uploadToken, bytes);
    const ok = await saveExpense(evidenceId);
    expect(ok.status).toBe(200);
    expect(ok.body.state.expenses.at(-1).attachment).toEqual({
      name: 'bill.png',
      type: 'image/png',
      size: bytes.length,
      hash: demoProof.hash,
      evidenceId,
      path: `${shopId}/${evidenceId}`,
    });
  });

  it('a verified file is reused by hash; unknown ids are rejected', async () => {
    const again = await h.call('POST', '/api/evidence', {
      as: manager.token,
      body: { shopId, ...meta },
    });
    expect(again.body).toMatchObject({ evidenceId, upload: null });
    expect((await saveExpense(crypto.randomUUID())).body.message).toMatch('ไม่พบไฟล์หลักฐาน');
  });

  it('download links are signed and for reviewers only', async () => {
    const r = await h.call('GET', `/api/evidence?shop=${shopId}&id=${evidenceId}`, {
      as: owner.token,
    });
    expect(r.body.url).toMatch(/expires=60$/);
    expect(
      (await h.call('GET', `/api/evidence?shop=${shopId}&id=${evidenceId}`, { as: staff.token }))
        .status,
    ).toBe(403);
  });
});

describe('import of prototype backups', () => {
  const importBackup = async (as: string, backup: unknown, baseRevision?: number) =>
    h.call('POST', '/api/import', {
      as,
      body: { shopId, backup, baseRevision: baseRevision ?? (await state(owner.token)).revision },
    });

  it('only the owner may import, against the current revision', async () => {
    expect((await importBackup(manager.token, legacy.seed())).status).toBe(403);
    expect((await importBackup(owner.token, legacy.seed(), 0)).status).toBe(409);
    expect((await importBackup(owner.token, { schemaVersion: 6 })).status).toBe(422);
  });

  it('migrates any prototype version and continues the revision sequence', async () => {
    const before = (await state(owner.token)).revision;
    const r = await importBackup(owner.token, legacyLayer('stock-core').seed()); // a v3 backup
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(before + 1);
    expect(r.body.state.schemaVersion).toBe(6);
    const full = await importBackup(owner.token, legacyDemo.seed()); // v6 with inline evidence
    expect(full.status).toBe(200);
    expect(full.body.state.expenses[0].attachment.data).toMatch(/^data:image\/png/);
    const { rows } = await h.db.query(
      `select action from public.audit_log where shop_id = $1 order by id desc limit 1`,
      [shopId],
    );
    expect(rows).toEqual([{ action: 'importBackup' }]);
  });
});

describe('member administration', () => {
  it('the last owner cannot be demoted; a deactivated member loses access', async () => {
    const patch = (body: object) =>
      h.call('PATCH', '/api/members', { as: owner.token, body: { shopId, ...body } });
    expect((await patch({ userId: owner.userId, role: 'manager' })).status).toBe(422);
    expect((await patch({ userId: staff.userId, active: false })).status).toBe(200);
    expect((await h.call('GET', `/api/state?shop=${shopId}`, { as: staff.token })).status).toBe(
      403,
    );
    expect(
      (
        await h.call('PATCH', '/api/members', {
          as: manager.token,
          body: { shopId, userId: staff.userId, active: true },
        })
      ).status,
    ).toBe(403);
    expect((await patch({ userId: staff.userId, active: true })).status).toBe(200);
  });
});
