// shared.js
// content.js / popup.js / background.js / tests/test-runner.html 이 함께 쓰는 순수 로직.
// 한 곳만 고치면 모든 곳에 반영되고, 테스트도 이 파일을 그대로 검사합니다.
//
// ⚠️ 파일 최상위에는 function 선언과 var 만 씁니다.
//    팝업이 content script 를 다시 주입할 때(chrome.scripting) 이 파일이 같은 공간에서 한 번 더 실행되는데,
//    최상위 const/let 은 "이미 선언됨" 오류를 내기 때문입니다. 함수 안에서는 const/let 을 써도 됩니다.
//
// 목차
//   0. 상수
//   1. 공통 유틸          debounce, mergeHandles, isHexColor, isValidMode, getHandleFromProfileHref
//   2. 리스트 이름        isSystemListName, isValidListName, cleanListName, isFallbackListName, getManualListNameError
//   3. 리스트 데이터      sanitizeListsObject, resolveListKey, applyListSave, applyListReplace,
//                         applyManualAdd, removeMemberFromLists
//   4. URL · 수집 정책    parseListUrl, getActiveTabText, getScrapeBlockReason, getSyncTabError
//   5. 멤버 추출          isRecoLabel, isExcludedUserCell, extractMembersFromContainer, buildScrapeSignature
//   6. 타임라인 배지      buildHandleMap, diffHandleMaps, isTweetAffected, getBadgeAnchor, applyBadgeStyle, isOwnInjectedNode
//   7. 입력 · 백업        parseHandles, normalizeImportedLists, mergeImportedLists,
//                         normalizeBadgeSettings, buildBackup, parseBackup
//   8. 화면 구조 진단     countProfileLinks, diagnoseStructure, getStructureWarnings

// ==========================================
// 0. 상수
// ==========================================

var AG_DEFAULT_BADGE_SETTINGS = { textColor: '#ffffff', fontSize: 11, fontFamily: 'system' };
var AG_DEFAULT_LIST_COLOR = '#1d9bf0';
var AG_VALID_MODES = ['normal', 'highlight', 'dim'];
var AG_HANDLE_RE = /^@[A-Za-z0-9_]{1,15}$/;
var AG_HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
var AG_PROFILE_HREF_RE = /^\/([A-Za-z0-9_]{1,15})$/;
var AG_HEADING_SELECTOR = 'h1, h2, h3, [role="heading"]';

// 리스트 이름이 될 수 없는 화면·메뉴 단어 (자동 수집에서 이름으로 잡히면 버림)
var AG_SYSTEM_LIST_NAMES = [
  '리스트', '멤버 관리', '구성원 관리', '리스트 멤버', '멤버', '구성원', '추천', '팔로우 추천',
  '목록', '홈', '탐색하기', '알림', '쪽지', '북마크', '설정', '게시하기',
  'Lists', 'Manage members', 'List members', 'Members', 'Suggested', 'Who to follow',
  'Home', 'Explore', 'Notifications', 'Messages', 'Bookmarks', 'Settings',
  'X', 'Twitter', 'Post', '타임라인', 'Timeline',
  'リスト', 'メンバーの管理', 'リストメンバー', 'おすすめ'
];
// 구두점으로 둘러싸인 시스템 단어 (예: "- 리스트 멤버 -")
var AG_SYSTEM_NAME_WITH_PUNCT_RE = /^[\s\-·•:—\/]*(리스트|리스트 멤버|List members|구성원 관리|멤버 관리|Manage members|Members|구성원|멤버|추천|Suggested|Who to follow|팔로우 추천)[\s\-·•:—\/]*$/i;

