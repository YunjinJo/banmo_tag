// ESLint 설정 (flat config)
// 핵심 목적: shared/*.js 의 전역 함수를 다른 파일이 쓰는 구조라, 함수 이름을 바꾸거나 지우면
// 실행할 때에야 ReferenceError 가 납니다. no-undef 로 CI 에서 미리 잡습니다.
'use strict';

const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');

// 파일의 최상위 선언 이름 목록 (function / async function / const / let / var)
const DECLARATION_RE = /^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm;
function readDeclarations(file) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  return [...source.matchAll(DECLARATION_RE)].map(m => m[1] || m[2]);
}

// 폴더 안의 .js 파일 경로 목록 ('extension/shared' → ['extension/shared/base.js', …])
function listJsFiles(dir) {
  return fs.readdirSync(path.join(__dirname, dir)).filter(f => f.endsWith('.js')).map(f => dir + '/' + f);
}

// 같은 묶음에서 "다른 파일"의 최상위 선언을 전역으로 등록 (자기 선언까지 넣으면 no-redeclare 오류)
function declarationsOfOthers(declsByFile, file, access) {
  const others = {};
  Object.keys(declsByFile).filter(f => f !== file).forEach((f) => {
    declsByFile[f].forEach((name) => { others[name] = access; });
  });
  return others;
}

// 최상위 선언은 다른 파일에서 쓰는 전역이므로 미사용 검사는 지역 변수에만 적용
const unusedLocalOnly = ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }];

// shared/*.js 의 최상위 function / var 선언을 읽어 content/popup/background 의 전역으로 등록
// (shared/ 에서 함수를 지우거나 이름을 바꾸면 그 함수를 쓰는 파일에서 no-undef 오류가 납니다)
const sharedDecls = {};
listJsFiles('extension/shared').forEach((file) => { sharedDecls[file] = readDeclarations(file); });
const sharedGlobals = {};
Object.values(sharedDecls).flat().forEach((name) => { sharedGlobals[name] = 'readonly'; });

// 공통 파일들(shared/*.js)은 일반 스크립트라 서로의 함수를 씁니다 (예: list-data.js 가 list-names.js 의 cleanListName 사용).
const sharedConfigs = Object.keys(sharedDecls).map(file => ({
  files: [file],
  languageOptions: {
    sourceType: 'script',
    globals: { ...globals.browser, ...declarationsOfOthers(sharedDecls, file, 'readonly') }
  },
  rules: { 'no-unused-vars': unusedLocalOnly }
}));

// 팝업 파일들(popup/*.js, popup.js)도 일반 스크립트라 최상위 함수·변수를 서로 공유합니다.
// 다른 파일의 let 을 바꾸는 경우가 있어 writable 로 둡니다.
const popupDecls = {};
['extension/popup.js', ...listJsFiles('extension/popup')].forEach((file) => { popupDecls[file] = readDeclarations(file); });
const popupConfigs = Object.keys(popupDecls).map(file => ({
  files: [file],
  languageOptions: {
    sourceType: 'script',
    globals: {
      ...globals.browser,
      ...globals.webextensions,
      ...sharedGlobals,
      ...declarationsOfOthers(popupDecls, file, 'writable')
    }
  },
  rules: { 'no-unused-vars': unusedLocalOnly }
}));

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'antigravity-extension/**', 'playwright-report/**', 'test-results/**']
  },
  js.configs.recommended,
  {
    // 정규식의 불필요한 이스케이프(\/ 등)는 동작에 영향이 없는 스타일 문제라 끔
    rules: { 'no-useless-escape': 'off' }
  },
  ...sharedConfigs,
  {
    files: ['extension/content.js', 'extension/theme.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions, ...sharedGlobals }
    },
    rules: { 'no-unused-vars': unusedLocalOnly }
  },
  ...popupConfigs,
  {
    files: ['extension/background.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.webextensions, ...sharedGlobals }
    },
    rules: { 'no-unused-vars': unusedLocalOnly }
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js', '*.config.js', '.claude/hooks/**/*.js'],
    ignores: ['tests/fixtures/**', 'tests/unit/**'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } }
  },
  {
    // 단위 테스트: tests/test-runner.html 이 shared/*.js 와 테스트 도구(describe · it · assert…) 다음에 불러오는 일반 스크립트
    files: ['tests/unit/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...sharedGlobals,
        describe: 'readonly', it: 'readonly', assert: 'readonly', assertEqual: 'readonly', assertDeepEqual: 'readonly'
      }
    }
  },
  {
    // E2E 테스트의 page.evaluate / serviceWorker.evaluate 콜백은 브라우저·확장 프로그램 안에서 실행됨
    files: ['tests/e2e/**/*.js', 'tests/firefox/**/*.js', 'scripts/readme-screenshots.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } }
  },
  {
    // DevTools 콘솔에 붙여 넣어 쓰는 스냅샷 스크립트 (copy 는 DevTools 전용 함수)
    files: ['tests/fixtures/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, copy: 'readonly' } }
  }
];
