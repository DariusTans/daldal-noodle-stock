import { useState } from 'react';
import {
  hasOpenCount,
  receiptIssues,
  receivingLabel,
  receivingSummary,
  type PurchaseOrder,
  type Receipt,
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
import { ActionDialog, bool, DialogButton, StatusBadge, str } from './common';

export function ReceivingPage() {
  const { state } = useShop();
  const [showClosed, setShowClosed] = useState(false);
  const orders = state.purchaseOrders
    .filter((o) => o.status === 'ordered' && (showClosed || o.receiving?.status !== 'closed'))
    .reverse();
  return (
    <>
      <PageHeader
        eyebrow="จัดซื้อ"
        title="ตรวจรับสินค้า"
        sub="พนักงานร่างใบรับ → ผู้จัดการยืนยัน จึงเพิ่มสต็อก (ครั้งเดียว) · รับบางส่วน / ไม่รับ / ติดตามปัญหาได้ · ยกเลิกใบรับที่ยืนยันแล้วจะกลับรายการ ไม่ลบประวัติ"
        actions={
          <Check
            label="แสดงใบที่ปิดรับแล้ว"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
        }
      />
      {hasOpenCount(state) && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          มีรอบนับค้าง ต้องจบรอบนับก่อนบันทึกหรือยืนยันรับ
        </p>
      )}
      <div className="flex flex-col gap-4">
        {orders.length ? (
          orders.map((o) => <OrderReceiving key={o.id} order={o} />)
        ) : (
          <Empty>ไม่มีใบซื้อรอตรวจรับ</Empty>
        )}
      </div>
    </>
  );
}

