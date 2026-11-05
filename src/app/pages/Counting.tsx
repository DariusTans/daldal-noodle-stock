/**
 * นับและยืนยันสต็อก / ยอดนับล่าสุด — same markup as legacy counts-ui.js.
 * Difference by design: no "ชื่อผู้บันทึก / ผู้ตรวจ" inputs — the server records the signed-in member.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  latestCounts,
  parseQuantity,
  roles,
  workflowTasks,
  type CountLine,
  type CountRound,
} from '@/domain';
import { fmtDateTime } from '../lib/format';
import { useAction, useShop } from '../state';
import { Dialog, FieldGrid, FormError, Input, PageHeader, Textarea } from '../ui';
import { ActionDialog, str } from './common';
import { Handoff, useFlow } from './Home';

const LABEL = {
  draft: 'กำลังนับ',
  review: 'รอตรวจยืนยัน',
  confirmed: 'ยืนยันแล้ว',
  cancelled: 'ยกเลิก',
} as const;
const number = (n: number | null) =>
  n === null ? 'ยังไม่ได้นับ' : n.toLocaleString('th-TH', { maximumFractionDigits: 3 });
const fmt = (t: string | null | undefined) => (t ? fmtDateTime(t) : '—');
const Phase = ({ r }: { r: CountRound }) => (
  <span
    className={`chip ${r.status === 'review' ? 'review' : r.status === 'draft' ? 'draft' : r.status === 'cancelled' ? 'off' : ''}`}
  >
    {LABEL[r.status]}
  </span>
);
const Note = ({ children }: { children: React.ReactNode }) => (
  <div className="section-note">
    <span className="note-icon">i</span>
    <span>{children}</span>
  </div>
);

export function CountingPage() {
  const { state, can, me } = useShop();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const active = state.countRounds.find((r) => r.status === 'draft' || r.status === 'review');
  const listMode = params.get('view') === 'list';
  const selected =
    state.countRounds.find((r) => r.id === params.get('id')) ?? (listMode ? undefined : active);
  const [dirty, setDirty] = useState(false);
  const leave = () =>
    !dirty || window.confirm('มีข้อมูลที่ยังไม่บันทึก\nต้องการทิ้งการแก้ไขในตารางนี้หรือไม่?');
  const open = (id: string) => leave() && (setDirty(false), setParams({ id }));

  return (
    <>
      <PageHeader
        eyebrow="STOCK / COUNT & REVIEW"
        title="นับและยืนยันสต็อก"
        sub="นับของจริง ส่งตรวจ แล้วเก็บยอดพร้อมเวลาที่ตรวจสอบ"
        actions={
          <div className="count-actions">
            <button
              id="count-history"
              type="button"
              className="secondary"
              onClick={() => leave() && (setDirty(false), setParams({ view: 'list' }))}
            >
              ประวัติรอบนับ
            </button>
            {can('count') && (
              <button
                id="new-count"
                type="button"
                className="primary"
                onClick={() => (active ? open(active.id) : leave() && setCreating(true))}
              >
                ＋ เริ่มรอบนับ
              </button>
            )}
          </div>
        }
      />
      <Handoff
        page="counting"
        local="#confirm-count,#save-count"
        tasks={
          selected?.status === 'confirmed' && !listMode
            ? [
                {
                  title: selected.title,
                  status: 'ยอดนับยืนยันแล้ว',
                  done: 'รอบนี้ล็อกแล้ว · ยอดรับ/เบิกถัดไปจะอ้างอิงรอบนี้',
                  who: 'พนักงาน / ผู้จัดการ',
                  page: 'movements',
                  id: '',
                  action: '',
                  can: true,
                },
              ]
            : workflowTasks(state, me.role).filter(
                (t) => t.page === 'counting' && (!selected || listMode || selected.id === t.id),
              )
        }
      />
      {selected && !listMode ? (
        <RoundDetail
          key={selected.id + ':' + selected.audit.length}
          round={selected}
          onDirty={setDirty}
        />
      ) : (
        <RoundList active={active} open={open} />
      )}
      {creating && (
        <ActionDialog
          open
          onClose={() => setCreating(false)}
          eyebrow="STOCK COUNT"
          title="เริ่มรอบนับใหม่"
          submitLabel="เปิดรอบนับ"
          submit={async (f, run) => {
            const ok = await run('startCount', { title: str(f, 'title') }, 'เปิดรอบนับแล้ว');
            if (ok) setParams({});
            return ok;
          }}
        >
          <FieldGrid>
            <Input
              label="ชื่อรอบนับ *"
              name="title"
              wide
              required
              maxLength={100}
              defaultValue={
                'นับสต็อก ' + new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })
              }
            />
          </FieldGrid>
          <p className="muted">
            {state.ingredients.filter((i) => i.active).length} รายการที่เปิดใช้งาน ·
            จำนวนเริ่มต้นเป็นช่องว่างทั้งหมด
          </p>
        </ActionDialog>
      )}
    </>
  );
}

function RoundList({ active, open }: { active?: CountRound; open: (id: string) => void }) {
  const { state } = useShop();
  return (
    <>
      {active && (
        <div className="count-banner">
          <div>
            <b>มีรอบที่ยังไม่จบ: {active.title}</b>
            <p>ทำต่อจากยอดที่บันทึกไว้ได้</p>
          </div>
          <button className="primary" type="button" onClick={() => open(active.id)}>
            เปิดรอบที่ค้าง
          </button>
        </div>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h3>รอบนับทั้งหมด</h3>
          <span className="muted">{state.countRounds.length} รอบ</span>
        </div>
        {state.countRounds.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ชื่อรอบ</th>
                  <th>สถานะ</th>
                  <th>นับแล้ว</th>
                  <th>เปิดโดย / เวลาไทย</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {[...state.countRounds].reverse().map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.title}</b>
                    </td>
                    <td>
                      <Phase r={r} />
                    </td>
                    <td>
                      {r.lines.filter((l) => l.qty !== null).length} / {r.lines.length}
                    </td>
                    <td>
                      {r.createdBy}
                      <small>{fmt(r.createdAt)}</small>
                    </td>
                    <td>
                      <button className="mini" type="button" onClick={() => open(r.id)}>
                        {r.status === 'draft' || r.status === 'review' ? 'ทำต่อ' : 'ดูรายละเอียด'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty count-empty">
            <span className="count-empty-icon">✓</span>
            <strong>เริ่มนับสต็อกรอบแรก</strong>ระบบจะดึงวัตถุดิบที่เปิดใช้งานจากทะเบียน
            <br />
            ช่องว่างหมายถึงยังไม่ได้นับ ส่วน 0 หมายถึงไม่มีของจริง
          </div>
        )}
      </section>
      <Note>
        เปิดได้ครั้งละหนึ่งรอบ วัตถุดิบและหน่วยจะถูกเก็บตามวันที่เปิดรอบ
        เพื่อให้ประวัติไม่เปลี่ยนเมื่อแก้ทะเบียนภายหลัง
      </Note>
    </>
  );
}

function Delta({ line, value }: { line: CountLine; value: string }) {
  let q: number | null;
  try {
    q = parseQuantity(value);
  } catch {
    return <span className="count-invalid">ตรวจตัวเลข</span>;
  }
  const compare = line.expectedQty ?? line.previousQty;
  if (q === null || compare === null) return <span className="muted">—</span>;
  const d = Math.round((q - compare) * 1000) / 1000;
  return (
    <>
      <span className={`count-delta ${d === 0 ? 'equal' : ''}`}>
        {d > 0 ? '+' : ''}
        {number(d)}
      </span>
      <small>
        {line.unitSymbol} · {line.expectedQty != null ? 'เทียบคาดหมาย' : 'เทียบครั้งก่อน'}
      </small>
    </>
  );
}

function RoundDetail({ round: r, onDirty }: { round: CountRound; onDirty: (d: boolean) => void }) {
  const { can } = useShop();
  const flow = useFlow();
  const { run, pending, error } = useAction();
  const isDraft = r.status === 'draft';
  const editable = isDraft && can('count');
  const initial = useMemo(
    () => r.lines.map((l) => ({ qty: l.qty === null ? '' : String(l.qty), reason: l.reason })),
    [r],
  );
  const [rows, setRows] = useState(initial);
  const [dialog, setDialog] = useState<'confirm' | 'return' | 'cancel' | 'audit' | null>(null);
  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const set = (i: number, k: 'qty' | 'reason', v: string) =>
    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function save(send: boolean) {
    const updates = r.lines.map((l, i) => ({
      ingredientId: l.ingredientId,
      qty: rows[i]!.qty,
      reason: rows[i]!.reason,
    }));
    const ok = await run(
      'saveCount',
      { roundId: r.id, updates },
      send ? undefined : 'บันทึกร่างแล้ว',
    );
    if (ok && send)
      await run(
        'submitCount',
        { roundId: r.id },
        'ส่งตรวจแล้ว ยอดล่าสุดยังไม่เปลี่ยนจนกว่าจะยืนยัน',
      );
  }
  const counted = r.lines.filter((l) => l.qty !== null).length;

  return (
    <>
      <div className="count-banner" data-current-count={r.id}>
        <div>
          <div className="count-title">
            <h2>{r.title}</h2>
            <Phase r={r} />
          </div>
          <p>
            เปิดโดย {r.createdBy} · {fmt(r.createdAt)}
          </p>
        </div>
        <div className="count-meta">
          <b>
            {counted} / {r.lines.length}
          </b>
          <span>รายการที่บันทึกยอดแล้ว</span>
        </div>
      </div>
      <ol className="count-steps">
        <li className="done">1 · นับของจริง</li>
        <li className={r.status === 'review' || r.status === 'confirmed' ? 'done' : ''}>
          2 · ตรวจทาน
        </li>
        <li className={r.status === 'confirmed' ? 'done' : ''}>3 · ยืนยันยอด</li>
      </ol>
      {r.feedback && (
        <div className="review-feedback">
          <b>เหตุผลส่งกลับครั้งล่าสุด</b>
          <p>{r.feedback}</p>
        </div>
      )}
      {r.status === 'cancelled' && <div className="review-feedback">ยกเลิก: {r.cancelReason}</div>}
      <div className="count-context">
        <span>
          ยอดคาดหมายแสดงเมื่อข้อมูลเคลื่อนไหวตรวจครบตอนเปิดรอบ มิฉะนั้นเทียบยอดนับครั้งก่อน
        </span>
        <span>เวลาแสดงตามประเทศไทย</span>
      </div>
      <section className="panel">
        <div className="table-wrap">
          <table className="count-table">
            <thead>
              <tr>
                <th>วัตถุดิบ / สถานที่</th>
                <th>ยอดเปรียบเทียบ</th>
                <th>ยอดนับครั้งนี้</th>
                <th>ส่วนต่าง</th>
                <th>คำอธิบาย / เหตุผลแก้ไข</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={l.ingredientId}>
                  <td>
                    <b>{l.name}</b>
                    <small>
                      {l.code} · {l.location || 'ไม่ระบุที่เก็บ'}
                    </small>
                    <small>{l.unitName}</small>
                  </td>
                  <td>
                    {l.previousQty === null ? (
                      <span className="muted">ยังไม่มียอดก่อน</span>
                    ) : (
                      <>
                        <b>{number(l.previousQty)}</b> {l.unitSymbol}
                        <small>{fmt(l.previousAt)}</small>
                        {l.expectedQty != null && (
                          <small>
                            <b>
                              คาดหมาย {number(l.expectedQty)} {l.unitSymbol}
                            </b>
                            <br />
                            ตรวจครบ {fmt(l.expectedAt)}
                          </small>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {isDraft ? (
                      <>
                        <input
                          className="count-input"
                          aria-label={'ยอดนับ ' + l.name}
                          inputMode="decimal"
                          placeholder="ยังไม่ได้นับ"
                          value={rows[i]!.qty}
                          disabled={!editable}
                          onChange={(e) => set(i, 'qty', e.target.value)}
                        />
                        <small>{l.unitSymbol} · 0 = ไม่มีของ</small>
                      </>
                    ) : (
                      <>
                        <b>{number(l.qty)}</b> {l.unitSymbol}
                        <small>
                          {l.countedBy || ''}
                          <br />
                          {fmt(l.countedAt)}
                        </small>
                      </>
                    )}
                  </td>
                  <td>
                    <Delta line={l} value={isDraft ? rows[i]!.qty : String(l.qty ?? '')} />
                  </td>
                  <td>
                    {isDraft ? (
                      <input
                        className="count-reason"
                        aria-label={'เหตุผล ' + l.name}
                        maxLength={500}
                        placeholder="ระบุเมื่อยอดต่างหรือแก้ยอดเดิม"
                        value={rows[i]!.reason}
                        disabled={!editable}
                        onChange={(e) => set(i, 'reason', e.target.value)}
                      />
                    ) : (
                      <span className="count-reason-text">{l.reason || '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="count-workbar">
        {isDraft ? (
          <div>
            <p id="count-save-status" className="muted">
              {dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'ยอดที่บันทึกแล้วกลับมาทำต่อได้'}
            </p>
            <div className="count-actions">
              {editable && (
                <>
                  <button
                    id="save-count"
                    type="button"
                    className="secondary"
                    disabled={pending}
                    onClick={() => save(false)}
                  >
                    บันทึกร่าง
                  </button>
                  <button
                    id="submit-count"
                    type="button"
                    className="primary"
                    disabled={pending}
                    onClick={() => save(true)}
                  >
                    บันทึกและส่งตรวจ
                  </button>
                </>
              )}
            </div>
          </div>
        ) : r.status === 'review' ? (
          <>
            <div>
              <b>ส่งตรวจโดย {r.submittedBy}</b>
              <p className="muted">{fmt(r.submittedAt)}</p>
            </div>
            <div className="count-actions">
              {can('reviewCount') ? (
                <>
                  <button
                    id="return-count"
                    type="button"
                    className="secondary"
                    onClick={() => setDialog('return')}
                  >
                    ส่งกลับแก้ไข
                  </button>
                  <button
                    id="confirm-count"
                    type="button"
                    className="primary"
                    onClick={() => setDialog('confirm')}
                  >
                    ตรวจและยืนยันยอด
                  </button>
                </>
              ) : (
                <span className="chip off">รอหุ้นส่วนหรือผู้จัดการตรวจยืนยัน</span>
              )}
            </div>
          </>
        ) : r.status === 'confirmed' ? (
          <>
            <div>
              <b>ยืนยันโดย {r.confirmedBy}</b>
              <p className="muted">{fmt(r.confirmedAt)} · ล็อกรอบแล้ว แก้ย้อนหลังไม่ได้</p>
            </div>
            <button className="secondary" type="button" onClick={() => flow('latest')}>
              ดูยอดนับล่าสุด
            </button>
          </>
        ) : (
          <span className="muted">รอบที่ยกเลิกจะไม่เปลี่ยนยอดนับล่าสุด</span>
        )}
      </div>
      <FormError error={error} />
      <div className="count-bottom">
        <button
          id="count-audit"
          type="button"
          className="text-button"
          onClick={() => setDialog('audit')}
        >
          ดูประวัติการทำรายการ ({r.audit.length})
        </button>
        {can('reviewCount') && (r.status === 'draft' || r.status === 'review') && (
          <button
            id="cancel-count"
            type="button"
            className="text-button"
            onClick={() => setDialog('cancel')}
          >
            ยกเลิกรอบนี้
          </button>
        )}
      </div>
      <Note>
        ส่วนต่างไม่ใช่การยืนยันของเสียหรือการใช้ เมื่อเปิดรอบนับ ระบบพักการลงเคลื่อนไหวจนจบรอบ
        จึงควรหยุดรับ/เบิกของระหว่างนับและตรวจยืนยัน ก่อนเริ่มทำรายการต่อ
      </Note>
      {(dialog === 'confirm' || dialog === 'return' || dialog === 'cancel') && (
        <ReviewDialog round={r} action={dialog} dirty={dirty} onClose={() => setDialog(null)} />
      )}
      {dialog === 'audit' && <AuditDialog round={r} onClose={() => setDialog(null)} />}
    </>
  );
}

function ReviewDialog({
  round: r,
  action,
  dirty,
  onClose,
}: {
  round: CountRound;
  action: 'confirm' | 'return' | 'cancel';
  dirty: boolean;
  onClose: () => void;
}) {
  const title =
    action === 'confirm'
      ? 'ยืนยันยอดนับ'
      : action === 'return'
        ? 'ส่งกลับให้แก้ไข'
        : 'ยกเลิกรอบนับ';
  return (
    <ActionDialog
      open
      onClose={onClose}
      eyebrow="STOCK COUNT"
      title={title}
      submitLabel={title}
      submit={(f, run) => {
        if (dirty) throw new Error('กรุณาบันทึกหรือทิ้งการแก้ไขในตารางก่อน');
        return action === 'confirm'
          ? run('confirmCount', { roundId: r.id }, title + 'แล้ว')
          : action === 'return'
            ? run('returnCount', { roundId: r.id, reason: str(f, 'reason') }, title + 'แล้ว')
            : run('cancelCount', { roundId: r.id, reason: str(f, 'reason') }, title + 'แล้ว');
      }}
    >
      <p>{r.title}</p>
      {action !== 'confirm' ? (
        <Textarea label="เหตุผล *" name="reason" required maxLength={500} />
      ) : (
        <p className="muted">เมื่อยืนยัน ยอดของรอบนี้จะเป็นยอดนับล่าสุดและแก้ย้อนหลังไม่ได้</p>
      )}
    </ActionDialog>
  );
}

function AuditDialog({ round: r, onClose }: { round: CountRound; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} eyebrow="COUNT HISTORY" title={'ประวัติ ' + r.title}>
      <div className="activity">
        {[...r.audit].reverse().map((a, k) => (
          <section className="audit-entry" key={k}>
            <b>{a.action}</b>
            <p className="muted">
              {a.person} ({roles[a.role]}) · {fmt(a.time)}
            </p>
            {a.reason && <p>{a.reason}</p>}
            {a.changes && (
              <ul>
                {a.changes.map((c) => {
                  const l = r.lines.find((l) => l.ingredientId === c.ingredientId);
                  return (
                    <li key={c.ingredientId}>
                      {l?.name || c.ingredientId}: {number(c.before)} → {number(c.after)}{' '}
                      {l?.unitSymbol || ''}
                      <br />
                      <span className="muted">{c.reason || 'บันทึกครั้งแรก'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </Dialog>
  );
}

export function LatestPage() {
  const { state } = useShop();
  const flow = useFlow();
  const rows = latestCounts(state);
  return (
    <>
      <PageHeader
        eyebrow="STOCK / LAST VERIFIED COUNT"
        title="ยอดนับล่าสุด"
        sub="แสดงเฉพาะยอดที่ผ่านการตรวจยืนยันแล้ว"
        actions={
          <button className="primary" type="button" onClick={() => flow('counting')}>
            ไปนับสต็อก →
          </button>
        }
      />
      <div className="count-context">
        <span>ยอด ณ เวลานับ ไม่ใช่คงเหลือเรียลไทม์</span>
        <span>ไม่มีการตัดยอดจากการขาย</span>
      </div>
      <section className="panel">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>วัตถุดิบ ณ วันนับ</th>
                  <th>ยอดนับ</th>
                  <th>ผู้บันทึก / เวลานับ</th>
                  <th>ผู้ยืนยัน</th>
                  <th>รอบอ้างอิง</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.ingredientId}>
                    <td>
                      <b>{l.name}</b>
                      <small>{l.code}</small>
                    </td>
                    <td>
                      <b>{number(l.qty)}</b> {l.unitSymbol}
                    </td>
                    <td>
                      {l.countedBy}
                      <small>{fmt(l.countedAt)}</small>
                    </td>
                    <td>
                      {l.confirmedBy}
                      <small>{fmt(l.confirmedAt)}</small>
                    </td>
                    <td>
                      <button
                        className="mini"
                        type="button"
                        onClick={() => flow('counting', l.roundId)}
                      >
                        {l.roundTitle}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty count-empty">
            <strong>ยังไม่มียอดนับที่ยืนยันแล้ว</strong>สร้างรอบนับ กรอกจำนวน แล้วส่งตรวจและยืนยัน
            <br />
            ยอดร่างและรอตรวจจะไม่แสดงเป็นยอดล่าสุด
          </div>
        )}
      </section>
      <Note>
        แต่ละวัตถุดิบอาจอ้างอิงคนละรอบ โปรดดูเวลานับกำกับ รายการพักใช้งานยังเก็บยอดประวัติไว้
      </Note>
    </>
  );
}
