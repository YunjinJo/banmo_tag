// scripts/build-firefox.js
// 파이어폭스용 확장 프로그램 폴더(dist/firefox/)를 만듭니다. 외부 패키지 없이 Node.js 기본 모듈만 씁니다.
//
//   node scripts/build-firefox.js        (npm run build:firefox)
//
// 왜 따로 만드나:
//   크롬은 MV3 에서 background.service_worker 만 쓰고, background.scripts 가 있으면
//   "'background.scripts' requires manifest version of 2 or lower." 오류를 냅니다(크롬 121 미만과 일부 크롬 계열 브라우저).
//   파이어폭스는 반대로 service_worker 를 지원하지 않아 background.scripts(이벤트 페이지)가 필요합니다.
//   그래서 extension/manifest.json 은 크롬용으로 두고, 파이어폭스 전용 항목은 extension/manifest.firefox.json 에 적어
//   빌드할 때 합칩니다. 코드 파일(.js/.html/.css/아이콘)은 두 브라우저가 똑같이 씁니다.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = path.join(ROOT, 'extension');
const OUT_DIR = path.join(ROOT, 'dist', 'firefox');
const FIREFOX_OVERRIDES = 'manifest.firefox.json';

// 크롬 manifest + 파이어폭스 전용 항목 → 파이어폭스 manifest.
// background 는 통째로 바꿈 (파이어폭스는 service_worker 를 무시하고 경고만 내므로 넣지 않음)
function buildFirefoxManifest(chromeManifest, overrides) {
  const out = { ...chromeManifest };
  Object.keys(overrides).forEach((key) => { out[key] = overrides[key]; });
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach((entry) => {
    if (entry.name === FIREFOX_OVERRIDES || entry.name === 'manifest.json') return;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  });
}

// dist/firefox/ 를 새로 만들고 그 경로를 돌려줌
function buildFirefox() {
  const manifest = buildFirefoxManifest(
    readJson(path.join(EXT_DIR, 'manifest.json')),
    readJson(path.join(EXT_DIR, FIREFOX_OVERRIDES))
  );
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  copyDir(EXT_DIR, OUT_DIR);
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return OUT_DIR;
}

module.exports = { buildFirefox, buildFirefoxManifest, OUT_DIR, FIREFOX_OVERRIDES };

if (require.main === module) {
  const dir = buildFirefox();
  console.log(`파이어폭스용 폴더를 만들었습니다: ${path.relative(ROOT, dir)}`);
  console.log('about:debugging 에서 이 폴더의 manifest.json 을 임시 부가 기능으로 로드하세요.');
}
