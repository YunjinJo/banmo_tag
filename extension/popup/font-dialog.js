// popup/font-dialog.js — [설치된 폰트에서 고르기…] 창: 이 컴퓨터의 폰트 목록에서 검색해 고르기(크롬·엣지) · 이름 직접 입력
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).
//
// 폰트 파일을 넣거나 내려받지 않고, 고른 폰트의 이름만 저장합니다("'이름', sans-serif"). 배지는 X 를 보는 컴퓨터에
// 설치된 그 폰트로 그려지고, 없으면 기본 폰트로 보입니다.
//
// 크롬·엣지: window.queryLocalFonts() 로 설치된 폰트 목록을 받아, 폰트마다 그 폰트 모양으로 보여 줍니다. 처음 한 번 "글꼴" 권한이
// 필요한데, 크롬은 확장 프로그램 팝업에서는 권한 창을 띄우지 않고 빈 목록을 돌려줍니다. 그래서 그때는 같은 창을 새 탭 화면에서
// 열어 허용받습니다. 한 번 허용하면 다음부터는 팝업에서도 창을 열자마자 목록이 나옵니다 (사용자 조작 없이도 받을 수 있음).
// 목록은 이 화면에만 두고 저장하지 않습니다.
// 파이어폭스: 목록 기능이 없어 이름만 직접 적습니다.

// 폰트 선택 목록의 마지막 항목 값: 고르면 이 창을 엶 (저장되는 값이 아님)
const FONT_CUSTOM_OPTION = 'custom:';
// 목록의 폰트마다 이름 옆에 그 폰트로 보여 줄 글자
const FONT_SAMPLE_TEXT = '가나다 Abc';

// 이 창이 바꿀 대상 리스트 이름 (null 이면 공통 설정)
let fontDialogList = null;
let fontDialogReturnFocus = null;
// 불러온 설치 폰트 이름 (이름순)과 찾기용 표 (공백·대소문자를 뺀 이름 → 실제 이름). 팝업·탭을 닫으면 사라짐
let localFontNames = null;
let localFontKeys = null;
// 목록을 거르는 글자 (사용자가 입력란에 친 글자. 목록에서 고르거나 화살표로 옮길 때는 바뀌지 않음)
let fontFilterText = '';
let fontMeasureContext = null;

const FONT_OPENED_IN_TAB = '크롬은 팝업에서 권한 창을 띄우지 않아 새 탭에서 열었습니다. ' +
  '아래 [설치된 폰트 목록 보기]를 누르고, 묻는 창에서 [허용]을 누르세요.';

function canListLocalFonts() {
  return typeof window.queryLocalFonts === 'function';
}

// 폰트 선택 목록의 [다른 폰트 …] 항목 이름 (크롬은 목록에서 고르고, 파이어폭스는 이름을 적음)
function getCustomFontOptionLabel() {
  return canListLocalFonts() ? '설치된 폰트에서 고르기…' : '다른 폰트 직접 입력…';
}

function isFontDialogOpen() {
  return byId('font-dialog')?.style.display === 'flex';
}

// 이 창이 바꿀 대상의 지금 폰트와 미리보기 색
function getFontDialogBase() {
  const list = fontDialogList ? renderedLists[fontDialogList] : null;
  const effective = list ? getEffectiveBadgeSettings(badgeSettings, list.style) : { ...AG_DEFAULT_BADGE_SETTINGS, ...badgeSettings };
  return { effective, color: list ? list.color : AG_DEFAULT_LIST_COLOR, label: fontDialogList || 'SAMPLE' };
}

