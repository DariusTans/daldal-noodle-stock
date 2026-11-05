/** App shell — same markup/classes as legacy/index.html (sidebar, topbar, bars, footer). */
import { useState, type ComponentType } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { DEMO_PEOPLE, type DemoBackend, type DemoPerson } from '../lib/backend';
import { roleName } from '../lib/format';
import {
  ShopProvider,
  useBackend,
  useMemberships,
  useShop,
  useShopQueries,
  useToast,
} from '../state';
import { FormError } from '../ui';
import { BuyPage } from './Buy';
import { CountingPage } from './Counting';
import { DashboardPage } from './Dashboard';
import { Loading } from './Entry';
import { ExpensesPage } from './Expenses';
import { HomePage } from './Home';
import { IngredientsPage, UnitsPage } from './MasterData';
import { MembersPage } from './Members';
import { ReceivingPage } from './Receiving';
import { SettingsPage } from './Settings';
import { AlertsPage, LatestPage, MovementsPage } from './Stock';

interface PageDef {
  key: string;
  /** label in the sidebar */
  label: string;
  /** label in the breadcrumb (legacy uses a few longer names) */
  crumb?: string;
  /** legacy main[data-section] */
  section: string;
  icon?: string;
  group?: 'สต็อก' | 'จัดซื้อ' | 'ตั้งค่า';
  component: ComponentType;
}

export const PAGES: PageDef[] = [
  { key: 'home', label: 'งานวันนี้', section: 'งานวันนี้', icon: '◉', component: HomePage },
  {
    key: 'counting',
    label: 'นับและยืนยัน',
    section: 'สต็อก',
    group: 'สต็อก',
    component: CountingPage,
  },
  { key: 'latest', label: 'ยอดนับล่าสุด', section: 'สต็อก', group: 'สต็อก', component: LatestPage },
  {
    key: 'movements',
    label: 'เคลื่อนไหว / ตรวจครบ',
    section: 'สต็อก',
    group: 'สต็อก',
    component: MovementsPage,
  },
  {
    key: 'alerts',
    label: 'เตือนซื้อ / เสนอซื้อ',
    section: 'สต็อก',
    group: 'สต็อก',
    component: AlertsPage,
  },
  {
    key: 'buy',
    label: 'จัดซื้อและอนุมัติ',
    section: 'จัดซื้อ',
    group: 'จัดซื้อ',
    component: BuyPage,
  },
  {
    key: 'receiving',
    label: 'ตรวจรับสินค้า',
    section: 'จัดซื้อ',
    group: 'จัดซื้อ',
    component: ReceivingPage,
  },
  {
    key: 'expenses',
    label: 'ค่าใช้จ่าย',
    section: 'ค่าใช้จ่าย',
    icon: '▧',
    component: ExpensesPage,
  },
  { key: 'dashboard', label: 'รายงาน', section: 'รายงาน', icon: '◫', component: DashboardPage },
  {
    key: 'settings',
    label: 'ตั้งค่าร้าน / เกณฑ์',
    section: 'ตั้งค่า',
    group: 'ตั้งค่า',
    component: SettingsPage,
  },
  {
    key: 'ingredients',
    label: 'ทะเบียนวัตถุดิบ',
    section: 'ตั้งค่า',
    group: 'ตั้งค่า',
    component: IngredientsPage,
  },
  { key: 'units', label: 'หน่วยนับ', section: 'ตั้งค่า', group: 'ตั้งค่า', component: UnitsPage },
  {
    key: 'roles',
    label: 'บทบาท / สำรอง',
    crumb: 'บทบาทผู้ใช้',
    section: 'ตั้งค่า',
    group: 'ตั้งค่า',
    component: MembersPage,
  },
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
      <main>
        <FormError error={((view.error ?? members.error) as Error).message} />
      </main>
    );

  return (
    <ShopProvider shopId={shopId} me={membership} view={view.data} members={members.data.members}>
      <Frame page={page} />
    </ShopProvider>
  );
}

