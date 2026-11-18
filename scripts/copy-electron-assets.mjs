/**
 * Copies non-TypeScript assets that the compiled main process needs at runtime.
 * SQL migrations stay as .sql files so they can be read and reviewed easily.
 */
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'electron', 'db', 'migrations');
const target = path.join(root, 'dist-electron', 'electron', 'db', 'migrations');

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

console.log(`[assets] migrations copied to ${path.relative(root, target)}`);

/**
 * The preload runs with `sandbox: true`, which gives it only a small `require`
 * (electron, and a few built-ins). A half-dozen relative `require()` calls would
 * fail there and `window.api` would simply never appear — a blank, unclickable app.
 *
 * So the preload is bundled into one self-contained file. It is small (the channel
 * names are strings) and bundling keeps contextIsolation + sandbox both on.
 */
await esbuild.build({
  entryPoints: [path.join(root, 'electron', 'preload.ts')],
  outfile: path.join(root, 'dist-electron', 'electron', 'preload.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  logLevel: 'warning',
});

const bundled = readFileSync(path.join(root, 'dist-electron', 'electron', 'preload.js'), 'utf8');
if (/require\(["']\.\.?\//.test(bundled)) {
  throw new Error('[assets] the preload still requires a relative module; sandbox would break');
}

console.log('[assets] preload bundled for sandbox (single file, electron external)');
