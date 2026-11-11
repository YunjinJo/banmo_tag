// scripts/test-report.js
// 테스트 목록 문서와 버전별 테스트 결과를 만듭니다. 외부 패키지 없이 Node.js 기본 모듈만 씁니다.
//
//   npm run test:report                     모든 검사를 실행하고 결과를 화면에 출력
//   npm run test:report -- --firefox        실제 Firefox 확인(npm run test:firefox)도 함께
//   npm run test:report -- --write          결과를 docs/TEST_RESULTS.md 맨 위에 기록 (같은 버전이면 교체)
//   npm run test:report -- --label v1.8.0   결과 제목 직접 지정 (기본: 릴리스 전이면 Unreleased, 아니면 v<manifest 버전>)
//   npm run test:report -- --catalog        docs/TEST_CASES.md 의 자동 테스트 목록만 다시 만듦 (검사는 실행하지 않음)
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = flag => args.includes(flag);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};

const CASES_DOC = path.join(root, 'docs', 'TEST_CASES.md');
const RESULTS_DOC = path.join(root, 'docs', 'TEST_RESULTS.md');
const CATALOG_START = '<!-- AUTO-CATALOG:START (npm run test:report -- --catalog 로 다시 만듦. 직접 고치지 마세요) -->';
const CATALOG_END = '<!-- AUTO-CATALOG:END -->';
const RESULTS_MARKER = '<!-- 새 결과는 이 줄 아래에 추가됩니다 (npm run test:report -- --write) -->';

const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 20 * 60 * 1000,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const node = (script, scriptArgs, opts) => run(process.execPath, [path.join(root, script), ...scriptArgs], opts);
const git = gitArgs => run('git', gitArgs).stdout.trim();

// ==========================================
// 테스트 목록 (소스에서 읽음)
// ==========================================

