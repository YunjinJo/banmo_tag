// popup.js — 확장 프로그램 팝업 화면
// 공통 로직(cleanListName, sanitizeListsObject, parseHandles 등)은 popup.html 에서 먼저 로드되는 shared.js 에 있습니다.
// 첫 화면 전에 테마를 적용하는 부분은 theme.js 에 있습니다.
//
// 목차
//   0. 상태
//   1. 시작
//   2. 공통 UI (상태 메시지, 확인 상자, 뒤 화면 잠그기)
//   2-1. 새 탭에서 열기 · 파이어폭스 팝업 우회 · x.com 접근 권한
//   2-2. 탭 · ⋯ 메뉴
//   2-3. 화면 설정 (테마 · 정렬)
//   3. 리스트 저장 (순서대로 처리)
//   4. X 탭 연동 ([현재 탭에서 가져오기], [뺀 멤버 정리])
//   5. X 화면 구조 경고
//   6. 직접 리스트 추가
//   7. 백업 · 복원 · 초기화
//   8. 리스트 목록 (카드)
//   8-1. 리스트 설정 시트 (색 · 글자 스타일 · 타임라인 표시 · 멤버 · 삭제)
//   9. 배지 기본 스타일 (모든 리스트 공통)

// ==========================================
// 0. 상태
// ==========================================

// shared.js 가 없으면 아무 기능도 동작하지 않으므로, 증상을 숨기는 폴백 대신 시작 시 원인을 알림
const SHARED_LOADED = typeof sanitizeListsObject === 'function';

let badgeSettings = SHARED_LOADED ? { ...AG_DEFAULT_BADGE_SETTINGS } : {};
// 화면 설정 { theme, listSort } (chrome.storage.local 의 uiSettings)
let uiSettings = SHARED_LOADED ? normalizeUiSettings() : {};
// 마지막으로 그린 리스트 데이터 (정렬 변경·시트 다시 그리기·"개별 스타일 N개" 표시용)
let renderedLists = {};
// 설정 시트에 열려 있는 리스트 이름 (없으면 null)과 그 시트의 멤버 목록 펼침 여부
let openSheetName = null;
let sheetMembersOpen = false;
// 파일에서 읽어 [병합]/[덮어쓰기] 선택을 기다리는 데이터 ({ lists, badgeSettings })
let pendingImport = null;
let statusTimer = null;
// 확인 상자가 열려 있을 때 답을 전달하는 함수와, 닫은 뒤 포커스를 돌려줄 요소
let resolveConfirm = null;
let confirmReturnFocus = null;

const byId = id => document.getElementById(id);

// 팝업 화면을 일반 탭에서 연 경우: popup.html?view=tab&targetTab=<열 때 보던 탭 id>[&list=<열어 둘 리스트>]
const PAGE_PARAMS = new URLSearchParams(location.search);
const IS_TAB_VIEW = PAGE_PARAMS.get('view') === 'tab';
const TARGET_TAB_ID = Number.parseInt(PAGE_PARAMS.get('targetTab'), 10);

// 파이어폭스 팝업에서 하면 팝업이 닫혀 버리는 조작 (파일 선택·다운로드·색상 선택) → 새 탭에서 열기
const OPEN_IN_TAB_ON_FIREFOX = '#import-btn, #export-btn, input[type="color"]';

// 마지막 테마 선택을 적어 두는 localStorage 키 (theme.js 가 첫 화면 전에 읽음. 같은 키여야 함)
const THEME_CACHE_KEY = 'banmo_tag.theme';

const TAB_KEYS = ['lists', 'style', 'help'];
const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

// ==========================================
// 1. 시작
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  if (!SHARED_LOADED) {
    document.body.textContent = 'shared.js 를 불러오지 못했습니다. chrome://extensions 에서 banmo_tag 를 새로고침해주세요.';
    console.error('[banmo_tag] shared.js not loaded');
    return;
  }

  // 팝업을 열면 아이콘의 ✔ 알림 지우기
  chrome.action.setBadgeText({ text: '' }).catch(() => {});

  setupTabView();
  setupPermissionCheck();
  setupConfirmBox();
  setupTabs();
  setupMenu();
  setupUiSettings();
  setupSheet();
  setupBadgeSettings();
  // 카드와 시트가 공통 설정 기준 값을 보여야 하므로, 설정을 먼저 읽고 목록을 그림
  Promise.all([loadBadgeSettings(), loadUiSettings()])
    .then(loadLists)
    .then(openSheetFromParams);
  loadHealthWarning();
  setupSyncButtons();
  setupManualAdd();
  setupBackupRestore();

  // 리스트가 바뀌면(자동 수집 포함) 바로 다시 그림. 연속 변경은 묶어서 한 번만.
  // 정제된 데이터는 다시 정제해도 바뀌지 않으므로 저장 → 변경 감지 → 저장의 무한 반복이 생기지 않음
  const debouncedLoad = debounce(loadLists, 100);
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    // 공통 배지 설정이 바뀌어도 카드·시트(실제 적용 값 표시)를 다시 그림
    if (changes.lists || changes.badgeSettings) debouncedLoad();
    if (changes.structureHealth) renderHealthWarning(changes.structureHealth.newValue);
    // 다른 창(새 탭 화면 등)에서 테마·정렬을 바꾼 경우
    if (changes.uiSettings) {
      uiSettings = normalizeUiSettings(changes.uiSettings.newValue);
      applyUiSettingsUI();
      renderLists(renderedLists);
    }
  });

  // Esc: 확인 상자 → 가져오기 선택 → 메뉴 → 시트 순서로 하나씩 닫음
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (resolveConfirm) resolveConfirm(false);
    else if (pendingImport) closeImportChoice();
    else if (!byId('app-menu').hidden) setMenuOpen(false, true);
    else if (openSheetName) closeSheet();
    else return;
    e.preventDefault();
  });
});

// ==========================================
// 2. 공통 UI (상태 메시지, 확인 상자, 뒤 화면 잠그기)
// ==========================================

