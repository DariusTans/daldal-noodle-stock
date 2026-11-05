/**
 * ตั้งค่าร้าน — legacy workflow-ui settings() (link cards).
 * The purchase-approval and expense-reviewer forms are dialogs opened from the buy / expenses
 * pages (?action=policy), as in the prototype; approver/reviewer are picked among members.
 */
import { currencies } from '@/domain';
import { fmtMoney, moneyInput, roleName } from '../lib/format';
import { useShop } from '../state';
import { Check, FieldGrid, Input, PageHeader, Select, Textarea } from '../ui';
import { ActionDialog, bool, opt, str } from './common';
import { useFlow } from './Home';

export function SettingsPage() {
  const { state } = useShop();
  const flow = useFlow();
  const link = (page: string, label: string, action = '') => (
    <button className="secondary" type="button" onClick={() => flow(page, '', action)}>
      {label}
    </button>
  );
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE SETTINGS"
        title="ตั้งค่าร้าน"
        sub="ข้อมูลตั้งต้น เกณฑ์ และบทบาททดลอง"
      />
      <div className="task-grid">
        <section className="task-card">
          <h3>ข้อมูลวัตถุดิบ</h3>
          <p>ทะเบียน หน่วยนับ และจุดเตือน</p>
          {link('ingredients', 'ทะเบียนวัตถุดิบ')}
          {link('units', 'หน่วยนับ')}
          {link('alerts', 'จุดเตือนซื้อ', 'settings')}
        </section>
        <section className="task-card">
          <h3>เกณฑ์และผู้ตรวจ</h3>
          <p>ไม่มีชื่อหรือวงเงินที่ระบบกำหนดแทนร้าน</p>
          {link('buy', 'เกณฑ์อนุมัติซื้อ', 'policy')}
          {link('expenses', 'ผู้ตรวจค่าใช้จ่าย', 'policy')}
          <small>
            ผู้พิจารณาซื้อ: {state.purchasePolicy?.approver ?? 'ยังไม่ตั้ง'}
            <br />
            ผู้ตรวจบิล: {state.expenseReviewer?.name ?? 'ยังไม่ตั้ง'}
          </small>
        </section>
        <section className="task-card">
          <h3>บทบาทและข้อมูล</h3>
          <p>สมาชิก สิทธิ์ สำรอง และนำเข้า</p>
          {link('roles', 'บทบาท / สำรองข้อมูล')}
        </section>
      </div>
    </>
  );
}

function useReviewerOptions() {
  const { members } = useShop();
  const reviewers = members.filter((m) => m.active && m.role !== 'staff');
  return {
    options: reviewers.map((m): [string, string] => [
      m.userId,
      `${m.displayName} (${roleName(m.role)})`,
    ]),
    idByName: (name: string | undefined) => reviewers.find((m) => m.displayName === name)?.userId,
  };
}

/** Owner: purchase approval policy (opened from the buy page). */
export function PurchasePolicyDialog({ onClose }: { onClose: () => void }) {
  const { state } = useShop();
  const { options, idByName } = useReviewerOptions();
  const p = state.purchasePolicy;
  return (
    <ActionDialog
      open
      onClose={onClose}
      eyebrow="BUY / APPROVAL POLICY"
      title="เกณฑ์อนุมัติซื้อ"
      submitLabel="บันทึกเกณฑ์"
      submit={(f, run) =>
        run(
          'savePurchasePolicy',
          {
            currency: str(f, 'currency') as 'THB',
            mode: str(f, 'mode') as 'all',
            threshold: opt(f, 'threshold'),
            approverUserId: str(f, 'approver'),
            note: str(f, 'note'),
            checked: bool(f, 'checked'),
          },
          'บันทึกเกณฑ์แล้ว',
        )
      }
    >
      <p className="muted">
        {p
          ? `ปัจจุบัน: ${p.mode === 'all' ? 'พิจารณาทุกรายการ' : 'พิจารณาเมื่อเกิน ' + fmtMoney(p.threshold, p.currency)} · ผู้พิจารณา ${p.approver}`
          : 'ยังไม่ตั้งเกณฑ์ ส่งพิจารณาใบจัดซื้อไม่ได้จนกว่าจะตั้ง'}{' '}
        · เปลี่ยนเกณฑ์แล้ว รายการที่ส่งพิจารณาไว้ต้องส่งใหม่
      </p>
      <FieldGrid>
        <Select
          label="ผู้พิจารณา (สมาชิกเจ้าของ / ผู้จัดการ) *"
          name="approver"
          wide
          defaultValue={idByName(p?.approver)}
          options={options}
        />
        <Select
          label="รูปแบบ *"
          name="mode"
          defaultValue={p?.mode ?? 'all'}
          options={[
            ['all', 'พิจารณาทุกรายการ'],
            ['above', 'พิจารณาเมื่อเกินวงเงิน'],
          ]}
        />
        <Select
          label="สกุลเงิน *"
          name="currency"
          defaultValue={p?.currency ?? 'THB'}
          options={currencies.map((c) => [c, c])}
        />
        <Input
          label="วงเงิน (เฉพาะแบบเกินวงเงิน)"
          name="threshold"
          inputMode="decimal"
          defaultValue={p ? moneyInput(p.threshold) : ''}
          wide
        />
        <Textarea
          label="ที่มา / ขอบเขตเกณฑ์ *"
          name="note"
          required
          maxLength={500}
          defaultValue={p?.note}
        />
      </FieldGrid>
      <Check name="checked" required label="ตกลงเกณฑ์นี้กับร้านแล้ว ไม่ใช่ค่าที่ระบบกำหนดแทน" />
    </ActionDialog>
  );
}

/** Owner: expense reviewer (opened from the expenses page). */
export function ExpenseReviewerDialog({ onClose }: { onClose: () => void }) {
  const { state } = useShop();
  const { options, idByName } = useReviewerOptions();
  const r = state.expenseReviewer;
  return (
    <ActionDialog
      open
      onClose={onClose}
      eyebrow="EXPENSES / REVIEWER"
      title="ผู้ตรวจค่าใช้จ่าย"
      submitLabel="บันทึกผู้ตรวจ"
      submit={(f, run) =>
        run(
          'saveExpenseReviewer',
          { reviewerUserId: str(f, 'reviewer'), note: str(f, 'note'), checked: bool(f, 'checked') },
          'บันทึกผู้ตรวจแล้ว',
        )
      }
    >
      <p className="muted">
        {r
          ? `ปัจจุบัน: ${r.name} (${roleName(r.role)})`
          : 'ยังไม่ตั้งผู้ตรวจ ส่งตรวจค่าใช้จ่ายไม่ได้จนกว่าจะตั้ง'}
      </p>
      <FieldGrid>
        <Select
          label="ผู้ตรวจ (สมาชิกเจ้าของ / ผู้จัดการ) *"
          name="reviewer"
          wide
          defaultValue={idByName(r?.name)}
          options={options}
        />
        <Textarea
          label="ขอบเขตการตรวจ *"
          name="note"
          required
          maxLength={500}
          defaultValue={r?.note}
        />
      </FieldGrid>
      <Check name="checked" required label="ตกลงผู้ตรวจนี้กับร้านแล้ว" />
    </ActionDialog>
  );
}
