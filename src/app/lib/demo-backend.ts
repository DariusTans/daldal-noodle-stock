/** Offline demo backend: the real API app running in this tab on a localStorage-backed store. */
import { demoSeed } from '@/domain/demo';
import { createApp } from '@/server/app';
import { emptyMemoryData, memoryBackend, type MemoryData } from '@/server/memory';
import { createApi } from './api';
import { DEMO_PEOPLE, type DemoBackend, type DemoPerson } from './backend';

const DEMO_KEY = 'daldal-v1-demo';

interface Persisted {
  data: MemoryData;
  objects: [string, string][]; // path → base64
  current: DemoPerson;
}

const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function demoBackend(): DemoBackend {
  let lastRaw = localStorage.getItem(DEMO_KEY);
  let saved: Persisted | null = null;
  try {
    saved = JSON.parse(lastRaw ?? 'null');
  } catch {
    saved = null;
  }
  const data = saved?.data ?? emptyMemoryData();
  const objects = new Map((saved?.objects ?? []).map(([k, v]) => [k, unb64(v)] as const));
  let current: DemoPerson = saved?.current ?? 'owner@demo.daldal';
  const listeners = new Set<() => void>();

  const persist = () => {
    try {
      const raw = JSON.stringify({
        data,
        objects: [...objects].map(([k, v]) => [k, b64(v)]),
        current,
      } satisfies Persisted);
      localStorage.setItem(DEMO_KEY, raw);
      lastRaw = raw;
    } catch {
      /* storage full: the demo keeps working for this tab */
    }
  };
  /**
   * Another tab may have written since: load its data first, so the server-side revision
   * check sees the latest state and a stale tab gets 409 instead of overwriting.
   */
  const syncFromOtherTabs = () => {
    const raw = localStorage.getItem(DEMO_KEY);
    if (!raw || raw === lastRaw) return;
    try {
      const other = JSON.parse(raw) as Persisted;
      Object.assign(data, other.data);
      objects.clear();
      for (const [k, v] of other.objects) objects.set(k, unb64(v));
      lastRaw = raw;
    } catch {
      /* ignore a corrupt foreign write */
    }
  };
  const backend = memoryBackend(data, objects, persist);
  const handle = createApp(backend.deps);
  const tokens = new Map(DEMO_PEOPLE.map((p) => [p.email, backend.signIn(p.email)] as const));
  const identities = new Map(
    DEMO_PEOPLE.map(
      (p) => [p.email, { userId: tokens.get(p.email)!.userId, email: p.email }] as const,
    ),
  );

  async function ensureShop() {
    const owner = tokens.get('owner@demo.daldal')!;
    if (data.shops.length) return;
    const initial = demoSeed({
      owner: DEMO_PEOPLE[0].name,
      manager: DEMO_PEOPLE[1].name,
      staff: DEMO_PEOPLE[2].name,
    });
    const shopId = await backend.deps.repo.bootstrap(
      owner.userId,
      'ดัลดัล นู้ดเดิล',
      DEMO_PEOPLE[0].name,
      initial,
    );
    for (const p of DEMO_PEOPLE.slice(1))
      await backend.deps.repo.addMember({
        shopId,
        userId: tokens.get(p.email)!.userId,
        role: p.role,
        displayName: p.name,
      });
  }
  const ready = ensureShop();

  const transport = async (req: Request) => {
    await ready;
    syncFromOtherTabs();
    const headers = new Headers(req.headers);
    headers.set('authorization', 'Bearer ' + tokens.get(current)!.token);
    return handle(new Request(req, { headers }));
  };
  const api = createApi(transport, async (_path, token, file) =>
    backend.upload(token, new Uint8Array(await file.arrayBuffer())),
  );
  const notify = () => listeners.forEach((l) => l());

  return {
    mode: 'demo',
    api,
    identity: () => identities.get(current)!,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    signOut: async () => {},
    switchTo(email) {
      current = email;
      persist();
      notify();
    },
    async reset() {
      localStorage.removeItem(DEMO_KEY);
      location.reload();
    },
  };
}