// 화면 위에 뜨는 상태 메시지 (5초 뒤 사라짐, 누르면 바로 닫힘)
function showSyncStatus(message, isError = false) {
  const statusEl = byId('sync-status');
  if (!statusEl) return;
  statusEl.className = 'sync-status ' + (isError ? 'error' : 'success');
  statusEl.textContent = message;
  statusEl.style.display = 'block';

  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.style.display = 'none';
  }, 5000);
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
  byId('sync-status')?.addEventListener('click', (e) => { e.currentTarget.style.display = 'none'; });
}

// 아직 화면에 있고 누를 수 있는 요소면 포커스를 돌려줌
function restoreFocus(el) {
  if (el && el.isConnected && typeof el.focus === 'function' && !el.closest('[inert], [hidden]')) el.focus();
}

// 확인 상자·시트가 떠 있는 동안 뒤 화면은 키보드·마우스로 건드릴 수 없게 (inert)
function updateInert() {
  const modalOpen = byId('confirm-box')?.style.display === 'flex' || byId('import-choice')?.style.display === 'flex';
  const app = byId('app');
  const sheet = byId('list-sheet');
  if (app) app.inert = modalOpen || !!openSheetName;
  if (sheet) sheet.inert = modalOpen;
}

// ==========================================
// 2-1. 새 탭에서 열기 · 파이어폭스 팝업 우회 · x.com 접근 권한
// ==========================================

function isFirefox() {
  return getBrowserKind(chrome.runtime.getURL('')) === 'firefox';
}

// 이 화면을 일반 탭에서 열기. [가져오기]·[뺀 멤버 정리]가 지금 보던 탭을 대상으로 하도록 그 탭 id 를 넘김.
// listName 을 주면 새 탭 화면에서 그 리스트의 설정 시트를 열어 둠
async function openInTab(listName) {
  let targetTab;
  try {
    [targetTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    targetTab = null;
  }
  const url = new URL('popup.html', location.href);
  url.searchParams.set('view', 'tab');
  if (targetTab && targetTab.id !== undefined) url.searchParams.set('targetTab', String(targetTab.id));
  if (listName) url.searchParams.set('list', listName);
  await chrome.tabs.create({ url: url.href });
  if (!IS_TAB_VIEW) window.close();
}

function setupTabView() {
  const openBtn = byId('open-tab-btn');
  if (IS_TAB_VIEW) {
    document.body.classList.add('tab-view');
    if (openBtn) openBtn.style.display = 'none';
    return;
  }
  openBtn?.addEventListener('click', () => openInTab(openSheetName));

  if (isFirefox()) {
    const note = byId('firefox-note');
    if (note) note.style.display = 'block';
  }

  // 파이어폭스 팝업에서는 파일·색상 선택 창이나 다운로드가 팝업을 닫아 버려(Firefox 버그 1292701)
  // 결과를 받을 수 없으므로, 그런 조작은 막고 같은 화면을 새 탭에서 엶 (시트에서 눌렀으면 그 시트도 열어 둠)
  const redirectToTab = (e) => {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target instanceof Element ? e.target.closest(OPEN_IN_TAB_ON_FIREFOX) : null;
    if (!target || !isFirefox()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openInTab(target.closest('#list-sheet') ? openSheetName : null);
  };
  document.addEventListener('click', redirectToTab, true);
  document.addEventListener('keydown', redirectToTab, true);
}

// 새 탭 화면을 list=<이름> 으로 열었으면 그 리스트의 설정 시트를 엶
function openSheetFromParams() {
  const name = IS_TAB_VIEW ? PAGE_PARAMS.get('list') : null;
  if (name && renderedLists[name]) openSheet(name);
}

// x.com 접근 권한 확인. 꺼져 있으면(파이어폭스에서 사용자가 거부한 경우 등) 안내와 [허용] 버튼 표시
async function setupPermissionCheck() {
  const banner = byId('permission-warning');
  if (!banner || !chrome.permissions) return;
  const origins = chrome.runtime.getManifest().host_permissions || [];

  const refresh = async () => {
    let granted;
    try {
      granted = await chrome.permissions.contains({ origins });
    } catch {
      granted = true; // 확인할 수 없으면 경고하지 않음
    }
    banner.style.display = granted ? 'none' : 'block';
  };

  byId('grant-permission-btn')?.addEventListener('click', async () => {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins }); // 사용자 클릭 직후에 바로 요청해야 함
    } catch (err) {
      console.error('[banmo_tag] 권한 요청 실패:', err);
    }
    showSyncStatus(granted
      ? 'x.com 접근을 허용했습니다. 열려 있는 X 탭을 새로고침(F5)해주세요.'
      : 'x.com 접근이 허용되지 않았습니다.', !granted);
    refresh();
  });

  chrome.permissions.onAdded?.addListener(refresh);
  chrome.permissions.onRemoved?.addListener(refresh);
  await refresh();
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
// 2-2. 탭 · ⋯ 메뉴
// ==========================================

function selectTab(key, moveFocus) {
  TAB_KEYS.forEach((k) => {
    const tab = byId('tab-' + k);
    const panel = byId('panel-' + k);
    const selected = k === key;
    if (tab) {
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    if (panel) panel.hidden = !selected;
  });
  if (moveFocus) byId('tab-' + key)?.focus();
}

// 탭: 클릭 또는 ← → Home End (WAI-ARIA 탭 패턴)
function setupTabs() {
  TAB_KEYS.forEach((key, i) => {
    const tab = byId('tab-' + key);
    if (!tab) return;
    tab.addEventListener('click', () => selectTab(key));
    tab.addEventListener('keydown', (e) => {
      const n = TAB_KEYS.length;
      const next = { ArrowRight: TAB_KEYS[(i + 1) % n], ArrowLeft: TAB_KEYS[(i - 1 + n) % n], Home: TAB_KEYS[0], End: TAB_KEYS[n - 1] }[e.key];
      if (!next) return;
      e.preventDefault();
      selectTab(next, true);
    });
  });
}

function setMenuOpen(open, focusButton) {
  const menu = byId('app-menu');
  const button = byId('menu-btn');
  if (!menu || !button) return;
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('.menu-item')?.focus();
  else if (focusButton) button.focus();
}

// ⋯ 메뉴: 내보내기 · 가져오기 · 초기화. 항목을 누르거나 바깥을 누르면 닫힘, ↑ ↓ 로 이동
function setupMenu() {
  const menu = byId('app-menu');
  const button = byId('menu-btn');
  if (!menu || !button) return;

  button.addEventListener('click', () => setMenuOpen(menu.hidden));
  menu.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('.menu-item')) setMenuOpen(false);
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && e.target instanceof Node && !menu.contains(e.target) && !button.contains(e.target)) setMenuOpen(false);
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...menu.querySelectorAll('.menu-item')];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  });
}