// 리스트 이름 정제 규칙 (위에서부터 차례로 적용, 결과가 더 바뀌지 않을 때까지 최대 5번 반복)
var AG_LIST_NAME_CLEANUP_RULES = [
  // " / X", " / Twitter" 접미사
  [/\s*\/\s*(X|Twitter)$/i, ''],
  // 브라우저 탭 알림 카운트: "(3) ", "[5] ", "(99+) "
  [/^\s*[\(\[]\d+\+?[\)\]]\s*/g, ''],
  // X 의 화면 읽기용 제목 접두사: "타임라인: 리스트 멤버", "Timeline: List members"
  [/^(타임라인|Timeline)\s*:\s*/i, ''],
  // 시스템 접두사/접미사 — 구분자(- · • : |)가 있을 때만 지워 "Core Members", "우리팀 리스트 멤버"는 보존
  [/^(리스트 멤버|List members|구성원 관리|멤버 관리|Manage members|Members)\s*[\-·•:|]+\s*/i, ''],
  [/\s*[\-·•:|]+\s*(리스트 멤버|List members|구성원 관리|멤버 관리|Manage members|Members)$/i, ''],
  // 괄호 속 태그: "리스트명 (@username)", "리스트명(@username)", "(by me@x)"
  [/\s*\(\s*@[A-Za-z0-9_]+\s*\)/g, ''],
  [/\s*\([^\)]*@[^\)]*\)/g, ''],
  // 구분 기호 뒤 태그: "리스트명 · @username", "리스트명 - @username", "리스트명 | @username"
  [/\s*[·\-\/|•·]\s*@[A-Za-z0-9_]+/g, ''],
  // "by @username"
  [/\s+by\s+@[A-Za-z0-9_]+/gi, ''],
  // 끝에 공백과 함께 붙은 "@username" ("연락처 me@site" 처럼 단어 중간의 @ 는 보존)
  [/\s+@[A-Za-z0-9_]+$/g, ''],
  // 앞에 붙은 "@username /", "@username :", "@username/"
  [/^@[A-Za-z0-9_]+[\s\/:·•'-]+/g, '']
];

// 리스트 화면의 탭 이름
var AG_MEMBER_TAB_NAMES = ['구성원', '멤버', 'Members'];
var AG_SUGGESTED_TAB_NAMES = ['추천', 'Suggested'];

// "/user/lists/..." 형식에서 user 자리에 올 수 없는 경로
var AG_NON_USER_LIST_PATHS = ['i', 'lists', 'home', 'explore', 'notifications', 'messages'];

// 멤버 셀의 링크 중 사용자 프로필이 아닌 경로 (멤버 추출 시 건너뜀)
var AG_MEMBER_LINK_IGNORE = ['home', 'explore', 'notifications', 'messages', 'lists', 'bookmarks', 'settings', 'i'];
// 화면 구조 진단에서 "사용자 링크"로 세지 않는 경로 (메뉴 링크가 많아 위 목록보다 넓음)
var AG_NAV_PATHS = ['home', 'explore', 'notifications', 'messages', 'lists', 'bookmarks', 'settings', 'i',
  'search', 'compose', 'jobs', 'premium', 'communities', 'tos', 'privacy'];

// 추천 영역 제목/aria-label (전체 일치로 비교)
var AG_RECO_LABELS = ['팔로우 추천', 'Who to follow', '추천 사용자', '추천', 'Suggested', 'Connect',
  '팔로우할 만한 계정', '회원님을 위한 추천', 'You might like'];

// 팝업 [가져오기]가 동작하는 탭 주소
var AG_X_URL_RE = /^https?:\/\/([^\/]+\.)?(x|twitter)\.com\//;

// 백업 파일
var AG_BACKUP_APP = 'banmo_tag';
var AG_FONT_FAMILIES = ['system', "'Arial', sans-serif", "'Roboto', sans-serif", "'Noto Sans KR', sans-serif",
  "'Pretendard', sans-serif", 'monospace', "'Georgia', serif"];

// 화면 구조 진단 영역별 팝업 표시 이름
var AG_HEALTH_AREA_LABELS = { members: '멤버 수집', timeline: '타임라인 배지' };

// ==========================================
// 1. 공통 유틸
// ==========================================

// 마지막 호출 후 wait(ms) 동안 다시 호출되지 않으면 한 번 실행
function debounce(func, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), wait);
  };
}

// 핸들 배열 두 개를 대소문자 구분 없이 합치고 중복 제거 (먼저 나온 표기를 유지)
function mergeHandles(existing, incoming) {
  const seen = new Set();
  const out = [];
  const add = (handle) => {
    if (typeof handle !== 'string') return;
    const trimmed = handle.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(trimmed);
  };
  (Array.isArray(existing) ? existing : []).forEach(add);
  (Array.isArray(incoming) ? incoming : []).forEach(add);
  return out;
}

function isHexColor(value) {
  return typeof value === 'string' && AG_HEX_COLOR_RE.test(value);
}

function isValidMode(value) {
  return AG_VALID_MODES.indexOf(value) !== -1;
}

