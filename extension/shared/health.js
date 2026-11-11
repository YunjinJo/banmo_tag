// shared/health.js — X 화면 구조 진단 (X 가 화면 구조를 바꿨는지)
// content.js 가 진단 결과를 저장하고(structureHealth), 팝업이 경고로 보여 줍니다.
// ⚠️ shared/ 파일의 최상위에는 function 선언과 var 만 씁니다 (이유는 shared/base.js 머리말).

// 화면 구조 진단 영역별 팝업 표시 이름
var AG_HEALTH_AREA_LABELS = { members: '멤버 수집', timeline: '타임라인 배지' };

// 화면 구조 진단에서 "사용자 링크"로 세지 않는 경로 (메뉴 링크가 많아 위 목록보다 넓음)
var AG_NAV_PATHS = ['home', 'explore', 'notifications', 'messages', 'lists', 'bookmarks', 'settings', 'i',
  'search', 'compose', 'jobs', 'premium', 'communities', 'tos', 'privacy'];

// 컨테이너 안의 사용자 프로필 링크(/handle) 수 (중복·메뉴 링크 제외)
function countProfileLinks(container) {
  if (!container || !container.querySelectorAll) return 0;
  const handles = new Set();
  container.querySelectorAll('a[href^="/"]').forEach((a) => {
    const handle = getHandleFromProfileHref(a.getAttribute('href'));
    if (handle && AG_NAV_PATHS.indexOf(handle.toLowerCase()) === -1) handles.add(handle.toLowerCase());
  });
  return handles.size;
}

// 확장 프로그램이 기대하는 화면 구조가 보이는지 진단.
// - { area: 'members'|'timeline', ok: true }   정상
// - { area, ok: false, message }                사용자 정보는 보이는데 기대한 구조가 없음 → X 구조 변경 의심
// - null                                        판단할 수 없음 (로딩 중, 트윗이 거의 없는 화면 등)
function diagnoseStructure(doc, urlInfo, dialog) {
  if (!doc || !doc.querySelectorAll) return null;
  if (urlInfo && (urlInfo.isMembers || dialog)) return diagnoseMembersView(doc, dialog);
  return diagnoseTimeline(doc);
}

function diagnoseMembersView(doc, dialog) {
  const suspect = message => ({ area: 'members', ok: false, message });
  const container = dialog || doc.querySelector('[data-testid="primaryColumn"], main[role="main"]');
  if (!container) {
    return countProfileLinks(doc) >= 3 ? suspect('본문 영역(primaryColumn)을 찾지 못했습니다.') : null;
  }
  if (container.querySelector('[data-testid="UserCell"]')) return { area: 'members', ok: true };
  return countProfileLinks(container) >= 3 ? suspect('멤버 목록에서 사용자 셀(UserCell)을 찾지 못했습니다.') : null;
}

function diagnoseTimeline(doc) {
  const suspect = message => ({ area: 'timeline', ok: false, message });
  const tweets = doc.querySelectorAll(AG_TWEET_SELECTOR);
  if (tweets.length === 0) {
    return doc.querySelectorAll('article').length >= 3
      ? suspect('타임라인에서 트윗(article[data-testid="tweet"])을 찾지 못했습니다.')
      : null;
  }
  const hasAuthorName = Array.from(tweets).some(t => t.querySelector(AG_USER_NAME_SELECTOR));
  if (hasAuthorName) return { area: 'timeline', ok: true };
  return tweets.length >= 3 ? suspect('트윗에서 작성자 이름 영역(User-Name)을 찾지 못했습니다.') : null;
}

// 팝업에 보여줄 구조 경고 (최근 maxAgeDays 일 안에 기록된 ok:false 항목)
function getStructureWarnings(health, nowMs, maxAgeDays) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const maxAgeMs = (maxAgeDays || 14) * 24 * 60 * 60 * 1000;
  const warnings = [];
  ['members', 'timeline'].forEach((area) => {
    const h = health && health[area];
    if (!h || h.ok !== false || typeof h.at !== 'number') return;
    if (now - h.at > maxAgeMs) return;
    warnings.push({ area, label: AG_HEALTH_AREA_LABELS[area], message: h.message || '', at: h.at });
  });
  return warnings;
}