function Frame({ page }: { page: string }) {
  const { shopId, me } = useShop();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const current = PAGES.find((p) => p.key === page);
  if (!current) return <Navigate to={`/s/${shopId}/home`} replace />;
  const Page = current.component;
  const go = (key: string) => {
    setOpen(false);
    navigate(`/s/${shopId}/${key}`);
    window.scrollTo(0, 0);
  };
  const navButton = (p: PageDef) => (
    <button
      key={p.key}
      type="button"
      aria-current={p.key === page ? 'page' : undefined}
      onClick={() => go(p.key)}
    >
      {p.icon && <span>{p.icon}</span>}
      {p.label}
    </button>
  );
  const group = (g: PageDef['group']) => (
    <details className="nav-group" open>
      <summary>{g}</summary>
      {PAGES.filter((p) => p.group === g).map(navButton)}
    </details>
  );
  const byKey = (k: string) => navButton(PAGES.find((p) => p.key === k)!);

  return (
    <>
      <a className="skip" href="#main">
        ข้ามไปเนื้อหา
      </a>
      <aside className={open ? 'sidebar open' : 'sidebar'} id="sidebar">
        <a
          className="brand"
          href={`/s/${shopId}/home`}
          onClick={(e) => {
            e.preventDefault();
            go('home');
          }}
        >
          <span className="brand-name">
            DALDAL<span className="brand-dot">●</span>
          </span>
          <span className="brand-caption">NOODLE HOUSE / OPERATIONS</span>
        </a>
        <div className="shop">
          <span className="shop-icon">{me.shopName.trim().charAt(0) || 'D'}</span>
          <div>
            {me.shopName}
            <small>{me.displayName}</small>
          </div>
        </div>
        <p className="nav-label">พื้นที่ทำงาน</p>
        <nav aria-label="เมนูหลัก">
          {byKey('home')}
          {group('สต็อก')}
          {group('จัดซื้อ')}
          {byKey('expenses')}
          {byKey('dashboard')}
          {group('ตั้งค่า')}
        </nav>
        <SideBottom />
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="crumb">
            <button
              id="menu-toggle"
              type="button"
              className="icon-btn mobile-only"
              aria-label="เปิดเมนู"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              ☰
            </button>
            <span>ระบบจัดการร้าน</span>
            <span className="crumb-slash">/</span>
            <strong id="crumb-page">{current.crumb ?? current.label}</strong>
          </div>
          <RolePicker />
        </header>
        <PrototypeBars />
        <main id="main" tabIndex={-1} data-section={current.section}>
          <Page />
        </main>
        <footer className="footer">
          <span>DALDAL OPERATIONS</span>
          <span>v1.0 · UX / Flow · ไม่มีข้อมูลยอดขาย</span>
        </footer>
      </div>
    </>
  );
}

const initials = (name: string) =>
  name
    .replace(/ตัวอย่าง$/, '')
    .trim()
    .slice(0, 2)
    .toUpperCase();

/** Legacy "ทดลองบทบาท" picker. Demo: switches sample member. Cloud: shows the real role. */
function RolePicker() {
  const { backend, identity } = useBackend();
  const { me } = useShop();
  if (backend.mode === 'demo') {
    const demo = backend as DemoBackend;
    return (
      <label className="role-picker">
        ทดลองบทบาท
        <select
          id="role"
          aria-label="ทดลองบทบาท"
          value={identity?.email}
          onChange={(e) => demo.switchTo(e.target.value as DemoPerson)}
        >
          {DEMO_PEOPLE.map((p) => (
            <option key={p.email} value={p.email}>
              {roleName(p.role)}
            </option>
          ))}
        </select>
        <span className="avatar" id="avatar">
          {initials(me.displayName)}
        </span>
      </label>
    );
  }
  return (
    <span className="role-picker">
      {roleName(me.role)}
      <span className="avatar" id="avatar">
        {initials(me.displayName)}
      </span>
    </span>
  );
}

function PrototypeBars() {
  const { backend, setMode } = useBackend();
  const { view } = useShop();
  const toast = useToast();
  const navigate = useNavigate();
  const backup = () => {
    if (view.redacted) return toast('สำรองข้อมูลได้เฉพาะผู้จัดการหรือเจ้าของ', 'warning');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(
        new Blob([JSON.stringify(view.state, null, 2)], { type: 'application/json' }),
      ),
      download: `daldal-backup-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  if (backend.mode !== 'demo')
    return (
      <div className="prototype-bar">
        <span>
          <b>ระบบร้าน</b> ข้อมูลบันทึกบนเซิร์ฟเวอร์ · สิทธิ์ตรวจตามบทบาทจริง
        </span>
        <button id="backup" type="button" className="text-button" onClick={backup}>
          สำรองข้อมูล ↗
        </button>
      </div>
    );
  const demo = backend as DemoBackend;
  return (
    <>
      <div className="prototype-bar">
        <span>
          <b>โหมดทดลอง</b> ข้อมูลเก็บในเบราว์เซอร์นี้ · บทบาทจำลองไม่ใช่การเข้าสู่ระบบจริง
        </span>
        <button id="backup" type="button" className="text-button" onClick={backup}>
          สำรองข้อมูล ↗
        </button>
      </div>
      <div className="demo-bar">
        <div>
          <b>ข้อมูลตัวอย่างพร้อมทดลอง</b>
          <span>ทุกยอดและชื่อเป็นข้อมูลสมมติ · แก้ไขทดลองได้และเก็บต่อเมื่อกลับมา</span>
        </div>
        <span>
          <button type="button" className="text-button" onClick={() => demo.reset()}>
            รีเซ็ตข้อมูลตัวอย่าง
          </button>{' '}
          <a
            className="secondary"
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              setMode('cloud');
              navigate('/login');
            }}
          >
            ข้อมูลของฉัน →
          </a>
        </span>
      </div>
    </>
  );
}

function SideBottom() {
  const { backend, mode, setMode } = useBackend();
  const navigate = useNavigate();
  return (
    <div className="side-bottom">
      <span className="pilot-dot"></span> DALDAL v1.0 <small>งานต่อเนื่องทั้งร้าน</small>
      <small>
        {mode === 'cloud' ? (
          <button
            type="button"
            className="text-button"
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
            className="text-button"
            onClick={() => {
              setMode('cloud');
              navigate('/login');
            }}
          >
            ออกจากโหมดทดลอง
          </button>
        )}{' '}
        <button type="button" className="text-button" onClick={() => navigate('/')}>
          เปลี่ยนร้าน
        </button>
      </small>
    </div>
  );
}
