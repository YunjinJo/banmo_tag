// E2E 공통 헬퍼: 실제 확장 프로그램을 로드한 Chromium + 가짜 x.com 페이지
'use strict';

const fs = require('fs');
const path = require('path');
const { test: base, expect, chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures');

const test = base.extend({
  // 확장 프로그램을 로드한 새 브라우저 프로필 (테스트마다 새로 만들어 저장 데이터가 섞이지 않음)
  context: async ({}, use) => { // eslint-disable-line no-empty-pattern
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_DIR}`,
        `--load-extension=${EXTENSION_DIR}`
      ]
    });
    // 등록하지 않은 x.com 주소는 404 (실제 X 서버로 나가지 않도록)
    await context.route(/^https:\/\/(x|twitter)\.com\//, route =>
      route.fulfill({ status: 404, contentType: 'text/plain', body: 'not mocked' }));
    await use(context);
    await context.close();
  },

  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  }
});

function readFixture(relPath) {
  return fs.readFileSync(path.join(FIXTURE_DIR, relPath), 'utf8');
}

// x.com 의 특정 경로에 fixture HTML 을 응답 (나중에 등록한 route 가 먼저 적용됨)
async function mockXPage(context, urlPath, fixtureRelPath) {
  const html = readFixture(fixtureRelPath);
  await context.route(`https://x.com${urlPath}`, route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
}

async function setStorage(sw, data) {
  await sw.evaluate(d => chrome.storage.local.set(d), data);
}

async function getStorage(sw, keys) {
  return sw.evaluate(k => chrome.storage.local.get(k), keys);
}

async function getLists(sw) {
  return (await getStorage(sw, ['lists'])).lists || {};
}

async function openPopup(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector('#list-container');
  return page;
}

// x.com 탭의 id (확장 프로그램이 x.com 호스트 권한을 가지므로 url 로 검색 가능)
async function findXTabId(sw) {
  return sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: ['https://x.com/*'] });
    return tabs.length ? tabs[0].id : null;
  });
}

// background(서비스 워커)에서 x.com 탭의 content script 로 메시지 전송
async function sendToTab(sw, tabId, message) {
  return sw.evaluate(([id, msg]) => chrome.tabs.sendMessage(id, msg), [tabId, message]);
}

// 팝업이 "현재 탭"으로 x.com 탭을 보도록 함.
// Playwright 에서는 팝업을 일반 탭으로 열기 때문에 실제 활성 탭이 팝업 자신이 되므로, 조회 결과만 바꿉니다.
async function pointPopupAtTab(popupPage, tabId, url) {
  await popupPage.evaluate(([id, u]) => {
    const fake = async () => [{ id, url: u, active: true }];
    try {
      chrome.tabs.query = fake;
    } catch {
      Object.defineProperty(chrome.tabs, 'query', { value: fake, configurable: true });
    }
  }, [tabId, url]);
}

module.exports = {
  test,
  expect,
  ROOT,
  FIXTURE_DIR,
  readFixture,
  mockXPage,
  setStorage,
  getStorage,
  getLists,
  openPopup,
  findXTabId,
  sendToTab,
  pointPopupAtTab
};
