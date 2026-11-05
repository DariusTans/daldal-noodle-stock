/** Master data: ingredients and units (legacy core.js). Raw ops — public API wraps with validation. */
import { ingredientCategories, roles, unitTypes } from './constants';
import { can } from './permissions';
import { nowIso, uid } from './runtime';
import type { Ingredient, Role, ShopState, Unit } from './types';
import { clone, fail, normName } from './util';

const clean = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

export interface IngredientInput {
  id?: string;
  code: string;
  name: string;
  category: string;
  unitId: string;
  location?: string;
  note?: string;
}

export interface UnitInput {
  id?: string;
  name: string;
  symbol: string;
  type: string;
}

function finish(s: ShopState, target: string, action: string, role: Role, time = nowIso()) {
  s.revision++;
  s.events.push({ id: uid('ev', 6), target, action, actor: roles[role] || role, time });
  return s;
}

export function saveIngredient(state: ShopState, data: IngredientInput, role: Role): ShopState {
  if (!can(role, 'ingredient')) fail('บทบาทนี้ดูข้อมูลได้อย่างเดียว');
  const s = clone(state);
  const old = data.id ? s.ingredients.find((i) => i.id === data.id) : null;
  if (data.id && !old) fail('ไม่พบรายการเดิม กรุณาเปิดใหม่');
  const name = clean(data.name),
    code = clean(data.code).toUpperCase();
  if (!name || name.length > 100 || !code || code.length > 30)
    fail('กรอกรหัสและชื่อวัตถุดิบให้ครบ (รหัสไม่เกิน 30 / ชื่อไม่เกิน 100 ตัวอักษร)');
  if (
    s.ingredients.some(
      (i) =>
        i.id !== data.id &&
        (normName(i.code) === normName(code) || normName(i.name) === normName(name)),
    )
  )
    fail('รหัสหรือชื่อวัตถุดิบซ้ำ รวมถึงรายการพักใช้งาน');
  if (
    !s.units.some((u) => u.id === data.unitId) ||
    !(ingredientCategories as readonly string[]).includes(data.category)
  )
    fail('เลือกหมวดหมู่และหน่วยนับที่ถูกต้อง');
  const now = nowIso();
  const item: Ingredient = {
    id: old?.id || uid('i', 6),
    code,
    name,
    category: data.category as Ingredient['category'],
    unitId: data.unitId,
    location: clean(data.location),
    note: clean(data.note),
    active: old ? old.active : true,
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };
  if (item.location.length > 100 || item.note.length > 500)
    fail('สถานที่เก็บหรือหมายเหตุยาวเกินกำหนด');
  if (old) s.ingredients[s.ingredients.indexOf(old)] = item;
  else s.ingredients.push(item);
  return finish(s, item.id, old ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ', role, now);
}

export function saveUnit(state: ShopState, data: UnitInput, role: Role): ShopState {
  if (!can(role, 'unit')) fail('บทบาทนี้ดูข้อมูลได้อย่างเดียว');
  const s = clone(state);
  const old = data.id ? s.units.find((u) => u.id === data.id) : null;
  if (data.id && !old) fail('ไม่พบหน่วยเดิม');
  const name = clean(data.name),
    symbol = clean(data.symbol);
  if (
    !name ||
    !symbol ||
    name.length > 40 ||
    symbol.length > 15 ||
    !(unitTypes as readonly string[]).includes(data.type)
  )
    fail('กรอกชื่อ หน่วยย่อ และประเภทให้ครบ');
  if (
    s.units.some(
      (u) =>
        u.id !== data.id &&
        (normName(u.name) === normName(name) || normName(u.symbol) === normName(symbol)),
    )
  )
    fail('ชื่อหรือหน่วยย่อซ้ำ');
  const item: Unit = { id: old?.id || uid('u', 6), name, symbol, type: data.type as Unit['type'] };
  if (old && old.type !== item.type && s.ingredients.some((i) => i.unitId === old.id))
    fail('หน่วยนี้ถูกใช้อยู่ เปลี่ยนประเภทไม่ได้ ให้สร้างหน่วยใหม่');
  if (old) s.units[s.units.indexOf(old)] = item;
  else s.units.push(item);
  return finish(s, item.id, old ? 'แก้ไขหน่วยนับ' : 'เพิ่มหน่วยนับ', role);
}

export function toggle(state: ShopState, id: string, role: Role): ShopState {
  if (!can(role, 'status')) fail('บทบาทนี้ดูข้อมูลได้อย่างเดียว');
  const s = clone(state),
    i = s.ingredients.find((x) => x.id === id);
  if (!i) return fail('ไม่พบวัตถุดิบ');
  i.active = !i.active;
  i.updatedAt = nowIso();
  return finish(s, id, i.active ? 'เปิดใช้งานวัตถุดิบ' : 'พักใช้งานวัตถุดิบ', role);
}
