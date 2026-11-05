// popup.js — 확장 프로그램 팝업 화면
// 공통 로직(cleanListName, sanitizeListsObject, parseHandles 등)은 popup.html 에서 먼저 로드되는 shared.js 에 있습니다.
//
// 목차
//   0. 상태
//   1. 시작
//   2. 공통 UI (상태 메시지, 확인 상자)
//   3. 리스트 저장 (순서대로 처리)
//   4. X 탭 연동 ([⚡ 가져오기], [🔄 교체 동기화])
//   5. X 화면 구조 경고
//   6. 직접 리스트 추가
//   7. 백업 · 복원 · 초기화
//   8. 리스트 목록 (리스트별 글자 스타일 편집 포함)
//   9. 배지 스타일 설정 (모든 리스트 공통)

// ==========================================
// 0. 상태
// ==========================================

// shared.js 가 없으면 아무 기능도 동작하지 않으므로, 증상을 숨기는 폴백 대신 시작 시 원인을 알림
const SHARED_LOADED = typeof sanitizeListsObject === 'function';

let badgeSettings = SHARED_LOADED ? { ...AG_DEFAULT_BADGE_SETTINGS } : {};
// 펼쳐 둔 리스트 이름 (목록을 다시 그려도 펼침 상태 유지)
const expandedLists = new Set();
// 마지막으로 그린 리스트 데이터 (공통 설정의 "개별 스타일 N개" 표시용)
let renderedLists = {};
// 파일에서 읽어 [병합]/[덮어쓰기] 선택을 기다리는 데이터 ({ lists, badgeSettings })
let pendingImport = null;
let statusTimer = null;
// 확인 상자가 열려 있을 때 답을 전달하는 함수
let resolveConfirm = null;

const byId = id => document.getElementById(id);

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

  setupConfirmBox();
  // 리스트별 스타일 편집란이 공통 설정 기준 값을 보여야 하므로, 공통 설정을 먼저 읽고 목록을 그림
  loadBadgeSettings().then(loadLists);
  loadHealthWarning();
  setupSyncButtons();
  setupManualAdd();
  setupBackupRestore();
  setupBadgeSettings();

  // 리스트가 바뀌면(자동 수집 포함) 바로 다시 그림. 연속 변경은 묶어서 한 번만.
  // 정제된 데이터는 다시 정제해도 바뀌지 않으므로 저장 → 변경 감지 → 저장의 무한 반복이 생기지 않음
  const debouncedLoad = debounce(loadLists, 100);
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    // 공통 배지 설정이 바뀌어도 리스트별 스타일 편집란(실제 적용 값 표시)을 다시 그림
    if (changes.lists || changes.badgeSettings) debouncedLoad();
    if (changes.structureHealth) renderHealthWarning(changes.structureHealth.newValue);
  });
});

// ==========================================
// 2. 공통 UI (상태 메시지, 확인 상자)
// ==========================================

// 상단 상태 메시지 (5초 뒤 사라짐)
function showSyncStatus(message, isError = false) {
  const statusEl = byId('sync-status');
  if (!statusEl) return;
  statusEl.className = 'sync-status ' + (isError ? 'error' : 'success');
  statusEl.textContent = message;
  statusEl.style.display = 'block';

  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.style.display = 'none';
  }, 5000);
}

// 팝업 안의 확인 상자 (브라우저 confirm() 대신). 확인하면 true, 취소하면 false
function askConfirm(message, okLabel = '확인') {
  const box = byId('confirm-box');
  const text = byId('confirm-text');
  const okBtn = byId('confirm-ok-btn');
  if (!box || !text || !okBtn) return Promise.resolve(false);

  if (resolveConfirm) resolveConfirm(false); // 이전 확인 요청은 취소로 처리
  text.textContent = message;
  okBtn.textContent = okLabel;
  box.style.display = 'flex';
  okBtn.focus();

  return new Promise((resolve) => {
    resolveConfirm = (answer) => {
      resolveConfirm = null;
      box.style.display = 'none';
      resolve(answer);
    };
  });
}

function setupConfirmBox() {
  byId('confirm-ok-btn')?.addEventListener('click', () => resolveConfirm && resolveConfirm(true));
  byId('confirm-cancel-btn')?.addEventListener('click', () => resolveConfirm && resolveConfirm(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && resolveConfirm) resolveConfirm(false);
  });
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
// 3. 리스트 저장 (순서대로 처리)
// ==========================================

