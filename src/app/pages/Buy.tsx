import { useState } from 'react';
import { Link } from 'react-router';
import {
  currencies,
  hasOpenCount,
  needsApproval,
  orderPolicyStale,
  orderSourceStale,
  quoteTotal,
  receivingLabel,
  type Offer,
  type PurchaseOrder,
} from '@/domain';
import {
  fmtDateTime,
  fmtMoney,
  fmtQty,
  localInputToIso,
  moneyInput,
  nowLocalInput,
  roleName,
} from '../lib/format';
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
import { ActionButton, ActionDialog, bool, DialogButton, StatusBadge, str } from './common';

export function BuyPage() {
  const { state, shopId } = useShop();
  const [showClosed, setShowClosed] = useState(false);
  const live = (rid: string) =>
    state.purchaseOrders.some(
      (o) => o.requestId === rid && o.status !== 'cancelled' && o.status !== 'rejected',
    );
  const ready = state.purchaseRequests.filter((p) => p.status === 'ready' && !live(p.id));
  const closed = (o: PurchaseOrder) =>
    o.status === 'cancelled' ||
    o.status === 'rejected' ||
    (o.status === 'ordered' && o.receiving?.status === 'closed');
  const orders = [...state.purchaseOrders].reverse().filter((o) => showClosed || !closed(o));
  const policy = state.purchasePolicy;

  return (
    <>
      <PageHeader
        eyebrow="จัดซื้อ"
        title="จัดซื้อและอนุมัติ"
        sub="เทียบทางเลือก → เลือกแหล่งซื้อ → ส่งพิจารณา → บันทึกซื้อ · ราคา จำนวน หรือต้นทางเปลี่ยนต้องพิจารณาใหม่ · บันทึกซื้อยังไม่เพิ่มสต็อกและไม่ใช่ค่าใช้จ่าย"
      />
      {!policy ? (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ยังไม่ตั้งเกณฑ์และผู้อนุมัติ —{' '}
          <Link className="underline" to={`/s/${shopId}/settings`}>
            ไปตั้งค่า
          </Link>
        </p>
      ) : (
        <p className="mb-4 text-sm text-stone-600">
          เกณฑ์:{' '}
          {policy.mode === 'all'
            ? 'พิจารณาทุกรายการ'
            : `พิจารณาเมื่อเกิน ${fmtMoney(policy.threshold, policy.currency)}`}{' '}
          · ผู้อนุมัติ{' '}
          <b>
            {policy.approver} ({roleName(policy.approverRole)})
          </b>
        </p>
      )}
      {hasOpenCount(state) && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          มีรอบนับค้าง ต้องจบรอบนับก่อนดำเนินการจัดซื้อ
        </p>
      )}

      <Card title={`รายการตรวจแล้ว รอเปิดใบจัดซื้อ (${ready.length})`}>
        {ready.length ? (
          <ul className="flex flex-col gap-2">
            {ready.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1 ring-stone-200"
              >
                <span>
                  <b>{p.name}</b> · {fmtQty(p.qty, p.unitSymbol)}
                  <span className="block text-xs text-stone-500">ตรวจโดย {p.reviewedBy}</span>
                </span>
                <DialogButton label="เปิดใบจัดซื้อ" variant="primary" size="sm">
                  {(close, open) => (
                    <ActionDialog
                      open={open}
                      onClose={close}
                      title={'เปิดใบจัดซื้อ: ' + p.name}
                      submitLabel="เปิดใบ"
                      submit={(f, run) =>
                        run(
                          'createOrder',
                          { requestId: p.id, currency: str(f, 'currency') as 'THB' },
                          'เปิดใบจัดซื้อแล้ว',
                        )
                      }
                    >
                      <Select
                        label="สกุลเงิน (ไม่แปลงอัตโนมัติ)"
                        name="currency"
                        defaultValue={policy?.currency ?? 'THB'}
                        options={currencies.map((c) => [c, c])}
                      />
                    </ActionDialog>
                  )}
                </DialogButton>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>ไม่มีรายการรอเปิดใบ</Empty>
        )}
      </Card>

      <div className="mt-6 mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">ใบจัดซื้อ</h2>
        <Check
          label="แสดงรายการที่ปิดแล้ว"
          checked={showClosed}
          onChange={(e) => setShowClosed(e.target.checked)}
        />
      </div>
      <div className="flex flex-col gap-4">
        {orders.length ? (
          orders.map((o) => <OrderCard key={o.id} order={o} />)
        ) : (
          <Empty>ไม่มีใบจัดซื้อ</Empty>
        )}
      </div>
    </>
  );
}

