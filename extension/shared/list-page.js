// shared/list-page.js — X 리스트 화면 읽기 (주소 · 수집해도 되는 화면인지 · 리스트 이름 · 멤버)
// X 의 화면 구조(data-testid 등)에 의존하는 부분입니다. 선택자를 바꾸면 tests/fixtures/ 와 shared/health.js 도 함께 봅니다.
// ⚠️ shared/ 파일의 최상위에는 function 선언과 var 만 씁니다 (이유는 shared/base.js 머리말).

// ==========================================
// 규칙 (탭 이름 · 경로 · 추천 영역 표기)
// ==========================================

// 리스트 화면의 탭 이름
var AG_MEMBER_TAB_NAMES = ['구성원', '멤버', 'Members'];
var AG_SUGGESTED_TAB_NAMES = ['추천', 'Suggested'];

// "/user/lists/..." 형식에서 user 자리에 올 수 없는 경로
var AG_NON_USER_LIST_PATHS = ['i', 'lists', 'home', 'explore', 'notifications', 'messages'];

// 멤버 셀의 링크 중 사용자 프로필이 아닌 경로 (멤버 추출 시 건너뜀)
var AG_MEMBER_LINK_IGNORE = ['home', 'explore', 'notifications', 'messages', 'lists', 'bookmarks', 'settings', 'i'];

// 추천 영역 제목/aria-label (전체 일치로 비교)
var AG_RECO_LABELS = ['팔로우 추천', 'Who to follow', '추천 사용자', '추천', 'Suggested', 'Connect',
  '팔로우할 만한 계정', '회원님을 위한 추천', 'You might like'];

// 팝업 [가져오기]가 동작하는 탭 주소
var AG_X_URL_RE = /^https?:\/\/([^\/]+\.)?(x|twitter)\.com\//;

// 구간 제목으로 보는 요소
var AG_HEADING_SELECTOR = 'h1, h2, h3, [role="heading"]';

// ==========================================
// 주소 · 수집 정책
// ==========================================

