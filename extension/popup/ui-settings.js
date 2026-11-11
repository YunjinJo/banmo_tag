// popup/ui-settings.js — 화면 설정 (테마 · 리스트 정렬)
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

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