// listName 이 있으면 그 리스트의 폰트, 없으면 공통 설정의 폰트를 바꾸는 창을 엶.
// note: 처음에 보여 줄 안내, returnFocus: 닫은 뒤 포커스를 돌려줄 요소 (없으면 지금 포커스)
function openFontDialog(listName, note, returnFocus) {
  const layer = byId('font-dialog');
  if (!layer) return;
  fontDialogList = listName && renderedLists[listName] ? listName : null;
  fontDialogReturnFocus = returnFocus || document.activeElement;

  const canList = canListLocalFonts();
  const current = getFontDialogBase().effective.fontFamily;
  const input = byId('font-name-input');
  input.value = isCustomFontFamily(current) ? getFontNameFromFamily(current) : '';
  input.placeholder = canList ? '폰트 이름 검색 또는 직접 입력' : '폰트 이름 (예: 나눔고딕)';
  byId('font-dialog-title').textContent = canList ? '설치된 폰트 고르기' : '다른 폰트 쓰기';
  byId('font-dialog-target').textContent = fontDialogList
    ? `'${fontDialogList}' 리스트 배지에 쓸 폰트`
    : '모든 리스트 배지에 쓸 기본 폰트';
  byId('font-list-area').hidden = !canList;
  byId('font-browser-note').hidden = canList;
  fontFilterText = '';
  setFontListMessage(note || '', false);

  document.body.classList.add('font-dialog-open');
  layer.style.display = 'flex';
  updateInert();
  if (localFontNames) {
    showFontList();
  } else {
    // 권한 상태를 확인할 때까지 목록·안내 둘 다 감춤 (prepareLocalFonts)
    byId('font-list-box').hidden = true;
    byId('font-permission').hidden = true;
  }
  updateFontDialogCheck();
  input.focus();
  input.select();
  // 이미 허용했으면 바로 목록을, 아니면 권한 안내를 보여 줌
  if (canList && !localFontNames) prepareLocalFonts();
}

function closeFontDialog() {
  const layer = byId('font-dialog');
  if (!layer || !isFontDialogOpen()) return;
  layer.style.display = 'none';
  document.body.classList.remove('font-dialog-open');
  fontDialogList = null;
  updateInert();
  restoreFocus(fontDialogReturnFocus);
}

// [적용]: 입력란의 이름을 저장. 고를 수 있는 폰트와 이름이 같으면 그 폰트로 저장됨 (buildFontFamily)
function applyFontDialog() {
  const family = buildFontFamily(getFontDialogName());
  if (!family) return;
  const listName = fontDialogList;
  closeFontDialog();
  if (listName) {
    updateLists(l => setListStyle(l, listName, { fontFamily: family }));
  } else {
    badgeSettings = { ...badgeSettings, fontFamily: family };
    applyBadgeSettingsUI();
    saveBadgeSettings();
  }
  // 권한을 받으려고 연 새 탭 화면이면, 할 일을 마쳤다고 알려 줌
  if (IS_TAB_VIEW && PAGE_PARAMS.get('font')) showSyncStatus(`폰트를 '${getFontLabel(family)}'(으)로 바꿨습니다. 이 탭은 닫아도 됩니다.`, false);
}

// ==========================================
// 입력란 상태 · 미리보기
// ==========================================

// 입력란 아래 상태 (이름 형식 → 이 컴퓨터에 있는지), [적용] 버튼, 미리보기를 갱신
function updateFontDialogCheck() {
  const raw = byId('font-name-input').value;
  const name = normalizeFontName(raw);
  const check = byId('font-check');
  const [kind, text] = describeFontName(raw, name);
  check.textContent = text;
  check.className = 'font-check' + (kind ? ' ' + kind : '');
  byId('font-ok-btn').disabled = !name;

  const base = getFontDialogBase();
  const preview = byId('font-dialog-preview');
  preview.textContent = base.label;
  applyBadgeStyle(preview, base.color, { ...base.effective, fontFamily: name ? buildFontFamily(getFontDialogName()) : base.effective.fontFamily }, true);
}

// 입력한 이름의 상태 [종류('' | error | ok | warn), 안내 문구]. name 은 normalizeFontName 결과
function describeFontName(raw, name) {
  if (!raw.trim()) {
    return ['', localFontNames ? '목록에서 고르거나 폰트 이름을 적으세요.' : '설치된 폰트의 이름을 적으세요. 예: 나눔고딕, Malgun Gothic'];
  }
  if (!name) {
    return ['error', raw.trim().length > AG_FONT_NAME_MAX_LENGTH
      ? `폰트 이름은 ${AG_FONT_NAME_MAX_LENGTH}자까지 쓸 수 있습니다.`
      : '폰트 이름에 쓸 수 없는 글자가 있습니다: 따옴표 \' " 와 \\ , ; { } < >'];
  }
  const local = resolveLocalFontName(name);
  if (local) return ['ok', local === name ? '이 컴퓨터에 설치된 폰트입니다.' : `이 컴퓨터에 설치된 폰트 '${local}'(으)로 적용합니다.`];
  if (isFontLikelyInstalled(name, measureFontWidth)) return ['ok', '이 컴퓨터에서 찾았습니다.'];
  return ['warn', '이 컴퓨터에서 찾지 못했습니다. 이름을 확인하세요. 설치되지 않은 폰트는 기본 폰트로 보입니다.'];
}

