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

// 2-1. 크롬·파이어폭스 공용 manifest 설정
//   - 크롬은 background.service_worker, 파이어폭스는 background.scripts(이벤트 페이지)를 씀
//   - 파이어폭스 이벤트 페이지에는 importScripts 가 없으므로 shared.js 가 background.js 보다 먼저 와야 함
//   - 파이어폭스 MV3 서명에는 확장 프로그램 ID 와 데이터 수집 신고(data_collection_permissions)가 필요
check('크롬·파이어폭스 공용 manifest', () => {
  if (!manifest) return;
  const bg = manifest.background || {};
  if (!bg.service_worker) errors.push('background.service_worker 가 없습니다 (크롬).');
  const scripts = bg.scripts || [];
  const sharedIdx = scripts.indexOf('shared.js');
  const bgIdx = scripts.indexOf(bg.service_worker);
  if (sharedIdx === -1 || bgIdx === -1 || sharedIdx > bgIdx) {
    errors.push('background.scripts 는 ["shared.js", "background.js"] 순서여야 합니다 (파이어폭스).');
  }
  const gecko = (manifest.browser_specific_settings || {}).gecko || {};
  if (!/^[A-Za-z0-9._-]*@[A-Za-z0-9._-]+$|^\{[0-9a-fA-F-]{36}\}$/.test(gecko.id || '')) {
    errors.push('browser_specific_settings.gecko.id 가 없거나 형식이 잘못됐습니다 (파이어폭스).');
  }
  const dcp = gecko.data_collection_permissions;
  if (!dcp || !Array.isArray(dcp.required) || dcp.required.length === 0) {
    errors.push('browser_specific_settings.gecko.data_collection_permissions.required 가 필요합니다 (파이어폭스 부가 기능 서명).');
  }
});

// 3. manifest 버전 ↔ CHANGELOG 최신 버전
check('버전 일치 (manifest ↔ CHANGELOG)', () => {
  if (!manifest) return;
  const m = read('docs/CHANGELOG.md').match(/## \[v(\d+\.\d+\.\d+)\]/);
  if (!m) errors.push('docs/CHANGELOG.md 에서 "## [vX.Y.Z]" 항목을 찾을 수 없습니다.');
  else if (m[1] !== manifest.version) errors.push(`manifest.json=${manifest.version}, CHANGELOG.md=${m[1]}`);
});

// 4. popup.html: 참조 스크립트 존재 + MV3 CSP 위반(인라인 스크립트/이벤트 핸들러) 금지
check('popup.html 스크립트 / CSP', () => {
  const html = read('extension/popup.html');
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    if (!fs.existsSync(path.join(extDir, m[1]))) errors.push(`popup.html 이 참조하는 스크립트가 없음: ${m[1]}`);
  }
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

// 4-2. 흐리게 모드 선택자: shared.js(AG_DIM_TARGET_SELECTOR) 와 styles.css([data-ag-dim="body"]) 가 같은 목록인지
check('흐리게 모드 선택자 일치 (shared.js ↔ styles.css)', () => {
  const pick = s => [...s.matchAll(/\[(data-testid|role)="([^"]+)"\]/g)].map(m => `${m[1]}=${m[2]}`).sort();
  const js = (read('extension/shared.js').match(/var AG_DIM_TARGET_SELECTOR = \[([\s\S]*?)\]\.join/) || [])[1];
  const css = (read('extension/styles.css').match(/\[data-ag-dim="body"\] :is\(([\s\S]*?)\)\s*\{/) || [])[1];
  if (!js || !css) {
    errors.push('AG_DIM_TARGET_SELECTOR 또는 styles.css 의 [data-ag-dim="body"] 규칙을 찾을 수 없습니다.');
    return;
  }
  const a = pick(js).join(', ');
  const b = pick(css).join(', ');
  if (a !== b) errors.push(`선택자 목록이 다릅니다.\nshared.js : ${a}\nstyles.css: ${b}`);
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
  const jsFiles = fs.readdirSync(extDir).filter(f => f.endsWith('.js'));
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

// 7. 테스트 러너가 실제 shared.js 를 로드하는지
check('테스트 러너 shared.js 경로', () => {
  const html = read('tests/test-runner.html');
  const m = html.match(/<script\s+src="([^"]*shared\.js)"/);
  if (!m) errors.push('tests/test-runner.html 이 shared.js 를 로드하지 않습니다.');
  else if (!fs.existsSync(path.resolve(root, 'tests', m[1]))) errors.push(`tests/test-runner.html 의 shared.js 경로가 잘못됨: ${m[1]}`);
});

// 8. 문서에 로컬 절대 경로 링크가 남아 있지 않은지
check('문서 링크 (file:/// 금지)', () => {
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
