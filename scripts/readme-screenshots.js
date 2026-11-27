// scripts/readme-screenshots.js
// README 에 넣는 스크린샷(docs/images/*.png)을 다시 찍습니다. 팝업 화면을 바꾼 뒤 실행하세요.
//
//   npm run docs:screenshots
//
// - 실제 확장 프로그램(extension/)을 Playwright Chromium 에 넣고, 예시 리스트 데이터로 팝업을 찍습니다.
// - 타임라인은 실제 X 가 아니라 예시 페이지(docs/images/src/demo-timeline.html)에 실제 확장 프로그램을 적용해 찍습니다.
//   (X 화면 구조를 흉내 낸 data-testid 만 쓰고, X 의 로고·디자인은 쓰지 않습니다.)
// - x.com 요청은 모두 이 스크립트가 응답하므로 실제 X 서버에 접속하지 않습니다.
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const repo = path.resolve(__dirname, '..');
const out = path.join(repo, 'docs', 'images');

const LISTS = {
  '친구': { color: '#c8174d', mode: 'highlight', members: ['@alice', '@bob', '@carol'] },
  '동료': { color: '#0f7b3e', mode: 'normal', members: ['@minjun', '@kim', '@lee', '@park', '@choi'] },
  'AI 연구자 모음 (국내·해외)': { color: '#7a3fd1', mode: 'normal', members: ['@minjun', '@hana_ai', '@lab_seoul', '@ml_daily'], style: { fontFamily: "'Noto Sans KR', sans-serif" } },
  '스터디': { color: '#b45309', mode: 'normal', members: ['@minjun', '@yuna'] },
  '개발 모임': { color: '#536471', mode: 'normal', members: ['@minjun', '@devkim'] },
  '뉴스 모음': { color: '#0b74c4', mode: 'dim', members: ['@news_daily', '@tech_today', '@econ_kr'] }
};

