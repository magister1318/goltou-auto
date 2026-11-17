import { expect, it } from 'vitest';
import { validateTestReport } from '../../../scripts/check-test-report.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function complete() {
  return { success: true, numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numFailedTestSuites: 0,
    numPendingTests: 0, numPendingTestSuites: 0, numTodoTests: 0,
    testResults: [{name:'C:/synthetic/packages/core/test/runtime-compatibility.test.ts', status:'passed',
      assertionResults:[{status:'passed',title:'한글·따옴표 " · 역슬래시 \\ 판독'}]}] };
}

it('validates the UTF-8 report bytes through the installer CLI, including Korean test names', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'goltou-suite-evidence-'));
  try {
    const file = path.join(directory, 'tests.json');
    await writeFile(file, JSON.stringify(complete()), 'utf8');
    const result = await promisify(execFile)(process.execPath, ['scripts/check-test-report.mjs', file]);
    expect(result.stdout).toContain('FULL_SUITE_EVIDENCE_PASSED tests=2 runtimeTests=1 skipped=0 todo=0');
  } finally { await rm(directory, { recursive:true, force:true }); }
});

it.each(['failed','skipped','todo','missing-runtime','skipped-runtime','empty'] as const)('rejects incomplete suite evidence: %s', mode => {
  const report = complete();
  if (mode==='failed') { report.success=false; report.numFailedTests=1; }
  if (mode==='skipped') report.numPendingTests=1;
  if (mode==='todo') report.numTodoTests=1;
  if (mode==='missing-runtime') report.testResults=[];
  if (mode==='skipped-runtime') report.testResults[0]!.assertionResults[0]!.status='skipped';
  if (mode==='empty') { report.numTotalTests=0; report.numPassedTests=0; }
  expect(()=>validateTestReport(report)).toThrow('INSTALL_GATE_FULL_SUITE_OR_RUNTIME_CHECK_MISSING');
});
