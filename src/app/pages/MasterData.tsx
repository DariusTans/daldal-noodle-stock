/** ทะเบียนวัตถุดิบ / หน่วยนับ — same markup as legacy app.js. */
import { useState } from 'react';
import { ingredientCategories, unitTypes, type Ingredient, type Unit } from '@/domain';
import { fmtDateTime } from '../lib/format';
import { useShop } from '../state';
import { Badge, Dialog, FieldGrid, Input, PageHeader, Select, Stat, Stats, Textarea } from '../ui';
import { ActionButton, ActionDialog, opt, str } from './common';

const MASTER = 'DALDAL / MASTER DATA';

export function IngredientsPage() {
  const { state, can } = useShop();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const [detail, setDetail] = useState<Ingredient | null>(null);
  const unit = (id: string) => state.units.find((u) => u.id === id);
  const needle = q.trim().toLowerCase();
  const list = state.ingredients.filter(
    (i) =>
      (!category || i.category === category) &&
      (status === 'all' || (status === 'active' ? i.active : !i.active)) &&
      (!needle || [i.code, i.name, i.location].join(' ').toLowerCase().includes(needle)),
  );
  const editable = can('ingredient');
  const active = state.ingredients.filter((i) => i.active).length;

  return (
    <>
      <PageHeader
        eyebrow="STOCK / MASTER DATA"
        title="ทะเบียนวัตถุดิบ"
        sub="จัดรายการให้พร้อม ก่อนเริ่มนับสต็อกรอบแรก"
        actions={
          editable && (
            <button className="primary" id="add-ingredient" type="button" onClick={() => setEditing('new')}>
              <span>＋</span> เพิ่มวัตถุดิบ
            </button>
          )
        }
      />
      <Stats>
        <Stat label="วัตถุดิบทั้งหมด" value={state.ingredients.length} unit="รายการ" symbol="▤" />
        <Stat label="พร้อมใช้งาน" value={active} unit="รายการ" symbol="✓" />
        <Stat label="พักใช้งาน" value={state.ingredients.length - active} unit="รายการ" symbol="Ⅱ" />
      </Stats>
      <section className="panel">
        <div className="panel-heading">
          <h3>รายการวัตถุดิบ</h3>
          <span className="muted">ข้อมูลตัวอย่าง / ข้อมูลที่คุณเพิ่ม</span>
        </div>
        <div className="filters">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              id="search"
              aria-label="ค้นหาวัตถุดิบ"
              placeholder="ค้นหาชื่อ รหัส หรือสถานที่เก็บ"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select id="category-filter" aria-label="กรองหมวดหมู่" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">ทุกหมวดหมู่</option>
            {ingredientCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select id="status-filter" aria-label="กรองสถานะ" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">ทุกสถานะ</option>
            <option value="active">ใช้งาน</option>
            <option value="inactive">พักใช้งาน</option>
          </select>
        </div>
        <div className="table-wrap">
          <table aria-label="ทะเบียนวัตถุดิบ">
            <thead>
              <tr>
                <th>วัตถุดิบ / รหัส</th>
                <th>หมวดหมู่</th>
                <th>หน่วยนับ</th>
                <th>สถานที่เก็บ</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody id="ingredient-rows">
              {list.map((i) => (
                <tr key={i.id}>
                  <td>
                    <button className="ingredient-name" type="button" onClick={() => setDetail(i)}>
                      {i.name}
                    </button>
                    <small>{i.code}</small>
                  </td>
                  <td>
                    <Badge tone="category">{i.category}</Badge>
                  </td>
                  <td>{unit(i.unitId)?.symbol}</td>
                  <td>{i.location || '—'}</td>
                  <td>{i.active ? <Badge>ใช้งาน</Badge> : <Badge tone="off">พักใช้งาน</Badge>}</td>
                  <td>
                    {editable && (
                      <div className="row-actions">
                        <button className="mini" type="button" aria-label={'แก้ไข ' + i.name} onClick={() => setEditing(i)}>
                          แก้ไข
                        </button>
                        <ActionButton
                          type="toggleIngredient"
                          payload={{ id: i.id }}
                          success={i.active ? 'พักใช้งานแล้ว' : 'เปิดใช้งานแล้ว'}
                        >
                          {i.active ? 'พัก' : 'เปิดใช้'}
                        </ActionButton>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <div id="ingredient-empty" className="empty">
            <strong>ไม่พบรายการที่ตรงกัน</strong>ลองเปลี่ยนคำค้นหาหรือตัวกรอง{' '}
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setQ('');
                setCategory('');
                setStatus('all');
              }}
            >
              ล้างตัวกรอง
            </button>
          </div>
        )}
        <div className="table-bottom">
          <span id="result-count">
            แสดง {list.length} จาก {state.ingredients.length} รายการ
          </span>
          <span>กดชื่อวัตถุดิบเพื่อดูรายละเอียด</span>
        </div>
      </section>
      <div className="section-note">
        <span className="note-icon">i</span>
        <span>
          ทะเบียนนี้ใช้ตั้งต้นรอบนับ เปิดเมนู “นับและยืนยันสต็อก” เพื่อกรอกยอด และดู “ยอดนับล่าสุด” หลังยืนยัน
        </span>
      </div>
      {editing && <IngredientForm item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {detail && <IngredientDetail item={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function nextCode(list: Ingredient[]) {
  const n = Math.max(0, ...list.map((i) => Number(/^DD-(\d+)$/.exec(i.code)?.[1] ?? 0)));
  return 'DD-' + String(n + 1).padStart(3, '0');
}

function IngredientForm({ item, onClose }: { item?: Ingredient; onClose: () => void }) {
  const { state } = useShop();
  return (
    <ActionDialog
      open
      onClose={onClose}
      eyebrow={MASTER}
      title={item ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ'}
      submit={(f, run) =>
        run(
          'saveIngredient',
          {
            id: item?.id,
            code: str(f, 'code'),
            name: str(f, 'name'),
            category: str(f, 'category'),
            unitId: str(f, 'unitId'),
            location: opt(f, 'location'),
            note: opt(f, 'note'),
          },
          'บันทึกวัตถุดิบแล้ว',
        )
      }
    >
      <FieldGrid>
        <Input label="รหัสวัตถุดิบ *" name="code" defaultValue={item?.code ?? nextCode(state.ingredients)} required maxLength={30} />
        <Input label="ชื่อวัตถุดิบ *" name="name" defaultValue={item?.name} required maxLength={100} />
        <Select label="หมวดหมู่ *" name="category" required defaultValue={item?.category} options={ingredientCategories.map((c) => [c, c])} />
        <Select
          label="หน่วยนับ *"
          name="unitId"
          required
          defaultValue={item?.unitId}
          options={state.units.map((u) => [u.id, `${u.name} (${u.symbol})`])}
        />
        <Input label="สถานที่เก็บ" name="location" defaultValue={item?.location} maxLength={100} wide />
        <Textarea label="หมายเหตุ" name="note" defaultValue={item?.note} maxLength={500} />
      </FieldGrid>
    </ActionDialog>
  );
}

function IngredientDetail({ item, onClose }: { item: Ingredient; onClose: () => void }) {
  const { state } = useShop();
  const events = state.events.filter((e) => e.target === item.id).reverse();
  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={item.code}
      title={item.name}
      head={item.active ? <Badge>ใช้งาน</Badge> : <Badge tone="off">พักใช้งาน</Badge>}
    >
      <dl className="detail-grid">
        {(
          [
            ['หมวดหมู่', item.category],
            ['หน่วยนับ', state.units.find((u) => u.id === item.unitId)?.name],
            ['สถานที่เก็บ', item.location || '—'],
            ['แก้ไขล่าสุด (เวลาไทย)', fmtDateTime(item.updatedAt)],
            ['หมายเหตุ', item.note || '—'],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="activity">
        <b>ประวัติการเปลี่ยนแปลงล่าสุด</b>
        {events.length ? (
          events.map((e) => (
            <p key={e.id}>
              {e.action}
              <br />
              <span className="muted">
                {e.actor} · {fmtDateTime(e.time)}
              </span>
            </p>
          ))
        ) : (
          <p className="muted">รายการตั้งต้น ยังไม่มีการเปลี่ยนแปลง</p>
        )}
      </div>
    </Dialog>
  );
}

export function UnitsPage() {
  const { state, can } = useShop();
  const [editing, setEditing] = useState<Unit | 'new' | null>(null);
  const used = (id: string) => state.ingredients.filter((i) => i.unitId === id).length;
  return (
    <>
      <PageHeader
        eyebrow="STOCK / UNITS"
        title="หน่วยนับ"
        sub="กำหนดชื่อและหน่วยย่อให้ใช้ตรงกันทั้งร้าน"
        actions={
          can('unit') && (
            <button className="primary" id="add-unit" type="button" onClick={() => setEditing('new')}>
              ＋ เพิ่มหน่วยนับ
            </button>
          )
        }
      />
      <section className="panel">
        <div className="table-wrap">
          <table className="units-table" aria-label="หน่วยนับ">
            <thead>
              <tr>
                <th>ชื่อหน่วย</th>
                <th>หน่วยย่อ</th>
                <th>ประเภท</th>
                <th>วัตถุดิบที่ใช้</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {state.units.map((u) => (
                <tr key={u.id}>
                  <td>
                    <b>{u.name}</b>
                  </td>
                  <td>{u.symbol}</td>
                  <td>{u.type}</td>
                  <td>{used(u.id)} รายการ</td>
                  <td>
                    {can('unit') && (
                      <button className="mini" type="button" aria-label={'แก้ไขหน่วย ' + u.name} onClick={() => setEditing(u)}>
                        แก้ไข
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-bottom">{state.units.length} หน่วยนับ</div>
      </section>
      <div className="section-note">
        <span className="note-icon">i</span>
        <span>
          รอบนี้ใช้หนึ่งหน่วยต่อวัตถุดิบ ยังไม่แปลงหน่วยซื้อเป็นหน่วยใช้ เช่น ถุงเป็นกรัม
          หน่วยที่มีวัตถุดิบอ้างอิงอยู่จะเปลี่ยนประเภทไม่ได้
        </span>
      </div>
      {editing && <UnitForm item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function UnitForm({ item, onClose }: { item?: Unit; onClose: () => void }) {
  return (
    <ActionDialog
      open
      onClose={onClose}
      eyebrow={MASTER}
      title={item ? 'แก้ไขหน่วยนับ' : 'เพิ่มหน่วยนับ'}
      submit={(f, run) =>
        run('saveUnit', { id: item?.id, name: str(f, 'name'), symbol: str(f, 'symbol'), type: str(f, 'type') }, 'บันทึกหน่วยแล้ว')
      }
    >
      <FieldGrid>
        <Input label="ชื่อหน่วย *" name="name" defaultValue={item?.name} required maxLength={40} />
        <Input label="หน่วยย่อ *" name="symbol" defaultValue={item?.symbol} required maxLength={15} />
        <Select
          label="ประเภท *"
          name="type"
          wide
          defaultValue={item?.type}
          options={unitTypes.map((t) => [t, t])}
          hint="หน่วยที่ใช้อยู่เปลี่ยนประเภทไม่ได้ แต่แก้ชื่อและหน่วยย่อได้"
        />
      </FieldGrid>
    </ActionDialog>
  );
}
