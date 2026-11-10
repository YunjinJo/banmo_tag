// tests/firefox/live-bridge.js — 화면에 보이는 실제 Firefox 로 실제 x.com 에서 banmo_tag 를 확인하는 조작 도구
//
//   npm run firefox:login   테스트 프로필을 자동화 없이 열어 x.com 에 직접 로그인 (로그인 후 창을 닫음)
//   npm run firefox:live    같은 프로필로 Firefox 를 자동화 모드로 열고 extension/ 을 임시 설치한 뒤,
//                           127.0.0.1 에서 명령을 기다림 (창을 닫으면 종료)
//   npm run firefox:run -- <스크립트.js>   명령 보내기 (tests/firefox/live.js 참고)
//
// - 자동화 모드 창에서는 X 가 로그인을 막으므로, 로그인은 --login 으로 자동화 없이 한 번 해 둡니다.
//   로그인 정보는 테스트 프로필(기본 %LOCALAPPDATA%\banmo_tag-test\ff-live-profile)에 남습니다. 평소 쓰는 Firefox 프로필과 별개입니다.
// - Firefox 는 뒤쪽(숨겨진) 탭의 타이머를 크게 늦추므로, x.com 탭은 항상 앞에 두고 확인합니다 (도우미 x(), front()).
// - 명령은 이 PC 안(127.0.0.1)에서만, 실행할 때마다 새로 만드는 토큰이 있어야 받습니다. 토큰은 임시 폴더의 상태 파일에 있습니다.
// - Firefox 위치: FIREFOX_BIN, 없으면 Windows 기본 설치 경로. 프로필 위치: FIREFOX_LIVE_PROFILE.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

// 파이어폭스용 manifest 를 합친 폴더 (dist/firefox/) 를 새로 만들어 설치
const EXT_DIR = require('../../scripts/build-firefox').buildFirefox();
const EXT_ID = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')).browser_specific_settings.gecko.id;
const PROFILE = process.env.FIREFOX_LIVE_PROFILE ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'banmo_tag-test', 'ff-live-profile');
const STATE_FILE = path.join(os.tmpdir(), 'banmo_tag-firefox-live.json');
const SHOT_DIR = path.join(os.tmpdir(), 'banmo_tag-firefox-live-shots');

function findFirefox() {
  const candidates = [
    process.env.FIREFOX_BIN,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Mozilla Firefox', 'firefox.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Mozilla Firefox', 'firefox.exe'),
    '/usr/bin/firefox',
    '/Applications/Firefox.app/Contents/MacOS/firefox'
  ].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) {
    console.error('Firefox 를 찾을 수 없습니다. FIREFOX_BIN 환경 변수에 firefox 실행 파일 경로를 지정하세요.');
    process.exit(2);
  }
  return found;
}

// 로그인 모드: 자동화 없이 테스트 프로필로 x.com 로그인 화면을 열고, 창이 닫힐 때까지 기다림
function runLogin(firefox) {
  fs.mkdirSync(PROFILE, { recursive: true });
  console.log(`테스트 프로필로 Firefox 를 엽니다: ${PROFILE}`);
  console.log('x.com 에 로그인한 뒤 그 Firefox 창을 닫으세요. 그다음 npm run firefox:live');
  const child = spawn(firefox, ['-no-remote', '-profile', PROFILE, 'https://x.com/i/flow/login'], { stdio: 'ignore' });
  child.on('exit', () => console.log('Firefox 가 닫혔습니다.'));
}

