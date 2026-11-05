import type { FormEvent } from 'react';
import { lineNeedsReason, type CountLine, type CountRound } from '@/domain';
import { fmtDateTime, fmtQty } from '../lib/format';
import { useAction, useShop } from '../state';
import {
  Badge,
  Button,
  Card,
  Empty,
  FormError,
  Input,
  PageHeader,
  Table,
  Td,
  Textarea,
} from '../ui';
import { ActionDialog, DialogButton, StatusBadge, str } from './common';

const comparison = (l: CountLine) => l.expectedQty ?? l.previousQty;

export function CountingPage() {
  const { state, can } = useShop();
  const open = state.countRounds.find((r) => r.status === 'draft' || r.status === 'review');
  const history = state.countRounds.filter((r) => r !== open).reverse();

  return (
    <>
      <PageHeader
        eyebrow="สต็อก"
        title="นับและยืนยัน"
        sub="ร่าง → ส่งตรวจ → ยืนยัน · ช่องว่างคือยังไม่นับ ไม่ใช่ศูนย์ · ระหว่างมีรอบนับ ระบบพักการบันทึกเคลื่อนไหวและเสนอซื้อ"
        actions={
          !open &&
          can('count') && (
            <DialogButton label="+ เปิดรอบนับ" variant="primary">
              {(close, isOpen) => (
                <ActionDialog
                  open={isOpen}
                  onClose={close}
                  title="เปิดรอบนับใหม่"
                  submitLabel="เปิดรอบ"
                  submit={(f, run) =>
                    run('startCount', { title: str(f, 'title') }, 'เปิดรอบนับแล้ว')
                  }
                >
                  <Input
                    label="ชื่อรอบ"
                    name="title"
                    required
                    maxLength={100}
                    defaultValue={
                      'นับ ' + new Date().toLocaleDateString('th-TH', { dateStyle: 'medium' })
                    }
                  />
                  <p className="text-sm text-stone-600">รอบนับรวมวัตถุดิบที่เปิดใช้งานทั้งหมด</p>
                </ActionDialog>
              )}
            </DialogButton>
          )
        }
      />
      {open ? <OpenRound round={open} /> : <Empty>ไม่มีรอบนับค้าง</Empty>}
      <Card title="ประวัติรอบนับ" className="mt-4">
        <Table head={['รอบ', 'สถานะ', 'เปิดโดย', 'ยืนยัน / ยกเลิก']} empty="ยังไม่มีประวัติ">
          {history.map((r) => (
            <tr key={r.id}>
              <Td>{r.title}</Td>
              <Td>
                <StatusBadge status={r.status} />
              </Td>
              <Td>
                {r.createdBy}
                <span className="block text-xs text-stone-500">{fmtDateTime(r.createdAt)}</span>
              </Td>
              <Td>
                {r.status === 'confirmed' ? (
                  <>
                    {r.confirmedBy}
                    <span className="block text-xs text-stone-500">
                      {fmtDateTime(r.confirmedAt)}
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-stone-500">{r.cancelReason}</span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

function OpenRound({ round }: { round: CountRound }) {
  const { can } = useShop();
  const { run, pending, error } = useAction();
  const draft = round.status === 'draft';
  const editable = draft && can('count');

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const thenSubmit = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'submit';
    const f = new FormData(e.currentTarget);
    const updates = round.lines.map((l) => ({
      ingredientId: l.ingredientId,
      qty: str(f, 'qty:' + l.ingredientId) || null,
      reason: str(f, 'reason:' + l.ingredientId),
    }));
    const saved = await run(
      'saveCount',
      { roundId: round.id, updates },
      thenSubmit ? undefined : 'บันทึกยอดนับแล้ว',
    );
    if (saved && thenSubmit) await run('submitCount', { roundId: round.id }, 'ส่งตรวจแล้ว');
  }

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {round.title} <StatusBadge status={round.status} />
        </span>
      }
      actions={
        <>
          {round.status === 'review' && can('reviewCount') && (
            <>
              <DialogButton label="ส่งกลับแก้ไข">
                {(close, isOpen) => (
                  <ActionDialog
                    open={isOpen}
                    onClose={close}
                    title="ส่งกลับให้นับ/แก้ไข"
                    submitLabel="ส่งกลับ"
                    submit={(f, run) =>
                      run(
                        'returnCount',
                        { roundId: round.id, reason: str(f, 'reason') },
                        'ส่งกลับแล้ว',
                      )
                    }
                  >
                    <Textarea label="เหตุผล" name="reason" required maxLength={500} />
                  </ActionDialog>
                )}
              </DialogButton>
              <DialogButton label="ยืนยันยอดนับ" variant="primary">
                {(close, isOpen) => (
                  <ActionDialog
                    open={isOpen}
                    onClose={close}
                    title="ยืนยันยอดนับ"
                    submitLabel="ยืนยันและล็อกรอบ"
                    submit={(_f, run) =>
                      run('confirmCount', { roundId: round.id }, 'ยืนยันยอดนับแล้ว')
                    }
                  >
                    <p className="text-sm text-stone-700">
                      เมื่อยืนยันแล้ว รอบนี้จะถูกล็อกและกลายเป็นฐานยอดใหม่ของทุกรายการในรอบ
                    </p>
                  </ActionDialog>
                )}
              </DialogButton>
            </>
          )}
          {can('reviewCount') && (
            <DialogButton label="ยกเลิกรอบ" variant="danger">
              {(close, isOpen) => (
                <ActionDialog
                  open={isOpen}
                  onClose={close}
                  danger
                  title="ยกเลิกรอบนับ"
                  submitLabel="ยกเลิกรอบ"
                  submit={(f, run) =>
                    run(
                      'cancelCount',
                      { roundId: round.id, reason: str(f, 'reason') },
                      'ยกเลิกรอบแล้ว',
                    )
                  }
                >
                  <Textarea label="เหตุผลยกเลิก" name="reason" required maxLength={500} />
                </ActionDialog>
              )}
            </DialogButton>
          )}
        </>
      }
    >
      {round.feedback && draft && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ส่งกลับ: {round.feedback}
        </p>
      )}
      {round.status === 'review' && !can('reviewCount') && (
        <p className="mb-3 text-sm text-stone-600">ส่งตรวจแล้ว รอผู้จัดการหรือเจ้าของยืนยัน</p>
      )}
      <form onSubmit={save} key={round.audit.length}>
        <Table head={['วัตถุดิบ', 'ยอดเปรียบเทียบ', 'ยอดนับ', 'ส่วนต่าง', 'คำอธิบาย']}>
          {round.lines.map((l) => {
            const base = comparison(l);
            const diff = l.qty !== null && base !== null ? l.qty - base : null;
            return (
              <tr key={l.ingredientId}>
                <Td>
                  {l.name}
                  <span className="block text-xs text-stone-500">
                    {l.code} · {l.location || '—'}
                  </span>
                </Td>
                <Td>
                  {fmtQty(base, l.unitSymbol)}
                  {l.expectedQty !== undefined && l.expectedQty !== null && (
                    <span className="block text-xs text-stone-500">ยอดคำนวณที่ตรวจแล้ว</span>
                  )}
                </Td>
                <Td className="w-32">
                  {editable ? (
                    <input
                      name={'qty:' + l.ingredientId}
                      defaultValue={l.qty ?? ''}
                      inputMode="decimal"
                      aria-label={'ยอดนับ ' + l.name}
                      className="w-24 rounded-lg px-2 py-1 ring-1 ring-stone-300 focus:ring-2 focus:ring-brand focus:outline-none"
                    />
                  ) : (
                    fmtQty(l.qty, l.unitSymbol)
                  )}
                </Td>
                <Td>
                  {diff === null ? (
                    '—'
                  ) : diff === 0 ? (
                    <Badge tone="success">ตรง</Badge>
                  ) : (
                    <Badge tone="warning">
                      {diff > 0 ? '+' : ''}
                      {fmtQty(diff)}
                    </Badge>
                  )}
                </Td>
                <Td className="min-w-48">
                  {editable ? (
                    <input
                      name={'reason:' + l.ingredientId}
                      defaultValue={l.reason}
                      maxLength={500}
                      aria-label={'คำอธิบาย ' + l.name}
                      placeholder={lineNeedsReason(l) ? 'ต้องระบุเมื่อยอดต่าง' : ''}
                      className="w-full rounded-lg px-2 py-1 ring-1 ring-stone-300 focus:ring-2 focus:ring-brand focus:outline-none"
                    />
                  ) : (
                    <span className="text-stone-600">{l.reason || '—'}</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        {editable && (
          <div className="mt-3 flex flex-col gap-2">
            <FormError error={error} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="submit" busy={pending}>
                บันทึกร่าง
              </Button>
              <Button type="submit" value="submit" variant="primary" busy={pending}>
                บันทึกและส่งตรวจ
              </Button>
            </div>
          </div>
        )}
      </form>
      <details className="mt-3 text-sm text-stone-600">
        <summary className="cursor-pointer">ประวัติรอบนี้ ({round.audit.length})</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {round.audit.map((a, i) => (
            <li key={i}>
              {fmtDateTime(a.time)} · {a.action} · {a.person}
              {a.reason && ` — ${a.reason}`}
            </li>
          ))}
        </ul>
      </details>
    </Card>
  );
}
