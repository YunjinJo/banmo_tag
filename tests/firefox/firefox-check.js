// tests/firefox/firefox-check.js — 실제 파이어폭스에 banmo_tag 를 임시 설치해 주요 기능을 확인
//
// 실행: npm run test:firefox
//   - 파이어폭스 위치: 환경 변수 FIREFOX_BIN (없으면 Windows 의 %LOCALAPPDATA%\banmo_tag-test\firefox-*\core\firefox.exe)
//     파이어폭스 받기: npx @puppeteer/browsers install firefox@stable  (출력된 경로를 FIREFOX_BIN 으로)
//   - x.com 요청은 파이어폭스 설정(network.dns.forceResolve)으로 이 스크립트의 테스트 서버(포트 80)로 보내고,
//     tests/fixtures/synthetic 의 페이지로 응답합니다. 실제 X 서버는 쓰지 않습니다.
//     포트 80 을 열 수 있어야 합니다 (Linux: sysctl net.ipv4.ip_unprivileged_port_start=80 또는 관리자 권한).
//   - 자동화 프로토콜(WebDriver BiDi)이 확장 프로그램 페이지로의 직접 이동을 막으므로, 테스트에서만
//     브라우저 내부 창 접근(MOZ_REMOTE_ALLOW_SYSTEM_ACCESS)을 켜서 사용자가 여는 것처럼 새 탭을 엽니다.
/* global getBrowserKind, readBackupFile */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(__dirname, '..', '..');
// 파이어폭스용 manifest 를 합친 폴더 (dist/firefox/) 를 새로 만들어 설치
const EXT_DIR = require('../../scripts/build-firefox').buildFirefox();
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'synthetic');
const PORT = 80; // 실제 X 처럼 포트 없는 주소 (http://x.com/...)
const EXT_ID = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')).browser_specific_settings.gecko.id;
const UUID = 'b4a1c2d3-0000-4000-8000-000000000001';
const BASE = `moz-extension://${UUID}`;
const X = 'http://x.com';
const GRANT = process.argv.includes('--grant'); // x.com 접근 권한을 기본 허용으로 두고 실행

function findFirefox() {
  if (process.env.FIREFOX_BIN) return process.env.FIREFOX_BIN;
  const base = path.join(process.env.LOCALAPPDATA || '', 'banmo_tag-test');
  const dir = fs.existsSync(base) ? fs.readdirSync(base).filter(d => d.startsWith('firefox-')).sort().pop() : null;
  const exe = dir && path.join(base, dir, 'core', 'firefox.exe');
  if (exe && fs.existsSync(exe)) return exe;
  console.error('파이어폭스를 찾을 수 없습니다. FIREFOX_BIN 환경 변수에 firefox 실행 파일 경로를 지정하세요.');
  process.exit(2);
}
const FIREFOX = findFirefox();
const ROUTES = {
  '/home': 'home-timeline.html',
  '/i/lists/123': 'list-main.html',
  '/i/lists/123/members': 'list-members.html',
  '/i/lists/999/members': 'members-changed.html'
};

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function poll(fn, timeoutMs = 10000, interval = 300) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await fn().catch(e => ({ __error: String(e) }));
    if (last && !last.__error) return last;
    await sleep(interval);
  }
  // 시간 안에 조건을 못 채웠거나 오류가 났으면 실패(null). 오류 내용은 로그로만 남김
  if (last && last.__error) console.log('      (poll 오류: ' + last.__error.split('\n')[0] + ')');
  return null;
}

