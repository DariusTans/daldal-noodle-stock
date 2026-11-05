import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { Role } from '@/domain';
import { ApiError, type MemberInfo } from '../lib/api';
import { roleName } from '../lib/format';
import { stateKey, useBackend, useShop, useToast } from '../state';
import {
  Badge,
  Button,
  Card,
  Dialog,
  FormError,
  Input,
  PageHeader,
  Select,
  Table,
  Td,
} from '../ui';

const ROLE_OPTIONS: Array<[Role, string]> = [
  ['owner', roleName('owner')],
  ['manager', roleName('manager')],
  ['staff', roleName('staff')],
];

export function MembersPage() {
  const { members, me, view } = useShop();
  const owner = me.role === 'owner';
  return (
    <>
      <PageHeader
        eyebrow="ตั้งค่า"
        title="สมาชิก / สำรองข้อมูล"
        sub="สิทธิ์ทุกอย่างตรวจที่ระบบหลังบ้านตามบทบาทของสมาชิก · ชื่อที่แสดงใช้ในประวัติและการอนุมัติ"
        actions={owner && <InviteButton />}
      />
      <Card title="สมาชิกในร้าน">
        <Table head={['ชื่อ', 'บทบาท', 'สถานะ', '']}>
          {members.map((m) => (
            <MemberRow
              key={m.userId}
              m={m}
              editable={owner && m.userId !== me.userId}
              self={m.userId === me.userId}
            />
          ))}
        </Table>
      </Card>
      {!view.redacted && <BackupCard />}
    </>
  );
}

function useMemberMutation() {
  const { api } = useBackend();
  const { shopId, me } = useShop();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function mutate(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['members', shopId, me.userId] });
      toast(success);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'ทำรายการไม่สำเร็จ');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { api, shopId, mutate, error, busy };
}

function MemberRow({ m, editable, self }: { m: MemberInfo; editable: boolean; self: boolean }) {
  const { api, shopId, mutate, error, busy } = useMemberMutation();
  return (
    <tr>
      <Td>
        {m.displayName} {self && <Badge tone="info">คุณ</Badge>}
      </Td>
      <Td>
        {editable ? (
          <select
            aria-label={'บทบาทของ ' + m.displayName}
            value={m.role}
            disabled={busy}
            onChange={(e) =>
              mutate(
                () => api.updateMember(shopId, { userId: m.userId, role: e.target.value as Role }),
                'เปลี่ยนบทบาทแล้ว',
              )
            }
            className="rounded-lg px-2 py-1 ring-1 ring-stone-300"
          >
            {ROLE_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : (
          roleName(m.role)
        )}
      </Td>
      <Td>{m.active ? <Badge tone="success">ใช้งาน</Badge> : <Badge>พักการใช้งาน</Badge>}</Td>
      <Td className="text-right">
        {editable && (
          <Button
            size="sm"
            variant={m.active ? 'danger' : 'secondary'}
            busy={busy}
            onClick={() =>
              mutate(
                () => api.updateMember(shopId, { userId: m.userId, active: !m.active }),
                m.active ? 'พักการใช้งานแล้ว' : 'เปิดใช้งานแล้ว',
              )
            }
          >
            {m.active ? 'พักการใช้งาน' : 'เปิดใช้งาน'}
          </Button>
        )}
        {error && <span className="block text-xs text-red-700">{error}</span>}
      </Td>
    </tr>
  );
}

function InviteButton() {
  const [open, setOpen] = useState(false);
  const { api, shopId, mutate, error, busy } = useMemberMutation();
  const { mode } = useBackend();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await mutate(
      () =>
        api.invite(shopId, {
          email: String(f.get('email')).trim(),
          displayName: String(f.get('displayName')).trim(),
          role: f.get('role') as Role,
        }),
      'เพิ่มสมาชิกแล้ว',
    );
    if (ok) setOpen(false);
  }
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        + เชิญสมาชิก
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="เชิญสมาชิก">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input label="อีเมล" name="email" type="email" required />
          <Input label="ชื่อที่แสดง" name="displayName" required maxLength={80} />
          <Select label="บทบาท" name="role" defaultValue="staff" options={ROLE_OPTIONS} />
          <p className="text-xs text-stone-500">
            {mode === 'cloud'
              ? 'ระบบจะส่งอีเมลเชิญให้ตั้งรหัสผ่าน (ถ้ายังไม่มีบัญชี)'
              : 'โหมดทดลอง: ไม่ส่งอีเมลจริง'}
          </p>
          <FormError error={error} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)}>ยกเลิก</Button>
            <Button type="submit" variant="primary" busy={busy}>
              เพิ่มสมาชิก
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function BackupCard() {
  const { api } = useBackend();
  const { shopId, view, me } = useShop();
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function exportJson() {
    const blob = new Blob([JSON.stringify(view.state, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `daldal-backup-rev${view.revision}-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importJson(f: File) {
    setError(null);
    if (!confirmImport()) return;
    setBusy(true);
    try {
      const backup = JSON.parse(await f.text());
      const next = await api.importBackup(shopId, backup, view.revision);
      qc.setQueryData(stateKey(shopId, me.userId), next);
      toast('นำเข้าข้อมูลแล้ว');
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : e instanceof SyntaxError
            ? 'ไฟล์ไม่ใช่ JSON ที่ถูกต้อง'
            : 'นำเข้าไม่สำเร็จ',
      );
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  return (
    <Card title="สำรอง / นำเข้าข้อมูล" className="mt-4">
      <p className="mb-3 text-sm text-stone-600">
        ไฟล์สำรองเป็นรูปแบบเดียวกับต้นแบบเดิม (schemaVersion 6) · การนำเข้าเป็นการ<b>แทนที่</b>
        ข้อมูลร้านทั้งหมด ไม่ใช่รวม — สำรองก่อนเสมอ · รองรับไฟล์จากต้นแบบรุ่น 1–6
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={exportJson}>ดาวน์โหลดไฟล์สำรอง</Button>
        {me.role === 'owner' && (
          <>
            <Button variant="danger" busy={busy} onClick={() => file.current?.click()}>
              นำเข้าและแทนที่…
            </Button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
            />
          </>
        )}
      </div>
      <div className="mt-2">
        <FormError error={error} />
      </div>
    </Card>
  );
}

// Native confirm is fine here: a deliberate, rare, destructive action.
const confirmImport = () =>
  window.confirm('นำเข้าไฟล์นี้แทนที่ข้อมูลร้านทั้งหมด? (ควรดาวน์โหลดไฟล์สำรองก่อน)');
