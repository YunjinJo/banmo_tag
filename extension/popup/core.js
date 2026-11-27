// popup/core.js — 팝업 공통: 상태 · 작은 도우미 · 공통 UI(상태 메시지, 확인 상자, 뒤 화면 잠그기) · 리스트 저장 큐
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

// ==========================================
// 상태 · 상수
// ==========================================

// shared/ 파일이 없으면 아무 기능도 동작하지 않으므로, 증상을 숨기는 폴백 대신 시작 시 원인을 알림
const SHARED_LOADED = typeof sanitizeListsObject === 'function';

let badgeSettings = SHARED_LOADED ? { ...AG_DEFAULT_BADGE_SETTINGS } : {};
// 화면 설정 { theme, listSort } (chrome.storage.local 의 uiSettings)
let uiSettings = SHARED_LOADED ? normalizeUiSettings() : {};
// 타임라인 배지 표시 설정 { maxBadges, ellipsis, nameWidth, badgeShape, quoteBadges, dimLevel } (displaySettings, [설정] 시트)
let displaySettings = SHARED_LOADED ? normalizeDisplaySettings() : {};
// [설정] 시트가 열려 있는지
let settingsOpen = false;
// 마지막으로 그린 리스트 데이터 (정렬 변경·시트 다시 그리기·"개별 스타일 N개" 표시용)
let renderedLists = {};
// 설정 시트에 열려 있는 리스트 이름 (없으면 null)과 그 시트의 멤버 목록 펼침 여부
let openSheetName = null;
let sheetMembersOpen = false;
// 그 시트의 [이름 바꾸기] 입력란 펼침 여부
let sheetRenameOpen = false;
// 방금 팝업에서 바꾼 이름 { from, to }. 저장 후 화면을 다시 그릴 때 열린 시트가 새 이름을 따라가게 함 (lists.js renderLists)
let pendingSheetRename = null;
// 파일에서 읽어 [병합]/[덮어쓰기] 선택을 기다리는 데이터 ({ lists, badgeSettings })
let pendingImport = null;
let statusTimer = null;
// 확인 상자가 열려 있을 때 답을 전달하는 함수와, 닫은 뒤 포커스를 돌려줄 요소
let resolveConfirm = null;
let confirmReturnFocus = null;

// 팝업 화면을 일반 탭에서 연 경우: popup.html?view=tab&targetTab=<열 때 보던 탭 id>[&list=<열어 둘 리스트>]
const PAGE_PARAMS = new URLSearchParams(location.search);
const IS_TAB_VIEW = PAGE_PARAMS.get('view') === 'tab';
const TARGET_TAB_ID = Number.parseInt(PAGE_PARAMS.get('targetTab'), 10);

// 파이어폭스 팝업에서 하면 팝업이 닫혀 버리는 조작 (파일 선택·다운로드·색상 선택) → 새 탭에서 열기
const OPEN_IN_TAB_ON_FIREFOX = '#import-btn, #export-btn, input[type="color"]';

// 마지막 테마 선택을 적어 두는 localStorage 키 (theme.js 가 첫 화면 전에 읽음. 같은 키여야 함)
const THEME_CACHE_KEY = 'banmo_tag.theme';

const TAB_KEYS = ['lists', 'style', 'help'];

// ==========================================
// 작은 도우미
// ==========================================

const byId = id => document.getElementById(id);