(async () => {
  const ext = path.join(repo, 'extension');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  await context.route(/^https:\/\/(x|twitter)\.com\//, r => r.fulfill({ status: 404, body: '' }));
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const set = d => sw.evaluate(x => chrome.storage.local.set(x), d);
  const clear = () => sw.evaluate(() => chrome.storage.local.clear());

  // 1. 크롬 확장 프로그램 관리 화면 (개발자 모드 켜고 로드된 상태)
  const ext1 = await context.newPage();
  await ext1.setViewportSize({ width: 1100, height: 520 });
  await ext1.goto('chrome://extensions');
  await ext1.waitForTimeout(800);
  const dev = ext1.locator('#devMode');
  if ((await dev.getAttribute('aria-pressed')) !== 'true') await dev.click();
  await ext1.waitForTimeout(600);
  await ext1.screenshot({ path: path.join(out, 'install-chrome.png') });
  await ext1.close();

  // 2. 멤버 화면에서 [현재 탭에서 가져오기]
  await clear();
  const members = fs.readFileSync(path.join(repo, 'tests/fixtures/synthetic/list-members.html'), 'utf8');
  const listMain = fs.readFileSync(path.join(repo, 'tests/fixtures/synthetic/list-main.html'), 'utf8');
  await context.route('https://x.com/i/lists/123/members', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: members }));
  await context.route('https://x.com/i/lists/123', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: listMain }));
  const xPage = await context.newPage();
  // 리스트 메인 화면에서 이름을 읽은 뒤 멤버 화면으로 (실제 사용 순서)
  await xPage.goto('https://x.com/i/lists/123');
  await xPage.waitForTimeout(800);
  await xPage.goto('https://x.com/i/lists/123/members');
  await xPage.waitForTimeout(1200);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: ['https://x.com/*'] }))[0].id);
  await clear(); // 자동 수집된 것을 지우고 버튼으로 가져오는 모습

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  const openPopup = async (scheme) => {
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForSelector('#list-container');
    await popup.waitForTimeout(300);
  };
  await openPopup('light');
  await popup.evaluate(([tid]) => {
    chrome.tabs.query = async () => [{ id: tid, url: 'https://x.com/i/lists/123/members', active: true }];
  }, [tabId]);
  await popup.click('#sync-current-tab-btn');
  await popup.waitForSelector('#sync-status.success');
  await popup.waitForTimeout(500);
  await popup.screenshot({ path: path.join(out, 'popup-sync.png') });
  await xPage.close(); // 멤버 화면이 열려 있으면 계속 자동 수집하므로 닫음

  // 3. 리스트 탭 (라이트 / 다크)
  await clear();
  await set({ lists: LISTS, badgeSettings: { textColor: '#ffffff', fontSize: 12, fontFamily: 'system' } });
  await openPopup('light');
  await popup.screenshot({ path: path.join(out, 'popup-lists.png') });
  await openPopup('dark');
  await popup.screenshot({ path: path.join(out, 'popup-lists-dark.png') });

  // 4. [+ 추가]
  await openPopup('light');
  await popup.click('#toggle-manual-add-btn');
  await popup.fill('#manual-name', '스터디 멤버');
  await popup.fill('#manual-members', '@yuna, @minjun');
  await popup.locator('#manual-add-form').scrollIntoViewIfNeeded();
  await popup.screenshot({ path: path.join(out, 'popup-add.png') });

  // 5. 리스트 설정 창
  await openPopup('light');
  await popup.locator('.list-name', { hasText: /^친구$/ }).first().click();
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(out, 'popup-sheet.png') });
  await popup.click('#sheet-members-btn');
  await popup.waitForTimeout(200);
  await popup.locator('#list-sheet').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await popup.waitForTimeout(200);
  await popup.screenshot({ path: path.join(out, 'popup-sheet-members.png') });

  // 6. 기본 스타일 탭
  await openPopup('light');
  await popup.click('#tab-style');
  await popup.waitForTimeout(200);
  await popup.screenshot({ path: path.join(out, 'popup-style.png') });

  // 6-1. [설치된 폰트에서 고르기…] 창: 크롬 "글꼴" 권한을 허용해 둔 상태로 이 PC 의 폰트 목록을 보여 주고 "gothic" 으로 검색
  //      (Playwright 의 grantPermissions 는 chrome-extension 주소를 받지 못해 CDP 로 허용)
  const cdp = await context.newCDPSession(popup);
  await cdp.send('Browser.setPermission', { origin: `chrome-extension://${id}`, permission: { name: 'local-fonts' }, setting: 'granted' });
  await popup.locator('#badge-font-family').selectOption('custom:');
  await popup.waitForSelector('#font-list .font-option', { timeout: 20000 });
  await popup.fill('#font-name-input', 'gothic');
  await popup.keyboard.press('ArrowDown');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(out, 'popup-font.png') });
  await popup.keyboard.press('Escape');

  // 6-2. [설정] 창 (⚙): 배지 순서 / 타임라인 배지 표시
  await openPopup('light');
  await popup.click('#settings-btn');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(out, 'popup-settings.png') });
  await popup.locator('#settings-sheet').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await popup.waitForTimeout(200);
  await popup.screenshot({ path: path.join(out, 'popup-settings-display.png') });

  // 7. ⋯ 메뉴
  await openPopup('light');
  await popup.click('#menu-btn');
  await popup.waitForTimeout(200);
  await popup.screenshot({ path: path.join(out, 'popup-menu.png') });

  // 8. 타임라인 (예시 페이지에 실제 확장 프로그램 적용)
  const demo = fs.readFileSync(path.join(out, 'src', 'demo-timeline.html'), 'utf8');
  await context.route('https://x.com/home', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: demo }));
  const tl = await context.newPage();
  await tl.setViewportSize({ width: 640, height: 560 });
  await tl.goto('https://x.com/home');
  await tl.waitForSelector('.ag-list-badge');
  await tl.waitForTimeout(800);
  await tl.locator('main').screenshot({ path: path.join(out, 'timeline.png') });

  await context.close();
})().catch((e) => { console.error(e); process.exit(1); });
