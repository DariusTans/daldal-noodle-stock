/**
 * Vercel entry: builds the app once per function instance from environment variables.
 * Each file in /api re-exports `handle` for the HTTP methods it serves.
 */
import { createApp } from './app.js';
import { json } from './http.js';
import { supabaseDeps } from './supabase.js';

let app: ((req: Request) => Promise<Response>) | null = null;

function instance() {
  if (app) return app;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  app = createApp(
    supabaseDeps({
      url,
      serviceRoleKey,
      siteUrl:
        process.env.SITE_URL ??
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined),
      allowShopCreation: process.env.ALLOW_SHOP_CREATION !== 'false',
    }),
  );
  return app;
}

export async function handle(req: Request): Promise<Response> {
  const a = instance();
  if (!a)
    return json(
      {
        error: 'not_configured',
        message: 'ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
      },
      500,
    );
  return a(req);
}