// 모든 리스트 변경은 이 함수를 거칩니다.
// 읽기 → 수정 → 쓰기가 겹치면 앞선 변경이 사라지므로 Promise 큐로 하나씩 처리합니다.
// mutator 가 false 를 반환하면 저장하지 않습니다. 화면은 storage.onChanged 에서 다시 그립니다.
let writeQueue = Promise.resolve();

function updateLists(mutator) {
  const run = writeQueue.then(async () => {
    const result = await chrome.storage.local.get(['lists']);
    const { newLists } = sanitizeListsObject(result.lists || {});
    if (mutator(newLists) === false) return false;
    await chrome.storage.local.set({ lists: newLists });
    return true;
  });
  writeQueue = run.catch(() => {});
  return run.catch((err) => {
    console.error('[banmo_tag] 저장 실패:', err);
    showSyncStatus('저장에 실패했습니다: ' + (err && err.message ? err.message : err), true);
    return false;
  });
}

// ==========================================
// 4. X 탭 연동 ([⚡ 가져오기], [🔄 교체 동기화])
// ==========================================

const TAB_CONNECTION_ERROR = '페이지에 연결할 수 없습니다. 트위터 탭을 새로고침(F5) 해주세요.';
const TAB_TIMEOUT_ERROR = '응답 시간이 초과되었습니다. 트위터 탭을 새로고침(F5) 후 다시 시도해주세요.';

// 탭의 content script 에 메시지를 보내고 응답을 기다림.
// 연결 실패는 { connectionError: true }, 시간 초과는 { timeoutError: true }
function sendTabMessage(tabId, message, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timeoutError: true });
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(chrome.runtime.lastError ? { connectionError: true } : response);
    });
  });
}

// 확장 프로그램 설치/새로고침 전에 열려 있던 탭에는 content script 가 없으므로 직접 넣음
async function injectContentScript(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['shared.js', 'content.js'] });
}

// 현재 X 탭에 요청을 보내고 응답을 받음. content script 가 없으면 한 번 넣고 다시 시도.
// 연결·시간 초과 문제는 { error: '안내 문구' } 로 정리해서 반환
async function requestFromActiveTab(message) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabError = getSyncTabError(activeTab);
  if (tabError) return { error: tabError };

  let response = await sendTabMessage(activeTab.id, message);
  if (response && response.connectionError) {
    try {
      await injectContentScript(activeTab.id);
    } catch {
      return { error: TAB_CONNECTION_ERROR };
    }
    response = await sendTabMessage(activeTab.id, message);
  }
  if (response && response.timeoutError) return { error: TAB_TIMEOUT_ERROR };
  if (!response || response.connectionError) return { error: TAB_CONNECTION_ERROR };
  return response;
}

function setupSyncButtons() {
  const syncBtn = byId('sync-current-tab-btn');
  const resyncBtn = byId('resync-replace-btn');
  syncBtn?.addEventListener('click', () => withButtonDisabled(syncBtn, syncCurrentTab));
  resyncBtn?.addEventListener('click', () => withButtonDisabled(resyncBtn, replaceSyncCurrentTab));
}

// [⚡ 가져오기]: 현재 화면의 멤버를 저장
async function syncCurrentTab() {
  showSyncStatus('데이터 수집 중...', false);
  const response = await requestFromActiveTab({ action: 'scrapeNow' });
  if (response.error) {
    showSyncStatus(response.error, true);
  } else if (response.success) {
    const detail = response.added > 0 ? `새로 ${response.added}명 추가` : '새 멤버 없음';
    showSyncStatus(`'${response.listName}' 총 ${response.count}명 (${detail})`, false);
  } else {
    showSyncStatus(response.message || '리스트 멤버를 찾을 수 없습니다. 멤버 화면을 열어주세요.', true);
  }
}