// 프로필 링크 "/handle" 에서 handle(앞의 @ 없이)을 꺼냄. 프로필 링크 모양이 아니면 null
function getHandleFromProfileHref(href) {
  const match = String(href || '').match(AG_PROFILE_HREF_RE);
  return match ? match[1] : null;
}

// ==========================================
// 2. 리스트 이름
// ==========================================

// 화면·메뉴 단어라서 리스트 이름이 될 수 없으면 true
function isSystemListName(name) {
  if (!name) return true;
  const trimmed = String(name).trim();
  if (trimmed.length === 0 || trimmed === 'Unknown List') return true;

  const lower = trimmed.toLowerCase();
  if (AG_SYSTEM_LIST_NAMES.some(word => word.toLowerCase() === lower)) return true;
  return AG_SYSTEM_NAME_WITH_PUNCT_RE.test(trimmed);
}

function isValidListName(text) {
  return !isSystemListName(text);
}

// 페이지 제목·헤딩에서 읽은 문자열을 순수한 리스트 이름으로 정리
// (내 @핸들, 알림 카운트, " / X", "리스트 멤버 - " 같은 부가 정보 제거)
function cleanListName(rawName) {
  if (!rawName) return 'Unknown List';
  let name = String(rawName).trim();

  for (let round = 0; round < 5; round++) {
    const before = name;
    AG_LIST_NAME_CLEANUP_RULES.forEach(([pattern, replacement]) => {
      name = name.replace(pattern, replacement);
    });
    name = name.trim();
    if (name === before) break;
  }

  return name || String(rawName).trim();
}

// 리스트 이름을 못 읽었을 때 쓰는 임시 이름("리스트 (123)")인지
function isFallbackListName(name) {
  return /^리스트 \([^)]+\)$/.test(String(name || ''));
}

// 팝업 "직접 리스트 추가"의 이름 검사. 문제가 없으면 null.
// 자동 수집과 달리 "X", "Home", "리스트" 같은 이름도 허용 (사용자가 직접 정한 이름이므로).
function getManualListNameError(rawName) {
  const name = String(rawName || '').trim();
  if (!name || name === 'Unknown List') return '리스트 이름을 입력해주세요.';
  if (name.length > 50) return '리스트 이름은 50자 이하로 입력해주세요.';
  return null;
}

// ==========================================
// 3. 리스트 데이터 (저장 형식: { [리스트 이름]: { color, mode, members, listId?, manual? } })
// ==========================================

// 저장된 리스트를 정리: 태그 붙은 이름 정제, 같은 리스트 병합, 시스템 단어 리스트 삭제.
// - 정제 후 이름이 같아도 listId 가 다르면 별개 리스트이므로 resolveListKey 규칙(접미사)으로 분리
// - 이미 깨끗한 키를 먼저 처리해, 원래 그 이름을 쓰던 리스트가 이름을 유지하도록 함
// - 사용자가 직접 추가한 리스트(manual: true)는 "X", "Home" 같은 이름도 유지
// 반환: { newLists, modified } (입력은 바꾸지 않음)
function sanitizeListsObject(lists) {
  const src = lists || {};
  const keys = Object.keys(src);
  const cleanKeysFirst = keys.filter(k => cleanListName(k) === k)
    .concat(keys.filter(k => cleanListName(k) !== k));

  const newLists = {};
  let modified = false;

  cleanKeysFirst.forEach((key) => {
    const val = src[key];
    const isManual = !!(val && val.manual === true);
    let cleanKey = cleanListName(key);

    if (!isManual && (isSystemListName(key) || isSystemListName(cleanKey))) {
      modified = true; // 시스템 단어 리스트 삭제
      return;
    }
    if (isManual && (!cleanKey || cleanKey === 'Unknown List')) cleanKey = key;

    const listId = val && val.listId;
    const targetKey = newLists[cleanKey] ? resolveListKey(newLists, cleanKey, listId).key : cleanKey;
    if (targetKey !== key) modified = true;

    const target = newLists[targetKey];
    if (target) {
      target.members = mergeHandles(target.members, val && val.members);
      if (!target.listId && listId) target.listId = listId;
    } else {
      newLists[targetKey] = Object.assign({}, val, { members: mergeHandles([], val && val.members) });
    }
  });

  return { newLists, modified };
}

