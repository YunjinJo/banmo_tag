// popup/badge.js — 배지 기본 스타일 (모든 리스트 공통) · 글자 크기/폰트 선택 목록
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

// 고를 수 있는 배지 글자 크기(px)
const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

function fillSizeOptions(select, selected) {
  FONT_SIZES.forEach((size) => {
    const opt = makeElement('option', null, `${size}px`);
    opt.value = String(size);
    opt.selected = size === selected;
    select.appendChild(opt);
  });
}

// 폰트 선택 목록: 고를 수 있는 폰트 (+ 지금 쓰는 직접 입력 폰트) + 마지막에 [설치된 폰트에서 고르기…] (파이어폭스: [다른 폰트 직접 입력…], popup/font-dialog.js)
function fillFontOptions(select, selected) {
  select.textContent = '';
  const fonts = AG_FONT_FAMILIES.slice();
  if (isCustomFontFamily(selected)) fonts.push(selected);
  fonts.forEach((font) => {
    const opt = makeElement('option', null, getFontLabel(font));
    opt.value = font;
    opt.selected = font === selected;
    select.appendChild(opt);
  });
  const custom = makeElement('option', null, getCustomFontOptionLabel());
  custom.value = FONT_CUSTOM_OPTION;
  select.appendChild(custom);
}

// 폰트 선택 목록이 바뀌었을 때: 마지막 항목([설치된 폰트에서 고르기…])이면 고르기 전 값으로 되돌리고 입력 창을 엶, 아니면 onPick(값)
function handleFontSelectChange(select, previous, listName, onPick) {
  if (select.value !== FONT_CUSTOM_OPTION) {
    onPick(select.value);
    return;
  }
  select.value = previous;
  openFontDialog(listName, '', select);
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
  if (sizeInput) sizeInput.value = String(badgeSettings.fontSize);
  // 직접 입력한 폰트는 목록에 그 항목이 있어야 보이므로 목록을 다시 채움
  if (fontInput) fillFontOptions(fontInput, badgeSettings.fontFamily);
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
  const sizeSelect = byId('badge-font-size');
  const fontSelect = byId('badge-font-family');
  if (sizeSelect) fillSizeOptions(sizeSelect, badgeSettings.fontSize);
  if (fontSelect) fillFontOptions(fontSelect, badgeSettings.fontFamily);

  byId('badge-text-color')?.addEventListener('input', e => updateBadgeSetting('textColor', e.target.value));
  sizeSelect?.addEventListener('change', e => updateBadgeSetting('fontSize', parseInt(e.target.value, 10)));
  fontSelect?.addEventListener('change', () => {
    handleFontSelectChange(fontSelect, badgeSettings.fontFamily, null, (font) => {
      updateBadgeSetting('fontFamily', font);
      fillFontOptions(fontSelect, font); // 직접 입력 폰트에서 다른 폰트로 바꾸면 그 항목을 뺌
    });
  });

  byId('badge-reset-btn')?.addEventListener('click', () => {
    badgeSettings = { ...AG_DEFAULT_BADGE_SETTINGS };
    applyBadgeSettingsUI();
    saveBadgeSettings();
  });

  byId('badge-apply-all-btn')?.addEventListener('click', applyCommonStyleToAll);
}
