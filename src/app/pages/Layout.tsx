import { useState, type ComponentType } from 'react';
import { Link, Navigate, NavLink, useNavigate, useParams } from 'react-router';
import { DEMO_PEOPLE, type DemoBackend } from '../lib/backend';
import { roleName } from '../lib/format';
import { ShopProvider, useBackend, useMemberships, useShop, useShopQueries } from '../state';
import { Badge, Button, cx, FormError } from '../ui';
import { Loading } from './Entry';
import { BuyPage } from './Buy';
import { CountingPage } from './Counting';
import { DashboardPage } from './Dashboard';
import { ExpensesPage } from './Expenses';
import { HomePage } from './Home';
import { IngredientsPage, UnitsPage } from './MasterData';
import { MembersPage } from './Members';
import { AlertsPage, LatestPage, MovementsPage } from './Stock';
import { ReceivingPage } from './Receiving';
import { SettingsPage } from './Settings';

interface PageDef {
  key: string;
  label: string;
  group?: string;
  component: ComponentType;
  /** hidden from roles that lack this permission */
  needs?: 'expense';
}

export const PAGES: PageDef[] = [
  { key: 'home', label: 'งานวันนี้', component: HomePage },
  { key: 'counting', label: 'นับและยืนยัน', group: 'สต็อก', component: CountingPage },
  { key: 'latest', label: 'ยอดนับล่าสุด', group: 'สต็อก', component: LatestPage },
  { key: 'movements', label: 'เคลื่อนไหว / ตรวจครบ', group: 'สต็อก', component: MovementsPage },
  { key: 'alerts', label: 'เตือนซื้อ / เสนอซื้อ', group: 'สต็อก', component: AlertsPage },
  {
    key: 'buy',
    label: 'จัดซื้อและอนุมัติ',
    group: 'จัดซื้อ',
    component: BuyPage,
    needs: 'expense',
  },
  { key: 'receiving', label: 'ตรวจรับสินค้า', group: 'จัดซื้อ', component: ReceivingPage },
  { key: 'expenses', label: 'ค่าใช้จ่าย', component: ExpensesPage, needs: 'expense' },
  { key: 'dashboard', label: 'รายงาน', component: DashboardPage },
  { key: 'settings', label: 'ตั้งค่าร้าน / เกณฑ์', group: 'ตั้งค่า', component: SettingsPage },
  { key: 'ingredients', label: 'ทะเบียนวัตถุดิบ', group: 'ตั้งค่า', component: IngredientsPage },
  { key: 'units', label: 'หน่วยนับ', group: 'ตั้งค่า', component: UnitsPage },
  { key: 'members', label: 'สมาชิก / สำรองข้อมูล', group: 'ตั้งค่า', component: MembersPage },
];

export function ShopLayout() {
  const { shopId = '', page = 'home' } = useParams();
  const { identity, mode } = useBackend();
  const me = useMemberships();
  const { view, members } = useShopQueries(shopId);

  if (!identity) return mode === 'cloud' ? <Navigate to="/login" replace /> : <Loading />;
  if (me.isPending || view.isPending || members.isPending) return <Loading />;
  const membership = me.data?.memberships.find((m) => m.shopId === shopId);
  if (!membership) return <Navigate to="/" replace />;
  if (view.isError || members.isError)
    return (
      <div className="p-6">
        <FormError error={((view.error ?? members.error) as Error).message} />
      </div>
    );

  return (
    <ShopProvider shopId={shopId} me={membership} view={view.data} members={members.data.members}>
      <Frame page={page} />
    </ShopProvider>
  );
}

function Frame({ page }: { page: string }) {
  const { shopId, me, can, view } = useShop();
  const [open, setOpen] = useState(false);
  const visible = PAGES.filter((p) => !p.needs || can(p.needs));
  const current = visible.find((p) => p.key === page);
  if (!current) return <Navigate to={`/s/${shopId}/home`} replace />;
  const Page = current.component;
  let lastGroup: string | undefined;

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto bg-stone-900 p-4 text-stone-200 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Link to={`/s/${shopId}/home`} className="block">
          <span className="text-xl font-bold text-white">
            DALDAL<span className="text-brand">●</span>
          </span>
          <span className="block text-xs tracking-widest text-stone-400">OPERATIONS</span>
        </Link>
        <p className="mt-4 rounded-lg bg-stone-800 px-3 py-2 text-sm">
          {me.shopName}
          <span className="block text-xs text-stone-400">
            {me.displayName} · {roleName(me.role)}
          </span>
        </p>
        <nav aria-label="เมนูหลัก" className="mt-4 flex flex-col gap-0.5">
          {visible.map((p) => {
            const header = p.group && p.group !== lastGroup ? p.group : null;
            lastGroup = p.group;
            return (
              <div key={p.key}>
                {header && (
                  <p className="mt-3 mb-1 px-3 text-xs font-semibold text-stone-500">{header}</p>
                )}
                <NavLink
                  to={`/s/${shopId}/${p.key}`}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cx(
                      'block rounded-lg px-3 py-1.5 text-sm',
                      isActive ? 'bg-brand text-white' : 'hover:bg-stone-800',
                    )
                  }
                >
                  {p.label}
                </NavLink>
              </div>
            );
          })}
        </nav>
        <AccountBox />
      </aside>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-stone-900/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="min-w-0 bg-stone-50">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-200 bg-white/90 px-4 py-2 backdrop-blur">
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xl lg:hidden"
            aria-label="เปิดเมนู"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            ☰
          </button>
          <span className="text-sm text-stone-500">{me.shopName}</span>
          <span className="text-stone-300">/</span>
          <strong className="text-sm">{current.label}</strong>
          <span className="ml-auto flex items-center gap-2">
            {view.redacted && <Badge tone="info">มุมมองพนักงาน</Badge>}
            <Badge>{roleName(me.role)}</Badge>
          </span>
        </header>
        <DemoBar />
        <main id="main" className="mx-auto max-w-6xl p-4 pb-20 lg:p-6">
          <Page />
        </main>
      </div>
    </div>
  );
}

function AccountBox() {
  const { backend, mode, setMode } = useBackend();
  const navigate = useNavigate();
  return (
    <div className="mt-6 border-t border-stone-800 pt-4 text-xs text-stone-400">
      {mode === 'cloud' ? (
        <button
          type="button"
          className="underline"
          onClick={async () => {
            await backend.signOut();
            navigate('/login');
          }}
        >
          ออกจากระบบ
        </button>
      ) : (
        <button
          type="button"
          className="underline"
          onClick={() => {
            setMode('cloud');
            navigate('/login');
          }}
        >
          ออกจากโหมดทดลอง
        </button>
      )}
      <Link to="/" className="ml-3 underline">
        เปลี่ยนร้าน
      </Link>
    </div>
  );
}

/** Demo only: switch between the sample owner / manager / staff to see each view. */
function DemoBar() {
  const { backend, identity } = useBackend();
  if (backend.mode !== 'demo') return null;
  const demo = backend as DemoBackend;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      <b>โหมดทดลอง</b>
      <span className="hidden sm:inline">ข้อมูลสมมติในเบราว์เซอร์นี้ · ดูในมุมของ</span>
      {DEMO_PEOPLE.map((p) => (
        <Button
          key={p.email}
          size="sm"
          variant={identity?.email === p.email ? 'primary' : 'secondary'}
          onClick={() => demo.switchTo(p.email)}
        >
          {roleName(p.role)}
        </Button>
      ))}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => demo.reset()}>
        รีเซ็ตข้อมูลตัวอย่าง
      </Button>
    </div>
  );
}
