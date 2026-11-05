/**
 * บทบาทผู้ใช้ — legacy roles page (role cards, explanation, backup tools), plus the real
 * member list (v1 has accounts: owners invite members and set their role).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { Role } from '@/domain';
import { ApiError, type MemberInfo } from '../lib/api';
import { DEMO_PEOPLE, type DemoBackend } from '../lib/backend';
import { roleName } from '../lib/format';
import { stateKey, useBackend, useShop, useToast } from '../state';
import { Dialog, FieldGrid, FormError, Input, PageHeader, Select } from '../ui';

const CARDS: Array<{ role: Role; eyebrow: string; items: string[] }> = [
  {
    role: 'owner',
    eyebrow: 'OWNER',
    items: [
      'ดู เพิ่ม แก้ไข และพักวัตถุดิบ',
      'เพิ่มและแก้ไขหน่วยนับ',
      'เริ่มนับ ส่งตรวจ ยืนยัน และส่งกลับแก้ไข',
      'รับ/เบิก/ของเสีย ปรับยอด ตรวจความครบ ตั้งเตือน และตรวจเสนอซื้อ',
      'เทียบซื้อ ส่งพิจารณา และตั้งเกณฑ์อนุมัติทดลอง',
      'ร่างตรวจรับ ยืนยันรับ ติดตามปัญหาและปิดรับ',
      'บันทึก/ตรวจค่าใช้จ่าย ตั้งผู้ตรวจและยกเลิกยอดยืนยัน',
      'เชิญสมาชิก สำรองและนำเข้าข้อมูล',
    ],
  },
  {
    role: 'manager',
    eyebrow: 'MANAGER',
    items: [
      'ดู เพิ่ม แก้ไข และพักวัตถุดิบ',
      'เพิ่มและแก้ไขหน่วยนับ',
      'เริ่มนับ ส่งตรวจ ยืนยัน และส่งกลับแก้ไข',
      'รับ/เบิก/ของเสีย ปรับยอด ตรวจความครบ ตั้งเตือน และตรวจเสนอซื้อ',
      'เทียบซื้อ ส่งพิจารณา บันทึกซื้อ (อนุมัติตามเกณฑ์ที่ตั้ง)',
      'ร่างตรวจรับ ยืนยันรับ ติดตามปัญหาและปิดรับ',
      'บันทึกบิล ส่งตรวจ และตรวจได้เมื่อตั้งเป็นผู้ตรวจ',
      'สำรองข้อมูลได้ ไม่นำเข้าทับข้อมูล',
    ],
  },
  {
    role: 'staff',
    eyebrow: 'STAFF',
    items: [
      'ดูทะเบียนวัตถุดิบและหน่วยนับ',
      'ค้นหา กรอง และเปิดรายละเอียด',
      'เริ่มนับ บันทึกยอด และส่งตรวจได้',
      'รับเข้า เบิกใช้ ของเสีย และร่างเสนอซื้อได้',
      'ปรับยอด ตรวจความครบ ตั้งเกณฑ์ หรือยืนยันเสนอซื้อไม่ได้',
      'ร่างตรวจรับสินค้าได้ แต่ยืนยันลงสต็อกและปิดรับไม่ได้',
      'ไม่เปิดราคาและงานจัดซื้อในบทบาทพนักงาน',
      'แก้ทะเบียน นำเข้า หรือยืนยันยอดไม่ได้',
    ],
  },
];

export function MembersPage() {
  const { me, view } = useShop();
  const { backend } = useBackend();
  const demo = backend.mode === 'demo' ? (backend as DemoBackend) : null;
  return (
    <>
      <PageHeader
        eyebrow="WORKSPACE / ROLES"
        title="บทบาทผู้ใช้"
        sub="ทดลองมุมมองก่อนตกลงสิทธิ์ใช้งานจริง"
      />
      <div className="roles-grid">
        {CARDS.map((c) => (
          <section key={c.role} className={`role-card ${me.role === c.role ? 'active' : ''}`}>
            <span className="eyebrow">{c.eyebrow}</span>
            <h2>{roleName(c.role)}</h2>
            <ul>
              {c.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
            {demo ? (
              <button
                className="secondary"
                type="button"
                onClick={() => demo.switchTo(DEMO_PEOPLE.find((p) => p.role === c.role)!.email)}
              >
                {me.role === c.role ? 'กำลังทดลองบทบาทนี้' : 'ทดลองบทบาทนี้'}
              </button>
            ) : (
              me.role === c.role && <span className="chip">บทบาทของคุณ</span>
            )}
          </section>
        ))}
      </div>
      <div className="roles-explain">
        {demo ? (
          <>
            <b>บทบาทจำลองเพื่อทบทวนหน้าจอ</b>
            <br />
            โหมดทดลองสลับบทบาทได้ทุกคน จึงไม่ใช่ระบบรักษาความปลอดภัย
            ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น เกณฑ์ผู้อนุมัติซื้อและผู้ตรวจบิลเป็นค่าที่เจ้าของตั้ง
          </>
        ) : (
          <>
            <b>สิทธิ์ตามบทบาทของสมาชิก</b>
            <br />
            ระบบตรวจสิทธิ์ที่เซิร์ฟเวอร์ตามบทบาทที่เจ้าของกำหนดให้แต่ละบัญชี
            ผู้อนุมัติซื้อตั้งได้ที่หน้าจัดซื้อ และผู้ตรวจบิลตั้งได้ที่หน้าบิลและค่าใช้จ่าย
          </>
        )}
      </div>
      <MemberPanel />
      <BackupTools redacted={view.redacted} />
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

function MemberPanel() {
  const { members, me } = useShop();
  const owner = me.role === 'owner';
  const [inviting, setInviting] = useState(false);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h3>สมาชิกในร้าน</h3>
        {owner ? (
          <button className="mini" type="button" onClick={() => setInviting(true)}>
            ＋ เชิญสมาชิก
          </button>
        ) : (
          <span className="muted">{members.length} คน</span>
        )}
      </div>
      <div className="table-wrap">
        <table className="units-table" aria-label="สมาชิกในร้าน">
          <thead>
            <tr>
              <th>ชื่อที่แสดง</th>
              <th>บทบาท</th>
              <th>สถานะ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow
                key={m.userId}
                m={m}
                editable={owner && m.userId !== me.userId}
                self={m.userId === me.userId}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-bottom">
        <span>{members.filter((m) => m.active).length} คนที่ใช้งาน</span>
        <span>ชื่อที่แสดงใช้ในประวัติและการจับคู่ผู้อนุมัติ / ผู้ตรวจ</span>
      </div>
      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
    </section>
  );
}

function MemberRow({ m, editable, self }: { m: MemberInfo; editable: boolean; self: boolean }) {
  const { api, shopId, mutate, error, busy } = useMemberMutation();
  return (
    <tr>
      <td>
        <b>{m.displayName}</b>
        {self && <small>บัญชีของคุณ</small>}
      </td>
      <td>
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
          >
            {(['owner', 'manager', 'staff'] as const).map((r) => (
              <option key={r} value={r}>
                {roleName(r)}
              </option>
            ))}
          </select>
        ) : (
          roleName(m.role)
        )}
      </td>
      <td>
        {m.active ? (
          <span className="chip">ใช้งาน</span>
        ) : (
          <span className="chip off">พักการใช้งาน</span>
        )}
      </td>
      <td>
        {editable && (
          <button
            className="mini"
            type="button"
            disabled={busy}
            onClick={() =>
              mutate(
                () => api.updateMember(shopId, { userId: m.userId, active: !m.active }),
                m.active ? 'พักการใช้งานแล้ว' : 'เปิดใช้งานแล้ว',
              )
            }
          >
            {m.active ? 'พัก' : 'เปิดใช้'}
          </button>
        )}
        {error && <small className="form-error">{error}</small>}
      </td>
    </tr>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
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
    if (ok) onClose();
  }
  return (
    <Dialog open onClose={onClose} eyebrow="WORKSPACE / MEMBERS" title="เชิญสมาชิก">
      <form onSubmit={submit}>
        <FieldGrid>
          <Input label="อีเมล *" name="email" type="email" required wide />
          <Input label="ชื่อที่แสดง *" name="displayName" required maxLength={80} />
          <Select
            label="บทบาท *"
            name="role"
            defaultValue="staff"
            options={(['owner', 'manager', 'staff'] as const).map((r) => [r, roleName(r)])}
          />
        </FieldGrid>
        <p className="muted">
          {mode === 'cloud'
            ? 'ระบบจะส่งอีเมลเชิญให้ตั้งรหัสผ่าน (ถ้ายังไม่มีบัญชี)'
            : 'โหมดทดลอง: ไม่ส่งอีเมลจริง'}
        </p>
        <FormError error={error} />
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" className="primary" disabled={busy}>
            เพิ่มสมาชิก
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function BackupTools({ redacted }: { redacted: boolean }) {
  const { api } = useBackend();
  const { shopId, view, me } = useShop();
  const qc = useQueryClient();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function exportJson() {
    if (redacted) return toast('สำรองข้อมูลได้เฉพาะผู้จัดการหรือเจ้าของ', 'warning');
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(
        new Blob([JSON.stringify(view.state, null, 2)], { type: 'application/json' }),
      ),
      download: `daldal-backup-rev${view.revision}-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function importJson(f: File) {
    setError(null);
    if (!window.confirm('นำเข้าไฟล์นี้แทนที่ข้อมูลร้านทั้งหมด? (ควรดาวน์โหลดไฟล์สำรองก่อน)'))
      return;
    try {
      const next = await api.importBackup(shopId, JSON.parse(await f.text()), view.revision);
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
      if (file.current) file.current.value = '';
    }
  }
  return (
    <>
      <div className="backup-tools">
        <button id="export-data" type="button" className="secondary" onClick={exportJson}>
          ดาวน์โหลดสำรองข้อมูล
        </button>
        {me.role === 'owner' && (
          <button
            id="import-data"
            type="button"
            className="secondary"
            onClick={() => file.current?.click()}
          >
            นำเข้าไฟล์สำรอง
          </button>
        )}
        <span className="muted">
          ไฟล์ JSON · รูปแบบเดียวกับต้นแบบ รองรับรุ่น 1–6 · นำเข้าเป็นการแทนที่ ไม่ใช่รวม
        </span>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
        />
      </div>
      <FormError error={error} />
      <div className="section-note">
        <span className="note-icon">i</span>
        <span>ไฟล์สำรองจากต้นแบบเดิมนำเข้าได้ทันที ข้อมูลบิลที่แนบในไฟล์เดิมยังเปิดดูได้</span>
      </div>
    </>
  );
}
