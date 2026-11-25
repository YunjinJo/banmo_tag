// popup/tab-view.js — 새 탭에서 열기(popup.html?view=tab) · 파이어폭스 팝업 우회
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

function isFirefox() {
  return getBrowserKind(chrome.runtime.getURL('')) === 'firefox';
}

// 이 화면을 일반 탭에서 열기. [가져오기]·[뺀 멤버 정리]가 지금 보던 탭을 대상으로 하도록 그 탭 id 를 넘김.
// listName 을 주면 새 탭 화면에서 그 리스트의 설정 시트를 열어 둠. extraParams: 주소에 더 붙일 값 (예: { font: 'list' })
async function openInTab(listName, extraParams) {
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
  Object.keys(extraParams || {}).forEach(key => url.searchParams.set(key, extraParams[key]));
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
