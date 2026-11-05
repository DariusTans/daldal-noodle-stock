/** Cloud backend: Supabase Auth in the browser, /api on Vercel. */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { createApi } from './api';
import type { Backend, Identity } from './backend';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let supabase: SupabaseClient | null = null;
export const supabaseClient = () =>
  (supabase ??= createClient(url!, anonKey!, {
    auth: { persistSession: true, autoRefreshToken: true },
  }));

export function cloudBackend(): Backend {
  const sb = supabaseClient();
  let session: Session | null = null;
  let cached: Identity | null = null;
  let cachedFor: string | null = null;
  const listeners = new Set<() => void>();
  void sb.auth.getSession().then(({ data }) => {
    session = data.session;
    listeners.forEach((l) => l());
  });
  sb.auth.onAuthStateChange((_event, s) => {
    session = s;
    listeners.forEach((l) => l());
  });
  const transport = async (req: Request) => {
    const { data } = await sb.auth.getSession(); // refreshes an expired token
    const headers = new Headers(req.headers);
    if (data.session) headers.set('authorization', 'Bearer ' + data.session.access_token);
    return fetch(new Request(req, { headers }));
  };
  const api = createApi(transport, async (path, token, file) => {
    const { error } = await sb.storage.from('evidence').uploadToSignedUrl(path, token, file, {
      contentType: file.type,
    });
    if (error) throw new Error('อัปโหลดไฟล์ไม่สำเร็จ: ' + error.message);
  });
  return {
    mode: 'cloud',
    api,
    identity: () => {
      // stable object per session (useSyncExternalStore requires referential stability)
      if (!session) return ((cachedFor = null), (cached = null));
      if (cachedFor !== session.user.id)
        ((cachedFor = session.user.id),
          (cached = { userId: session.user.id, email: session.user.email ?? '' }));
      return cached;
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    signOut: async () => {
      await sb.auth.signOut();
    },
  };
}
