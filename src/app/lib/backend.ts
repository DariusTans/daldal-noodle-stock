/**
 * The two backends the app can run on:
 *   cloud — Supabase Auth in the browser, /api on Vercel (requires VITE_SUPABASE_* env)
 *   demo  — the same API app running in this browser tab on an in-memory store saved to
 *           localStorage; three sample members, switchable to see each role's view.
 */
import type { Api } from './api';

export interface Identity {
  userId: string;
  email: string;
}

export interface Backend {
  mode: 'cloud' | 'demo';
  api: Api;
  identity(): Identity | null;
  /** Notifies when the signed-in identity changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
  signOut(): Promise<void>;
}

export const cloudConfigured =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

export const DEMO_PEOPLE = [
  { email: 'owner@demo.daldal', name: 'เจ้าของตัวอย่าง', role: 'owner' },
  { email: 'manager@demo.daldal', name: 'ผู้จัดการตัวอย่าง', role: 'manager' },
  { email: 'staff@demo.daldal', name: 'พนักงานตัวอย่าง', role: 'staff' },
] as const;
export type DemoPerson = (typeof DEMO_PEOPLE)[number]['email'];

export type DemoBackend = Backend & { switchTo(email: DemoPerson): void; reset(): Promise<void> };

/** Each backend is its own chunk: the cloud app never downloads the demo, and vice versa. */
export const loadBackend = (mode: 'cloud' | 'demo'): Promise<Backend> =>
  mode === 'cloud'
    ? import('./cloud-backend').then((m) => m.cloudBackend())
    : import('./demo-backend').then((m) => m.demoBackend());
