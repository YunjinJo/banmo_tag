// popup/font-dialog.js — [다른 폰트 직접 입력…] 창: 컴퓨터에 설치된 폰트 이름 입력 · (크롬) 설치된 폰트 목록 불러오기
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).
//
// 폰트 파일을 넣거나 내려받지 않고, 고른 폰트의 이름만 저장합니다("'이름', sans-serif"). 배지는 X 를 보는 컴퓨터에
// 설치된 그 폰트로 그려지고, 없으면 기본 폰트로 보입니다.
// 설치된 폰트 목록(window.queryLocalFonts)은 크롬·엣지에만 있고, 처음 한 번 권한을 묻습니다. 크롬은 확장 프로그램 팝업에서
// 권한 창을 띄우지 않고 빈 목록을 돌려주므로, 그때는 같은 창을 새 탭 화면에서 열어 이어서 고르게 합니다.

// 폰트 선택 목록의 마지막 항목 값: 고르면 이 창을 엶 (저장되는 값이 아님)
const FONT_CUSTOM_OPTION = 'custom:';

// 이 창이 바꿀 대상 리스트 이름 (null 이면 공통 설정)
let fontDialogList = null;
let fontDialogReturnFocus = null;
// 불러온 설치 폰트 이름 (소문자로 찾기), 폭 재기용 canvas
let localFontNames = null;
let fontMeasureContext = null;

const FONT_PERMISSION_BLOCKED = '이 확장 프로그램의 글꼴 권한이 차단되어 있습니다. 주소창 왼쪽의 사이트 정보 버튼이나 ' +
  '크롬 설정 > 개인정보 보호 및 보안 > 사이트 설정 > 글꼴 에서 허용한 뒤 다시 눌러 주세요.';
const FONT_OPENED_IN_TAB = '팝업에서는 권한을 묻는 창을 띄울 수 없어 새 탭에서 열었습니다. ' +
  '[이 컴퓨터의 폰트 불러오기]를 다시 누르고, 묻는 창에서 [허용]을 누르세요.';

function canListLocalFonts() {
  return typeof window.queryLocalFonts === 'function';
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

  const current = getFontDialogBase().effective.fontFamily;
  const input = byId('font-name-input');
  input.value = isCustomFontFamily(current) ? getFontNameFromFamily(current) : '';
  byId('font-dialog-target').textContent = fontDialogList
    ? `'${fontDialogList}' 리스트 배지에 쓸 폰트`
    : '모든 리스트 배지에 쓸 기본 폰트';
  byId('font-load-btn').hidden = !canListLocalFonts();
  byId('font-browser-note').hidden = canListLocalFonts();
  setFontListMessage(note || '', false);

  layer.style.display = 'flex';
  updateInert();
  updateFontDialogCheck();
  input.focus();
  input.select();
}

function closeFontDialog() {
  const layer = byId('font-dialog');
  if (!layer || !isFontDialogOpen()) return;
  layer.style.display = 'none';
  fontDialogList = null;
  updateInert();
  restoreFocus(fontDialogReturnFocus);
}

// [적용]: 입력한 이름을 저장. 고를 수 있는 폰트와 이름이 같으면 그 폰트로 저장됨 (buildFontFamily)
function applyFontDialog() {
  const family = buildFontFamily(byId('font-name-input').value);
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
}

// 입력란 아래 상태: 이름 형식 검사 → 이 컴퓨터에 있는지. [적용] 버튼과 미리보기도 함께 갱신
function updateFontDialogCheck() {
  const raw = byId('font-name-input').value;
  const name = normalizeFontName(raw);
  const check = byId('font-check');
  const okBtn = byId('font-ok-btn');
  const base = getFontDialogBase();

  const [kind, text] = describeFontName(raw, name);
  check.textContent = text;
  check.className = 'font-check' + (kind ? ' ' + kind : '');
  okBtn.disabled = !name;

  const family = name ? buildFontFamily(name) : base.effective.fontFamily;
  const preview = byId('font-dialog-preview');
  preview.textContent = base.label;
  applyBadgeStyle(preview, base.color, { ...base.effective, fontFamily: family }, true);
}

