/**
 * Development launcher: Vite dev server + compiled Electron main process.
 * Steps: build main/preload -> start Vite -> wait for it -> start Electron.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const root = path.resolve(import.meta.dirname, '..');
const DEV_SERVER_URL = 'http://localhost:5173';
const bin = (name) =>
  path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);

const children = [];
const isWindows = process.platform === 'win32';

function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: isWindows, ...options });
  children.push(child);
  return child;
}

function runOnce(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: isWindows });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) return;
    } catch {
      // Server not up yet.
    }
    await sleep(300);
  }
  throw new Error(`Vite dev server did not start within ${timeoutMs}ms`);
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  console.log('[dev] compiling Electron main process...');
  await runOnce(bin('tsc'), ['-p', 'tsconfig.electron.json']);
  await runOnce(process.execPath, ['scripts/copy-electron-assets.mjs']);

  console.log('[dev] starting Vite...');
  run(bin('vite'), ['--host', '0.0.0.0', '--port', '5173'], { env: { ...process.env } });

  await waitForServer(DEV_SERVER_URL);
  console.log('[dev] launching Electron...');

  const electron = run(bin('electron'), ['.'], {
    env: { ...process.env, VITE_DEV_SERVER_URL: DEV_SERVER_URL },
  });

  electron.on('error', () => {
    console.error(
      '[dev] Electron could not start. Run `npm install` first (it downloads Electron).',
    );
  });

  electron.on('exit', (code) => shutdown(code ?? 0));
}

main().catch((error) => {
  console.error('[dev] failed:', error.message);
  shutdown(1);
});
