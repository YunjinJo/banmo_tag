// popup/backup.js — 백업(내보내기) · 복원(가져오기: 병합 / 덮어쓰기) · 초기화
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

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
    if (ok) showSyncStatus('초기화되었습니다.', false);
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

// 내보내기: 리스트와 배지 스타일 설정을 함께 저장
function setupExportButton() {
  byId('export-btn')?.addEventListener('click', async () => {
    const result = await chrome.storage.local.get(['lists', 'badgeSettings']);
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`banmo_tag_backup_${date}.json`, buildBackup(result.lists || {}, result.badgeSettings));
  });
}

// 가져오기: 파일 읽기 → [병합] / [덮어쓰기] / [취소] 선택
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
  updateInert();
  byId('import-merge-btn')?.focus();
}

function closeImportChoice() {
  pendingImport = null;
  const choiceEl = byId('import-choice');
  if (choiceEl) choiceEl.style.display = 'none';
  updateInert();
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
