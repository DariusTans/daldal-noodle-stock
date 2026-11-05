/**
 * เคลื่อนไหวสต็อก / เตือนซื้อและรายการเสนอ — same markup as legacy stock-ui.js.
 * Difference by design: no "ชื่อผู้ทำรายการ" inputs — the server records the signed-in member.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  hasOpenCount,
  workflowTasks,
  movementKinds,
  stockRows,
  type MovementKind,
  type PurchaseRequest,
  type StockRow,
} from '@/domain';
import { fmtDateTime } from '../lib/format';
import { useShop, useToast } from '../state';
import { Check, Dialog, FieldGrid, Input, PageHeader, Select, Stat, Stats, Textarea } from '../ui';
import { ActionDialog, bool, opt, str, type Run } from './common';
import { Handoff, useFlow } from './Home';

const num = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n.toLocaleString('th-TH', { maximumFractionDigits: 3 });
const date = (x: string | null | undefined) => (x ? fmtDateTime(x) : '—');
const STOCK = 'DALDAL / STOCK';

const Mini = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" className="mini" onClick={onClick}>
    {children}
  </button>
);
const Note = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`section-note ${className}`}>
    <span className="note-icon">i</span>
    <span>{children}</span>
  </div>
);
const Reason = ({
  label = 'เหตุผล / รายละเอียด *',
  required = true,
  defaultValue,
}: {
  label?: string;
  required?: boolean;
  defaultValue?: string;
}) => (
  <Textarea
    label={label}
    name="reason"
    required={required}
    maxLength={500}
    defaultValue={defaultValue}
  />
);

function LockNotice() {
  const { state } = useShop();
  const flow = useFlow();
  return hasOpenCount(state) ? (
    <div className="review-feedback">
      <b>มีรอบนับที่ยังไม่จบ</b> กรุณายืนยันหรือยกเลิกรอบก่อนบันทึกเคลื่อนไหว ตรวจความครบ
      หรือทำรายการเสนอซื้อ{' '}
      <a
        href="#counting"
        onClick={(e) => {
          e.preventDefault();
          flow('counting');
        }}
      >
        เปิดรอบนับ →
      </a>
    </div>
  ) : null;
}

function Reference({ r }: { r: StockRow }) {
  const flow = useFlow();
  return r.base ? (
    <>
      <b>
        {num(r.referenceQty)} {r.unit.symbol}
      </b>
      <small>
        {r.check ? 'ยอดจากรายการที่ตรวจครบ' : 'ยอดนับล่าสุด'} · {date(r.referenceAt)}
      </small>
      <small>{r.check ? 'ตรวจโดย ' + r.check.person : 'ยังไม่รับรองข้อมูลเคลื่อนไหวครบ'}</small>
    </>
  ) : (
    <>
      <span className="chip off">ยังไม่มียอดยืนยัน</span>
      <small>
        <a
          href="#counting"
          onClick={(e) => {
            e.preventDefault();
            flow('counting');
          }}
        >
          เริ่มนับก่อน
        </a>
      </small>
    </>
  );
}

/** Legacy stock modal: eyebrow DALDAL / STOCK + form + actions. */
function StockDialog(props: {
  title: string;
  submitLabel: string;
  onClose: () => void;
  submit: (f: FormData, run: Run) => Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <ActionDialog
      open
      eyebrow={STOCK}
      title={props.title}
      submitLabel={props.submitLabel}
      onClose={props.onClose}
      submit={props.submit}
    >
      {props.children}
    </ActionDialog>
  );
}

type StockModal =
  | { kind: 'movement' }
  | { kind: 'check'; id: string }
  | { kind: 'policy'; id: string }
  | { kind: 'propose'; id: string }
  | { kind: 'reverse'; id: string }
  | { kind: 'review'; id: string }
  | { kind: 'refresh'; id: string }
  | { kind: 'cancel'; id: string }
  | { kind: 'audit' };

/** Open the dialog requested by a "ทำต่อ →" link (?id=&action=) once. */
function useActivate(open: (m: StockModal) => void) {
  const [params, setParams] = useSearchParams();
  const done = useRef(false);
  useEffect(() => {
    const id = params.get('id'),
      action = params.get('action');
    if (done.current || !id || !action) return;
    done.current = true;
    if (action === 'check') open({ kind: 'check', id });
    else if (action === 'propose') open({ kind: 'propose', id });
    else if (action === 'request') open({ kind: 'review', id });
    setParams({}, { replace: true });
  }, [params, setParams, open]);
}

