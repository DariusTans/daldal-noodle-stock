/**
 * In-memory implementation of the API ports with the same semantics as the SQL schema and
 * RPCs (membership check, compare-and-swap on revision, idempotency, unique names, evidence
 * paths). Browser-safe. Used by the offline demo (persisted to localStorage) and verified by
 * running the same API integration suite as the PGlite/SQL implementation.
 */
import type { CommitResult, MemberRole } from '../db/database.types.js';
import type { ShopState } from '../domain/index.js';
import { HttpError } from './http.js';
import type { Deps, EvidenceRow, Member, Repo } from './ports.js';

interface MemberRow {
  shop_id: string;
  user_id: string;
  role: MemberRole;
  display_name: string;
  active: boolean;
  created_at: string;
}

export interface MemoryData {
  users: { id: string; email: string }[];
  shops: { id: string; name: string; created_at: string }[];
  members: MemberRow[];
  states: {
    shop_id: string;
    revision: number;
    data: ShopState;
    updated_at: string;
    updated_by: string;
  }[];
  audit: {
    id: number;
    shop_id: string;
    actor_id: string;
    actor_role: MemberRole;
    action: string;
    payload: unknown;
    revision_before: number | null;
    revision_after: number;
    at: string;
  }[];
  keys: { shop_id: string; key: string; action: string; revision_after: number }[];
  evidence: EvidenceRow[];
}

export const emptyMemoryData = (): MemoryData => ({
  users: [],
  shops: [],
  members: [],
  states: [],
  audit: [],
  keys: [],
  evidence: [],
});

const now = () => new Date().toISOString();
const copy = <T>(x: T): T => structuredClone(x);
const toMember = (r: MemberRow): Member => ({
  shopId: r.shop_id,
  userId: r.user_id,
  role: r.role,
  displayName: r.display_name,
  active: r.active,
});
const duplicate = () => new HttpError(409, 'duplicate', 'ข้อมูลซ้ำกับที่มีอยู่');