// [🔄 교체 동기화]: 미리보기 → 확인 → 저장 (X 리스트에서 뺀 멤버 정리)
async function replaceSyncCurrentTab() {
  const preview = await requestFromActiveTab({ action: 'replacePreview' });
  if (preview.error || !preview.success) {
    showSyncStatus(preview.error || preview.message || '교체 동기화를 준비하지 못했습니다.', true);
    return;
  }
  if (preview.removed.length === 0 && preview.added === 0) {
    showSyncStatus(`'${preview.listName}' 멤버 목록이 이미 최신입니다. (${preview.seenCount}명)`, false);
    return;
  }
  if (!await askConfirm(buildReplaceConfirmText(preview), '교체')) return;

  const saved = await requestFromActiveTab({ action: 'replaceNow' });
  if (saved.error || !saved.success) {
    showSyncStatus(saved.error || saved.message || '교체 동기화에 실패했습니다.', true);
    return;
  }
  showSyncStatus(`'${saved.listName}' 멤버를 교체했습니다. 총 ${saved.count}명 (추가 ${saved.added}명, 삭제 ${saved.removedCount}명)`, false);
}

// 교체 확인 문구 (삭제될 핸들 일부를 보여 주고, 절반 이상 삭제되면 강하게 경고)
function buildReplaceConfirmText(preview) {
  const removed = preview.removed || [];
  const shown = removed.slice(0, 5).join(', ') + (removed.length > 5 ? ` 외 ${removed.length - 5}명` : '');
  const lines = [];
  if (preview.previousCount > 0 && removed.length * 2 >= preview.previousCount) {
    lines.push(`⚠️ 저장된 ${preview.previousCount}명 중 절반 이상이 삭제됩니다. 멤버 화면을 끝까지 스크롤했는지 꼭 확인하세요.`);
  }
  lines.push(`'${preview.listName}' 멤버를 이번에 멤버 화면에서 확인한 ${preview.seenCount}명으로 교체합니다.`);
  lines.push(`삭제 ${removed.length}명${removed.length ? ': ' + shown : ''} / 추가 ${preview.added}명`);
  lines.push('화면에 한 번도 나오지 않은 멤버는 삭제되니, 목록을 끝까지 스크롤한 뒤 진행하세요.');
  return lines.join('\n');
}

// ==========================================
// 5. X 화면 구조 경고
// ==========================================

function renderHealthWarning(health) {
  const el = byId('health-warning');
  if (!el) return;
  el.textContent = '';

  const warnings = getStructureWarnings(health, Date.now(), 14);
  if (warnings.length === 0) {
    el.style.display = 'none';
    return;
  }

  const title = document.createElement('strong');
  title.textContent = '⚠️ X 화면 구조가 바뀌었을 수 있습니다';
  el.appendChild(title);
  warnings.forEach((w) => {
    const line = document.createElement('div');
    line.textContent = `• ${w.label}: ${w.message} (${new Date(w.at).toLocaleString()})`;
    el.appendChild(line);
  });
  const hint = document.createElement('div');
  hint.textContent = '수집이나 배지가 동작하지 않으면 확장 프로그램 업데이트가 필요합니다.';
  el.appendChild(hint);
  el.style.display = 'block';
}

async function loadHealthWarning() {
  const result = await chrome.storage.local.get(['structureHealth']);
  renderHealthWarning(result.structureHealth);
}

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
    toggleBtn.textContent = open ? '- 접기' : '+ 직접 리스트 추가';
    toggleBtn.setAttribute('aria-expanded', String(open));
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
  });
}

// ==========================================
// 7. 백업 · 복원 · 초기화
// ==========================================

function setupBackupRestore() {
  setupResetButton();
  setupExportButton();
  setupImport();
}

function setupResetButton() {
  byId('reset-btn')?.addEventListener('click', async () => {
    if (!await askConfirm('모든 리스트 데이터를 초기화할까요? 되돌릴 수 없습니다.', '초기화')) return;
    const ok = await updateLists((lists) => {
      Object.keys(lists).forEach(k => delete lists[k]);
    });
    if (ok) {
      expandedLists.clear();
      showSyncStatus('초기화되었습니다.', false);
    }
  });
}

// 객체를 JSON 파일로 내려받기
function downloadJson(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 📤 내보내기: 리스트와 배지 스타일 설정을 함께 저장
function setupExportButton() {
  byId('export-btn')?.addEventListener('click', async () => {
    const result = await chrome.storage.local.get(['lists', 'badgeSettings']);
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`banmo_tag_backup_${date}.json`, buildBackup(result.lists || {}, result.badgeSettings));
  });
}