export function MovementsPage() {
  const { state, can, me } = useShop();
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState<StockModal | null>(null);
  const historyRef = useRef<HTMLElement>(null);
  useActivate(setModal);
  const all = stockRows(state);
  const rows = all.filter((r) => r.active),
    has = rows.filter((r) => r.base),
    verified = has.filter((r) => r.check);
  const locked = hasOpenCount(state);

  return (
    <>
      <PageHeader
        eyebrow="STOCK / MOVEMENTS"
        title="เคลื่อนไหวสต็อก"
        sub="รับเข้า เบิกใช้ ของเสีย และปรับยอด พร้อมที่มาตรวจย้อนหลัง"
        actions={
          can('movement') && (
            <button
              id="add-movement"
              type="button"
              className="primary"
              onClick={() =>
                locked
                  ? toast('กรุณาจบรอบนับก่อนบันทึกเคลื่อนไหว')
                  : !has.length
                    ? toast('ต้องนับและยืนยันยอดตั้งต้นก่อน')
                    : setModal({ kind: 'movement' })
              }
            >
              ＋ บันทึกเคลื่อนไหว
            </button>
          )
        }
      />
      <Handoff
        page="movements"
        tasks={workflowTasks(state, me.role).filter(
          (t) => t.key.startsWith('check:') || t.key.startsWith('low:'),
        )}
      />
      <LockNotice />
      <Stats>
        <Stat label="มียอดนับยืนยัน" value={has.length} unit="รายการ" />
        <Stat label="ตรวจเคลื่อนไหวครบถึงเวลาที่ระบุ" value={verified.length} unit="รายการ" />
        <Stat label="ยังรอตรวจความครบ" value={has.length - verified.length} unit="รายการ" />
      </Stats>
      <Note className="stock-note">
        ยอดอ้างอิงใช้ยอดนับล่าสุดจนกว่าคนจะตรวจข้อมูลเคลื่อนไหวครบ เมื่อมีรายการใหม่ต้องตรวจอีกครั้ง
        ยอดนี้ไม่ใช่สต็อกเรียลไทม์ และไม่หักจากยอดขาย
      </Note>
      <section className="panel">
        <div className="panel-heading">
          <h3>ยอดและความครบของข้อมูล</h3>
          <span className="muted">หน่วยเดียวกับทะเบียน</span>
        </div>
        <div className="table-wrap">
          <table className="stock-table">
            <thead>
              <tr>
                <th>วัตถุดิบ</th>
                <th>ยอดอ้างอิงสำหรับเตือนซื้อ</th>
                <th>คำนวณจากรายการที่บันทึก</th>
                <th>ตรวจสอบ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                    <small>
                      {r.code} · {r.location}
                    </small>
                  </td>
                  <td>
                    <Reference r={r} />
                  </td>
                  <td>
                    {r.base ? (
                      <>
                        <b>
                          {num(r.ledger)} {r.unit.symbol}
                        </b>
                        <small>
                          นับ {num(r.base.qty)} {r.net < 0 ? '−' : '+'} เคลื่อนไหว{' '}
                          {num(Math.abs(r.net))}
                        </small>
                        <small>
                          {r.check
                            ? 'ตรวจครบถึง ' + date(r.check.at)
                            : 'ยังไม่ใช้ยอดคำนวณนี้แจ้งเตือน'}
                        </small>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <div className="stock-buttons">
                      <Mini
                        onClick={() => {
                          setFilter(r.id);
                          historyRef.current?.scrollIntoView({ behavior: 'smooth' });
                        }}
                      >
                        ดูรายการ
                      </Mini>
                      {r.base && can('stockReview') && !locked && (
                        <Mini onClick={() => setModal({ kind: 'check', id: r.id })}>
                          ตรวจความครบ
                        </Mini>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel stock-history" ref={historyRef}>
        <div className="panel-heading">
          <h3>ประวัติเคลื่อนไหว</h3>
          <select
            id="movement-filter"
            aria-label="กรองประวัติวัตถุดิบ"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">ทุกวัตถุดิบ</option>
            {all.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <MovementHistory filter={filter} onReverse={(id) => setModal({ kind: 'reverse', id })} />
      </section>
      <StockModals modal={modal} close={() => setModal(null)} />
    </>
  );
}

function MovementHistory({
  filter,
  onReverse,
}: {
  filter: string;
  onReverse: (id: string) => void;
}) {
  const { state, can } = useShop();
  const flow = useFlow();
  const rows = stockRows(state);
  const list = state.movements
    .filter((m) => !filter || m.ingredientId === filter)
    .slice()
    .reverse();
  if (!list.length)
    return (
      <div className="empty">
        <strong>ยังไม่มีรายการเคลื่อนไหว</strong>เริ่มจากยอดนับที่ยืนยันแล้ว
        บันทึกตามของจริงที่รับหรือใช้
      </div>
    );
  return (
    <div className="table-wrap">
      <table className="movement-table">
        <thead>
          <tr>
            <th>เวลา / ผู้บันทึก</th>
            <th>วัตถุดิบ / รอบ</th>
            <th>ประเภท / จำนวน</th>
            <th>เหตุผล / อ้างอิง</th>
            <th>จัดการ</th>
          </tr>
        </thead>
        <tbody>
          {list.map((m) => {
            const reversed = state.movements.some((x) => x.reverseOf === m.id),
              current = rows.find((r) => r.id === m.ingredientId)?.base?.roundId === m.roundId;
            return (
              <tr key={m.id}>
                <td>
                  {date(m.at)}
                  <small>{m.person}</small>
                </td>
                <td>
                  <b>{m.name}</b>
                  <small>{state.countRounds.find((r) => r.id === m.roundId)?.title || ''}</small>
                </td>
                <td>
                  <span className={`chip ${m.delta < 0 ? 'off' : ''}`}>
                    {movementKinds[m.kind]}
                  </span>
                  <small>
                    <b>
                      {m.delta > 0 ? '+' : ''}
                      {num(m.delta)} {m.unitSymbol}
                    </b>
                  </small>
                  {reversed && <small>กลับรายการแล้ว</small>}
                </td>
                <td>
                  <span className="stock-reason">{m.reason}</span>
                  <small>{m.reference || 'ไม่มีเลขอ้างอิง'}</small>
                  {m.reverseOf && <small>อ้างอิง {m.reverseOf}</small>}
                </td>
                <td>
                  {can('adjust') &&
                  !m.receiptId &&
                  current &&
                  !hasOpenCount(state) &&
                  m.kind !== 'reverse' &&
                  !reversed ? (
                    <Mini onClick={() => onReverse(m.id)}>กลับรายการ</Mini>
                  ) : m.receiptId ? (
                    <a
                      href="#receiving"
                      onClick={(e) => {
                        e.preventDefault();
                        flow('receiving');
                      }}
                    >
                      ดูใบรับ →
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StockModals({ modal, close }: { modal: StockModal | null; close: () => void }) {
  const { state, can } = useShop();
  if (!modal) return null;
  const rows = stockRows(state);
  const row = (id: string) => rows.find((r) => r.id === id)!;
  const ok = 'บันทึกเรียบร้อย';

  if (modal.kind === 'movement') {
    const options = rows.filter((r) => r.active && r.base);
    return (
      <StockDialog
        title="บันทึกเคลื่อนไหว"
        submitLabel="บันทึกรายการ"
        onClose={close}
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
            ok,
          )
        }
      >
        <p className="muted">
          สินค้าจากใบซื้อให้บันทึกที่หน้าตรวจรับสินค้า เพื่อเชื่อมยอดรับกับใบซื้อ บันทึก ณ เวลานี้
          หลังยอดนับที่ยืนยัน ห้ามลงซ้ำของที่รวมอยู่ในยอดนับแล้ว หากตกหล่นก่อนรอบนับ
          ให้ตรวจของจริงและปรับยอดพร้อมเหตุผล
        </p>
        <FieldGrid>
          <Select
            label="วัตถุดิบ *"
            name="ingredientId"
            wide
            options={options.map((r) => [r.id, `${r.name} (${r.unit.symbol})`])}
          />
          <Select
            label="ประเภท *"
            name="kind"
            options={(Object.entries(movementKinds) as Array<[MovementKind, string]>).filter(
              ([k]) => k !== 'reverse' && (!['increase', 'decrease'].includes(k) || can('adjust')),
            )}
          />
          <Input label="จำนวน *" name="qty" required inputMode="decimal" placeholder="มากกว่า 0" />
          <Input label="เลขอ้างอิง / หลักฐาน" name="reference" maxLength={100} />
          <Reason />
        </FieldGrid>
      </StockDialog>
    );
  }
  if (modal.kind === 'check') {
    const r = row(modal.id);
    return (
      <StockDialog
        title="ตรวจความครบของข้อมูล"
        submitLabel="ยืนยันว่าข้อมูลครบ"
        onClose={close}
        submit={(f, run) =>
          run(
            'reviewLedger',
            { ingredientId: r.id, note: str(f, 'reason'), complete: bool(f, 'checked') },
            ok,
          )
        }
      >
        <h3>{r.name}</h3>
        <p>
          จากยอดนับ {num(r.base?.qty)} {r.unit.symbol} เมื่อ {date(r.base?.countedAt)} รวม{' '}
          {r.movements.length} รายการ ได้ {num(r.ledger)} {r.unit.symbol}
        </p>
        <p className="muted">
          ตรวจว่ามีรับเข้า เบิกใช้ ของเสีย และปรับยอดครบถึงขณะนี้ ถ้ายังไม่ครบ
          ให้ปิดหน้าต่างและคงใช้ยอดนับล่าสุด
        </p>
        <FieldGrid>
          <Reason label="ขอบเขต / หลักฐานที่ตรวจ *" />
        </FieldGrid>
        <Check name="checked" required label="ตรวจรายการครบตั้งแต่ยอดนับอ้างอิงถึงเวลานี้แล้ว" />
      </StockDialog>
    );
  }
  if (modal.kind === 'policy') {
    const r = row(modal.id),
      p = r.policy;
    return (
      <StockDialog
        title="ตั้งจุดเตือนซื้อ"
        submitLabel="บันทึกจุดเตือน"
        onClose={close}
        submit={(f, run) =>
          run(
            'savePolicy',
            {
              ingredientId: r.id,
              minimum: str(f, 'minimum'),
              target: str(f, 'target'),
              enabled: bool(f, 'enabled'),
            },
            ok,
          )
        }
      >
        <h3>
          {r.name} · {r.unit.symbol}
        </h3>
        <p className="muted">
          เตือนเมื่อยอดอ้างอิง ≤ จุดเตือน จำนวนเสนอ = ยอดเป้าหมาย − ยอดอ้างอิง
          เป็นค่าทดลองที่ร้านตั้งเอง
        </p>
        <FieldGrid>
          <Input
            label="จุดเตือน *"
            name="minimum"
            required
            inputMode="decimal"
            defaultValue={p?.minimum ?? ''}
          />
          <Input
            label="ยอดเป้าหมายหลังเติม *"
            name="target"
            required
            inputMode="decimal"
            defaultValue={p?.target ?? ''}
          />
        </FieldGrid>
        <Check name="enabled" defaultChecked={!p || p.enabled} label="เปิดแจ้งเตือนในระบบ" />
      </StockDialog>
    );
  }
  if (modal.kind === 'propose') {
    const r = row(modal.id);
    return (
      <StockDialog
        title="สร้างร่างเสนอซื้อ"
        submitLabel="สร้างร่างเสนอซื้อ"
        onClose={close}
        submit={(_f, run) => run('createRequest', { ingredientId: r.id }, ok)}
      >
        <p>
          {r.name} เสนอ {num(r.suggested)} {r.unit.symbol} จากยอดอ้างอิง {num(r.referenceQty)} ณ{' '}
          {date(r.referenceAt)} ต้องให้ผู้ตรวจยืนยันจำนวนอีกครั้ง
        </p>
      </StockDialog>
    );
  }
  if (modal.kind === 'reverse')
    return (
      <StockDialog
        title="กลับรายการ"
        submitLabel="กลับรายการ"
        onClose={close}
        submit={(f, run) =>
          run('reverseMovement', { movementId: modal.id, reason: str(f, 'reason') }, ok)
        }
      >
        <p>เพิ่มรายการหักล้างพร้อมเหตุผล โดยเก็บรายการเดิมไว้</p>
        <FieldGrid>
          <Reason />
        </FieldGrid>
      </StockDialog>
    );
  const request = (id: string) => state.purchaseRequests.find((p) => p.id === id)!;
  if (modal.kind === 'review') {
    const p = request(modal.id);
    if (!p) return null;
    return (
      <StockDialog
        title="ตรวจจำนวนเสนอซื้อ"
        submitLabel="ยืนยันรายการ รอจัดซื้อ"
        onClose={close}
        submit={(f, run) =>
          run(
            'reviewRequest',
            {
              requestId: p.id,
              qty: str(f, 'qty'),
              reason: opt(f, 'reason'),
              checked: bool(f, 'checked'),
            },
            ok,
          )
        }
      >
        <h3>{p.name}</h3>
        <p>
          เสนอ {num(p.suggested)} {p.unitSymbol} จากยอด {num(p.referenceQty)} ณ{' '}
          {date(p.referenceAt)}
        </p>
        <FieldGrid>
          <Input
            label="จำนวนที่ตรวจแล้ว *"
            name="qty"
            required
            inputMode="decimal"
            defaultValue={p.qty}
          />
          <Reason label="เหตุผลเมื่อเปลี่ยนจำนวน" required={false} defaultValue={p.reason} />
        </FieldGrid>
        <Check name="checked" required label="ตรวจของจริง ยอดอ้างอิง และจำนวนที่ต้องซื้อแล้ว" />
        <p className="muted">ขั้นนี้เตรียมรายการให้จัดซื้อ ยังไม่ใช่การอนุมัติเงินหรือสั่งซื้อ</p>
      </StockDialog>
    );
  }
  if (modal.kind === 'refresh')
    return (
      <StockDialog
        title="อัปเดตร่าง"
        submitLabel="อัปเดตร่าง"
        onClose={close}
        submit={(_f, run) => run('refreshRequest', { requestId: modal.id }, ok)}
      >
        <p>คำนวณจำนวนเสนอใหม่จากยอดอ้างอิงและจุดเตือนปัจจุบัน</p>
      </StockDialog>
    );
  if (modal.kind === 'cancel')
    return (
      <StockDialog
        title="ยกเลิกรายการเสนอซื้อ"
        submitLabel="ยกเลิกรายการเสนอซื้อ"
        onClose={close}
        submit={(f, run) =>
          run('cancelRequest', { requestId: modal.id, reason: str(f, 'reason') }, ok)
        }
      >
        <p>เก็บประวัติเดิมไว้ และสามารถสร้างร่างใหม่ได้</p>
        <FieldGrid>
          <Reason />
        </FieldGrid>
      </StockDialog>
    );
  return <StockAudit onClose={close} />;
}

function StockAudit({ onClose }: { onClose: () => void }) {
  const { state } = useShop();
  const target = (id: string) =>
    state.ingredients.find((i) => i.id === id)?.name ||
    state.movements.find((m) => m.id === id)?.name ||
    state.purchaseRequests.find((p) => p.id === id)?.name ||
    id;
  const list = [...state.stockAudit].reverse();
  return (
    <Dialog open onClose={onClose} eyebrow={STOCK} title="ประวัติสต็อกและเสนอซื้อ">
      <div className="activity">
        {list.length ? (
          list.map((a) => {
            const before = a.before as { minimum?: number; target?: number } | null | undefined;
            const after = a.after as
              { minimum: number; target: number; enabled: boolean } | undefined;
            return (
              <section className="audit-entry" key={a.id}>
                <b>{a.action}</b>
                <p>{target(a.target)}</p>
                <p>
                  {a.person} · {date(a.at)}
                </p>
                {typeof a.reason === 'string' && <p>{a.reason}</p>}
                {typeof a.note === 'string' && <p>{a.note}</p>}
                {after && (
                  <p>
                    จุดเตือน {num(before?.minimum ?? null)} → {num(after.minimum)} / เป้าหมาย{' '}
                    {num(before?.target ?? null)} → {num(after.target)} ·{' '}
                    {after.enabled ? 'เปิด' : 'ปิด'}เตือน
                  </p>
                )}
              </section>
            );
          })
        ) : (
          <p className="muted">ยังไม่มีประวัติ</p>
        )}
      </div>
    </Dialog>
  );
}

export function AlertsPage() {
  const { state, can, me } = useShop();
  const [modal, setModal] = useState<StockModal | null>(null);
  useActivate(setModal);
  const rows = stockRows(state).filter((r) => r.active),
    low = rows.filter((r) => r.low),
    pending = state.purchaseRequests.filter((p) => !['cancelled', 'completed'].includes(p.status));
  const locked = hasOpenCount(state);

  return (
    <>
      <PageHeader
        eyebrow="STOCK / REPLENISHMENT"
        title="เตือนซื้อและรายการเสนอ"
        sub="ตั้งเกณฑ์จากร้าน ตรวจจำนวน แล้วเตรียมส่งต่องานจัดซื้อ"
      />
      <Handoff
        page="alerts"
        tasks={workflowTasks(state, me.role).filter((t) => t.key.startsWith('request:'))}
      />
      <LockNotice />
      <Stats>
        <Stat label="ถึงจุดเตือนซื้อ" value={low.length} unit="รายการ" />
        <Stat
          label="ยังไม่ตั้งจุดเตือน"
          value={rows.filter((r) => !r.policy).length}
          unit="รายการ"
        />
        <Stat label="รายการเสนอซื้อค้าง" value={pending.length} unit="รายการ" />
      </Stats>
      <section className="panel">
        <div className="panel-heading">
          <h3>เกณฑ์และสถานะวัตถุดิบ</h3>
          <span className="muted">ตรวจรายการแล้วทำต่อที่เมนูจัดซื้อ</span>
        </div>
        <div className="table-wrap">
          <table className="stock-table alert-table">
            <thead>
              <tr>
                <th>วัตถุดิบ</th>
                <th>ยอดอ้างอิง / เวลา</th>
                <th>จุดเตือน → เป้าหมาย</th>
                <th>เสนอเติม</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const request = pending.find((p) => p.ingredientId === r.id);
                return (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      <small>
                        <span className={`chip ${r.low ? 'stock-low' : 'off'}`}>
                          {!r.base
                            ? 'ยังไม่มียอด'
                            : !r.policy
                              ? 'ยังไม่ตั้งเกณฑ์'
                              : !r.policy.enabled
                                ? 'ปิดเตือน'
                                : r.low
                                  ? 'ถึงจุดเตือน'
                                  : 'สูงกว่าจุดเตือน'}
                        </span>
                      </small>
                    </td>
                    <td>
                      <Reference r={r} />
                    </td>
                    <td>
                      {r.policy ? (
                        <>
                          {num(r.policy.minimum)} → {num(r.policy.target)}
                          <small>{r.unit.symbol}</small>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {r.low ? (
                        <b>
                          {num(r.suggested)} {r.unit.symbol}
                        </b>
                      ) : (
                        '—'
                      )}
                      {request && <small>มีรายการเสนอซื้อค้างแล้ว</small>}
                    </td>
                    <td>
                      <div className="stock-buttons">
                        {can('policy') && (
                          <Mini onClick={() => setModal({ kind: 'policy', id: r.id })}>
                            ตั้งเกณฑ์
                          </Mini>
                        )}
                        {r.low && !request && can('request') && !locked && (
                          <Mini onClick={() => setModal({ kind: 'propose', id: r.id })}>
                            ร่างเสนอซื้อ
                          </Mini>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <Note>
        เตือนในระบบเมื่อยอด ≤ จุดเตือน ถ้าข้อมูลเคลื่อนไหวยังไม่ครบ
        ยอดอ้างอิงเป็นยอดนับเก่าตามเวลาที่แสดง ต้องตรวจของจริงก่อนเสนอซื้อ ไม่มีการแจ้ง LINE
        หรือดึงราคาจากร้านค้า
      </Note>
      <section className="panel stock-history">
        <div className="panel-heading">
          <h3>รายการเสนอซื้อ</h3>
          <Mini onClick={() => setModal({ kind: 'audit' })}>ประวัติการทำรายการ</Mini>
        </div>
        <Requests open={setModal} />
      </section>
      <Note>
        “ตรวจแล้ว รอจัดซื้อ” หมายถึงตรวจรายการและจำนวนแล้ว ยังไม่อนุมัติค่าใช้จ่ายหรือสั่งซื้อ
        เปิดเมนูจัดซื้อและอนุมัติเพื่อทำต่อ
      </Note>
      <StockModals modal={modal} close={() => setModal(null)} />
    </>
  );
}

function requestStatus(p: PurchaseRequest, linkedStatus?: string) {
  return p.status === 'draft'
    ? 'รอตรวจจำนวน'
    : p.status === 'ready'
      ? linkedStatus === 'ordered'
        ? 'ซื้อแล้ว รอตรวจรับ'
        : linkedStatus
          ? 'อยู่ระหว่างจัดซื้อ'
          : 'ตรวจแล้ว รอจัดซื้อ'
      : p.status === 'completed'
        ? 'รับสินค้าเสร็จสิ้น'
        : 'ยกเลิก';
}

function Requests({ open }: { open: (m: StockModal) => void }) {
  const { state, can } = useShop();
  const flow = useFlow();
  const rows = stockRows(state);
  if (!state.purchaseRequests.length)
    return (
      <div className="empty">
        <strong>ยังไม่มีรายการเสนอซื้อ</strong>ตั้งจุดเตือนและกดร่างเสนอซื้อในรายการที่เข้าเกณฑ์
      </div>
    );
  return (
    <div className="table-wrap">
      <table className="stock-table">
        <thead>
          <tr>
            <th>วัตถุดิบ / จำนวน</th>
            <th>ยอดอ้างอิง</th>
            <th>สถานะ / ผู้ทำรายการ</th>
            <th>จัดการ</th>
          </tr>
        </thead>
        <tbody>
          {[...state.purchaseRequests].reverse().map((p) => {
            const linked = state.purchaseOrders.find(
              (o) => o.requestId === p.id && !['cancelled', 'rejected'].includes(o.status),
            );
            const r = rows.find((r) => r.id === p.ingredientId)!;
            const stale = r.fingerprint !== p.fingerprint || !r.active || !r.low;
            const open_ = !['cancelled', 'completed'].includes(p.status);
            return (
              <tr key={p.id}>
                <td>
                  <b>{p.name}</b>
                  <small>
                    {num(p.qty)} {p.unitSymbol}
                  </small>
                  {p.reason && <small>{p.reason}</small>}
                </td>
                <td>
                  {num(p.referenceQty)} {p.unitSymbol}
                  <small>
                    {p.referenceBasis === 'ledger' ? 'รายการตรวจครบ' : 'ยอดนับล่าสุด'} ·{' '}
                    {date(p.referenceAt)}
                  </small>
                </td>
                <td>
                  <span className={`chip ${p.status === 'draft' ? 'review' : 'off'}`}>
                    {requestStatus(p, linked?.status)}
                  </span>
                  <small>
                    {p.reviewedBy || p.person} · {date(p.reviewedAt || p.at)}
                  </small>
                  {stale && open_ && (
                    <small className="stock-warning">ข้อมูลต้นทางเปลี่ยน ต้องทบทวนก่อนซื้อ</small>
                  )}
                  {linked && can('buy') && (
                    <small>
                      <a
                        href="#buy"
                        onClick={(e) => {
                          e.preventDefault();
                          flow('buy', linked.id);
                        }}
                      >
                        เปิดงานจัดซื้อ →
                      </a>
                    </small>
                  )}
                  {p.cancelReason && <small>{p.cancelReason}</small>}
                </td>
                <td>
                  <div className="stock-buttons">
                    {p.status === 'draft' && !hasOpenCount(state) && (
                      <>
                        {can('requestReview') && (
                          <Mini onClick={() => open({ kind: 'review', id: p.id })}>ตรวจจำนวน</Mini>
                        )}
                        {stale && can('request') && (
                          <Mini onClick={() => open({ kind: 'refresh', id: p.id })}>
                            อัปเดตร่าง
                          </Mini>
                        )}
                      </>
                    )}
                    {open_ && can('requestReview') && (
                      <Mini onClick={() => open({ kind: 'cancel', id: p.id })}>ยกเลิก</Mini>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
