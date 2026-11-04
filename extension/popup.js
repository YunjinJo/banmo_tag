// popup.js
// 공통 로직(cleanListName, sanitizeListsObject, parseHandles 등)은 popup.html 에서 먼저 로드되는 shared.js 에 있습니다.
// shared.js 가 없으면 아무 기능도 동작하지 않으므로, 증상을 숨기는 폴백 대신 시작 시 원인을 분명하게 알립니다.
const SHARED_LOADED = typeof sanitizeListsObject === 'function';

let badgeSettings = SHARED_LOADED ? { ...AG_DEFAULT_BADGE_SETTINGS } : {};
// 펼쳐진 리스트 이름 (다시 그려도 아코디언 상태 유지)
const expandedLists = new Set();
// 파일에서 읽어 병합/덮어쓰기 선택을 기다리는 데이터 ({ lists, badgeSettings })
let pendingImport = null;
let statusTimer = null;

// 팝업 안의 확인 상자 (브라우저 confirm() 대신 사용). 확인하면 true 로 resolve.
let resolveConfirm = null;
function askConfirm(message, okLabel = '확인') {
  const box = document.getElementById('confirm-box');
  const text = document.getElementById('confirm-text');
  const okBtn = document.getElementById('confirm-ok-btn');
  if (!box || !text || !okBtn) return Promise.resolve(false);
  if (resolveConfirm) resolveConfirm(false); // 이전 확인 요청은 취소로 처리
  text.textContent = message;
  okBtn.textContent = okLabel;
  box.style.display = 'flex';
  okBtn.focus();
  return new Promise(resolve => {
    resolveConfirm = (answer) => {
      resolveConfirm = null;
      box.style.display = 'none';
      resolve(answer);
    };
  });
}

function setupConfirmBox() {
  document.getElementById('confirm-ok-btn')?.addEventListener('click', () => resolveConfirm && resolveConfirm(true));
  document.getElementById('confirm-cancel-btn')?.addEventListener('click', () => resolveConfirm && resolveConfirm(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && resolveConfirm) resolveConfirm(false);
  });
}

// ==========================================
// 1. 스토리지 쓰기 (직렬화)
// ==========================================

// 모든 리스트 변경은 이 함수를 거칩니다.
// get → 수정 → set 이 겹치면 앞선 변경이 사라지므로 Promise 큐로 순서대로 처리합니다.
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
  return run.catch(err => {
    console.error('[banmo_tag] 저장 실패:', err);
    showSyncStatus('저장에 실패했습니다: ' + (err && err.message ? err.message : err), true);
    return false;
  });
}

// ==========================================
// 2. 초기화
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  if (!SHARED_LOADED) {
    document.body.textContent = 'shared.js 를 불러오지 못했습니다. chrome://extensions 에서 banmo_tag 를 새로고침해주세요.';
    console.error('[banmo_tag] shared.js not loaded');
    return;
  }

  // 팝업 열릴 때 뱃지 알림 지우기
  chrome.action.setBadgeText({ text: '' }).catch(() => {});

  setupConfirmBox();
  loadLists();
  setupSyncButton();
  setupManualAdd();
  setupBackupRestore();
  loadBadgeSettings();
  setupBadgeSettings();

  // 리스트 변경(background 의 자동 수집 포함) 시 실시간 재렌더링.
  // 연속 변경을 묶어서 한 번만 그립니다. 정제된 데이터는 다시 정제해도 바뀌지 않으므로 무한 루프가 생기지 않습니다.
  const debouncedLoad = debounce(loadLists, 100);
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.lists) debouncedLoad();
  });
});

function showSyncStatus(message, isError = false) {
  const statusEl = document.getElementById('sync-status');
  if (!statusEl) return;
  statusEl.className = 'sync-status ' + (isError ? 'error' : 'success');
  statusEl.textContent = message;
  statusEl.style.display = 'block';

  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.style.display = 'none';
  }, 5000);
}

// ==========================================
// 3. 현재 트위터 탭에서 즉시 수집
// ==========================================

function sendScrapeRequest(tabId, timeoutMs = 8000) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timeoutError: true });
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, { action: 'scrapeNow' }, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (chrome.runtime.lastError) resolve({ connectionError: true });
      else resolve(response);
    });
  });
}

// 확장 프로그램 설치/새로고침 전에 열려 있던 탭에는 content script 가 없으므로 직접 주입
async function injectContentScript(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['shared.js', 'content.js'] });
}

