// Compiles /api as plain Node ESM (module: nodenext — fails on extensionless imports, like
// Vercel's runtime would) and smoke-tests the handlers with node. Run: npm run check:api
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '.tmp', 'api-check');
rmSync(out, { recursive: true, force: true });
const entries = readdirSync(join(root, 'api'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => join('api', f));
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    ...entries,
    '--ignoreConfig',
    '--outDir',
    out,
    '--module',
    'nodenext',
    '--moduleResolution',
    'nodenext',
    '--target',
    'es2022',
    '--skipLibCheck',
    '--types',
    'node',
    '--strict',
  ],
  { cwd: root, stdio: 'inherit' },
);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'package.json'), '{"type":"module"}');
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'check-api';
let failed = 0;
for (const f of entries) {
  const mod = await import(pathToFileURL(join(out, f.replace(/\.ts$/, '.js'))).href);
  const methods = Object.keys(mod).filter((k) => /^[A-Z]+$/.test(k));
  if (!methods.length) {
    console.error(`✗ ${f}: no HTTP method exports`);
    failed++;
    continue;
  }
  const route = '/' + f.replaceAll('\\', '/').replace(/\.ts$/, '');
  const res = await mod[methods[0]](
    new Request('https://check.local' + route, { method: methods[0] }),
  );
  const ok = route === '/api/health' ? res.status === 200 : res.status === 401;
  console.log(`${ok ? '✓' : '✗'} ${methods.join(',').padEnd(16)} ${route} → ${res.status}`);
  if (!ok) failed++;
}
rmSync(join(root, '.tmp'), { recursive: true, force: true });
process.exit(failed ? 1 : 0);
