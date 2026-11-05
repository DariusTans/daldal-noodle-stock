import { Link } from 'react-router';
import { hasOpenCount, stockRows, workflowTasks } from '@/domain';
import { fmtQty } from '../lib/format';
import { useShop } from '../state';
import { Badge, Card, Empty, PageHeader, Stat } from '../ui';

export function HomePage() {
  const { state, me, shopId } = useShop();
  const tasks = workflowTasks(state, me.role);
  const rows = stockRows(state).filter((r) => r.active);
  const low = rows.filter((r) => r.low);
  const mine = tasks.filter((t) => t.can);
  const others = tasks.filter((t) => !t.can);

  return (
    <>
      <PageHeader
        eyebrow="งานวันนี้"
        title={`สวัสดี ${me.displayName}`}
        sub="รายการค้างทั้งหมดคำนวณจากสถานะเอกสารจริง ทำต่อได้จากแต่ละรายการ"
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="งานที่คุณทำได้" value={mine.length} />
        <Stat label="รอคนอื่น" value={others.length} />
        <Stat
          label="เข้าเกณฑ์เตือนซื้อ"
          value={low.length}
          hint={low
            .map((r) => r.name)
            .slice(0, 3)
            .join(', ')}
        />
        <Stat
          label="รอบนับ"
          value={hasOpenCount(state) ? 'กำลังนับ' : 'ไม่มีค้าง'}
          hint={hasOpenCount(state) ? 'เคลื่อนไหวและเสนอซื้อพักไว้ก่อน' : undefined}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TaskList
          title="ถึงคิวคุณ"
          tasks={mine}
          shopId={shopId}
          empty="ไม่มีงานค้างสำหรับบทบาทนี้"
        />
        <TaskList
          title="รอผู้อื่นดำเนินการ"
          tasks={others}
          shopId={shopId}
          empty="ไม่มีงานรอผู้อื่น"
          muted
        />
      </div>
      <Card title="ยอดอ้างอิงล่าสุด" className="mt-4">
        {rows.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {rows.map((r) => (
              <li key={r.id} className="rounded-lg px-3 py-2 ring-1 ring-stone-200">
                <p className="text-sm text-stone-600">{r.name}</p>
                <p className="font-semibold">{fmtQty(r.referenceQty, r.unit.symbol)}</p>
                {r.low && <Badge tone="warning">ต่ำกว่าจุดเตือน</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>ยังไม่มีวัตถุดิบที่ใช้งาน</Empty>
        )}
      </Card>
    </>
  );
}

function TaskList({
  title,
  tasks,
  shopId,
  empty,
  muted,
}: {
  title: string;
  tasks: ReturnType<typeof workflowTasks>;
  shopId: string;
  empty: string;
  muted?: boolean;
}) {
  return (
    <Card title={`${title} (${tasks.length})`}>
      {tasks.length ? (
        <ul className="flex flex-col gap-2">
          {tasks.map((t) => (
            <li key={t.key}>
              <Link
                to={`/s/${shopId}/${t.page}`}
                className={`block rounded-lg px-3 py-2 ring-1 ring-stone-200 hover:bg-stone-50 ${muted ? 'opacity-80' : ''}`}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-stone-900">{t.title}</span>
                  <Badge tone={muted ? 'neutral' : 'warning'}>{t.status}</Badge>
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {t.done} · ผู้รับผิดชอบ: {t.who}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{empty}</Empty>
      )}
    </Card>
  );
}
