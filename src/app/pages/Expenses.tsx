/**
 * บิลและค่าใช้จ่าย — same markup as legacy expense-ui.js.
 * Differences by design: no "ชื่อผู้ทำรายการ" inputs; evidence uploads go to private storage
 * (≤ 5 MB, verified by the server) instead of a 350 KB data URL; only the configured reviewer
 * (name + role) sees the confirm/return buttons.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  currencies,
  expenseCategories,
  expenseDuplicates,
  expenseStatuses,
  expenseTotals,
  expenseWarnings,
  isStoredAttachment,
  receivingLabel,
  roles,
  STORED_ATTACHMENT_MAX_BYTES,
  workflowTasks,
  type Expense,
  type ShopState,
} from '@/domain';
import { ApiError } from '../lib/api';
import { fmtDateTime, todayBangkok } from '../lib/format';
import { useBackend, useShop, useToast } from '../state';
import { Check, FieldGrid, Input, PageHeader, Select, Stat, Stats, Textarea } from '../ui';
import { ActionDialog, bool, opt, str, type Run } from './common';
import { Handoff, useFlow } from './Home';
import { ExpenseReviewerDialog } from './Settings';

const money = (n: number, c: string) =>
  `${(n / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ${c}`;
const date = (x: string | null | undefined) => (x ? fmtDateTime(x) : '—');
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
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

type Modal =
  | { kind: 'edit'; expense?: Expense; orderId?: string }
  | { kind: 'policy' }
  | { kind: 'submit'; expense: Expense }
  | { kind: 'confirm' | 'return' | 'cancel'; expense: Expense };

export function ExpensesPage() {
  const { state: s, can, me } = useShop();
  const demo = useBackend().mode === 'demo';
  const [params, setParams] = useSearchParams();
  const [modal, setModal] = useState<Modal | null>(null);
  const [filter, setFilter] = useState('all');
  const handled = useRef(false);
  const e = s.expenses.find((x) => x.id === params.get('id'));
  const p = s.expenseReviewer;

  useEffect(() => {
    const action = params.get('action'),
      id = params.get('id');
    if (handled.current || !action) return;
    handled.current = true;
    if (action === 'create' && id && can('expense')) setModal({ kind: 'edit', orderId: id });
    if (action === 'policy' && can('expenseSettings')) setModal({ kind: 'policy' });
    setParams({}, { replace: true });
  }, [params, setParams, can]);

  if (!can('expense'))
    return (
      <>
        <PageHeader eyebrow="EXPENSES" title="บิลและค่าใช้จ่าย" sub="งานหลักฐานและตรวจยอด" />
        <div className="panel empty">
          บทบาทพนักงานยังไม่เปิดข้อมูลค่าใช้จ่าย สิทธิ์นี้เปิดให้ผู้จัดการและเจ้าของ
        </div>
      </>
    );

  return (
    <>
      <PageHeader
        eyebrow="BILLS / EXPENSE REVIEW"
        title="บิลและค่าใช้จ่าย"
        sub="หลักฐาน → ร่าง → ตรวจยืนยัน → รวมยอด"
        actions={
          <div className="receive-actions">
            {e && (
              <Btn id="expense-back" onClick={() => setParams({})}>
                รายการทั้งหมด
              </Btn>
            )}
            <Btn id="expense-new" onClick={() => setModal({ kind: 'edit' })}>
              ＋ บันทึกค่าใช้จ่าย
            </Btn>
            {me.role === 'owner' && (
              <Btn id="expense-policy" onClick={() => setModal({ kind: 'policy' })}>
                ตั้งผู้ตรวจ
              </Btn>
            )}
          </div>
        }
      />
      {e && (
        <Handoff
          page="expenses"
          local="#expense-confirm,#expense-edit"
          tasks={
            e.status === 'confirmed'
              ? [
                  {
                    title: e.vendor,
                    status: 'ค่าใช้จ่ายยืนยันแล้ว',
                    done: 'รวมในรายงานตามวันที่บิลแล้ว · ไม่เพิ่มสต็อก',
                    who: 'ผู้จัดการ / เจ้าของ',
                    page: 'dashboard',
                    id: '',
                    action: '',
                    can: true,
                  },
                ]
              : workflowTasks(s, me.role).filter((t) => t.id === e.id)
          }
        />
      )}
      <div className="buy-policy">
        <b>{demo ? 'ผู้ตรวจทดลอง' : 'ผู้ตรวจค่าใช้จ่าย'}</b>
        <p>
          {p ? `${p.name} · ${roles[p.role]}` : 'ยังไม่ตั้งผู้ตรวจ เก็บร่างได้ แต่ส่งตรวจไม่ได้'}
        </p>
        <small>
          {demo ? 'บทบาทจำลอง ยังไม่ใช่การเข้าสู่ระบบจริง · ' : ''}AI อ่านบิลยังไม่เชื่อมต่อ
          ให้กรอกและตรวจจากหลักฐาน
        </small>
      </div>
      {e ? (
        <Detail s={s} e={e} open={setModal} />
      ) : (
        <Overview
          s={s}
          filter={filter}
          setFilter={setFilter}
          open={(id) => (setParams({ id }), window.scrollTo(0, 0))}
        />
      )}
      {modal && <ExpenseModal modal={modal} close={() => setModal(null)} />}
    </>
  );
}

function Overview({
  s,
  filter,
  setFilter,
  open,
}: {
  s: ShopState;
  filter: string;
  setFilter: (f: string) => void;
  open: (id: string) => void;
}) {
  const list = s.expenses.filter((e) => filter === 'all' || e.status === filter);
  const totals = Object.entries(expenseTotals(s));
  return (
    <>
      <Stats>
        <Stat
          label="ร่าง / ส่งกลับ"
          value={s.expenses.filter((e) => e.status === 'draft' || e.status === 'returned').length}
        />
        <Stat label="รอตรวจ" value={s.expenses.filter((e) => e.status === 'pending').length} />
        <Stat
          label="ยืนยันแล้ว"
          value={s.expenses.filter((e) => e.status === 'confirmed').length}
        />
      </Stats>
      <section className="panel expense-totals">
        <h3>ค่าใช้จ่ายที่ยืนยันแล้วทั้งหมด</h3>
        {totals.length ? (
          totals.map(([c, t]) => (
            <p key={c}>
              <b>{money(t!.total, c)}</b>
              <br />
              เงินร้าน {money(t!.shop, c)} · สำรองส่วนตัว {money(t!.personal, c)}
            </p>
          ))
        ) : (
          <p>ยังไม่มียอดยืนยัน</p>
        )}
        <small>
          แยกสกุลเงิน ไม่รวมร่าง/รอตรวจ/ยกเลิก · เงินสำรองเป็นแหล่งเงินที่จ่าย ไม่ใช่ยอดค้างคืน
          ระบบยังไม่ติดตามการคืนเงิน
        </small>
      </section>
      <section className="panel stock-history">
        <div className="panel-heading">
          <h3>รายการบิลและค่าใช้จ่าย</h3>
          <select
            id="expense-filter"
            aria-label="กรองสถานะค่าใช้จ่าย"
            value={filter}
            onChange={(ev) => setFilter(ev.target.value)}
          >
            {[['all', 'ทุกสถานะ'], ...Object.entries(expenseStatuses)].map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="expense-list">
          {list.length ? (
            [...list].reverse().map((e) => (
              <article className="expense-row" key={e.id}>
                <div>
                  <b>{e.vendor}</b>
                  <small>
                    {e.date} · {e.reference || 'ไม่มีเลขบิล'}
                  </small>
                  <small>
                    {e.category} · {e.funding === 'shop' ? 'เงินร้าน' : 'สำรองส่วนตัว'}
                  </small>
                </div>
                <div>
                  <b>{money(e.amount, e.currency)}</b>
                  <small>{expenseStatuses[e.status]}</small>
                  {expenseDuplicates(s, e).length > 0 && (
                    <small className="stock-warning">มีรายการสงสัยซ้ำ</small>
                  )}
                </div>
                <Btn onClick={() => open(e.id)}>ดูรายละเอียด</Btn>
              </article>
            ))
          ) : (
            <div className="empty">ยังไม่มีรายการในสถานะนี้</div>
          )}
        </div>
      </section>
    </>
  );
}

function Detail({ s, e, open }: { s: ShopState; e: Expense; open: (m: Modal) => void }) {
  const { me, shopId } = useShop();
  const { api } = useBackend();
  const toast = useToast();
  const flow = useFlow();
  const warnings = expenseWarnings(s, e);
  const o = s.purchaseOrders.find((x) => x.id === e.orderId);
  const r = s.expenseReviewer;
  const reviewer = !!r && r.name === me.displayName && r.role === me.role;
  const a = e.attachment;
  async function download() {
    if (!a) return;
    try {
      const url = isStoredAttachment(a)
        ? (await api.evidenceUrl(shopId, a.evidenceId)).url
        : a.data;
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: a.name,
        target: '_blank',
        rel: 'noopener',
      });
      link.click();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'เปิดหลักฐานไม่สำเร็จ', 'error');
    }
  }
  return (
    <>
      <div className="count-banner" data-current-expense={e.id}>
        <div>
          <h2>{e.vendor}</h2>
          <span className="chip">{expenseStatuses[e.status]}</span>
          <p>
            {e.date} · {e.reference || 'ไม่มีเลขบิล'}
          </p>
        </div>
        <div className="count-meta">
          <b>{money(e.amount, e.currency)}</b>
          <span>{e.category}</span>
        </div>
      </div>
      <section className="panel expense-totals">
        <p>
          <b>แหล่งเงิน:</b> {e.funding === 'shop' ? 'เงินร้าน' : 'สำรองส่วนตัว'} · ผู้จ่าย {e.payer}
        </p>
        <p>{e.note}</p>
        {o ? (
          <p>
            ใบซื้อ {o.purchase?.reference} · {o.name} · {receivingLabel(s, o)}
            <br />
            ยอดใบซื้อ {money(o.purchase!.total, o.currency)}{' '}
            <a
              href="#receiving"
              onClick={(ev) => {
                ev.preventDefault();
                flow('receiving', o.id);
              }}
            >
              ดูการตรวจรับ →
            </a>
          </p>
        ) : (
          <p>ค่าใช้จ่ายทั่วไป ไม่ผูกใบซื้อ</p>
        )}
        {a ? (
          <>
            <p>
              หลักฐาน: {a.name} ({Math.ceil(a.size / 1024)} KB)
            </p>
            <Btn id="expense-evidence" onClick={download}>
              ดาวน์โหลดหลักฐาน
            </Btn>
          </>
        ) : (
          <p>ไม่มีหลักฐาน: {e.noEvidenceReason}</p>
        )}
        <p className="muted">ข้อมูลกรอกด้วยคน · ยังไม่ใช้ AI อ่านบิล</p>
      </section>
      {warnings.length > 0 && (
        <div className="review-feedback">
          <b>รายการที่ต้องทบทวนก่อนยืนยัน</b>
          {warnings.map((t) => (
            <p key={t}>{t}</p>
          ))}
        </div>
      )}
      {e.feedback && <div className="review-feedback">ส่งกลับ: {e.feedback}</div>}
      {e.review && (
        <div className="buy-selection">
          ตรวจโดย {e.review.person} · {date(e.review.at)}
          <p>{e.review.note}</p>
        </div>
      )}
      {e.cancelReason && <div className="review-feedback">ยกเลิก: {e.cancelReason}</div>}
      <div className="receive-actions">
        {(e.status === 'draft' || e.status === 'returned') && (
          <>
            <Btn id="expense-edit" onClick={() => open({ kind: 'edit', expense: e })}>
              แก้ไขร่าง
            </Btn>
            <Btn id="expense-submit" onClick={() => open({ kind: 'submit', expense: e })}>
              ส่งตรวจ
            </Btn>
          </>
        )}
        {e.status === 'pending' &&
          (reviewer ? (
            <>
              <Btn id="expense-confirm" onClick={() => open({ kind: 'confirm', expense: e })}>
                ตรวจและยืนยัน
              </Btn>
              <Btn id="expense-return" onClick={() => open({ kind: 'return', expense: e })}>
                ส่งกลับแก้ไข
              </Btn>
            </>
          ) : (
            <span className="chip off">รอ {r?.name ?? 'ผู้ตรวจ'} ตรวจ</span>
          ))}
        {e.status !== 'cancelled' && (e.status !== 'confirmed' || me.role === 'owner') && (
          <Btn id="expense-cancel" onClick={() => open({ kind: 'cancel', expense: e })}>
            ยกเลิกรายการ
          </Btn>
        )}
      </div>
      <section className="panel expense-totals">
        <h3>ประวัติรายการ</h3>
        {[...e.audit].reverse().map((x, i) => (
          <p key={i}>
            <b>{x.action}</b> · {x.person} · {date(x.at)}
            <br />
            {x.note}
            {x.before && x.after && (
              <>
                <br />
                <small>
                  ยอดเดิม {money(x.before.amount, x.before.currency)} →{' '}
                  {money(x.after.amount, x.after.currency)} · แหล่งเงิน {x.before.funding} →{' '}
                  {x.after.funding}
                </small>
              </>
            )}
          </p>
        ))}
      </section>
    </>
  );
}

function ExpenseDialog({
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
      eyebrow="DALDAL / EXPENSES"
      title={title}
      submitLabel={submitLabel}
      onClose={onClose}
      submit={submit}
    >
      {children}
    </ActionDialog>
  );
}
const ok = 'บันทึกค่าใช้จ่ายแล้ว';

function ExpenseModal({ modal, close }: { modal: Modal; close: () => void }) {
  const { state: s } = useShop();
  if (modal.kind === 'policy') return <ExpenseReviewerDialog onClose={close} />;
  if (modal.kind === 'edit')
    return <EditExpense e={modal.expense} orderId={modal.orderId} s={s} close={close} />;
  const e = modal.expense;
  if (modal.kind === 'submit')
    return (
      <ExpenseDialog
        title="ส่งค่าใช้จ่ายให้ตรวจ"
        submitLabel="ส่งตรวจ"
        onClose={close}
        submit={(_f, run) => run('submitExpense', { expenseId: e.id }, ok)}
      >
        <p>
          {e.vendor} · {money(e.amount, e.currency)} ยังไม่รวมยอดจนกว่าคนตรวจยืนยัน
        </p>
      </ExpenseDialog>
    );
  const warnings = expenseWarnings(s, e);
  const action = modal.kind;
  return (
    <ExpenseDialog
      title={
        action === 'confirm'
          ? 'ตรวจยืนยันค่าใช้จ่าย'
          : action === 'return'
            ? 'ส่งกลับแก้ไข'
            : 'ยกเลิกค่าใช้จ่าย'
      }
      submitLabel={
        action === 'confirm'
          ? 'ยืนยันรวมค่าใช้จ่าย'
          : action === 'return'
            ? 'ส่งกลับ'
            : 'ยืนยันยกเลิก'
      }
      onClose={close}
      submit={(f, run) =>
        action === 'cancel'
          ? run('cancelExpense', { expenseId: e.id, note: str(f, 'note') }, ok)
          : run(
              'reviewExpense',
              {
                expenseId: e.id,
                decision: action,
                note: str(f, 'note'),
                checked: bool(f, 'checked'),
                exceptionsChecked: bool(f, 'exceptionsChecked'),
              },
              ok,
            )
      }
    >
      <p>
        {e.vendor} · {money(e.amount, e.currency)}
      </p>
      <Textarea
        label={action === 'confirm' ? 'ผลตรวจ / เหตุผลรับรองข้อสังเกต *' : 'เหตุผล *'}
        name="note"
        required
        maxLength={500}
      />
      {action === 'confirm' && (
        <>
          <Check name="checked" required label="ตรวจยอด วันที่ แหล่งเงิน และหลักฐานแล้ว" />
          {warnings.length > 0 && (
            <>
              <div className="review-feedback">
                {warnings.map((t) => (
                  <p key={t}>{t}</p>
                ))}
              </div>
              <Check
                name="exceptionsChecked"
                required
                label="ตรวจข้อสังเกตและรายการสงสัยซ้ำแล้ว อธิบายเหตุผลรับรองไว้ด้านบน"
              />
            </>
          )}
        </>
      )}
      <p className="muted">
        {action === 'cancel'
          ? 'เก็บประวัติไว้ รายการยกเลิกจะออกจากยอดรวม ไม่ใช่การคืนเงินจริง'
          : 'การยืนยันค่าใช้จ่ายไม่เพิ่มสต็อกและไม่โอนเงิน'}
      </p>
    </ExpenseDialog>
  );
}

function EditExpense({
  e,
  orderId,
  s,
  close,
}: {
  e?: Expense;
  orderId?: string;
  s: ShopState;
  close: () => void;
}) {
  const { api } = useBackend();
  const { shopId } = useShop();
  const [file, setFile] = useState<{ name: string } | null>(
    e?.attachment ? { name: e.attachment.name } : null,
  );
  const [removed, setRemoved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const orders = s.purchaseOrders.filter((o) => o.status === 'ordered');
  return (
    <ExpenseDialog
      title={e ? 'แก้ไขร่างค่าใช้จ่าย' : 'บันทึกค่าใช้จ่าย'}
      submitLabel="บันทึกร่าง"
      onClose={close}
      submit={async (f, run) => {
        const picked = input.current?.files?.[0];
        let evidenceId: string | null | undefined = undefined;
        if (picked) {
          if (picked.size > STORED_ATTACHMENT_MAX_BYTES || !TYPES.includes(picked.type))
            throw new Error('ใช้ภาพ/PDF ไม่เกิน 5 MB');
          try {
            evidenceId = await api.uploadEvidence(shopId, picked);
          } catch (err) {
            throw new Error(err instanceof ApiError ? err.message : 'อัปโหลดไฟล์หลักฐานไม่สำเร็จ');
          }
        } else if (removed) evidenceId = null;
        return run(
          'saveExpense',
          {
            id: e?.id,
            vendor: str(f, 'vendor'),
            reference: opt(f, 'reference'),
            date: str(f, 'date'),
            amount: str(f, 'amount'),
            currency: str(f, 'currency') as 'THB',
            category: str(f, 'category') as Expense['category'],
            funding: str(f, 'funding') as 'shop',
            payer: str(f, 'payer'),
            orderId: str(f, 'orderId') || null,
            note: str(f, 'note'),
            evidenceId,
            noEvidenceReason: opt(f, 'noEvidenceReason'),
          },
          ok,
        );
      }}
    >
      <p className="muted">
        แนบภาพ PNG/JPEG/WebP หรือ PDF ไม่เกิน 5 MB ต่อไฟล์ ไฟล์เก็บในที่เก็บหลักฐานของร้าน
        เปิดดูได้เฉพาะผู้จัดการและเจ้าของ
      </p>
      <label className="field">
        หลักฐาน (หนึ่งไฟล์ต่อรายการ)
        <input
          ref={input}
          id="expense-file"
          name="evidence"
          type="file"
          accept={TYPES.join(',')}
          onChange={(ev) => {
            const picked = ev.target.files?.[0];
            if (picked) (setFile({ name: picked.name }), setRemoved(false));
          }}
        />
      </label>
      <p id="expense-file-name">{file?.name || 'ยังไม่แนบไฟล์'}</p>
      <button
        type="button"
        className="secondary"
        id="expense-remove-file"
        onClick={() => {
          if (input.current) input.current.value = '';
          setFile(null);
          setRemoved(true);
        }}
      >
        นำไฟล์ออกจากร่าง
      </button>
      <div className="section-note">AI อ่านบิลยังไม่เชื่อมต่อ กรุณากรอกและทวนตัวเลขจากหลักฐาน</div>
      <FieldGrid>
        <Input
          label="ร้านค้า / ผู้รับเงิน *"
          name="vendor"
          required
          maxLength={100}
          defaultValue={e?.vendor}
        />
        <Input
          label="เลขบิล / เลขอ้างอิง"
          name="reference"
          maxLength={100}
          defaultValue={e?.reference}
        />
        <Input
          label="วันที่บิล *"
          name="date"
          required
          type="date"
          max={todayBangkok()}
          defaultValue={e?.date ?? ''}
        />
        <Input
          label="ยอดรวมทั้งบิล *"
          name="amount"
          required
          inputMode="decimal"
          placeholder="ไม่เติมยอดจากใบซื้ออัตโนมัติ"
          defaultValue={e ? (e.amount / 100).toFixed(2) : ''}
        />
        <Select
          label="สกุลเงิน"
          name="currency"
          defaultValue={e?.currency ?? 'THB'}
          options={currencies.map((x) => [x, x])}
        />
        <Select
          label="หมวดค่าใช้จ่าย"
          name="category"
          defaultValue={e?.category ?? 'วัตถุดิบ'}
          options={expenseCategories.map((x) => [x, x])}
        />
        <Select
          label="แหล่งเงิน"
          name="funding"
          defaultValue={e?.funding ?? 'shop'}
          options={[
            ['shop', 'เงินร้าน'],
            ['personal', 'สำรองส่วนตัว'],
          ]}
        />
        <Input
          label="ชื่อผู้จ่ายเงินจริง *"
          name="payer"
          required
          maxLength={80}
          defaultValue={e?.payer}
        />
        <Select
          label="เชื่อมใบซื้อ (ไม่จำเป็น)"
          name="orderId"
          defaultValue={e?.orderId ?? orderId ?? ''}
          options={[
            ['', 'ค่าใช้จ่ายทั่วไป'],
            ...orders.map((o): [string, string] => [
              o.id,
              (o.purchase?.reference ?? '') + ' · ' + o.name,
            ]),
          ]}
        />
        <Textarea
          label="รายละเอียดค่าใช้จ่าย *"
          name="note"
          required
          maxLength={500}
          defaultValue={e?.note}
        />
        <Textarea
          label="เหตุผล / หลักฐานทดแทน เมื่อไม่มีไฟล์"
          name="noEvidenceReason"
          maxLength={500}
          defaultValue={e?.noEvidenceReason}
        />
      </FieldGrid>
    </ExpenseDialog>
  );
}