// scripts/validate.js 의 check('이름', ...) 항목
function listStaticChecks() {
  return [...read('scripts/validate.js').matchAll(/^check\('([^']+)'/gm)].map(m => m[1]);
}

// 단위 테스트 묶음: tests/test-runner.html 이 불러오는 tests/unit/*.test.js 의 describe(...) 별 it(...) 개수
function listUnitSuites() {
  const files = [...read('tests/test-runner.html').matchAll(/<script\b[^>]*\bsrc="(unit\/[^"]+)"/g)].map(m => m[1]);
  const suites = [];
  files.forEach((file) => {
    read('tests/' + file).split('\n').forEach((line) => {
      const d = line.match(/^\s*describe\('(.+)',\s*\(\)\s*=>/);
      if (d) suites.push({ file: path.basename(file), name: d[1], count: 0 });
      else if (/^\s*it\('/.test(line) && suites.length) suites[suites.length - 1].count++;
    });
  });
  return suites;
}

// Playwright 테스트 목록: [{ file, group, title }]
function flattenSpecs(suite, groups, out) {
  (suite.specs || []).forEach(spec => out.push({ file: spec.file || suite.file, group: groups.join(' › '), title: spec.title, tests: spec.tests || [] }));
  (suite.suites || []).forEach(s => flattenSpecs(s, groups.concat(s.title), out));
  return out;
}
function parsePlaywrightJson(text) {
  const json = JSON.parse(text.slice(text.indexOf('{')));
  const specs = [];
  (json.suites || []).forEach(s => flattenSpecs(s, [], specs));
  return { json, specs };
}
function listE2E() {
  const r = node('node_modules/@playwright/test/cli.js', ['test', '--list', '--reporter=json']);
  return parsePlaywrightJson(r.stdout).specs;
}

// tests/firefox/firefox-check.js 의 record('이름', ...) 항목 (스크립트 오류 기록용 항목은 제외)
function listFirefoxChecks() {
  return [...read('tests/firefox/firefox-check.js').matchAll(/record\('([^']+)'/g)].map(m => m[1]).filter(n => n !== '스크립트 실행');
}

// docs/TEST_CASES.md 의 수동 시나리오 ### [M-xx] 제목
function listManualCases() {
  return [...read('docs/TEST_CASES.md').matchAll(/^### \[(M-\d+)\] (.+)$/gm)].map(m => ({ id: m[1], title: m[2].trim() }));
}

const E2E_FILES = {
  'content.spec.js': 'X 화면 (content script · background)',
  'popup.spec.js': '팝업',
  'unit-runner.spec.js': '단위 테스트 실행',
  'real-snapshots.spec.js': '실제 X 화면 스냅샷'
};

function buildCatalog() {
  const lines = [];
  const statics = listStaticChecks();
  lines.push(`### 정적 검사 (\`npm run validate\`, ${statics.length}항목)`, '');
  lines.push('| 번호 | 항목 |', '|:-:|---|');
  statics.forEach((n, i) => lines.push(`| S-${pad(i + 1)} | ${escapeCell(n)} |`));
  lines.push('', '이 밖에 `npm run lint`(ESLint, 문제 0건)와 `npm run lint:firefox`(파이어폭스용으로 만든 `dist/firefox/` 를 web-ext lint, 오류·경고 0건)를 실행합니다.', '');

  const suites = listUnitSuites();
  const unitTotal = suites.reduce((a, s) => a + s.count, 0);
  lines.push(`### 단위 테스트 (\`tests/unit/\`, ${suites.length}개 묶음 · ${unitTotal}건)`, '');
  lines.push('`tests/test-runner.html` 이 `extension/shared/*.js` 를 그대로 불러와 검사합니다 (테스트 파일은 `shared/` 의 파일마다 하나씩). E2E 의 `unit-runner.spec.js` 와 `scripts/build.ps1` 이 실행합니다.', '');
  lines.push('| 번호 | 파일 | 묶음 | 건수 |', '|:-:|---|---|:-:|');
  suites.forEach((s, i) => lines.push(`| U-${pad(i + 1)} | \`${s.file}\` | ${escapeCell(s.name)} | ${s.count} |`));
  lines.push('');

  const specs = listE2E();
  lines.push(`### E2E 테스트 (\`tests/e2e/\`, Playwright · 실제 확장 프로그램, ${specs.length}건)`, '');
  lines.push('x.com 요청은 `tests/fixtures/synthetic/` 의 합성 페이지로 응답합니다. 실제 X 서버나 로그인은 쓰지 않습니다.', '');
  const prefix = { 'content.spec.js': 'C', 'popup.spec.js': 'P', 'unit-runner.spec.js': 'UR', 'real-snapshots.spec.js': 'R' };
  Object.keys(E2E_FILES).forEach((file) => {
    const inFile = specs.filter(s => s.file === file);
    if (file === 'real-snapshots.spec.js') {
      lines.push(`#### ${E2E_FILES[file]} (\`${file}\`)`, '', '`tests/fixtures/real/` 의 스냅샷마다 1건씩 실행합니다. 스냅샷이 없으면 건너뜁니다.', '');
      return;
    }
    if (inFile.length === 0) return;
    lines.push(`#### ${E2E_FILES[file]} (\`${file}\`, ${inFile.length}건)`, '');
    lines.push('| 번호 | 묶음 | 확인 내용 |', '|:-:|---|---|');
    inFile.forEach((s, i) => lines.push(`| ${prefix[file]}-${pad(i + 1)} | ${escapeCell(s.group || '-')} | ${escapeCell(s.title)} |`));
    lines.push('');
  });

  const ff = listFirefoxChecks();
  lines.push(`### 실제 Firefox 확인 (\`npm run test:firefox\`, ${ff.length}항목)`, '');
  lines.push('실제 Firefox 에 확장 프로그램을 임시 설치하고, x.com 요청을 로컬 테스트 서버(합성 페이지)로 보내 확인합니다.', '');
  lines.push('| 번호 | 항목 |', '|:-:|---|');
  ff.forEach((n, i) => lines.push(`| F-${pad(i + 1)} | ${escapeCell(n)} |`));
  lines.push('');
  return lines.join('\n');
}

function writeCatalog() {
  const doc = fs.readFileSync(CASES_DOC, 'utf8');
  const start = doc.indexOf(CATALOG_START);
  const end = doc.indexOf(CATALOG_END);
  if (start === -1 || end === -1 || end < start) throw new Error(`docs/TEST_CASES.md 에 자동 목록 표시(${CATALOG_START.slice(0, 22)}…)가 없습니다.`);
  const next = doc.slice(0, start + CATALOG_START.length) + '\n\n' + buildCatalog() + '\n' + doc.slice(end);
  fs.writeFileSync(CASES_DOC, next);
  return next !== doc;
}

// ==========================================
// 검사 실행
// ==========================================

function runStatic() {
  const r = node('scripts/validate.js', []);
  const ok = (r.stdout.match(/^- ✅/gm) || []).length;
  const bad = r.stdout.split('\n').filter(l => l.startsWith('- ❌')).map(l => l.slice(4).trim());
  return { name: '정적 검사 (`npm run validate`)', pass: r.code === 0, detail: `${ok}/${ok + bad.length}`, failures: bad };
}

function runEslint() {
  const r = node('node_modules/eslint/bin/eslint.js', ['.', '-f', 'json']);
  let errors = 0;
  let warnings = 0;
  const failures = [];
  try {
    JSON.parse(r.stdout).forEach((f) => {
      errors += f.errorCount;
      warnings += f.warningCount;
      f.messages.forEach(m => failures.push(`${path.relative(root, f.filePath)}:${m.line} ${m.message}`));
    });
  } catch {
    failures.push((r.stderr || r.stdout).trim().split('\n')[0]);
  }
  return { name: 'ESLint (`npm run lint`)', pass: r.code === 0, detail: `오류 ${errors} · 경고 ${warnings}`, failures };
}

function runWebExtLint() {
  // 파이어폭스용 manifest 를 합친 dist/firefox/ 를 검사 (scripts/build-firefox.js)
  const firefoxDir = path.relative(root, require('./build-firefox').buildFirefox());
  const r = node('node_modules/web-ext/bin/web-ext.js', ['lint', '--source-dir', firefoxDir, '--no-input', '--output', 'json']);
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    const warningCodes = j.warnings.map(w => w.code);
    const unexpected = warningCodes; // 경고도 0건이어야 함
    return {
      name: 'Firefox 호환성 (`npm run lint:firefox`)',
      pass: j.summary.errors === 0 && unexpected.length === 0,
      detail: `오류 ${j.summary.errors} · 경고 ${j.summary.warnings} · 알림 ${j.summary.notices}`,
      failures: j.errors.map(e => `${e.code}: ${e.message}`).concat(unexpected.map(c => `예상하지 못한 경고 ${c}`))
    };
  } catch {
    return { name: 'Firefox 호환성 (`npm run lint:firefox`)', pass: false, detail: '실행 실패', failures: [(r.stderr || r.stdout).trim().split('\n')[0]] };
  }
}

function runE2E() {
  const r = node('node_modules/@playwright/test/cli.js', ['test', '--reporter=json']);
  const rows = [];
  const failures = [];
  let unit = null;
  let specs;
  try {
    specs = parsePlaywrightJson(r.stdout).specs;
  } catch {
    return { rows: [{ name: 'E2E (`npm test`)', pass: false, detail: '실행 실패', failures: [(r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' ')] }], unit };
  }
  const statusOf = spec => (spec.tests[0] && spec.tests[0].status) || 'skipped';
  Object.keys(E2E_FILES).forEach((file) => {
    const inFile = specs.filter(s => s.file === file);
    if (inFile.length === 0) return;
    const passed = inFile.filter(s => ['expected', 'flaky'].includes(statusOf(s))).length;
    const skipped = inFile.filter(s => statusOf(s) === 'skipped').length;
    const flaky = inFile.filter(s => statusOf(s) === 'flaky').length;
    const failed = inFile.filter(s => statusOf(s) === 'unexpected');
    failed.forEach(s => failures.push(`${file} › ${s.group ? s.group + ' › ' : ''}${s.title}`));
    if (file === 'unit-runner.spec.js') {
      const out = inFile.flatMap(s => s.tests.flatMap(t => t.results.flatMap(res => (res.stdout || []).map(o => o.text || ''))));
      const m = out.join('').match(/단위 테스트 (\d+)\/(\d+) 통과/);
      const errText = inFile.flatMap(s => s.tests.flatMap(t => t.results.flatMap(res => (res.errors || []).map(e => e.message || '')))).join('\n');
      const unitFailures = errText.split('\n').filter(l => /›/.test(l) && !/^\s*[-+]/.test(l)).slice(0, 20);
      unit = {
        name: '단위 테스트 (`tests/unit/`)',
        pass: failed.length === 0,
        detail: m ? `${m[1]}/${m[2]}` : (failed.length ? '실패' : '통과'),
        failures: failed.length ? (unitFailures.length ? unitFailures : ['test-runner.html 에서 실패한 테스트를 확인하세요']) : []
      };
      return;
    }
    if (file === 'real-snapshots.spec.js') {
      rows.push({ name: `E2E ${E2E_FILES[file]}`, pass: failed.length === 0, skip: skipped === inFile.length, detail: skipped === inFile.length ? '건너뜀 (스냅샷 없음)' : `${passed}/${inFile.length - skipped}`, failures: [] });
      return;
    }
    rows.push({
      name: `E2E ${E2E_FILES[file]} (\`${file}\`)`,
      pass: failed.length === 0,
      detail: `${passed}/${inFile.length}` + (flaky ? ` (재시도 후 통과 ${flaky})` : '') + (skipped ? ` · 건너뜀 ${skipped}` : ''),
      failures: []
    });
  });
  rows.forEach((row) => { row.failures = failures.filter(f => row.name.includes(f.split(' › ')[0])); });
  return { rows, unit };
}

function runFirefox() {
  const r = node('tests/firefox/firefox-check.js', [], { timeout: 10 * 60 * 1000 });
  const out = r.stdout;
  const total = out.match(/(\d+)\/(\d+) 통과/);
  const version = (out.match(/firefox\/([\d.]+)/) || [])[1];
  const failures = out.split('\n').filter(l => l.startsWith('FAIL')).map(l => l.replace(/^FAIL\s+/, '').trim());
  return {
    name: '실제 Firefox (`npm run test:firefox`)',
    pass: r.code === 0,
    detail: (total ? `${total[1]}/${total[2]}` : '실행 실패') + (version ? ` (Firefox ${version})` : ''),
    failures: total ? failures : [(r.stderr || out).trim().split('\n').slice(-3).join(' ')]
  };
}

// ==========================================
// 결과 문서
// ==========================================

function pad(n) { return String(n).padStart(2, '0'); }
// 표 칸 안의 | 와 HTML 로 읽힐 수 있는 < > 를 이스케이프
function escapeCell(s) { return String(s).replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function defaultLabel(version) {
  // [Unreleased] 에 항목이 있으면 아직 릴리스 전인 코드
  const changelog = read('docs/CHANGELOG.md');
  const m = changelog.match(/## \[Unreleased\]([\s\S]*?)\n## \[v/);
  const unreleased = m && /^\s*-\s+\S/m.test(m[1]);
  return unreleased ? 'Unreleased' : `v${version}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildResultEntry(label, rows, env) {
  const icon = r => (r.skip ? '⏭️' : r.pass ? '✅' : '❌');
  const allPass = rows.every(r => r.pass || r.skip);
  const lines = [];
  lines.push(`## [${label}] - ${today()}`, '');
  lines.push(`- 대상: \`${env.commit}\` (${env.branch}) · manifest ${env.version}`);
  lines.push(`- 환경: ${env.os} · Node ${process.version}`);
  lines.push(`- 자동 테스트 결과: ${allPass ? '**모두 통과**' : '**실패 있음**'}`, '');
  lines.push('| 검사 | 결과 | 통과 / 전체 |', '|---|:-:|---|');
  rows.forEach(r => lines.push(`| ${r.name} | ${icon(r)} | ${escapeCell(r.detail)} |`));
  lines.push('');
  const failures = rows.flatMap(r => r.failures.map(f => `- ${r.name.replace(/ \(`.*$/, '')}: ${f}`));
  lines.push('### 실패한 항목', '', failures.length ? failures.join('\n') : '없음', '');
  const manual = listManualCases();
  lines.push('### 수동 확인 ([TEST_CASES.md](TEST_CASES.md#수동-확인-시나리오))', '');
  lines.push('결과: ✅ 통과 / ❌ 실패 / ➖ 해당 없음 / 비어 있음 = 아직 안 함', '');
  lines.push('| ID | 항목 | 결과 | 메모 |', '|:-:|---|:-:|---|');
  manual.forEach(m => lines.push(`| ${m.id} | ${escapeCell(m.title)} |  |  |`));
  lines.push('');
  return lines.join('\n');
}

function writeResult(label, entry) {
  let doc = fs.readFileSync(RESULTS_DOC, 'utf8');
  if (!doc.includes(RESULTS_MARKER)) throw new Error('docs/TEST_RESULTS.md 에 결과 추가 위치 표시가 없습니다.');
  // 같은 제목의 결과가 있으면 그 항목을 교체 (다음 "## [" 또는 문서 끝까지)
  const heading = `## [${label}]`;
  const at = doc.indexOf('\n' + heading + ' ');
  if (at !== -1) {
    const next = doc.indexOf('\n## [', at + 1);
    doc = doc.slice(0, at + 1) + doc.slice(next === -1 ? doc.length : next + 1);
  }
  doc = doc.replace(RESULTS_MARKER, `${RESULTS_MARKER}\n\n${entry.trimEnd()}\n\n---`);
  doc = doc.replace(/\n---\n\n---/g, '\n---').replace(/\n{3,}/g, '\n\n');
  fs.writeFileSync(RESULTS_DOC, doc);
}

// ==========================================
// 실행
// ==========================================

function main() {
  if (has('--catalog')) {
    const changed = writeCatalog();
    console.log(changed ? 'docs/TEST_CASES.md 의 자동 테스트 목록을 다시 만들었습니다.' : 'docs/TEST_CASES.md 의 자동 테스트 목록이 이미 최신입니다.');
    return;
  }

  const manifest = JSON.parse(read('extension/manifest.json'));
  const label = argValue('--label') || defaultLabel(manifest.version);
  const env = {
    commit: git(['rev-parse', '--short', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    version: manifest.version,
    os: `${os.type()} ${os.release()}`
  };
  const dirty = git(['status', '--porcelain']);
  if (dirty) env.commit += ' + 커밋 안 된 변경';

  const steps = [
    ['정적 검사', runStatic], ['ESLint', runEslint], ['Firefox 호환성', runWebExtLint]
  ];
  const rows = [];
  steps.forEach(([n, fn]) => { process.stderr.write(`실행 중: ${n}\n`); rows.push(fn()); });
  process.stderr.write('실행 중: E2E (단위 테스트 포함, 몇 분 걸림)\n');
  const e2e = runE2E();
  if (e2e.unit) rows.push(e2e.unit);
  rows.push(...e2e.rows);
  if (has('--firefox')) {
    process.stderr.write('실행 중: 실제 Firefox\n');
    rows.push(runFirefox());
  } else {
    rows.push({ name: '실제 Firefox (`npm run test:firefox`)', pass: true, skip: true, detail: '실행 안 함 (--firefox 로 포함)', failures: [] });
  }

  const entry = buildResultEntry(label, rows, env);
  console.log(entry);
  if (has('--write')) {
    writeResult(label, entry);
    process.stderr.write(`docs/TEST_RESULTS.md 에 [${label}] 결과를 기록했습니다.\n`);
  }
  if (!rows.every(r => r.pass || r.skip)) process.exitCode = 1;
}

main();
