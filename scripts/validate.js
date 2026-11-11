// scripts/validate.js
// 확장 프로그램 정적 검사 (CI 에서 실행, 로컬에서는 `node scripts/validate.js`).
// 외부 패키지 없이 Node.js 기본 모듈만 사용합니다.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const extDir = path.join(root, 'extension');
const errors = [];
const passed = [];

function check(name, fn) {
  const before = errors.length;
  try {
    fn();
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
  }
  if (errors.length === before) passed.push(name);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// HTML 이 <script src="…"> 로 불러오는 파일 목록 (적힌 순서대로)
function scriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
}

// 폴더 안의 .js 파일 이름 목록
function jsFilesIn(rel) {
  return fs.readdirSync(path.join(root, rel)).filter(f => f.endsWith('.js'));
}

let manifest = null;

// 1. manifest.json 형식
check('manifest.json 형식', () => {
  manifest = JSON.parse(read('extension/manifest.json'));
  if (manifest.manifest_version !== 3) errors.push('manifest_version 은 3 이어야 합니다.');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) errors.push(`version 형식이 잘못됨: ${manifest.version}`);
  if (!manifest.name) errors.push('name 이 비어 있습니다.');
});

// 2. manifest 가 가리키는 파일이 모두 존재하는지
check('manifest 참조 파일 존재', () => {
  if (!manifest) return;
  const refs = new Set();
  Object.values(manifest.icons || {}).forEach(p => refs.add(p));
  const action = manifest.action || {};
  Object.values(action.default_icon || {}).forEach(p => refs.add(p));
  if (action.default_popup) refs.add(action.default_popup);
  if (manifest.background && manifest.background.service_worker) refs.add(manifest.background.service_worker);
  ((manifest.background && manifest.background.scripts) || []).forEach(p => refs.add(p));
  (manifest.content_scripts || []).forEach(cs => {
    (cs.js || []).forEach(p => refs.add(p));
    (cs.css || []).forEach(p => refs.add(p));
  });
  refs.forEach(p => {
    if (!fs.existsSync(path.join(extDir, p))) errors.push(`manifest 가 참조하는 파일이 없음: extension/${p}`);
  });
});

// 2-1. 크롬 manifest 와 파이어폭스 manifest (scripts/build-firefox.js 가 합쳐서 만듦)
//   - 크롬(extension/manifest.json): background.service_worker 만. background.scripts 가 있으면 크롬이
//     "'background.scripts' requires manifest version of 2 or lower." 오류를 냄. 파이어폭스 전용 키도 넣지 않음
//   - 파이어폭스(extension/manifest.firefox.json 을 합친 것): background.scripts(이벤트 페이지).
//     이벤트 페이지에는 importScripts 가 없으므로 shared/*.js 가 background.js 보다 먼저 와야 함 (목록·순서는 2-2 에서 확인)
//   - 파이어폭스 MV3 서명에는 확장 프로그램 ID 와 데이터 수집 신고(data_collection_permissions)가 필요
check('크롬 manifest · 파이어폭스 manifest', () => {
  if (!manifest) return;
  const bg = manifest.background || {};
  if (!bg.service_worker) errors.push('extension/manifest.json 에 background.service_worker 가 없습니다 (크롬).');
  if (bg.scripts) errors.push('extension/manifest.json 에 background.scripts 가 있습니다. 크롬 MV3 에서 오류가 나므로 extension/manifest.firefox.json 에만 적으세요.');
  if (manifest.browser_specific_settings) errors.push('extension/manifest.json 에 browser_specific_settings 가 있습니다. 파이어폭스 전용 항목은 extension/manifest.firefox.json 에 적으세요.');

  const { buildFirefoxManifest } = require('./build-firefox');
  const firefox = buildFirefoxManifest(manifest, JSON.parse(read('extension/manifest.firefox.json')));
  const ffBg = firefox.background || {};
  if (ffBg.service_worker) errors.push('파이어폭스 manifest 에 background.service_worker 가 남아 있습니다 (파이어폭스는 지원하지 않음).');
  const scripts = ffBg.scripts || [];
  if (scripts[scripts.length - 1] !== bg.service_worker) {
    errors.push(`파이어폭스 background.scripts 의 마지막은 ${bg.service_worker} 여야 합니다 (extension/manifest.firefox.json).`);
  }
  scripts.forEach((p) => {
    if (!fs.existsSync(path.join(extDir, p))) errors.push(`extension/manifest.firefox.json 이 참조하는 파일이 없음: extension/${p}`);
  });
  const gecko = (firefox.browser_specific_settings || {}).gecko || {};
  if (!/^[A-Za-z0-9._-]*@[A-Za-z0-9._-]+$|^\{[0-9a-fA-F-]{36}\}$/.test(gecko.id || '')) {
    errors.push('browser_specific_settings.gecko.id 가 없거나 형식이 잘못됐습니다 (파이어폭스).');
  }
  const dcp = gecko.data_collection_permissions;
  if (!dcp || !Array.isArray(dcp.required) || dcp.required.length === 0) {
    errors.push('browser_specific_settings.gecko.data_collection_permissions.required 가 필요합니다 (파이어폭스 부가 기능 서명).');
  }
});