// 📥 가져오기: 파일 읽기 → [병합] / [덮어쓰기] / [취소] 선택
function setupImport() {
  const importBtn = byId('import-btn');
  const importFile = byId('import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = ''; // 같은 파일을 다시 골라도 change 가 일어나도록
      if (file) readBackupFile(file);
    });
  }

  byId('import-merge-btn')?.addEventListener('click', mergeImport);
  byId('import-replace-btn')?.addEventListener('click', replaceImport);
  byId('import-cancel-btn')?.addEventListener('click', closeImportChoice);
}

function readBackupFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    let parsed;
    try {
      parsed = parseBackup(JSON.parse(ev.target.result));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      showSyncStatus('잘못된 파일 형식입니다. banmo_tag 백업 파일(JSON)을 선택해주세요.', true);
      return;
    }
    const count = Object.keys(parsed.lists).length;
    if (count === 0 && !parsed.badgeSettings) {
      showSyncStatus('가져올 리스트가 없습니다.', true);
      return;
    }
    openImportChoice(parsed, count);
  };
  reader.readAsText(file);
}

function openImportChoice(parsed, count) {
  pendingImport = parsed;
  const choiceText = byId('import-choice-text');
  if (choiceText) {
    choiceText.textContent = `${count}개 리스트를 가져옵니다.` +
      (parsed.badgeSettings ? ' (배지 스타일 설정 포함: 덮어쓰기 때 적용)' : '') + ' 방식을 선택하세요.';
  }
  const choiceEl = byId('import-choice');
  if (choiceEl) choiceEl.style.display = 'flex';
}

function closeImportChoice() {
  pendingImport = null;
  const choiceEl = byId('import-choice');
  if (choiceEl) choiceEl.style.display = 'none';
}

// [병합]: 기존 리스트의 색상/모드와 현재 배지 설정은 유지하고 멤버만 합침
// (이름이 같아도 listId 가 다르면 별개 리스트로 분리)
async function mergeImport() {
  const data = pendingImport;
  closeImportChoice();
  if (!data) return;
  const ok = await updateLists((lists) => {
    mergeImportedLists(lists, data.lists);
  });
  if (ok) showSyncStatus('기존 데이터와 병합했습니다.', false);
}

// [덮어쓰기]: 리스트를 파일 내용으로 바꾸고, 파일에 배지 설정이 있으면 그것도 복원
async function replaceImport() {
  const data = pendingImport;
  closeImportChoice();
  if (!data) return;
  if (!await askConfirm('기존 리스트를 모두 지우고 파일 내용으로 바꿉니다. 계속할까요?', '덮어쓰기')) return;

  const ok = await updateLists((lists) => {
    Object.keys(lists).forEach(k => delete lists[k]);
    Object.assign(lists, data.lists);
  });
  if (!ok) return;
  expandedLists.clear();

  if (data.badgeSettings) {
    try {
      await chrome.storage.local.set({ badgeSettings: data.badgeSettings });
      badgeSettings = { ...data.badgeSettings };
      applyBadgeSettingsUI();
    } catch {
      showSyncStatus('리스트는 복원했지만 배지 설정 저장에 실패했습니다.', true);
      return;
    }
  }
  showSyncStatus(data.badgeSettings ? '파일 내용(리스트 + 배지 설정)으로 덮어썼습니다.' : '파일 내용으로 덮어썼습니다.', false);
}

// ==========================================
// 8. 리스트 목록
// ==========================================

const MODE_OPTIONS = [['normal', '기본'], ['highlight', '강조'], ['dim', '흐리게']];

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

  // 스타일 편집란에서 값을 바꾸면 저장 후 목록을 다시 그리므로, 그 입력란에 포커스를 되돌려 줌
  const focusedId = document.activeElement && document.activeElement.id;
  container.textContent = '';

  const listNames = Object.keys(lists).filter(n => lists[n] && Array.isArray(lists[n].members));
  if (listNames.length === 0) {
    container.appendChild(createEmptyState());
    return;
  }

  // 사라진 리스트의 펼침 상태 정리
  [...expandedLists].forEach((n) => { if (!lists[n]) expandedLists.delete(n); });

  listNames.forEach((name, idx) => container.appendChild(createListRow(name, lists[name], idx)));

  if (focusedId && focusedId.startsWith('list-style-')) byId(focusedId)?.focus();
}

function createEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.append('저장된 리스트가 없습니다.', document.createElement('br'),
    '트위터 리스트의 멤버 화면을 열거나 상단 [가져오기]를 누르거나, 직접 추가해주세요.');
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

function memberCountText(list, open) {
  const styleMark = normalizeListStyle(list.style) ? ' · 🎨 개별 스타일' : '';
  return `${list.members.length}명 등록됨${styleMark} (클릭하여 ${open ? '접기' : '펼치기'})`;
}

// 리스트 한 줄: [이름·인원 (펼치기 버튼)] [모드] [색상] [삭제] + 펼치면 보이는 멤버 목록
function createListRow(name, list, idx) {
  const membersId = 'members-' + idx;
  const isOpen = expandedLists.has(name);

  const toggleBtn = makeElement('button', 'list-toggle', undefined, 'button');
  toggleBtn.setAttribute('aria-expanded', String(isOpen));
  toggleBtn.setAttribute('aria-controls', membersId);
  const countEl = makeElement('div', 'list-info', memberCountText(list, isOpen));
  toggleBtn.append(makeElement('div', 'list-name', name), countEl);

  const controlsDiv = makeElement('div', 'list-controls');
  controlsDiv.append(createModeSelect(name, list), createColorInput(name, list), createDeleteButton(name));

  const itemEl = makeElement('div', 'list-item');
  itemEl.append(toggleBtn, controlsDiv);

  const membersListEl = createMembersList(name, list, membersId, isOpen, idx);

  toggleBtn.addEventListener('click', () => {
    const open = membersListEl.classList.toggle('show');
    if (open) expandedLists.add(name); else expandedLists.delete(name);
    toggleBtn.setAttribute('aria-expanded', String(open));
    countEl.textContent = memberCountText(list, open);
  });

  const wrapperEl = makeElement('div', 'list-wrapper');
  wrapperEl.append(itemEl, membersListEl);
  return wrapperEl;
}

// 표시 모드 선택 (기본 / 강조 / 흐리게)
function createModeSelect(name, list) {
  const select = makeElement('select', 'mode-select');
  select.setAttribute('aria-label', `'${name}' 표시 모드`);
  MODE_OPTIONS.forEach(([value, text]) => {
    const opt = makeElement('option', null, text);
    opt.value = value;
    opt.selected = (list.mode || 'normal') === value;
    select.appendChild(opt);
  });
  select.addEventListener('change', (e) => {
    const mode = e.target.value;
    updateLists((l) => { if (!l[name]) return false; l[name].mode = mode; });
  });
  return select;
}

// 배지 색상 선택
function createColorInput(name, list) {
  const input = makeElement('input', 'color-picker', undefined, 'color');
  input.value = list.color || AG_DEFAULT_LIST_COLOR;
  input.setAttribute('aria-label', `'${name}' 배지 색상`);
  input.addEventListener('change', (e) => {
    const color = e.target.value;
    updateLists((l) => { if (!l[name]) return false; l[name].color = color; });
  });
  return input;
}

function createDeleteButton(name) {
  const button = makeElement('button', 'delete-list-btn', '×', 'button');
  button.title = '이 리스트 삭제';
  button.setAttribute('aria-label', `'${name}' 리스트 삭제`);
  button.addEventListener('click', async () => {
    if (!await askConfirm(`'${name}' 리스트를 삭제할까요?`, '삭제')) return;
    expandedLists.delete(name);
    updateLists((l) => { if (!l[name]) return false; delete l[name]; });
  });
  return button;
}

// 펼치면 보이는 영역: 이 리스트의 글자 스타일 편집 + 멤버 목록
function createMembersList(name, list, membersId, isOpen, idx) {
  const membersListEl = makeElement('div', 'members-list' + (isOpen ? ' show' : ''));
  membersListEl.id = membersId;
  membersListEl.appendChild(createListStyleEditor(name, list, idx));
  if (list.members.length === 0) {
    membersListEl.appendChild(makeElement('span', 'members-empty', '멤버가 없습니다.'));
  } else {
    list.members.forEach(member => membersListEl.appendChild(createMemberChip(name, member)));
  }
  return membersListEl;
}