export function memoryRepo(d: MemoryData, changed: () => void = () => {}): Repo {
  const write = <T>(fn: () => T): T => {
    const r = fn();
    changed();
    return r;
  };
  const audit = (row: Omit<MemoryData['audit'][number], 'id' | 'at'>) =>
    d.audit.push({ ...row, id: d.audit.length + 1, at: now() });

  return {
    async memberships(userId) {
      return d.members
        .filter((m) => m.user_id === userId)
        .map((m) => ({
          ...toMember(m),
          shopName: d.shops.find((s) => s.id === m.shop_id)?.name ?? '',
        }));
    },
    async member(shopId, userId) {
      const m = d.members.find((m) => m.shop_id === shopId && m.user_id === userId);
      return m ? toMember(m) : null;
    },
    async members(shopId) {
      return d.members.filter((m) => m.shop_id === shopId).map(toMember);
    },
    async addMember(m) {
      if (
        d.members.some(
          (x) =>
            x.shop_id === m.shopId && (x.user_id === m.userId || x.display_name === m.displayName),
        )
      )
        throw duplicate();
      write(() =>
        d.members.push({
          shop_id: m.shopId,
          user_id: m.userId,
          role: m.role,
          display_name: m.displayName,
          active: true,
          created_at: now(),
        }),
      );
    },
    async updateMember(shopId, userId, patch) {
      const m = d.members.find((x) => x.shop_id === shopId && x.user_id === userId);
      if (m) write(() => Object.assign(m, patch));
    },
    async loadState(shopId) {
      const s = d.states.find((x) => x.shop_id === shopId);
      return s ? { revision: s.revision, data: copy(s.data) } : null;
    },
    async commit(c): Promise<CommitResult> {
      if (
        !d.members.some(
          (m) => m.shop_id === c.shopId && m.user_id === c.actorId && m.role === c.role && m.active,
        )
      )
        throw new HttpError(403, 'forbidden', 'ไม่มีสิทธิ์ทำรายการนี้');
      if (c.idempotencyKey) {
        const k = d.keys.find((k) => k.shop_id === c.shopId && k.key === c.idempotencyKey);
        if (k) return { status: 'replayed', revision: k.revision_after };
      }
      if (!(c.next.revision > c.expectedRevision)) throw new Error('next revision must be greater');
      const s = d.states.find((x) => x.shop_id === c.shopId);
      if (!s) throw new Error('shop has no state');
      if (s.revision !== c.expectedRevision) return { status: 'conflict', revision: s.revision };
      return write(() => {
        Object.assign(s, {
          data: copy(c.next),
          revision: c.next.revision,
          updated_at: now(),
          updated_by: c.actorId,
        });
        audit({
          shop_id: c.shopId,
          actor_id: c.actorId,
          actor_role: c.role,
          action: c.action,
          payload: copy(c.payload ?? {}),
          revision_before: c.expectedRevision,
          revision_after: s.revision,
        });
        if (c.idempotencyKey)
          d.keys.push({
            shop_id: c.shopId,
            key: c.idempotencyKey,
            action: c.action,
            revision_after: s.revision,
          });
        return { status: 'committed' as const, revision: s.revision };
      });
    },
    async findIdempotency(shopId, key) {
      return d.keys.find((k) => k.shop_id === shopId && k.key === key)?.revision_after ?? null;
    },
    async bootstrap(owner, shopName, displayName, initial) {
      const id = crypto.randomUUID();
      return write(() => {
        d.shops.push({ id, name: shopName.trim(), created_at: now() });
        d.members.push({
          shop_id: id,
          user_id: owner,
          role: 'owner',
          display_name: displayName.trim(),
          active: true,
          created_at: now(),
        });
        d.states.push({
          shop_id: id,
          revision: initial.revision,
          data: copy(initial),
          updated_at: now(),
          updated_by: owner,
        });
        audit({
          shop_id: id,
          actor_id: owner,
          actor_role: 'owner',
          action: 'bootstrapShop',
          payload: { name: shopName.trim() },
          revision_before: null,
          revision_after: initial.revision,
        });
        return id;
      });
    },
    async insertEvidence(row) {
      if (!row.object_path.startsWith(row.shop_id + '/')) throw new Error('evidence_path_in_shop');
      if (d.evidence.some((e) => e.shop_id === row.shop_id && e.sha256 === row.sha256))
        throw duplicate();
      const full: EvidenceRow = {
        id: row.id ?? crypto.randomUUID(),
        shop_id: row.shop_id,
        object_path: row.object_path,
        sha256: row.sha256,
        mime: row.mime,
        size_bytes: row.size_bytes,
        original_name: row.original_name,
        uploaded_by: row.uploaded_by ?? null,
        created_at: now(),
        verified_at: null,
      };
      write(() => d.evidence.push(full));
      return copy(full);
    },
    async findEvidence(shopId, id) {
      const e = d.evidence.find((x) => x.shop_id === shopId && x.id === id);
      return e ? copy(e) : null;
    },
    async findEvidenceByHash(shopId, sha256) {
      const e = d.evidence.find((x) => x.shop_id === shopId && x.sha256 === sha256);
      return e ? copy(e) : null;
    },
    async markEvidenceVerified(id) {
      const e = d.evidence.find((x) => x.id === id);
      if (e) write(() => (e.verified_at = now()));
    },
  };
}

/** Full in-memory backend: repo + token auth + directory + object storage. */
export function memoryBackend(
  data: MemoryData,
  objects: Map<string, Uint8Array>,
  changed: () => void = () => {},
) {
  const tokens = new Map<string, string>();
  const uploads = new Map<string, string>();
  const ensureUser = (email: string) => {
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    const id = crypto.randomUUID();
    data.users.push({ id, email });
    changed();
    return id;
  };
  const deps: Deps = {
    repo: memoryRepo(data, changed),
    auth: { verify: async (t) => (tokens.has(t) ? { userId: tokens.get(t)! } : null) },
    directory: { inviteUser: async (email) => ensureUser(email) },
    storage: {
      async createSignedUpload(path) {
        const token = 'upload-' + crypto.randomUUID();
        uploads.set(token, path);
        return { url: 'memory://upload/' + token, token };
      },
      async createSignedDownload(path) {
        const bytes = objects.get(path);
        if (!bytes) throw new Error('object not found');
        const row = data.evidence.find((e) => e.object_path === path);
        return URL.createObjectURL(
          new Blob([bytes as Uint8Array<ArrayBuffer>], {
            type: row?.mime ?? 'application/octet-stream',
          }),
        );
      },
      async read(path) {
        return objects.get(path) ?? null;
      },
    },
  };
  return {
    deps,
    /** Sign in as an existing (or new) user by email; returns a bearer token. */
    signIn(email: string) {
      const userId = ensureUser(email);
      const token = 'memory-' + userId;
      tokens.set(token, userId);
      return { userId, token };
    },
    upload(token: string, bytes: Uint8Array) {
      const path = uploads.get(token);
      if (!path) throw new Error('unknown upload token');
      objects.set(path, bytes);
      changed();
    },
  };
}
