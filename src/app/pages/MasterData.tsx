import { useState } from 'react';
import { ingredientCategories, unitTypes, type Ingredient, type Unit } from '@/domain';
import { fmtDateTime } from '../lib/format';
import { useShop } from '../state';
import { Badge, Button, Card, Input, PageHeader, Select, Table, Td, Textarea } from '../ui';
import { ActionButton, ActionDialog, DialogButton, opt, str } from './common';

export function IngredientsPage() {
  const { state, can } = useShop();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const unit = (id: string) => state.units.find((u) => u.id === id);
  const list = state.ingredients.filter(
    (i) =>
      (!category || i.category === category) &&
      (!q || (i.code + ' ' + i.name).toLowerCase().includes(q.toLowerCase())),
  );
  const editable = can('ingredient');

  return (
    <>
      <PageHeader
        eyebrow="ตั้งค่า"
        title="ทะเบียนวัตถุดิบ"
        sub="รหัสและชื่อห้ามซ้ำ (รวมรายการพักใช้งาน) · เปลี่ยนหน่วยไม่ได้เมื่อมีประวัตินับหรือจุดเตือนแล้ว"
        actions={
          editable && (
            <DialogButton label="+ เพิ่มวัตถุดิบ" variant="primary">
              {(close, open) => <IngredientForm open={open} onClose={close} />}
            </DialogButton>
          )
        }
      />
      <Card>
        <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_14rem]">
          <Input
            label="ค้นหา"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="รหัสหรือชื่อ"
          />
          <Select
            label="หมวด"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[
              ['', 'ทุกหมวด'],
              ...ingredientCategories.map((c): [string, string] => [c, c]),
            ]}
          />
        </div>
        <Table
          head={['รหัส', 'ชื่อ', 'หมวด', 'หน่วย', 'ที่เก็บ', 'สถานะ', '']}
          empty="ไม่พบวัตถุดิบ"
        >
          {list.map((i) => (
            <tr key={i.id}>
              <Td className="font-mono text-xs">{i.code}</Td>
              <Td>
                {i.name}
                {i.note && <span className="block text-xs text-stone-500">{i.note}</span>}
              </Td>
              <Td>{i.category}</Td>
              <Td>{unit(i.unitId)?.name}</Td>
              <Td>{i.location || '—'}</Td>
              <Td>{i.active ? <Badge tone="success">ใช้งาน</Badge> : <Badge>พักใช้งาน</Badge>}</Td>
              <Td className="whitespace-nowrap text-right">
                {editable && (
                  <span className="inline-flex gap-1">
                    <Button size="sm" onClick={() => setEditing(i)}>
                      แก้ไข
                    </Button>
                    <ActionButton
                      type="toggleIngredient"
                      payload={{ id: i.id }}
                      success={i.active ? 'พักใช้งานแล้ว' : 'เปิดใช้งานแล้ว'}
                    >
                      {i.active ? 'พักใช้' : 'เปิดใช้'}
                    </ActionButton>
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-stone-500">
          ประวัติล่าสุด:{' '}
          {state.events.at(-1)
            ? `${state.events.at(-1)!.action} · ${fmtDateTime(state.events.at(-1)!.time)}`
            : '—'}
        </p>
      </Card>
      {editing && <IngredientForm open onClose={() => setEditing(null)} item={editing} />}
    </>
  );
}

function IngredientForm({
  open,
  onClose,
  item,
}: {
  open: boolean;
  onClose: () => void;
  item?: Ingredient;
}) {
  const { state } = useShop();
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="รหัส" name="code" defaultValue={item?.code} required maxLength={30} />
        <Input label="ชื่อ" name="name" defaultValue={item?.name} required maxLength={100} />
        <Select
          label="หมวด"
          name="category"
          defaultValue={item?.category}
          options={ingredientCategories.map((c) => [c, c])}
        />
        <Select
          label="หน่วยนับ"
          name="unitId"
          defaultValue={item?.unitId}
          options={state.units.map((u) => [u.id, `${u.name} (${u.symbol})`])}
        />
      </div>
      <Input label="สถานที่เก็บ" name="location" defaultValue={item?.location} maxLength={100} />
      <Textarea label="หมายเหตุ" name="note" defaultValue={item?.note} maxLength={500} />
    </ActionDialog>
  );
}

export function UnitsPage() {
  const { state, can } = useShop();
  const [editing, setEditing] = useState<Unit | null>(null);
  const used = (id: string) => state.ingredients.filter((i) => i.unitId === id).length;
  return (
    <>
      <PageHeader
        eyebrow="ตั้งค่า"
        title="หน่วยนับ"
        sub="เปลี่ยนประเภทหน่วยไม่ได้เมื่อมีวัตถุดิบหรือประวัตินับใช้อยู่ ให้สร้างหน่วยใหม่แทน"
        actions={
          can('unit') && (
            <DialogButton label="+ เพิ่มหน่วย" variant="primary">
              {(close, open) => <UnitForm open={open} onClose={close} />}
            </DialogButton>
          )
        }
      />
      <Card>
        <Table head={['ชื่อ', 'หน่วยย่อ', 'ประเภท', 'ใช้อยู่', '']}>
          {state.units.map((u) => (
            <tr key={u.id}>
              <Td>{u.name}</Td>
              <Td>{u.symbol}</Td>
              <Td>{u.type}</Td>
              <Td>{used(u.id)} รายการ</Td>
              <Td className="text-right">
                {can('unit') && (
                  <Button size="sm" onClick={() => setEditing(u)}>
                    แก้ไข
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      {editing && <UnitForm open onClose={() => setEditing(null)} item={editing} />}
    </>
  );
}

function UnitForm({ open, onClose, item }: { open: boolean; onClose: () => void; item?: Unit }) {
  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={item ? 'แก้ไขหน่วยนับ' : 'เพิ่มหน่วยนับ'}
      submit={(f, run) =>
        run(
          'saveUnit',
          { id: item?.id, name: str(f, 'name'), symbol: str(f, 'symbol'), type: str(f, 'type') },
          'บันทึกหน่วยแล้ว',
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="ชื่อ" name="name" defaultValue={item?.name} required maxLength={40} />
        <Input label="หน่วยย่อ" name="symbol" defaultValue={item?.symbol} required maxLength={15} />
        <Select
          label="ประเภท"
          name="type"
          defaultValue={item?.type}
          options={unitTypes.map((t) => [t, t])}
        />
      </div>
    </ActionDialog>
  );
}
