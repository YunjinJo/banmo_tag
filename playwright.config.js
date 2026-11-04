// Playwright 설정: 실제 확장 프로그램(extension/)을 Chromium 에 로드해 팝업·content script·background 를 검사합니다.
'use strict';

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests/e2e',
  // 확장 프로그램마다 별도 브라우저 프로필을 띄우므로 한 번에 하나씩 실행 (CI 러너 부하·불안정 방지)
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure'
  }
});
