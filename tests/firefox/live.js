// tests/firefox/live.js — live-bridge.js(npm run firefox:live)로 띄운 Firefox 에 명령 보내기
//
//   npm run firefox:run -- tests/firefox/live-example.js
//   npm run firefox:run -- -e "await x('/home'); return await badges({ all: true });"
//
// 스크립트 파일은 module.exports = async ({ page, x, badges, ... }) => { ... } 형식(live-example.js 참고),
// -e 코드는 async 함수 본문입니다. 돌려준 값이 JSON 으로 출력됩니다. 쓸 수 있는 도우미:
//   page                     x.com 탭 (Puppeteer Page)
//   x(path)                  x.com 탭을 앞으로 가져와 이동 ('/home', '/i/lists/<ID>/members' 등)
//   front()                  x.com 탭을 앞으로 (Firefox 는 뒤쪽 탭의 타이머를 늦추므로 확인 전에 항상 앞으로)
//   badges({ all })          첫 트윗(all: 모든 트윗)의 배지 글자, 배지가 붙을 때까지 잠시 기다림
//   storage(keys)            확장 프로그램 저장 공간(chrome.storage.local) 읽기
//   openExtensionPage(p)     확장 프로그램 페이지(popup.html 등)를 새 탭으로 열어 Page 로 돌려줌 (다 쓰면 close() 후 front())
//   reloadExtension()        extension/ 을 다시 설치 (코드 수정 반영, 저장 데이터는 유지)
//   shot(pg, name)           스크린샷 저장 후 파일 경로
//   sleep(ms), browser, extUrl(p), chromeEval(expr)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const STATE_FILE = path.join(os.tmpdir(), 'banmo_tag-firefox-live.json');
if (!fs.existsSync(STATE_FILE)) {
  console.error('실행 중인 Firefox 조작 도구가 없습니다. 먼저 npm run firefox:live 를 실행하세요.');
  process.exit(2);
}
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('사용법: npm run firefox:run -- <스크립트.js>  또는  npm run firefox:run -- -e "<코드>"');
  process.exit(2);
}
const code = args[0] === '-e' ? args.slice(1).join(' ') : fs.readFileSync(args[0], 'utf8');
const { port, token } = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));

const req = http.request({ host: '127.0.0.1', port, method: 'POST', headers: { 'x-token': token } }, (res) => {
  let out = '';
  res.setEncoding('utf8');
  res.on('data', c => { out += c; });
  res.on('end', () => {
    console.log(out);
    try { process.exitCode = JSON.parse(out).ok ? 0 : 1; } catch { process.exitCode = 1; }
  });
});
req.on('error', (e) => {
  console.error('Firefox 조작 도구에 연결하지 못했습니다 (' + e.message + '). npm run firefox:live 가 실행 중인지 확인하세요.');
  process.exitCode = 2;
});
req.end(code);