// 불러온 목록에서 공백·대소문자를 무시하고 같은 폰트의 실제 이름 ('malgungothic' → 'Malgun Gothic'). 없으면 ''
function resolveLocalFontName(name) {
  return (localFontKeys && name && localFontKeys.get(fontSearchKey(name))) || '';
}

// 입력란의 이름 → 저장·미리보기에 쓸 이름 (목록에 있는 폰트면 그 실제 이름). 쓸 수 없는 이름이면 ''
function getFontDialogName() {
  const name = normalizeFontName(byId('font-name-input').value);
  return resolveLocalFontName(name) || name;
}

// 영문·숫자·한글이 섞인 글자를 그 font-family 로 그린 폭
function measureFontWidth(fontFamily) {
  if (!fontMeasureContext) fontMeasureContext = document.createElement('canvas').getContext('2d');
  fontMeasureContext.font = `72px ${fontFamily}`;
  return fontMeasureContext.measureText('mmmmmmmmmmlli WQ@ 0123 가나다라 한글 폰트').width;
}

function setFontListMessage(text, isError) {
  const el = byId('font-list-status');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('error', !!isError);
}

// ==========================================
// 설치된 폰트 목록 (크롬·엣지)
// ==========================================

async function getLocalFontsPermission() {
  try {
    return (await navigator.permissions.query({ name: 'local-fonts' })).state;
  } catch {
    return '';
  }
}

// 창을 열 때: 권한이 있으면 바로 목록을 불러오고, 없으면 권한 안내
async function prepareLocalFonts() {
  const state = await getLocalFontsPermission();
  if (!isFontDialogOpen() || localFontNames) return;
  if (state === 'granted') await fetchLocalFonts(false);
  else showFontPermission(state);
}

// 권한 안내: 차단됨 → [크롬 설정 열기], 아직 안 물음 → 팝업은 [새 탭에서 권한 허용하기], 새 탭 화면은 [설치된 폰트 목록 보기]
function showFontPermission(state) {
  const text = byId('font-permission-text');
  const btn = byId('font-load-btn');
  byId('font-list-box').hidden = true;
  byId('font-permission').hidden = false;
  byId('font-name-input').setAttribute('aria-expanded', 'false');
  if (state === 'denied') {
    text.textContent = '크롬 설정에서 이 확장 프로그램의 "글꼴" 권한이 차단되어 있어 목록을 볼 수 없습니다. 설정에서 허용하거나, 폰트 이름을 직접 적으세요.';
    btn.textContent = '크롬 설정 열기';
  } else if (state === 'granted') {
    text.textContent = '설치된 폰트 목록을 받지 못했습니다.';
    btn.textContent = '다시 불러오기';
  } else if (IS_TAB_VIEW) {
    text.textContent = '누르면 크롬이 "글꼴" 권한을 묻습니다. [허용]을 누르면 설치된 폰트가 목록으로 나오고, 다음부터는 팝업에서도 바로 보입니다.';
    btn.textContent = '설치된 폰트 목록 보기';
  } else {
    text.textContent = '설치된 폰트를 목록에서 보며 고르려면 크롬의 "글꼴" 권한이 한 번 필요합니다. ' +
      '팝업에서는 권한 창이 뜨지 않아, 누르면 새 탭에서 이어서 엽니다. 이름을 알면 위에 바로 적어도 됩니다.';
    btn.textContent = '새 탭에서 권한 허용하기';
  }
}