// 2-2. 공통 코드(extension/shared/*.js)는 일반 스크립트라 "어떤 파일을 어떤 순서로 읽는지"를 읽는 곳마다 적어야 함.
//   기준은 extension/manifest.json 의 content_scripts(shared/*.js → content.js). 나머지 네 곳이 기준과 같은지 확인.
//   (팝업이 content script 를 다시 넣을 때는 manifest 를 그대로 읽으므로 따로 적지 않음: popup/sync.js injectContentScript)
check('공통 코드(shared/) 로드 목록 일치', () => {
  if (!manifest) return;
  const contentJs = ((manifest.content_scripts || [])[0] || {}).js || [];
  const expected = contentJs.filter(p => p.startsWith('shared/'));
  const same = list => list.length === expected.length && list.every((p, i) => p === expected[i]);
  const describeList = list => (list.length ? list.join(', ') : '(없음)');

  if (contentJs[contentJs.length - 1] !== 'content.js' || !same(contentJs.slice(0, -1))) {
    errors.push('extension/manifest.json 의 content_scripts.js 는 shared/*.js 다음에 content.js 가 마지막이어야 합니다.');
  }
  jsFilesIn('extension/shared').forEach((f) => {
    if (!expected.includes('shared/' + f)) errors.push(`extension/shared/${f} 가 extension/manifest.json 의 content_scripts 에 없습니다.`);
  });

  const importScriptsCall = (read('extension/background.js').match(/importScripts\(([^)]*)\)/) || [])[1] || '';
  const places = {
    'extension/manifest.firefox.json 의 background.scripts': (JSON.parse(read('extension/manifest.firefox.json')).background || {}).scripts || [],
    'extension/background.js 의 importScripts': [...importScriptsCall.matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]),
    'extension/popup.html 의 <script>': scriptSources(read('extension/popup.html')),
    'tests/test-runner.html 의 <script>': scriptSources(read('tests/test-runner.html')).map(p => p.replace(/^\.\.\/extension\//, ''))
  };
  Object.keys(places).forEach((place) => {
    const actual = places[place].filter(p => p.startsWith('shared/'));
    if (!same(actual)) {
      errors.push(`${place} 가 manifest.json 의 shared 목록과 다릅니다 (파일·순서).\n기준: ${describeList(expected)}\n실제: ${describeList(actual)}`);
    }
  });
});