async function runLive(firefox) {
  const puppeteer = require('puppeteer-core');
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: firefox,
    headless: false,
    userDataDir: PROFILE,
    defaultViewport: null,
    // 확장 프로그램 페이지(moz-extension://)는 자동화 프로토콜로 바로 열 수 없어서,
    // 브라우저 내부 창에서 사용자가 여는 것처럼 새 탭을 엶 (tests/firefox/firefox-check.js 와 같은 방식)
    args: ['--remote-allow-system-access'],
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    extraPrefsFirefox: { 'extensions.originControls.grantByDefault': true }
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const conn = browser.connection;

  async function chromeEval(expression) {
    const tree = await conn.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
    const res = await conn.send('script.evaluate', {
      expression, target: { context: tree.result.contexts[0].context }, awaitPromise: false
    });
    return res.result.result && res.result.result.value;
  }

  // 확장 프로그램 주소 (설치할 때마다 바뀔 수 있어 매번 물어봄)
  async function extUrl(p = 'popup.html') {
    const host = await chromeEval(`WebExtensionPolicy.getByID(${JSON.stringify(EXT_ID)}).mozExtensionHostname`);
    return `moz-extension://${host}/${p.replace(/^\//, '')}`;
  }

  async function openExtensionPage(p = 'popup.html') {
    const url = await extUrl(p);
    await chromeEval(`gBrowser.selectedTab = gBrowser.addTab(${JSON.stringify(url)}, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() }); true`);
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      for (const pg of await browser.pages()) {
        if ((await pg.evaluate(() => location.href).catch(() => '')) === url) {
          await pg.waitForFunction(() => document.readyState === 'complete');
          return pg;
        }
      }
      await sleep(300);
    }
    throw new Error('확장 프로그램 페이지를 찾지 못함: ' + url);
  }

  // extension/ 을 다시 설치 (같은 ID 로 덮어써서 저장된 리스트는 유지). 코드 수정 후 사용
  async function reloadExtension() {
    return browser.installExtension(EXT_DIR);
  }
  let page = (await browser.pages())[0] || await browser.newPage();
  // 탭을 닫은 직후 등에는 bringToFront 뒤에도 잠시 hidden 이므로 실제로 보일 때까지 기다림
  async function front() {
    await page.bringToFront();
    const end = Date.now() + 3000;
    while (Date.now() < end) {
      if (await page.evaluate(() => document.visibilityState === 'visible').catch(() => false)) break;
      await sleep(100);
    }
    return page;
  }
  // x.com 탭을 앞으로 가져와 이동. 경로('/home') 또는 전체 주소
  async function x(target = '/home') {
    await front();
    await page.goto(target.startsWith('http') ? target : 'https://x.com' + target, { waitUntil: 'domcontentloaded' });
    return page;
  }
  async function shot(pg = page, name = 'page') {
    const file = path.join(SHOT_DIR, `${Date.now()}-${name.replace(/[^\w-]/g, '_')}.png`);
    await pg.screenshot({ path: file });
    return file;
  }
  // 첫 트윗(또는 모든 트윗)의 배지 글자. 배지가 붙을 때까지 최대 timeoutMs 기다림
  async function badges({ all = false, timeoutMs = 15000 } = {}) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const n = await page.evaluate(() => document.querySelectorAll('article[data-testid="tweet"] .ag-list-badge').length).catch(() => 0);
      if (n) break;
      await sleep(250);
    }
    return page.evaluate((everyTweet) => {
      const tweets = [...document.querySelectorAll('article[data-testid="tweet"]')];
      const read = t => [...t.querySelectorAll('.ag-list-badge, .ag-badge-more')].map(b => b.textContent);
      return everyTweet ? tweets.map(read) : (tweets[0] ? read(tweets[0]) : null);
    }, all);
  }
  // 확장 프로그램 저장 공간 읽기
  async function storage(keys = null) {
    const pg = await openExtensionPage('popup.html');
    try {
      return await pg.evaluate(k => browser.storage.local.get(k), keys);
    } finally {
      await pg.close();
      await front();
    }
  }

  const installedId = await reloadExtension();
  await x('/home');

  const helpers = { browser, sleep, extUrl, openExtensionPage, reloadExtension, front, x, shot, badges, storage, chromeEval };
  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      const send = obj => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj, null, 2)); };
      if (req.method !== 'POST' || req.headers['x-token'] !== token) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        // 받은 코드: async 함수 본문(-e), 또는 module.exports = async (도우미) => {...} 형식의 스크립트 파일.
        // page 는 항상 x.com 탭
        const mod = { exports: null };
        const run = new Function('h', 'page', 'module', `return (async ({ ${Object.keys(helpers).join(', ')} }) => { ${body}\n })(h);`);
        let result = await run(helpers, page, mod);
        if (result === undefined && typeof mod.exports === 'function') result = await mod.exports({ ...helpers, page });
        send({ ok: true, result });
      } catch (e) {
        send({ ok: false, error: String((e && e.stack) || e) });
      }
    });
  });
  server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ port: server.address().port, token, pid: process.pid }));
    console.log(`ready: Firefox ${installedId} 설치됨, 명령 대기 중 (127.0.0.1:${server.address().port})`);
    console.log(`프로필: ${PROFILE}`);
  });

  const cleanup = () => { try { fs.unlinkSync(STATE_FILE); } catch { /* 이미 없음 */ } };
  browser.on('disconnected', () => {
    cleanup();
    console.log('Firefox 가 닫혀 종료합니다.');
    process.exit(0);
  });
  process.on('SIGINT', async () => {
    cleanup();
    await browser.close().catch(() => {});
    process.exit(0);
  });
}

const firefox = findFirefox();
if (process.argv.includes('--login')) runLogin(firefox);
else runLive(firefox).catch((e) => { console.error(e); process.exit(1); });
