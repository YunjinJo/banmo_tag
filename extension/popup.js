// popup.js — 확장 프로그램 팝업 화면의 시작점
// 공통 로직(cleanListName, sanitizeListsObject, parseHandles 등)은 popup.html 에서 먼저 로드되는 shared.js 에 있습니다.
// 첫 화면 전에 테마를 적용하는 부분은 theme.js, 화면 모양은 popup/popup.css 에 있습니다.
//
// 팝업 코드는 기능별 파일로 나뉘어 있습니다. popup.html 이 아래 순서로 읽고, 모두 일반 스크립트라
// 최상위 함수·변수를 서로 공유합니다. 이 파일은 마지막에 읽혀 화면이 준비되면 각 기능을 연결합니다.
//
//   popup/core.js     0. 상태 · 2. 공통 UI(상태 메시지, 확인 상자, 뒤 화면 잠그기) · 3. 리스트 저장 큐
//   popup/nav.js      2-1. 새 탭 화면 · 파이어폭스 팝업 우회 · x.com 접근 권한 / 2-2. 탭 · ⋯ 메뉴 / 2-3. 화면 설정
//   popup/sync.js     4. X 탭 연동([현재 탭에서 가져오기], [뺀 멤버 정리]) · 5. X 화면 구조 경고
//   popup/backup.js   7. 백업 · 복원 · 초기화
//   popup/lists.js    6. 직접 리스트 추가 · 8. 리스트 표 · 8-1. 리스트 설정 창
//   popup/badge.js    9. 배지 기본 스타일 (모든 리스트 공통)
//   popup.js          1. 시작 (이 파일)

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
