/**
 * Runs every phase test in order and reports one summary.
 * Usage: npm run test:all  (builds the main process first)
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const suites = [
  ['Phase 1', 'auth-smoke-test.mjs'],
  ['Phase 2', 'test-phase2.mjs'],
  ['Phase 3', 'test-phase3.mjs'],
  ['Phase 4', 'test-phase4.mjs'],
  ['Phase 5', 'test-phase5.mjs'],
  ['Phase 6', 'test-phase6.mjs'],
];

const results = [];

for (const [label, file] of suites) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', file)], {
    cwd: root,
    encoding: 'utf8',
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = /(\d+) checks passed/.exec(output);
  const failedMatch = /(\d+) passed, (\d+) FAILED/.exec(output);
  const passed = match ? Number(match[1]) : 0;
  const failed = failedMatch ? Number(failedMatch[2]) : result.status === 0 ? 0 : 1;

  results.push({ label, passed, failed });

  if (result.status !== 0) {
    console.error(`\n=== ${label} (${file}) failed ===\n${output}`);
  }
}

const totalPassed = results.reduce((sum, row) => sum + row.passed, 0);
const totalFailed = results.reduce((sum, row) => sum + row.failed, 0);

console.log('\nTest summary');
console.log('------------');
for (const row of results) {
  console.log(
    `${row.failed === 0 ? 'PASS' : 'FAIL'}  ${row.label}: ${row.passed} passed${
      row.failed > 0 ? `, ${row.failed} failed` : ''
    }`,
  );
}
console.log('------------');
console.log(`${totalPassed} checks passed, ${totalFailed} failed\n`);

process.exitCode = totalFailed > 0 ? 1 : 0;