(async () => {
  const server = http.createServer((req, res) => {
    const file = ROUTES[req.url.split('?')[0].replace(/\/$/, '')];
    if (!file) { res.writeHead(404); res.end('not mocked'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(FIXTURES, file)));
  }).listen(PORT);

  const prefs = {
    'network.dns.forceResolve': '127.0.0.1',          // x.com → 로컬 테스트 서버
    'network.stricttransportsecurity.preloadlist': false,
    'dom.security.https_first': false,
    'dom.security.https_first_pbm': false,
    'dom.security.https_only_mode': false,
    'browser.fixup.fallback-to-https': false,
    'extensions.webextensions.uuids': JSON.stringify({ [EXT_ID]: UUID })
  };
  if (GRANT) prefs['extensions.originControls.grantByDefault'] = true;

  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: FIREFOX,
    headless: true,
    // 테스트 전용: 자동화 프로토콜이 확장 프로그램 페이지로 직접 이동하는 것을 막으므로,
    // 브라우저 내부(chrome) 창에서 사용자가 여는 것처럼 새 탭을 엶
    args: ['--remote-allow-system-access'],
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    extraPrefsFirefox: prefs
  });

  // moz-extension:// 페이지를 새 탭으로 열고 Puppeteer 페이지로 돌려줌
  async function openExtensionPage(url) {
    const conn = browser.connection;
    const tree = await conn.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
    const chromeWindow = tree.result.contexts[0].context;
    await conn.send('script.evaluate', {
      expression: `gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); true`,
      target: { context: chromeWindow },
      awaitPromise: false
    });
    // Puppeteer 는 확장 프로그램 페이지로의 이동을 추적하지 못해 URL 이 about:blank 로 남으므로,
    // 각 탭에 실제 주소(location.href)를 물어 찾음
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      for (const page of await browser.pages()) {
        const href = await page.evaluate(() => location.href).catch(() => '');
        if (href === url) {
          await page.waitForFunction(() => document.readyState === 'complete');
          return page;
        }
      }
      await sleep(300);
    }
    throw new Error('확장 프로그램 페이지를 찾지 못함: ' + url);
  }
  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', e => errors.push(`${label}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  };

  try {
    const version = await browser.version();
    const installedId = await browser.installExtension(EXT_DIR);
    record('파이어폭스에 임시 설치', installedId === EXT_ID, `${version}, id=${installedId}`);

    // 1. 팝업 화면
    const popup = await openExtensionPage(`${BASE}/popup.html`);
    watch(popup, 'popup');
    await popup.waitForSelector('#list-container');
    await sleep(800);
    const popupState = await popup.evaluate(() => ({
      kind: getBrowserKind(chrome.runtime.getURL('')),
      empty: (document.querySelector('.empty-state') || {}).textContent || '',
      firefoxNote: getComputedStyle(document.getElementById('firefox-note')).display,
      permissionBanner: getComputedStyle(document.getElementById('permission-warning')).display
    }));
    record('팝업 열림 (shared/ 로드, 빈 목록 안내)', popupState.empty.includes('저장된 리스트가 없습니다'));
    record('브라우저 구분 = firefox', popupState.kind === 'firefox');
    record('파이어폭스 안내 문구 표시', popupState.firefoxNote === 'block');

    // 화면 테마: [기본 스타일] 탭에서 다크를 고르면 바로 적용·저장되고, 시스템으로 되돌릴 수 있음
    await popup.click('#tab-style');
    await popup.click('#theme-dark');
    const themeState = await poll(() => popup.evaluate(async () => {
      const { uiSettings } = await chrome.storage.local.get(['uiSettings']);
      return document.documentElement.dataset.theme === 'dark' && uiSettings && uiSettings.theme === 'dark'
        ? getComputedStyle(document.body).backgroundColor : null;
    }), 5000);
    record('화면 테마 다크 적용·저장', themeState === 'rgb(15, 15, 17)', String(themeState));
    await popup.click('#theme-system');

    // [다른 폰트 직접 입력…]: 파이어폭스에는 설치 폰트 목록(queryLocalFonts)이 없어 목록 대신 안내가 보이고, 이름으로 저장
    const optionLabel = await popup.evaluate(() => document.querySelector('#badge-font-family option:last-child').textContent);
    await popup.select('#badge-font-family', 'custom:');
    await popup.waitForSelector('#font-name-input', { visible: true });
    const fontDialog = await popup.evaluate(() => ({
      list: document.getElementById('font-list-area').hidden,
      note: document.getElementById('font-browser-note').hidden
    }));
    await popup.type('#font-name-input', 'Banmo Firefox Font');
    await popup.click('#font-ok-btn');
    const customFont = await poll(() => popup.evaluate(async () => {
      const { badgeSettings } = await chrome.storage.local.get(['badgeSettings']);
      return badgeSettings && badgeSettings.fontFamily !== 'system' ? badgeSettings.fontFamily : null;
    }), 5000);
    record('[다른 폰트 직접 입력…] 설치 폰트 목록 없이 이름으로 저장', optionLabel === '다른 폰트 직접 입력…' && fontDialog.list === true &&
      fontDialog.note === false && customFont === "'Banmo Firefox Font', sans-serif", JSON.stringify({ optionLabel, fontDialog, customFont }));
    await popup.evaluate(() => chrome.storage.local.remove('badgeSettings'));
    await popup.click('#tab-lists');
    const granted = await popup.evaluate(() => chrome.permissions.contains({ origins: chrome.runtime.getManifest().host_permissions }));
    console.log(`INFO  x.com 접근 권한 기본값(임시 설치): ${granted ? '허용됨' : '꺼짐'} / 권한 안내 배너: ${popupState.permissionBanner}`);
    record('권한 상태와 안내 배너 일치', (granted && popupState.permissionBanner === 'none') || (!granted && popupState.permissionBanner === 'block'));

    if (!granted) {
      console.log('INFO  권한이 꺼져 있어 content script 가 동작하지 않습니다. --grant 로 다시 실행해 나머지 기능을 확인하세요.');
      return;
    }

    // 2. 저장소 (chrome.* 이름공간의 Promise)
    await popup.evaluate(() => chrome.storage.local.set({
      lists: {
        '친구': { color: '#ff0000', mode: 'highlight', members: ['@alice'], style: { fontSize: 16 } },
        '동료': { color: '#00aa00', mode: 'normal', members: ['@bob'], style: { fontFamily: "'Banmo Firefox Font', sans-serif" } }
      }
    }));
    const stored = await popup.evaluate(() => chrome.storage.local.get(['lists']));
    record('chrome.storage (Promise 방식) 저장·읽기', !!(stored.lists && stored.lists['친구']));

    // 3. 타임라인 배지 (content script)
    const timeline = await browser.newPage();
    watch(timeline, 'x.com/home');
    await timeline.goto(`${X}/home`);
    const badge = await poll(() => timeline.evaluate(() => {
      const b = document.querySelector('[data-fixture-id="t-alice"] .ag-list-badge');
      if (!b) return null;
      const article = document.querySelector('[data-fixture-id="t-alice"]');
      const mini = document.querySelector('[data-fixture-id="quote-card"] .ag-list-badge.mini-badge');
      const bob = document.querySelector('[data-fixture-id="t-bob"] .ag-list-badge');
      return { text: b.textContent, size: getComputedStyle(b).fontSize, border: getComputedStyle(article).borderLeftWidth,
        mini: mini && getComputedStyle(mini).fontSize, bob: bob && bob.textContent, bobFont: bob && getComputedStyle(bob).fontFamily };
    }));
    record('타임라인 배지 표시', !!badge && badge.text === '친구' && badge.bob === '동료', JSON.stringify(badge));
    record('리스트별 글자 크기 16px, 인용 미니 배지 14px', !!badge && badge.size === '16px' && badge.mini === '14px');
    record('직접 입력한 폰트를 리스트 배지에 적용', !!badge && /^"?Banmo Firefox Font"?, sans-serif$/.test(badge.bobFont || ''), String(badge && badge.bobFont));
    record('강조 모드 왼쪽 테두리', !!badge && badge.border === '4px');

    // 3-1. 팝업 [설정] 창: ▲ 로 배지 순서를 바꾸고 표시 설정(보일 배지 수 1개 · 인용 배지 끔)을 고르면 타임라인에 반영
    await popup.evaluate(() => chrome.storage.local.set({
      lists: {
        '친구': { color: '#ff0000', mode: 'highlight', members: ['@alice'], style: { fontSize: 16 } },
        '동료': { color: '#00aa00', mode: 'normal', members: ['@bob'] },
        '가': { color: '#c8174d', mode: 'normal', members: ['@alice'] },
        '나': { color: '#0b74c4', mode: 'normal', members: ['@alice'] }
      }
    }));
    const priorityRows = () => popup.evaluate(() => [...document.querySelectorAll('#priority-list .priority-name')].map(e => e.textContent).join(','));
    await poll(() => popup.evaluate(() => document.querySelectorAll('.list-card').length === 4 || null));
    await popup.click('#settings-btn');
    let order = await poll(async () => ((await priorityRows()) === '가,나,동료,친구' ? 'ok' : null));
    // '친구'(이름순 맨 뒤)를 ▲ 세 번으로 맨 앞까지
    for (const [index, expected] of [[3, '가,나,친구,동료'], [2, '가,친구,나,동료'], [1, '친구,가,나,동료']]) {
      if (!order) break;
      await popup.click(`#priority-up-${index}`);
      order = await poll(async () => ((await priorityRows()) === expected ? expected : null));
    }
    const storedOrder = await popup.evaluate(async () => {
      const { lists } = await chrome.storage.local.get(['lists']);
      return Object.keys(lists).sort((a, b) => lists[a].priority - lists[b].priority).join(',');
    });
    record('설정 창: ▲ 로 배지 순서를 바꾸면 저장됨', order === '친구,가,나,동료' && storedOrder === '친구,가,나,동료', `${order} / 저장: ${storedOrder}`);

    await popup.select('#display-max-badges', '1');
    await popup.click('#display-quote-badges');
    const display = await poll(() => timeline.evaluate(() => {
      const alice = document.querySelector('[data-fixture-id="t-alice"]');
      const names = [...alice.querySelectorAll('.ag-list-badge')].map(b => b.textContent);
      const more = alice.querySelector('.ag-badge-more');
      const quoteBadges = document.querySelectorAll('[data-fixture-id="quote-card"] .ag-badges-wrapper').length;
      return names.join(',') === '친구' && more && more.textContent === '+2' && quoteBadges === 0
        ? { names, more: more.textContent, quoteBadges } : null;
    }));
    record('타임라인: 배지 순서 · 보일 배지 수(1개 + "+2") · 인용 배지 끔 반영', !!display, JSON.stringify(display));
    await popup.click('#settings-close-btn');
    await popup.evaluate(() => chrome.storage.local.remove('displaySettings'));

    // 4. 멤버 자동 수집 → background(이벤트 페이지, shared/*.js 를 scripts 로 로드) 저장
    const members = await browser.newPage();
    watch(members, 'x.com/members');
    await members.goto(`${X}/i/lists/123/members`);
    const saved = await poll(() => popup.evaluate(async () => {
      const { lists } = await chrome.storage.local.get(['lists']);
      const entry = Object.entries(lists || {}).find(([, v]) => v.listId === '123');
      return entry ? { name: entry[0], members: entry[1].members } : null;
    }));
    record('멤버 자동 수집 → background 저장', !!saved && saved.members.join(',') === '@alice,@bob,@dave_dev', JSON.stringify(saved));

    // 4-1. X 리스트에서 뺀 멤버 자동 정리: 멤버 목록 전체가 보이는 화면이므로, X 리스트에 없는 저장 멤버는 지워져야 함
    await popup.evaluate(async () => {
      const { lists } = await chrome.storage.local.get(['lists']);
      Object.values(lists).find(v => v.listId === '123').members.push('@gone_user');
      await chrome.storage.local.set({ lists });
    });
    const pruned = await poll(() => popup.evaluate(async () => {
      const { lists } = await chrome.storage.local.get(['lists']);
      const entry = Object.values(lists || {}).find(v => v.listId === '123');
      return entry && entry.members.indexOf('@gone_user') === -1 ? entry.members : null;
    }));
    record('X 리스트에서 뺀 멤버 자동 정리', Array.isArray(pruned) && pruned.join(',') === '@alice,@bob,@dave_dev', JSON.stringify(pruned));

    // 5. 새 탭 화면에서 [가져오기] (열 때 보던 X 탭 대상)
    const tabs = await popup.evaluate(() => chrome.tabs.query({}).then(ts => ts.map(t => ({ id: t.id, url: t.url }))));
    const membersTab = tabs.find(t => (t.url || '').includes('/i/lists/123/members'));
    record('확장 프로그램이 x.com 탭 주소를 볼 수 있음', !!membersTab, JSON.stringify(tabs.map(t => t.url)));
    if (membersTab) {
      const view = await openExtensionPage(`${BASE}/popup.html?view=tab&targetTab=${membersTab.id}`);
      watch(view, 'tab-view');
      await view.waitForSelector('#sync-current-tab-btn');
      await sleep(500);
      await view.click('#sync-current-tab-btn');
      const status = await poll(async () => {
        const t = await view.$eval('#sync-status', el => el.textContent);
        return t && !t.includes('수집 중') ? t : null;
      });
      record('새 탭 화면 [가져오기] → X 탭 content script 응답', String(status).includes('총 3명'), status);

      const preview = await view.evaluate(id => chrome.tabs.sendMessage(id, { action: 'replacePreview' }), membersTab.id);
      record('교체 동기화 미리보기 메시지', !!preview && preview.success === true, JSON.stringify(preview).slice(0, 120));

      // 6. 새 탭 화면에서 백업 가져오기 (파일 선택)
      const backupPath = path.join(os.tmpdir(), 'banmo_tag-firefox-backup.json');
      fs.writeFileSync(backupPath, JSON.stringify({ app: 'banmo_tag', lists: { '가져온 리스트': { members: ['@imp'] } } }));
      // 자동화 프로토콜이 이 탭에서 파일 첨부(input.setFiles)를 지원하지 않으므로,
      // 파일 선택 창 다음 단계(파일 읽기 → 병합/덮어쓰기 선택)를 같은 함수로 직접 실행
      await view.evaluate(text => readBackupFile(new File([text], 'backup.json', { type: 'application/json' })),
        fs.readFileSync(backupPath, 'utf8'));
      await view.waitForFunction(() => getComputedStyle(document.getElementById('import-choice')).display === 'flex', { timeout: 5000 }).catch(() => {});
      await view.click('#import-merge-btn');
      const imported = await poll(() => view.evaluate(async () => {
        const { lists } = await chrome.storage.local.get(['lists']);
        return lists && lists['가져온 리스트'] ? lists['가져온 리스트'].members : null;
      }));
      record('새 탭 화면에서 백업 가져오기(병합)', Array.isArray(imported) && imported[0] === '@imp', JSON.stringify(imported));
    }

    // 7. 화면 구조 변화 경고 (팝업 탭이 아래 8번에서 닫히므로 먼저 확인)
    const changed = await browser.newPage();
    await changed.goto(`${X}/i/lists/999/members`);
    const health = await poll(() => popup.evaluate(async () => {
      const { structureHealth } = await chrome.storage.local.get(['structureHealth']);
      return structureHealth && structureHealth.members && structureHealth.members.ok === false ? structureHealth.members.message : null;
    }), 12000);
    record('X 화면 구조 변화 감지·기록', typeof health === 'string', String(health));
    // 팝업은 저장 데이터 변경을 실시간으로 받아 경고를 다시 그림 (새로고침 불필요)
    const banner = await poll(() => popup.$eval('#health-warning', el =>
      getComputedStyle(el).display === 'block' ? el.textContent.slice(0, 40) : null), 5000);
    record('팝업에 구조 변화 경고가 바로 표시됨', typeof banner === 'string', String(banner));

    // 8. 팝업 ⋯ 메뉴의 [백업 파일 가져오기] → 새 탭 화면으로 (파이어폭스 우회). 탭 주소는 파이어폭스 자체 목록(getTree)으로 확인
    const contextUrls = async () => (await browser.connection.send('browsingContext.getTree', {})).result.contexts.map(c => c.url);
    const beforeUrls = await contextUrls();
    await popup.click('#menu-btn');
    await popup.waitForSelector('#import-btn', { visible: true });
    await popup.click('#import-btn');
    const opened = await poll(async () => {
      const urls = await contextUrls();
      const added = urls.find(u => u.includes('view=tab') && !beforeUrls.includes(u));
      return added || null;
    }, 5000);
    record('팝업 [백업 파일 가져오기] → 파일 선택 창 대신 새 탭 화면이 열림', String(opened).includes('view=tab'), String(opened));
    const popupClosed = !(await contextUrls()).includes(`${BASE}/popup.html`);
    record('새 탭을 연 뒤 팝업은 닫힘', popupClosed);
  } catch (e) {
    record('스크립트 실행', false, e.stack);
  } finally {
    record('페이지 스크립트 오류 없음', errors.length === 0, errors.slice(0, 5).join(' | '));
    await browser.close().catch(() => {});
    server.close();
    const failed = results.filter(r => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} 통과`);
    process.exitCode = failed ? 1 : 0;
  }
})();