// 권한 안내의 버튼. 누른 때의 권한 상태를 다시 봄 (다른 탭에서 허용했을 수 있음)
async function handleFontPermissionButton() {
  const state = await getLocalFontsPermission();
  if (state === 'denied') await openFontPermissionSettings();
  else if (state !== 'granted' && !IS_TAB_VIEW) await openFontDialogInTab();
  else await fetchLocalFonts(true);
}

// 크롬 설정의 이 확장 프로그램 권한 화면 (chrome://extensions 의 [사이트 설정]과 같은 곳)
async function openFontPermissionSettings() {
  try {
    await chrome.tabs.create({ url: 'chrome://settings/content/siteDetails?site=' + encodeURIComponent(location.origin) });
  } catch {
    setFontListMessage('크롬 설정 > 개인정보 보호 및 보안 > 사이트 설정 > 글꼴 에서 이 확장 프로그램을 허용해 주세요.', true);
  }
}

// 같은 창을 새 탭 화면에서 열기 (그 탭에서는 권한 창이 뜸)
function openFontDialogInTab() {
  const list = fontDialogList;
  return openInTab(list, { font: list ? 'list' : 'common' });
}

// 설치된 폰트 목록 받기. fromClick: 버튼을 눌러서 (새 탭 화면에서는 이때 권한 창이 뜸)
async function fetchLocalFonts(fromClick) {
  const btn = byId('font-load-btn');
  setFontListMessage('설치된 폰트 목록을 불러오는 중…', false);
  let names = [];
  await withButtonDisabled(btn, async () => {
    try {
      names = getLocalFontFamilies(await window.queryLocalFonts());
    } catch (err) {
      console.warn('[banmo_tag] 폰트 목록을 받지 못했습니다:', err);
    }
  });
  if (!isFontDialogOpen()) return;

  if (names.length === 0) {
    const state = await getLocalFontsPermission();
    showFontPermission(state);
    setFontListMessage(fromClick && state === 'prompt' ? '목록을 받지 못했습니다. 묻는 창에서 [허용]을 누른 뒤 다시 눌러 주세요.' : '', true);
    return;
  }

  localFontNames = names;
  localFontKeys = new Map(names.map(n => [fontSearchKey(n), n]));
  buildFontList();
  showFontList();
  setFontListMessage(fromClick && IS_TAB_VIEW ? '권한을 허용했습니다. 다음부터는 팝업에서도 바로 목록이 보입니다.' : '', false);
  updateFontDialogCheck();
}

// 폰트마다 한 줄: 이름(읽을 수 있게 화면 기본 글꼴) + 보기 글자(그 폰트). 기호 폰트(Wingdings 등)는 보기 글자만 기호로 보임.
// 이름은 normalizeFontName 을 거쳐 따옴표가 없음
function buildFontList() {
  const list = byId('font-list');
  list.textContent = '';
  localFontNames.forEach((name, i) => {
    const opt = makeElement('div', 'font-option');
    opt.id = `font-opt-${i}`;
    opt.setAttribute('role', 'option');
    opt.setAttribute('aria-selected', 'false');
    opt.dataset.name = name;
    const sample = makeElement('span', 'font-option-sample', FONT_SAMPLE_TEXT);
    sample.setAttribute('aria-hidden', 'true');
    sample.style.fontFamily = `'${name}', sans-serif`;
    opt.append(makeElement('span', 'font-option-name', name), sample);
    list.appendChild(opt);
  });
}

// 목록을 보여 주고, 입력란의 이름(지금 폰트)이 목록에 있으면 그 줄을 골라 보이게 함
function showFontList() {
  byId('font-permission').hidden = true;
  byId('font-list-box').hidden = false;
  byId('font-name-input').setAttribute('aria-expanded', 'true');
  filterFontList();
  const current = findFontOption(byId('font-name-input').value);
  setActiveFontOption(current, false);
  if (current) current.scrollIntoView({ block: 'center' });
}

// 공백·대소문자를 무시하고 비교 ('malgungothic' → 'Malgun Gothic')
function fontSearchKey(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '');
}

function findFontOption(name) {
  const key = fontSearchKey(normalizeFontName(name));
  if (!key) return null;
  return Array.from(byId('font-list').children).find(opt => fontSearchKey(opt.dataset.name) === key) || null;
}

