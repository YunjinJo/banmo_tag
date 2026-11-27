// popup/sheet.js — 리스트 설정 창(시트): 이름 바꾸기 · 배지 색 · 글자 스타일 · 타임라인 표시 · 미리보기 · 멤버 · 삭제
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

function setupSheet() {
  byId('sheet-close-btn')?.addEventListener('click', closeSheet);
  byId('sheet-backdrop')?.addEventListener('click', closeSheet);
  // [이름 바꾸기]: 시트 맨 위에 이름 입력란을 펼치거나 접음
  byId('sheet-rename-toggle-btn')?.addEventListener('click', () => {
    if (!openSheetName) return;
    sheetRenameOpen = !sheetRenameOpen;
    renderSheet();
    if (!sheetRenameOpen) return;
    byId('list-sheet').scrollTop = 0;
    const input = byId('sheet-name-input');
    input?.focus();
    input?.select();
  });
}

function openSheet(name) {
  if (!renderedLists[name]) return;
  openSheetName = name;
  sheetMembersOpen = false;
  sheetRenameOpen = false;
  pendingSheetRename = null;
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
  sheetRenameOpen = false;
  pendingSheetRename = null;
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
  // 이름을 고치는 중에 다시 그려져도(다른 탭의 멤버 저장 등) 입력하던 글자를 유지
  const nameDraft = sheetRenameOpen ? byId('sheet-name-input')?.value : undefined;
  const effective = getEffectiveBadgeSettings(badgeSettings, list.style);

  const title = byId('sheet-title');
  title.textContent = name;
  applyBadgeStyle(title, list.color, effective, true);
  byId('sheet-count').textContent = `${list.members.length}명`;
  const renameToggle = byId('sheet-rename-toggle-btn');
  if (renameToggle) {
    renameToggle.textContent = sheetRenameOpen ? '닫기' : '이름 바꾸기';
    renameToggle.setAttribute('aria-expanded', String(sheetRenameOpen));
  }

  // 미리보기는 저장 전에도(색 고르는 중) 바로 바뀌어야 하므로 먼저 만들고 갱신 함수를 넘김
  const preview = createSheetPreview(name, list, effective);
  body.textContent = '';
  if (sheetRenameOpen) body.appendChild(createNameField(name, list, nameDraft));
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

// 리스트 이름 바꾸기: [입력란] [저장]. X 에서 가져온 리스트면 이름이 어떻게 정해지는지 안내를 덧붙임
// draft: 다시 그리기 전에 입력란에 있던 글자 (없으면 지금 이름)
function createNameField(name, list, draft) {
  const input = makeElement('input', 'input', undefined, 'text');
  input.id = 'sheet-name-input';
  input.value = draft === undefined ? name : draft;
  input.maxLength = 50;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', `'${name}' 리스트의 새 이름`);

  const saveBtn = makeElement('button', 'btn primary', '저장', 'button');
  saveBtn.id = 'sheet-rename-btn';
  const updateSaveBtn = () => {
    const value = input.value.trim();
    saveBtn.disabled = !value || value === name;
  };
  input.addEventListener('input', updateSaveBtn);
  input.addEventListener('keydown', (e) => {
    // 한글을 조합하는 중의 Enter 는 글자를 확정하는 키이므로 저장하지 않음
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (!saveBtn.disabled) renameSheetList(name, input.value);
  });
  saveBtn.addEventListener('click', () => renameSheetList(name, input.value));
  updateSaveBtn();

  const row = makeElement('div', 'name-row');
  row.append(input, saveBtn);
  const field = createField('리스트 이름', row);
  if (list.listId) field.appendChild(createNameNote(name, list));
  return field;
}

// X 에서 가져온 리스트의 이름 안내: 직접 지은 이름이면 [X 이름 따르기], 아니면 X 이름을 따라간다는 설명
function createNameNote(name, list) {
  const note = makeElement('div', 'name-note');
  if (list.customName !== true) {
    note.appendChild(makeElement('p', 'hint-line',
      'X 에서 리스트 이름을 바꾸면 다음에 멤버를 가져올 때 이 이름도 바뀝니다. 여기서 직접 바꾼 이름은 그대로 둡니다.'));
    return note;
  }

  const followBtn = makeElement('button', 'btn small', 'X 이름 따르기', 'button');
  followBtn.id = 'sheet-name-follow-btn';
  followBtn.title = '다음에 이 리스트의 멤버를 가져올 때 X 의 리스트 이름으로 바뀝니다.';
  followBtn.addEventListener('click', async () => {
    const saved = await updateLists((l) => {
      if (!l[name] || l[name].customName !== true) return false;
      delete l[name].customName;
    });
    if (!saved) return;
    showSyncStatus('다음에 이 리스트의 멤버를 가져올 때 X 의 리스트 이름으로 바뀝니다.', false);
    byId('sheet-name-input')?.focus();
  });
  note.append(makeElement('p', 'hint-line', '직접 지은 이름이라 X 에서 리스트 이름이 바뀌어도 그대로 둡니다.'), followBtn);
  return note;
}

// 이름 바꾸기 저장. 색·표시 방식·글자 스타일·멤버는 그대로 새 이름으로 옮겨지고, 시트는 열린 채 새 이름을 보여 줌
async function renameSheetList(name, rawValue) {
  let outcome = null;
  const saved = await updateLists((l) => {
    outcome = renameList(l, name, rawValue);
    if (!outcome.success) return false;
    // 저장이 끝나 화면을 다시 그릴 때 시트가 닫히지 않고 새 이름을 따라가도록 (lists.js renderLists)
    pendingSheetRename = { from: name, to: outcome.name };
  });
  if (!outcome) return; // 저장소를 읽지 못함 (updateLists 가 이미 알림)
  if (!outcome.success) {
    showSyncStatus(outcome.message, true);
    byId('sheet-name-input')?.focus();
    return;
  }
  if (!saved) {
    pendingSheetRename = null;
    return;
  }

  sheetRenameOpen = false;
  renderSheet();
  showSyncStatus(`리스트 이름을 '${outcome.name}'(으)로 바꿨습니다.`, false);
  byId('sheet-rename-toggle-btn')?.focus();
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
  fontSelect.addEventListener('change', () => {
    handleFontSelectChange(fontSelect, effective.fontFamily, name, font => saveStyle({ fontFamily: font }));
  });

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
