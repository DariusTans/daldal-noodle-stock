/**
 * Dashboard และรายงาน — same markup as legacy report-ui.js. The report is computed on the
 * server (/api/report) so finance never reaches staff; CSV comes from the same endpoint.
 */
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { reportRange, type Report, type ReportKind } from '@/domain';
import { ApiError } from '../lib/api';
import { fmtDateTime, todayBangkok } from '../lib/format';
import { useBackend, useShop, useToast } from '../state';
import { FormError, PageHeader } from '../ui';
import { Loading } from './Entry';
import { useFlow } from './Home';

const num = (n: number | null | undefined) =>
  n === null || n === undefined
    ? '—'
    : Number(n).toLocaleString('th-TH', { maximumFractionDigits: 3 });
const money = (n: number, c: string) =>
  `${(n / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ${c}`;
const month = () => {
  const t = todayBangkok();
  return { from: t.slice(0, 8) + '01', to: t };
};

function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <div className="empty">ไม่มีรายการในขอบเขตนี้</div>;
  return (
    <>
      <div className="report-caption">บนจอเล็ก เลื่อนตารางซ้าย–ขวาเพื่อดูทุกคอลัมน์</div>
      <div className="table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              {headers.map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={i}>
                {c.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function DashboardPage() {
  const { api, backend } = useBackend();
  const { shopId, view } = useShop();
  const flow = useFlow();
  const toast = useToast();
  const [range, setRange] = useState(backend.mode === 'demo' ? { from: '', to: '' } : month());
  const [error, setError] = useState<string | null>(null);
  const report = useQuery({
    queryKey: ['report', shopId, view.role, view.revision, range.from, range.to],
    queryFn: () => api.report(shopId, range),
  });

  async function exportCsv(kind: ReportKind) {
    try {
      const csv = await api.reportCsv(shopId, range, kind);
      const url = URL.createObjectURL(
        new Blob(['﻿' + csv.replace(/^﻿/, '')], { type: 'text/csv;charset=utf-8' }),
      );
      Object.assign(document.createElement('a'), {
        href: url,
        download: `daldal-${kind}-${todayBangkok()}.csv`,
      }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('ดาวน์โหลดรายงาน CSV แล้ว');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'ดาวน์โหลดไม่สำเร็จ', 'error');
    }
  }
  const Export = ({ kind, label }: { kind: ReportKind; label: string }) => (
    <button className="secondary" type="button" onClick={() => exportCsv(kind)}>
      {label} CSV ↓
    </button>
  );
  const Source = ({
    page,
    id,
    label = 'เปิดรายการ',
  }: {
    page: string;
    id: string;
    label?: string;
  }) => (
    <button className="text-button" type="button" onClick={() => flow(page, id)}>
      {label} →
    </button>
  );
  const StatLink = ({ page, label, value }: { page: string; label: string; value: number }) => (
    <a
      className="stat"
      href={'#' + page}
      onClick={(e) => {
        e.preventDefault();
        flow(page);
      }}
    >
      <div>
        <small>{label}</small>
        <strong>
          {value}
          <span className="stat-unit">รายการ</span>
        </strong>
      </div>
    </a>
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      setRange(reportRange(String(f.get('from') ?? ''), String(f.get('to') ?? '')));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const r: Report | undefined = report.data;
  if (!r)
    return report.isError ? <FormError error={(report.error as Error).message} /> : <Loading />;
  const active = r.stock.filter((x) => x.active),
    low = active.filter((x) => x.low),
    missing = active.filter((x) => x.baseQty === null),
    review = active.filter((x) => x.needsReview);

  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW / REPORTS"
        title="Dashboard และรายงาน"
        sub="ติดตามข้อมูลร้านจากรายการที่บันทึกจริง"
      />
      <div className="report-scope">
        <b>{backend.mode === 'demo' ? 'ข้อมูลของเบราว์เซอร์นี้' : 'ข้อมูลร้านล่าสุด'}</b>
        <span>แสดงเมื่อ {fmtDateTime(r.generatedAt)} · ไม่มีข้อมูลยอดขายหรือกำไร</span>
      </div>
      <section className="report-current">
        <div className="report-heading">
          <div>
            <span className="eyebrow">CURRENT STATUS</span>
            <h2>สถานะปัจจุบัน</h2>
            <p>สต็อกและงานค้างทั้งหมด ไม่เปลี่ยนตามตัวกรองวันที่ด้านล่าง</p>
          </div>
        </div>
        <div className="stats report-stats">
          <StatLink page="alerts" label="เข้าเกณฑ์เตือนซื้อ" value={low.length} />
          <StatLink page="counting" label="ยังไม่มียอดนับยืนยัน" value={missing.length} />
          <StatLink page="movements" label="ยังไม่รับรองเคลื่อนไหวครบ" value={review.length} />
        </div>
        <section className="panel">
          <div className="panel-heading">
            <h3>งานค้างที่บทบาทนี้เห็น ({r.tasks.length})</h3>
            <span className="muted">นับตามรายการงาน</span>
          </div>
          <div className="report-tasks">
            {r.tasks.length ? (
              r.tasks.map((t) => (
                <article key={t.kind + t.id}>
                  <div>
                    <small>{t.kind}</small>
                    <b>{t.label}</b>
                    <span>{t.status}</span>
                    <small>{t.id}</small>
                  </div>
                  <Source page={t.page} id={t.id} label="ทำต่อ" />
                </article>
              ))
            ) : (
              <div className="empty">ไม่มีงานค้างที่บันทึกไว้ในระบบ</div>
            )}
          </div>
        </section>
        <details className="panel report-detail">
          <summary>สต็อกปัจจุบัน {r.stock.length} รายการ · ดูยอดและที่มา</summary>
          <div className="report-toolbar">
            <Export kind="stock" label="สต็อกปัจจุบัน" />
          </div>
          <p className="report-caption">
            ยอดอ้างอิงใช้ยอดนับล่าสุด จนกว่าคนรับรองว่าเคลื่อนไหวครบ จึงใช้ยอดคำนวณ
            ไม่รวมจำนวนต่างหน่วยเข้าด้วยกัน วัตถุดิบพักใช้งานไม่รวมตัวเลขเตือนด้านบน
          </p>
          <Table
            headers={[
              'วัตถุดิบ',
              'ยอดอ้างอิง / หน่วย',
              'ที่มาและเวลา',
              'ยอดคำนวณ',
              'จุดเตือน / สถานะ',
            ]}
            rows={r.stock.map((x) => [
              <>
                {x.name}
                <small>
                  {x.code}
                  {x.active ? '' : ' · พักใช้งาน'}
                </small>
              </>,
              `${num(x.referenceQty)} ${x.unit}`,
              <>
                {x.basis}
                <small>{x.referenceAt ? fmtDateTime(x.referenceAt) : '—'}</small>
              </>,
              num(x.ledger),
              <>
                {num(x.minimum)}
                <small>
                  {x.low
                    ? 'เข้าเกณฑ์เตือน'
                    : x.minimum === null
                      ? 'ยังไม่ตั้ง/ปิดเตือน'
                      : 'ไม่เข้าเกณฑ์'}
                </small>
              </>,
            ])}
          />
        </details>
      </section>
      <section className="report-period">
        <span className="eyebrow">PERIOD REPORT</span>
        <h2>รายงานตามช่วงวันที่</h2>
        <form
          id="report-filter"
          className="report-filters"
          onSubmit={submit}
          key={range.from + range.to}
        >
          <label className="field">
            ตั้งแต่
            <input type="date" name="from" defaultValue={range.from} />
          </label>
          <label className="field">
            ถึง
            <input type="date" name="to" defaultValue={range.to} />
          </label>
          <button className="primary" type="submit">
            ดูรายงาน
          </button>
          <button
            className="secondary"
            type="button"
            id="report-all"
            onClick={() => setRange({ from: '', to: '' })}
          >
            ทั้งหมด
          </button>
          <button
            className="secondary"
            type="button"
            id="report-month"
            onClick={() => setRange(month())}
          >
            เดือนนี้
          </button>
        </form>
        <FormError error={error} />
        <p className="report-caption" id="report-range-label">
          ขอบเขตรายงาน: {range.from || 'เริ่มต้น'} ถึง {range.to || 'ล่าสุด'} · วันตามเวลาไทย
          รวมวันเริ่มและวันสิ้นสุด
        </p>
        {r.finance ? (
          <Finance r={r} Export={Export} Source={Source} />
        ) : (
          <div className="section-note">
            บทบาทพนักงานดูรายงานสต็อกและรับสินค้าได้ ไม่เปิดรายงานราคาซื้อและค่าใช้จ่าย
          </div>
        )}
        <details className="panel report-detail">
          <summary>เคลื่อนไหวสต็อกในช่วงวันที่ · {r.moves.length} รายการ</summary>
          <div className="report-toolbar">
            <Export kind="movements" label="เคลื่อนไหว" />
          </div>
          <p className="report-caption">
            กรองเวลาบันทึก รวมรายการกลับยอด ผลรวมสุทธิเป็นการเปลี่ยนจากรายการในช่วงนี้
            ไม่ใช่ยอดคงเหลือ และไม่ใช้แทนยอดนับเมื่อมีรอบนับใหม่
          </p>
          <Table
            headers={[
              'วัตถุดิบ / หน่วย',
              'รับเข้า',
              'เบิกใช้',
              'ของเสีย',
              'ปรับเพิ่ม / ลด',
              'กลับยอด',
              'สุทธิ',
            ]}
            rows={r.movementGroups.map((x) => [
              <>
                {x.name}
                <small>{x.unit}</small>
              </>,
              num(x.receive),
              num(x.use),
              num(x.waste),
              `${num(x.increase)} / ${num(x.decrease)}`,
              num(x.reverse),
              num(x.net),
            ])}
          />
          <div className="report-toolbar">
            <a
              href="#movements"
              onClick={(e) => {
                e.preventDefault();
                flow('movements');
              }}
            >
              เปิดประวัติเคลื่อนไหว →
            </a>
          </div>
        </details>
        <details className="panel report-detail">
          <summary>ตรวจรับที่ยังยืนยัน ในช่วงวันที่ · {r.receipts.length} รายการ</summary>
          <div className="report-toolbar">
            <Export kind="receipts" label="ตรวจรับ" />
          </div>
          <p className="report-caption">
            กรองเวลายืนยัน ไม่รวมใบรับที่กลับรายการภายหลัง ยอดนี้แสดงตามสถานะปัจจุบัน
          </p>
          <Table
            headers={['วัตถุดิบ / ส่งของ', 'วันที่ยืนยัน', 'รับจริง / ไม่รับ', 'ผลตรวจ', 'ต้นทาง']}
            rows={r.receipts.map((x) => [
              <>
                {x.name}
                <small>{x.reference}</small>
              </>,
              fmtDateTime(x.at),
              `${num(x.accepted)} / ${num(x.rejected)} ${x.unit}`,
              x.issue,
              <Source page="receiving" id={x.orderId} />,
            ])}
          />
        </details>
      </section>
      <div className="section-note">
        รายงานคำนวณจากข้อมูลและสถานะปัจจุบัน
        การยกเลิกหรือแก้ไขข้อมูลภายหลังทำให้รายงานช่วงเดิมเปลี่ยนได้
        ยังไม่ใช่งบปิดย้อนหลังหรือรายงานบัญชี
      </div>
    </>
  );
}

function Finance({
  r,
  Export,
  Source,
}: {
  r: Report;
  Export: (p: { kind: ReportKind; label: string }) => ReactNode;
  Source: (p: { page: string; id: string; label?: string }) => ReactNode;
}) {
  const f = r.finance!;
  return (
    <>
      <section className="panel report-finance">
        <div className="panel-heading">
          <h3>ค่าใช้จ่ายยืนยันแล้ว · {f.expenses.length} รายการ</h3>
          <Export kind="expenses" label="ค่าใช้จ่าย" />
        </div>
        <p className="report-caption">
          กรองตามวันที่บิล เฉพาะสถานะยืนยันปัจจุบัน ไม่รวมร่าง รอตรวจ ส่งกลับ หรือยกเลิก แยกสกุลเงิน
          ไม่แปลงอัตราแลกเปลี่ยน
        </p>
        <div className="report-money-grid">
          {Object.entries(f.expenseTotals).length ? (
            Object.entries(f.expenseTotals).map(([c, t]) => {
              const cats = Object.entries(t!.categories) as Array<[string, number]>;
              const max = Math.max(...cats.map(([, n]) => n));
              return (
                <article className="report-money-card" key={c}>
                  <small>
                    {c} · {t!.count} รายการ
                  </small>
                  <strong>{money(t!.total, c)}</strong>
                  <p>
                    เงินร้าน {money(t!.shop, c)}
                    <br />
                    สำรองส่วนตัว {money(t!.personal, c)}
                  </p>
                  <div className="report-bars">
                    {cats
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, n]) => (
                        <div key={cat}>
                          <span>
                            {cat} <b>{money(n, c)}</b>
                          </span>
                          <div className="report-track">
                            <i style={{ width: `${Math.round((n / max) * 100)}%` }}></i>
                          </div>
                        </div>
                      ))}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="empty">ไม่มีค่าใช้จ่ายที่ยืนยันในช่วงนี้</div>
          )}
        </div>
        <p className="report-caption">
          เงินสำรองเป็นแหล่งเงินที่จ่าย ไม่ใช่ยอดค้างคืน · แถบเปรียบเทียบเฉพาะหมวดในสกุลเงินเดียวกัน
        </p>
        <details className="report-detail">
          <summary>ดูรายการค่าใช้จ่ายต้นทาง</summary>
          <Table
            headers={[
              'วันที่บิล / เลขบิล',
              'ร้านค้า / หมวด',
              'ยอดเงิน',
              'แหล่งเงิน / ผู้จ่าย',
              'ต้นทาง',
            ]}
            rows={f.expenses.map((e) => [
              <>
                {e.date}
                <small>{e.reference || '—'}</small>
              </>,
              <>
                {e.vendor}
                <small>{e.category}</small>
              </>,
              money(e.amount, e.currency),
              <>
                {e.funding === 'shop' ? 'เงินร้าน' : 'สำรองส่วนตัว'}
                <small>{e.payer}</small>
              </>,
              <Source page="expenses" id={e.id} />,
            ])}
          />
        </details>
      </section>
      <section className="panel report-finance">
        <div className="panel-heading">
          <h3>บันทึกซื้อแล้ว · {f.purchases.length} ใบ</h3>
          <Export kind="purchases" label="จัดซื้อ" />
        </div>
        <p className="report-caption">
          กรองตามวันที่บันทึกซื้อ แสดงยอดใบซื้อเต็มจำนวน ไม่หักตามการรับบางส่วนหรือการคืนเงิน
          ไม่ใช่ยอดค่าใช้จ่าย และห้ามนำไปบวกกับค่าใช้จ่ายด้านบน
        </p>
        <div className="report-purchase-totals">
          {Object.entries(f.purchaseTotals).length ? (
            Object.entries(f.purchaseTotals).map(([c, n]) => <b key={c}>{money(n!, c)}</b>)
          ) : (
            <span>ไม่มีใบซื้อในช่วงนี้</span>
          )}
        </div>
        <details className="report-detail">
          <summary>ดูใบซื้อและสถานะตรวจรับปัจจุบัน</summary>
          <Table
            headers={[
              'วันที่ซื้อ / เลขซื้อ',
              'วัตถุดิบ / ร้านค้า',
              'ยอดซื้อ',
              'สั่ง / รับสะสมปัจจุบัน',
              'สถานะปัจจุบัน',
              'ต้นทาง',
            ]}
            rows={f.purchases.map((o) => [
              <>
                {fmtDateTime(o.at)}
                <small>{o.reference}</small>
              </>,
              <>
                {o.name}
                <small>{o.vendor}</small>
              </>,
              money(o.total, o.currency),
              `${num(o.orderedQty)} / ${num(o.receivedQty)} ${o.unit}`,
              o.status,
              <Source page="buy" id={o.id} />,
            ])}
          />
        </details>
      </section>
    </>
  );
}
