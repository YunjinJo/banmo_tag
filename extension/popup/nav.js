// popup/nav.js — 탭(리스트 · 배지 스타일 · 도움말) · ⋯ 메뉴
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

// ==========================================
// 탭
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

// ==========================================
// ⋯ 메뉴
// ==========================================

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
