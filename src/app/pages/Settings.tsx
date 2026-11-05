import { currencies } from '@/domain';
import { fmtDateTime, fmtMoney, moneyInput, roleName } from '../lib/format';
import { useShop } from '../state';
import { Card, Check, Empty, Input, PageHeader, Select, Table, Td, Textarea } from '../ui';
import { ActionDialog, bool, DialogButton, opt, str } from './common';

export function SettingsPage() {
  const { state, members, me, view } = useShop();
  const owner = me.role === 'owner';
  const reviewers = members.filter((m) => m.active && m.role !== 'staff');
  const policy = state.purchasePolicy;
  const reviewer = state.expenseReviewer;
  const options = reviewers.map((m): [string, string] => [
    m.userId,
    `${m.displayName} (${roleName(m.role)})`,
  ]);
  const memberIdByName = (name: string | undefined) =>
    reviewers.find((m) => m.displayName === name)?.userId;

  if (view.redacted)
    return (
      <>
        <PageHeader eyebrow="ตั้งค่า" title="ตั้งค่าร้าน / เกณฑ์" />
        <Empty>
          เกณฑ์อนุมัติและผู้ตรวจค่าใช้จ่ายแสดงเฉพาะผู้จัดการและเจ้าของ ·
          จุดเตือนซื้อดูได้ที่หน้าเตือนซื้อ
        </Empty>
      </>
    );

  return (
    <>
      <PageHeader
        eyebrow="ตั้งค่า"
        title="ตั้งค่าร้าน / เกณฑ์"
        sub="ผู้อนุมัติและผู้ตรวจต้องเป็นสมาชิกบทบาทเจ้าของหรือผู้จัดการ · เปลี่ยนเกณฑ์แล้ว รายการที่ส่งพิจารณาไว้ต้องส่งใหม่"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="เกณฑ์อนุมัติจัดซื้อ"
          actions={
            owner && (
              <DialogButton label={policy ? 'แก้ไข' : 'ตั้งเกณฑ์'} variant="primary" size="sm">
                {(close, open) => (
                  <ActionDialog
                    open={open}
                    onClose={close}
                    title="เกณฑ์อนุมัติจัดซื้อ"
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
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Select
                        label="ผู้อนุมัติ"
                        name="approver"
                        defaultValue={memberIdByName(policy?.approver)}
                        options={options}
                      />
                      <Select
                        label="สกุลเงิน"
                        name="currency"
                        defaultValue={policy?.currency ?? 'THB'}
                        options={currencies.map((c) => [c, c])}
                      />
                      <Select
                        label="รูปแบบ"
                        name="mode"
                        defaultValue={policy?.mode ?? 'all'}
                        options={[
                          ['all', 'พิจารณาทุกรายการ'],
                          ['above', 'พิจารณาเมื่อเกินวงเงิน'],
                        ]}
                      />
                      <Input
                        label="วงเงิน (เฉพาะแบบเกินวงเงิน)"
                        name="threshold"
                        defaultValue={policy ? moneyInput(policy.threshold) : ''}
                        inputMode="decimal"
                      />
                    </div>
                    <Textarea
                      label="ที่มา / ขอบเขตเกณฑ์"
                      name="note"
                      defaultValue={policy?.note}
                      required
                      maxLength={500}
                    />
                    <Check name="checked" label="ตกลงเกณฑ์นี้กับเจ้าของร้านแล้ว" />
                  </ActionDialog>
                )}
              </DialogButton>
            )
          }
        >
          {policy ? (
            <dl className="grid gap-1 text-sm">
              <dd>
                ผู้อนุมัติ: <b>{policy.approver}</b> ({roleName(policy.approverRole)})
              </dd>
              <dd>
                {policy.mode === 'all'
                  ? 'พิจารณาทุกรายการ'
                  : `พิจารณาเมื่อยอดเกิน ${fmtMoney(policy.threshold, policy.currency)}`}
              </dd>
              <dd className="text-stone-600">{policy.note}</dd>
              <dd className="text-xs text-stone-500">
                ตั้งโดย {policy.person} · {fmtDateTime(policy.at)}
              </dd>
            </dl>
          ) : (
            <Empty>ยังไม่ตั้งเกณฑ์ — ส่งพิจารณาใบจัดซื้อไม่ได้จนกว่าจะตั้ง</Empty>
          )}
        </Card>

        <Card
          title="ผู้ตรวจค่าใช้จ่าย"
          actions={
            owner && (
              <DialogButton
                label={reviewer ? 'เปลี่ยน' : 'ตั้งผู้ตรวจ'}
                variant="primary"
                size="sm"
              >
                {(close, open) => (
                  <ActionDialog
                    open={open}
                    onClose={close}
                    title="ผู้ตรวจค่าใช้จ่าย"
                    submit={(f, run) =>
                      run(
                        'saveExpenseReviewer',
                        {
                          reviewerUserId: str(f, 'reviewer'),
                          note: str(f, 'note'),
                          checked: bool(f, 'checked'),
                        },
                        'บันทึกผู้ตรวจแล้ว',
                      )
                    }
                  >
                    <Select
                      label="ผู้ตรวจ"
                      name="reviewer"
                      defaultValue={memberIdByName(reviewer?.name)}
                      options={options}
                    />
                    <Textarea
                      label="ขอบเขตการตรวจ"
                      name="note"
                      defaultValue={reviewer?.note}
                      required
                      maxLength={500}
                    />
                    <Check name="checked" label="ตกลงผู้ตรวจนี้กับเจ้าของร้านแล้ว" />
                  </ActionDialog>
                )}
              </DialogButton>
            )
          }
        >
          {reviewer ? (
            <dl className="grid gap-1 text-sm">
              <dd>
                ผู้ตรวจ: <b>{reviewer.name}</b> ({roleName(reviewer.role)})
              </dd>
              <dd className="text-stone-600">{reviewer.note}</dd>
              <dd className="text-xs text-stone-500">
                ตั้งโดย {reviewer.person} · {fmtDateTime(reviewer.at)}
              </dd>
            </dl>
          ) : (
            <Empty>ยังไม่ตั้งผู้ตรวจ — ส่งตรวจค่าใช้จ่ายไม่ได้จนกว่าจะตั้ง</Empty>
          )}
        </Card>
      </div>
      <Card title="ประวัติเกณฑ์อนุมัติ" className="mt-4">
        <Table head={['เวลา', 'ผู้อนุมัติ', 'เกณฑ์', 'ตั้งโดย']} empty="ยังไม่มีประวัติ">
          {[...state.purchasePolicyAudit].reverse().map((p) => (
            <tr key={p.id}>
              <Td>{fmtDateTime(p.at)}</Td>
              <Td>
                {p.approver} ({roleName(p.approverRole)})
              </Td>
              <Td>
                {p.mode === 'all' ? 'ทุกรายการ' : `เกิน ${fmtMoney(p.threshold, p.currency)}`}
              </Td>
              <Td>{p.person}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
