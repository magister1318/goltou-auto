import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateTestReport(report) {
  const runtime = Array.isArray(report?.testResults) ? report.testResults.filter(file => /[/\\]runtime-compatibility\.test\.ts$/.test(file.name)) : [];
  if (report?.success !== true || !Number.isSafeInteger(report.numTotalTests) || report.numTotalTests <= 0 ||
      report.numPassedTests !== report.numTotalTests || report.numFailedTests !== 0 || report.numFailedTestSuites !== 0 ||
      report.numPendingTests !== 0 || report.numPendingTestSuites !== 0 || report.numTodoTests !== 0 ||
      runtime.length !== 1 || runtime[0].status !== 'passed' || !runtime[0].assertionResults?.length ||
      runtime[0].assertionResults.some(test => test.status !== 'passed')) {
    throw new Error('INSTALL_GATE_FULL_SUITE_OR_RUNTIME_CHECK_MISSING');
  }
  return { tests: report.numTotalTests, runtimeTests: runtime[0].assertionResults.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateTestReport(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  console.log(`FULL_SUITE_EVIDENCE_PASSED tests=${result.tests} runtimeTests=${result.runtimeTests} skipped=0 todo=0`);
}
