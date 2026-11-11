// popup/badge.js — 배지 기본 스타일 (모든 리스트 공통)
// 팝업 화면은 여러 파일로 나뉘어 있고, popup.html 이 shared.js → popup/*.js → popup.js 순서로 읽습니다.
// 파일들은 일반 스크립트라 최상위 함수·변수를 서로 공유합니다(목차는 popup.js 참고).

// ==========================================
// 9. 배지 기본 스타일 (모든 리스트 공통)
// ==========================================

function fillSizeOptions(select, selected) {
  FONT_SIZES.forEach((size) => {
    const opt = makeElement('option', null, `${size}px`);
    opt.value = String(size);
    opt.selected = size === selected;
    select.appendChild(opt);
  });
}

function fillFontOptions(select, selected) {
  AG_FONT_FAMILIES.forEach((font) => {
    const opt = makeElement('option', null, AG_FONT_LABELS[font] || font);
    opt.value = font;
    opt.selected = font === selected;
    select.appendChild(opt);
  });
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
  const sizeSelect = byId('badge-font-size');
  const fontSelect = byId('badge-font-family');
  if (sizeSelect) fillSizeOptions(sizeSelect, badgeSettings.fontSize);
  if (fontSelect) fillFontOptions(fontSelect, badgeSettings.fontFamily);

  byId('badge-text-color')?.addEventListener('input', e => updateBadgeSetting('textColor', e.target.value));
  sizeSelect?.addEventListener('change', e => updateBadgeSetting('fontSize', parseInt(e.target.value, 10)));
  fontSelect?.addEventListener('change', e => updateBadgeSetting('fontFamily', e.target.value));

  byId('badge-reset-btn')?.addEventListener('click', () => {
    badgeSettings = { ...AG_DEFAULT_BADGE_SETTINGS };
    applyBadgeSettingsUI();
    saveBadgeSettings();
  });

  byId('badge-apply-all-btn')?.addEventListener('click', applyCommonStyleToAll);
}
