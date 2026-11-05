/**
 * Production wiring: Supabase (service role) implementations of the API ports.
 * The service-role key bypasses RLS, so this module must only ever run on the server.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CommitResult, MemberRole } from '../db/database.types.js';
import type { ShopState } from '../domain/index.js';
import { HttpError } from './http.js';
import type { Deps, EvidenceRow, Member, Membership } from './ports.js';

export interface SupabaseEnv {
  url: string;
  serviceRoleKey: string;
  /** Where invitation links land (the deployed site). */
  siteUrl?: string;
  allowShopCreation?: boolean;
}

interface MemberRow {
  shop_id: string;
  user_id: string;
  role: MemberRole;
  display_name: string;
  active: boolean;
  shops?: { name: string } | null;
}

const toMember = (r: MemberRow): Member => ({
  shopId: r.shop_id,
  userId: r.user_id,
  role: r.role,
  displayName: r.display_name,
  active: r.active,
});

function check<T>(
  res: { data: T; error: { message: string; code?: string } | null },
  what: string,
): T {
  if (res.error) {
    if (res.error.code === '42501') throw new HttpError(403, 'forbidden', 'ไม่มีสิทธิ์ทำรายการนี้');
    if (res.error.code === '23505') throw new HttpError(409, 'duplicate', 'ข้อมูลซ้ำกับที่มีอยู่');
    throw new Error(`${what}: ${res.error.message}`);
  }
  return res.data;
}

export function supabaseDeps(env: SupabaseEnv): Deps {
  const db: SupabaseClient = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const bucket = () => db.storage.from('evidence');

  return {
    allowShopCreation: env.allowShopCreation ?? true,
    log: (message, detail) => console.error('[daldal-api]', message, detail),

    auth: {
      async verify(token) {
        const { data, error } = await db.auth.getClaims(token);
        const claims = data?.claims;
        if (error || !claims?.sub || claims.role !== 'authenticated') return null;
        return { userId: claims.sub };
      },
    },

    directory: {
      async inviteUser(email) {
        const invited = await db.auth.admin.inviteUserByEmail(email, {
          redirectTo: env.siteUrl,
        });
        if (invited.data.user) return invited.data.user.id;
        // Already registered: look the user up (admin API has no get-by-email).
        for (let page = 1; page < 50; page++) {
          const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) throw new Error('listUsers: ' + error.message);
          const u = data.users.find((x) => x.email?.toLowerCase() === email);
          if (u) return u.id;
          if (data.users.length < 1000) break;
        }
        throw new Error('inviteUser: ' + (invited.error?.message ?? 'user not found'));
      },
    },

    repo: {
      async memberships(userId) {
        const rows = check(
          await db
            .from('shop_members')
            .select('shop_id, user_id, role, display_name, active, shops(name)')
            .eq('user_id', userId),
          'memberships',
        ) as unknown as MemberRow[];
        return rows.map((r): Membership => ({ ...toMember(r), shopName: r.shops?.name ?? '' }));
      },
      async member(shopId, userId) {
        const row = check(
          await db
            .from('shop_members')
            .select('shop_id, user_id, role, display_name, active')
            .eq('shop_id', shopId)
            .eq('user_id', userId)
            .maybeSingle(),
          'member',
        ) as MemberRow | null;
        return row ? toMember(row) : null;
      },
      async members(shopId) {
        const rows = check(
          await db
            .from('shop_members')
            .select('shop_id, user_id, role, display_name, active')
            .eq('shop_id', shopId)
            .order('created_at'),
          'members',
        ) as MemberRow[];
        return rows.map(toMember);
      },
      async addMember(m) {
        check(
          await db.from('shop_members').insert({
            shop_id: m.shopId,
            user_id: m.userId,
            role: m.role,
            display_name: m.displayName,
          }),
          'addMember',
        );
      },
      async updateMember(shopId, userId, patch) {
        check(
          await db.from('shop_members').update(patch).eq('shop_id', shopId).eq('user_id', userId),
          'updateMember',
        );
      },
      async loadState(shopId) {
        const row = check(
          await db.from('shop_state').select('revision, data').eq('shop_id', shopId).maybeSingle(),
          'loadState',
        ) as { revision: number; data: ShopState } | null;
        return row ? { revision: Number(row.revision), data: row.data } : null;
      },
      async commit(c) {
        const result = check(
          await db.rpc('commit_shop_action', {
            p_shop: c.shopId,
            p_actor: c.actorId,
            p_role: c.role,
            p_action: c.action,
            p_payload: c.payload ?? {},
            p_expected_revision: c.expectedRevision,
            p_next: c.next,
            p_idempotency_key: c.idempotencyKey,
          }),
          'commit',
        ) as CommitResult;
        return { status: result.status, revision: Number(result.revision) };
      },
      async findIdempotency(shopId, key) {
        const row = check(
          await db
            .from('idempotency_keys')
            .select('revision_after')
            .eq('shop_id', shopId)
            .eq('key', key)
            .maybeSingle(),
          'findIdempotency',
        ) as { revision_after: number } | null;
        return row ? Number(row.revision_after) : null;
      },
      async bootstrap(owner, shopName, displayName, initial) {
        return check(
          await db.rpc('bootstrap_shop', {
            p_owner: owner,
            p_shop_name: shopName,
            p_display_name: displayName,
            p_initial: initial,
          }),
          'bootstrap',
        ) as string;
      },
      async insertEvidence(row) {
        return check(
          await db.from('evidence').insert(row).select('*').single(),
          'insertEvidence',
        ) as EvidenceRow;
      },
      async findEvidence(shopId, id) {
        return check(
          await db.from('evidence').select('*').eq('shop_id', shopId).eq('id', id).maybeSingle(),
          'findEvidence',
        ) as EvidenceRow | null;
      },
      async findEvidenceByHash(shopId, sha256) {
        return check(
          await db
            .from('evidence')
            .select('*')
            .eq('shop_id', shopId)
            .eq('sha256', sha256)
            .maybeSingle(),
          'findEvidenceByHash',
        ) as EvidenceRow | null;
      },
      async markEvidenceVerified(id) {
        check(
          await db.from('evidence').update({ verified_at: new Date().toISOString() }).eq('id', id),
          'markEvidenceVerified',
        );
      },
    },

    storage: {
      async createSignedUpload(path) {
        const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true });
        if (error || !data) throw new Error('createSignedUpload: ' + error?.message);
        return { url: data.signedUrl, token: data.token };
      },
      async createSignedDownload(path, expiresInSeconds) {
        const { data, error } = await bucket().createSignedUrl(path, expiresInSeconds);
        if (error || !data) throw new Error('createSignedDownload: ' + error?.message);
        return data.signedUrl;
      },
      async read(path) {
        const { data, error } = await bucket().download(path);
        if (error || !data) return null;
        return new Uint8Array(await data.arrayBuffer());
      },
    },
  };
}
