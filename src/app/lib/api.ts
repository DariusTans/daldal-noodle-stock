/**
 * Typed client for the /api contract (src/server/app.ts). Works the same against the cloud
 * backend (fetch → Vercel) and the offline demo (in-browser app), via a Transport.
 */
import type { DateRange, Report, ReportKind, Role, ShopState } from '@/domain';
import type { ActionPayload, ActionType } from '@/server/actions';

export type Transport = (req: Request) => Promise<Response>;
/** Puts a file to a signed upload (Supabase Storage, or the demo's memory store). */
export type Uploader = (path: string, token: string, file: File) => Promise<void>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get isConflict() {
    return this.status === 409 && this.code === 'conflict';
  }
}

export interface StateView {
  revision: number;
  role: Role;
  redacted: boolean;
  state: ShopState;
  replayed?: boolean;
  unchanged?: boolean;
}

export interface Membership {
  shopId: string;
  shopName: string;
  userId: string;
  role: Role;
  displayName: string;
  active: boolean;
}

export interface MemberInfo {
  userId: string;
  role: Role;
  displayName: string;
  active: boolean;
}

export type ShopTemplate = 'blank' | 'starter' | 'demo';

export function createApi(transport: Transport, uploader: Uploader) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await transport(
      new Request(new URL(path, location.origin), {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      const data = type.includes('json') ? await res.json().catch(() => ({})) : {};
      throw new ApiError(
        res.status,
        data.error ?? 'error',
        data.message ?? `ระบบตอบกลับ ${res.status}`,
        data,
      );
    }
    return (type.includes('json') ? res.json() : res.text()) as Promise<T>;
  }
  const q = (params: Record<string, string | undefined>) =>
    '?' +
    new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => !!e[1]),
    ).toString();

  return {
    me: () => call<{ userId: string; memberships: Membership[] }>('GET', '/api/me'),
    createShop: (body: { name: string; displayName: string; template: ShopTemplate }) =>
      call<StateView & { shopId: string }>('POST', '/api/shops', body),
    state: (shopId: string) => call<StateView>('GET', '/api/state' + q({ shop: shopId })),
    action: <T extends ActionType>(
      shopId: string,
      type: T,
      payload: ActionPayload<T>,
      baseRevision: number,
      idempotencyKey: string,
    ) =>
      call<StateView>('POST', '/api/action', {
        shopId,
        type,
        payload,
        baseRevision,
        idempotencyKey,
      }),
    report: (shopId: string, range: Partial<DateRange>) =>
      call<Report>('GET', '/api/report' + q({ shop: shopId, ...range })),
    reportCsv: (shopId: string, range: Partial<DateRange>, kind: ReportKind) =>
      call<string>('GET', '/api/report' + q({ shop: shopId, ...range, kind })),
    /** Hash → request signed upload → put the file. Returns the evidence id for saveExpense. */
    async uploadEvidence(shopId: string, file: File): Promise<string> {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const sha256 = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
      const r = await call<{ evidenceId: string; path: string; upload: { token: string } | null }>(
        'POST',
        '/api/evidence',
        { shopId, name: file.name.slice(0, 160), type: file.type, size: file.size, sha256 },
      );
      if (r.upload) await uploader(r.path, r.upload.token, file);
      return r.evidenceId;
    },
    evidenceUrl: (shopId: string, id: string) =>
      call<{ url: string; name: string }>('GET', '/api/evidence' + q({ shop: shopId, id })),
    importBackup: (shopId: string, backup: unknown, baseRevision: number) =>
      call<StateView>('POST', '/api/import', { shopId, backup, baseRevision }),
    members: (shopId: string) =>
      call<{ members: MemberInfo[] }>('GET', '/api/members' + q({ shop: shopId })),
    invite: (shopId: string, body: { email: string; displayName: string; role: Role }) =>
      call<MemberInfo>('POST', '/api/members', { shopId, ...body }),
    updateMember: (shopId: string, body: { userId: string; role?: Role; active?: boolean }) =>
      call<MemberInfo>('PATCH', '/api/members', { shopId, ...body }),
  };
}

export type Api = ReturnType<typeof createApi>;