// ==========================================
// 2-3. 화면 설정 (테마 · 정렬)
// ==========================================

// 테마 적용: 'system' 이면 data-theme 을 지워 CSS 의 prefers-color-scheme 을 따름
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  try {
    localStorage.setItem(THEME_CACHE_KEY, theme); // 다음에 팝업을 열 때 깜빡임 없이 바로 적용
  } catch {
    // 저장소를 쓸 수 없으면 다음에 잠깐 시스템 테마로 보였다가 바뀜
  }
}

async function loadUiSettings() {
  const result = await chrome.storage.local.get(['uiSettings']);
  uiSettings = normalizeUiSettings(result.uiSettings);
  applyUiSettingsUI();
}

function applyUiSettingsUI() {
  applyTheme(uiSettings.theme);
  const radio = byId('theme-' + uiSettings.theme);
  if (radio) radio.checked = true;
  const sort = byId('list-sort');
  if (sort) sort.value = uiSettings.listSort;
}

function saveUiSetting(key, value) {
  uiSettings = normalizeUiSettings({ ...uiSettings, [key]: value });
  applyUiSettingsUI();
  if (key === 'listSort') renderLists(renderedLists);
  chrome.storage.local.set({ uiSettings }).catch((err) => {
    showSyncStatus('화면 설정 저장에 실패했습니다.', true);
    console.error(err);
  });
}

function setupUiSettings() {
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) saveUiSetting('theme', input.value);
    });
  });
  byId('list-sort')?.addEventListener('change', e => saveUiSetting('listSort', e.target.value));
}

// ==========================================
// 3. 리스트 저장 (순서대로 처리)
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

// ==========================================
// 4. X 탭 연동 ([현재 탭에서 가져오기], [뺀 멤버 정리])
// ==========================================

const TAB_CONNECTION_ERROR = '페이지에 연결할 수 없습니다. 트위터 탭을 새로고침(F5) 해주세요.';
const TAB_TIMEOUT_ERROR = '응답 시간이 초과되었습니다. 트위터 탭을 새로고침(F5) 후 다시 시도해주세요.';

// 탭의 content script 에 메시지를 보내고 응답을 기다림.
// 연결 실패는 { connectionError: true }, 시간 초과는 { timeoutError: true }
function sendTabMessage(tabId, message, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timeoutError: true });
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(chrome.runtime.lastError ? { connectionError: true } : response);
    });
  });
}

// 확장 프로그램 설치/새로고침 전에 열려 있던 탭에는 content script 가 없으므로 직접 넣음
async function injectContentScript(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['shared.js', 'content.js'] });
}

