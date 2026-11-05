/**
 * Daldal HTTP API (framework-agnostic: Request → Response).
 *
 *   GET   /api/health
 *   GET   /api/me                         memberships of the signed-in user
 *   POST  /api/shops                      create a shop (caller becomes owner)
 *   GET   /api/state?shop=                role-filtered state + revision
 *   POST  /api/action                     { shopId, type, payload, baseRevision, idempotencyKey }
 *   GET   /api/report?shop=&from=&to=&kind=   JSON report, or CSV when kind is given
 *   POST  /api/evidence                   request a signed upload for a bill file
 *   GET   /api/evidence?shop=&id=         short-lived signed download URL
 *   POST  /api/import                     owner: replace state with a prototype backup
 *   GET|POST|PATCH /api/members           list / invite / change role or deactivate
 *
 * Status codes: 400 invalid request · 401 not signed in · 403 not allowed · 404 not found ·
 * 409 revision conflict (reload and retry) · 422 business rule · 500 unexpected.
 */
import { z } from 'zod';
import * as D from '../domain/index.js';
import { demoSeed } from '../domain/demo.js';
import type { ShopState } from '../domain/index.js';
import { actions, type ActionType } from './actions.js';
import {
  HttpError,
  badRequest,
  bearer,
  errorResponse,
  forbidden,
  json,
  notFound,
  readJson,
  unauthorized,
} from './http.js';
import type { Deps, Member } from './ports.js';
import { viewFor } from './view.js';

const uuid = z.uuid();
const idempotencyKey = z.string().min(8).max(100);
const memberRole = z.enum(['owner', 'manager', 'staff']);

const conflict = (revision: number) =>
  json(
    {
      error: 'conflict',
      message: 'ข้อมูลเปลี่ยนจากผู้ใช้อื่นแล้ว กรุณาโหลดใหม่แล้วทำรายการอีกครั้ง',
      revision,
    },
    409,
  );