// 새로 저장할 리스트(listName, listId)를 어느 키에 저장할지 결정.
// - 같은 listId 가 다른 이름으로 저장돼 있으면 그 키를 사용 (중복 생성 방지)
//   · 기존이 임시 이름("리스트 (ID)")이고 새 이름이 실제 이름이면 { key: 새 이름, renameFrom: 기존 키 }
// - 같은 이름인데 다른 listId 를 가진 별개 리스트가 있으면 "이름 (ID 끝 4자리)" 로 구분
function resolveListKey(lists, listName, listId) {
  if (!listId) return { key: listName, renameFrom: null };
  const map = lists || {};

  for (const key of Object.keys(map)) {
    if (!map[key] || map[key].listId !== listId) continue;
    if (key === listName) return { key: listName, renameFrom: null };
    if (isFallbackListName(listName)) return { key, renameFrom: null };
    if (isFallbackListName(key)) return { key: listName, renameFrom: key };
    return { key, renameFrom: null };
  }

  const sameName = map[listName];
  if (sameName && sameName.listId && sameName.listId !== listId) {
    let candidateKey = `${listName} (${String(listId).slice(-4)})`;
    if (map[candidateKey] && map[candidateKey].listId !== listId) {
      candidateKey = `${listName} (${listId})`;
    }
    return { key: candidateKey, renameFrom: null };
  }
  return { key: listName, renameFrom: null };
}

// resolveListKey 가 renameFrom 을 돌려준 경우, 임시 이름 리스트를 새 이름으로 옮김
// (색상·모드는 그대로, 새 이름에 이미 리스트가 있으면 멤버만 합침). 옮겼으면 true
function moveRenamedList(lists, fromKey, toKey) {
  if (!fromKey || !lists[fromKey]) return false;
  const old = lists[fromKey];
  delete lists[fromKey];
  const target = lists[toKey];
  lists[toKey] = target
    ? Object.assign({}, target, { members: mergeHandles(target.members, old.members) })
    : old;
  return true;
}

// 저장·교체에 쓸 리스트 이름과 멤버 검사. 실패하면 { error }, 성공하면 { cleanedName, members }
function prepareIncomingMembers(rawListName, incomingMembers, emptyMessage) {
  const cleanedName = cleanListName(rawListName);
  if (isSystemListName(cleanedName)) {
    return { error: '시스템 단어는 리스트 이름으로 저장할 수 없습니다.' };
  }
  const members = (Array.isArray(incomingMembers) ? incomingMembers : [])
    .filter(m => typeof m === 'string' && AG_HANDLE_RE.test(m));
  if (members.length === 0) return { error: emptyMessage };
  return { cleanedName, members };
}

// 저장할 리스트 키를 정하고(이름 변경 포함) 항목이 없으면 기본값으로 만듦. listId 는 호출한 쪽에서 설정
function prepareListEntry(lists, cleanedName, listId) {
  const resolved = resolveListKey(lists, cleanedName, listId);
  const renamed = moveRenamedList(lists, resolved.renameFrom, resolved.key);
  if (!lists[resolved.key]) {
    lists[resolved.key] = { color: AG_DEFAULT_LIST_COLOR, mode: 'normal', members: [] };
  }
  return { listName: resolved.key, renamed };
}

// 자동 수집 결과 저장: 기존 멤버에 새 멤버를 더함 (background.js 에서 사용)
// 반환: { success, lists, listName, count, added, noChange } 또는 { success: false, message }
function applyListSave(rawLists, rawListName, incomingMembers, listId) {
  const incoming = prepareIncomingMembers(rawListName, incomingMembers, '저장할 멤버가 없습니다.');
  if (incoming.error) return { success: false, message: incoming.error };

  const sanitized = sanitizeListsObject(rawLists || {});
  const lists = sanitized.newLists;
  const { listName, renamed } = prepareListEntry(lists, incoming.cleanedName, listId);

  const idChanged = !!listId && lists[listName].listId !== listId;
  if (listId) lists[listName].listId = listId;

  const existing = lists[listName].members || [];
  const merged = mergeHandles(existing, incoming.members);
  const added = merged.length - existing.length;

  if (added === 0 && !sanitized.modified && !renamed && !idChanged) {
    return { success: true, lists, listName, count: existing.length, added: 0, noChange: true };
  }

  lists[listName].members = merged;
  return { success: true, lists, listName, count: merged.length, added, noChange: false };
}