// 리스트별 배지 글자 스타일 편집: [글자 색상] [크기] px [폰트] / 미리보기 / [공통 설정 따르기] [이 스타일을 모든 리스트에 적용]
// 값을 바꾸면 그 항목만 이 리스트에 저장되고, 나머지 항목은 공통 설정을 따름
function createListStyleEditor(name, list, idx) {
  const hasCustom = !!normalizeListStyle(list.style);
  const effective = getEffectiveBadgeSettings(badgeSettings, list.style);
  const editor = makeElement('div', 'list-style-editor');

  const title = makeElement('div', 'list-style-title');
  title.append(
    makeElement('span', null, '배지 글자 스타일'),
    makeElement('span', 'list-style-state' + (hasCustom ? ' custom' : ''), hasCustom ? '이 리스트만 따로 설정됨' : '공통 설정 사용 중')
  );

  const colorInput = makeElement('input', 'color-picker', undefined, 'color');
  colorInput.id = `list-style-color-${idx}`;
  colorInput.value = effective.textColor;
  colorInput.setAttribute('aria-label', `'${name}' 배지 글자 색상`);

  const sizeInput = makeElement('input', null, undefined, 'number');
  sizeInput.id = `list-style-size-${idx}`;
  sizeInput.min = '8';
  sizeInput.max = '20';
  sizeInput.value = String(effective.fontSize);
  sizeInput.setAttribute('aria-label', `'${name}' 배지 글자 크기`);

  const fontSelect = makeElement('select');
  fontSelect.id = `list-style-font-${idx}`;
  fontSelect.setAttribute('aria-label', `'${name}' 배지 폰트`);
  AG_FONT_FAMILIES.forEach((font) => {
    const opt = makeElement('option', null, AG_FONT_LABELS[font] || font);
    opt.value = font;
    opt.selected = effective.fontFamily === font;
    fontSelect.appendChild(opt);
  });

  const controls = makeElement('div', 'list-style-controls');
  controls.append(colorInput, sizeInput, 'px', fontSelect);

  // 미리보기: 실제 배지와 같은 함수로 스타일 적용
  const preview = makeElement('div', 'badge-preview list-style-preview', name);
  const renderPreview = (overrides) => {
    applyBadgeStyle(preview, list.color, Object.assign({}, effective, overrides || {}), true);
  };
  renderPreview();

  const saveStyle = (patch) => {
    updateLists(l => setListStyle(l, name, patch));
  };

  colorInput.addEventListener('input', e => renderPreview({ textColor: e.target.value }));
  colorInput.addEventListener('change', e => saveStyle({ textColor: e.target.value }));

  sizeInput.addEventListener('input', (e) => {
    const size = parseInt(e.target.value, 10);
    if (size >= 8 && size <= 20) renderPreview({ fontSize: size });
  });
  sizeInput.addEventListener('change', (e) => {
    const size = parseInt(e.target.value, 10);
    if (size >= 8 && size <= 20) {
      saveStyle({ fontSize: size });
    } else {
      e.target.value = String(effective.fontSize); // 범위를 벗어나면 원래 값으로
      showSyncStatus('글자 크기는 8~20 사이로 입력해주세요.', true);
    }
  });

  fontSelect.addEventListener('change', e => saveStyle({ fontFamily: e.target.value }));

  const resetBtn = makeElement('button', 'small-btn', '공통 설정 따르기', 'button');
  resetBtn.disabled = !hasCustom;
  resetBtn.title = '이 리스트만의 글자 스타일을 지우고 공통 설정을 따릅니다.';
  resetBtn.addEventListener('click', () => {
    updateLists((l) => {
      if (!l[name] || !l[name].style) return false;
      delete l[name].style;
    });
  });

  const applyAllBtn = makeElement('button', 'small-btn', '이 스타일을 모든 리스트에 적용', 'button');
  applyAllBtn.title = '이 스타일을 공통 설정으로 만들고, 다른 리스트의 개별 스타일을 지웁니다.';
  applyAllBtn.addEventListener('click', () => applyListStyleToAll(name, effective));

  const actions = makeElement('div', 'list-style-actions');
  actions.append(resetBtn, applyAllBtn);

  editor.append(title, controls, preview, actions);
  return editor;
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

// 공통 설정 영역의 "개별 스타일 N개" 안내
function updateCustomStyleCount() {
  const label = byId('badge-custom-count');
  if (!label) return;
  const count = countListsWithStyle(renderedLists);
  label.textContent = count > 0 ? `개별 스타일을 쓰는 리스트 ${count}개` : '모든 리스트가 공통 스타일 사용 중';
}

// 공통 설정 [모든 리스트에 적용]: 리스트별 글자 스타일을 모두 지워 공통 스타일을 쓰게 함
async function applyCommonStyleToAll() {
  const result = await chrome.storage.local.get(['lists']);
  const count = countListsWithStyle(result.lists || {});
  if (count === 0) {
    showSyncStatus('이미 모든 리스트가 공통 스타일을 사용하고 있습니다.', false);
    return;
  }
  if (!await askConfirm(`리스트 ${count}개의 개별 글자 스타일을 지우고, 모든 리스트에 공통 스타일을 적용할까요?`, '모두 적용')) return;
  const ok = await updateLists((l) => {
    clearAllListStyles(l);
  });
  if (ok) showSyncStatus(`모든 리스트에 공통 스타일을 적용했습니다. (개별 스타일 ${count}개 해제)`, false);
}

// 멤버 한 명: "@handle ×"
function createMemberChip(listName, member) {
  const chip = makeElement('span', 'member-handle', member);
  const removeBtn = makeElement('button', 'remove-member-btn', '×', 'button');
  removeBtn.title = `'${member}' 제거`;
  removeBtn.setAttribute('aria-label', `'${member}' 제거`);
  removeBtn.addEventListener('click', () => {
    updateLists(l => removeMemberFromLists(l, listName, member));
  });
  chip.appendChild(removeBtn);
  return chip;
}

// ==========================================
// 9. 배지 스타일 설정
// ==========================================

async function loadBadgeSettings() {
  const result = await chrome.storage.local.get(['badgeSettings']);
  badgeSettings = { ...AG_DEFAULT_BADGE_SETTINGS, ...(result.badgeSettings || {}) };
  applyBadgeSettingsUI();
}

// 컬러 피커는 드래그하는 동안 input 이벤트가 계속 일어나므로 묶어서 저장
const saveBadgeSettings = debounce(() => {
  chrome.storage.local.set({ badgeSettings }).catch((err) => {
    showSyncStatus('배지 설정 저장에 실패했습니다.', true);
    console.error(err);
  });
}, 150);

// 현재 설정값을 입력란과 미리보기에 반영
function applyBadgeSettingsUI() {
  const colorInput = byId('badge-text-color');
  const sizeInput = byId('badge-font-size');
  const fontInput = byId('badge-font-family');
  if (colorInput) colorInput.value = badgeSettings.textColor;
  if (sizeInput) sizeInput.value = badgeSettings.fontSize;
  if (fontInput) fontInput.value = badgeSettings.fontFamily;
  updateBadgePreview();
}

// 미리보기도 타임라인과 같은 함수로 스타일 적용
function updateBadgePreview() {
  const preview = byId('badge-preview');
  if (preview) applyBadgeStyle(preview, AG_DEFAULT_LIST_COLOR, badgeSettings, true);
}

// 설정 하나를 바꾸고 미리보기·저장
function updateBadgeSetting(key, value) {
  badgeSettings[key] = value;
  updateBadgePreview();
  saveBadgeSettings();
}

function setupBadgeSettings() {
  const toggleBtn = byId('toggle-badge-settings');
  const settingsBody = byId('badge-settings-body');
  const arrow = byId('settings-arrow');
  if (toggleBtn && settingsBody) {
    toggleBtn.addEventListener('click', () => {
      const open = settingsBody.classList.toggle('show');
      if (arrow) arrow.textContent = open ? '▼' : '▶';
      toggleBtn.setAttribute('aria-expanded', String(open));
    });
  }

  byId('badge-text-color')?.addEventListener('input', e => updateBadgeSetting('textColor', e.target.value));

  byId('badge-font-size')?.addEventListener('input', (e) => {
    const size = parseInt(e.target.value, 10);
    if (size >= 8 && size <= 20) updateBadgeSetting('fontSize', size);
  });

  byId('badge-font-family')?.addEventListener('change', e => updateBadgeSetting('fontFamily', e.target.value));

  byId('badge-reset-btn')?.addEventListener('click', () => {
    badgeSettings = { ...AG_DEFAULT_BADGE_SETTINGS };
    applyBadgeSettingsUI();
    saveBadgeSettings();
  });

  byId('badge-apply-all-btn')?.addEventListener('click', applyCommonStyleToAll);
}
