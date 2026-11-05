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
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-5 p-5">
      <div>
        <p className="text-sm font-semibold tracking-widest text-brand">DALDAL ●</p>
        <h1 className="text-3xl font-bold text-stone-900">ระบบจัดการร้าน</h1>
        <p className="text-stone-600">สต็อก · จัดซื้อ · ตรวจรับ · ค่าใช้จ่าย</p>
      </div>
      {children}
    </main>
  );
}

export function Loading({ label = 'กำลังโหลด…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40svh] items-center justify-center gap-2 text-stone-500">
      <span className="size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      {label}
    </div>
  );
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
        <ul className="flex flex-col gap-2">
          {shops.map((s) => (
            <li key={s.shopId}>
              <Link
                to={`/s/${s.shopId}/home`}
                className="flex justify-between rounded-lg px-3 py-2 ring-1 ring-stone-200 hover:bg-stone-50"
              >
                <span className="font-medium">{s.shopName}</span>
                <span className="text-sm text-stone-500">{s.displayName}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/new-shop" className="mt-3 inline-block text-sm text-brand underline">
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
            <p className="text-stone-700">
              ส่งลิงก์เข้าสู่ระบบไปที่อีเมลแล้ว เปิดลิงก์จากเครื่องนี้เพื่อเข้าใช้งาน
            </p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
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
          <p className="text-sm text-stone-600">
            ยังไม่ได้เชื่อมต่อ Supabase (ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
            ใช้งานได้เฉพาะโหมดทดลอง
          </p>
        </Card>
      )}
      <Card title="ทดลองใช้งาน">
        <p className="mb-3 text-sm text-stone-600">
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
        <form onSubmit={submit} className="flex flex-col gap-3">
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
