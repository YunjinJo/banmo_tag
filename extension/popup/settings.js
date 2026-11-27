// popup/settings.js — [설정] 시트 (머리글의 ⚙ 버튼): 배지 순서 · 타임라인 배지 표시 설정 · 미리보기
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).
//
// - 배지 순서: 리스트마다 priority(1 이 가장 앞)를 저장 (shared/list-data.js moveListPriority). 타임라인 배지와 강조 색이 이 순서를 따름
// - 표시 설정: chrome.storage.local 의 displaySettings (shared/badges.js normalizeDisplaySettings)
// - 미리보기: 타임라인과 같은 함수(addBadges)로 그리고, 배지 모양은 content 의 styles.css 를 함께 읽어 똑같이 보여 줌

// 리스트가 없을 때 미리보기에 쓰는 보기 리스트
const PREVIEW_SAMPLE_LISTS = {
  '친구': { color: '#c8174d', mode: 'normal' },
  '아주 긴 이름을 가진 리스트 예시': { color: '#7a3fd1', mode: 'normal' },
  '뉴스': { color: '#0b74c4', mode: 'normal' },
  '개발': { color: '#0f7b3e', mode: 'normal' },
  '게임': { color: '#b45309', mode: 'normal' }
};
// 배지 순서를 ▲ ▼ 로 옮긴 뒤 다시 그릴 때 포커스를 돌려줄 곳 { name, dir: 'up' | 'down' }
let priorityFocus = null;
// 끌어서 옮기는 중인 리스트 이름
let draggedPriorityName = null;

// ==========================================
// 열기 · 닫기
// ==========================================

function openSettings() {
  if (settingsOpen) return;
  settingsOpen = true;
  document.body.classList.add('sheet-open');
  byId('sheet-backdrop').hidden = false;
  const sheet = byId('settings-sheet');
  sheet.hidden = false;
  sheet.scrollTop = 0;
  renderSettings();
  updateInert();
  byId('settings-close-btn')?.focus();
}

function closeSettings() {
  if (!settingsOpen) return;
  settingsOpen = false;
  priorityFocus = null;
  document.body.classList.remove('sheet-open');
  byId('sheet-backdrop').hidden = true;
  byId('settings-sheet').hidden = true;
  // 미리보기는 열려 있을 때만 그림 (닫힌 시트에 미리보기 트윗을 남겨 두지 않음)
  const preview = byId('display-preview');
  if (preview) preview.textContent = '';
  updateInert();
  byId('settings-btn')?.focus();
}

// 열린 시트의 배지 순서·미리보기를 다시 그림 (리스트가 바뀌면 lists.js renderLists 가 부름)
function renderSettings() {
  if (!settingsOpen) return;
  renderPriorityList();
  renderDisplayPreview();
}

// ==========================================
// 배지 순서
// ==========================================

function renderPriorityList() {
  const listEl = byId('priority-list');
  if (!listEl) return;
  // 다시 그려도(다른 탭의 멤버 저장 등) 누르던 버튼에 포커스가 남도록
  const active = document.activeElement;
  const focusedId = active && listEl.contains(active) ? active.id : '';

  const names = sortListsByPriority(renderedLists);
  listEl.textContent = '';
  if (names.length === 0) listEl.appendChild(makeElement('li', 'priority-empty', '저장된 리스트가 없습니다.'));
  names.forEach((name, i) => listEl.appendChild(createPriorityRow(name, i, names.length)));

  const custom = hasCustomPriority(renderedLists);
  const state = byId('priority-state');
  if (state) state.textContent = custom ? '직접 정한 순서' : '이름순 (아직 정하지 않음)';
  const reset = byId('priority-reset-btn');
  if (reset) reset.disabled = !custom;

  if (!restorePriorityFocus() && focusedId) byId(focusedId)?.focus();
}

// 한 줄: [순번] [배지] … [▲] [▼]. 줄을 끌어서 옮길 수도 있음
function createPriorityRow(name, index, total) {
  const row = makeElement('li', 'priority-row');
  row.dataset.name = name;
  row.draggable = true;
  row.title = '끌어서 순서를 바꿀 수 있습니다';

  const num = makeElement('span', 'priority-num num', String(index + 1));
  num.setAttribute('aria-hidden', 'true');
  const chip = createBadgeChip(name, renderedLists[name], null, 'priority-name');
  chip.title = name;
  const actions = makeElement('span', 'priority-actions');
  actions.append(
    createPriorityButton(name, index, 'up', index === 0),
    createPriorityButton(name, index, 'down', index === total - 1)
  );
  row.append(num, chip, actions);
  setupPriorityDrag(row);
  return row;
}

