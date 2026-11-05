/**
 * ตรวจรับสินค้า — same markup as legacy receive-ui.js.
 * Difference by design: no "ชื่อผู้ทำรายการ" inputs (the server records the member). Staff receive
 * a finance-redacted state, so the vendor name is shown only when available.
 */
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  receiptIssues,
  receivingLabel,
  receivingSummary,
  workflowTasks,
  type PurchaseOrder,
  type Receipt,
  type ShopState,
} from '@/domain';
import { fmtDateTime } from '../lib/format';
import { useShop } from '../state';
import { Check, FieldGrid, Input, PageHeader, Select, Stat, Stats, Textarea } from '../ui';
import { ActionDialog, bool, str, type Run } from './common';
import { Handoff, useFlow } from './Home';

const num = (n: number) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 });
const date = (x: string | null | undefined) => (x ? fmtDateTime(x) : '—');
const LABELS: Record<Receipt['status'], string> = {
  draft: 'รอผู้จัดการยืนยัน',
  confirmed: 'ยืนยันแล้ว',
  void: 'กลับรายการแล้ว',
  cancelled: 'ยกเลิกร่าง',
};
const Btn = ({
  onClick,
  children,
  id,
}: {
  onClick: () => void;
  children: ReactNode;
  id?: string;
}) => (
  <button id={id} type="button" className="secondary" onClick={onClick}>
    {children}
  </button>
);
const Note = ({ children }: { children: ReactNode }) => (
  <div className="section-note">
    <span className="note-icon">i</span>
    <span>{children}</span>
  </div>
);
const vendor = (o: PurchaseOrder) =>
  (o.purchase as { offer?: { vendor: string } } | null)?.offer?.vendor;
const ref = (o: PurchaseOrder) => [o.purchase?.reference, vendor(o)].filter(Boolean).join(' · ');

type Modal =
  | { kind: 'edit'; receipt?: Receipt }
  | { kind: 'confirm'; receipt: Receipt }
  | { kind: 'cancel'; receipt: Receipt }
  | { kind: 'resolve'; receipt: Receipt }
  | { kind: 'close' };

export function ReceivingPage() {
  const { state: s, me } = useShop();
  const [params, setParams] = useSearchParams();
  const orders = s.purchaseOrders.filter((o) => o.status === 'ordered');
  const o = orders.find((o) => o.id === params.get('id'));
  return (
    <>
      <PageHeader
        eyebrow="RECEIVING / STOCK"
        title="ตรวจรับสินค้า"
        sub="ตรวจจำนวนและคุณภาพก่อนเพิ่มสต็อก"
        actions={
          o && (
            <Btn id="receive-back" onClick={() => (setParams({}), window.scrollTo(0, 0))}>
              รายการทั้งหมด
            </Btn>
          )
        }
      />
      {o && (
        <Handoff
          page="receiving"
          local="#receive-confirm,#receive-edit"
          tasks={workflowTasks(s, me.role).filter(
            (t) => t.key === 'bill:' + o.id || t.key === 'check:' + o.ingredientId,
          )}
        />
      )}
      <Note>
        รับเฉพาะจำนวนที่ผ่านตรวจ ของเสียหายหรือไม่ตรงรายการยังไม่เพิ่มสต็อก
        ผู้จัดการหรือเจ้าของยืนยันก่อนลงยอด
      </Note>
      {o ? (
        <Detail s={s} o={o} />
      ) : (
        <Overview s={s} orders={orders} open={(id) => (setParams({ id }), window.scrollTo(0, 0))} />
      )}
    </>
  );
}