// 작은 DOM 생성 도우미. type 이 있으면(버튼·입력란) 가장 먼저 지정
function makeElement(tag, className, text, type) {
  const el = document.createElement(tag);
  if (type) el.type = type;
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// 버튼을 잠그고 작업을 실행한 뒤 다시 풀어 줌 (연타 방지)
async function withButtonDisabled(button, task) {
  button.disabled = true;
  try {
    await task();
  } finally {
    button.disabled = false;
  }
}

// ==========================================
// 공통 UI (상태 메시지, 확인 상자, 뒤 화면 잠그기)
// ==========================================

// 화면 위에 뜨는 상태 메시지 (5초 뒤 사라짐, 닫기 버튼이나 메시지를 누르면 바로 닫힘)
// sticky: 저절로 사라지지 않음 ([끝까지 스캔] 진행 상황처럼 계속 바뀌는 메시지)
function showSyncStatus(message, isError = false, sticky = false) {
  const statusEl = byId('sync-status');
  const textEl = byId('sync-status-text');
  if (!statusEl || !textEl) return;
  statusEl.className = 'sync-status ' + (isError ? 'error' : 'success');
  textEl.textContent = message;
  statusEl.style.display = 'flex';

  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(hideSyncStatus, 5000);
}

function hideSyncStatus() {
  clearTimeout(statusTimer);
  const statusEl = byId('sync-status');
  if (!statusEl) return;
  // 닫기 버튼에 포커스가 있었다면 사라진 버튼에 남지 않게 풀어 줌
  if (statusEl.contains(document.activeElement)) document.activeElement.blur();
  statusEl.style.display = 'none';
}

// 팝업 안의 확인 상자 (브라우저 confirm() 대신). 확인하면 true, 취소하면 false
function askConfirm(message, okLabel = '확인') {
  const box = byId('confirm-box');
  const text = byId('confirm-text');
  const okBtn = byId('confirm-ok-btn');
  if (!box || !text || !okBtn) return Promise.resolve(false);

  if (resolveConfirm) resolveConfirm(false); // 이전 확인 요청은 취소로 처리
  confirmReturnFocus = document.activeElement;
  text.textContent = message;
  okBtn.textContent = okLabel;
  box.style.display = 'flex';
  updateInert();
  okBtn.focus();

  return new Promise((resolve) => {
    resolveConfirm = (answer) => {
      resolveConfirm = null;
      box.style.display = 'none';
      updateInert();
      restoreFocus(confirmReturnFocus);
      resolve(answer);
    };
  });
}

function setupConfirmBox() {
  byId('confirm-ok-btn')?.addEventListener('click', () => resolveConfirm && resolveConfirm(true));
  byId('confirm-cancel-btn')?.addEventListener('click', () => resolveConfirm && resolveConfirm(false));
  // 닫기 버튼을 누른 것도 여기로 올라옴 (메시지 어디를 눌러도 닫힘)
  byId('sync-status')?.addEventListener('click', hideSyncStatus);
}

// 아직 화면에 있고 누를 수 있는 요소면 포커스를 돌려줌
function restoreFocus(el) {
  if (el && el.isConnected && typeof el.focus === 'function' && !el.closest('[inert], [hidden]')) el.focus();
}

// 확인 상자·시트가 떠 있는 동안 뒤 화면은 키보드·마우스로 건드릴 수 없게 (inert)
function updateInert() {
  const modalOpen = ['confirm-box', 'import-choice', 'font-dialog'].some(id => byId(id)?.style.display === 'flex');
  const app = byId('app');
  const sheet = byId('list-sheet');
  const settings = byId('settings-sheet');
  if (app) app.inert = modalOpen || !!openSheetName || settingsOpen;
  if (sheet) sheet.inert = modalOpen;
  if (settings) settings.inert = modalOpen;
}

// ==========================================
// 리스트 저장 (순서대로 처리)
// ==========================================

// 모든 리스트 변경은 이 함수를 거칩니다.
// 읽기 → 수정 → 쓰기가 겹치면 앞선 변경이 사라지므로 Promise 큐로 하나씩 처리합니다.
// mutator 가 false 를 반환하면 저장하지 않습니다. 화면은 storage.onChanged 에서 다시 그립니다.
let writeQueue = Promise.resolve();

function updateLists(mutator) {
  const run = writeQueue.then(async () => {
    const result = await chrome.storage.local.get(['lists']);
    const { newLists } = sanitizeListsObject(result.lists || {});
    if (mutator(newLists) === false) return false;
    await chrome.storage.local.set({ lists: newLists });
    return true;
  });
  writeQueue = run.catch(() => {});
  return run.catch((err) => {
    console.error('[banmo_tag] 저장 실패:', err);
    showSyncStatus('저장에 실패했습니다: ' + (err && err.message ? err.message : err), true);
    return false;
  });
}

// 리스트 한 개의 항목 하나(color, mode 등)를 바꿈
function saveListField(name, key, value) {
  return updateLists((l) => {
    if (!l[name]) return false;
    l[name][key] = value;
  });
}
