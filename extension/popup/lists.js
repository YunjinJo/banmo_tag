// popup/lists.js — 직접 리스트 추가 · 리스트 표 · 리스트 설정 창
// 팝업 화면은 여러 파일로 나뉘어 있고, popup.html 이 shared.js → popup/*.js → popup.js 순서로 읽습니다.
// 파일들은 일반 스크립트라 최상위 함수·변수를 서로 공유합니다(목차는 popup.js 참고).

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
