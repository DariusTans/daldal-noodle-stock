/**
 * Parity: the TypeScript domain must behave exactly like the legacy v0.8.1 prototype.
 * Both sides run with the same pinned clock and the same Math.random sequence, so ids and
 * timestamps match and states can be deep-compared. Errors are compared by message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as D from '../../src/domain';
import { demoSeed } from '../../src/domain/demo';
import { demoProof } from '../../src/domain/demo-proof';
import type { ShopState } from '../../src/domain';
import { legacy, legacyDemo, legacyLayer } from '../oracle';

const T0 = Date.parse('2026-11-05T03:00:00.000Z');

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Outcome = { ok: true; value: unknown } | { ok: false; message: string; type: string };

/** Run fn with the clock at `time` and Math.random seeded with `seed`. */
function pinned(fn: () => unknown, time: number, seed: number): Outcome {
  vi.setSystemTime(time);
  const rng = mulberry32(seed);
  const spy = vi.spyOn(Math, 'random').mockImplementation(rng);
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      message: err.message,
      type: err instanceof TypeError ? 'TypeError' : 'Error',
    };
  } finally {
    spy.mockRestore();
  }
}

function expectSame(a: Outcome, b: Outcome, label: string) {
  if (a.ok && b.ok) {
    expect(b.value, label).toEqual(a.value);
    return;
  }
  expect({ ok: b.ok, label }).toEqual({ ok: a.ok, label });
  if (!a.ok && !b.ok && a.type !== 'TypeError') expect(b.message, label).toBe(a.message);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Read-only projections that must also agree. */
function queries(s: ShopState) {
  const out: Record<string, unknown> = {
    stockRows: D.stockRows(s),
    latestCounts: D.latestCounts(s),
    expenseTotals: D.expenseTotals(s),
  };
  for (const role of ['owner', 'manager', 'staff'] as const) {
    out['workflow:' + role] = D.workflowTasks(s, role);
    out['report:' + role] = D.report(s, null, role);
    for (const kind of ['stock', 'movements', 'receipts', 'expenses', 'purchases'] as const) {
      try {
        out[`csv:${role}:${kind}`] = D.reportCSV(s, null, role, kind);
      } catch (e) {
        out[`csv:${role}:${kind}`] = 'ERR ' + (e as Error).message;
      }
    }
  }
  out.orders = s.purchaseOrders.map((o) => ({
    stale: D.orderSourceStale(s, o),
    policyStale: D.orderPolicyStale(s, o),
    needs: D.needsApproval(s, o),
    ...(o.status === 'ordered'
      ? { summary: D.receivingSummary(s, o), label: D.receivingLabel(s, o) }
      : {}),
  }));
  out.expenses = s.expenses.map((e) => D.expenseWarnings(s, e));
  return out;
}

function legacyQueries(s: ShopState) {
  const L = legacy;
  const out: Record<string, unknown> = {
    stockRows: L.stockRows(s),
    latestCounts: L.latestCounts(s),
    expenseTotals: L.expenseTotals(s),
  };
  for (const role of ['owner', 'manager', 'staff']) {
    out['workflow:' + role] = L.workflowTasks(s, role);
    out['report:' + role] = L.report(s, null, role);
    for (const kind of ['stock', 'movements', 'receipts', 'expenses', 'purchases']) {
      try {
        out[`csv:${role}:${kind}`] = L.reportCSV(s, null, role, kind);
      } catch (e) {
        out[`csv:${role}:${kind}`] = 'ERR ' + (e as Error).message;
      }
    }
  }
  out.orders = s.purchaseOrders.map((o) => ({
    stale: L.orderSourceStale(s, o),
    policyStale: L.orderPolicyStale(s, o),
    needs: L.needsApproval(s, o),
    ...(o.status === 'ordered'
      ? { summary: L.receivingSummary(s, o), label: L.receivingLabel(s, o) }
      : {}),
  }));
  out.expenses = s.expenses.map((e) => L.expenseWarnings(s, e));
  return out;
}

describe('demo dataset', () => {
  it('builds the identical state through every workflow step', () => {
    const a = pinned(() => legacyDemo.seed(), T0, 42);
    const b = pinned(() => demoSeed(), T0, 42);
    expectSame(a, b, 'demo seed');
  });

  it('derives identical queries, reports and CSV for every role', () => {
    const s = (pinned(() => legacyDemo.seed(), T0, 7) as { value: ShopState }).value;
    const a = pinned(() => legacyQueries(s), T0 + 1000, 1);
    const b = pinned(() => queries(s), T0 + 1000, 1);
    expectSame(a, b, 'queries');
  });

  it('matches the documented dashboard totals (purchases 530 / expenses 500 THB)', () => {
    vi.setSystemTime(T0);
    const r = D.report(demoSeed(), null, 'owner');
    expect(r.finance?.purchaseTotals.THB).toBe(53000);
    expect(r.finance?.expenseTotals.THB?.total).toBe(50000);
  });
});

describe('migration of older backups', () => {
  const layers = ['core', 'counts-core', 'stock-core', 'buy-core', 'receive-core'];
  for (const [i, name] of layers.entries())
    it(`v${i + 1} seed (${name}) migrates identically`, () => {
      const input = legacyLayer(name).seed();
      expect(input.schemaVersion).toBe(i + 1);
      expectSame(
        pinned(() => legacy.migrate(input), T0, 3),
        pinned(() => D.migrate(input), T0, 3),
        name,
      );
    });

  it('v6 demo state round-trips, corrupt input is rejected with the same message', () => {
    const s = (pinned(() => legacyDemo.seed(), T0, 9) as { value: ShopState }).value;
    expectSame(
      pinned(() => legacy.migrate(s), T0, 1),
      pinned(() => D.migrate(s), T0, 1),
      'v6',
    );
    const corrupt = [
      null,
      {},
      { ...s, schemaVersion: 7 },
      { ...s, revision: -1 },
      { ...s, movements: [{ ...s.movements[0], qty: -1 }] },
      { ...s, expenses: [{ ...s.expenses[0], amount: 0 }] },
      { ...s, receipts: [...s.receipts, { ...s.receipts[0] }] },
    ];
    for (const [n, c] of corrupt.entries())
      expectSame(
        pinned(() => legacy.migrate(c), T0, 1),
        pinned(() => D.migrate(c), T0, 1),
        'corrupt ' + n,
      );
  });
});

// ── Differential fuzzing ─────────────────────────────────────────────
type Gen = () => number;
const pick = <T>(g: Gen, xs: readonly T[]): T => xs[Math.floor(g() * xs.length)]!;

/** Mostly coherent actors (name matches the configured approver/reviewer), some invalid. */
const ACTORS: Array<[string, string]> = [
  ['เจ้าของตัวอย่าง', 'owner'],
  ['เจ้าของตัวอย่าง', 'owner'],
  ['เจ้าของตัวอย่าง', 'owner'],
  ['ผู้จัดการตัวอย่าง', 'manager'],
  ['ผู้จัดการตัวอย่าง', 'manager'],
  ['ผู้จัดการตัวอย่าง', 'manager'],
  ['พนักงานตัวอย่าง', 'staff'],
  ['พนักงานตัวอย่าง', 'staff'],
  ['ผู้จัดการตัวอย่าง', 'owner'],
  ['', 'owner'],
  ['Cin', 'ghost'],
];
const REASONS = ['ตรวจแล้ว', 'ตรวจแล้ว', 'นับใหม่', 'นับใหม่', '', 'x'.repeat(501)];

function ops(g: Gen, s: ShopState, n: number): [string, unknown[]] {
  const ing = () => pick(g, [...s.ingredients.map((i) => i.id), 'i-missing']);
  const [actorName, actorRole] = pick(g, ACTORS);
  const person = () => actorName;
  const role = () => actorRole;
  const reason = () => pick(g, REASONS);
  const openRound = s.countRounds.find((r) => r.status === 'draft' || r.status === 'review');
  const round = () => pick(g, [...s.countRounds.map((r) => r.id), openRound?.id ?? 'ct-x', 'ct-x']);
  const req = () => pick(g, [...s.purchaseRequests.map((p) => p.id), 'pr-x']);
  const order = () => pick(g, [...s.purchaseOrders.map((o) => o.id), 'po-x']);
  const receipt = () => pick(g, [...s.receipts.map((r) => r.id), 'rc-x']);
  const exp = () => pick(g, [...s.expenses.map((e) => e.id), 'ex-x']);
  const mv = () => pick(g, [...s.movements.map((m) => m.id), 'mv-x']);
  const qty = () =>
    pick(g, [1, 2, 3, 5, 10, 12, 1, 2, 3, 4, '4', '0.5', 0, '1.2345', -1, 'abc', '', null, 1e10]);
  const money = () => pick(g, ['50', '3', '0', '12.5', '12.345', '-1', 'abc', 10, '1000000001']);
  const iso = () =>
    pick(g, [new Date().toISOString(), new Date(Date.now() + 3600e3).toISOString(), 'bad']);
  const choices: Array<() => [string, unknown[]]> = [
    () => [
      'saveIngredient',
      [
        {
          id: pick(g, [undefined, ing()]),
          code: pick(g, ['DD-001', 'NEW-' + n, '', 'x'.repeat(31), ' new-' + n]),
          name: pick(g, ['เส้นรามยอน', 'วัตถุดิบ ' + n, '', 'ไข่ไก่ ']),
          category: pick(g, ['โปรตีน', 'อื่น ๆ', 'bad']),
          unitId: pick(g, [...s.units.map((u) => u.id), 'u-x']),
          location: pick(g, ['ชั้น A', 'x'.repeat(101)]),
          note: '',
        },
        role(),
      ],
    ],
    () => [
      'saveUnit',
      [
        {
          id: pick(g, [undefined, ...s.units.map((u) => u.id)]),
          name: pick(g, ['แพ็ก', 'หน่วย ' + n, '']),
          symbol: pick(g, ['แพ็ก', 's' + n, '']),
          type: pick(g, ['จำนวน', 'น้ำหนัก', 'bad']),
        },
        role(),
      ],
    ],
    () => ['toggle', [ing(), role()]],
    () => ['startCount', [pick(g, ['รอบนับ ' + n, '']), person(), role()]],
    () => {
      const r = s.countRounds.find((r) => r.id === round());
      const lines = (openRound ?? r)?.lines ?? [];
      const updates = lines.map((l) => ({
        ingredientId: l.ingredientId,
        qty: qty(),
        reason: reason(),
      }));
      if (g() < 0.1) updates.pop();
      return ['saveCount', [openRound?.id ?? round(), updates, person(), role()]];
    },
    () => ['submitCount', [openRound?.id ?? round(), person(), role()]],
    () => ['returnCount', [openRound?.id ?? round(), reason(), person(), role()]],
    () => ['confirmCount', [openRound?.id ?? round(), person(), role()]],
    () => ['cancelCount', [openRound?.id ?? round(), reason(), person(), role()]],
    () => [
      'addMovement',
      [
        {
          ingredientId: ing(),
          kind: pick(g, ['receive', 'use', 'waste', 'increase', 'decrease', 'reverse', 'bad']),
          qty: qty(),
          person: person(),
          reason: reason(),
          reference: pick(g, ['', 'DEMO-DEL-1', 'REF-' + n]),
        },
        role(),
      ],
    ],
    () => ['reverseMovement', [mv(), reason(), person(), role()]],
    () => ['reviewLedger', [ing(), reason(), person(), pick(g, [true, true, false]), role()]],
    () => [
      'savePolicy',
      [
        {
          ingredientId: ing(),
          minimum: pick(g, [3, 5, '2', 12]),
          target: pick(g, [4, 12, 20, '1']),
          enabled: pick(g, [true, false]),
          person: person(),
        },
        role(),
      ],
    ],
    () => ['createRequest', [ing(), person(), role()]],
    () => {
      const id = req();
      const p = s.purchaseRequests.find((p) => p.id === id);
      return [
        'reviewRequest',
        [
          id,
          {
            qty: pick(g, [p?.suggested, 10, 0, '7']),
            reason: reason(),
            person: person(),
            checked: g() < 0.85,
          },
          role(),
        ],
      ];
    },
    () => ['refreshRequest', [req(), person(), role()]],
    () => ['cancelRequest', [req(), reason(), person(), role()]],
    () => [
      'savePurchasePolicy',
      [
        {
          currency: pick(g, ['THB', 'THB', 'USD', 'EUR']),
          mode: pick(g, ['all', 'above', 'bad']),
          threshold: pick(g, ['100', '0.5', 'abc', '0']),
          approver: pick(g, ['เจ้าของตัวอย่าง', 'ผู้จัดการตัวอย่าง', '']),
          approverRole: pick(g, ['owner', 'manager', 'staff']),
          note: pick(g, ['เกณฑ์', '']),
          person: person(),
          checked: g() < 0.9,
        },
        role(),
      ],
    ],
    () => ['createOrder', [req(), pick(g, ['THB', 'THB', 'USD', 'EUR']), person(), role()]],
    () => [
      'reviewOrderSource',
      [order(), { qty: qty(), person: person(), reason: reason(), checked: g() < 0.85 }, role()],
    ],
    () => {
      const id = order();
      const o = s.purchaseOrders.find((o) => o.id === id);
      return [
        'saveOffer',
        [
          id,
          {
            id: pick(g, [undefined, undefined, ...(o?.offers.map((f) => f.id) ?? []), 'quote-x']),
            vendor: pick(g, ['ร้าน A', 'ร้าน B', '']),
            packQty: pick(g, [1, 3, '0.5', 0]),
            packPrice: money(),
            shipping: pick(g, ['0', '5']),
            extra: '0',
            discount: pick(g, ['0', '0', '100000']),
            source: pick(g, ['LINE', '']),
            conditions: 'ไม่มี',
            quotedAt: iso(),
            person: person(),
          },
          role(),
        ],
      ];
    },
    () => {
      const id = order();
      const o = s.purchaseOrders.find((o) => o.id === id);
      return [
        'selectOffer',
        [
          id,
          pick(g, [...(o?.offers.map((f) => f.id) ?? []), 'quote-x']),
          reason(),
          person(),
          role(),
        ],
      ];
    },
    () => ['submitOrder', [order(), person(), role()]],
    () => [
      'decideOrder',
      [
        order(),
        pick(g, ['approve', 'approve', 'return', 'reject', 'bad']),
        reason(),
        person(),
        role(),
      ],
    ],
    () => ['reviseOrder', [order(), reason(), person(), role()]],
    () => ['cancelOrder', [order(), reason(), person(), role()]],
    () => [
      'markOrdered',
      [
        order(),
        { reference: pick(g, ['PO-' + n, '']), person: person(), checked: g() < 0.9 },
        role(),
      ],
    ],
    () => {
      const id = order();
      const draft = s.receipts.find((r) => r.orderId === id && r.status === 'draft');
      return [
        'saveReceipt',
        [
          id,
          {
            id: pick(g, [undefined, draft?.id]),
            reference: pick(g, ['DEMO-DEL-1', 'DEL-' + n, '', 'del-' + n]),
            accepted: pick(g, [1, 2, 4, '0', 10, 100]),
            rejected: pick(g, [0, 0, 1, '']),
            issueType: pick(g, ['none', 'damaged', 'short', 'bad']),
            note: pick(g, ['ตรวจแล้ว', '']),
            person: person(),
          },
          role(),
        ],
      ];
    },
    () => [
      'confirmReceipt',
      [receipt(), { person: person(), checked: g() < 0.9, notCounted: g() < 0.9 }, role()],
    ],
    () => ['cancelReceipt', [receipt(), reason(), person(), role()]],
    () => ['resolveReceiptIssue', [receipt(), reason(), person(), role()]],
    () => [
      'closeReceiving',
      [
        order(),
        { person: person(), reason: reason(), checked: g() < 0.9, closeShort: g() < 0.7 },
        role(),
      ],
    ],
    () => [
      'saveExpenseReviewer',
      [
        {
          name: pick(g, ['เจ้าของตัวอย่าง', 'ผู้จัดการตัวอย่าง', '']),
          role: pick(g, ['owner', 'manager', 'staff']),
          note: 'ผู้ตรวจ',
          person: person(),
          checked: g() < 0.9,
        },
        role(),
      ],
    ],
    () => [
      'saveExpense',
      [
        {
          id: pick(g, [undefined, undefined, exp()]),
          vendor: pick(g, ['ร้านเส้นตัวอย่าง', 'ร้าน ' + n, '']),
          date: pick(g, [D.reportDay(Date.now()), '2026-02-30', '2099-01-01', '2026-10-01']),
          reference: pick(g, ['', 'BILL-' + n, 'DEMO-BILL-1']),
          amount: pick(g, ['500', '30', '0', '12.345', 'abc', 99]),
          currency: pick(g, ['THB', 'USD', 'EUR']),
          category: pick(g, ['วัตถุดิบ', 'อื่น ๆ', 'bad']),
          funding: pick(g, ['shop', 'personal', 'bad']),
          payer: person(),
          orderId: pick(g, ['', '', order()]),
          note: pick(g, ['บิล', '']),
          person: person(),
          attachment: pick(g, [undefined, null, demoProof, { ...demoProof, size: 1 }]),
          noEvidenceReason: pick(g, ['', 'ไม่มีบิล']),
        },
        role(),
      ],
    ],
    () => ['submitExpense', [exp(), person(), role()]],
    () => [
      'reviewExpense',
      [
        exp(),
        {
          action: pick(g, ['confirm', 'confirm', 'return', 'bad']),
          person: pick(g, ['เจ้าของตัวอย่าง', 'ผู้จัดการตัวอย่าง']),
          note: reason(),
          checked: g() < 0.9,
          exceptionsChecked: g() < 0.8,
        },
        role(),
      ],
    ],
    () => ['cancelExpense', [exp(), { person: person(), note: reason() }, role()]],
  ];
  return pick(g, choices)();
}

/**
 * Guided step: a *valid* next action for some open document, so fuzzing reaches deep
 * lifecycle states (approved, ordered, received, closed, confirmed bills) and not only rejections.
 */
function guided(g: Gen, s: ShopState, n: number): [string, unknown[]] | null {
  const OWNER = 'เจ้าของตัวอย่าง',
    MANAGER = 'ผู้จัดการตัวอย่าง',
    STAFF = 'พนักงานตัวอย่าง';
  const open = s.countRounds.find((r) => r.status === 'draft' || r.status === 'review');
  const rows = D.stockRows(s);
  const live = (rid: string) =>
    s.purchaseOrders.some(
      (o) => o.requestId === rid && !['cancelled', 'rejected'].includes(o.status),
    );
  const candidates: Array<() => [string, unknown[]] | null> = [
    () => {
      if (!open || open.status !== 'draft') return null;
      if (open.lines.some((l) => l.qty === null) || g() < 0.3)
        return [
          'saveCount',
          [
            open.id,
            open.lines.map((l) => ({
              ingredientId: l.ingredientId,
              qty: Math.floor(g() * 16),
              reason: 'นับใหม่',
            })),
            STAFF,
            'staff',
          ],
        ];
      return ['submitCount', [open.id, STAFF, 'staff']];
    },
    () =>
      open?.status === 'review'
        ? g() < 0.15
          ? ['returnCount', [open.id, 'ตรวจอีกครั้ง', MANAGER, 'manager']]
          : ['confirmCount', [open.id, MANAGER, 'manager']]
        : null,
    () => (!open && g() < 0.08 ? ['startCount', ['รอบ ' + n, STAFF, 'staff']] : null),
    () =>
      !s.purchasePolicy
        ? [
            'savePurchasePolicy',
            [
              {
                currency: 'THB',
                mode: pick(g, ['all', 'above']),
                threshold: '100',
                approver: OWNER,
                approverRole: 'owner',
                note: 'เกณฑ์',
                person: OWNER,
                checked: true,
              },
              'owner',
            ],
          ]
        : null,
    () =>
      !s.expenseReviewer
        ? [
            'saveExpenseReviewer',
            [
              { name: OWNER, role: 'owner', note: 'ผู้ตรวจ', person: OWNER, checked: true },
              'owner',
            ],
          ]
        : null,
    () => {
      const r = rows.find((r) => r.base && !s.stockPolicies.some((p) => p.ingredientId === r.id));
      return r
        ? [
            'savePolicy',
            [
              { ingredientId: r.id, minimum: 5, target: 12, enabled: true, person: MANAGER },
              'manager',
            ],
          ]
        : null;
    },
    () => {
      const r = rows.find(
        (r) =>
          r.low &&
          !s.purchaseRequests.some(
            (p) => p.ingredientId === r.id && ['draft', 'ready'].includes(p.status),
          ),
      );
      return r ? ['createRequest', [r.id, STAFF, 'staff']] : null;
    },
    () => {
      const p = s.purchaseRequests.find((p) => p.status === 'draft');
      return p
        ? [
            'reviewRequest',
            [p.id, { qty: p.suggested, reason: '', person: MANAGER, checked: true }, 'manager'],
          ]
        : null;
    },
    () => {
      const p = s.purchaseRequests.find((p) => p.status === 'ready' && !live(p.id));
      return p ? ['createOrder', [p.id, 'THB', MANAGER, 'manager']] : null;
    },
    () => {
      const o = s.purchaseOrders.find((o) => o.status === 'draft' || o.status === 'returned');
      if (!o) return null;
      if (D.orderSourceStale(s, o) && g() < 0.5)
        return [
          'reviewOrderSource',
          [o.id, { qty: o.qty, person: MANAGER, reason: 'ทบทวนยอด', checked: true }, 'manager'],
        ];
      if (!o.offers.length || g() < 0.2)
        return [
          'saveOffer',
          [
            o.id,
            {
              vendor: 'ร้าน ' + n,
              packQty: pick(g, [1, 2, '0.5']),
              packPrice: pick(g, ['50', '3', '12.5']),
              shipping: '0',
              extra: '0',
              discount: '0',
              source: 'LINE',
              conditions: 'ไม่มี',
              quotedAt: new Date().toISOString(),
              person: MANAGER,
            },
            'manager',
          ],
        ];
      if (!o.selectedId)
        return ['selectOffer', [o.id, o.offers[0]!.id, 'ราคาดี', MANAGER, 'manager']];
      return ['submitOrder', [o.id, MANAGER, 'manager']];
    },
    () => {
      const o = s.purchaseOrders.find((o) => o.status === 'pending');
      const p = s.purchasePolicy;
      if (!o || !p) return null;
      return [
        'decideOrder',
        [o.id, g() < 0.85 ? 'approve' : 'return', 'พิจารณาแล้ว', p.approver, p.approverRole],
      ];
    },
    () => {
      const o = s.purchaseOrders.find((o) => o.status === 'approved' || o.status === 'cleared');
      if (!o) return null;
      return g() < 0.1
        ? ['reviseOrder', [o.id, 'ขอแก้', MANAGER, 'manager']]
        : [
            'markOrdered',
            [o.id, { reference: 'PO-' + n, person: MANAGER, checked: true }, 'manager'],
          ];
    },
    () => {
      const o = s.purchaseOrders.find(
        (o) => o.status === 'ordered' && o.receiving?.status !== 'closed',
      );
      if (!o) return null;
      const v = D.receivingSummary(s, o);
      if (v.draft)
        return [
          'confirmReceipt',
          [v.draft.id, { person: MANAGER, checked: true, notCounted: true }, 'manager'],
        ];
      if (v.issues.length)
        return ['resolveReceiptIssue', [v.issues[0]!.id, 'ผู้ขายส่งทดแทนแล้ว', MANAGER, 'manager']];
      if (v.remaining > 0 && g() < 0.8) {
        const accepted = Math.min(v.remaining, 1 + Math.floor(g() * 4));
        const rejected = g() < 0.3 && accepted < v.remaining ? 1 : 0;
        return [
          'saveReceipt',
          [
            o.id,
            {
              reference: 'DEL-' + n,
              accepted,
              rejected,
              issueType: rejected ? 'damaged' : 'none',
              note: 'ตรวจแล้ว',
              person: STAFF,
            },
            'staff',
          ],
        ];
      }
      return [
        'closeReceiving',
        [o.id, { person: MANAGER, reason: 'ปิดงาน', checked: true, closeShort: true }, 'manager'],
      ];
    },
    () => {
      const r = s.receipts.find((r) => r.status === 'confirmed');
      return r && g() < 0.15 ? ['cancelReceipt', [r.id, 'บันทึกผิด', MANAGER, 'manager']] : null;
    },
    () => {
      const r = rows.find((r) => r.active && r.base && !r.check && r.movements.length);
      return r ? ['reviewLedger', [r.id, 'ตรวจครบ', MANAGER, true, 'manager']] : null;
    },
    () => {
      const r = rows.find((r) => r.active && r.base && (r.ledger ?? 0) >= 1);
      return r && g() < 0.4
        ? [
            'addMovement',
            [
              {
                ingredientId: r.id,
                kind: pick(g, ['use', 'waste', 'increase']),
                qty: 1,
                person: MANAGER,
                reason: 'ใช้',
                reference: '',
              },
              'manager',
            ],
          ]
        : null;
    },
    () => {
      const m = s.movements.find(
        (m) =>
          m.kind !== 'reverse' && !m.receiptId && !s.movements.some((x) => x.reverseOf === m.id),
      );
      return m && g() < 0.15 ? ['reverseMovement', [m.id, 'บันทึกผิด', MANAGER, 'manager']] : null;
    },
    () => {
      const e = s.expenses.find((e) => e.status === 'draft' || e.status === 'returned');
      if (e) return ['submitExpense', [e.id, MANAGER, 'manager']];
      const o = pick(
        g,
        s.purchaseOrders.filter((o) => o.status === 'ordered'),
      );
      return [
        'saveExpense',
        [
          {
            vendor: 'ร้าน ' + n,
            date: D.reportDay(Date.now()),
            reference: 'BILL-' + n,
            amount: o ? String(o.purchase!.total / 100) : '120',
            currency: 'THB',
            category: 'วัตถุดิบ',
            funding: 'shop',
            payer: MANAGER,
            orderId: o?.id ?? '',
            note: 'บิล',
            person: MANAGER,
            attachment: null,
            noEvidenceReason: 'ไม่มีบิล',
          },
          'manager',
        ],
      ];
    },
    () => {
      const e = s.expenses.find((e) => e.status === 'pending');
      const r = s.expenseReviewer;
      if (!e || !r) return null;
      return [
        'reviewExpense',
        [
          e.id,
          {
            action: g() < 0.8 ? 'confirm' : 'return',
            person: r.name,
            note: 'ตรวจแล้ว',
            checked: true,
            exceptionsChecked: true,
          },
          r.role,
        ],
      ];
    },
  ];
  // Try candidates in a random order and take the first that applies.
  const order = candidates.map((c) => [g(), c] as const).sort((a, b) => a[0] - b[0]);
  for (const [, c] of order) {
    const step = c();
    if (step) return step;
  }
  return null;
}

const succeeded = new Set<string>();

describe('differential fuzzing against the legacy prototype', () => {
  const runs: Array<[string, () => ShopState, number]> = [
    ['from demo state', () => legacyDemo.seed(), 1],
    ['from demo state', () => legacyDemo.seed(), 2],
    ['from fresh seed', () => legacy.seed(), 3],
    ['from fresh seed', () => legacy.seed(), 4],
    ['from demo state', () => legacyDemo.seed(), 5],
    ['from demo state', () => legacyDemo.seed(), 6],
  ];
  for (const [label, start, seed] of runs)
    it(`${label} (seed ${seed}): 600 random operations agree`, () => {
      const g = mulberry32(seed * 7919);
      let time = T0;
      let s = (pinned(start, time, seed) as { value: ShopState }).value;
      const stats = { ok: 0, err: 0 };
      for (let n = 0; n < 600; n++) {
        time += 61_000 + Math.floor(g() * 3_600_000);
        vi.setSystemTime(time);
        const [name, args] = (g() < 0.6 && guided(g, s, n)) || ops(g, s, n);
        const rnd = Math.floor(g() * 1e9);
        const a = pinned(
          () => legacy[name](structuredClone(s), ...structuredClone(args)),
          time,
          rnd,
        );
        const b = pinned(
          () =>
            (D as unknown as Record<string, (...x: unknown[]) => ShopState>)[name]!(
              structuredClone(s),
              ...structuredClone(args),
            ),
          time,
          rnd,
        );
        expectSame(a, b, `step ${n} ${name} ${JSON.stringify(args).slice(0, 300)}`);
        if (a.ok) {
          s = a.value as ShopState;
          stats.ok++;
          succeeded.add(name);
        } else stats.err++;
        if (n % 50 === 49)
          expectSame(
            pinned(() => legacyQueries(s), time, 1),
            pinned(() => queries(s), time, 1),
            `queries after step ${n}`,
          );
      }
      // The fuzzer must actually exercise successful transitions, not only rejections.
      expect(stats.ok).toBeGreaterThan(60);
      console.info(
        `${label} seed ${seed}: ${stats.ok} accepted / ${stats.err} rejected — identical`,
      );
    }, 120_000);

  it('exercised successful transitions of every mutating operation', () => {
    const all = Object.keys(legacy).filter(
      (k) =>
        typeof legacy[k] === 'function' &&
        D[k as keyof typeof D] &&
        !/^(seed|validate|migrate|can)$|^(report|parse|quote|latest|stock|receiving|expense(Dup|War|Tot)|order|needs|has|workflow)/.test(
          k,
        ),
    );
    const missing = all.filter((k) => !succeeded.has(k));
    console.info(
      `fuzz coverage: ${succeeded.size}/${all.length} operations succeeded; missing: ${missing.join(', ') || 'none'}`,
    );
    expect(all.length).toBe(37);
    expect(missing).toEqual([]);
  });
});
