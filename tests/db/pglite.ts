/** Fresh PGlite database with the Supabase stub and every migration applied. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = join(import.meta.dirname, '..', '..');
export const migrationFiles = readdirSync(join(root, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

export async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, 'supabase-stub.sql'), 'utf8'));
  for (const f of migrationFiles)
    await db.exec(readFileSync(join(root, 'supabase', 'migrations', f), 'utf8'));
  return db;
}
