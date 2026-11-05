/** Entry screens: gate (where to go), login (cloud), create shop. */
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ApiError, type ShopTemplate } from '../lib/api';
import { cloudConfigured } from '../lib/backend';
import { useBackend, useMemberships } from '../state';
import { Button, Card, FormError, Input, Select } from '../ui';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-shell">
      <div>
        <span className="brand-name">
          DALDAL<span className="brand-dot">●</span>
        </span>
        <span className="brand-caption">NOODLE HOUSE / OPERATIONS</span>
        <h1>ระบบจัดการร้าน</h1>
        <p className="subtitle">สต็อก · จัดซื้อ · ตรวจรับ · ค่าใช้จ่าย</p>
      </div>
      {children}
    </main>
  );
}

export function Loading({ label = 'กำลังโหลด…' }: { label?: string }) {
  return <div className="empty">{label}</div>;
}

/** Decides where the user goes: login, create a shop, the only shop, or a shop picker. */
export function Gate() {
  const { identity, mode } = useBackend();
  const me = useMemberships();
  if (!identity) return mode === 'cloud' ? <Navigate to="/login" replace /> : <Loading />;
  if (me.isPending) return <Loading />;
  if (me.isError)
    return (
      <Shell>
        <FormError error={(me.error as Error).message} />
        <Button onClick={() => me.refetch()}>ลองใหม่</Button>
      </Shell>
    );
  const shops = me.data.memberships;
  if (shops.length === 1) return <Navigate to={`/s/${shops[0]!.shopId}/home`} replace />;
  if (!shops.length) return <Navigate to="/new-shop" replace />;
  return (
    <Shell>
      <Card title="เลือกร้าน">
        <ul className="shop-list">
          {shops.map((s) => (
            <li key={s.shopId}>
              <Link to={`/s/${s.shopId}/home`} className="shop-link">
                <b>{s.shopName}</b>
                <small>{s.displayName}</small>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/new-shop" className="text-button">
          + สร้างร้านใหม่
        </Link>
      </Card>
    </Shell>
  );
}

export function LoginPage() {
  const { identity, mode, setMode } = useBackend();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  if (identity && mode === 'cloud') return <Navigate to="/" replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email')).trim();
    const password = String(f.get('password') ?? '');
    setBusy(true);
    setError(null);
    const sb = (await import('../lib/cloud-backend')).supabaseClient();
    const r = password
      ? await sb.auth.signInWithPassword({ email, password })
      : await sb.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: location.origin, shouldCreateUser: true },
        });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    if (password) navigate('/');
    else setSent(true);
  }

  return (
    <Shell>
      {cloudConfigured ? (
        <Card title="เข้าสู่ระบบ">
          {sent ? (
            <p>ส่งลิงก์เข้าสู่ระบบไปที่อีเมลแล้ว เปิดลิงก์จากเครื่องนี้เพื่อเข้าใช้งาน</p>
          ) : (
            <form onSubmit={submit} className="auth-form">
              <Input label="อีเมล" name="email" type="email" required autoComplete="email" />
              <Input
                label="รหัสผ่าน"
                name="password"
                type="password"
                autoComplete="current-password"
                hint="เว้นว่างเพื่อรับลิงก์เข้าสู่ระบบทางอีเมล"
              />
              <FormError error={error} />
              <Button type="submit" variant="primary" busy={busy}>
                เข้าสู่ระบบ
              </Button>
            </form>
          )}
        </Card>
      ) : (
        <Card>
          <p className="muted">
            ยังไม่ได้เชื่อมต่อ Supabase (ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
            ใช้งานได้เฉพาะโหมดทดลอง
          </p>
        </Card>
      )}
      <Card title="ทดลองใช้งาน">
        <p className="muted">
          ข้อมูลตัวอย่างเก็บในเบราว์เซอร์นี้เท่านั้น สลับดูมุมมองเจ้าของ / ผู้จัดการ / พนักงานได้
        </p>
        <Button
          variant={cloudConfigured ? 'secondary' : 'primary'}
          onClick={() => {
            setMode('demo');
            navigate('/');
          }}
        >
          เปิดโหมดทดลอง
        </Button>
      </Card>
    </Shell>
  );
}

export function NewShopPage() {
  const { api, identity, mode } = useBackend();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!identity) return mode === 'cloud' ? <Navigate to="/login" replace /> : <Loading />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const r = await api.createShop({
        name: String(f.get('name')),
        displayName: String(f.get('displayName')),
        template: f.get('template') as ShopTemplate,
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(`/s/${r.shopId}/home`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'สร้างร้านไม่สำเร็จ');
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Card title="สร้างร้านใหม่">
        <form onSubmit={submit} className="auth-form">
          <Input label="ชื่อร้าน / สาขา" name="name" required maxLength={100} />
          <Input
            label="ชื่อของคุณ (แสดงในประวัติและการอนุมัติ)"
            name="displayName"
            required
            maxLength={80}
          />
          <Select
            label="เริ่มจาก"
            name="template"
            defaultValue="starter"
            options={[
              ['starter', 'หน่วยนับ + วัตถุดิบตัวอย่าง 8 รายการ'],
              ['blank', 'ว่าง (มีเฉพาะหน่วยนับ)'],
              ['demo', 'ข้อมูลตัวอย่างครบทุกขั้นตอน'],
            ]}
          />
          <FormError error={error} />
          <Button type="submit" variant="primary" busy={busy}>
            สร้างร้าน
          </Button>
        </form>
      </Card>
    </Shell>
  );
}