// 교체 동기화: 리스트 멤버를 "이번에 확인한 멤버"로 바꿈 (X 리스트에서 뺀 멤버 정리용)
// - 확인된 기존 멤버는 기존 표기 유지, 확인되지 않은 멤버는 삭제, 새로 확인된 멤버는 추가
// - 색상/모드/listId 는 유지. 임시 이름("리스트 (ID)")이면 실제 이름으로 승격
// - 입력을 바꾸지 않고 새 lists 를 반환하므로 미리보기에도 그대로 사용 가능
function applyListReplace(rawLists, rawListName, seenMembers, listId) {
  const incoming = prepareIncomingMembers(rawListName, seenMembers,
    '확인한 멤버가 없습니다. 리스트의 멤버 화면을 열어 끝까지 스크롤해주세요.');
  if (incoming.error) return { success: false, message: incoming.error };

  const lists = sanitizeListsObject(JSON.parse(JSON.stringify(rawLists || {}))).newLists;
  const { listName } = prepareListEntry(lists, incoming.cleanedName, listId);
  if (listId) lists[listName].listId = listId;

  const seen = new Set(incoming.members.map(m => m.toLowerCase()));
  const isSeen = handle => seen.has(String(handle).toLowerCase());
  const existing = lists[listName].members || [];
  const kept = existing.filter(isSeen);
  const removed = existing.filter(h => !isSeen(h));
  const merged = mergeHandles(kept, incoming.members);

  lists[listName].members = merged;
  return {
    success: true,
    lists,
    listName,
    previousCount: existing.length,
    count: merged.length,
    added: merged.length - kept.length,
    removed
  };
}

// 팝업 "직접 리스트 추가": 이미 있는 리스트면 멤버만 추가하고 색상/모드는 유지.
// 새로 만든 리스트에는 manual: true 를 붙여, "X"·"Home" 같은 이름도 정리 과정에서 지워지지 않게 함.
function applyManualAdd(lists, listName, handles, color, mode) {
  const existing = lists[listName];
  if (existing) {
    existing.members = mergeHandles(existing.members, handles);
    return { created: false, total: existing.members.length };
  }
  lists[listName] = {
    color: isHexColor(color) ? color : AG_DEFAULT_LIST_COLOR,
    mode: isValidMode(mode) ? mode : 'normal',
    members: mergeHandles([], handles),
    manual: true
  };
  return { created: true, total: lists[listName].members.length };
}

// 리스트에서 멤버 한 명 제거 (대소문자 무시). 실제로 지웠으면 true
function removeMemberFromLists(lists, listName, handleToRemove) {
  const list = lists && lists[listName];
  if (!list || !Array.isArray(list.members)) return false;
  const target = String(handleToRemove || '').trim().toLowerCase();
  if (!target) return false;
  const before = list.members.length;
  list.members = list.members.filter(h => String(h).toLowerCase() !== target);
  return list.members.length !== before;
}

// ==========================================
// 4. URL · 수집 정책
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
// 5. 멤버 추출
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

// ==========================================
// 6. 타임라인 배지
// ==========================================