// 요청을 보낼 탭: 팝업이면 지금 보고 있는 탭, 새 탭 화면이면 열 때 보고 있던 탭
async function getTargetTab() {
  if (IS_TAB_VIEW && Number.isInteger(TARGET_TAB_ID)) {
    try {
      return await chrome.tabs.get(TARGET_TAB_ID);
    } catch {
      return null; // 그 탭이 닫힘
    }
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab;
}

// 현재 X 탭에 요청을 보내고 응답을 받음. content script 가 없으면 한 번 넣고 다시 시도.
// 연결·시간 초과 문제는 { error: '안내 문구' } 로 정리해서 반환
async function requestFromActiveTab(message) {
  const activeTab = await getTargetTab();
  if (IS_TAB_VIEW && !activeTab) {
    return { error: '이 화면을 열 때 보던 X 탭을 찾을 수 없습니다. X 탭에서 팝업을 다시 열어주세요.' };
  }
  const tabError = getSyncTabError(activeTab);
  if (tabError) return { error: tabError };

  let response = await sendTabMessage(activeTab.id, message);
  if (response && response.connectionError) {
    try {
      await injectContentScript(activeTab.id);
    } catch {
      return { error: TAB_CONNECTION_ERROR };
    }
    response = await sendTabMessage(activeTab.id, message);
  }
  if (response && response.timeoutError) return { error: TAB_TIMEOUT_ERROR };
  if (!response || response.connectionError) return { error: TAB_CONNECTION_ERROR };
  return response;
}

function setupSyncButtons() {
  const syncBtn = byId('sync-current-tab-btn');
  const resyncBtn = byId('resync-replace-btn');
  syncBtn?.addEventListener('click', () => withButtonDisabled(syncBtn, syncCurrentTab));
  resyncBtn?.addEventListener('click', () => withButtonDisabled(resyncBtn, replaceSyncCurrentTab));
}

// [현재 탭에서 가져오기]: 현재 화면의 멤버를 저장
async function syncCurrentTab() {
  showSyncStatus('데이터 수집 중...', false);
  const response = await requestFromActiveTab({ action: 'scrapeNow' });
  if (response.error) {
    showSyncStatus(response.error, true);
  } else if (response.success) {
    const detail = response.added > 0 ? `새로 ${response.added}명 추가` : '새 멤버 없음';
    showSyncStatus(`'${response.listName}' 총 ${response.count}명 (${detail})`, false);
  } else {
    showSyncStatus(response.message || '리스트 멤버를 찾을 수 없습니다. 멤버 화면을 열어주세요.', true);
  }
}

// [뺀 멤버 정리]: 미리보기 → 확인 → 저장 (X 리스트에서 뺀 멤버 정리)
async function replaceSyncCurrentTab() {
  const preview = await requestFromActiveTab({ action: 'replacePreview' });
  if (preview.error || !preview.success) {
    showSyncStatus(preview.error || preview.message || '뺀 멤버 정리를 준비하지 못했습니다.', true);
    return;
  }
  if (preview.removed.length === 0 && preview.added === 0) {
    showSyncStatus(`'${preview.listName}' 멤버 목록이 이미 최신입니다. (${preview.seenCount}명)`, false);
    return;
  }
  if (!await askConfirm(buildReplaceConfirmText(preview), '교체')) return;

  const saved = await requestFromActiveTab({ action: 'replaceNow' });
  if (saved.error || !saved.success) {
    showSyncStatus(saved.error || saved.message || '뺀 멤버 정리에 실패했습니다.', true);
    return;
  }
  showSyncStatus(`'${saved.listName}' 멤버를 교체했습니다. 총 ${saved.count}명 (추가 ${saved.added}명, 삭제 ${saved.removedCount}명)`, false);
}

// 교체 확인 문구 (삭제될 핸들 일부를 보여 주고, 절반 이상 삭제되면 강하게 경고)
function buildReplaceConfirmText(preview) {
  const removed = preview.removed || [];
  const shown = removed.slice(0, 5).join(', ') + (removed.length > 5 ? ` 외 ${removed.length - 5}명` : '');
  const lines = [];
  if (preview.previousCount > 0 && removed.length * 2 >= preview.previousCount) {
    lines.push(`⚠️ 저장된 ${preview.previousCount}명 중 절반 이상이 삭제됩니다. 멤버 화면을 끝까지 스크롤했는지 꼭 확인하세요.`);
  }
  lines.push(`'${preview.listName}' 멤버를 이번에 멤버 화면에서 확인한 ${preview.seenCount}명으로 교체합니다.`);
  lines.push(`삭제 ${removed.length}명${removed.length ? ': ' + shown : ''} / 추가 ${preview.added}명`);
  lines.push('화면에 한 번도 나오지 않은 멤버는 삭제되니, 목록을 끝까지 스크롤한 뒤 진행하세요.');
  return lines.join('\n');
}

// ==========================================
// 5. X 화면 구조 경고
// ==========================================

function renderHealthWarning(health) {
  const el = byId('health-warning');
  if (!el) return;
  el.textContent = '';

  const warnings = getStructureWarnings(health, Date.now(), 14);
  if (warnings.length === 0) {
    el.style.display = 'none';
    return;
  }

  const title = document.createElement('strong');
  title.textContent = 'X 화면 구조가 바뀌었을 수 있습니다';
  el.appendChild(title);
  warnings.forEach((w) => {
    const line = document.createElement('div');
    line.textContent = `• ${w.label}: ${w.message} (${new Date(w.at).toLocaleString()})`;
    el.appendChild(line);
  });
  const hint = document.createElement('div');
  hint.textContent = '수집이나 배지가 동작하지 않으면 확장 프로그램 업데이트가 필요합니다.';
  el.appendChild(hint);
  el.style.display = 'block';
}

async function loadHealthWarning() {
  const result = await chrome.storage.local.get(['structureHealth']);
  renderHealthWarning(result.structureHealth);
}

// ==========================================
// 6. 직접 리스트 추가
// ==========================================

function setupManualAdd() {
  const toggleBtn = byId('toggle-manual-add-btn');
  const form = byId('manual-add-form');
  const saveBtn = byId('manual-save-btn');
  const nameInput = byId('manual-name');
  const membersInput = byId('manual-members');
  const colorInput = byId('manual-color');
  const modeSelect = byId('manual-mode');
  if (!toggleBtn || !form || !saveBtn) return;

  const setFormOpen = (open) => {
    form.style.display = open ? 'flex' : 'none';
    toggleBtn.textContent = open ? '닫기' : '+ 추가';
    toggleBtn.setAttribute('aria-expanded', String(open));
    if (open) nameInput.focus();
  };
  toggleBtn.addEventListener('click', () => setFormOpen(form.style.display === 'none'));

  saveBtn.addEventListener('click', async () => {
    // 직접 추가는 "X", "Home" 같은 이름도 허용 (시스템 단어는 자동 수집에서만 막음)
    const rawName = nameInput.value.trim();
    const listName = rawName ? cleanListName(rawName) : '';
    const nameError = getManualListNameError(listName);
    if (nameError) {
      showSyncStatus(nameError, true);
      nameInput.focus();
      return;
    }

    const handles = parseHandles(membersInput.value);
    if (handles.length === 0) {
      showSyncStatus('올바른 멤버 핸들을 1개 이상 입력해주세요. (영문/숫자/_ 최대 15자)', true);
      membersInput.focus();
      return;
    }

    // 이미 있는 리스트면 멤버만 추가하고 색상/모드는 유지
    let outcome = null;
    const saved = await updateLists((lists) => {
      outcome = applyManualAdd(lists, listName, handles, colorInput.value, modeSelect.value);
    });
    if (!saved || !outcome) return;

    showSyncStatus(outcome.created
      ? `'${listName}' 리스트가 저장되었습니다! (${outcome.total}명)`
      : `기존 '${listName}' 리스트에 추가했습니다. (${outcome.total}명, 색상/모드는 유지)`, false);
    nameInput.value = '';
    membersInput.value = '';
    setFormOpen(false);
    toggleBtn.focus();
  });
}

// ==========================================
// 7. 백업 · 복원 · 초기화
// ==========================================

function setupBackupRestore() {
  setupResetButton();
  setupExportButton();
  setupImport();
}

function setupResetButton() {
  byId('reset-btn')?.addEventListener('click', async () => {
    if (!await askConfirm('모든 리스트 데이터를 초기화할까요? 되돌릴 수 없습니다.', '초기화')) return;
    const ok = await updateLists((lists) => {
      Object.keys(lists).forEach(k => delete lists[k]);
    });
    if (ok) showSyncStatus('초기화되었습니다.', false);
  });
}

// 객체를 JSON 파일로 내려받기
function downloadJson(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 내보내기: 리스트와 배지 스타일 설정을 함께 저장
function setupExportButton() {
  byId('export-btn')?.addEventListener('click', async () => {
    const result = await chrome.storage.local.get(['lists', 'badgeSettings']);
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`banmo_tag_backup_${date}.json`, buildBackup(result.lists || {}, result.badgeSettings));
  });
}

// 가져오기: 파일 읽기 → [병합] / [덮어쓰기] / [취소] 선택
function setupImport() {
  const importBtn = byId('import-btn');
  const importFile = byId('import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = ''; // 같은 파일을 다시 골라도 change 가 일어나도록
      if (file) readBackupFile(file);
    });
  }

  byId('import-merge-btn')?.addEventListener('click', mergeImport);
  byId('import-replace-btn')?.addEventListener('click', replaceImport);
  byId('import-cancel-btn')?.addEventListener('click', closeImportChoice);
}

function readBackupFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    let parsed;
    try {
      parsed = parseBackup(JSON.parse(ev.target.result));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      showSyncStatus('잘못된 파일 형식입니다. banmo_tag 백업 파일(JSON)을 선택해주세요.', true);
      return;
    }
    const count = Object.keys(parsed.lists).length;
    if (count === 0 && !parsed.badgeSettings) {
      showSyncStatus('가져올 리스트가 없습니다.', true);
      return;
    }
    openImportChoice(parsed, count);
  };
  reader.readAsText(file);
}

function openImportChoice(parsed, count) {
  pendingImport = parsed;
  const choiceText = byId('import-choice-text');
  if (choiceText) {
    choiceText.textContent = `${count}개 리스트를 가져옵니다.` +
      (parsed.badgeSettings ? ' (배지 스타일 설정 포함: 덮어쓰기 때 적용)' : '') + ' 방식을 선택하세요.';
  }
  const choiceEl = byId('import-choice');
  if (choiceEl) choiceEl.style.display = 'flex';
  updateInert();
  byId('import-merge-btn')?.focus();
}

function closeImportChoice() {
  pendingImport = null;
  const choiceEl = byId('import-choice');
  if (choiceEl) choiceEl.style.display = 'none';
  updateInert();
}

// [병합]: 기존 리스트의 색상/모드와 현재 배지 설정은 유지하고 멤버만 합침
// (이름이 같아도 listId 가 다르면 별개 리스트로 분리)
async function mergeImport() {
  const data = pendingImport;
  closeImportChoice();
  if (!data) return;
  const ok = await updateLists((lists) => {
    mergeImportedLists(lists, data.lists);
  });
  if (ok) showSyncStatus('기존 데이터와 병합했습니다.', false);
}

// [덮어쓰기]: 리스트를 파일 내용으로 바꾸고, 파일에 배지 설정이 있으면 그것도 복원
async function replaceImport() {
  const data = pendingImport;
  closeImportChoice();
  if (!data) return;
  if (!await askConfirm('기존 리스트를 모두 지우고 파일 내용으로 바꿉니다. 계속할까요?', '덮어쓰기')) return;

  const ok = await updateLists((lists) => {
    Object.keys(lists).forEach(k => delete lists[k]);
    Object.assign(lists, data.lists);
  });
  if (!ok) return;

  if (data.badgeSettings) {
    try {
      await chrome.storage.local.set({ badgeSettings: data.badgeSettings });
      badgeSettings = { ...data.badgeSettings };
      applyBadgeSettingsUI();
    } catch {
      showSyncStatus('리스트는 복원했지만 배지 설정 저장에 실패했습니다.', true);
      return;
    }
  }
  showSyncStatus(data.badgeSettings ? '파일 내용(리스트 + 배지 설정)으로 덮어썼습니다.' : '파일 내용으로 덮어썼습니다.', false);
}

// ==========================================
// 8. 리스트 목록 (카드)
// ==========================================

async function loadLists() {
  const result = await chrome.storage.local.get(['lists']);
  const { newLists, modified } = sanitizeListsObject(result.lists || {});
  // 태그 붙은 이름이나 시스템 단어 리스트가 남아 있으면 정리해서 저장 (onChanged 로 다시 그려짐)
  if (modified) updateLists(() => {});
  renderLists(newLists);
}

function renderLists(lists) {
  const container = byId('list-container');
  if (!container) return;
  renderedLists = lists;
  updateCustomStyleCount();

  const names = sortListNames(lists, uiSettings.listSort);
  const countEl = byId('list-count');
  if (countEl) countEl.textContent = String(names.length);
  // 리스트가 없으면 칸 이름 줄과 "줄을 누르면…" 안내를 숨김
  ['list-columns', 'list-hint'].forEach((id) => {
    const el = byId(id);
    if (el) el.hidden = names.length === 0;
  });

  container.textContent = '';
  if (names.length === 0) container.appendChild(createEmptyState());
  else names.forEach(name => container.appendChild(createListCard(name, lists[name])));

  // 열어 둔 시트도 새 값으로 다시 그림. 그 리스트가 사라졌으면 닫음
  if (openSheetName) {
    if (lists[openSheetName] && Array.isArray(lists[openSheetName].members)) renderSheet();
    else closeSheet();
  }
}

function createEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.append('저장된 리스트가 없습니다.', document.createElement('br'),
    'X 리스트의 멤버 화면을 열거나 [현재 탭에서 가져오기]를 누르거나, [+ 추가]로 직접 만들어 보세요.');
  return empty;
}