function setupSyncButton() {
  const syncBtn = document.getElementById('sync-current-tab-btn');
  if (!syncBtn) return;

  syncBtn.addEventListener('click', async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabError = getSyncTabError(activeTab);
    if (tabError) {
      showSyncStatus(tabError, true);
      return;
    }

    syncBtn.disabled = true;
    showSyncStatus('데이터 수집 중...', false);
    try {
      let response = await sendScrapeRequest(activeTab.id);
      if (response && response.connectionError) {
        try {
          await injectContentScript(activeTab.id);
        } catch (e) {
          showSyncStatus('페이지에 연결할 수 없습니다. 트위터 탭을 새로고침(F5) 해주세요.', true);
          return;
        }
        response = await sendScrapeRequest(activeTab.id);
      }

      if (response && response.success) {
        const detail = response.added > 0 ? `새로 ${response.added}명 추가` : '새 멤버 없음';
        showSyncStatus(`'${response.listName}' 총 ${response.count}명 (${detail})`, false);
      } else if (response && response.timeoutError) {
        showSyncStatus('응답 시간이 초과되었습니다. 트위터 탭을 새로고침(F5) 후 다시 시도해주세요.', true);
      } else if (response && response.connectionError) {
        showSyncStatus('페이지에 연결할 수 없습니다. 트위터 탭을 새로고침(F5) 해주세요.', true);
      } else {
        showSyncStatus((response && response.message) || '리스트 멤버를 찾을 수 없습니다. 멤버 화면을 열어주세요.', true);
      }
    } finally {
      syncBtn.disabled = false;
    }
  });
}

// ==========================================
// 4. 직접 리스트 추가
// ==========================================

function setupManualAdd() {
  const toggleBtn = document.getElementById('toggle-manual-add-btn');
  const form = document.getElementById('manual-add-form');
  const saveBtn = document.getElementById('manual-save-btn');
  const nameInput = document.getElementById('manual-name');
  const membersInput = document.getElementById('manual-members');
  const colorInput = document.getElementById('manual-color');
  const modeSelect = document.getElementById('manual-mode');

  if (!toggleBtn || !form || !saveBtn) return;

  const setFormOpen = (open) => {
    form.style.display = open ? 'flex' : 'none';
    toggleBtn.textContent = open ? '- 접기' : '+ 직접 리스트 추가';
    toggleBtn.setAttribute('aria-expanded', String(open));
  };

  toggleBtn.addEventListener('click', () => setFormOpen(form.style.display === 'none'));

  saveBtn.addEventListener('click', async () => {
    const listName = cleanListName(nameInput.value.trim());
    if (!nameInput.value.trim() || listName === 'Unknown List') {
      showSyncStatus('리스트 이름을 입력해주세요.', true);
      nameInput.focus();
      return;
    }
    if (isSystemListName(listName)) {
      showSyncStatus('시스템 예약어("멤버 관리", "리스트" 등)는 리스트 이름으로 사용할 수 없습니다.', true);
      nameInput.focus();
      return;
    }

    const handles = parseHandles(membersInput.value);
    if (handles.length === 0) {
      showSyncStatus('올바른 멤버 핸들을 1개 이상 입력해주세요. (영문/숫자/_ 최대 15자)', true);
      membersInput.focus();
      return;
    }

    // 이미 있는 리스트면 멤버만 추가하고 색상/모드는 유지 (shared.js applyManualAdd)
    let outcome = null;
    const saved = await updateLists(lists => {
      outcome = applyManualAdd(lists, listName, handles, colorInput.value, modeSelect.value);
    });

    if (saved && outcome) {
      showSyncStatus(outcome.created
        ? `'${listName}' 리스트가 저장되었습니다! (${outcome.total}명)`
        : `기존 '${listName}' 리스트에 추가했습니다. (${outcome.total}명, 색상/모드는 유지)`, false);
      nameInput.value = '';
      membersInput.value = '';
      setFormOpen(false);
    }
  });
}

// ==========================================
// 5. 백업 / 복원 / 초기화
// ==========================================