function Overview({
  s,
  orders,
  open,
}: {
  s: ShopState;
  orders: PurchaseOrder[];
  open: (id: string) => void;
}) {
  return (
    <>
      <Stats>
        <Stat
          label="ใบซื้อที่ยังไม่ปิดรับ"
          value={orders.filter((o) => !receivingSummary(s, o).closed).length}
        />
        <Stat
          label="ปัญหาที่ยังต้องติดตาม"
          value={orders.reduce((n, o) => n + receivingSummary(s, o).issues.length, 0)}
        />
        <Stat
          label="ปิดรับแล้ว"
          value={orders.filter((o) => receivingSummary(s, o).closed).length}
        />
      </Stats>
      <section className="panel">
        <div className="panel-heading">
          <h3>ใบซื้อสำหรับตรวจรับ</h3>
        </div>
        {orders.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>วัตถุดิบ / เลขซื้อ</th>
                  <th>สั่ง / รับแล้ว / ค้าง</th>
                  <th>สถานะ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {[...orders].reverse().map((o) => {
                  const v = receivingSummary(s, o);
                  return (
                    <tr key={o.id}>
                      <td>
                        <b>{o.name}</b>
                        <small>{ref(o)}</small>
                      </td>
                      <td>
                        {num(o.purchase!.orderedQty)} / {num(v.accepted)} / {num(v.remaining)}{' '}
                        {o.unitSymbol}
                      </td>
                      <td>
                        <span className="chip off">{receivingLabel(s, o)}</span>
                        {v.draft && <small>มีร่างรอยืนยัน</small>}
                      </td>
                      <td>
                        <Btn onClick={() => open(o.id)}>เปิดตรวจรับ</Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>ยังไม่มีใบซื้อรอตรวจรับ</strong>เมื่อบันทึกซื้อในหน้าจัดซื้อแล้ว
            รายการจะเข้ามาที่นี่
          </div>
        )}
      </section>
    </>
  );
}

function Detail({ s, o }: { s: ShopState; o: PurchaseOrder }) {
  const { can } = useShop();
  const flow = useFlow();
  const [modal, setModal] = useState<Modal | null>(null);
  const v = receivingSummary(s, o);
  const c = o.receiving?.status === 'closed' ? o.receiving : null;
  return (
    <>
      <div className="count-banner" data-current-receive={o.id}>
        <div>
          <h2>{o.name}</h2>
          <span className="chip">{receivingLabel(s, o)}</span>
          <p>เลขซื้อ {ref(o)}</p>
          <small>{o.id}</small>
        </div>
        <div className="count-meta">
          <b>
            ค้าง {num(v.remaining)} {o.unitSymbol}
          </b>
          <span>
            สั่งจริง {num(o.purchase!.orderedQty)} · รับเข้าแล้ว {num(v.accepted)}
          </span>
        </div>
      </div>
      <div className="receive-actions">
        {!v.closed && can('receive') && v.remaining > 0 && (
          <Btn id="receive-edit" onClick={() => setModal({ kind: 'edit', receipt: v.draft })}>
            {v.draft ? 'เปิดร่างรับเดิม' : 'รับสินค้าครั้งนี้'}
          </Btn>
        )}
        {!v.closed && can('receiveReview') && (
          <Btn id="receive-close" onClick={() => setModal({ kind: 'close' })}>
            ปิดงานรับสินค้า
          </Btn>
        )}
        <a
          className="text-button"
          href="#movements"
          onClick={(e) => {
            e.preventDefault();
            flow('movements');
          }}
        >
          ดูเคลื่อนไหวสต็อก →
        </a>
      </div>
      {c && (
        <div className="review-feedback">
          ปิดรับโดย {c.person} · {date(c.at)}
          <br />
          {c.reason}
          {v.remaining > 0 && (
            <>
              <br />
              ตกลงไม่รับส่วนที่เหลือ {num(v.remaining)} {o.unitSymbol} ·
              ยังไม่ใช่การคืนเงินหรือปรับบิล
            </>
          )}
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h3>ประวัติการส่งและตรวจรับ</h3>
          <span>{v.receipts.length} รายการ</span>
        </div>
        <div className="receive-list">
          {v.receipts.length ? (
            [...v.receipts].reverse().map((r) => (
              <article className="receive-card" key={r.id}>
                <div className="count-title">
                  <h3>{r.reference}</h3>
                  <span className={`chip ${r.status === 'draft' ? 'review' : 'off'}`}>
                    {LABELS[r.status]}
                  </span>
                </div>
                <p>
                  <b>
                    รับเข้า {num(r.accepted)} {o.unitSymbol}
                  </b>{' '}
                  · ไม่รับ {num(r.rejected)} {o.unitSymbol}
                </p>
                <p>
                  {receiptIssues[r.issueType]} · {r.note}
                </p>
                <small>
                  ตรวจโดย {r.person} · {date(r.at)}
                </small>
                {r.confirmedBy && (
                  <p>
                    ยืนยันโดย {r.confirmedBy} · {date(r.confirmedAt)}
                  </p>
                )}
                {r.movementId && <small>อ้างอิงสต็อก {r.movementId}</small>}
                {r.resolution && (
                  <div className="review-feedback">
                    ติดตามแล้ว: {r.resolution.note}
                    <br />
                    {r.resolution.person} · {date(r.resolution.at)}
                  </div>
                )}
                {r.cancelReason && (
                  <p>
                    เหตุผลยกเลิก: {r.cancelReason} · {r.cancelledBy}
                  </p>
                )}
                <div className="receive-actions">
                  {!v.closed && r.status === 'draft' && can('receive') && (
                    <Btn onClick={() => setModal({ kind: 'edit', receipt: r })}>แก้ร่าง</Btn>
                  )}
                  {!v.closed && r.status === 'draft' && can('receiveReview') && (
                    <Btn
                      id="receive-confirm"
                      onClick={() => setModal({ kind: 'confirm', receipt: r })}
                    >
                      ตรวจและยืนยันรับ
                    </Btn>
                  )}
                  {!v.closed &&
                    ((r.status === 'draft' && can('receive')) ||
                      (r.status === 'confirmed' && can('receiveReview'))) && (
                      <Btn onClick={() => setModal({ kind: 'cancel', receipt: r })}>
                        {r.status === 'draft' ? 'ยกเลิกร่าง' : 'ยกเลิกและกลับยอดรับ'}
                      </Btn>
                    )}
                  {!v.closed &&
                    r.status === 'confirmed' &&
                    r.issueType !== 'none' &&
                    !r.resolution &&
                    can('receiveReview') && (
                      <Btn onClick={() => setModal({ kind: 'resolve', receipt: r })}>
                        บันทึกผลติดตาม
                      </Btn>
                    )}
                </div>
              </article>
            ))
          ) : (
            <div className="empty">ยังไม่มีประวัติรับสินค้า</div>
          )}
        </div>
      </section>
      <Note>
        ยอดค้าง = จำนวนสั่งจริงหักยอดรับที่ยืนยัน ของไม่รับยังค้างจนกว่าจะส่งทดแทนหรือปิดรับบางส่วน
        การบันทึกผลติดตามไม่เพิ่มสต็อก ต้องทำใบรับใหม่สำหรับของส่งทดแทน
      </Note>
      {modal && (
        <ReceiveModal
          modal={modal}
          o={o}
          remaining={v.remaining}
          accepted={v.accepted}
          close={() => setModal(null)}
        />
      )}
    </>
  );
}

function ReceiveDialog({
  title,
  submitLabel,
  onClose,
  submit,
  children,
}: {
  title: string;
  submitLabel: string;
  onClose: () => void;
  submit: (f: FormData, run: Run) => Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <ActionDialog
      open
      eyebrow="DALDAL / RECEIVING"
      title={title}
      submitLabel={submitLabel}
      onClose={onClose}
      submit={submit}
    >
      {children}
    </ActionDialog>
  );
}
const ok = 'บันทึกตรวจรับแล้ว';

function ReceiveModal({
  modal,
  o,
  remaining,
  accepted,
  close,
}: {
  modal: Modal;
  o: PurchaseOrder;
  remaining: number;
  accepted: number;
  close: () => void;
}) {
  if (modal.kind === 'edit') {
    const r = modal.receipt;
    return (
      <ReceiveDialog
        title="บันทึกร่างตรวจรับ"
        submitLabel="บันทึกร่าง"
        onClose={close}
        submit={(f, run) =>
          run(
            'saveReceipt',
            {
              orderId: o.id,
              receipt: {
                id: r?.id,
                reference: str(f, 'reference'),
                accepted: str(f, 'accepted'),
                rejected: str(f, 'rejected'),
                issueType: str(f, 'issueType'),
                note: str(f, 'note'),
              },
            },
            ok,
          )
        }
      >
        <p>
          {o.name} · ค้าง {num(remaining)} {o.unitSymbol} · ยังไม่เพิ่มสต็อกจนกว่ายืนยัน
        </p>
        <FieldGrid>
          <Input
            label="เลขส่งของ / ครั้งส่งที่ไม่ซ้ำ *"
            name="reference"
            required
            maxLength={100}
            defaultValue={r?.reference}
            wide
          />
          <Input
            label="จำนวนผ่านตรวจ รับเข้าสต็อก *"
            name="accepted"
            required
            inputMode="decimal"
            defaultValue={r?.accepted ?? ''}
          />
          <Input
            label="จำนวนไม่รับ * (ไม่มีให้ใส่ 0)"
            name="rejected"
            required
            inputMode="decimal"
            defaultValue={r?.rejected ?? ''}
          />
          <Select
            label="ผลตรวจ"
            name="issueType"
            wide
            defaultValue={r?.issueType}
            options={Object.entries(receiptIssues) as Array<[string, string]>}
          />
          <Textarea
            label="รายละเอียดผลตรวจ / เหตุผลรับบางส่วน *"
            name="note"
            required
            maxLength={500}
            defaultValue={r?.note}
          />
        </FieldGrid>
        <p className="muted">
          จำนวนผ่านตรวจ + ไม่รับ ต้องไม่เกินยอดค้าง ของมาเกินให้แยกคืนหรือตกลงจัดซื้อใหม่
          อย่านำของที่รวมในยอดนับแล้วมารับซ้ำ
        </p>
      </ReceiveDialog>
    );
  }
  if (modal.kind === 'confirm') {
    const r = modal.receipt;
    return (
      <ReceiveDialog
        title="ตรวจและยืนยันรับสินค้า"
        submitLabel="ยืนยันและลงสต็อก"
        onClose={close}
        submit={(f, run) =>
          run(
            'confirmReceipt',
            { receiptId: r.id, checked: bool(f, 'checked'), notCounted: bool(f, 'notCounted') },
            ok,
          )
        }
      >
        <h3>{r.reference}</h3>
        <p>
          จะเพิ่ม {o.name} เข้า {num(r.accepted)} {o.unitSymbol} · ไม่รับ {num(r.rejected)}
        </p>
        <p>{r.note}</p>
        <Check name="checked" required label="ตรวจจำนวนและคุณภาพสินค้าจริงแล้ว" />
        <Check
          name="notCounted"
          required
          label="จำนวนรับนี้ยังไม่เคยลงรับ และไม่รวมอยู่ในยอดนับอ้างอิงแล้ว"
        />
        <p className="muted">
          การยืนยันจะลงสต็อกหนึ่งรายการ กดยืนยันใบเดิมซ้ำไม่ได้
          ยอดนี้ยังต้องตรวจความครบของเคลื่อนไหวก่อนใช้เป็นฐานเสนอซื้อ
        </p>
      </ReceiveDialog>
    );
  }
  if (modal.kind === 'cancel')
    return (
      <ReceiveDialog
        title="ยกเลิกใบรับ"
        submitLabel="ยืนยันยกเลิก"
        onClose={close}
        submit={(f, run) =>
          run('cancelReceipt', { receiptId: modal.receipt.id, reason: str(f, 'reason') }, ok)
        }
      >
        <p>
          เก็บประวัติเดิม หากยืนยันแล้วจะกลับยอดที่เคยรับ
          การกลับยอดทำได้เมื่อยังใช้ยอดนับอ้างอิงเดิมและสต็อกพอเท่านั้น
        </p>
        <Textarea label="เหตุผลยกเลิก *" name="reason" required maxLength={500} />
      </ReceiveDialog>
    );
  if (modal.kind === 'resolve')
    return (
      <ReceiveDialog
        title="บันทึกผลติดตามปัญหา"
        submitLabel="บันทึกผลติดตาม"
        onClose={close}
        submit={(f, run) =>
          run('resolveReceiptIssue', { receiptId: modal.receipt.id, note: str(f, 'note') }, ok)
        }
      >
        <p>
          บันทึกข้อตกลงและหลักฐาน เช่น ร้านส่งทดแทนหรือยอมรับยุติการส่ง
          ขั้นนี้ไม่เพิ่มสต็อกและไม่คืนเงิน
        </p>
        <Textarea label="ผลติดตาม / หลักฐานอ้างอิง *" name="note" required maxLength={500} />
      </ReceiveDialog>
    );
  return (
    <ReceiveDialog
      title="ปิดงานรับสินค้า"
      submitLabel="ยืนยันปิดรับ"
      onClose={close}
      submit={(f, run) =>
        run(
          'closeReceiving',
          {
            orderId: o.id,
            reason: str(f, 'reason'),
            checked: bool(f, 'checked'),
            closeShort: bool(f, 'closeShort'),
          },
          ok,
        )
      }
    >
      <p>
        รับแล้ว {num(accepted)} / สั่ง {num(o.purchase!.orderedQty)} {o.unitSymbol} · ค้าง{' '}
        {num(remaining)}
      </p>
      <p>
        ต้องจัดการร่างและปัญหาค้างก่อนปิด เมื่อปิดแล้วใบรับแก้ย้อนหลังไม่ได้
        และรายการเสนอซื้อเดิมจะเสร็จสิ้น
      </p>
      <Textarea label="เหตุผล / หลักฐานปิดรับ *" name="reason" required maxLength={500} />
      <Check name="checked" required label="ตรวจประวัติรับและตกลงปิดงานแล้ว" />
      {remaining > 0 && (
        <Check
          name="closeShort"
          required
          label="ตกลงไม่รับส่วนที่เหลือแล้ว (ต้องติดตามบิลหรือคืนเงินแยกต่างหาก)"
        />
      )}
    </ReceiveDialog>
  );
}
