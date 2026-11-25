// popup.js — 확장 프로그램 팝업 화면의 시작점
// 화면이 준비되면 각 기능을 연결하고(setup…), 저장 데이터가 바뀌면 화면을 다시 그립니다.
//
// 팝업 코드는 화면 단위 파일로 나뉘어 있습니다. popup.html 이 아래 순서로 읽고, 모두 일반 스크립트(ES module 아님)라
// 최상위 함수·변수를 서로 공유합니다. 새 파일을 만들면 popup.html 에 추가합니다 (`node scripts/validate.js` 가 확인).
//
//   theme.js               첫 화면 전에 테마 적용 (<head> 에서 가장 먼저)
//   shared/*.js            공통 로직 (cleanListName, sanitizeListsObject, applyBadgeStyle … 목록은 shared/base.js 머리말)
//   popup/core.js          상태 · 작은 도우미(byId, makeElement) · 공통 UI(상태 메시지, 확인 상자) · 리스트 저장 큐(updateLists)
//   popup/tab-view.js      새 탭에서 열기 · 파이어폭스 팝업 우회
//   popup/nav.js           탭 · ⋯ 메뉴
//   popup/ui-settings.js   화면 설정 (테마 · 리스트 정렬)
//   popup/sync.js          X 탭 연동: x.com 접근 권한 · [현재 탭에서 가져오기] · [뺀 멤버 정리] · X 화면 구조 경고
//   popup/backup.js        백업 · 복원 · 초기화
//   popup/manual-add.js    직접 리스트 추가
//   popup/lists.js         리스트 표
//   popup/sheet.js         리스트 설정 창(시트)
//   popup/badge.js         배지 기본 스타일 (모든 리스트 공통)
//   popup.js               시작 (이 파일. 마지막에 읽힘)
//
// 화면 모양은 popup/popup.css 에 있습니다.

document.addEventListener('DOMContentLoaded', () => {
  if (!SHARED_LOADED) {
    document.body.textContent = '공통 코드(shared/)를 불러오지 못했습니다. chrome://extensions 에서 banmo tag 를 새로고침해주세요.';
    console.error('[banmo_tag] shared/*.js not loaded');
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
