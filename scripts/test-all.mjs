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
  ['Phase 7', 'test-phase7.mjs'],
  ['Phase 8', 'test-phase8.mjs'],
  ['Phase 9', 'test-phase9.mjs'],
  ['Phase 10', 'test-phase10.mjs'],
  ['Phase 11', 'test-phase11.mjs'],
  ['Phase 12', 'test-phase12.mjs'],
  ['Phase 13', 'test-phase13.mjs'],
  ['Phase 14', 'test-phase14.mjs'],
  ['Phase 15 — stock', 'test-phase15.mjs'],
  ['Phase 16 — purchases', 'test-phase16.mjs'],
  ['Phase 17 — recipes', 'test-phase17.mjs'],
  ['Phase 18 — deduction', 'test-phase18.mjs'],
  ['Phase 19 — expenses', 'test-phase19.mjs'],
  ['Phase 20 — profit & loss', 'test-phase20.mjs'],
  ['Phase 21 — wastage, adjustments, stock counts', 'test-phase21.mjs'],
  ['Phase 22 — item profit, stock value and spend reports', 'test-phase22.mjs'],
  ['Phase 23 — salaries and vehicle costs in the P&L', 'test-phase23.mjs'],
  ['Phase 24 — opening stock, supplier returns, price trend', 'test-phase24.mjs'],
  ['Phase 25 — house-made ingredients / sub-recipes', 'test-phase25.mjs'],
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