export function createApp(deps: Deps) {
  const { repo, storage, auth, directory } = deps;

  async function user(req: Request): Promise<string> {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const u = await auth.verify(token);
    if (!u) throw unauthorized();
    return u.userId;
  }

  async function member(shopId: unknown, userId: string): Promise<Member> {
    const id = uuid.safeParse(shopId);
    if (!id.success) throw badRequest('ระบุร้านให้ถูกต้อง');
    const m = await repo.member(id.data, userId);
    if (!m || !m.active) throw forbidden('คุณไม่ได้เป็นสมาชิกของร้านนี้');
    return m;
  }

  async function load(shopId: string) {
    const s = await repo.loadState(shopId);
    if (!s) throw notFound('ไม่พบข้อมูลร้าน');
    return s;
  }

  const stateResponse = (state: ShopState, m: Member, extra: object = {}) =>
    json({ ...viewFor(state, m.role), ...extra });

  // ── handlers ──
  async function me(req: Request) {
    const userId = await user(req);
    return json({ userId, memberships: (await repo.memberships(userId)).filter((m) => m.active) });
  }

  async function createShop(req: Request) {
    const userId = await user(req);
    if (deps.allowShopCreation === false) throw forbidden('การสร้างร้านใหม่ถูกปิดไว้');
    const body = z
      .strictObject({
        name: z.string().trim().min(1).max(100),
        displayName: z.string().trim().min(1).max(80),
        template: z.enum(['blank', 'starter', 'demo']).default('starter'),
      })
      .parse(await readJson(req));
    const initial =
      body.template === 'demo'
        ? demoSeed({ owner: body.displayName })
        : body.template === 'blank'
          ? { ...D.seed(), ingredients: [] }
          : D.seed();
    D.validate(initial);
    const shopId = await repo.bootstrap(userId, body.name, body.displayName, initial);
    return json({ shopId, ...viewFor(initial, 'owner') }, 201);
  }

  async function getState(req: Request, url: URL) {
    const m = await member(url.searchParams.get('shop'), await user(req));
    const { data } = await load(m.shopId);
    return stateResponse(data, m);
  }

  async function postAction(req: Request) {
    const userId = await user(req);
    const body = z
      .strictObject({
        shopId: uuid,
        type: z.string().max(60),
        payload: z.unknown(),
        baseRevision: z.number().int().nonnegative(),
        idempotencyKey,
      })
      .parse(await readJson(req));
    const m = await member(body.shopId, userId);
    if (!Object.hasOwn(actions, body.type)) throw badRequest('ไม่รู้จักคำสั่ง ' + body.type);
    const def = actions[body.type as ActionType];
    const input = def.schema.parse(body.payload ?? {});

    // A retry of a request that already went through: report success, apply nothing.
    if ((await repo.findIdempotency(m.shopId, body.idempotencyKey)) !== null) {
      const { data } = await load(m.shopId);
      return stateResponse(data, m, { replayed: true });
    }
    const current = await load(m.shopId);
    if (current.revision !== body.baseRevision) return conflict(current.revision);

    const next = await (def.run as (s: ShopState, i: unknown, c: unknown) => Promise<ShopState>)(
      current.data,
      input,
      { shopId: m.shopId, actor: m, deps },
    );
    if (next.revision === current.revision)
      return stateResponse(current.data, m, { unchanged: true });

    const result = await repo.commit({
      shopId: m.shopId,
      actorId: userId,
      role: m.role,
      action: body.type,
      payload: input,
      expectedRevision: current.revision,
      next,
      idempotencyKey: body.idempotencyKey,
    });
    if (result.status === 'conflict') return conflict(result.revision);
    if (result.status === 'replayed') {
      const { data } = await load(m.shopId);
      return stateResponse(data, m, { replayed: true });
    }
    return stateResponse(next, m);
  }

  async function getReport(req: Request, url: URL) {
    const m = await member(url.searchParams.get('shop'), await user(req));
    const { data } = await load(m.shopId);
    const range = {
      from: url.searchParams.get('from') ?? '',
      to: url.searchParams.get('to') ?? '',
    };
    const kind = url.searchParams.get('kind');
    if (!kind) return json(D.report(data, range, m.role));
    const k = z.enum(['stock', 'movements', 'receipts', 'expenses', 'purchases']).parse(kind);
    const csv = D.reportCSV(data, range, m.role, k);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="daldal-${k}-${range.from || 'all'}-${range.to || 'all'}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  async function requestUpload(req: Request) {
    const userId = await user(req);
    const body = z
      .strictObject({
        shopId: uuid,
        name: z.string().trim().min(1).max(160),
        type: z.enum(D.attachmentTypes),
        size: z.number().int().min(1).max(D.STORED_ATTACHMENT_MAX_BYTES),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .parse(await readJson(req));
    const m = await member(body.shopId, userId);
    if (!D.can(m.role, 'expense')) throw forbidden('บทบาทนี้ไม่เปิดข้อมูลค่าใช้จ่าย');
    const existing = await repo.findEvidenceByHash(m.shopId, body.sha256);
    if (existing?.verified_at)
      return json({ evidenceId: existing.id, path: existing.object_path, upload: null });
    const evidenceId = crypto.randomUUID();
    const row =
      existing ??
      (await repo.insertEvidence({
        id: evidenceId,
        shop_id: m.shopId,
        object_path: `${m.shopId}/${evidenceId}`,
        sha256: body.sha256,
        mime: body.type,
        size_bytes: body.size,
        original_name: body.name,
        uploaded_by: userId,
      }));
    const upload = await storage.createSignedUpload(row.object_path);
    return json({ evidenceId: row.id, path: row.object_path, upload }, existing ? 200 : 201);
  }

  async function downloadUrl(req: Request, url: URL) {
    const m = await member(url.searchParams.get('shop'), await user(req));
    if (!D.can(m.role, 'expense')) throw forbidden('บทบาทนี้ไม่เปิดข้อมูลค่าใช้จ่าย');
    const id = uuid.parse(url.searchParams.get('id'));
    const row = await repo.findEvidence(m.shopId, id);
    if (!row) throw notFound('ไม่พบไฟล์หลักฐาน');
    return json({
      url: await storage.createSignedDownload(row.object_path, 60),
      name: row.original_name,
    });
  }

  async function importBackup(req: Request) {
    const userId = await user(req);
    const body = z
      .strictObject({
        shopId: uuid,
        baseRevision: z.number().int().nonnegative(),
        backup: z.unknown(),
      })
      .parse(await readJson(req));
    const m = await member(body.shopId, userId);
    if (m.role !== 'owner') throw forbidden('เฉพาะเจ้าของนำเข้าข้อมูลสำรองได้');
    const current = await load(m.shopId);
    if (current.revision !== body.baseRevision) return conflict(current.revision);
    const migrated = D.migrate(body.backup);
    // Stored evidence in a backup must belong to this shop and exist.
    for (const e of migrated.expenses)
      if (D.isStoredAttachment(e.attachment)) {
        const row = await repo.findEvidence(m.shopId, e.attachment.evidenceId);
        if (!row || row.object_path !== e.attachment.path || row.sha256 !== e.attachment.hash)
          throw new HttpError(422, 'rule', 'ข้อมูลสำรองอ้างอิงไฟล์หลักฐานที่ไม่ใช่ของร้านนี้');
      }
    const next: ShopState = { ...migrated, revision: current.revision + 1 };
    D.validate(next);
    const result = await repo.commit({
      shopId: m.shopId,
      actorId: userId,
      role: m.role,
      action: 'importBackup',
      payload: {
        sourceRevision: migrated.revision,
        sourceSchemaVersion: (body.backup as { schemaVersion?: unknown })?.schemaVersion ?? null,
        ingredients: next.ingredients.length,
        expenses: next.expenses.length,
      },
      expectedRevision: current.revision,
      next,
      idempotencyKey: null,
    });
    if (result.status !== 'committed') return conflict(result.revision);
    return stateResponse(next, m);
  }

  async function listMembers(req: Request, url: URL) {
    const m = await member(url.searchParams.get('shop'), await user(req));
    const all = await repo.members(m.shopId);
    return json({
      members: all
        .filter((x) => x.active || m.role === 'owner')
        .map(({ userId, role, displayName, active }) => ({ userId, role, displayName, active })),
    });
  }

  async function inviteMember(req: Request) {
    const userId = await user(req);
    const body = z
      .strictObject({
        shopId: uuid,
        email: z.email().max(200),
        displayName: z.string().trim().min(1).max(80),
        role: memberRole,
      })
      .parse(await readJson(req));
    const m = await member(body.shopId, userId);
    if (m.role !== 'owner') throw forbidden('เฉพาะเจ้าของเพิ่มสมาชิกได้');
    const all = await repo.members(m.shopId);
    if (all.some((x) => x.displayName === body.displayName))
      throw new HttpError(409, 'duplicate', 'ชื่อที่แสดงนี้มีในร้านแล้ว');
    const invitee = await directory.inviteUser(body.email.toLowerCase());
    if (all.some((x) => x.userId === invitee))
      throw new HttpError(409, 'duplicate', 'ผู้ใช้นี้เป็นสมาชิกร้านแล้ว');
    await repo.addMember({
      shopId: m.shopId,
      userId: invitee,
      role: body.role,
      displayName: body.displayName,
    });
    return json(
      { userId: invitee, role: body.role, displayName: body.displayName, active: true },
      201,
    );
  }

  async function updateMember(req: Request) {
    const userId = await user(req);
    const body = z
      .strictObject({
        shopId: uuid,
        userId: uuid,
        role: memberRole.optional(),
        active: z.boolean().optional(),
      })
      .parse(await readJson(req));
    const m = await member(body.shopId, userId);
    if (m.role !== 'owner') throw forbidden('เฉพาะเจ้าของแก้ไขสมาชิกได้');
    const all = await repo.members(m.shopId);
    const target = all.find((x) => x.userId === body.userId);
    if (!target) throw notFound('ไม่พบสมาชิก');
    const after = { ...target, ...body };
    const owners = all
      .map((x) => (x.userId === target.userId ? after : x))
      .filter((x) => x.active && x.role === 'owner');
    if (!owners.length)
      throw new HttpError(422, 'rule', 'ร้านต้องมีเจ้าของที่ใช้งานอย่างน้อยหนึ่งคน');
    const patch: { role?: Member['role']; active?: boolean } = {};
    if (body.role) patch.role = body.role;
    if (body.active !== undefined) patch.active = body.active;
    await repo.updateMember(m.shopId, target.userId, patch);
    return json({
      userId: target.userId,
      role: after.role,
      displayName: target.displayName,
      active: after.active,
    });
  }

  type Handler = (req: Request, url: URL) => Promise<Response>;
  const routes: Record<string, Partial<Record<string, Handler>>> = {
    '/api/health': { GET: async () => json({ ok: true }) },
    '/api/me': { GET: me },
    '/api/shops': { POST: createShop },
    '/api/state': { GET: getState },
    '/api/action': { POST: postAction },
    '/api/report': { GET: getReport },
    '/api/evidence': { POST: requestUpload, GET: downloadUrl },
    '/api/import': { POST: importBackup },
    '/api/members': { GET: listMembers, POST: inviteMember, PATCH: updateMember },
  };

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = routes[url.pathname.replace(/\/+$/, '')];
    if (!route) return json({ error: 'not_found', message: 'ไม่พบ endpoint' }, 404);
    const h = route[req.method];
    if (!h)
      return json({ error: 'method_not_allowed', message: 'method ไม่รองรับ' }, 405, {
        allow: Object.keys(route).join(', '),
      });
    try {
      return await h(req, url);
    } catch (e) {
      return errorResponse(e, deps.log);
    }
  };
}
