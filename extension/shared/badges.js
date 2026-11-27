// shared/badges.js — 타임라인 배지 (누가 어느 리스트인지 · 글자 스타일 · 트윗에 그리기)
// 팝업의 미리보기도 같은 함수(applyBadgeStyle)를 써서 실제 타임라인과 같은 모양을 보여 줍니다.
// ⚠️ shared/ 파일의 최상위에는 function 선언과 var 만 씁니다 (이유는 shared/base.js 머리말).

// ==========================================
// 규칙 (폰트 · 트윗 선택자 · 배지 수 · 흐리게 할 부분)
// ==========================================

// 배지 글자 스타일: 고를 수 있는 폰트와 화면 표시 이름, 리스트별로 덮어쓸 수 있는 항목
var AG_FONT_FAMILIES = ['system', "'Arial', sans-serif", "'Roboto', sans-serif", "'Noto Sans KR', sans-serif",
  "'Pretendard', sans-serif", 'monospace', "'Georgia', serif"];
var AG_FONT_LABELS = {
  'system': '시스템 기본',
  "'Arial', sans-serif": 'Arial',
  "'Roboto', sans-serif": 'Roboto',
  "'Noto Sans KR', sans-serif": 'Noto Sans KR',
  "'Pretendard', sans-serif": 'Pretendard',
  'monospace': 'Monospace',
  "'Georgia', serif": 'Georgia'
};
var AG_LIST_STYLE_KEYS = ['textColor', 'fontSize', 'fontFamily'];
// 직접 입력한 폰트(사용자 컴퓨터에 설치된 폰트)는 "'이름', sans-serif" 로 저장합니다.
// 이름에는 CSS 문자열을 깨거나 다른 값을 섞을 수 있는 글자(따옴표, \, 쉼표, ;, 괄호 {} <>, 제어 문자)를 쓸 수 없습니다.
var AG_FONT_NAME_MAX_LENGTH = 64;
var AG_FONT_NAME_FORBIDDEN = /['"\\,;{}<>]|\p{Cc}/u;

// 트윗과 그 안의 작성자 이름 영역 (X 화면 구조에 의존. 바꾸면 tests/fixtures/ 와 shared/health.js 도 함께 봄)
var AG_TWEET_SELECTOR = 'article[data-testid="tweet"]';
var AG_USER_NAME_SELECTOR = '[data-testid="User-Name"]';

// 타임라인 배지 표시 설정 (chrome.storage.local 의 displaySettings, 팝업 [설정] 시트)
//   maxBadges: 이름 옆에 보일 배지 수 (0 = 모두). 넘치면 배지 순서가 뒤인 리스트를 "+N" 하나로 묶음
//   ellipsis: 긴 리스트 이름을 nameWidth 글자 폭에서 말줄임(…)할지. 끄면 이름 줄 폭까지 다 보임
//   nameWidth: 말줄임할 폭 (em, 대략 글자 수)
//   badgeShape: 배지 모서리 'round'(둥글게) | 'square'(각지게)
//   quoteBadges: 인용 트윗 작성자에게도 작은 배지를 붙일지
//   dimLevel: 흐리게 모드 리스트 멤버의 트윗을 얼마나 흐리게 할지 'light' | 'normal' | 'strong'
var AG_DEFAULT_DISPLAY_SETTINGS = { maxBadges: 3, ellipsis: true, nameWidth: 10, badgeShape: 'round', quoteBadges: true, dimLevel: 'normal' };
var AG_MAX_BADGES_LIMIT = 10;
var AG_NAME_WIDTHS = [6, 8, 10, 14, 20];
var AG_BADGE_RADII = { round: '12px', square: '4px' };
var AG_DIM_OPACITY = { light: 0.65, normal: 0.45, strong: 0.25 };

// 흐리게 모드에서 흐리게 할 트윗 부분 (프로필 사진·본문·미디어·버튼). 이름과 배지 줄은 또렷하게 둠.
// styles.css 의 [data-ag-dim="body"] 규칙과 같은 목록이어야 합니다.
var AG_DIM_TARGET_SELECTOR = [
  '[data-testid="Tweet-User-Avatar"]', '[data-testid="tweetText"]', '[data-testid="tweetPhoto"]',
  '[data-testid="card.wrapper"]', '[data-testid="videoPlayer"]', '[data-testid="videoComponent"]', '[role="group"]'
].join(', ');

// ==========================================
// 핸들 → 소속 리스트
// ==========================================

// 핸들(소문자) → 소속 리스트 정보 배열 (예: '@alice': [{ name: '친구', color, mode }]).
// 배열은 배지 순서(shared/list-data.js sortListsByPriority)대로라, 타임라인 배지와 강조 색이 이 순서를 따름
function buildHandleMap(listData) {
  const map = {};
  sortListsByPriority(listData).forEach((listName) => {
    const info = listData[listName];
    const style = normalizeListStyle(info.style);
    info.members.forEach((handle) => {
      const lower = String(handle).toLowerCase();
      if (!map[lower]) map[lower] = [];
      const entry = { name: listName, color: info.color || AG_DEFAULT_LIST_COLOR, mode: info.mode || 'normal' };
      if (style) entry.style = style;
      map[lower].push(entry);
    });
  });
  return map;
}

// 두 핸들 맵을 비교해 배지 표시가 달라지는 핸들 목록.
// 리스트가 바뀔 때 화면 전체가 아니라 이 핸들이 쓴 트윗만 다시 그리기 위해 사용.
function diffHandleMaps(oldMap, newMap) {
  const a = oldMap || {};
  const b = newMap || {};
  const allHandles = new Set(Object.keys(a).concat(Object.keys(b)));
  const changed = [];
  allHandles.forEach((handle) => {
    if (JSON.stringify(a[handle] || null) !== JSON.stringify(b[handle] || null)) changed.push(handle);
  });
  return changed;
}

// 트윗 처리 서명(dataset.agProcessed = "@a,@b")에 바뀐 핸들이 하나라도 있으면 true
function isTweetAffected(handlesKey, changedHandles) {
  if (!handlesKey) return false;
  const changed = changedHandles instanceof Set ? changedHandles : new Set(changedHandles || []);
  if (changed.size === 0) return false;
  return String(handlesKey).split(',').some(h => h && changed.has(h));
}

// ==========================================
// 글자 스타일 (공통 설정 · 리스트별 설정)
// ==========================================

// 배지에 사용자 스타일 적용 (X 의 CSS 에 덮이지 않도록 CSS 변수 + 인라인 !important)
function applyBadgeStyle(badge, bgColor, settings, isMainAuthor) {
  const s = Object.assign({}, AG_DEFAULT_BADGE_SETTINGS, settings || {});
  const size = (isMainAuthor ? s.fontSize : Math.max(8, s.fontSize - 2)) + 'px';
  const background = bgColor || AG_DEFAULT_LIST_COLOR;
  const style = badge.style;

  style.setProperty('--ag-badge-bg', background);
  style.setProperty('--ag-badge-fg', s.textColor);
  style.setProperty('--ag-badge-fs', size);
  style.setProperty('background-color', background, 'important');
  style.setProperty('color', s.textColor, 'important');
  style.setProperty('font-size', size, 'important');

  if (s.fontFamily && s.fontFamily !== 'system') {
    style.setProperty('--ag-badge-ff', s.fontFamily);
    style.setProperty('font-family', s.fontFamily, 'important');
  } else {
    style.removeProperty('--ag-badge-ff');
    style.removeProperty('font-family');
  }
}

// 리스트별 글자 스타일 검증: 올바른 항목만 남기고, 남는 게 없으면 null
function normalizeListStyle(style) {
  if (!style || typeof style !== 'object') return null;
  const out = {};
  if (isHexColor(style.textColor)) out.textColor = style.textColor;
  const size = parseInt(style.fontSize, 10);
  if (size >= 8 && size <= 20) out.fontSize = size;
  if (isValidFontFamily(style.fontFamily)) out.fontFamily = style.fontFamily;
  return Object.keys(out).length > 0 ? out : null;
}

// ==========================================
// 폰트 (고를 수 있는 폰트 · 직접 입력한 폰트)
// ==========================================

// 직접 입력한 폰트 이름 정리: 공백을 하나로 줄이고 앞뒤 공백·따옴표를 뗌.
// 비었거나, 너무 길거나, 쓸 수 없는 글자(AG_FONT_NAME_FORBIDDEN)가 있으면 ''
function normalizeFontName(raw) {
  if (typeof raw !== 'string') return '';
  let name = raw.replace(/\s+/g, ' ').trim();
  const quoted = name.match(/^(['"])(.*)\1$/);
  if (quoted) name = quoted[2].trim();
  if (!name || name.length > AG_FONT_NAME_MAX_LENGTH || AG_FONT_NAME_FORBIDDEN.test(name)) return '';
  return name;
}

// 저장된 font-family 값에서 폰트 이름 ("'Roboto', sans-serif" → 'Roboto'). 이름이 든 값이 아니면('system' 등) ''
function getFontNameFromFamily(fontFamily) {
  const m = typeof fontFamily === 'string' ? fontFamily.match(/^'([^']+)', (?:sans-serif|serif)$/) : null;
  return m && normalizeFontName(m[1]) === m[1] ? m[1] : '';
}

// 폰트 이름 → 저장할 font-family 값. 고를 수 있는 폰트와 이름이 같으면 그 값(예: 'georgia' → "'Georgia', serif").
// 쓸 수 없는 이름이면 ''
function buildFontFamily(name) {
  const clean = normalizeFontName(name);
  if (!clean) return '';
  const preset = AG_FONT_FAMILIES.find(f => getFontNameFromFamily(f).toLowerCase() === clean.toLowerCase());
  return preset || `'${clean}', sans-serif`;
}

// 배지에 쓸 수 있는 font-family 값인지 (고를 수 있는 폰트, 또는 buildFontFamily 로 만든 직접 입력 폰트)
function isValidFontFamily(fontFamily) {
  if (AG_FONT_FAMILIES.indexOf(fontFamily) !== -1) return true;
  return typeof fontFamily === 'string' && /, sans-serif$/.test(fontFamily) && getFontNameFromFamily(fontFamily) !== '';
}

// 고를 수 있는 폰트 목록에 없는, 직접 입력한 폰트인지
function isCustomFontFamily(fontFamily) {
  return AG_FONT_FAMILIES.indexOf(fontFamily) === -1 && isValidFontFamily(fontFamily);
}

// 선택 목록에 보일 폰트 이름 (직접 입력한 폰트는 그 이름)
function getFontLabel(fontFamily) {
  return AG_FONT_LABELS[fontFamily] || getFontNameFromFamily(fontFamily) || String(fontFamily || '');
}

// 이 컴퓨터에 그 폰트가 있어 보이는지. 같은 글자를 기본 글꼴만으로 그린 폭과 "그 폰트, 기본 글꼴"로 그린 폭이
// 하나라도 다르면 그 폰트로 그려진 것. measureWidth(fontFamily) 는 그 font-family 로 그린 글자 폭 (팝업은 canvas 로 잼).
// 기본 글꼴과 폭이 똑같은 폰트는 없다고 나올 수 있어, 안내 문구에만 씀
function isFontLikelyInstalled(name, measureWidth) {
  const clean = normalizeFontName(name);
  if (!clean) return false;
  return ['monospace', 'serif', 'sans-serif'].some(base => measureWidth(`'${clean}', ${base}`) !== measureWidth(base));
}

// window.queryLocalFonts() 결과(FontData 목록) → 폰트 이름 목록. 굵기별로 나뉜 항목은 하나로 묶고(대소문자 무시),
// 쓸 수 없는 이름은 빼고, 이름순
function getLocalFontFamilies(fontDataList) {
  const seen = {};
  const names = [];
  Array.from(fontDataList || []).forEach((font) => {
    const name = normalizeFontName(font && font.family);
    const key = name.toLowerCase();
    if (!name || seen[key]) return;
    seen[key] = true;
    names.push(name);
  });
  return names.sort((a, b) => a.localeCompare(b, 'ko'));
}

// 실제로 배지에 쓸 글자 스타일 = 기본값 ← 공통 설정 ← 리스트별 설정 (뒤가 앞을 덮어씀)
function getEffectiveBadgeSettings(globalSettings, listStyle) {
  return Object.assign({}, AG_DEFAULT_BADGE_SETTINGS, globalSettings || {}, normalizeListStyle(listStyle) || {});
}

// 공통 배지 설정 검증 (잘못된 값은 기본값으로)
function normalizeBadgeSettings(settings) {
  return Object.assign({}, AG_DEFAULT_BADGE_SETTINGS, normalizeListStyle(settings) || {});
}

// 리스트의 글자 스타일 일부를 바꿈. 값이 null/undefined 인 항목은 지워서 공통 설정을 따르게 함.
// 남는 항목이 없으면 style 자체를 지움. 리스트가 없으면 false
function setListStyle(lists, listName, patch) {
  const list = lists && lists[listName];
  if (!list) return false;
  const next = Object.assign({}, list.style || {});
  Object.keys(patch || {}).forEach((key) => {
    if (AG_LIST_STYLE_KEYS.indexOf(key) === -1) return;
    if (patch[key] === null || patch[key] === undefined) delete next[key];
    else next[key] = patch[key];
  });
  const normalized = normalizeListStyle(next);
  if (normalized) list.style = normalized;
  else delete list.style;
  return true;
}

// 타임라인 배지 표시 설정 검증 (잘못되거나 빠진 값은 기본값으로)
function normalizeDisplaySettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const d = AG_DEFAULT_DISPLAY_SETTINGS;
  const has = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
  return {
    maxBadges: Number.isInteger(s.maxBadges) && s.maxBadges >= 0 && s.maxBadges <= AG_MAX_BADGES_LIMIT ? s.maxBadges : d.maxBadges,
    ellipsis: typeof s.ellipsis === 'boolean' ? s.ellipsis : d.ellipsis,
    nameWidth: AG_NAME_WIDTHS.indexOf(s.nameWidth) !== -1 ? s.nameWidth : d.nameWidth,
    badgeShape: has(AG_BADGE_RADII, s.badgeShape) ? s.badgeShape : d.badgeShape,
    quoteBadges: typeof s.quoteBadges === 'boolean' ? s.quoteBadges : d.quoteBadges,
    dimLevel: has(AG_DIM_OPACITY, s.dimLevel) ? s.dimLevel : d.dimLevel
  };
}

// 배지 묶음의 말줄임 폭과 모서리를 CSS 변수로 넣음 (styles.css 의 .ag-list-badge 가 씀. 팝업 미리보기도 같은 함수)
function applyBadgeLayout(wrapper, displaySettings) {
  const d = normalizeDisplaySettings(displaySettings);
  wrapper.style.setProperty('--ag-badge-max-w', d.ellipsis ? d.nameWidth + 'em' : '100%');
  wrapper.style.setProperty('--ag-badge-radius', AG_BADGE_RADII[d.badgeShape]);
}

// 모든 리스트의 개별 글자 스타일을 지움 (모두 공통 설정을 따르게). 지운 리스트 수 반환
function clearAllListStyles(lists) {
  let cleared = 0;
  Object.keys(lists || {}).forEach((name) => {
    if (lists[name] && lists[name].style) {
      delete lists[name].style;
      cleared++;
    }
  });
  return cleared;
}

// 개별 글자 스타일을 가진 리스트 수
function countListsWithStyle(lists) {
  return Object.keys(lists || {}).filter(name => lists[name] && normalizeListStyle(lists[name].style)).length;
}

// ==========================================
// 트윗에 배지 그리기
// ==========================================

// 배지를 붙일 위치: 이름 링크(<a>)의 부모, 링크가 없으면(인용 트윗 등) 이름 영역의 첫 요소
function getBadgeAnchor(userInfoDiv) {
  if (!userInfoDiv) return null;
  const link = userInfoDiv.querySelector('a');
  if (link && link.parentNode) return link.parentNode;
  return userInfoDiv.firstElementChild || userInfoDiv;
}

// 타임라인 배지 묶기: 앞에서 max 개만 보이고 나머지는 "+N" 하나로 (max 가 0 이면 모두 보임, 없으면 기본값).
// lists 는 배지 순서대로 (buildHandleMap). 같은 이름은 한 번만
function splitTimelineBadges(lists, max) {
  const limit = Number.isInteger(max) && max >= 0 ? max : AG_DEFAULT_DISPLAY_SETTINGS.maxBadges;
  const seen = {};
  const unique = (lists || []).filter((l) => {
    if (!l || seen[l.name]) return false;
    seen[l.name] = true;
    return true;
  });
  if (limit === 0 || unique.length <= limit) return { visible: unique, hidden: [] };
  return { visible: unique.slice(0, limit), hidden: unique.slice(limit) };
}

// 트윗 작성자 이름 영역에서 "@handle"(소문자)
function getHandleFromUserInfo(userInfoDiv) {
  const handleSpan = Array.from(userInfoDiv.querySelectorAll('span'))
    .find(span => span.textContent.trim().startsWith('@'));
  if (handleSpan) return handleSpan.textContent.trim().toLowerCase();

  const link = userInfoDiv.querySelector('a[href^="/"]');
  const handle = link && getHandleFromProfileHref(link.getAttribute('href'));
  return handle ? '@' + handle.toLowerCase() : null;
}

// 이름 영역 옆에 리스트 배지들을 붙임 (이미 붙인 배지는 지우고 새로 그림).
// badgeSettings 는 공통 글자 스타일, displaySettings 는 표시 설정(보일 배지 수 · 말줄임 · 모양)
function addBadges(userInfoDiv, lists, isMainAuthor, badgeSettings, displaySettings) {
  const anchor = getBadgeAnchor(userInfoDiv);
  if (!anchor) return;
  const display = normalizeDisplaySettings(displaySettings);

  let wrapper = anchor.querySelector('.ag-badges-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('span');
    wrapper.className = 'ag-badges-wrapper';
    anchor.appendChild(wrapper);
  }
  wrapper.textContent = '';
  applyBadgeLayout(wrapper, display);

  // 배지가 많으면 이름 줄이 여러 줄로 밀리므로, 몇 개만 보이고 나머지는 "+N" 으로 묶음
  const { visible, hidden } = splitTimelineBadges(lists, display.maxBadges);
  visible.forEach((list) => {
    const badge = document.createElement('span');
    // 원 트윗 작성자는 일반 배지, 인용 트윗 등의 작성자는 미니 배지
    badge.className = isMainAuthor ? 'ag-list-badge' : 'ag-list-badge mini-badge';
    badge.textContent = list.name;
    // 긴 이름은 말줄임(…)으로 잘리므로 전체 이름은 툴팁으로
    badge.title = list.name;
    // 글자 스타일: 공통 설정 위에 이 리스트만의 설정(list.style)을 덮어씀
    applyBadgeStyle(badge, list.color, getEffectiveBadgeSettings(badgeSettings, list.style), isMainAuthor);
    wrapper.appendChild(badge);
  });

  if (hidden.length > 0) {
    const all = visible.concat(hidden).map(l => l.name);
    const more = document.createElement('span');
    more.className = isMainAuthor ? 'ag-badge-more' : 'ag-badge-more mini-badge';
    more.textContent = `+${hidden.length}`;
    more.title = `banmo tag 리스트 ${all.length}개: ${all.join(', ')}`;
    more.setAttribute('aria-label', more.title);
    wrapper.appendChild(more);
  }
}

// 트윗에 붙인 배지·테두리·투명도를 지움 (X 가 트윗 DOM 을 다른 트윗에 재사용할 때 대비)
function resetTweetStyle(tweet) {
  delete tweet.dataset.agProcessed;
  delete tweet.dataset.agDim;
  tweet.style.removeProperty('--ag-dim-opacity');
  tweet.style.borderLeft = '';
  tweet.style.opacity = ''; // 이전 버전이 트윗 전체에 넣던 투명도
  tweet.querySelectorAll('.ag-badges-wrapper').forEach(w => w.remove());
}

// 트윗 하나 처리: 작성자(와 인용된 작성자)마다 배지, 원 작성자의 리스트 모드로 강조/흐리게.
// handleMap 은 buildHandleMap 의 결과, badgeSettings 는 공통 글자 스타일, displaySettings 는 표시 설정
function renderTweet(tweet, handleMap, badgeSettings, displaySettings) {
  const userInfoDivs = tweet.querySelectorAll(AG_USER_NAME_SELECTOR);
  if (userInfoDivs.length === 0) return;
  const display = normalizeDisplaySettings(displaySettings);

  // X 가 가상 스크롤로 트윗 DOM 을 다른 작성자 트윗에 재사용해도, 작성자 핸들 서명이 다르면 초기화 후 다시 그림
  const handles = Array.from(userInfoDivs, getHandleFromUserInfo);
  const handlesKey = handles.map(h => h || '').join(',') || 'none';
  if (tweet.dataset.agProcessed === handlesKey) return;
  if (tweet.dataset.agProcessed) resetTweetStyle(tweet);

  let highlightColor = '';
  let shouldDim = false;

  userInfoDivs.forEach((userInfoDiv, index) => {
    const handle = handles[index];
    const lists = handle && handleMap[handle];
    if (!lists) return;

    const isMainAuthor = index === 0;
    if (isMainAuthor) {
      lists.forEach((list) => {
        // 여러 강조 리스트에 속하면 배지 순서가 가장 앞인 리스트의 색상 사용
        if (list.mode === 'highlight' && !highlightColor) highlightColor = list.color;
        else if (list.mode === 'dim') shouldDim = true;
      });
    }
    // 인용 트윗 작성자 배지는 설정에서 끌 수 있음
    if (isMainAuthor || display.quoteBadges) addBadges(userInfoDiv, lists, isMainAuthor, badgeSettings, display);
  });

  // 강조가 흐리게보다 우선
  if (highlightColor) {
    tweet.style.borderLeft = `4px solid ${highlightColor}`;
  } else if (shouldDim) {
    // 본문·사진·버튼만 흐리게 하고 이름과 배지는 또렷하게 (styles.css).
    // 흐리게 할 부분을 찾지 못하면(X 화면 구조 변경 등) 예전처럼 트윗 전체를 흐리게
    tweet.dataset.agDim = tweet.querySelector(AG_DIM_TARGET_SELECTOR) ? 'body' : 'all';
    tweet.style.setProperty('--ag-dim-opacity', String(AG_DIM_OPACITY[display.dimLevel]));
  }

  tweet.dataset.agProcessed = handlesKey;
}

// 확장 프로그램이 직접 넣은 배지 노드인지 (MutationObserver 가 자기 변경에 반응하지 않도록)
function isOwnInjectedNode(node) {
  if (!node || node.nodeType !== 1) return false;
  const cls = node.classList;
  return !!cls && (cls.contains('ag-badges-wrapper') || cls.contains('ag-list-badge') || cls.contains('ag-badge-more'));
}
