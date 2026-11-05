/**
 * What the API needs from the outside world. Production wires these to Supabase
 * (supabase.ts); tests wire them to PGlite + in-memory fakes, so the same app code is tested.
 */
import type { CommitResult, Database, MemberRole } from '../db/database.types.js';
import type { ShopState } from '../domain/index.js';

export type EvidenceRow = Database['public']['Tables']['evidence']['Row'] & {
  verified_at: string | null;
};
export type EvidenceInsert = Database['public']['Tables']['evidence']['Insert'];

export interface Member {
  shopId: string;
  userId: string;
  role: MemberRole;
  displayName: string;
  active: boolean;
}

export interface Membership extends Member {
  shopName: string;
}

export interface CommitInput {
  shopId: string;
  actorId: string;
  role: MemberRole;
  action: string;
  payload: unknown;
  expectedRevision: number;
  next: ShopState;
  idempotencyKey: string | null;
}

export interface Repo {
  memberships(userId: string): Promise<Membership[]>;
  member(shopId: string, userId: string): Promise<Member | null>;
  members(shopId: string): Promise<Member[]>;
  addMember(m: Omit<Member, 'active'>): Promise<void>;
  updateMember(
    shopId: string,
    userId: string,
    patch: Partial<Pick<Member, 'role' | 'active'>>,
  ): Promise<void>;
  loadState(shopId: string): Promise<{ revision: number; data: ShopState } | null>;
  commit(input: CommitInput): Promise<CommitResult>;
  /** Revision recorded for an already-applied idempotency key, or null. */
  findIdempotency(shopId: string, key: string): Promise<number | null>;
  bootstrap(
    owner: string,
    shopName: string,
    displayName: string,
    initial: ShopState,
  ): Promise<string>;
  insertEvidence(row: EvidenceInsert): Promise<EvidenceRow>;
  findEvidence(shopId: string, id: string): Promise<EvidenceRow | null>;
  findEvidenceByHash(shopId: string, sha256: string): Promise<EvidenceRow | null>;
  markEvidenceVerified(id: string): Promise<void>;
}

export interface EvidenceStorage {
  /** Signed URL the browser PUTs the file to (single use, short-lived). */
  createSignedUpload(path: string): Promise<{ url: string; token: string }>;
  createSignedDownload(path: string, expiresInSeconds: number): Promise<string>;
  /** null if the object does not exist (not uploaded yet). */
  read(path: string): Promise<Uint8Array | null>;
}

export interface Authenticator {
  /** Verifies a Supabase access token; null when invalid/expired. */
  verify(token: string): Promise<{ userId: string } | null>;
}

export interface Directory {
  /** Find or invite a user by email (sends the invitation mail); returns the auth user id. */
  inviteUser(email: string): Promise<string>;
}

export interface Deps {
  repo: Repo;
  storage: EvidenceStorage;
  auth: Authenticator;
  directory: Directory;
  /** Allow any signed-in user without a shop to create one (default true). */
  allowShopCreation?: boolean;
  log?: (message: string, detail?: unknown) => void;
}