// 3. manifest 버전 ↔ CHANGELOG 최신 버전
check('버전 일치 (manifest ↔ CHANGELOG)', () => {
  if (!manifest) return;
  const m = read('docs/CHANGELOG.md').match(/## \[v(\d+\.\d+\.\d+)\]/);
  if (!m) errors.push('docs/CHANGELOG.md 에서 "## [vX.Y.Z]" 항목을 찾을 수 없습니다.');
  else if (m[1] !== manifest.version) errors.push(`manifest.json=${manifest.version}, CHANGELOG.md=${m[1]}`);
});

// 4. popup.html: 참조 스크립트 존재 + MV3 CSP 위반(인라인 스크립트/이벤트 핸들러) 금지
check('popup.html 스크립트·스타일 / CSP', () => {
  const html = read('extension/popup.html');
  const scriptSrcs = scriptSources(html);
  scriptSrcs.forEach((src) => {
    if (!fs.existsSync(path.join(extDir, src))) errors.push(`popup.html 이 참조하는 스크립트가 없음: ${src}`);
  });
  for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)) {
    if (!fs.existsSync(path.join(extDir, m[1]))) errors.push(`popup.html 이 참조하는 파일이 없음: ${m[1]}`);
  }
  // 팝업 코드(popup/*.js)를 추가했는데 popup.html 에 넣지 않으면 그 기능이 동작하지 않음. 시작점인 popup.js 는 맨 마지막
  jsFilesIn('extension/popup').forEach((f) => {
    if (!scriptSrcs.includes('popup/' + f)) errors.push(`extension/popup/${f} 가 popup.html 에서 로드되지 않습니다.`);
  });
  if (scriptSrcs[scriptSrcs.length - 1] !== 'popup.js') errors.push('popup.html 의 마지막 스크립트는 popup.js 여야 합니다 (다른 파일의 기능을 연결하는 시작점).');
  if (/<style\b/i.test(html)) errors.push('popup.html 에 <style> 이 있습니다. 화면 모양은 popup/popup.css 에 적으세요.');
  if (/<script\b(?![^>]*\bsrc=)[^>]*>/.test(html)) errors.push('popup.html 에 인라인 <script> 가 있습니다 (MV3 CSP 에서 차단됨).');
  const handler = html.match(/<[^>]+\son[a-z]+\s*=/i);
  if (handler) errors.push(`popup.html 에 인라인 이벤트 핸들러가 있습니다 (MV3 CSP 에서 차단됨): ${handler[0].slice(0, 60)}`);
});

// 4-1. 테마 깜빡임 방지: theme.js 는 <head> 안에서 다른 스크립트보다 먼저 읽혀야 함
check('popup.html 테마 스크립트 (<head>)', () => {
  const html = read('extension/popup.html');
  const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1] || '';
  const first = head.match(/<script\b[^>]*\bsrc="([^"]+)"/);
  if (!first || first[1] !== 'theme.js') errors.push('popup.html 의 <head> 첫 스크립트가 theme.js 가 아닙니다 (첫 화면 테마 깜빡임).');
});