function OrderCard({ order: o }: { order: PurchaseOrder }) {
  const { state, me } = useShop();
  const [editing, setEditing] = useState<Offer | 'new' | null>(null);
  const editable = o.status === 'draft' || o.status === 'returned';
  const stale = editable || o.status === 'pending' ? orderSourceStale(state, o) : false;
  const policy = state.purchasePolicy;
  const isApprover =
    !!policy && policy.approver === me.displayName && policy.approverRole === me.role;
  const selected = o.offers.find((f) => f.id === o.selectedId);
  const needs = needsApproval(state, o);
  const lastReturn = [...o.audit].reverse().find((a) => a.action === 'ส่งกลับแก้ไข');

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {o.name} · {fmtQty(o.qty, o.unitSymbol)} <StatusBadge status={o.status} />
          {o.status === 'ordered' && <Badge tone="info">{receivingLabel(state, o)}</Badge>}
        </span>
      }
      actions={
        <>
          {(o.status === 'pending' || o.status === 'approved' || o.status === 'cleared') && (
            <ReasonButton
              label="ถอนกลับแก้ไข"
              title="ถอนกลับแก้ไข (ต้องพิจารณาใหม่)"
              onSubmit={(reason, run) =>
                run('reviseOrder', { orderId: o.id, reason }, 'ถอนกลับแล้ว')
              }
            />
          )}
          {!['rejected', 'cancelled', 'ordered'].includes(o.status) && (
            <ReasonButton
              label="ยกเลิกใบ"
              danger
              title="ยกเลิกใบจัดซื้อ"
              onSubmit={(reason, run) =>
                run('cancelOrder', { orderId: o.id, reason }, 'ยกเลิกใบแล้ว')
              }
            />
          )}
        </>
      }
    >
      <p className="mb-3 text-xs text-stone-500">
        เปิดโดย {o.person} · {fmtDateTime(o.at)} · ต้นทางตรวจโดย {o.sourceCheckedBy}
      </p>
      {o.status === 'returned' && lastReturn && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ส่งกลับ: {String(lastReturn.reason ?? '')}
        </p>
      )}
      {stale && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ยอดต้นทางเปลี่ยนหลังตรวจ ต้องทบทวนยอดและจำนวนซื้อก่อนส่งพิจารณา
          {editable && (
            <DialogButton label="ทบทวนยอด" size="sm">
              {(close, open) => (
                <ActionDialog
                  open={open}
                  onClose={close}
                  title="ทบทวนยอดและจำนวนซื้อ"
                  submit={(f, run) =>
                    run(
                      'reviewOrderSource',
                      {
                        orderId: o.id,
                        qty: str(f, 'qty'),
                        reason: str(f, 'reason'),
                        checked: bool(f, 'checked'),
                      },
                      'ทบทวนแล้ว',
                    )
                  }
                >
                  <Input
                    label="จำนวนที่ยังต้องซื้อ"
                    name="qty"
                    defaultValue={o.qty}
                    required
                    inputMode="decimal"
                  />
                  <Textarea label="เหตุผลและสิ่งที่ตรวจ" name="reason" required maxLength={500} />
                  <Check name="checked" label="ตรวจยอดจริงและจำนวนที่ยังต้องซื้อแล้ว" />
                </ActionDialog>
              )}
            </DialogButton>
          )}
        </div>
      )}

      <Table
        head={['แหล่งซื้อ', 'ขนาดแพ็ก / ราคา', 'จำนวนแพ็ก', 'ยอดรวม', 'ต่อหน่วย', '']}
        empty="ยังไม่มีทางเลือกซื้อ"
      >
        {o.offers.map((f) => {
          const t = quoteTotal(o, f);
          return (
            <tr key={f.id} className={f.id === o.selectedId ? 'bg-orange-50' : ''}>
              <Td>
                {f.vendor} {f.id === o.selectedId && <Badge tone="success">เลือกแล้ว</Badge>}
                <span className="block text-xs text-stone-500">
                  {f.source} · {f.conditions} · ราคา ณ {fmtDateTime(f.quotedAt)}
                </span>
              </Td>
              <Td>
                {fmtQty(f.packQty, o.unitSymbol)} / {fmtMoney(f.packPrice, o.currency)}
                {(f.shipping || f.extra || f.discount) > 0 && (
                  <span className="block text-xs text-stone-500">
                    ส่ง {fmtMoney(f.shipping, o.currency)} · อื่น {fmtMoney(f.extra, o.currency)} ·
                    ลด {fmtMoney(f.discount, o.currency)}
                  </span>
                )}
              </Td>
              <Td>
                {t.packs} ({fmtQty(t.units, o.unitSymbol)})
              </Td>
              <Td className="font-semibold">{fmtMoney(t.total, o.currency)}</Td>
              <Td>{t.unitCost.toLocaleString('th-TH', { maximumFractionDigits: 2 })}</Td>
              <Td className="whitespace-nowrap text-right">
                {editable && (
                  <span className="inline-flex gap-1">
                    <Button size="sm" onClick={() => setEditing(f)}>
                      แก้ไข
                    </Button>
                    {f.id !== o.selectedId && (
                      <ReasonButton
                        label="เลือก"
                        title={'เลือก ' + f.vendor}
                        field="เหตุผลที่เลือก (แม้ราคาต่ำสุดก็ต้องระบุ)"
                        onSubmit={(reason, run) =>
                          run(
                            'selectOffer',
                            { orderId: o.id, offerId: f.id, reason },
                            'เลือกแหล่งซื้อแล้ว',
                          )
                        }
                      />
                    )}
                  </span>
                )}
              </Td>
            </tr>
          );
        })}
      </Table>

      {selected && (
        <p className="mt-2 text-sm text-stone-700">
          เลือก <b>{selected.vendor}</b>: {o.selectionReason}
          {needs !== null && (
            <> · {needs ? 'ต้องได้รับอนุมัติ' : 'ไม่เข้าเกณฑ์วงเงิน (ผู้พิจารณาตรวจผ่าน)'}</>
          )}
        </p>
      )}
      {o.decision && (
        <p className="mt-1 text-sm text-stone-700">
          ผลพิจารณา: {o.decision.type === 'approve' ? 'อนุมัติ' : 'ตรวจผ่าน'} โดย{' '}
          {o.decision.person} · {fmtMoney(o.decision.total, o.currency)} — {o.decision.reason}
        </p>
      )}
      {o.purchase && (
        <p className="mt-1 text-sm text-stone-700">
          บันทึกซื้อ {o.purchase.reference} โดย {o.purchase.person} · {fmtDateTime(o.purchase.at)} ·
          สั่ง {fmtQty(o.purchase.orderedQty, o.unitSymbol)} · รับแล้ว{' '}
          {fmtQty(o.purchase.receivedQty, o.unitSymbol)}
        </p>
      )}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {editable && (
          <>
            <Button onClick={() => setEditing('new')}>+ ทางเลือกซื้อ</Button>
            <ActionButton
              type="submitOrder"
              payload={{ orderId: o.id }}
              success="ส่งพิจารณาแล้ว"
              variant="primary"
              size="md"
              disabled={!o.selectedId}
            >
              ส่งพิจารณา
            </ActionButton>
          </>
        )}
        {o.status === 'pending' &&
          (isApprover ? (
            <DialogButton label="พิจารณา" variant="primary">
              {(close, open) => (
                <ActionDialog
                  open={open}
                  onClose={close}
                  title={'พิจารณา: ' + o.name}
                  submitLabel="บันทึกผลพิจารณา"
                  submit={(f, run) =>
                    run(
                      'decideOrder',
                      {
                        orderId: o.id,
                        decision: str(f, 'decision') as 'approve',
                        reason: str(f, 'reason'),
                      },
                      'บันทึกผลพิจารณาแล้ว',
                    )
                  }
                >
                  {selected && (
                    <p className="text-sm">
                      {selected.vendor} · {fmtMoney(quoteTotal(o, selected).total, o.currency)} ·{' '}
                      {fmtQty(o.qty, o.unitSymbol)}
                    </p>
                  )}
                  {orderPolicyStale(state, o) && (
                    <p className="text-sm text-red-700">
                      เกณฑ์เปลี่ยนหลังส่ง ต้องถอนกลับแล้วส่งใหม่
                    </p>
                  )}
                  <Select
                    label="ผล"
                    name="decision"
                    options={[
                      ['approve', 'ผ่าน / อนุมัติ'],
                      ['return', 'ส่งกลับแก้ไข'],
                      ['reject', 'ไม่อนุมัติ (ปิดใบ)'],
                    ]}
                  />
                  <Textarea label="เหตุผล" name="reason" required maxLength={500} />
                </ActionDialog>
              )}
            </DialogButton>
          ) : (
            <span className="text-sm text-stone-600">
              รอ {policy?.approver ?? 'ผู้อนุมัติ'} พิจารณา
            </span>
          ))}
        {(o.status === 'approved' || o.status === 'cleared') && (
          <DialogButton label="บันทึกว่าซื้อแล้ว" variant="primary">
            {(close, open) => (
              <ActionDialog
                open={open}
                onClose={close}
                title="บันทึกการซื้อภายนอก"
                submit={(f, run) =>
                  run(
                    'markOrdered',
                    { orderId: o.id, reference: str(f, 'reference'), checked: bool(f, 'checked') },
                    'บันทึกซื้อแล้ว รอตรวจรับ',
                  )
                }
              >
                <Input label="เลขคำสั่งซื้อ / หลักฐาน" name="reference" required maxLength={100} />
                <Check
                  name="checked"
                  label="ซื้อตามรายละเอียดที่ผ่านพิจารณาแล้ว (ยังไม่เพิ่มสต็อกจนกว่าจะตรวจรับ)"
                />
              </ActionDialog>
            )}
          </DialogButton>
        )}
      </div>
      {editing && (
        <OfferForm
          order={o}
          offer={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function OfferForm({
  order,
  offer,
  onClose,
}: {
  order: PurchaseOrder;
  offer?: Offer;
  onClose: () => void;
}) {
  return (
    <ActionDialog
      open
      wide
      onClose={onClose}
      title={offer ? 'แก้ไขทางเลือกซื้อ' : 'เพิ่มทางเลือกซื้อ'}
      submit={(f, run) =>
        run(
          'saveOffer',
          {
            orderId: order.id,
            offer: {
              id: offer?.id,
              vendor: str(f, 'vendor'),
              packQty: str(f, 'packQty'),
              packPrice: str(f, 'packPrice'),
              shipping: str(f, 'shipping') || '0',
              extra: str(f, 'extra') || '0',
              discount: str(f, 'discount') || '0',
              source: str(f, 'source'),
              conditions: str(f, 'conditions'),
              quotedAt: localInputToIso(str(f, 'quotedAt')),
            },
          },
          'บันทึกทางเลือกแล้ว',
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="แหล่งซื้อ / ร้านค้า"
          name="vendor"
          defaultValue={offer?.vendor}
          required
          maxLength={100}
        />
        <Input
          label="ตรวจราคาเมื่อ"
          name="quotedAt"
          type="datetime-local"
          defaultValue={nowLocalInput()}
          required
        />
        <Input
          label={`ขนาดแพ็ก (${order.unitSymbol})`}
          name="packQty"
          defaultValue={offer?.packQty ?? 1}
          required
          inputMode="decimal"
        />
        <Input
          label={`ราคาต่อแพ็ก (${order.currency})`}
          name="packPrice"
          defaultValue={offer ? moneyInput(offer.packPrice) : ''}
          required
          inputMode="decimal"
        />
        <Input
          label="ค่าส่ง"
          name="shipping"
          defaultValue={offer ? moneyInput(offer.shipping) : '0'}
          inputMode="decimal"
        />
        <Input
          label="ค่าใช้จ่ายอื่น"
          name="extra"
          defaultValue={offer ? moneyInput(offer.extra) : '0'}
          inputMode="decimal"
        />
        <Input
          label="ส่วนลด"
          name="discount"
          defaultValue={offer ? moneyInput(offer.discount) : '0'}
          inputMode="decimal"
        />
        <Input
          label="ที่มาราคา / เลขอ้างอิง"
          name="source"
          defaultValue={offer?.source}
          required
          maxLength={500}
        />
      </div>
      <Textarea
        label="เงื่อนไขราคา (หรือ “ไม่มีเงื่อนไข”)"
        name="conditions"
        defaultValue={offer?.conditions}
        required
        maxLength={500}
      />
      <p className="text-xs text-stone-500">
        ระบบปัดจำนวนแพ็กขึ้นให้พอความต้องการ {fmtQty(order.qty, order.unitSymbol)}
      </p>
    </ActionDialog>
  );
}

function ReasonButton({
  label,
  title,
  field = 'เหตุผล',
  danger,
  onSubmit,
}: {
  label: string;
  title: string;
  field?: string;
  danger?: boolean;
  onSubmit: (
    reason: string,
    run: Parameters<Parameters<typeof ActionDialog>[0]['submit']>[1],
  ) => Promise<boolean>;
}) {
  return (
    <DialogButton label={label} size="sm" variant={danger ? 'danger' : 'secondary'}>
      {(close, open) => (
        <ActionDialog
          open={open}
          onClose={close}
          title={title}
          danger={danger}
          submitLabel={label}
          submit={(f, run) => onSubmit(str(f, 'reason'), run)}
        >
          <Textarea label={field} name="reason" required maxLength={500} />
        </ActionDialog>
      )}
    </DialogButton>
  );
}