// 작은 DOM 생성 도우미. type 이 있으면(버튼·입력란) 가장 먼저 지정
function makeElement(tag, className, text, type) {
  const el = document.createElement(tag);
  if (type) el.type = type;
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// 실제 타임라인 배지와 같은 모양의 배지 (카드·시트·미리보기)
function createBadgeChip(name, list, settings, extraClass) {
  const chip = makeElement('span', 'badge-chip' + (extraClass ? ' ' + extraClass : ''), name);
  applyBadgeStyle(chip, list.color, settings || getEffectiveBadgeSettings(badgeSettings, list.style), true);
  return chip;
}

// 리스트 표의 한 줄: [배지] (개별 스타일) / "@a, @b 외 N명" | 멤버 수. 누르면 설정 시트
// 타임라인 표시(배지만/강조/흐리게)는 줄에 쓰지 않고 시트에서만 보여 줌
function createListCard(name, list) {
  const card = makeElement('button', 'list-card' + (name === openSheetName ? ' is-open' : ''), undefined, 'button');
  card.dataset.name = name;
  card.setAttribute('aria-haspopup', 'dialog');

  const top = makeElement('span', 'list-card-top');
  top.append(createBadgeChip(name, list, null, 'list-name'));
  if (normalizeListStyle(list.style)) top.append(makeElement('span', 'list-custom', '개별 스타일'));
  const main = makeElement('span', 'list-main');
  main.append(top, makeElement('span', 'list-info', summarizeMembers(list.members)));

  // 숫자만 보이고, 화면 읽기 프로그램에는 "3명" 으로 읽힘
  const count = makeElement('span', 'list-count num', String(list.members.length));
  count.append(makeElement('span', 'sr-only', '명'));
  card.append(main, count);
  card.addEventListener('click', () => openSheet(name));
  return card;
}

function findListCard(name) {
  return [...document.querySelectorAll('#list-container .list-card')].find(c => c.dataset.name === name) || null;
}

// ==========================================
// 8-1. 리스트 설정 시트
// ==========================================

function setupSheet() {
  byId('sheet-close-btn')?.addEventListener('click', closeSheet);
  byId('sheet-backdrop')?.addEventListener('click', closeSheet);
}

function openSheet(name) {
  if (!renderedLists[name]) return;
  openSheetName = name;
  sheetMembersOpen = false;
  document.body.classList.add('sheet-open');
  byId('sheet-backdrop').hidden = false;
  byId('list-sheet').hidden = false;
  byId('list-sheet').scrollTop = 0;
  renderSheet();
  document.querySelectorAll('#list-container .list-card').forEach(c => c.classList.toggle('is-open', c.dataset.name === name));
  updateInert();
  byId('sheet-close-btn')?.focus();
}

function closeSheet() {
  if (!openSheetName) return;
  const name = openSheetName;
  openSheetName = null;
  sheetMembersOpen = false;
  document.body.classList.remove('sheet-open');
  byId('sheet-backdrop').hidden = true;
  byId('list-sheet').hidden = true;
  byId('sheet-body').textContent = '';
  document.querySelectorAll('#list-container .list-card.is-open').forEach(c => c.classList.remove('is-open'));
  updateInert();
  // 연 카드로 포커스를 돌려줌 (리스트가 지워졌으면 [+ 추가])
  (findListCard(name) || byId('toggle-manual-add-btn'))?.focus();
}

// 시트 내용 그리기. 값을 바꾸면 저장 → onChanged → 다시 그리므로, 포커스와 스크롤 위치를 되살림
function renderSheet() {
  const name = openSheetName;
  const list = renderedLists[name];
  const sheet = byId('list-sheet');
  const body = byId('sheet-body');
  if (!list || !sheet || !body) return;

  const active = document.activeElement;
  const focusedId = active && sheet.contains(active) ? active.id : '';
  const scrollTop = sheet.scrollTop;
  const effective = getEffectiveBadgeSettings(badgeSettings, list.style);

  const title = byId('sheet-title');
  title.textContent = name;
  applyBadgeStyle(title, list.color, effective, true);
  byId('sheet-count').textContent = `${list.members.length}명`;

  // 미리보기는 저장 전에도(색 고르는 중) 바로 바뀌어야 하므로 먼저 만들고 갱신 함수를 넘김
  const preview = createSheetPreview(name, list, effective);
  body.textContent = '';
  body.append(
    createColorField(name, list, preview.update),
    createTextStyleFields(name, list, effective, preview.update),
    createModeField(name, list),
    preview.element,
    createSheetFooter(name, list)
  );
  if (sheetMembersOpen) body.appendChild(createMembersList(name, list));

  sheet.scrollTop = scrollTop;
  if (focusedId) byId(focusedId)?.focus();
}

function createField(labelText, control) {
  const field = makeElement('div', 'field');
  field.append(makeElement('span', 'field-label', labelText), control);
  return field;
}

// 배지 색: 빠른 선택 색 + [다른 색] (색상 선택 창)
function createColorField(name, list, updatePreview) {
  const current = (list.color || AG_DEFAULT_LIST_COLOR).toLowerCase();
  const row = makeElement('div', 'swatches');
  let matched = false;

  AG_SWATCH_COLORS.forEach(([color, label], i) => {
    const selected = color === current;
    if (selected) matched = true;
    const swatch = makeElement('button', 'swatch', undefined, 'button');
    swatch.id = `sheet-swatch-${i}`;
    swatch.style.background = color;
    swatch.title = label;
    swatch.setAttribute('aria-label', `배지 색 ${label}`);
    swatch.setAttribute('aria-pressed', String(selected));
    swatch.addEventListener('click', () => saveListField(name, 'color', color));
    row.appendChild(swatch);
  });

  // [다른 색] 버튼: 빠른 선택에 없는 색을 쓰는 중이면 점에 그 색을 보여 주고 선택 표시
  const customBtn = makeElement('label', 'swatch-custom-btn' + (matched ? '' : ' is-selected'));
  customBtn.title = '색상 창에서 원하는 색을 고릅니다';
  const dot = makeElement('span', 'swatch-custom-dot');
  dot.setAttribute('aria-hidden', 'true');
  if (!matched) dot.style.background = current;
  const custom = makeElement('input', null, undefined, 'color');
  custom.id = 'sheet-color-custom';
  custom.value = current;
  custom.setAttribute('aria-label', matched ? '배지 색 직접 고르기' : `배지 색 직접 고르기 (지금 ${current})`);
  custom.addEventListener('input', (e) => {
    dot.style.background = e.target.value;
    updatePreview({ color: e.target.value });
  });
  custom.addEventListener('change', e => saveListField(name, 'color', e.target.value));
  customBtn.append(dot, makeElement('span', null, '다른 색'), custom);
  row.appendChild(customBtn);

  return createField('배지 색', row);
}

// 이 리스트만의 글자 스타일: [글자 크기] [폰트] / 글자 색 · 상태 / [공통 설정 따르기] [모든 리스트에 적용]
// 값을 바꾸면 그 항목만 이 리스트에 저장되고, 나머지 항목은 공통 설정을 따름
function createTextStyleFields(name, list, effective, updatePreview) {
  const hasCustom = !!normalizeListStyle(list.style);
  const saveStyle = patch => updateLists(l => setListStyle(l, name, patch));
  const wrap = makeElement('div', 'field');

  const sizeSelect = makeElement('select', 'select');
  sizeSelect.id = 'sheet-font-size';
  sizeSelect.setAttribute('aria-label', `'${name}' 배지 글자 크기`);
  fillSizeOptions(sizeSelect, effective.fontSize);
  sizeSelect.addEventListener('change', e => saveStyle({ fontSize: parseInt(e.target.value, 10) }));

  const fontSelect = makeElement('select', 'select');
  fontSelect.id = 'sheet-font-family';
  fontSelect.setAttribute('aria-label', `'${name}' 배지 폰트`);
  fillFontOptions(fontSelect, effective.fontFamily);
  fontSelect.addEventListener('change', e => saveStyle({ fontFamily: e.target.value }));

  const grid = makeElement('div', 'grid-2');
  grid.append(createField('글자 크기', sizeSelect), createField('폰트', fontSelect));

  const colorInput = makeElement('input', 'color-input', undefined, 'color');
  colorInput.id = 'sheet-text-color';
  colorInput.value = effective.textColor;
  colorInput.setAttribute('aria-label', `'${name}' 배지 글자 색`);
  colorInput.addEventListener('input', e => updatePreview({ textColor: e.target.value }));
  colorInput.addEventListener('change', e => saveStyle({ textColor: e.target.value }));

  const colorRow = makeElement('div', 'text-color-row');
  colorRow.append(
    makeElement('span', 'field-label', '글자 색'),
    colorInput,
    makeElement('span', 'list-style-state' + (hasCustom ? ' custom' : ''), hasCustom ? '이 리스트만 따로 설정됨' : '공통 설정 사용 중')
  );

  const resetBtn = makeElement('button', 'btn small', '공통 설정 따르기', 'button');
  resetBtn.id = 'sheet-style-reset-btn';
  resetBtn.disabled = !hasCustom;
  resetBtn.title = '이 리스트만의 글자 스타일을 지우고 공통 설정을 따릅니다.';
  resetBtn.addEventListener('click', () => {
    updateLists((l) => {
      if (!l[name] || !l[name].style) return false;
      delete l[name].style;
    });
  });

  const applyAllBtn = makeElement('button', 'btn small', '이 스타일을 모든 리스트에 적용', 'button');
  applyAllBtn.id = 'sheet-style-apply-all-btn';
  applyAllBtn.title = '이 스타일을 공통 설정으로 만들고, 다른 리스트의 개별 스타일을 지웁니다.';
  applyAllBtn.addEventListener('click', () => applyListStyleToAll(name, effective));

  const actions = makeElement('div', 'list-style-actions');
  actions.append(resetBtn, applyAllBtn);

  wrap.append(grid, colorRow, actions);
  return wrap;
}

// 타임라인 표시: 배지만 / 강조 / 흐리게 (라디오 버튼 → 방향키로 고를 수 있음)
function createModeField(name, list) {
  const group = makeElement('div', 'segmented');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', '타임라인 표시');
  const current = isValidMode(list.mode) ? list.mode : 'normal';
  AG_VALID_MODES.forEach((mode) => {
    const label = makeElement('label');
    const input = makeElement('input', null, undefined, 'radio');
    input.name = 'sheet-mode';
    input.id = `sheet-mode-${mode}`;
    input.value = mode;
    input.checked = mode === current;
    input.addEventListener('change', () => {
      if (input.checked) saveListField(name, 'mode', mode);
    });
    label.append(input, makeElement('span', null, AG_MODE_LABELS[mode]));
    group.appendChild(label);
  });
  return createField('타임라인 표시', group);
}

// 미리보기 트윗: 실제 배지와 같은 함수로 스타일 적용, 강조(왼쪽 색 띠)·흐리게(본문만 흐림)도 보여 줌
function createSheetPreview(name, list, effective) {
  const element = makeElement('div', 'tweet-preview');
  element.setAttribute('aria-label', '타임라인 미리보기');
  const chip = makeElement('span', 'badge-chip list-style-preview', name);
  const main = makeElement('div', 'tweet-main');
  const nameRow = makeElement('div', 'tweet-name');
  const handle = list.members[0] || '@member';
  nameRow.append(makeElement('strong', null, '미리보기'), chip, makeElement('span', 'muted', `${handle} · 방금`));
  main.append(nameRow, makeElement('div', 'tweet-text', '이 리스트 멤버의 트윗은 이렇게 보입니다.'));
  element.append(makeElement('div', 'tweet-avatar'), main);

  const update = (overrides) => {
    const o = overrides || {};
    const color = o.color || list.color || AG_DEFAULT_LIST_COLOR;
    applyBadgeStyle(chip, color, Object.assign({}, effective, o.textColor ? { textColor: o.textColor } : {}), true);
    element.style.boxShadow = list.mode === 'highlight' ? `inset 4px 0 0 ${color}` : '';
    element.classList.toggle('is-dim', list.mode === 'dim');
  };
  update();
  return { element, update };
}

// [멤버 N명 보기] [리스트 삭제]
function createSheetFooter(name, list) {
  const footer = makeElement('div', 'sheet-footer');

  const membersBtn = makeElement('button', 'btn', sheetMembersOpen ? '멤버 목록 접기' : `멤버 ${list.members.length}명 보기`, 'button');
  membersBtn.id = 'sheet-members-btn';
  membersBtn.setAttribute('aria-expanded', String(sheetMembersOpen));
  membersBtn.setAttribute('aria-controls', 'sheet-members');
  membersBtn.addEventListener('click', () => {
    sheetMembersOpen = !sheetMembersOpen;
    renderSheet();
    if (sheetMembersOpen) byId('sheet-members')?.scrollIntoView({ block: 'nearest' });
  });

  const deleteBtn = makeElement('button', 'btn danger-text', '리스트 삭제', 'button');
  deleteBtn.id = 'sheet-delete-btn';
  deleteBtn.setAttribute('aria-label', `'${name}' 리스트 삭제`);
  deleteBtn.addEventListener('click', async () => {
    if (!await askConfirm(`'${name}' 리스트를 삭제할까요?`, '삭제')) return;
    updateLists((l) => { if (!l[name]) return false; delete l[name]; });
  });

  footer.append(membersBtn, deleteBtn);
  return footer;
}

function createMembersList(name, list) {
  const el = makeElement('div', 'members-list');
  el.id = 'sheet-members';
  if (list.members.length === 0) {
    el.appendChild(makeElement('span', 'members-empty', '멤버가 없습니다.'));
  } else {
    list.members.forEach((member, i) => el.appendChild(createMemberChip(name, member, i)));
  }
  return el;
}

// 멤버 한 명: "@handle ×"
function createMemberChip(listName, member, index) {
  const chip = makeElement('span', 'member-handle', member);
  const removeBtn = makeElement('button', 'remove-member-btn', '×', 'button');
  // 지운 뒤 다시 그리면 같은 자리(다음 멤버)의 버튼으로 포커스가 감
  removeBtn.id = `sheet-member-remove-${index}`;
  removeBtn.title = `'${member}' 제거`;
  removeBtn.setAttribute('aria-label', `'${member}' 제거`);
  removeBtn.addEventListener('click', () => {
    updateLists(l => removeMemberFromLists(l, listName, member));
  });
  chip.appendChild(removeBtn);
  return chip;
}

// 한 리스트의 글자 스타일을 모든 리스트에 적용: 공통 설정을 그 스타일로 바꾸고 모든 개별 스타일을 지움
async function applyListStyleToAll(name, effective) {
  const message = `'${name}' 리스트의 글자 스타일을 모든 리스트에 적용할까요?\n` +
    '공통 설정이 이 스타일로 바뀌고, 리스트별로 따로 정한 글자 스타일은 지워집니다.';
  if (!await askConfirm(message, '모두 적용')) return;

  badgeSettings = { textColor: effective.textColor, fontSize: effective.fontSize, fontFamily: effective.fontFamily };
  try {
    await chrome.storage.local.set({ badgeSettings });
  } catch {
    showSyncStatus('배지 설정 저장에 실패했습니다.', true);
    return;
  }
  applyBadgeSettingsUI();
  const ok = await updateLists((l) => {
    clearAllListStyles(l);
  });
  if (ok) showSyncStatus(`'${name}' 리스트의 글자 스타일을 모든 리스트에 적용했습니다.`, false);
}

// ==========================================
// 9. 배지 기본 스타일 (모든 리스트 공통)
// ==========================================

function fillSizeOptions(select, selected) {
  FONT_SIZES.forEach((size) => {
    const opt = makeElement('option', null, `${size}px`);
    opt.value = String(size);
    opt.selected = size === selected;
    select.appendChild(opt);
  });
}

function fillFontOptions(select, selected) {
  AG_FONT_FAMILIES.forEach((font) => {
    const opt = makeElement('option', null, AG_FONT_LABELS[font] || font);
    opt.value = font;
    opt.selected = font === selected;
    select.appendChild(opt);
  });
}

// 공통 설정 영역의 "개별 스타일 N개" 안내
function updateCustomStyleCount() {
  const label = byId('badge-custom-count');
  if (!label) return;
  const count = countListsWithStyle(renderedLists);
  label.textContent = count > 0 ? `개별 스타일을 쓰는 리스트 ${count}개` : '모든 리스트가 공통 스타일 사용 중';
}

// 공통 설정 [모든 리스트에 적용]: 리스트별 글자 스타일을 모두 지워 공통 스타일을 쓰게 함
async function applyCommonStyleToAll() {
  const result = await chrome.storage.local.get(['lists']);
  const count = countListsWithStyle(result.lists || {});
  if (count === 0) {
    showSyncStatus('이미 모든 리스트가 공통 스타일을 사용하고 있습니다.', false);
    return;
  }
  if (!await askConfirm(`리스트 ${count}개의 개별 글자 스타일을 지우고, 모든 리스트에 공통 스타일을 적용할까요?`, '모두 적용')) return;
  const ok = await updateLists((l) => {
    clearAllListStyles(l);
  });
  if (ok) showSyncStatus(`모든 리스트에 공통 스타일을 적용했습니다. (개별 스타일 ${count}개 해제)`, false);
}

async function loadBadgeSettings() {
  const result = await chrome.storage.local.get(['badgeSettings']);
  badgeSettings = { ...AG_DEFAULT_BADGE_SETTINGS, ...(result.badgeSettings || {}) };
  applyBadgeSettingsUI();
}

// 컬러 피커는 드래그하는 동안 input 이벤트가 계속 일어나므로 묶어서 저장
const saveBadgeSettings = debounce(() => {
  chrome.storage.local.set({ badgeSettings }).catch((err) => {
    showSyncStatus('배지 설정 저장에 실패했습니다.', true);
    console.error(err);
  });
}, 150);

// 현재 설정값을 입력란과 미리보기에 반영
function applyBadgeSettingsUI() {
  const colorInput = byId('badge-text-color');
  const sizeInput = byId('badge-font-size');
  const fontInput = byId('badge-font-family');
  if (colorInput) colorInput.value = badgeSettings.textColor;
  if (sizeInput) sizeInput.value = String(badgeSettings.fontSize);
  if (fontInput) fontInput.value = badgeSettings.fontFamily;
  updateBadgePreview();
}

// 미리보기도 타임라인과 같은 함수로 스타일 적용
function updateBadgePreview() {
  const preview = byId('badge-preview');
  if (preview) applyBadgeStyle(preview, AG_DEFAULT_LIST_COLOR, badgeSettings, true);
}

// 설정 하나를 바꾸고 미리보기·저장
function updateBadgeSetting(key, value) {
  badgeSettings[key] = value;
  updateBadgePreview();
  saveBadgeSettings();
}

function setupBadgeSettings() {
  const sizeSelect = byId('badge-font-size');
  const fontSelect = byId('badge-font-family');
  if (sizeSelect) fillSizeOptions(sizeSelect, badgeSettings.fontSize);
  if (fontSelect) fillFontOptions(fontSelect, badgeSettings.fontFamily);

  byId('badge-text-color')?.addEventListener('input', e => updateBadgeSetting('textColor', e.target.value));
  sizeSelect?.addEventListener('change', e => updateBadgeSetting('fontSize', parseInt(e.target.value, 10)));
  fontSelect?.addEventListener('change', e => updateBadgeSetting('fontFamily', e.target.value));

  byId('badge-reset-btn')?.addEventListener('click', () => {
    badgeSettings = { ...AG_DEFAULT_BADGE_SETTINGS };
    applyBadgeSettingsUI();
    saveBadgeSettings();
  });

  byId('badge-apply-all-btn')?.addEventListener('click', applyCommonStyleToAll);
}
