import { useState } from 'react';
import {
  currencies,
  expenseCategories,
  expenseStatuses,
  expenseTotals,
  expenseWarnings,
  isStoredAttachment,
  STORED_ATTACHMENT_MAX_BYTES,
  type Expense,
} from '@/domain';
import { ApiError } from '../lib/api';
import { fmtDate, fmtDateTime, fmtMoney, moneyInput, roleName, todayBangkok } from '../lib/format';
import { useBackend, useShop } from '../state';
import {
  Badge,
  Button,
  Card,
  Check,
  Input,
  PageHeader,
  Select,
  Stat,
  Table,
  Td,
  Textarea,
} from '../ui';
import { ActionDialog, bool, DialogButton, opt, StatusBadge, str } from './common';

export function ExpensesPage() {
  const { state, me } = useShop();
  const [status, setStatus] = useState('open');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const totals = expenseTotals(state);
  const reviewer = state.expenseReviewer;
  const list = [...state.expenses]
    .reverse()
    .filter((e) =>
      status === 'open'
        ? ['draft', 'returned', 'pending'].includes(e.status)
        : status === 'all' || e.status === status,
    );
  const isReviewer = !!reviewer && reviewer.name === me.displayName && reviewer.role === me.role;

  return (
    <>
      <PageHeader
        eyebrow="การเงิน"
        title="ค่าใช้จ่าย"
        sub="ร่าง / ส่งตรวจยังไม่รวมยอด · ยืนยันแล้วจึงนับ · บิลไม่เปลี่ยนสต็อก · ไม่มีหลักฐาน สงสัยซ้ำ หรือยกเลิก ต้องมีเหตุผล"
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            + บันทึกบิล
          </Button>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {Object.entries(totals).length ? (
          Object.entries(totals).map(([c, t]) => (
            <Stat
              key={c}
              label={`ค่าใช้จ่ายยืนยันแล้ว (${c})`}
              value={fmtMoney(t!.total, c)}
              hint={`เงินร้าน ${fmtMoney(t!.shop, c)} · สำรองส่วนตัว ${fmtMoney(t!.personal, c)}`}
            />
          ))
        ) : (
          <Stat label="ค่าใช้จ่ายยืนยันแล้ว" value="0" />
        )}
        <Stat
          label="ผู้ตรวจค่าใช้จ่าย"
          value={reviewer ? reviewer.name : 'ยังไม่ตั้ง'}
          hint={reviewer ? roleName(reviewer.role) : 'เจ้าของตั้งได้ที่หน้าตั้งค่า'}
        />
      </div>
      <Card
        actions={
          <Select
            label="สถานะ"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              ['open', 'ค้างดำเนินการ'],
              ['all', 'ทั้งหมด'],
              ...(Object.entries(expenseStatuses) as Array<[string, string]>),
            ]}
          />
        }
      >
        <Table
          head={['วันที่บิล', 'ร้านค้า', 'ยอด', 'หมวด / แหล่งเงิน', 'สถานะ', 'ข้อควรตรวจ', '']}
          empty="ไม่มีรายการ"
        >
          {list.map((e) => {
            const warnings =
              e.status === 'confirmed' ? (e.review?.warnings ?? []) : expenseWarnings(state, e);
            return (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{fmtDate(e.date)}</Td>
                <Td>
                  {e.vendor}
                  <span className="block text-xs text-stone-500">{e.reference || '—'}</span>
                </Td>
                <Td className="font-semibold whitespace-nowrap">
                  {fmtMoney(e.amount, e.currency)}
                </Td>
                <Td>
                  {e.category}
                  <span className="block text-xs text-stone-500">
                    {e.funding === 'shop' ? 'เงินร้าน' : 'สำรองส่วนตัว'} · {e.payer}
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={e.status} label={expenseStatuses[e.status]} />
                  {e.status === 'returned' && (
                    <span className="block text-xs text-amber-800">{e.feedback}</span>
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {warnings.map((w) => (
                      <Badge key={w} tone="warning">
                        {w}
                      </Badge>
                    ))}
                    <EvidenceLink expense={e} />
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-right">
                  <span className="inline-flex flex-wrap justify-end gap-1">
                    {(e.status === 'draft' || e.status === 'returned') && (
                      <>
                        <Button size="sm" onClick={() => setEditing(e)}>
                          แก้ไข
                        </Button>
                        <DialogButton
                          label="ส่งตรวจ"
                          size="sm"
                          variant="primary"
                          disabled={!reviewer}
                        >
                          {(close, open) => (
                            <ActionDialog
                              open={open}
                              onClose={close}
                              title="ส่งตรวจค่าใช้จ่าย"
                              submitLabel="ส่งตรวจ"
                              submit={(_f, run) =>
                                run('submitExpense', { expenseId: e.id }, 'ส่งตรวจแล้ว')
                              }
                            >
                              <p className="text-sm">ส่งให้ {reviewer?.name} ตรวจ</p>
                            </ActionDialog>
                          )}
                        </DialogButton>
                      </>
                    )}
                    {e.status === 'pending' && isReviewer && (
                      <ReviewButton expense={e} warnings={warnings} />
                    )}
                    {e.status !== 'cancelled' &&
                      (e.status !== 'confirmed' || me.role === 'owner') && (
                        <DialogButton label="ยกเลิก" size="sm" variant="danger">
                          {(close, open) => (
                            <ActionDialog
                              open={open}
                              onClose={close}
                              danger
                              title="ยกเลิกค่าใช้จ่าย"
                              submitLabel="ยกเลิกรายการ"
                              submit={(f, run) =>
                                run(
                                  'cancelExpense',
                                  { expenseId: e.id, note: str(f, 'note') },
                                  'ยกเลิกแล้ว',
                                )
                              }
                            >
                              <Textarea label="เหตุผล" name="note" required maxLength={500} />
                            </ActionDialog>
                          )}
                        </DialogButton>
                      )}
                  </span>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
      {editing && (
        <ExpenseForm
          expense={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function ReviewButton({ expense: e, warnings }: { expense: Expense; warnings: string[] }) {
  return (
    <DialogButton label="ตรวจ" size="sm" variant="primary">
      {(close, open) => (
        <ActionDialog
          open={open}
          onClose={close}
          title={'ตรวจค่าใช้จ่าย: ' + e.vendor}
          submitLabel="บันทึกผลตรวจ"
          submit={(f, run) =>
            run(
              'reviewExpense',
              {
                expenseId: e.id,
                decision: str(f, 'decision') as 'confirm',
                note: str(f, 'note'),
                checked: bool(f, 'checked'),
                exceptionsChecked: bool(f, 'exceptionsChecked'),
              },
              'บันทึกผลตรวจแล้ว',
            )
          }
        >
          <p className="text-sm">
            {fmtMoney(e.amount, e.currency)} · {fmtDate(e.date)} · {e.note}
          </p>
          {warnings.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {warnings.map((w) => (
                <Badge key={w} tone="warning">
                  {w}
                </Badge>
              ))}
            </div>
          )}
          <Select
            label="ผล"
            name="decision"
            options={[
              ['confirm', 'ยืนยัน (นับเป็นค่าใช้จ่าย)'],
              ['return', 'ส่งกลับแก้ไข'],
            ]}
          />
          <Textarea label="บันทึกผลตรวจ" name="note" required maxLength={500} />
          <Check name="checked" label="ตรวจหลักฐานและรายละเอียดแล้ว" />
          {warnings.length > 0 && (
            <Check name="exceptionsChecked" label="ทบทวนข้อควรตรวจทุกข้อแล้ว" />
          )}
        </ActionDialog>
      )}
    </DialogButton>
  );
}

function EvidenceLink({ expense: e }: { expense: Expense }) {
  const { api } = useBackend();
  const { shopId } = useShop();
  const a = e.attachment;
  if (!a) return null;
  const open = async () => {
    const url = isStoredAttachment(a) ? (await api.evidenceUrl(shopId, a.evidenceId)).url : a.data;
    window.open(url, '_blank', 'noopener');
  };
  return (
    <button type="button" className="text-xs text-brand underline" onClick={open}>
      ดูหลักฐาน ({a.name})
    </button>
  );
}

function ExpenseForm({ expense, onClose }: { expense?: Expense; onClose: () => void }) {
  const { state, shopId } = useShop();
  const { api } = useBackend();
  const orders = state.purchaseOrders.filter((o) => o.status === 'ordered');
  return (
    <ActionDialog
      open
      wide
      onClose={onClose}
      title={expense ? 'แก้ไขบิล' : 'บันทึกบิล'}
      submitLabel="บันทึกร่าง"
      submit={async (f, run) => {
        const file = f.get('file');
        let evidenceId: string | null | undefined = undefined;
        if (file instanceof File && file.size > 0) {
          if (file.size > STORED_ATTACHMENT_MAX_BYTES) throw new Error('ไฟล์ต้องไม่เกิน 5 MB');
          try {
            evidenceId = await api.uploadEvidence(shopId, file);
          } catch (e) {
            throw new Error(e instanceof ApiError ? e.message : 'อัปโหลดไฟล์ไม่สำเร็จ');
          }
        } else if (bool(f, 'removeFile')) evidenceId = null;
        return run(
          'saveExpense',
          {
            id: expense?.id,
            vendor: str(f, 'vendor'),
            date: str(f, 'date'),
            reference: opt(f, 'reference'),
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
          'บันทึกร่างแล้ว',
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="ร้านค้า / ผู้รับเงิน"
          name="vendor"
          defaultValue={expense?.vendor}
          required
          maxLength={100}
        />
        <Input
          label="วันที่บิล"
          name="date"
          type="date"
          max={todayBangkok()}
          defaultValue={expense?.date ?? todayBangkok()}
          required
        />
        <Input label="เลขบิล" name="reference" defaultValue={expense?.reference} maxLength={100} />
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Input
            label="ยอดเงิน"
            name="amount"
            defaultValue={expense ? moneyInput(expense.amount) : ''}
            required
            inputMode="decimal"
          />
          <Select
            label="สกุล"
            name="currency"
            defaultValue={expense?.currency ?? 'THB'}
            options={currencies.map((c) => [c, c])}
          />
        </div>
        <Select
          label="หมวด"
          name="category"
          defaultValue={expense?.category}
          options={expenseCategories.map((c) => [c, c])}
        />
        <Select
          label="แหล่งเงิน"
          name="funding"
          defaultValue={expense?.funding ?? 'shop'}
          options={[
            ['shop', 'เงินร้าน'],
            ['personal', 'สำรองจ่ายส่วนตัว'],
          ]}
        />
        <Input label="ผู้จ่าย" name="payer" defaultValue={expense?.payer} required maxLength={80} />
        <Select
          label="อ้างอิงใบซื้อ (ถ้ามี)"
          name="orderId"
          defaultValue={expense?.orderId ?? ''}
          options={[
            ['', '—'],
            ...orders.map((o): [string, string] => [o.id, `${o.name} · ${o.purchase?.reference}`]),
          ]}
        />
      </div>
      <Textarea
        label="รายละเอียด"
        name="note"
        defaultValue={expense?.note}
        required
        maxLength={500}
      />
      <div className="rounded-lg bg-stone-50 p-3">
        <Input
          label="ไฟล์หลักฐาน (ภาพหรือ PDF ไม่เกิน 5 MB)"
          name="file"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
        />
        {expense?.attachment && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span>ไฟล์ปัจจุบัน: {expense.attachment.name}</span>
            <Check name="removeFile" label="นำไฟล์ออก" />
          </div>
        )}
        <div className="mt-2">
          <Input
            label="เหตุผลที่ไม่มีหลักฐาน (กรณีไม่แนบไฟล์)"
            name="noEvidenceReason"
            defaultValue={expense?.noEvidenceReason}
            maxLength={500}
          />
        </div>
      </div>
      {expense && (
        <p className="text-xs text-stone-500">
          บันทึกครั้งแรก {fmtDateTime(expense.at)} · ประวัติ {expense.audit.length} รายการ
        </p>
      )}
    </ActionDialog>
  );
}
