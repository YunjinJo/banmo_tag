// tests/unit/*.test.js (extension/shared/ 단위 테스트)를 tests/test-runner.html 로 Playwright 에서도 실행 (Linux CI 포함)
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect } = require('@playwright/test');

test('공통 코드(shared/) 단위 테스트 전체 통과 (test-runner.html)', async ({ page }) => {
  const runner = pathToFileURL(path.resolve(__dirname, '..', 'test-runner.html')).href;
  await page.goto(runner);
  const json = await page.locator('#test-results-data').textContent();
  const report = JSON.parse(json);

  const failures = [];
  report.suites.forEach(s => s.tests.forEach(t => {
    if (!t.passed) failures.push(`${s.name} › ${t.name}: ${t.error}`);
  }));

  expect(report.total, '테스트가 하나도 실행되지 않음').toBeGreaterThan(0);
  expect(failures, failures.join('\n')).toEqual([]);
  console.log(`  공통 코드(shared/) 단위 테스트 ${report.passed}/${report.total} 통과`);
});
