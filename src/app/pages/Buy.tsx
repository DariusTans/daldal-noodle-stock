/**
 * จัดซื้อและอนุมัติ — same markup as legacy buy-ui.js.
 * Differences by design: no "ชื่อผู้ทำรายการ" inputs (server records the member); the approver is
 * a member chosen in the policy dialog, and only that member (name + role) sees the decision buttons.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  currencies,
  needsApproval,
  orderPolicyStale,
  orderSourceStale,
  quoteTotal,
  receivingLabel,
  roles,
  stockRows,
  workflowTasks,
  type Offer,
  type PurchaseOrder,
  type PurchasePolicy,
  type ShopState,
} from '@/domain';
import { fmtDateTime, localInputToIso } from '../lib/format';
import { useBackend, useShop } from '../state';
import { Check, FieldGrid, Input, PageHeader, Select, Stat, Stats, Textarea } from '../ui';
import { ActionDialog, bool, str, type Run } from './common';
import { Handoff, useFlow } from './Home';
import { PurchasePolicyDialog } from './Settings';

const num = (n: number) => Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 });
const money = (n: number, c: string) =>
  `${(n / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;
const date = (x: string | null | undefined) => (x ? fmtDateTime(x) : '—');
const Btn = ({
  primary,
  onClick,
  children,
  id,
}: {
  primary?: boolean;
  onClick: () => void;
  children: ReactNode;
  id?: string;
}) => (
  <button id={id} type="button" className={primary ? 'primary' : 'secondary'} onClick={onClick}>
    {children}
  </button>
);
const Note = ({ children }: { children: ReactNode }) => (
  <div className="section-note">
    <span className="note-icon">i</span>
    <span>{children}</span>
  </div>
);

export const policyText = (p: PurchasePolicy | null) =>
  p
    ? `${p.mode === 'all' ? 'ทุกใบต้องอนุมัติ' : 'ต้องอนุมัติเมื่อยอดรวมเกิน ' + money(p.threshold, p.currency) + ' ต่อใบ'} · ผู้พิจารณา ${p.approver} (${roles[p.approverRole]})`
    : 'ยังไม่กำหนดเกณฑ์และผู้อนุมัติ เก็บร่างและเทียบราคาได้ แต่ยังส่งพิจารณาไม่ได้';

function Status({ s, o }: { s: ShopState; o: PurchaseOrder }) {
  return (
    <span
      className={`chip ${o.status === 'pending' ? 'review' : o.status === 'approved' || o.status === 'cleared' ? '' : 'off'}`}
    >
      {o.status === 'ordered' ? receivingLabel(s, o) : STATUSES[o.status]}
    </span>
  );
}
const STATUSES: Record<PurchaseOrder['status'], string> = {
  draft: 'ร่าง / เทียบทางเลือก',
  pending: 'รอพิจารณา',
  returned: 'ส่งกลับแก้ไข',
  approved: 'อนุมัติแล้ว',
  cleared: 'ตรวจแล้ว ไม่เข้าเกณฑ์วงเงิน',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
  ordered: 'ซื้อแล้ว รอตรวจรับ',
};

type BuyModal =
  | { kind: 'create'; id: string }
  | { kind: 'policy' }
  | { kind: 'offer'; id?: string }
  | { kind: 'select'; id: string }
  | { kind: 'source' }
  | { kind: 'submit' }
  | { kind: 'decide'; action: 'approve' | 'return' | 'reject' }
  | { kind: 'revise' }
  | { kind: 'cancel' }
  | { kind: 'ordered' };

export function BuyPage() {
  const { state, can, me } = useShop();
  const demo = useBackend().mode === 'demo';
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState<BuyModal | null>(null);
  const handled = useRef(false);
  const o = state.purchaseOrders.find((o) => o.id === params.get('id'));
  const created = params.get('created');
  useEffect(() => {
    if (!created) return;
    const order = state.purchaseOrders.find(
      (x) => x.requestId === created && !['cancelled', 'rejected'].includes(x.status),
    );
    if (order) setParams({ id: order.id }, { replace: true });
  }, [created, state.purchaseOrders, setParams]);

  useEffect(() => {
    const action = params.get('action'),
      id = params.get('id');
    if (handled.current || !action) return;
    handled.current = true;
    if (action === 'create' && id && can('buy')) setModal({ kind: 'create', id });
    if (action === 'policy' && can('buySettings')) setModal({ kind: 'policy' });
    setParams(id && action !== 'create' ? { id } : {}, { replace: true });
  }, [params, setParams, can]);

  if (!can('buy'))
    return (
      <>
        <PageHeader
          eyebrow="PURCHASING"
          title="จัดซื้อและอนุมัติ"
          sub="มุมมองหุ้นส่วนและผู้จัดการ"
        />
        <section className="panel empty">
          <strong>บทบาทนี้ยังไม่เปิดข้อมูลราคาและจัดซื้อ</strong>สิทธิ์จัดซื้อเปิดให้หุ้นส่วน /
          เจ้าของ และผู้จัดการ
        </section>
      </>
    );

  return (
    <>
      <PageHeader
        eyebrow="PURCHASING / COMPARE & APPROVE"
        title="จัดซื้อและอนุมัติ"
        sub="ต่อจากรายการเสนอซื้อที่คนตรวจแล้ว"
        actions={
          <div className="buy-actions">
            {o && (
              <Btn id="buy-back" onClick={() => (setParams({}), window.scrollTo(0, 0))}>
                รายการทั้งหมด
              </Btn>
            )}
            {can('buySettings') && (
              <Btn id="buy-policy" onClick={() => setModal({ kind: 'policy' })}>
                ตั้งเกณฑ์อนุมัติ
              </Btn>
            )}
          </div>
        }
      />
      {o && (
        <Handoff
          page="buy"
          local="#buy-ordered,#buy-approve,#buy-submit,#buy-add-offer"
          tasks={workflowTasks(state, me.role).filter(
            (t) => t.id === o.id && (t.page === 'buy' || t.page === 'receiving'),
          )}
        />
      )}
      <div className="buy-policy">
        <b>{demo ? 'เกณฑ์ทดลอง' : 'เกณฑ์อนุมัติ'}</b>
        <p>{policyText(state.purchasePolicy)}</p>
        <small>
          {demo
            ? 'ทุกคนสลับบทบาทจำลองได้ ผู้อนุมัติและเกณฑ์ในหน้านี้ยังไม่ใช่สิทธิ์ใช้งานจริง'
            : 'เกณฑ์และผู้พิจารณาตั้งโดยเจ้าของ · ผู้พิจารณาต้องเป็นสมาชิกตามชื่อและบทบาทที่ตั้งไว้'}
        </small>
      </div>
      {o ? <Detail o={o} open={setModal} /> : <Overview open={setModal} />}
      {modal && <BuyModals modal={modal} order={o} close={() => setModal(null)} />}
    </>
  );
}

function Overview({ open }: { open: (m: BuyModal) => void }) {
  const { state: s, can } = useShop();
  const [, setParams] = useSearchParams();
  const flow = useFlow();
  const incoming = s.purchaseRequests.filter(
    (p) =>
      p.status === 'ready' &&
      !s.purchaseOrders.some(
        (o) => o.requestId === p.id && !['cancelled', 'rejected'].includes(o.status),
      ),
  );
  return (
    <>
      <Stats>
        <Stat label="รอเริ่มจัดซื้อ" value={incoming.length} unit="รายการ" />
        <Stat
          label="รอพิจารณา"
          value={s.purchaseOrders.filter((o) => o.status === 'pending').length}
          unit="ใบ"
        />
        <Stat
          label="ซื้อแล้ว รอตรวจรับ"
          value={
            s.purchaseOrders.filter(
              (o) => o.status === 'ordered' && o.receiving?.status !== 'closed',
            ).length
          }
          unit="ใบ"
        />
      </Stats>
      <section className="panel">
        <div className="panel-heading">
          <h3>รายการเสนอซื้อที่ตรวจแล้ว</h3>
          <button type="button" className="text-button" onClick={() => flow('alerts')}>
            ไปเสนอซื้อ →
          </button>
        </div>
        {incoming.length ? (
          <div className="table-wrap">
            <table className="buy-table">
              <thead>
                <tr>
                  <th>วัตถุดิบ</th>
                  <th>จำนวนที่ตรวจแล้ว</th>
                  <th>ผู้ตรวจ / เวลา</th>
                  <th>เริ่มงาน</th>
                </tr>
              </thead>
              <tbody>
                {incoming.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b>
                    </td>
                    <td>
                      {num(p.qty)} {p.unitSymbol}
                    </td>
                    <td>
                      {p.reviewedBy}
                      <small>{date(p.reviewedAt)}</small>
                    </td>
                    <td>
                      {can('buy') && (
                        <Btn onClick={() => open({ kind: 'create', id: p.id })}>เปิดใบจัดซื้อ</Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>ไม่มีรายการใหม่รอจัดซื้อ</strong>ตรวจจำนวนในหน้าเตือนซื้อ
            หรือเปิดใบจัดซื้อเดิมด้านล่าง
          </div>
        )}
      </section>
      <section className="panel stock-history">
        <div className="panel-heading">
          <h3>ใบจัดซื้อทั้งหมด</h3>
          <span className="muted">หนึ่งรายการเสนอซื้อต่อหนึ่งใบ</span>
        </div>
        {s.purchaseOrders.length ? (
          <div className="table-wrap">
            <table className="buy-table">
              <thead>
                <tr>
                  <th>วัตถุดิบ / ใบอ้างอิง</th>
                  <th>สถานะ</th>
                  <th>แหล่งซื้อ / ยอดรวม</th>
                  <th>เปิด</th>
                </tr>
              </thead>
              <tbody>
                {[...s.purchaseOrders].reverse().map((o) => {
                  const f = o.offers.find((f) => f.id === o.selectedId);
                  return (
                    <tr key={o.id}>
                      <td>
                        <b>{o.name}</b>
                        <small>{o.id}</small>
                      </td>
                      <td>
                        <Status s={s} o={o} />
                      </td>
                      <td>
                        {f ? (
                          <>
                            {f.vendor}
                            <small>{money(quoteTotal(o, f).total, o.currency)}</small>
                          </>
                        ) : (
                          'ยังไม่เลือก'
                        )}
                      </td>
                      <td>
                        <Btn onClick={() => (setParams({ id: o.id }), window.scrollTo(0, 0))}>
                          ดูรายละเอียด
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">ยังไม่มีใบจัดซื้อ</div>
        )}
      </section>
      <Note>
        ราคากรอกจากแหล่งที่ตรวจจริง ไม่มีการดึงราคาสดหรือสั่งซื้ออัตโนมัติ
        รอบนี้เตรียมซื้อและบันทึกว่าซื้อภายนอกแล้ว เปิดหน้า{' '}
        <a
          href="#receiving"
          onClick={(e) => {
            e.preventDefault();
            flow('receiving');
          }}
        >
          ตรวจรับสินค้า
        </a>{' '}
        เพื่อบันทึกของที่มาส่ง
      </Note>
    </>
  );
}

function Detail({ o, open }: { o: PurchaseOrder; open: (m: BuyModal) => void }) {
  const { state: s, can, me } = useShop();
  const flow = useFlow();
  const editable = (o.status === 'draft' || o.status === 'returned') && can('buy');
  const stale = orderSourceStale(s, o);
  const f = o.offers.find((f) => f.id === o.selectedId);
  const p = s.purchasePolicy;
  const reviewable =
    can('buy') && !!p && p.approverRole === me.role && p.approver === me.displayName;
  const total = f ? quoteTotal(o, f) : null;

  return (
    <>
      <div className="count-banner" data-current-buy={o.id}>
        <div>
          <div className="count-title">
            <h2>{o.name}</h2>
            <Status s={s} o={o} />
          </div>
          <p>
            ต้องการ {num(o.qty)} {o.unitSymbol} · {o.currency} · เปิดโดย {o.person}
          </p>
          <small>{o.id}</small>
        </div>
        <div className="count-meta">
          <b>{total ? money(total.total, o.currency) : '—'}</b>
          <span>รวมค่าขนส่งและส่วนลด</span>
        </div>
      </div>
      <ol className="count-steps">
        <li className="done">1 · เทียบและเลือก</li>
        <li
          className={['pending', 'approved', 'cleared', 'ordered'].includes(o.status) ? 'done' : ''}
        >
          2 · พิจารณา
        </li>
        <li className={o.status === 'ordered' ? 'done' : ''}>3 · ซื้อ / รอตรวจรับ</li>
      </ol>
      {stale && o.status !== 'ordered' && (
        <div className="review-feedback">
          ยอดต้นทางเปลี่ยนหรือไม่พร้อม ต้องทบทวนก่อนส่งตรวจและบันทึกซื้อ
        </div>
      )}
      {o.policySnapshot &&
        orderPolicyStale(s, o) &&
        !['ordered', 'cancelled', 'rejected'].includes(o.status) && (
          <div className="review-feedback">เกณฑ์อนุมัติเปลี่ยน ต้องถอนกลับและส่งพิจารณาใหม่</div>
        )}
      <div className="buy-source">
        <div>
          <b>ตรวจความต้องการซื้อ</b>
          <p>
            {o.sourceCheckedBy} · {date(o.sourceCheckedAt)}
          </p>
          <small>{o.sourceReason || 'อ้างอิงรายการเสนอซื้อที่ตรวจแล้ว'}</small>
        </div>
        {editable && (
          <Btn id="buy-source-review" onClick={() => open({ kind: 'source' })}>
            ทบทวนยอด / จำนวน
          </Btn>
        )}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h3>เปรียบเทียบทางเลือกซื้อ</h3>
          {editable && (
            <Btn id="buy-add-offer" primary onClick={() => open({ kind: 'offer' })}>
              ＋ เพิ่มทางเลือก
            </Btn>
          )}
        </div>
        {o.offers.length ? (
          <div className="table-wrap">
            <table className="buy-table quote-table">
              <thead>
                <tr>
                  <th>แหล่งซื้อ / เงื่อนไข</th>
                  <th>ขนาด / ราคาต่อชุดซื้อ</th>
                  <th>จำนวนซื้อ / ค่าเพิ่ม</th>
                  <th>รวม / ต้นทุนต่อหน่วย</th>
                  <th>เลือก</th>
                </tr>
              </thead>
              <tbody>
                {o.offers.map((f) => {
                  const t = quoteTotal(o, f);
                  return (
                    <tr key={f.id} className={o.selectedId === f.id ? 'selected-offer' : ''}>
                      <td>
                        <b>{f.vendor}</b>
                        <small>{f.conditions}</small>
                        <small>ที่มา: {f.source}</small>
                        <small>ตรวจราคา {date(f.quotedAt)}</small>
                      </td>
                      <td>
                        {num(f.packQty)} {o.unitSymbol} / ชุดซื้อ
                        <small>{money(f.packPrice, o.currency)} / ชุดซื้อ</small>
                      </td>
                      <td>
                        {num(t.packs)} ชุดซื้อ = {num(t.units)} {o.unitSymbol}
                        <small>ส่ง {money(f.shipping, o.currency)}</small>
                        <small>
                          เพิ่ม {money(f.extra, o.currency)} · ลด {money(f.discount, o.currency)}
                        </small>
                      </td>
                      <td>
                        <b>{money(t.total, o.currency)}</b>
                        <small>
                          {t.unitCost.toLocaleString('th-TH', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 4,
                          })}{' '}
                          {o.currency} / {o.unitSymbol}
                        </small>
                      </td>
                      <td>
                        <div className="buy-actions">
                          {o.selectedId === f.id && <span className="chip">เลือกแล้ว</span>}
                          {editable && (
                            <>
                              <Btn onClick={() => open({ kind: 'select', id: f.id })}>เลือก</Btn>
                              <Btn onClick={() => open({ kind: 'offer', id: f.id })}>แก้ไข</Btn>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <strong>เพิ่มแหล่งซื้อที่ตรวจราคามา</strong>ระบุขนาดชุดซื้อในหน่วยนับเดิม
            ระบบปัดจำนวนชุดซื้อขึ้นให้พอกับจำนวนที่ต้องการ
          </div>
        )}
      </section>
      {o.selectionReason && (
        <div className="buy-selection">
          <b>เหตุผลเลือก</b>
          <p>{o.selectionReason}</p>
        </div>
      )}
      <Note>
        ใช้สกุลเงินเดียวต่อใบ ราคาต่อชุดซื้อรวมภาษีแล้ว ค่าส่ง/ส่วนลดเป็นยอดทั้งใบ
        ไม่รวมข้ามใบและไม่แปลงสกุลเงิน จำนวนที่เกินความต้องการจากการปัดชุดซื้อต้องตรวจด้วยคน
      </Note>
      <div className="buy-actions buy-bottom">
        {editable && (
          <Btn id="buy-submit" primary onClick={() => open({ kind: 'submit' })}>
            ส่งพิจารณา
          </Btn>
        )}
        {o.status === 'pending' && reviewable && (
          <>
            <Btn
              id="buy-approve"
              primary
              onClick={() => open({ kind: 'decide', action: 'approve' })}
            >
              {needsApproval(s, o) ? 'อนุมัติ' : 'รับรองว่าไม่เข้าเกณฑ์วงเงิน'}
            </Btn>
            <Btn id="buy-return" onClick={() => open({ kind: 'decide', action: 'return' })}>
              ส่งกลับแก้ไข
            </Btn>
            <Btn id="buy-reject" onClick={() => open({ kind: 'decide', action: 'reject' })}>
              ไม่อนุมัติ
            </Btn>
          </>
        )}
        {(o.status === 'approved' || o.status === 'cleared') && can('buy') && (
          <Btn id="buy-ordered" primary onClick={() => open({ kind: 'ordered' })}>
            บันทึกว่าซื้อแล้ว
          </Btn>
        )}
        {['pending', 'approved', 'cleared'].includes(o.status) && can('buy') && (
          <Btn id="buy-revise" onClick={() => open({ kind: 'revise' })}>
            ถอนกลับแก้ไข
          </Btn>
        )}
        {!['ordered', 'cancelled', 'rejected'].includes(o.status) && can('buy') && (
          <Btn id="buy-cancel" onClick={() => open({ kind: 'cancel' })}>
            ยกเลิกใบจัดซื้อ
          </Btn>
        )}
      </div>
      {o.decision && (
        <div className="buy-selection">
          <b>ผลพิจารณา</b>
          <p>
            {o.decision.person} · {date(o.decision.at)} · {money(o.decision.total, o.currency)}
          </p>
          <p>{o.decision.reason}</p>
        </div>
      )}
      {o.purchase && (
        <div className="review-feedback">
          <b>{receivingLabel(s, o)}</b>
          <p>
            หลักฐาน {o.purchase.reference} · {o.purchase.person} · {date(o.purchase.at)}
          </p>
          รับเข้าสะสม {num(o.purchase.receivedQty)} {o.unitSymbol} · ยังไม่ยืนยันค่าใช้จ่าย{' '}
          <a
            href="#receiving"
            onClick={(e) => {
              e.preventDefault();
              flow('receiving', o.id);
            }}
          >
            เปิดตรวจรับสินค้า →
          </a>
        </div>
      )}
      <section className="panel stock-history">
        <div className="panel-heading">
          <h3>ประวัติใบจัดซื้อ</h3>
        </div>
        <div className="buy-audit">
          {[...o.audit].reverse().map((a, i) => {
            const offer = a.offer as Offer | undefined;
            return (
              <article key={i}>
                <b>{a.action}</b>
                <p>
                  {a.person} · {date(a.at)}
                </p>
                {typeof a.reason === 'string' && <p>{a.reason}</p>}
                {typeof a.total === 'number' && <small>{money(a.total, o.currency)}</small>}
                {offer && (
                  <small>
                    {offer.vendor} · ราคาแพ็ก {money(offer.packPrice, o.currency)}
                  </small>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}

function BuyDialog({
  title,
  submitLabel = title,
  onClose,
  submit,
  children,
}: {
  title: string;
  submitLabel?: string;
  onClose: () => void;
  submit: (f: FormData, run: Run) => Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <ActionDialog
      open
      eyebrow="DALDAL / PURCHASING"
      title={title}
      submitLabel={submitLabel}
      onClose={onClose}
      submit={submit}
    >
      {children}
    </ActionDialog>
  );
}
const ReasonField = ({ label = 'เหตุผล *' }: { label?: string }) => (
  <Textarea label={label} name="reason" required maxLength={500} />
);
const ok = 'บันทึกเรียบร้อย';

function BuyModals({
  modal,
  order: o,
  close,
}: {
  modal: BuyModal;
  order?: PurchaseOrder;
  close: () => void;
}) {
  const { state: s } = useShop();
  const [, setParams] = useSearchParams();
  if (modal.kind === 'policy') return <PurchasePolicyDialog onClose={close} />;
  if (modal.kind === 'create') {
    const p = s.purchaseRequests.find((p) => p.id === modal.id);
    if (!p) return null;
    return (
      <BuyDialog
        title="เปิดใบจัดซื้อ"
        onClose={close}
        submit={async (f, run) => {
          const done = await run(
            'createOrder',
            { requestId: p.id, currency: str(f, 'currency') as 'THB' },
            ok,
          );
          if (done) setParams({ created: p.id }); // BuyPage opens the new order once the state arrives
          return done;
        }}
      >
        <h3>
          {p.name} · {num(p.qty)} {p.unitSymbol}
        </h3>
        <p className="muted">หนึ่งรายการเสนอซื้อเป็นหนึ่งใบ เปรียบเทียบหลายแหล่งซื้อได้</p>
        <FieldGrid>
          <Select
            label="สกุลเงิน *"
            name="currency"
            required
            defaultValue={s.purchasePolicy?.currency ?? ''}
            options={[['', 'เลือกสกุลเงิน'], ...currencies.map((c): [string, string] => [c, c])]}
          />
        </FieldGrid>
      </BuyDialog>
    );
  }
  if (!o) return null;
  if (modal.kind === 'offer') {
    const f = o.offers.find((x) => x.id === modal.id);
    const at = new Date(f ? f.quotedAt : Date.now());
    const local = new Date(at.getTime() + 7 * 3600_000).toISOString().slice(0, 16);
    return (
      <BuyDialog
        title={f ? 'แก้ไขทางเลือกซื้อ' : 'เพิ่มทางเลือกซื้อ'}
        submitLabel="บันทึกทางเลือก"
        onClose={close}
        submit={(d, run) =>
          run(
            'saveOffer',
            {
              orderId: o.id,
              offer: {
                id: f?.id,
                vendor: str(d, 'vendor'),
                packQty: str(d, 'packQty'),
                packPrice: str(d, 'packPrice'),
                shipping: str(d, 'shipping'),
                extra: str(d, 'extra'),
                discount: str(d, 'discount'),
                quotedAt: localInputToIso(str(d, 'quotedAt')),
                source: str(d, 'source'),
                conditions: str(d, 'conditions'),
              },
            },
            ok,
          )
        }
      >
        <p>
          {o.name} · ต้องการ {num(o.qty)} {o.unitSymbol} · {o.currency}
        </p>
        <FieldGrid>
          <Input
            label="ร้าน / แหล่งซื้อ *"
            name="vendor"
            required
            maxLength={100}
            defaultValue={f?.vendor}
          />
          <Input
            label={`จำนวน ${o.unitSymbol} ต่อชุดซื้อ *`}
            name="packQty"
            required
            inputMode="decimal"
            defaultValue={f?.packQty ?? ''}
          />
          <Input
            label="ราคาต่อชุดซื้อ รวมภาษี *"
            name="packPrice"
            required
            inputMode="decimal"
            defaultValue={f ? f.packPrice / 100 : ''}
          />
          <Input
            label="ค่าส่งทั้งใบ *"
            name="shipping"
            required
            inputMode="decimal"
            defaultValue={f ? f.shipping / 100 : '0'}
          />
          <Input
            label="ค่าใช้จ่ายเพิ่มทั้งใบ *"
            name="extra"
            required
            inputMode="decimal"
            defaultValue={f ? f.extra / 100 : '0'}
          />
          <Input
            label="ส่วนลดทั้งใบ *"
            name="discount"
            required
            inputMode="decimal"
            defaultValue={f ? f.discount / 100 : '0'}
          />
          <Input
            label="เวลาที่ตรวจราคา *"
            name="quotedAt"
            required
            type="datetime-local"
            defaultValue={local}
          />
          <Input
            label="ที่มาราคา / เลขอ้างอิง *"
            name="source"
            required
            maxLength={500}
            defaultValue={f?.source}
          />
          <Textarea
            label="เงื่อนไข / คูปอง / ระยะเวลาส่ง *"
            name="conditions"
            required
            maxLength={500}
            defaultValue={f?.conditions}
          />
        </FieldGrid>
        <p className="muted">
          กรอกข้อมูลที่ตรวจมาเอง ไม่มีราคาสด ระบบปัดจำนวนชุดซื้อขึ้น ไม่เลือกแหล่งซื้อแทนคน
        </p>
      </BuyDialog>
    );
  }
  if (modal.kind === 'select')
    return (
      <BuyDialog
        title="เลือกแหล่งซื้อ"
        onClose={close}
        submit={(d, run) =>
          run('selectOffer', { orderId: o.id, offerId: modal.id, reason: str(d, 'reason') }, ok)
        }
      >
        <p>ระบุเหตุผลที่เลือก รวมถึงกรณีมีแหล่งซื้อเดียวหรือเลือกที่ราคาไม่ต่ำสุด</p>
        <FieldGrid>
          <ReasonField />
        </FieldGrid>
      </BuyDialog>
    );
  if (modal.kind === 'source')
    return (
      <BuyDialog
        title="ทบทวนยอดและจำนวนซื้อ"
        submitLabel="บันทึกการทบทวน"
        onClose={close}
        submit={(d, run) =>
          run(
            'reviewOrderSource',
            {
              orderId: o.id,
              qty: str(d, 'qty'),
              reason: str(d, 'reason'),
              checked: bool(d, 'checked'),
            },
            ok,
          )
        }
      >
        <p>
          ยอดอ้างอิงปัจจุบัน{' '}
          {num(stockRows(s).find((r) => r.id === o.ingredientId)?.referenceQty ?? 0)} {o.unitSymbol}{' '}
          ให้ตรวจของจริงและความจำเป็นก่อนแก้จำนวน การทบทวนจะให้เลือกแหล่งซื้อใหม่
        </p>
        <FieldGrid>
          <Input
            label="จำนวนที่ยังต้องซื้อ *"
            name="qty"
            required
            inputMode="decimal"
            defaultValue={o.qty}
          />
          <ReasonField label="เหตุผล / สิ่งที่ตรวจ *" />
        </FieldGrid>
        <Check name="checked" required label="ตรวจยอดและความต้องการซื้อแล้ว" />
      </BuyDialog>
    );
  if (modal.kind === 'submit')
    return (
      <BuyDialog
        title="ส่งพิจารณา"
        onClose={close}
        submit={(_d, run) => run('submitOrder', { orderId: o.id }, ok)}
      >
        <p>{policyText(s.purchasePolicy)}</p>
      </BuyDialog>
    );
  if (modal.kind === 'decide') {
    const label =
      modal.action === 'approve'
        ? 'ยืนยันผลพิจารณา'
        : modal.action === 'return'
          ? 'ส่งกลับแก้ไข'
          : 'ไม่อนุมัติ';
    return (
      <BuyDialog
        title={label}
        onClose={close}
        submit={(d, run) =>
          run(
            'decideOrder',
            { orderId: o.id, decision: modal.action, reason: str(d, 'reason') },
            ok,
          )
        }
      >
        <p>ผู้พิจารณาต้องเป็น {s.purchasePolicy?.approver || ''} ตามบทบาทที่ตั้งไว้</p>
        <FieldGrid>
          <ReasonField />
        </FieldGrid>
      </BuyDialog>
    );
  }
  if (modal.kind === 'revise')
    return (
      <BuyDialog
        title="ถอนกลับแก้ไข"
        onClose={close}
        submit={(d, run) => run('reviseOrder', { orderId: o.id, reason: str(d, 'reason') }, ok)}
      >
        <p>ผลอนุมัติเดิมจะไม่ใช้ต่อ ต้องส่งพิจารณาใหม่</p>
        <FieldGrid>
          <ReasonField />
        </FieldGrid>
      </BuyDialog>
    );
  if (modal.kind === 'cancel')
    return (
      <BuyDialog
        title="ยกเลิกใบจัดซื้อ"
        onClose={close}
        submit={async (d, run) => {
          const done = await run('cancelOrder', { orderId: o.id, reason: str(d, 'reason') }, ok);
          if (done) setParams({});
          return done;
        }}
      >
        <p>เก็บประวัติเดิมไว้ สามารถเริ่มใบใหม่จากรายการเสนอซื้อได้</p>
        <FieldGrid>
          <ReasonField />
        </FieldGrid>
      </BuyDialog>
    );
  return (
    <BuyDialog
      title="บันทึกว่าซื้อภายนอกแล้ว"
      submitLabel="บันทึกซื้อแล้ว รอตรวจรับ"
      onClose={close}
      submit={(d, run) =>
        run(
          'markOrdered',
          { orderId: o.id, reference: str(d, 'reference'), checked: bool(d, 'checked') },
          ok,
        )
      }
    >
      <p>
        ใช้เมื่อซื้อจริงตามราคา จำนวน และแหล่งซื้อที่ผ่านพิจารณาแล้ว หากเปลี่ยน ให้ถอนกลับแก้ไขก่อน
      </p>
      <FieldGrid>
        <Input label="เลขคำสั่งซื้อ / หลักฐาน *" name="reference" required maxLength={100} wide />
      </FieldGrid>
      <Check name="checked" required label="ซื้อภายนอกแล้วตามรายละเอียดที่ผ่านพิจารณา" />
      <p className="muted">
        ปุ่มนี้บันทึกสถานะเท่านั้น ไม่สั่งซื้อ ไม่จ่ายเงิน และไม่เพิ่มสต็อก การตรวจรับเป็นรอบถัดไป
      </p>
    </BuyDialog>
  );
}