function OrderReceiving({ order: o }: { order: PurchaseOrder }) {
  const { state, can } = useShop();
  const v = receivingSummary(state, o);
  const [editing, setEditing] = useState<Receipt | 'new' | null>(null);
  const unit = o.unitSymbol;
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {o.name}{' '}
          <Badge tone={v.closed ? 'success' : v.issues.length ? 'warning' : 'info'}>
            {receivingLabel(state, o)}
          </Badge>
        </span>
      }
      actions={
        !v.closed &&
        can('receiveReview') && (
          <DialogButton label="ปิดงานรับ" disabled={!!v.draft || v.issues.length > 0}>
            {(close, open) => (
              <ActionDialog
                open={open}
                onClose={close}
                title={'ปิดงานรับ: ' + o.name}
                submitLabel="ปิดงานรับ"
                submit={(f, run) =>
                  run(
                    'closeReceiving',
                    {
                      orderId: o.id,
                      reason: str(f, 'reason'),
                      checked: bool(f, 'checked'),
                      closeShort: bool(f, 'closeShort'),
                    },
                    'ปิดงานรับแล้ว',
                  )
                }
              >
                <p className="text-sm">
                  รับแล้ว {fmtQty(v.accepted, unit)} · ค้าง {fmtQty(v.remaining, unit)}
                </p>
                <Textarea label="เหตุผล / หลักฐานปิดรับ" name="reason" required maxLength={500} />
                {v.remaining > 0 && (
                  <Check
                    name="closeShort"
                    label={`ตกลงไม่รับส่วนที่เหลือ ${fmtQty(v.remaining, unit)}`}
                  />
                )}
                <Check name="checked" label="ตรวจแล้ว ยืนยันปิดงานรับ (แก้ย้อนหลังไม่ได้)" />
              </ActionDialog>
            )}
          </DialogButton>
        )
      }
    >
      <dl className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Info label="สั่งซื้อ" value={fmtQty(o.purchase?.orderedQty, unit)} />
        <Info label="รับเข้าแล้ว" value={fmtQty(v.accepted, unit)} />
        <Info label="ไม่รับ" value={fmtQty(v.rejected, unit)} />
        <Info label="ค้างรับ" value={fmtQty(v.remaining, unit)} />
      </dl>
      <Table
        head={['เลขส่งของ', 'สถานะ', 'รับ / ไม่รับ', 'ผลตรวจ', 'ผู้บันทึก', '']}
        empty="ยังไม่มีใบรับ"
      >
        {v.receipts.map((r) => (
          <tr key={r.id}>
            <Td>{r.reference}</Td>
            <Td>
              <StatusBadge status={r.status} />
            </Td>
            <Td>
              {fmtQty(r.accepted, unit)} / {fmtQty(r.rejected, unit)}
            </Td>
            <Td>
              {receiptIssues[r.issueType]}
              <span className="block text-xs text-stone-500">{r.note}</span>
              {r.resolution && (
                <span className="block text-xs text-emerald-700">
                  ติดตามแล้ว: {r.resolution.note}
                </span>
              )}
            </Td>
            <Td>
              {r.person}
              {r.confirmedBy && (
                <span className="block text-xs text-stone-500">
                  ยืนยัน: {r.confirmedBy} · {fmtDateTime(r.confirmedAt)}
                </span>
              )}
            </Td>
            <Td className="whitespace-nowrap text-right">
              <span className="inline-flex flex-wrap justify-end gap-1">
                {r.status === 'draft' && !v.closed && can('receive') && (
                  <Button size="sm" onClick={() => setEditing(r)}>
                    แก้ไข
                  </Button>
                )}
                {r.status === 'draft' && !v.closed && can('receiveReview') && (
                  <DialogButton label="ยืนยันรับ" size="sm" variant="primary">
                    {(close, open) => (
                      <ActionDialog
                        open={open}
                        onClose={close}
                        title={'ยืนยันรับ ' + r.reference}
                        submitLabel="ยืนยันรับเข้าสต็อก"
                        submit={(f, run) =>
                          run(
                            'confirmReceipt',
                            {
                              receiptId: r.id,
                              checked: bool(f, 'checked'),
                              notCounted: bool(f, 'notCounted'),
                            },
                            'รับเข้าสต็อกแล้ว',
                          )
                        }
                      >
                        <p className="text-sm">
                          รับ {fmtQty(r.accepted, unit)} · ไม่รับ {fmtQty(r.rejected, unit)} (
                          {receiptIssues[r.issueType]})
                        </p>
                        <Check name="checked" label="ตรวจของจริงตรงกับผลที่บันทึก" />
                        <Check
                          name="notCounted"
                          label="ยืนยันว่ายังไม่ได้รวมจำนวนนี้ในยอดนับ (ป้องกันลงยอดซ้ำ)"
                        />
                      </ActionDialog>
                    )}
                  </DialogButton>
                )}
                {r.status === 'confirmed' &&
                  r.issueType !== 'none' &&
                  !r.resolution &&
                  !v.closed &&
                  can('receiveReview') && (
                    <DialogButton label="บันทึกผลติดตาม" size="sm">
                      {(close, open) => (
                        <ActionDialog
                          open={open}
                          onClose={close}
                          title="ผลติดตามปัญหา"
                          submit={(f, run) =>
                            run(
                              'resolveReceiptIssue',
                              { receiptId: r.id, note: str(f, 'note') },
                              'บันทึกผลติดตามแล้ว',
                            )
                          }
                        >
                          <Textarea
                            label="ผลติดตามและหลักฐานอ้างอิง"
                            name="note"
                            required
                            maxLength={500}
                          />
                        </ActionDialog>
                      )}
                    </DialogButton>
                  )}
                {(r.status === 'draft'
                  ? can('receive')
                  : r.status === 'confirmed' && can('receiveReview')) &&
                  !v.closed && (
                    <DialogButton label="ยกเลิก" size="sm" variant="danger">
                      {(close, open) => (
                        <ActionDialog
                          open={open}
                          onClose={close}
                          danger
                          title={'ยกเลิกใบรับ ' + r.reference}
                          submitLabel="ยกเลิกใบรับ"
                          submit={(f, run) =>
                            run(
                              'cancelReceipt',
                              { receiptId: r.id, reason: str(f, 'reason') },
                              'ยกเลิกใบรับแล้ว',
                            )
                          }
                        >
                          {r.status === 'confirmed' && (
                            <p className="text-sm text-stone-700">
                              ระบบจะบันทึกรายการกลับรายการเพื่อหักสต็อกที่รับไว้
                            </p>
                          )}
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
      {!v.closed && !v.draft && v.remaining > 0 && can('receive') && (
        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={() => setEditing('new')}>
            + ร่างใบรับ
          </Button>
        </div>
      )}
      {editing && (
        <ReceiptForm
          order={o}
          receipt={editing === 'new' ? undefined : editing}
          remaining={v.remaining}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

const Info = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg bg-stone-50 px-3 py-2">
    <dt className="text-xs text-stone-500">{label}</dt>
    <dd className="font-semibold">{value}</dd>
  </div>
);

function ReceiptForm({
  order,
  receipt,
  remaining,
  onClose,
}: {
  order: PurchaseOrder;
  receipt?: Receipt;
  remaining: number;
  onClose: () => void;
}) {
  return (
    <ActionDialog
      open
      onClose={onClose}
      title={(receipt ? 'แก้ไขร่างรับ: ' : 'ร่างใบรับ: ') + order.name}
      submitLabel="บันทึกร่าง"
      submit={(f, run) =>
        run(
          'saveReceipt',
          {
            orderId: order.id,
            receipt: {
              id: receipt?.id,
              reference: str(f, 'reference'),
              accepted: str(f, 'accepted'),
              rejected: str(f, 'rejected') || '0',
              issueType: str(f, 'issueType'),
              note: str(f, 'note'),
            },
          },
          'บันทึกร่างรับแล้ว รอผู้จัดการยืนยัน',
        )
      }
    >
      <p className="text-sm text-stone-600">ค้างรับ {fmtQty(remaining, order.unitSymbol)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="เลขส่งของ / ครั้งส่ง (ห้ามซ้ำ)"
          name="reference"
          defaultValue={receipt?.reference}
          required
          maxLength={100}
        />
        <Select
          label="ผลตรวจ"
          name="issueType"
          defaultValue={receipt?.issueType ?? 'none'}
          options={Object.entries(receiptIssues) as Array<[string, string]>}
        />
        <Input
          label={`รับจริง (${order.unitSymbol})`}
          name="accepted"
          defaultValue={receipt?.accepted ?? ''}
          required
          inputMode="decimal"
        />
        <Input
          label={`ไม่รับ (${order.unitSymbol})`}
          name="rejected"
          defaultValue={receipt?.rejected ?? 0}
          inputMode="decimal"
        />
      </div>
      <Textarea
        label="ผลตรวจ / เหตุผลรับบางส่วน"
        name="note"
        defaultValue={receipt?.note}
        required
        maxLength={500}
      />
    </ActionDialog>
  );
}
