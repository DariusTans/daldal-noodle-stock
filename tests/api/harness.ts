/**
 * Test wiring for the API: a Repo that runs the real SQL (migrations + RPCs) in PGlite as the
 * service role, plus in-memory storage / auth / directory fakes.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { CommitResult } from '../../src/db/database.types';
import type { ShopState } from '../../src/domain';
import { createApp } from '../../src/server/app';
import { HttpError } from '../../src/server/http';
import type { Deps, EvidenceRow, Member, Membership, Repo } from '../../src/server/ports';
import { freshDatabase } from '../db/pglite';

type Row = Record<string, unknown>;

export function pgliteRepo(db: PGlite): Repo {
  async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      return await db.transaction(async (tx) => {
        await tx.exec('set local role service_role');
        return (await tx.query<T>(sql, params)).rows;
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '42501') throw new HttpError(403, 'forbidden', 'ไม่มีสิทธิ์ทำรายการนี้');
      if (code === '23505') throw new HttpError(409, 'duplicate', 'ข้อมูลซ้ำกับที่มีอยู่');
      throw e;
    }
  }
  const member = (r: Row): Member => ({
    shopId: r.shop_id as string,
    userId: r.user_id as string,
    role: r.role as Member['role'],
    displayName: r.display_name as string,
    active: r.active as boolean,
  });
  return {
    async memberships(userId) {
      const rows = await q(
        `select m.*, s.name as shop_name from public.shop_members m join public.shops s on s.id = m.shop_id where m.user_id = $1`,
        [userId],
      );
      return rows.map((r): Membership => ({ ...member(r), shopName: r.shop_name as string }));
    },
    async member(shopId, userId) {
      const [r] = await q(`select * from public.shop_members where shop_id = $1 and user_id = $2`, [
        shopId,
        userId,
      ]);
      return r ? member(r) : null;
    },
    async members(shopId) {
      return (
        await q(`select * from public.shop_members where shop_id = $1 order by created_at`, [
          shopId,
        ])
      ).map(member);
    },
    async addMember(m) {
      await q(
        `insert into public.shop_members (shop_id, user_id, role, display_name) values ($1, $2, $3, $4)`,
        [m.shopId, m.userId, m.role, m.displayName],
      );
    },
    async updateMember(shopId, userId, patch) {
      await q(
        `update public.shop_members set role = coalesce($3::public.member_role, role), active = coalesce($4, active) where shop_id = $1 and user_id = $2`,
        [shopId, userId, patch.role ?? null, patch.active ?? null],
      );
    },
    async loadState(shopId) {
      const [r] = await q<{ revision: number; data: ShopState }>(
        `select revision, data from public.shop_state where shop_id = $1`,
        [shopId],
      );
      return r ? { revision: Number(r.revision), data: r.data } : null;
    },
    async commit(c) {
      const [r] = await q<{ result: CommitResult }>(
        `select public.commit_shop_action($1, $2, $3::public.member_role, $4, $5::jsonb, $6, $7::jsonb, $8) as result`,
        [
          c.shopId,
          c.actorId,
          c.role,
          c.action,
          JSON.stringify(c.payload ?? {}),
          c.expectedRevision,
          JSON.stringify(c.next),
          c.idempotencyKey,
        ],
      );
      return { status: r!.result.status, revision: Number(r!.result.revision) };
    },
    async findIdempotency(shopId, key) {
      const [r] = await q(
        `select revision_after from public.idempotency_keys where shop_id = $1 and key = $2`,
        [shopId, key],
      );
      return r ? Number(r.revision_after) : null;
    },
    async bootstrap(owner, name, displayName, initial) {
      const [r] = await q<{ id: string }>(
        `select public.bootstrap_shop($1, $2, $3, $4::jsonb) as id`,
        [owner, name, displayName, JSON.stringify(initial)],
      );
      return r!.id;
    },
    async insertEvidence(row) {
      const [r] = await q<EvidenceRow>(
        `insert into public.evidence (id, shop_id, object_path, sha256, mime, size_bytes, original_name, uploaded_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [
          row.id,
          row.shop_id,
          row.object_path,
          row.sha256,
          row.mime,
          row.size_bytes,
          row.original_name,
          row.uploaded_by ?? null,
        ],
      );
      return r!;
    },
    async findEvidence(shopId, id) {
      const [r] = await q<EvidenceRow>(
        `select * from public.evidence where shop_id = $1 and id = $2`,
        [shopId, id],
      );
      return r ?? null;
    },
    async findEvidenceByHash(shopId, sha256) {
      const [r] = await q<EvidenceRow>(
        `select * from public.evidence where shop_id = $1 and sha256 = $2`,
        [shopId, sha256],
      );
      return r ?? null;
    },
    async markEvidenceVerified(id) {
      await q(`update public.evidence set verified_at = now() where id = $1`, [id]);
    },
  };
}

export interface Harness {
  db: PGlite;
  call: (
    method: string,
    path: string,
    opts?: { as?: string; body?: unknown },
  ) => Promise<{ status: number; body: any; headers: Headers; bom: boolean }>;
  /** Create (or reuse) an auth user and return a bearer token for them. */
  signUp: (email: string) => Promise<{ userId: string; token: string }>;
  /** Simulate the browser PUTting a file to a signed upload URL. */
  upload: (token: string, bytes: Uint8Array) => void;
  objects: Map<string, Uint8Array>;
}

export async function harness(): Promise<Harness> {
  const db = await freshDatabase();
  const tokens = new Map<string, string>(); // token → userId
  const uploads = new Map<string, string>(); // upload token → path
  const objects = new Map<string, Uint8Array>();

  async function ensureUser(email: string) {
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email) values ($1) on conflict (email) do update set email = excluded.email returning id`,
      [email],
    );
    return rows[0]!.id;
  }

  const deps: Deps = {
    repo: pgliteRepo(db),
    auth: { verify: async (token) => (tokens.has(token) ? { userId: tokens.get(token)! } : null) },
    directory: { inviteUser: ensureUser },
    storage: {
      async createSignedUpload(path) {
        const token = 'up-' + crypto.randomUUID();
        uploads.set(token, path);
        return { url: 'https://storage.test/upload/' + token, token };
      },
      async createSignedDownload(path, seconds) {
        return `https://storage.test/download/${path}?expires=${seconds}`;
      },
      async read(path) {
        return objects.get(path) ?? null;
      },
    },
  };
  const handle = createApp(deps);

  return {
    db,
    objects,
    async signUp(email) {
      const userId = await ensureUser(email);
      const token = 'tok-' + userId;
      tokens.set(token, userId);
      return { userId, token };
    },
    upload(token, bytes) {
      const path = uploads.get(token);
      if (!path) throw new Error('unknown upload token');
      objects.set(path, bytes);
    },
    async call(method, path, opts = {}) {
      const headers: Record<string, string> = {};
      if (opts.as) headers.authorization = 'Bearer ' + opts.as;
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      const res = await handle(
        new Request('https://daldal.test' + path, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        }),
      );
      const raw = new Uint8Array(await res.arrayBuffer());
      const bom = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
      const text = new TextDecoder().decode(raw);
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* CSV etc. */
      }
      return { status: res.status, body, headers: res.headers, bom };
    },
  };
}