function createPriorityButton(name, index, dir, disabled) {
  const up = dir === 'up';
  const btn = makeElement('button', 'icon-btn priority-move', up ? '▲' : '▼', 'button');
  btn.id = `priority-${dir}-${index}`;
  btn.title = up ? '앞으로' : '뒤로';
  btn.setAttribute('aria-label', `'${name}' 배지를 ${up ? '앞으로' : '뒤로'}`);
  btn.disabled = disabled;
  btn.addEventListener('click', async () => {
    priorityFocus = { name, dir };
    if (!await movePriority(name, up ? index - 1 : index + 1)) priorityFocus = null;
  });
  return btn;
}

// 리스트 하나를 배지 순서의 toIndex 번째(0 부터)로 옮겨 저장 (화면은 storage.onChanged 에서 다시 그림)
function movePriority(name, toIndex) {
  return updateLists(l => moveListPriority(l, name, toIndex));
}

// ▲ ▼ 로 옮긴 줄의 같은 버튼으로 포커스 (맨 앞·맨 뒤에 닿아 누를 수 없으면 반대쪽 버튼). 돌려줬으면 true
function restorePriorityFocus() {
  if (!priorityFocus) return false;
  const { name, dir } = priorityFocus;
  const row = [...document.querySelectorAll('#priority-list .priority-row')].find(r => r.dataset.name === name);
  if (!row) return false;
  priorityFocus = null;
  const [upBtn, downBtn] = row.querySelectorAll('.priority-move');
  const preferred = dir === 'up' ? upBtn : downBtn;
  (preferred.disabled ? (dir === 'up' ? downBtn : upBtn) : preferred).focus();
  return true;
}

// 끌어서 옮기기: 놓은 줄의 위쪽 절반이면 그 앞으로, 아래쪽 절반이면 그 뒤로
function setupPriorityDrag(row) {
  const isAfter = (e) => {
    const rect = row.getBoundingClientRect();
    return e.clientY > rect.top + rect.height / 2;
  };
  row.addEventListener('dragstart', (e) => {
    draggedPriorityName = row.dataset.name;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.name); // 파이어폭스는 데이터가 있어야 끌기가 시작됨
  });
  row.addEventListener('dragend', () => {
    draggedPriorityName = null;
    row.classList.remove('dragging');
    clearPriorityDropMarks();
  });
  row.addEventListener('dragover', (e) => {
    if (!draggedPriorityName) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearPriorityDropMarks();
    if (row.dataset.name !== draggedPriorityName) row.classList.add(isAfter(e) ? 'drop-after' : 'drop-before');
  });
  row.addEventListener('drop', (e) => {
    if (!draggedPriorityName) return;
    e.preventDefault();
    const name = draggedPriorityName;
    draggedPriorityName = null;
    clearPriorityDropMarks();
    const names = sortListsByPriority(renderedLists);
    const from = names.indexOf(name);
    let to = names.indexOf(row.dataset.name) + (isAfter(e) ? 1 : 0);
    if (from < to) to -= 1; // 빠진 자리만큼 앞당김
    movePriority(name, to);
  });
}

function clearPriorityDropMarks() {
  document.querySelectorAll('#priority-list .priority-row').forEach(r => r.classList.remove('drop-before', 'drop-after'));
}

// [이름순으로 되돌리기]: 직접 정한 배지 순서를 지움
async function resetPriority() {
  if (!hasCustomPriority(renderedLists)) return;
  if (!await askConfirm('배지 순서를 이름순으로 되돌릴까요?', '되돌리기')) return;
  const ok = await updateLists(l => clearListPriority(l) > 0);
  if (ok) showSyncStatus('배지 순서를 이름순으로 되돌렸습니다.', false);
}

// ==========================================
// 타임라인 배지 표시 설정
// ==========================================

function fillDisplayOptions() {
  const option = (value, label) => {
    const opt = makeElement('option', null, label);
    opt.value = value;
    return opt;
  };
  const max = byId('display-max-badges');
  if (max) {
    for (let n = 1; n <= AG_MAX_BADGES_LIMIT; n++) max.appendChild(option(String(n), `${n}개`));
    max.appendChild(option('0', '모두'));
  }
  const width = byId('display-name-width');
  if (width) AG_NAME_WIDTHS.forEach(w => width.appendChild(option(String(w), `약 ${w}글자`)));
}

async function loadDisplaySettings() {
  const result = await chrome.storage.local.get(['displaySettings']);
  displaySettings = normalizeDisplaySettings(result.displaySettings);
  applyDisplaySettingsUI();
}