// 입력한 이름의 상태 [종류('' | error | ok | warn), 안내 문구]. name 은 normalizeFontName 결과
function describeFontName(raw, name) {
  if (!raw.trim()) return ['', '설치된 폰트의 이름을 적으세요. 예: 나눔고딕, Malgun Gothic'];
  if (!name) {
    return ['error', raw.trim().length > AG_FONT_NAME_MAX_LENGTH
      ? `폰트 이름은 ${AG_FONT_NAME_MAX_LENGTH}자까지 쓸 수 있습니다.`
      : '폰트 이름에 쓸 수 없는 글자가 있습니다: 따옴표 \' " 와 \\ , ; { } < >'];
  }
  if (isFontAvailable(name)) return ['ok', '이 컴퓨터에서 찾았습니다.'];
  return ['warn', '이 컴퓨터에서 찾지 못했습니다. 이름을 확인하세요. 설치되지 않은 폰트는 기본 폰트로 보입니다.'];
}

// 불러온 목록에 있거나, 글자 폭으로 보아 설치된 폰트이면 true
function isFontAvailable(name) {
  if (localFontNames && localFontNames.has(name.toLowerCase())) return true;
  return isFontLikelyInstalled(name, measureFontWidth);
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

async function getLocalFontsPermission() {
  try {
    return (await navigator.permissions.query({ name: 'local-fonts' })).state;
  } catch {
    return '';
  }
}

// 같은 창을 새 탭 화면에서 열기 (그 탭에서는 권한을 묻는 창이 뜸)
function openFontDialogInTab() {
  const list = fontDialogList;
  return openInTab(list, { font: list ? 'list' : 'common' });
}

// [이 컴퓨터의 폰트 불러오기] (크롬·엣지): 설치된 폰트 이름을 입력란의 자동 완성 목록에 채움
async function loadLocalFonts() {
  const btn = byId('font-load-btn');
  let state = await getLocalFontsPermission();
  if (state === 'denied') {
    setFontListMessage(FONT_PERMISSION_BLOCKED, true);
    return;
  }
  if (state === 'prompt' && !IS_TAB_VIEW) {
    await openFontDialogInTab();
    return;
  }

  let fonts = [];
  await withButtonDisabled(btn, async () => {
    try {
      fonts = await window.queryLocalFonts();
    } catch (err) {
      console.warn('[banmo_tag] 폰트 목록을 받지 못했습니다:', err);
    }
  });
  const names = getLocalFontFamilies(fonts);
  if (names.length === 0) {
    state = await getLocalFontsPermission();
    if (state === 'denied') setFontListMessage(FONT_PERMISSION_BLOCKED, true);
    else if (!IS_TAB_VIEW) await openFontDialogInTab();
    else setFontListMessage('폰트 목록을 받지 못했습니다. 묻는 창에서 [허용]을 누른 뒤 다시 눌러 주세요.', true);
    return;
  }

  localFontNames = new Set(names.map(n => n.toLowerCase()));
  const datalist = byId('local-font-list');
  datalist.textContent = '';
  names.forEach((name) => {
    const opt = makeElement('option');
    opt.value = name;
    datalist.appendChild(opt);
  });
  setFontListMessage(`이 컴퓨터의 폰트 ${names.length}개를 불러왔습니다. 입력란을 누르거나 글자를 적으면 목록에서 고를 수 있습니다.`, false);

  const input = byId('font-name-input');
  input.focus();
  updateFontDialogCheck();
  try {
    input.showPicker();
  } catch {
    // 목록을 바로 펼치지 못해도(사용자 조작 직후가 아님 등) 입력란을 누르면 펼쳐짐
  }
}

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
  input?.addEventListener('input', updateFontDialogCheck);
  input?.addEventListener('keydown', (e) => {
    // 한글을 조합하는 중의 Enter 는 글자를 확정하는 키이므로 적용하지 않음
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    applyFontDialog();
  });
  byId('font-ok-btn')?.addEventListener('click', applyFontDialog);
  byId('font-cancel-btn')?.addEventListener('click', closeFontDialog);
  byId('font-load-btn')?.addEventListener('click', loadLocalFonts);
}
