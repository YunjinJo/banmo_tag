// ESLint 설정 (flat config)
// 핵심 목적: shared.js 의 전역 함수를 다른 파일이 쓰는 구조라, 함수 이름을 바꾸거나 지우면
// 실행할 때에야 ReferenceError 가 납니다. no-undef 로 CI 에서 미리 잡습니다.
'use strict';

const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');

// shared.js 의 최상위 function / var 선언을 읽어 content/popup/background 의 전역으로 등록
// (shared.js 에서 함수를 지우거나 이름을 바꾸면 그 함수를 쓰는 파일에서 no-undef 오류가 납니다)
const sharedSource = fs.readFileSync(path.join(__dirname, 'extension', 'shared.js'), 'utf8');
const sharedGlobals = {};
for (const m of sharedSource.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|var\s+([A-Za-z_$][\w$]*))/gm)) {
  sharedGlobals[m[1] || m[2]] = 'readonly';
}

// 최상위 선언은 다른 파일에서 쓰는 전역이므로 미사용 검사는 지역 변수에만 적용
const unusedLocalOnly = ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }];

// 팝업 파일들(popup/*.js, popup.js)은 일반 스크립트라 최상위 함수·변수를 서로 공유합니다.
// 파일마다 "다른 팝업 파일의 최상위 선언"을 전역으로 등록합니다(자기 선언까지 넣으면 no-redeclare 오류).
// 다른 파일의 let 을 바꾸는 경우가 있어 writable 로 둡니다.
const POPUP_FILES = ['extension/popup.js', ...fs.readdirSync(path.join(__dirname, 'extension', 'popup'))
  .filter(f => f.endsWith('.js')).map(f => 'extension/popup/' + f)];
const popupDecls = {};
for (const file of POPUP_FILES) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  popupDecls[file] = [...src.matchAll(/^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm)].map(m => m[1] || m[2]);
}
const popupConfigs = POPUP_FILES.map((file) => {
  const others = {};
  POPUP_FILES.filter(f => f !== file).forEach(f => popupDecls[f].forEach((name) => { others[name] = 'writable'; }));
  return {
    files: [file],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.webextensions, ...sharedGlobals, ...others } },
    rules: { 'no-unused-vars': unusedLocalOnly }
  };
});


module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'antigravity-extension/**', 'playwright-report/**', 'test-results/**']
  },
  js.configs.recommended,
  {
    // 정규식의 불필요한 이스케이프(\/ 등)는 동작에 영향이 없는 스타일 문제라 끔
    rules: { 'no-useless-escape': 'off' }
  },
  {
    files: ['extension/shared.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
    rules: { 'no-unused-vars': unusedLocalOnly }
  },
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
    ignores: ['tests/fixtures/**'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } }
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
