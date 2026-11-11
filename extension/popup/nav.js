// popup/nav.js — 새 탭 화면 · 파이어폭스 팝업 우회 · x.com 접근 권한 · 탭 · ⋯ 메뉴 · 화면 설정(테마 · 정렬)
// 팝업 화면은 여러 파일로 나뉘어 있고, popup.html 이 shared.js → popup/*.js → popup.js 순서로 읽습니다.
// 파일들은 일반 스크립트라 최상위 함수·변수를 서로 공유합니다(목차는 popup.js 참고).

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
