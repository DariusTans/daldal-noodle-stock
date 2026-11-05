import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { can, type Action, type ShopState } from '@/domain';
import type { ActionPayload, ActionType } from '@/server/actions';
import { ApiError, type MemberInfo, type Membership, type StateView } from './lib/api';
import { cloudConfigured, loadBackend, type Backend } from './lib/backend';
import { cx } from './ui';

// ── Backend (cloud | demo) ───────────────────────────────────────────
type Mode = 'cloud' | 'demo';
const MODE_KEY = 'daldal-v1-mode';
interface BackendCtx {
  backend: Backend;
  mode: Mode;
  setMode(m: Mode): void;
}
const BackendContext = createContext<BackendCtx | null>(null);

export function BackendProvider({ children }: { children: ReactNode }) {
  const initial =
    (localStorage.getItem(MODE_KEY) as Mode | null) ?? (cloudConfigured ? 'cloud' : 'demo');
  const [mode, setModeState] = useState<Mode>(cloudConfigured ? initial : 'demo');
  const [backend, setBackend] = useState<Backend | null>(null);
  useEffect(() => {
    let alive = true;
    setBackend(null);
    void loadBackend(mode).then((b) => alive && setBackend(b));
    return () => {
      alive = false;
    };
  }, [mode]);
  const qc = useQueryClient();
  const setMode = useCallback(
    (m: Mode) => {
      localStorage.setItem(MODE_KEY, m);
      qc.clear();
      setModeState(m);
    },
    [qc],
  );
  if (!backend)
    return (
      <div className="flex min-h-svh items-center justify-center gap-2 text-stone-500">
        <span className="size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        กำลังเริ่มระบบ…
      </div>
    );
  return (
    <BackendContext.Provider value={{ backend, mode, setMode }}>{children}</BackendContext.Provider>
  );
}

export function useBackend() {
  const ctx = useContext(BackendContext);
  if (!ctx) throw new Error('BackendProvider missing');
  const identity = useSyncExternalStore(
    ctx.backend.subscribe,
    ctx.backend.identity,
    ctx.backend.identity,
  );
  return { ...ctx, api: ctx.backend.api, identity };
}

export function useMemberships() {
  const { api, identity } = useBackend();
  return useQuery({
    queryKey: ['me', identity?.userId],
    queryFn: () => api.me(),
    enabled: !!identity,
  });
}

// ── Toasts ───────────────────────────────────────────────────────────
type ToastTone = 'success' | 'warning' | 'error';
const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Array<{ id: number; message: string; tone: ToastTone }>>([]);
  const push = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm shadow-lg',
              t.tone === 'success' && 'bg-stone-900 text-white',
              t.tone === 'warning' && 'bg-amber-100 text-amber-950 ring-1 ring-amber-300',
              t.tone === 'error' && 'bg-red-700 text-white',
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Shop ─────────────────────────────────────────────────────────────
interface ShopCtx {
  shopId: string;
  me: Membership;
  view: StateView;
  state: ShopState;
  members: MemberInfo[];
  can(action: Action): boolean;
}
const ShopContext = createContext<ShopCtx | null>(null);

export const stateKey = (shopId: string, userId: string) => ['state', shopId, userId] as const;

export function useShopQueries(shopId: string) {
  const { api, identity } = useBackend();
  const userId = identity?.userId ?? '';
  const view = useQuery({
    queryKey: stateKey(shopId, userId),
    enabled: !!userId,
    queryFn: () => api.state(shopId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const members = useQuery({
    queryKey: ['members', shopId, userId],
    queryFn: () => api.members(shopId),
    enabled: !!userId,
  });
  return { view, members };
}

export function ShopProvider({
  shopId,
  me,
  view,
  members,
  children,
}: {
  shopId: string;
  me: Membership;
  view: StateView;
  members: MemberInfo[];
  children: ReactNode;
}) {
  const value = useMemo<ShopCtx>(
    () => ({ shopId, me, view, state: view.state, members, can: (a) => can(me.role, a) }),
    [shopId, me, view, members],
  );
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('ShopProvider missing');
  return ctx;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a domain action through the API.
 * - one idempotency key per invocation; network failures retry with the same key
 * - 409: someone else changed the shop — reload and tell the user to retry
 * - 422/400: show the (Thai) rule message in the form
 */
export function useAction() {
  const { api } = useBackend();
  const { shopId, view, me } = useShop();
  const qc = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T extends ActionType>(
      type: T,
      payload: ActionPayload<T>,
      success?: string,
    ): Promise<boolean> => {
      setPending(true);
      setError(null);
      const key = crypto.randomUUID();
      try {
        let attempt = 0;
        for (;;) {
          try {
            // latest known revision (a previous action in the same handler may have advanced it)
            const base =
              qc.getQueryData<StateView>(stateKey(shopId, me.userId))?.revision ?? view.revision;
            const next = await api.action(shopId, type, payload, base, key);
            qc.setQueryData(stateKey(shopId, me.userId), next);
            if (success) toast(success);
            return true;
          } catch (e) {
            if (e instanceof TypeError && attempt++ < 2) {
              await sleep(600 * attempt);
              continue;
            }
            throw e;
          }
        }
      } catch (e) {
        if (e instanceof ApiError && e.isConflict) {
          toast(
            'ข้อมูลเปลี่ยนจากผู้ใช้อื่นแล้ว โหลดข้อมูลล่าสุดให้แล้ว กรุณาตรวจและทำรายการอีกครั้ง',
            'warning',
          );
          await qc.invalidateQueries({ queryKey: stateKey(shopId, me.userId) });
          setError('ข้อมูลเปลี่ยนแล้ว กรุณาตรวจข้อมูลล่าสุดแล้วกดอีกครั้ง');
        } else if (e instanceof ApiError) setError(e.message);
        else setError('เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่');
        return false;
      } finally {
        setPending(false);
      }
    },
    [api, shopId, view.revision, me.userId, qc, toast],
  );
  return { run, pending, error, setError };
}
