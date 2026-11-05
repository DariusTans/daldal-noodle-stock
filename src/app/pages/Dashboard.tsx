import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { movementKinds, type ReportKind } from '@/domain';
import { ApiError } from '../lib/api';
import { fmtDateTime, fmtMoney, fmtQty } from '../lib/format';
import { useBackend, useShop } from '../state';
import { Badge, Button, Card, Empty, FormError, Input, PageHeader, Stat, Table, Td } from '../ui';
import { Loading } from './Entry';

export function DashboardPage() {
  const { api } = useBackend();
  const { shopId, view } = useShop();
  const [range, setRange] = useState({ from: '', to: '' });
  const report = useQuery({
    queryKey: ['report', shopId, view.role, view.revision, range.from, range.to],
    queryFn: () => api.report(shopId, range),
  });
  const [csvError, setCsvError] = useState<string | null>(null);

  async function download(kind: ReportKind) {
    setCsvError(null);
    try {
      const csv = await api.reportCsv(shopId, range, kind);
      const url = URL.createObjectURL(
        new Blob(['﻿' + csv.replace(/^﻿/, '')], { type: 'text/csv;charset=utf-8' }),
      );
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `daldal-${kind}-${range.from || 'all'}-${range.to || 'all'}.csv`,
      });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setCsvError(e instanceof ApiError ? e.message : 'ดาวน์โหลดไม่สำเร็จ');
    }
  }

  const r = report.data;
  return (
    <>
      <PageHeader
        eyebrow="รายงาน"
        title="รายงาน"
        sub="ยอดซื้อกับค่าใช้จ่ายแยกกันเสมอ ห้ามบวกรวมเป็นรายจ่ายซ้ำ · ไม่ใช่รายงานยอดขายหรือกำไร · วันที่ตามเวลาไทย"
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="ตั้งแต่"
            type="date"
            value={range.from}
            onChange={(e) => setRange((x) => ({ ...x, from: e.target.value }))}
          />
          <Input
            label="ถึง"
            type="date"
            value={range.to}
            onChange={(e) => setRange((x) => ({ ...x, to: e.target.value }))}
          />
          <Button variant="ghost" onClick={() => setRange({ from: '', to: '' })}>
            ทั้งหมด
          </Button>
          <span className="ml-auto flex flex-wrap gap-1">
            {(
              [
                'stock',
                'movements',
                'receipts',
                ...(r?.finance ? (['purchases', 'expenses'] as const) : []),
              ] as ReportKind[]
            ).map((k) => (
              <Button key={k} size="sm" onClick={() => download(k)}>
                CSV{' '}
                {
                  (
                    {
                      stock: 'สต็อก',
                      movements: 'เคลื่อนไหว',
                      receipts: 'ตรวจรับ',
                      purchases: 'ยอดซื้อ',
                      expenses: 'ค่าใช้จ่าย',
                    } as const
                  )[k]
                }
              </Button>
            ))}
          </span>
        </div>
        <FormError error={csvError ?? (report.error ? (report.error as Error).message : null)} />
      </Card>
      {!r ? (
        report.isPending ? (
          <Loading />
        ) : null
      ) : (
        <>
          {r.finance && (
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(r.finance.purchaseTotals).map(([c, total]) => (
                <Stat
                  key={'p' + c}
                  label={`ยอดซื้อ (${c})`}
                  value={fmtMoney(total!, c)}
                  hint="วันที่บันทึกซื้อ · ไม่ใช่ค่าใช้จ่าย"
                />
              ))}
              {Object.entries(r.finance.expenseTotals).map(([c, t]) => (
                <Stat
                  key={'e' + c}
                  label={`ค่าใช้จ่ายยืนยันแล้ว (${c})`}
                  value={fmtMoney(t!.total, c)}
                  hint={Object.entries(t!.categories)
                    .map(([k, v]) => `${k} ${fmtMoney(v!, c)}`)
                    .join(' · ')}
                />
              ))}
              {!Object.keys(r.finance.purchaseTotals).length &&
                !Object.keys(r.finance.expenseTotals).length && (
                  <Stat label="การเงินในช่วงนี้" value="0" />
                )}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="สต็อกปัจจุบัน (ไม่กรองช่วงวัน)">
              <Table head={['วัตถุดิบ', 'ยอดอ้างอิง', 'ฐานยอด', '']}>
                {r.stock
                  .filter((x) => x.active)
                  .map((x) => (
                    <tr key={x.id}>
                      <Td>{x.name}</Td>
                      <Td className="font-semibold">{fmtQty(x.referenceQty, x.unit)}</Td>
                      <Td className="text-xs text-stone-600">{x.basis}</Td>
                      <Td>
                        {x.low && <Badge tone="warning">ต่ำกว่าจุดเตือน</Badge>}{' '}
                        {x.needsReview && <Badge>รอตรวจครบ</Badge>}
                      </Td>
                    </tr>
                  ))}
              </Table>
            </Card>
            <Card title="สรุปเคลื่อนไหวในช่วง">
              {r.movementGroups.length ? (
                <Table
                  head={[
                    'วัตถุดิบ',
                    ...(['receive', 'use', 'waste'] as const).map((k) => movementKinds[k]),
                    'ปรับ/กลับ',
                    'สุทธิ',
                  ]}
                >
                  {r.movementGroups.map((g) => (
                    <tr key={g.ingredientId + g.unit}>
                      <Td>{g.name}</Td>
                      <Td>{fmtQty(g.receive)}</Td>
                      <Td>{fmtQty(g.use)}</Td>
                      <Td>{fmtQty(g.waste)}</Td>
                      <Td>{fmtQty(g.increase + g.decrease + g.reverse)}</Td>
                      <Td className="font-semibold">{fmtQty(g.net, g.unit)}</Td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <Empty>ไม่มีเคลื่อนไหวในช่วงนี้</Empty>
              )}
            </Card>
            <Card title="ตรวจรับที่ยืนยันในช่วง">
              <Table head={['เวลา', 'วัตถุดิบ', 'รับ / ไม่รับ', 'ผลตรวจ']} empty="ไม่มีรายการ">
                {r.receipts.map((x) => (
                  <tr key={x.id}>
                    <Td className="whitespace-nowrap">{fmtDateTime(x.at)}</Td>
                    <Td>{x.name}</Td>
                    <Td>
                      {fmtQty(x.accepted, x.unit)} / {fmtQty(x.rejected, x.unit)}
                    </Td>
                    <Td>{x.issue}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title={`งานค้าง (${r.tasks.length})`}>
              <Table head={['ประเภท', 'รายการ', 'สถานะ']} empty="ไม่มีงานค้าง">
                {r.tasks.map((t) => (
                  <tr key={t.kind + t.id}>
                    <Td>{t.kind}</Td>
                    <Td>{t.label}</Td>
                    <Td>{t.status}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
          <p className="mt-3 text-xs text-stone-500">สร้างเมื่อ {fmtDateTime(r.generatedAt)}</p>
        </>
      )}
    </>
  );
}