// 리스트 주소 분석. 전체 URL 과 pathname 모두 지원.
//   /i/lists/:id[/members|/followers]  또는  /:user/lists/:slug[/members|/followers]
// 반환: { listId, isMembers, isFollowers, isMain } 또는 리스트 주소가 아니면 null
function parseListUrl(pathnameOrUrl) {
  const path = String(pathnameOrUrl || '')
    .replace(/^https?:\/\/[^\/]+/i, '')
    .split(/[?#]/)[0]
    .replace(/\/+$/, '');

  const toListInfo = (listId, subpage) => ({
    listId,
    isMembers: subpage === 'members',
    isFollowers: subpage === 'followers',
    isMain: !subpage
  });

  const byId = path.match(/^\/i\/lists\/([^\/]+)(?:\/(members|followers))?/);
  if (byId) return toListInfo(byId[1], byId[2]);

  const byUser = path.match(/^\/([^\/]+)\/lists\/([^\/]+)(?:\/(members|followers))?/);
  if (byUser && AG_NON_USER_LIST_PATHS.indexOf(byUser[1]) === -1) return toListInfo(byUser[2], byUser[3]);

  return null;
}

// 선택된 탭의 글자 ("구성원" / "추천" 등). 탭이 없으면 null
function getActiveTabText(root) {
  if (!root || !root.querySelector) return null;
  const tab = root.querySelector('[role="tab"][aria-selected="true"]');
  return tab ? tab.textContent.trim() : null;
}

// 지금 화면에서 멤버를 수집하면 안 되는 이유. 수집해도 되면 null
// - 리스트 주소가 아님 (좋아요/재게시 목록 등 무관한 창 배제)
// - 리스트 팔로워 화면 (팔로워는 멤버가 아님)
// - "추천" 탭 (멤버가 아닌 추천 계정)
// - 자동 수집은 멤버 화면(또는 멤버 창)에서, 탭이 있다면 "구성원" 탭일 때만
function getScrapeBlockReason(urlInfo, root, dialog, isManual) {
  if (!urlInfo) return '리스트 페이지가 아닙니다. 리스트의 멤버 화면에서 시도해주세요.';
  if (urlInfo.isFollowers) return '리스트 팔로워는 멤버가 아니므로 수집하지 않습니다.';

  const activeTab = getActiveTabText(root);
  if (activeTab && AG_SUGGESTED_TAB_NAMES.indexOf(activeTab) !== -1) {
    return '"추천" 탭에서는 수집하지 않습니다. "구성원" 탭을 선택해주세요.';
  }

  if (!isManual) {
    if (!urlInfo.isMembers && !dialog) return '자동 수집은 리스트 멤버 화면에서만 동작합니다.';
    if (activeTab && AG_MEMBER_TAB_NAMES.indexOf(activeTab) === -1) return '"구성원" 탭에서만 자동 수집합니다.';
  }
  return null;
}

// 팝업 [가져오기] 대상 탭 검사. 문제가 없으면 null.
// tabs 권한이 없어서 X 가 아닌 탭은 url 이 비어 있음 → "X 페이지가 아님"으로 안내
function getSyncTabError(tab) {
  if (!tab || tab.id === undefined || tab.id === null) return '활성화된 탭을 찾을 수 없습니다.';
  if (!tab.url || !AG_X_URL_RE.test(tab.url)) return '현재 탭이 X(Twitter) 페이지가 아닙니다.';
  return null;
}

// ==========================================
// 리스트 이름 읽기
// ==========================================

// 화면(root = document)에 떠 있는 리스트 멤버 창(모달). 없으면 null
function getMemberListDialog(root) {
  for (const dialog of root.querySelectorAll('div[role="dialog"]')) {
    const heading = dialog.querySelector('h2, h1, [role="heading"]');
    const headingText = heading ? heading.textContent : '';
    const looksLikeMemberDialog =
      headingText.includes('멤버') ||
      headingText.includes('구성원') ||
      headingText.includes('Member') ||
      dialog.querySelector('[data-testid="UserCell"]') !== null;
    if (looksLikeMemberDialog) return dialog;
  }
  return null;
}

// 요소들의 글자를 정제해 처음으로 나오는 올바른 리스트 이름
function firstValidCleanName(elements, skipRaw) {
  for (const el of elements) {
    const raw = el.textContent.trim();
    if (skipRaw && skipRaw(raw)) continue;
    const name = cleanListName(raw);
    if (isValidListName(name)) return name;
  }
  return '';
}

function isRecommendationTitle(text) {
  return text.includes('팔로우 추천') || text.includes('Who to follow');
}

// 리스트 이름을 찾는 곳 (위에서부터 차례로 시도). find 는 { root, urlInfo, dialog, cacheKey, cache } 를 받음.
// reliable: false 인 곳(표시 이름 등 엉뚱한 글자일 수 있음)에서 찾은 이름은 세션 캐시에 저장하지 않음
// behindDialog: true 인 곳은 멤버 창 뒤의 배경 화면을 읽으므로, 멤버 창이 떠 있으면 건너뜀.
//   멤버 화면 주소로 바로 들어가면 X 는 홈 타임라인 등 다른 화면을 배경으로 깔고 그 위에 멤버 창을 띄워서,
//   배경의 "내 홈 타임라인" 같은 제목을 리스트 이름으로 잘못 읽게 됨
var AG_LIST_NAME_SOURCES = [
  {
    // 1. 멤버 창의 제목
    reliable: true,
    find: ({ dialog }) => (dialog ? firstValidCleanName(dialog.querySelectorAll('h2, h1, [role="heading"]')) : '')
  },
  {
    // 2. 본문 제목 (멤버 창이 없을 때 가장 믿을 만함)
    reliable: true,
    behindDialog: true,
    find: ({ root }) => firstValidCleanName(
      root.querySelectorAll('[data-testid="primaryColumn"] h2, main h2, h1[role="heading"]'),
      isRecommendationTitle
    )
  },
  {
    // 3. 리스트 메인 화면에서 저장해 둔 이름 (멤버 화면 등 하위 화면에서만)
    reliable: true,
    find: ({ urlInfo, cacheKey, cache }) => {
      if (!cache || !cacheKey || urlInfo.isMain) return '';
      const cached = cache.get(cacheKey);
      return cached && isValidListName(cached) ? cached : '';
    }
  },
  {
    // 4. 브라우저 탭 제목 (" - " 로 자르지 않고 시스템 문구만 지워 "AI - 연구자" 같은 이름 보존)
    reliable: true,
    behindDialog: true,
    find: ({ root }) => {
      const name = cleanListName(root.title || '');
      return isValidListName(name) ? name : '';
    }
  },
  {
    // 5. 상단 바의 짧은 글자
    reliable: false,
    behindDialog: true,
    find: ({ root }) => {
      const topNavBar = root.querySelector('[data-testid="TopNavBar"], header[role="banner"]');
      if (!topNavBar) return '';
      for (const el of topNavBar.querySelectorAll('span, div[dir="auto"]')) {
        const text = el.textContent.trim();
        const usable = text && text.length < 50 && isValidListName(text) &&
          !text.includes('팔로우 추천') && !text.includes('뒤로') &&
          !text.includes('Back') && !text.startsWith('@');
        if (usable) return text;
      }
      return '';
    }
  }
];

// 화면(root = document)에서 순수한 리스트 이름 읽기. 못 찾으면 "리스트 (ID)" 임시 이름.
// cache: 리스트 메인 화면에서 읽은 이름을 멤버 화면에서 다시 쓰려고 적어 두는 곳 { get(key), set(key, value) }
//        (content.js 는 sessionStorage 를 넘김. 생략하면 기억하지 않음)
// info: 객체를 넘기면 info.reliable 에 "믿을 만한 곳에서 읽은 실제 이름인지"를 적어 줌
//       (임시 이름이나 상단 바의 짧은 글자면 false. 저장된 리스트 이름을 이 이름으로 바꿔도 되는지 판단할 때 씀)
function getListNameFromPage(root, urlInfo, dialog, cache, info) {
  const cacheKey = urlInfo && urlInfo.listId ? 'ag_list_name_' + urlInfo.listId : null;
  const context = { root, urlInfo, dialog, cacheKey, cache };

  let candidate = '';
  let reliable = true;
  for (const source of AG_LIST_NAME_SOURCES) {
    if (dialog && source.behindDialog) continue;
    candidate = source.find(context);
    if (candidate) {
      reliable = source.reliable;
      break;
    }
  }

  const idFallback = urlInfo && urlInfo.listId ? '리스트 (' + urlInfo.listId + ')' : 'Unknown List';
  let finalName = cleanListName(candidate || idFallback);
  if (isSystemListName(finalName)) finalName = idFallback;

  // 믿을 만한 곳에서 찾은 실제 이름만 캐시 (임시 이름은 캐시하지 않음)
  const isRealName = reliable && finalName !== 'Unknown List' && !isFallbackListName(finalName);
  if (cache && cacheKey && isRealName) cache.set(cacheKey, finalName);
  if (info) info.reliable = isRealName;
  return finalName;
}

// ==========================================
// 멤버 추출
// ==========================================

// 제목/aria-label 이 "추천 영역" 표기인지.
// 부분 문자열이 아니라 전체 일치로 비교해 "추천 작가", "Connected" 같은 실제 이름은 오탐하지 않음.
// "타임라인: 팔로우 추천" 처럼 콜론 접두사가 있으면 마지막 부분만 비교.
function isRecoLabel(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  const last = trimmed.split(':').pop().trim().toLowerCase();
  return AG_RECO_LABELS.some(label => label.toLowerCase() === last);
}

// 가상 스크롤 목록에서 셀 앞쪽의 가장 가까운 구간 제목 (없으면 null).
// 목록 전체가 아니라 "이 셀이 속한 구간"의 제목만 보므로, 아래쪽 추천 블록이 위쪽 멤버를 지우지 않음.
function getPrecedingSectionHeading(cell) {
  const inner = cell.closest('div[data-testid="cellInnerDiv"]');
  if (!inner) return null;
  for (let sib = inner.previousElementSibling; sib; sib = sib.previousElementSibling) {
    const heading = sib.matches(AG_HEADING_SELECTOR) ? sib : sib.querySelector(AG_HEADING_SELECTOR);
    if (heading) return heading.textContent.trim();
  }
  return null;
}

// section 안에서 셀보다 앞에 있는 마지막 제목 (가상 스크롤 셀이 아닌 구조용)
function getLastHeadingBefore(section, cell) {
  let lastBefore = null;
  section.querySelectorAll(AG_HEADING_SELECTOR).forEach((heading) => {
    // DOCUMENT_POSITION_FOLLOWING(4): cell 이 제목보다 뒤에 있음
    if (heading.compareDocumentPosition(cell) & 4) lastBefore = heading;
  });
  return lastBefore;
}

// 멤버가 아닌 셀(추천 계정, 멤버 창 뒤쪽 화면, 사이드바)이면 true
function isExcludedUserCell(cell, dialog) {
  // 1. 멤버 창이 열려 있으면 창 밖(뒤쪽 화면/사이드바)의 셀은 제외
  if (dialog && !dialog.contains(cell)) return true;

  // 2. 오른쪽 사이드바
  if (cell.closest('[data-testid="sidebarColumn"]') || cell.closest('aside')) return true;

  // 3. 부모 중 aria-label 이 추천 영역 표기인 컨테이너 (멤버 창 밖으로는 올라가지 않음)
  for (let el = cell.parentElement; el; el = el.parentElement) {
    if (el.hasAttribute && el.hasAttribute('aria-label') && isRecoLabel(el.getAttribute('aria-label'))) return true;
    if (dialog && el === dialog) break;
  }

  // 4. 멤버 창 안에서 "추천" 탭이 선택된 경우
  if (dialog) {
    const activeTab = dialog.querySelector('[role="tab"][aria-selected="true"]');
    if (activeTab && AG_SUGGESTED_TAB_NAMES.indexOf(activeTab.textContent.trim()) !== -1) return true;
  }

  // 5. 셀 바로 앞 구간 제목이 "팔로우 추천" 등
  if (isRecoLabel(getPrecedingSectionHeading(cell))) return true;

  // 6. 가상 스크롤 셀이 아니면: 감싼 section 에서 셀 앞의 마지막 제목이 추천 영역
  if (!cell.closest('div[data-testid="cellInnerDiv"]')) {
    const section = cell.closest('section');
    if (section && (!dialog || dialog.contains(section))) {
      const heading = getLastHeadingBefore(section, cell);
      if (heading && isRecoLabel(heading.textContent)) return true;
    }
  }
  return false;
}

// 셀 하나에서 멤버 핸들("@handle") 찾기: 프로필 링크 → 없으면 "@handle" 글자
function getHandleFromUserCell(cell) {
  for (const link of cell.querySelectorAll('a[role="link"], a[href^="/"]')) {
    const handle = getHandleFromProfileHref(link.getAttribute('href'));
    if (handle && AG_MEMBER_LINK_IGNORE.indexOf(handle.toLowerCase()) === -1) return '@' + handle;
  }
  for (const el of cell.querySelectorAll('span, div')) {
    const match = el.textContent.trim().match(/^@([A-Za-z0-9_]{1,15})$/);
    if (match) return '@' + match[1];
  }
  return null;
}

// 컨테이너 안 UserCell 들에서 멤버 핸들 목록 추출 (추천 계정 등은 제외, 중복 제거)
function extractMembersFromContainer(container, dialog) {
  if (!container) return [];
  const members = new Set();
  container.querySelectorAll('[data-testid="UserCell"]').forEach((cell) => {
    if (isExcludedUserCell(cell, dialog || null)) return;
    const handle = getHandleFromUserCell(cell);
    if (handle) members.add(handle);
  });
  return Array.from(members);
}

// 같은 리스트·멤버 조합을 다시 보내지 않기 위한 서명 (순서·대소문자 무관)
function buildScrapeSignature(listName, members) {
  const sorted = (members || []).map(m => String(m).toLowerCase()).sort();
  return listName + '|' + sorted.join(',');
}
