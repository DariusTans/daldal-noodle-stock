import { useState } from 'react';
import {
  hasOpenCount,
  latestCounts,
  movementKinds,
  stockRows,
  type MovementKind,
  type StockRow,
} from '@/domain';
import { fmtDateTime, fmtQty } from '../lib/format';
import { useShop } from '../state';
import {
  Badge,
  Button,
  Card,
  Check,
  Empty,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
} from '../ui';
import { ActionButton, ActionDialog, bool, DialogButton, opt, StatusBadge, str } from './common';

function CountLock() {
  const { state } = useShop();
  return hasOpenCount(state) ? (
    <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
      มีรอบนับค้างอยู่ ระบบพักการบันทึกเคลื่อนไหวและเสนอซื้อจนกว่าจะยืนยันหรือยกเลิกรอบนับ
    </p>
  ) : null;
}

// ── Latest counts ──
export function LatestPage() {
  const { state } = useShop();
  const latest = latestCounts(state);
  return (
    <>
      <PageHeader
        eyebrow="สต็อก"
        title="ยอดนับล่าสุด"
        sub="ยอดจากรอบนับที่ยืนยันล่าสุดของแต่ละวัตถุดิบ"
      />
      <Card>
        <Table
          head={['วัตถุดิบ', 'ยอดนับ', 'นับเมื่อ', 'รอบ', 'ยืนยันโดย']}
          empty="ยังไม่มีรอบนับที่ยืนยัน"
        >
          {latest.map((l) => (
            <tr key={l.ingredientId}>
              <Td>
                {l.name}
                <span className="block text-xs text-stone-500">{l.code}</span>
              </Td>
              <Td className="font-semibold">{fmtQty(l.qty, l.unitSymbol)}</Td>
              <Td>{fmtDateTime(l.countedAt)}</Td>
              <Td>{l.roundTitle}</Td>
              <Td>
                {l.confirmedBy}
                <span className="block text-xs text-stone-500">{fmtDateTime(l.confirmedAt)}</span>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

// ── Movements / completeness ──
export function MovementsPage() {
  const { state, can } = useShop();
  const rows = stockRows(state).filter((r) => r.active || r.movements.length);
  const reversed = new Set(state.movements.map((m) => m.reverseOf).filter(Boolean));
  const recent = [...state.movements].reverse().slice(0, 50);
  const [checking, setChecking] = useState<StockRow | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="สต็อก"
        title="เคลื่อนไหว / ตรวจครบ"
        sub="ยอดคำนวณ = ยอดนับยืนยัน + เคลื่อนไหวหลังนับ · ยอดอ้างอิงจะใช้ยอดคำนวณเมื่อผู้จัดการรับรองว่าบันทึกครบแล้วเท่านั้น"
        actions={
          can('movement') && (
            <DialogButton label="+ บันทึกเคลื่อนไหว" variant="primary">
              {(close, open) => <MovementForm open={open} onClose={close} />}
            </DialogButton>
          )
        }
      />
      <CountLock />
      <Card title="ยอดปัจจุบัน">
        <Table
          head={['วัตถุดิบ', 'ยอดนับ', 'เคลื่อนไหว', 'ยอดคำนวณ', 'ยอดอ้างอิง', 'สถานะ', '']}
          empty="ยังไม่มีวัตถุดิบ"
        >
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td>{fmtQty(r.base?.qty, r.unit.symbol)}</Td>
              <Td>
                {r.movements.length
                  ? `${r.net > 0 ? '+' : ''}${fmtQty(r.net)} (${r.movements.length})`
                  : '—'}
              </Td>
              <Td>{fmtQty(r.ledger, r.unit.symbol)}</Td>
              <Td className="font-semibold">{fmtQty(r.referenceQty, r.unit.symbol)}</Td>
              <Td>
                {!r.base ? (
                  <Badge>ยังไม่นับ</Badge>
                ) : r.check ? (
                  <Badge tone="success">ตรวจครบแล้ว</Badge>
                ) : r.movements.length ? (
                  <Badge tone="warning">รอตรวจความครบ</Badge>
                ) : (
                  <Badge tone="info">ใช้ยอดนับ</Badge>
                )}
              </Td>
              <Td className="text-right">
                {can('stockReview') && r.base && r.active && (
                  <Button size="sm" onClick={() => setChecking(r)}>
                    ตรวจครบ
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="รายการเคลื่อนไหวล่าสุด" className="mt-4">
        <Table
          head={['เวลา', 'วัตถุดิบ', 'ประเภท', 'จำนวน', 'เหตุผล / อ้างอิง', 'ผู้บันทึก', '']}
          empty="ยังไม่มีรายการ"
        >
          {recent.map((m) => (
            <tr key={m.id}>
              <Td className="whitespace-nowrap">{fmtDateTime(m.at)}</Td>
              <Td>{m.name}</Td>
              <Td>
                <Badge tone={m.delta > 0 ? 'success' : 'neutral'}>{movementKinds[m.kind]}</Badge>
              </Td>
              <Td className="whitespace-nowrap">
                {m.delta > 0 ? '+' : ''}
                {fmtQty(m.delta, m.unitSymbol)}
              </Td>
              <Td>
                {m.reason}
                {m.reference && <span className="block text-xs text-stone-500">{m.reference}</span>}
              </Td>
              <Td>{m.person}</Td>
              <Td className="text-right">
                {can('adjust') && m.kind !== 'reverse' && !m.receiptId && !reversed.has(m.id) && (
                  <DialogButton label="กลับรายการ" size="sm">
                    {(close, open) => (
                      <ActionDialog
                        open={open}
                        onClose={close}
                        title="กลับรายการ (บันทึกรายการหักล้าง ไม่ลบประวัติ)"
                        submitLabel="กลับรายการ"
                        submit={(f, run) =>
                          run(
                            'reverseMovement',
                            { movementId: m.id, reason: str(f, 'reason') },
                            'กลับรายการแล้ว',
                          )
                        }
                      >
                        <p className="text-sm">
                          {m.name} · {movementKinds[m.kind]} {fmtQty(m.qty, m.unitSymbol)}
                        </p>
                        <Textarea label="เหตุผล" name="reason" required maxLength={500} />
                      </ActionDialog>
                    )}
                  </DialogButton>
                )}
                {m.receiptId && <span className="text-xs text-stone-500">จากตรวจรับ</span>}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {checking && (
        <ActionDialog
          open
          onClose={() => setChecking(null)}
          title={'ตรวจความครบ: ' + checking.name}
          submitLabel="รับรองว่าครบ"
          submit={(f, run) =>
            run(
              'reviewLedger',
              { ingredientId: checking.id, note: str(f, 'note'), complete: bool(f, 'complete') },
              'บันทึกการตรวจแล้ว',
            )
          }
        >
          <p className="text-sm text-stone-700">
            ยอดนับ {fmtQty(checking.base?.qty, checking.unit.symbol)} + เคลื่อนไหว{' '}
            {checking.movements.length} รายการ = ยอดคำนวณ{' '}
            <b>{fmtQty(checking.ledger, checking.unit.symbol)}</b>
          </p>
          <Textarea label="ขอบเขต / หลักฐานที่ตรวจ" name="note" required maxLength={500} />
          <Check
            name="complete"
            label="ตรวจแล้วว่ารับเข้า เบิกใช้ ของเสีย และปรับยอดครบทุกรายการ"
          />
        </ActionDialog>
      )}
    </>
  );
}

function MovementForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, can } = useShop();
  const kinds = (Object.keys(movementKinds) as MovementKind[]).filter(
    (k) => k !== 'reverse' && (can('adjust') || !['increase', 'decrease'].includes(k)),
  );
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title="บันทึกเคลื่อนไหว"
      submit={(f, run) =>
        run(
          'addMovement',
          {
            ingredientId: str(f, 'ingredientId'),
            kind: str(f, 'kind'),
            qty: str(f, 'qty'),
            reason: str(f, 'reason'),
            reference: opt(f, 'reference'),
          },
          'บันทึกแล้ว',
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="วัตถุดิบ"
          name="ingredientId"
          options={state.ingredients.filter((i) => i.active).map((i) => [i.id, i.name])}
        />
        <Select label="ประเภท" name="kind" options={kinds.map((k) => [k, movementKinds[k]])} />
        <Input label="จำนวน" name="qty" required inputMode="decimal" />
        <Input label="เลขอ้างอิง (ถ้ามี)" name="reference" maxLength={100} />
      </div>
      <Textarea label="เหตุผล / รายละเอียด" name="reason" required maxLength={500} />
      <p className="text-xs text-stone-500">
        ของที่มาจากใบซื้อ ให้บันทึกที่หน้าตรวจรับ เพื่อไม่ให้ลงยอดซ้ำ
      </p>
    </ActionDialog>
  );
}

// ── Alerts / purchase requests ──
export function AlertsPage() {
  const { state, can } = useShop();
  const rows = stockRows(state).filter((r) => r.active);
  const openReq = (id: string) =>
    state.purchaseRequests.find(
      (p) => p.ingredientId === id && (p.status === 'draft' || p.status === 'ready'),
    );
  const low = rows.filter((r) => r.low);
  const requests = [...state.purchaseRequests].reverse();
  const [policyFor, setPolicyFor] = useState<StockRow | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="สต็อก"
        title="เตือนซื้อ / เสนอซื้อ"
        sub="เตือนเมื่อยอดอ้างอิง ≤ จุดเตือน · จำนวนเสนอ = ยอดเป้าหมาย − ยอดอ้างอิง · ตรวจแล้ว (ready) ยังไม่ใช่การอนุมัติซื้อ"
      />
      <CountLock />
      <Card title={`เข้าเกณฑ์เตือน (${low.length})`}>
        {low.length ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {low.map((r) => {
              const p = openReq(r.id);
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-amber-200"
                >
                  <span>
                    <b>{r.name}</b> · อ้างอิง {fmtQty(r.referenceQty, r.unit.symbol)} (จุดเตือน{' '}
                    {fmtQty(r.policy?.minimum)})
                    <span className="block text-xs text-stone-500">
                      เสนอ {fmtQty(r.suggested, r.unit.symbol)}
                    </span>
                  </span>
                  {p ? (
                    <StatusBadge status={p.status} />
                  ) : (
                    can('request') && (
                      <ActionButton
                        type="createRequest"
                        payload={{ ingredientId: r.id }}
                        success="ร่างรายการเสนอซื้อแล้ว"
                        variant="primary"
                      >
                        เสนอซื้อ
                      </ActionButton>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>ไม่มีรายการต่ำกว่าจุดเตือน</Empty>
        )}
      </Card>

      <Card title="รายการเสนอซื้อ" className="mt-4">
        <Table
          head={['วัตถุดิบ', 'อ้างอิง', 'จำนวน', 'สถานะ', 'ผู้เสนอ / ผู้ตรวจ', '']}
          empty="ยังไม่มีรายการ"
        >
          {requests.map((p) => (
            <tr key={p.id}>
              <Td>{p.name}</Td>
              <Td>
                {fmtQty(p.referenceQty, p.unitSymbol)}
                <span className="block text-xs text-stone-500">
                  {p.referenceBasis === 'ledger' ? 'ยอดคำนวณที่ตรวจแล้ว' : 'ยอดนับ'}
                </span>
              </Td>
              <Td>
                {fmtQty(p.qty, p.unitSymbol)}
                {p.reason && <span className="block text-xs text-stone-500">{p.reason}</span>}
              </Td>
              <Td>
                <StatusBadge status={p.status} />
              </Td>
              <Td>
                {p.person}
                {p.reviewedBy && (
                  <span className="block text-xs text-stone-500">ตรวจ: {p.reviewedBy}</span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-right">
                <span className="inline-flex flex-wrap justify-end gap-1">
                  {p.status === 'draft' && can('requestReview') && (
                    <DialogButton label="ตรวจจำนวน" size="sm" variant="primary">
                      {(close, open) => (
                        <ActionDialog
                          open={open}
                          onClose={close}
                          title={'ตรวจรายการเสนอซื้อ: ' + p.name}
                          submitLabel="ยืนยันจำนวน"
                          submit={(f, run) =>
                            run(
                              'reviewRequest',
                              {
                                requestId: p.id,
                                qty: str(f, 'qty'),
                                reason: opt(f, 'reason'),
                                checked: bool(f, 'checked'),
                              },
                              'ตรวจแล้ว รอรอบจัดซื้อ',
                            )
                          }
                        >
                          <p className="text-sm">
                            ยอดอ้างอิง {fmtQty(p.referenceQty, p.unitSymbol)} · เสนอ{' '}
                            {fmtQty(p.suggested, p.unitSymbol)}
                          </p>
                          <Input
                            label="จำนวนที่ต้องการซื้อ"
                            name="qty"
                            defaultValue={p.qty}
                            required
                            inputMode="decimal"
                          />
                          <Textarea
                            label="เหตุผล (จำเป็นเมื่อจำนวนต่างจากที่เสนอ)"
                            name="reason"
                            maxLength={500}
                          />
                          <Check name="checked" label="ตรวจยอดอ้างอิงและจำนวนซื้อแล้ว" />
                        </ActionDialog>
                      )}
                    </DialogButton>
                  )}
                  {p.status === 'draft' && can('request') && (
                    <ActionButton
                      type="refreshRequest"
                      payload={{ requestId: p.id }}
                      success="อัปเดตตามยอดล่าสุดแล้ว"
                    >
                      อัปเดตยอด
                    </ActionButton>
                  )}
                  {(p.status === 'draft' || p.status === 'ready') && can('requestReview') && (
                    <DialogButton label="ยกเลิก" size="sm" variant="danger">
                      {(close, open) => (
                        <ActionDialog
                          open={open}
                          onClose={close}
                          danger
                          title="ยกเลิกรายการเสนอซื้อ"
                          submitLabel="ยกเลิกรายการ"
                          submit={(f, run) =>
                            run(
                              'cancelRequest',
                              { requestId: p.id, reason: str(f, 'reason') },
                              'ยกเลิกแล้ว',
                            )
                          }
                        >
                          <Textarea label="เหตุผล" name="reason" required maxLength={500} />
                        </ActionDialog>
                      )}
                    </DialogButton>
                  )}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="จุดเตือนและยอดเป้าหมาย" className="mt-4">
        <Table head={['วัตถุดิบ', 'ยอดอ้างอิง', 'จุดเตือน', 'เป้าหมาย', 'เปิดเตือน', '']}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>{r.name}</Td>
              <Td>{fmtQty(r.referenceQty, r.unit.symbol)}</Td>
              <Td>{fmtQty(r.policy?.minimum)}</Td>
              <Td>{fmtQty(r.policy?.target)}</Td>
              <Td>
                {r.policy ? (
                  r.policy.enabled ? (
                    <Badge tone="success">เปิด</Badge>
                  ) : (
                    <Badge>ปิด</Badge>
                  )
                ) : (
                  '—'
                )}
              </Td>
              <Td className="text-right">
                {can('policy') && (
                  <Button size="sm" onClick={() => setPolicyFor(r)}>
                    ตั้งค่า
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {policyFor && (
        <ActionDialog
          open
          onClose={() => setPolicyFor(null)}
          title={'จุดเตือน: ' + policyFor.name}
          submit={(f, run) =>
            run(
              'savePolicy',
              {
                ingredientId: policyFor.id,
                minimum: str(f, 'minimum'),
                target: str(f, 'target'),
                enabled: bool(f, 'enabled'),
              },
              'บันทึกจุดเตือนแล้ว',
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label={`จุดเตือน (${policyFor.unit.symbol})`}
              name="minimum"
              defaultValue={policyFor.policy?.minimum ?? ''}
              required
              inputMode="decimal"
            />
            <Input
              label={`ยอดเป้าหมาย (${policyFor.unit.symbol})`}
              name="target"
              defaultValue={policyFor.policy?.target ?? ''}
              required
              inputMode="decimal"
            />
          </div>
          <Check
            name="enabled"
            defaultChecked={policyFor.policy?.enabled ?? true}
            label="เปิดการเตือน"
          />
        </ActionDialog>
      )}
    </>
  );
}