// 4-2. 흐리게 모드 선택자: shared/badges.js(AG_DIM_TARGET_SELECTOR) 와 styles.css([data-ag-dim="body"]) 가 같은 목록인지
check('흐리게 모드 선택자 일치 (shared/badges.js ↔ styles.css)', () => {
  const pick = s => [...s.matchAll(/\[(data-testid|role)="([^"]+)"\]/g)].map(m => `${m[1]}=${m[2]}`).sort();
  const js = (read('extension/shared/badges.js').match(/var AG_DIM_TARGET_SELECTOR = \[([\s\S]*?)\]\.join/) || [])[1];
  const css = (read('extension/styles.css').match(/\[data-ag-dim="body"\] :is\(([\s\S]*?)\)\s*\{/) || [])[1];
  if (!js || !css) {
    errors.push('AG_DIM_TARGET_SELECTOR 또는 styles.css 의 [data-ag-dim="body"] 규칙을 찾을 수 없습니다.');
    return;
  }
  const a = pick(js).join(', ');
  const b = pick(css).join(', ');
  if (a !== b) errors.push(`선택자 목록이 다릅니다.\nshared/badges.js: ${a}\nstyles.css      : ${b}`);
});

// 5. background.js importScripts 대상 존재
check('background.js importScripts', () => {
  const bg = read('extension/background.js');
  for (const m of bg.matchAll(/importScripts\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/['"]([^'"]+)['"]/g)) {
      if (!fs.existsSync(path.join(extDir, s[1]))) errors.push(`importScripts 대상이 없음: ${s[1]}`);
    }
  }
});

// 6. 확장 프로그램 JS 문법 검사 + 원격 코드/동적 코드 실행 금지 (웹 스토어 정책)
check('JS 문법 / 금지 패턴', () => {
  // extension/ 과 하위 폴더(popup/ 등)의 모든 .js
  const jsFiles = fs.readdirSync(extDir, { recursive: true }).map(f => String(f).split(path.sep).join('/')).filter(f => f.endsWith('.js'));
  for (const f of jsFiles) {
    const full = path.join(extDir, f);
    try {
      execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
    } catch (e) {
      errors.push(`${f} 문법 오류:\n${String(e.stderr || e.message).trim()}`);
    }
    const src = fs.readFileSync(full, 'utf8');
    if (/\beval\s*\(/.test(src)) errors.push(`${f}: eval() 사용 금지`);
    if (/\bnew\s+Function\s*\(/.test(src)) errors.push(`${f}: new Function() 사용 금지`);
    if (/<script[^>]+src=["']https?:/i.test(src) || /\bimportScripts\(\s*['"]https?:/.test(src)) {
      errors.push(`${f}: 원격 스크립트 로드 금지`);
    }
  }
});

// 6-1. content script 파일(shared/*.js, content.js)의 최상위에는 function 과 var 만.
//   팝업이 응답 없는 탭에 이 파일들을 다시 넣는데(popup/sync.js injectContentScript), 같은 공간에서 또 실행되므로
//   최상위 const / let / class 는 "이미 선언됨" 오류가 나서 그 파일 전체가 실행되지 않음.
//   (브라우저가 이 오류를 executeScript 결과로 돌려주지 않아 E2E 로는 잡을 수 없으므로 여기서 확인)
check('content script 최상위 선언 (function · var 만)', () => {
  if (!manifest) return;
  const files = (manifest.content_scripts || []).flatMap(cs => cs.js || []);
  files.forEach((f) => {
    if (!fs.existsSync(path.join(extDir, f))) return; // 없는 파일은 2번 검사가 알림
    read('extension/' + f).split('\n').forEach((line, i) => {
      const m = line.match(/^(const|let|class)\s+([A-Za-z_$][\w$]*)/);
      if (m) errors.push(`${f}:${i + 1} 최상위 ${m[1]} ${m[2]} — 다시 주입될 때 오류가 납니다. function 또는 var 로 바꾸거나 함수 안으로 옮기세요.`);
    });
  });
});

// 7. 단위 테스트: 테스트 러너가 불러오는 파일이 실제로 있는지, tests/unit/ 의 테스트 파일을 빠짐없이 불러오는지,
//    shared/ 의 함수가 "심볼 무결성" 목록(tests/unit/symbols.test.js)에 모두 있는지
check('단위 테스트 파일 (test-runner.html ↔ tests/unit/)', () => {
  const srcs = scriptSources(read('tests/test-runner.html'));
  srcs.forEach((src) => {
    if (!fs.existsSync(path.resolve(root, 'tests', src))) errors.push(`tests/test-runner.html 이 불러오는 파일이 없음: ${src}`);
  });
  jsFilesIn('tests/unit').forEach((f) => {
    if (!srcs.includes('unit/' + f)) errors.push(`tests/unit/${f} 가 tests/test-runner.html 에서 로드되지 않습니다 (테스트가 실행되지 않음).`);
  });

  const symbols = read('tests/unit/symbols.test.js');
  jsFilesIn('extension/shared').forEach((f) => {
    for (const m of read('extension/shared/' + f).matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) {
      if (!new RegExp('\\b' + m[1].replace(/\$/g, '\\$') + '\\b').test(symbols)) {
        errors.push(`shared/${f} 의 ${m[1]} 가 tests/unit/symbols.test.js 목록에 없습니다.`);
      }
    }
  });
});

// 8. 문서에 로컬 절대 경로 링크가 남아 있지 않은지
check('문서 링크 (로컬 절대 경로 금지)', () => {
  const docs = ['README.md', ...fs.readdirSync(path.join(root, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)];
  for (const d of docs) {
    if (/file:\/\/\//i.test(read(d))) errors.push(`${d} 에 file:/// 로컬 경로 링크가 있습니다.`);
  }
});

// 결과 출력 (GitHub Actions 요약에도 기록)
const lines = [];
passed.forEach(n => lines.push(`- ✅ ${n}`));
errors.forEach(e => lines.push(`- ❌ ${e.replace(/\n/g, '\n  ')}`));
console.log(lines.join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 정적 검사\n\n${lines.join('\n')}\n`);
}
if (errors.length > 0) {
  console.error(`\n정적 검사 실패: ${errors.length}건`);
  process.exit(1);
}
console.log(`\n정적 검사 통과 (${passed.length}개 항목)`);