// 핸들(소문자) → 소속 리스트 정보 배열 (예: '@alice': [{ name: '친구', color, mode }])
function buildHandleMap(listData) {
  const map = {};
  Object.keys(listData || {}).forEach((listName) => {
    const info = listData[listName];
    if (!info || !Array.isArray(info.members)) return;
    info.members.forEach((handle) => {
      const lower = String(handle).toLowerCase();
      if (!map[lower]) map[lower] = [];
      map[lower].push({ name: listName, color: info.color || AG_DEFAULT_LIST_COLOR, mode: info.mode || 'normal' });
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

// 배지를 붙일 위치: 이름 링크(<a>)의 부모, 링크가 없으면(인용 트윗 등) 이름 영역의 첫 요소
function getBadgeAnchor(userInfoDiv) {
  if (!userInfoDiv) return null;
  const link = userInfoDiv.querySelector('a');
  if (link && link.parentNode) return link.parentNode;
  return userInfoDiv.firstElementChild || userInfoDiv;
}

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

// 확장 프로그램이 직접 넣은 배지 노드인지 (MutationObserver 가 자기 변경에 반응하지 않도록)
function isOwnInjectedNode(node) {
  if (!node || node.nodeType !== 1) return false;
  const cls = node.classList;
  return !!cls && (cls.contains('ag-badges-wrapper') || cls.contains('ag-list-badge'));
}

// ==========================================
// 7. 입력 · 백업
// ==========================================

// 쉼표/공백/줄바꿈으로 구분된 입력을 올바른 "@handle" 배열로 (앞의 @ 생략 가능, 중복 제거)
function parseHandles(raw) {
  const seen = new Set();
  const out = [];
  String(raw || '').split(/[\s,]+/).forEach((token) => {
    let handle = token.trim();
    if (!handle) return;
    if (handle.charAt(0) !== '@') handle = '@' + handle;
    if (!AG_HANDLE_RE.test(handle)) return;
    const key = handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(handle);
  });
  return out;
}

// 백업 파일의 리스트 객체 검증·정리. 형식이 잘못되면 null (listId, manual 표시는 보존)
function normalizeImportedLists(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const result = {};
  Object.keys(obj).forEach((key) => {
    const val = obj[key];
    const members = (val && Array.isArray(val.members)) ? val.members : [];
    const entry = {
      color: val && isHexColor(val.color) ? val.color : AG_DEFAULT_LIST_COLOR,
      mode: val && isValidMode(val.mode) ? val.mode : 'normal',
      members: parseHandles(members.filter(m => typeof m === 'string').join(' '))
    };
    if (val && typeof val.listId === 'string' && /^[A-Za-z0-9_-]+$/.test(val.listId)) entry.listId = val.listId;
    if (val && val.manual === true) entry.manual = true;
    result[key] = entry;
  });
  return sanitizeListsObject(result).newLists;
}

// 가져온 리스트를 기존 데이터에 병합 (기존 색상/모드 유지, 멤버만 합침).
// 이름이 같아도 listId 가 다르면 별개 리스트로 분리하고, 같은 listId 는 이름이 달라도 한 리스트로 합침.
function mergeImportedLists(lists, data) {
  Object.keys(data || {}).forEach((name) => {
    const incoming = data[name];
    if (!incoming) return;
    const resolved = resolveListKey(lists, name, incoming.listId);
    moveRenamedList(lists, resolved.renameFrom, resolved.key);

    const current = lists[resolved.key];
    if (!current) {
      lists[resolved.key] = Object.assign({}, incoming, { members: mergeHandles([], incoming.members) });
      return;
    }
    current.members = mergeHandles(current.members, incoming.members);
    if (!current.listId && incoming.listId) current.listId = incoming.listId;
  });
  return lists;
}

// 배지 설정 검증 (잘못된 값은 기본값으로)
function normalizeBadgeSettings(settings) {
  const out = Object.assign({}, AG_DEFAULT_BADGE_SETTINGS);
  if (!settings || typeof settings !== 'object') return out;
  if (isHexColor(settings.textColor)) out.textColor = settings.textColor;
  const size = parseInt(settings.fontSize, 10);
  if (size >= 8 && size <= 20) out.fontSize = size;
  if (AG_FONT_FAMILIES.indexOf(settings.fontFamily) !== -1) out.fontFamily = settings.fontFamily;
  return out;
}

// 내보내기 파일 내용
function buildBackup(lists, badgeSettings) {
  return {
    app: AG_BACKUP_APP,
    backupVersion: 2,
    exportedAt: new Date().toISOString(),
    lists: lists || {},
    badgeSettings: normalizeBadgeSettings(badgeSettings)
  };
}

// 가져오기 파일 해석. 새 형식({ app, lists, badgeSettings })과 구버전 형식(리스트 객체만) 모두 지원.
// 반환: { lists, badgeSettings(없으면 null) }, 형식이 잘못되면 null
function parseBackup(obj) {
  const isNewFormat = obj && typeof obj === 'object' && obj.app === AG_BACKUP_APP &&
    obj.lists && typeof obj.lists === 'object';
  if (isNewFormat) {
    const lists = normalizeImportedLists(obj.lists);
    if (!lists) return null;
    return { lists, badgeSettings: obj.badgeSettings ? normalizeBadgeSettings(obj.badgeSettings) : null };
  }
  const legacy = normalizeImportedLists(obj);
  return legacy ? { lists: legacy, badgeSettings: null } : null;
}

// ==========================================
// 8. 화면 구조 진단 (X 가 화면 구조를 바꿨는지)
// ==========================================

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
  const tweets = doc.querySelectorAll('article[data-testid="tweet"]');
  if (tweets.length === 0) {
    return doc.querySelectorAll('article').length >= 3
      ? suspect('타임라인에서 트윗(article[data-testid="tweet"])을 찾지 못했습니다.')
      : null;
  }
  const hasAuthorName = Array.from(tweets).some(t => t.querySelector('[data-testid="User-Name"]'));
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