// 현재 설정값을 입력란·미리보기에 반영. 팝업의 배지(리스트 줄·시트)도 같은 모서리·흐리게 정도로 보여 줌
function applyDisplaySettingsUI() {
  const d = displaySettings;
  const setValue = (id, value) => {
    const el = byId(id);
    if (el) el.value = value;
  };
  const setChecked = (id, checked) => {
    const el = byId(id);
    if (el) el.checked = checked;
  };
  setValue('display-max-badges', String(d.maxBadges));
  setChecked('display-ellipsis', d.ellipsis);
  setValue('display-name-width', String(d.nameWidth));
  const width = byId('display-name-width');
  if (width) width.disabled = !d.ellipsis;
  setChecked('display-shape-' + d.badgeShape, true);
  setChecked('display-quote-badges', d.quoteBadges);
  setChecked('display-dim-' + d.dimLevel, true);

  const root = document.documentElement.style;
  root.setProperty('--ag-badge-radius', AG_BADGE_RADII[d.badgeShape]);
  root.setProperty('--ag-dim-opacity', String(AG_DIM_OPACITY[d.dimLevel]));
  renderDisplayPreview();
}

// 설정 하나를 바꾸고 미리보기·저장. patch 가 null 이면 모두 기본값으로
function saveDisplaySettings(patch) {
  displaySettings = normalizeDisplaySettings(patch ? { ...displaySettings, ...patch } : null);
  applyDisplaySettingsUI();
  chrome.storage.local.set({ displaySettings }).catch((err) => {
    showSyncStatus('표시 설정 저장에 실패했습니다.', true);
    console.error(err);
  });
}

// 미리보기: 모든 리스트에 속한 사람의 트윗(인용 트윗 포함)과 흐리게 리스트 멤버의 트윗.
// 배지는 타임라인과 같은 순서·함수로 그림. 리스트가 없으면 보기 리스트로
function renderDisplayPreview() {
  const box = byId('display-preview');
  if (!box || !settingsOpen) return;
  const names = sortListsByPriority(renderedLists);
  const source = names.length > 0 ? renderedLists : PREVIEW_SAMPLE_LISTS;
  const all = {};
  Object.keys(source).forEach((name) => {
    all[name] = Object.assign({}, source[name], { members: ['@preview'] });
  });
  const entries = buildHandleMap(all)['@preview'] || [];

  const author = createPreviewAuthor('미리보기', '@member · 방금');
  const quoteAuthor = createPreviewAuthor('인용된 사람', '@quoted');
  const quote = makeElement('div', 'preview-quote');
  quote.append(quoteAuthor, makeElement('div', 'tweet-text', '인용된 트윗'));
  const main = makeElement('div', 'tweet-main');
  main.append(author, makeElement('div', 'tweet-text', '모든 리스트에 속한 사람의 트윗은 이렇게 보입니다.'), quote);
  const tweet = makeElement('div', 'tweet-preview');
  tweet.append(makeElement('div', 'tweet-avatar'), main);
  addBadges(author, entries, true, badgeSettings, displaySettings);
  if (displaySettings.quoteBadges) addBadges(quoteAuthor, entries, false, badgeSettings, displaySettings);

  const dimMain = makeElement('div', 'tweet-main');
  dimMain.append(createPreviewAuthor('흐리게 리스트 멤버', '@dimmed'),
    makeElement('div', 'tweet-text', '흐리게 표시하는 리스트 멤버의 트윗은 본문이 이만큼 흐려집니다.'));
  const dimTweet = makeElement('div', 'tweet-preview is-dim');
  dimTweet.append(makeElement('div', 'tweet-avatar'), dimMain);

  box.textContent = '';
  box.append(tweet, dimTweet);
}

// 미리보기 작성자 줄: X 의 이름 영역처럼 이름 링크의 부모(span)에 배지가 붙음 (shared/badges.js getBadgeAnchor)
function createPreviewAuthor(name, handle) {
  const row = makeElement('div', 'tweet-name preview-author');
  const nameWrap = makeElement('span', 'preview-name');
  nameWrap.appendChild(makeElement('a', 'preview-link', name));
  row.append(nameWrap, makeElement('span', 'muted', handle));
  return row;
}

function setupSettings() {
  fillDisplayOptions();
  byId('settings-btn')?.addEventListener('click', openSettings);
  byId('settings-close-btn')?.addEventListener('click', closeSettings);
  byId('sheet-backdrop')?.addEventListener('click', closeSettings);
  byId('priority-reset-btn')?.addEventListener('click', resetPriority);

  byId('display-max-badges')?.addEventListener('change', e => saveDisplaySettings({ maxBadges: parseInt(e.target.value, 10) }));
  byId('display-ellipsis')?.addEventListener('change', e => saveDisplaySettings({ ellipsis: e.target.checked }));
  byId('display-name-width')?.addEventListener('change', e => saveDisplaySettings({ nameWidth: parseInt(e.target.value, 10) }));
  byId('display-quote-badges')?.addEventListener('change', e => saveDisplaySettings({ quoteBadges: e.target.checked }));
  [['display-shape', 'badgeShape'], ['display-dim', 'dimLevel']].forEach(([group, key]) => {
    document.querySelectorAll(`input[name="${group}"]`).forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) saveDisplaySettings({ [key]: input.value });
      });
    });
  });
  byId('display-reset-btn')?.addEventListener('click', () => saveDisplaySettings(null));
}
