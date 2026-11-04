// scripts/bump-version.js — 새 버전 준비
// 사용법: npm run bump -- 1.5.0
//
// 다음을 한 번에 바꿉니다 (버전 불일치로 CI 가 실패하는 실수 방지):
//   - extension/manifest.json 의 "version"
//   - docs/CHANGELOG.md 맨 위에 새 버전 항목(빈 틀) 추가
//   - README.md 의 "현재 버전"
//   - tests/test-runner.html 제목의 버전
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = rel => path.join(root, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8');
const write = (rel, text) => fs.writeFileSync(file(rel), text, 'utf8');

function fail(msg) {
  console.error(`[bump] ${msg}`);
  process.exit(1);
}

function compare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

const next = (process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(next)) fail('새 버전을 X.Y.Z 형식으로 입력하세요. 예: npm run bump -- 1.5.0');

// 1. manifest.json (형식을 유지하도록 문자열 치환)
const manifestText = read('extension/manifest.json');
const current = JSON.parse(manifestText).version;
if (compare(next, current) <= 0) fail(`새 버전(${next})은 현재 버전(${current})보다 커야 합니다.`);
write('extension/manifest.json', manifestText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));

// 2. CHANGELOG.md: 첫 번째 버전 항목 앞에 새 항목 틀 추가
const changelog = read('docs/CHANGELOG.md');
if (changelog.includes(`## [v${next}]`)) fail(`CHANGELOG.md 에 이미 v${next} 항목이 있습니다.`);
const firstEntry = changelog.search(/^## \[v\d+\.\d+\.\d+\]/m);
if (firstEntry === -1) fail('CHANGELOG.md 에서 기존 버전 항목을 찾을 수 없습니다.');
// 로컬 날짜 (toISOString 은 UTC 라 한국 시간 오전에는 전날 날짜가 됨)
const now = new Date();
const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
const template = [
  `## [v${next}] - ${today}`,
  '',
  '### 🚀 Added (새로운 기능)',
  '- ',
  '',
  '### 🛠️ Changed (변경 및 개선)',
  '- ',
  '',
  '### 🐛 Fixed (버그 수정)',
  '- ',
  '',
  '---',
  '',
  ''
].join('\n');
write('docs/CHANGELOG.md', changelog.slice(0, firstEntry) + template + changelog.slice(firstEntry));

// 3. README.md "현재 버전"
const readme = read('README.md');
write('README.md', readme.replace(/(현재 버전: \*\*v)\d+\.\d+\.\d+(\*\*)/, `$1${next}$2`));

// 4. 테스트 러너 제목
const runner = read('tests/test-runner.html');
write('tests/test-runner.html', runner.replace(/(banmo_tag v)\d+\.\d+\.\d+( 자동화 테스트 러너)/, `$1${next}$2`));

console.log(`[bump] v${current} → v${next}`);
console.log('[bump] docs/CHANGELOG.md 의 새 항목에 변경 내용을 채운 뒤 커밋하세요.');
console.log('[bump] main 에 push 하면 CI 가 검사·테스트 후 GitHub Release v' + next + ' 을 만듭니다.');
