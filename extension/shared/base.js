// shared/base.js — 공통 기본값 · 작은 도우미 (핸들, 색상, 모드, 브라우저 구분)
//
// extension/shared/ 에는 content.js · 팝업 · background.js · 단위 테스트가 함께 쓰는 "순수 로직"이 주제별로 들어 있습니다.
// 저장소나 화면 상태를 직접 갖지 않고, 받은 값만으로 결과를 돌려주므로 tests/unit/ 에서 그대로 검사합니다.
//
//   base.js         공통 기본값 · 도우미                     mergeHandles, parseHandles, isHexColor, debounce …
//   list-names.js   리스트 이름 정리 · 검사                  cleanListName, isSystemListName …
//   list-data.js    저장된 리스트 데이터 다루기              sanitizeListsObject, applyListSave, applyListReplace …
//   list-page.js    X 리스트 화면 읽기 (주소 · 이름 · 멤버)  parseListUrl, getListNameFromPage, extractMembersFromContainer …
//   badges.js       타임라인 배지 (스타일 · 그리기)          buildHandleMap, applyBadgeStyle, renderTweet …
//   backup.js       백업 파일 만들기 · 읽기                  buildBackup, parseBackup, mergeImportedLists …
//   health.js       X 화면 구조 진단                         diagnoseStructure, getStructureWarnings …
//   ui.js           팝업 화면용 (테마 · 정렬 · 요약)         normalizeUiSettings, sortListNames, summarizeMembers …
//
// 읽는 순서(목록)는 extension/manifest.json 의 content_scripts 가 기준입니다. 파일을 추가하면
// manifest.json, manifest.firefox.json, popup.html, tests/test-runner.html 에 같은 순서로 넣습니다
// (빠뜨리면 `node scripts/validate.js` 가 알려 줍니다).
//
// ⚠️ shared/ 파일의 최상위에는 function 선언과 var 만 씁니다.
//    팝업이 content script 를 다시 주입할 때(chrome.scripting) 이 파일들이 같은 공간에서 한 번 더 실행되는데,
//    최상위 const/let 은 "이미 선언됨" 오류를 내기 때문입니다. 함수 안에서는 const/let 을 써도 됩니다.

// ==========================================
// 기본값 · 형식
// ==========================================

var AG_DEFAULT_BADGE_SETTINGS = { textColor: '#ffffff', fontSize: 11, fontFamily: 'system' };
var AG_DEFAULT_LIST_COLOR = '#1d9bf0';
var AG_VALID_MODES = ['normal', 'highlight', 'dim'];
var AG_HANDLE_RE = /^@[A-Za-z0-9_]{1,15}$/;
var AG_HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
var AG_PROFILE_HREF_RE = /^\/([A-Za-z0-9_]{1,15})$/;

// ==========================================
// 도우미
// ==========================================

// 마지막 호출 후 wait(ms) 동안 다시 호출되지 않으면 한 번 실행
function debounce(func, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), wait);
  };
}

// 핸들 배열 두 개를 대소문자 구분 없이 합치고 중복 제거 (먼저 나온 표기를 유지)
function mergeHandles(existing, incoming) {
  const seen = new Set();
  const out = [];
  const add = (handle) => {
    if (typeof handle !== 'string') return;
    const trimmed = handle.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(trimmed);
  };
  (Array.isArray(existing) ? existing : []).forEach(add);
  (Array.isArray(incoming) ? incoming : []).forEach(add);
  return out;
}

function isHexColor(value) {
  return typeof value === 'string' && AG_HEX_COLOR_RE.test(value);
}

function isValidMode(value) {
  return AG_VALID_MODES.indexOf(value) !== -1;
}

// 프로필 링크 "/handle" 에서 handle(앞의 @ 없이)을 꺼냄. 프로필 링크 모양이 아니면 null
function getHandleFromProfileHref(href) {
  const match = String(href || '').match(AG_PROFILE_HREF_RE);
  return match ? match[1] : null;
}

// 실행 중인 브라우저: 확장 프로그램 주소(chrome.runtime.getURL(''))가 moz-extension:// 이면 'firefox', 아니면 'chrome'
function getBrowserKind(extensionUrl) {
  return /^moz-extension:/i.test(String(extensionUrl || '')) ? 'firefox' : 'chrome';
}

// 쉼표/공백/줄바꿈으로 구분된 입력을 올바른 "@handle" 배열로 (앞의 @ 생략 가능, 중복 제거)
function parseHandles(raw) {
  const seen = new Set();
  const out = [];
  String(raw || '').split(/[\s,]+/).forEach((token) => {
    let handle = token.trim();
    if (!handle) return;
    if (handle.charAt(0) !== '@') handle = '@' + handle;
    if (!AG_HANDLE_RE.test(handle)) return;
    const key = handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(handle);
  });
  return out;
}
