// scripts/bump-version.js — 새 버전 준비 (릴리스하기로 했을 때만 실행)
// 사용법: npm run bump -- 1.7.0
//
// 다음을 한 번에 바꿉니다 (버전 불일치로 CI 가 실패하는 실수 방지):
//   - extension/manifest.json 의 "version"
//   - docs/CHANGELOG.md: [Unreleased] 항목을 새 버전 항목으로 바꾸고, 빈 [Unreleased] 항목을 새로 둠
//     ([Unreleased] 가 없거나 비어 있으면 빈 틀을 만듦)
//   - README.md 의 "현재 버전"
//   - tests/test-runner.html 제목의 버전
// 모든 변경 내용을 먼저 계산한 뒤 마지막에 한꺼번에 저장하므로, 중간에 실패해도 파일이 반쯤 바뀌지 않습니다.
// 이 스크립트는 GitHub Release 를 만들지 않습니다. 릴리스는 GitHub 에서 직접 만듭니다 (README "릴리스 (수동)").
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = rel => path.join(root, rel);
const read = rel => fs.readFileSync(file(rel), 'utf8');
const write = (rel, text) => fs.writeFileSync(file(rel), text, 'utf8');

const UNRELEASED_NOTE = '> 아직 릴리스하지 않은 변경 사항입니다. 새 버전을 릴리스할 때 `npm run bump -- X.Y.Z` 를 실행하면 이 항목이 그 버전의 내용이 됩니다.';
const EMPTY_VERSION_BODY = [
  '### 🚀 Added (새로운 기능)',
  '- ',
  '',
  '### 🛠️ Changed (변경 및 개선)',
  '- ',
  '',
  '### 🐛 Fixed (버그 수정)',
  '- '
].join('\n');

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

// 로컬 날짜 (toISOString 은 UTC 라 한국 시간 오전에는 전날 날짜가 됨)
function localDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

// CHANGELOG: [Unreleased] → [vX.Y.Z] - 날짜, 그 위에 빈 [Unreleased]
function bumpChangelog(changelog, version) {
  if (changelog.includes(`## [v${version}]`)) fail(`CHANGELOG.md 에 이미 v${version} 항목이 있습니다.`);
  const firstVersion = changelog.search(/^## \[v\d+\.\d+\.\d+\]/m);
  if (firstVersion === -1) fail('CHANGELOG.md 에서 기존 버전 항목을 찾을 수 없습니다.');

  const unreleasedStart = changelog.search(/^## \[Unreleased\]/m);
  const hasUnreleased = unreleasedStart !== -1 && unreleasedStart < firstVersion;
  const head = changelog.slice(0, hasUnreleased ? unreleasedStart : firstVersion);
  const rest = changelog.slice(firstVersion);

  let body = '';
  if (hasUnreleased) {
    body = changelog.slice(unreleasedStart, firstVersion)
      .replace(/^## \[Unreleased\][^\n]*\n/, '') // 제목
      .replace(/^>.*$/gm, '')                    // 안내 문구
      .replace(/\n*---\s*$/, '')                 // 구분선
      .trim();
  }
  const versionSection = `## [v${version}] - ${localDate()}\n\n${body || EMPTY_VERSION_BODY}\n\n---\n\n`;
  const freshUnreleased = `## [Unreleased]\n\n${UNRELEASED_NOTE}\n\n---\n\n`;
  return { text: head + freshUnreleased + versionSection + rest, movedUnreleased: !!body };
}

const next = (process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(next)) fail('새 버전을 X.Y.Z 형식으로 입력하세요. 예: npm run bump -- 1.7.0');

const manifestText = read('extension/manifest.json');
const current = JSON.parse(manifestText).version;
if (compare(next, current) <= 0) fail(`새 버전(${next})은 현재 버전(${current})보다 커야 합니다.`);

const changes = {
  'extension/manifest.json': manifestText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`),
  'README.md': read('README.md').replace(/(현재 버전: \*\*v)\d+\.\d+\.\d+(\*\*)/, `$1${next}$2`),
  'tests/test-runner.html': read('tests/test-runner.html').replace(/(banmo_tag v)\d+\.\d+\.\d+( 자동화 테스트 러너)/, `$1${next}$2`)
};
const changelog = bumpChangelog(read('docs/CHANGELOG.md'), next);
changes['docs/CHANGELOG.md'] = changelog.text;

Object.keys(changes).forEach(rel => write(rel, changes[rel]));

console.log(`[bump] v${current} → v${next}`);
console.log(changelog.movedUnreleased
  ? '[bump] CHANGELOG 의 [Unreleased] 내용을 v' + next + ' 항목으로 옮겼습니다. 내용을 확인한 뒤 커밋하세요.'
  : '[bump] CHANGELOG 에 v' + next + ' 빈 항목을 만들었습니다. 변경 내용을 채운 뒤 커밋하세요.');
console.log('[bump] 배포 zip: powershell -ExecutionPolicy Bypass -File scripts\\build.ps1 → dist/banmo_tag-v' + next + '.zip');
console.log('[bump] 릴리스는 GitHub 에서 직접 만드세요 (태그 v' + next + ', zip 첨부). CI 는 릴리스를 만들지 않습니다.');
