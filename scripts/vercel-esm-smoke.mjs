import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Vercel emits JS modules without Vite/tsx's extension resolution. Exercise that exact boundary.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
assert(!config.error, 'Cannot read TypeScript configuration.');
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(
  ['api/health.ts', 'api/online.ts', 'server/main.ts'].map((path) => join(root, path)),
  parsed.options,
);
const cacheRoot = join(root, 'node_modules', '.cache');
mkdirSync(cacheRoot, { recursive: true });
const output = mkdtempSync(join(cacheRoot, 'vercel-esm-'));
try {
  writeFileSync(join(output, 'package.json'), '{"type":"module"}');
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || source.fileName.includes('node_modules')) continue;
    const path = relative(root, source.fileName);
    assert(!isAbsolute(path) && !path.startsWith('..'), 'Source must belong to this repository.');
    const destination = join(output, path.replace(/\.tsx?$/, '.js'));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(
      destination,
      ts.transpileModule(readFileSync(source.fileName, 'utf8'), {
        fileName: source.fileName,
        compilerOptions: parsed.options,
      }).outputText,
    );
  }
  const runner = `
    import assert from 'node:assert/strict';
    import { createServer } from 'node:http';
    const { default: health } = await import('./api/health.js');
    const { default: online } = await import('./api/online.js');
    const server = createServer((request, response) => {
      void (request.url === '/api/health' ? health : online)(request, response);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      const result = await fetch(base + '/api/health');
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { ok: true });
      const unauthorized = await fetch(base + '/api/online', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'state' }),
      });
      assert.equal(unauthorized.status, 401);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  `;
  writeFileSync(join(output, 'check.mjs'), runner);
  const result = spawnSync(process.execPath, ['check.mjs'], {
    cwd: output,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
      APP_ORIGIN: 'https://hexfortia.example',
    },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  console.log('Native Node ESM API startup passed: health 200, protected online 401.');
} finally {
  assert.equal(dirname(output), cacheRoot, 'Only remove the temporary verification directory.');
  rmSync(output, { recursive: true, force: true });
}