// 입력한 글자가 이름에 들어 있는 폰트만 보여 줌
function filterFontList() {
  const list = byId('font-list');
  if (!localFontNames) return;
  const key = fontSearchKey(fontFilterText);
  let shown = 0;
  Array.from(list.children).forEach((opt) => {
    opt.hidden = !!key && !fontSearchKey(opt.dataset.name).includes(key);
    if (!opt.hidden) shown++;
  });
  byId('font-list-count').textContent = key
    ? `설치된 폰트 ${localFontNames.length}개 중 ${shown}개`
    : `설치된 폰트 ${localFontNames.length}개`;
  byId('font-list-empty').hidden = shown > 0;
}

// 목록에서 고른 줄 표시. fill 이면 입력란에 그 이름을 넣음 (목록 거르기는 그대로)
function setActiveFontOption(opt, fill) {
  const input = byId('font-name-input');
  byId('font-list').querySelectorAll('.font-option[aria-selected="true"]').forEach(o => o.setAttribute('aria-selected', 'false'));
  if (!opt) {
    input.removeAttribute('aria-activedescendant');
    return;
  }
  opt.setAttribute('aria-selected', 'true');
  input.setAttribute('aria-activedescendant', opt.id);
  opt.scrollIntoView({ block: 'nearest' });
  if (fill) {
    input.value = opt.dataset.name;
    updateFontDialogCheck();
  }
}

// 입력란에서 ↑↓: 보이는 줄 사이를 옮겨 다니며 고름
function moveActiveFontOption(step) {
  const visible = Array.from(byId('font-list').children).filter(opt => !opt.hidden);
  if (visible.length === 0) return;
  const at = visible.findIndex(opt => opt.getAttribute('aria-selected') === 'true');
  const next = at === -1 ? (step > 0 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, at + step));
  setActiveFontOption(visible[next], true);
}

// 입력: 목록을 거르고, 같은 이름의 줄이 있으면 그 줄을 고름
function handleFontNameInput() {
  fontFilterText = byId('font-name-input').value;
  if (localFontNames) {
    filterFontList();
    setActiveFontOption(findFontOption(fontFilterText), false);
  }
  updateFontDialogCheck();
}

// ==========================================
// 새 탭 화면에서 이어서 열기 · 연결
// ==========================================

// 새 탭 화면을 font=common|list 로 열었으면 그 폰트 창을 이어서 엶 (popup.js 시작 순서에서 리스트를 그린 뒤)
function openFontDialogFromParams() {
  if (!IS_TAB_VIEW) return;
  const which = PAGE_PARAMS.get('font');
  if (which === 'common') {
    selectTab('style', false);
    openFontDialog(null, FONT_OPENED_IN_TAB);
  } else if (which === 'list') {
    const name = PAGE_PARAMS.get('list');
    if (name && renderedLists[name]) openFontDialog(name, FONT_OPENED_IN_TAB);
  }
}

function setupFontDialog() {
  const input = byId('font-name-input');
  input?.addEventListener('input', handleFontNameInput);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!localFontNames) return;
      e.preventDefault();
      moveActiveFontOption(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    // 한글을 조합하는 중의 Enter 는 글자를 확정하는 키이므로 적용하지 않음
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    applyFontDialog();
  });

  const list = byId('font-list');
  // 줄을 눌러도 입력란에서 포커스가 빠지지 않게 (↑↓·Enter 를 이어서 쓸 수 있음)
  list?.addEventListener('mousedown', e => e.preventDefault());
  list?.addEventListener('click', (e) => {
    const opt = e.target instanceof Element ? e.target.closest('.font-option') : null;
    if (opt) setActiveFontOption(opt, true);
  });
  // 두 번 누르면 바로 적용
  list?.addEventListener('dblclick', (e) => {
    const opt = e.target instanceof Element ? e.target.closest('.font-option') : null;
    if (!opt) return;
    setActiveFontOption(opt, true);
    applyFontDialog();
  });

  byId('font-ok-btn')?.addEventListener('click', applyFontDialog);
  byId('font-cancel-btn')?.addEventListener('click', closeFontDialog);
  byId('font-load-btn')?.addEventListener('click', handleFontPermissionButton);
}