function setupBackupRestore() {
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!await askConfirm('모든 리스트 데이터를 초기화할까요? 되돌릴 수 없습니다.', '초기화')) return;
      const ok = await updateLists(lists => {
        Object.keys(lists).forEach(k => delete lists[k]);
      });
      if (ok) {
        expandedLists.clear();
        showSyncStatus('초기화되었습니다.', false);
      }
    });
  }

  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      // 리스트와 배지 스타일 설정을 함께 내보냄 (shared.js buildBackup)
      const result = await chrome.storage.local.get(['lists', 'badgeSettings']);
      const jsonStr = JSON.stringify(buildBackup(result.lists || {}, result.badgeSettings), null, 2);
      const url = URL.createObjectURL(new Blob([jsonStr], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `banmo_tag_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');
  const choiceEl = document.getElementById('import-choice');
  const choiceText = document.getElementById('import-choice-text');

  const closeChoice = () => {
    pendingImport = null;
    if (choiceEl) choiceEl.style.display = 'none';
  };

  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        let parsed = null;
        try {
          parsed = parseBackup(JSON.parse(ev.target.result));
        } catch (err) {
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
        pendingImport = parsed;
        if (choiceText) {
          choiceText.textContent = `${count}개 리스트를 가져옵니다.` +
            (parsed.badgeSettings ? ' (배지 스타일 설정 포함: 덮어쓰기 때 적용)' : '') + ' 방식을 선택하세요.';
        }
        if (choiceEl) choiceEl.style.display = 'flex';
      };
      reader.readAsText(file);
    });
  }

  document.getElementById('import-merge-btn')?.addEventListener('click', async () => {
    const data = pendingImport;
    closeChoice();
    if (!data) return;
    // 병합: 기존 리스트의 색상/모드와 현재 배지 설정은 유지하고 멤버만 합침.
    // 이름이 같아도 listId 가 다르면 별개 리스트로 분리 (shared.js mergeImportedLists)
    const ok = await updateLists(lists => {
      mergeImportedLists(lists, data.lists);
    });
    if (ok) showSyncStatus('기존 데이터와 병합했습니다.', false);
  });

  document.getElementById('import-replace-btn')?.addEventListener('click', async () => {
    const data = pendingImport;
    closeChoice();
    if (!data) return;
    if (!await askConfirm('기존 리스트를 모두 지우고 파일 내용으로 바꿉니다. 계속할까요?', '덮어쓰기')) return;
    const ok = await updateLists(lists => {
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
      } catch (err) {
        showSyncStatus('리스트는 복원했지만 배지 설정 저장에 실패했습니다.', true);
        return;
      }
    }
    showSyncStatus(data.badgeSettings ? '파일 내용(리스트 + 배지 설정)으로 덮어썼습니다.' : '파일 내용으로 덮어썼습니다.', false);
  });

  document.getElementById('import-cancel-btn')?.addEventListener('click', closeChoice);
}

// ==========================================
// 6. 리스트 목록 렌더링
// ==========================================

async function loadLists() {
  const result = await chrome.storage.local.get(['lists']);
  const { newLists, modified } = sanitizeListsObject(result.lists || {});
  // 태그 붙은 이름/시스템 단어 리스트가 남아있으면 정리해서 저장 (onChanged 로 다시 그려짐)
  if (modified) updateLists(() => {});
  renderLists(newLists);
}

function renderLists(lists) {
  const container = document.getElementById('list-container');
  if (!container) return;
  container.textContent = '';

  const listNames = Object.keys(lists).filter(n => lists[n] && Array.isArray(lists[n].members));
  if (listNames.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.append('저장된 리스트가 없습니다.', document.createElement('br'),
      '트위터 리스트의 멤버 화면을 열거나 상단 [가져오기]를 누르거나, 직접 추가해주세요.');
    container.appendChild(empty);
    return;
  }

  // 사라진 리스트의 펼침 상태 정리
  [...expandedLists].forEach(n => { if (!lists[n]) expandedLists.delete(n); });

  listNames.forEach((name, idx) => {
    const list = lists[name];
    const membersId = 'members-' + idx;
    const isOpen = expandedLists.has(name);

    const wrapperEl = document.createElement('div');
    wrapperEl.className = 'list-wrapper';

    const itemEl = document.createElement('div');
    itemEl.className = 'list-item';

    // 펼치기 버튼 (키보드로도 조작 가능)
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'list-toggle';
    toggleBtn.setAttribute('aria-expanded', String(isOpen));
    toggleBtn.setAttribute('aria-controls', membersId);

    const nameEl = document.createElement('div');
    nameEl.className = 'list-name';
    nameEl.textContent = name;

    const countEl = document.createElement('div');
    countEl.className = 'list-info';
    countEl.textContent = `${list.members.length}명 등록됨 (클릭하여 ${isOpen ? '접기' : '펼치기'})`;

    toggleBtn.append(nameEl, countEl);

    // 모드 선택 (기본, 강조, 흐리게)
    const modeSelect = document.createElement('select');
    modeSelect.className = 'mode-select';
    modeSelect.setAttribute('aria-label', `'${name}' 표시 모드`);
    [['normal', '기본'], ['highlight', '강조'], ['dim', '흐리게']].forEach(([value, text]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      opt.selected = (list.mode || 'normal') === value;
      modeSelect.appendChild(opt);
    });
    modeSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      updateLists(l => { if (!l[name]) return false; l[name].mode = mode; });
    });

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'color-picker';
    colorInput.value = list.color || AG_DEFAULT_LIST_COLOR;
    colorInput.setAttribute('aria-label', `'${name}' 배지 색상`);
    colorInput.addEventListener('change', (e) => {
      const color = e.target.value;
      updateLists(l => { if (!l[name]) return false; l[name].color = color; });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-list-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = '이 리스트 삭제';
    deleteBtn.setAttribute('aria-label', `'${name}' 리스트 삭제`);
    deleteBtn.addEventListener('click', async () => {
      if (!await askConfirm(`'${name}' 리스트를 삭제할까요?`, '삭제')) return;
      expandedLists.delete(name);
      updateLists(l => { if (!l[name]) return false; delete l[name]; });
    });

    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'list-controls';
    controlsDiv.append(modeSelect, colorInput, deleteBtn);

    itemEl.append(toggleBtn, controlsDiv);

    // 멤버 목록
    const membersListEl = document.createElement('div');
    membersListEl.className = 'members-list' + (isOpen ? ' show' : '');
    membersListEl.id = membersId;
    if (list.members.length === 0) {
      membersListEl.textContent = '멤버가 없습니다.';
    } else {
      list.members.forEach(member => {
        const mSpan = document.createElement('span');
        mSpan.className = 'member-handle';
        mSpan.textContent = member;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-member-btn';
        removeBtn.textContent = '×';
        removeBtn.title = `'${member}' 제거`;
        removeBtn.setAttribute('aria-label', `'${member}' 제거`);
        removeBtn.addEventListener('click', () => {
          updateLists(l => removeMemberFromLists(l, name, member));
        });

        mSpan.appendChild(removeBtn);
        membersListEl.appendChild(mSpan);
      });
    }

    toggleBtn.addEventListener('click', () => {
      const open = membersListEl.classList.toggle('show');
      if (open) expandedLists.add(name); else expandedLists.delete(name);
      toggleBtn.setAttribute('aria-expanded', String(open));
      countEl.textContent = `${list.members.length}명 등록됨 (클릭하여 ${open ? '접기' : '펼치기'})`;
    });

    wrapperEl.append(itemEl, membersListEl);
    container.appendChild(wrapperEl);
  });
}

// ==========================================
// 7. 배지 스타일 설정
// ==========================================

async function loadBadgeSettings() {
  const result = await chrome.storage.local.get(['badgeSettings']);
  badgeSettings = { ...AG_DEFAULT_BADGE_SETTINGS, ...(result.badgeSettings || {}) };
  applyBadgeSettingsUI();
}

// 컬러 피커는 드래그 중 input 이벤트가 연속 발생하므로 묶어서 저장
const saveBadgeSettings = debounce(() => {
  chrome.storage.local.set({ badgeSettings }).catch(err => {
    showSyncStatus('배지 설정 저장에 실패했습니다.', true);
    console.error(err);
  });
}, 150);

function applyBadgeSettingsUI() {
  const colorInput = document.getElementById('badge-text-color');
  const sizeInput = document.getElementById('badge-font-size');
  const fontInput = document.getElementById('badge-font-family');
  if (colorInput) colorInput.value = badgeSettings.textColor;
  if (sizeInput) sizeInput.value = badgeSettings.fontSize;
  if (fontInput) fontInput.value = badgeSettings.fontFamily;
  updateBadgePreview();
}

// 미리보기도 타임라인과 같은 함수로 스타일 적용
function updateBadgePreview() {
  const preview = document.getElementById('badge-preview');
  if (!preview) return;
  applyBadgeStyle(preview, AG_DEFAULT_LIST_COLOR, badgeSettings, true);
}

function setupBadgeSettings() {
  const toggleBtn = document.getElementById('toggle-badge-settings');
  const settingsBody = document.getElementById('badge-settings-body');
  const arrow = document.getElementById('settings-arrow');

  if (toggleBtn && settingsBody) {
    toggleBtn.addEventListener('click', () => {
      const open = settingsBody.classList.toggle('show');
      if (arrow) arrow.textContent = open ? '▼' : '▶';
      toggleBtn.setAttribute('aria-expanded', String(open));
    });
  }

  document.getElementById('badge-text-color')?.addEventListener('input', (e) => {
    badgeSettings.textColor = e.target.value;
    updateBadgePreview();
    saveBadgeSettings();
  });

  document.getElementById('badge-font-size')?.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 8 && val <= 20) {
      badgeSettings.fontSize = val;
      updateBadgePreview();
      saveBadgeSettings();
    }
  });

  document.getElementById('badge-font-family')?.addEventListener('change', (e) => {
    badgeSettings.fontFamily = e.target.value;
    updateBadgePreview();
    saveBadgeSettings();
  });

  document.getElementById('badge-reset-btn')?.addEventListener('click', () => {
    badgeSettings = { ...AG_DEFAULT_BADGE_SETTINGS };
    applyBadgeSettingsUI();
    saveBadgeSettings();
  });
}
