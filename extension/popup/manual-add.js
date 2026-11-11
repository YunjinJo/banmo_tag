// popup/manual-add.js — 직접 리스트 추가 ([+ 추가] 입력란)
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

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
