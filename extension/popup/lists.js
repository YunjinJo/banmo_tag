// popup/lists.js — 리스트 표 (한 줄 = 리스트 하나, 누르면 설정 창)
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

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
