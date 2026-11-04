// shared.js
// content.js / popup.js / background.js / test-runner.html 이 공통으로 사용하는 순수 로직 모음.
// - 한 곳에서만 수정하면 모든 컨텍스트에 반영되며, 테스트도 실제 코드를 그대로 검증합니다.
// - 재주입 시 재선언 오류가 나지 않도록 function 선언과 var 만 사용합니다.

var AG_DEFAULT_BADGE_SETTINGS = { textColor: '#ffffff', fontSize: 11, fontFamily: 'system' };
var AG_DEFAULT_LIST_COLOR = '#1d9bf0';
var AG_VALID_MODES = ['normal', 'highlight', 'dim'];
var AG_HANDLE_RE = /^@[A-Za-z0-9_]{1,15}$/;

// 공통 디바운스 유틸리티 (content.js / popup.js 공용)
function debounce(func, wait) {
  var timeout;
  return function () {
    var context = this;
    var args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(function () {
      func.apply(context, args);
    }, wait);
  };
}

// 대소문자 구분 없이 핸들 배열을 병합하고 중복을 제거 (기존 대소문자 표기 우선 보존)
function mergeHandles(existing, incoming) {
  var seen = new Set();
  var out = [];
  var add = function (h) {
    if (typeof h !== 'string') return;
    var trimmed = h.trim();
    if (!trimmed) return;
    var lower = trimmed.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(trimmed);
  };
  (Array.isArray(existing) ? existing : []).forEach(add);
  (Array.isArray(incoming) ? incoming : []).forEach(add);
  return out;
}

// 특정 리스트에서 개별 멤버 핸들 제거 (순수 헬퍼)
function removeMemberFromLists(lists, listName, handleToRemove) {
  if (!lists || !lists[listName] || !Array.isArray(lists[listName].members)) return false;
  var target = String(handleToRemove || '').trim().toLowerCase();
  if (!target) return false;
  var before = lists[listName].members.length;
  lists[listName].members = lists[listName].members.filter(function (h) {
    return String(h).toLowerCase() !== target;
  });
  return lists[listName].members.length !== before;
}

// ==========================================
// 1. 리스트 이름 정제 / 검증
// ==========================================

// 시스템/네비게이션 단어 판별 (절대 리스트 이름이 될 수 없는 키워드)
function isSystemListName(name) {
  if (!name) return true;
  var trimmed = String(name).trim();
  if (trimmed.length === 0 || trimmed === 'Unknown List') return true;

  var systemWords = [
    '리스트', '멤버 관리', '구성원 관리', '리스트 멤버', '멤버', '구성원', '추천', '팔로우 추천',
    '목록', '홈', '탐색하기', '알림', '쪽지', '북마크', '설정', '게시하기',
    'Lists', 'Manage members', 'List members', 'Members', 'Suggested', 'Who to follow',
    'Home', 'Explore', 'Notifications', 'Messages', 'Bookmarks', 'Settings',
    'X', 'Twitter', 'Post',
    'リスト', 'メンバーの管理', 'リストメンバー', 'おすすめ'
  ];
  var lower = trimmed.toLowerCase();
  if (systemWords.some(function (sw) { return sw.toLowerCase() === lower; })) return true;
  if (/^[\s\-·•:—\/]*(리스트|리스트 멤버|List members|구성원 관리|멤버 관리|Manage members|Members|구성원|멤버|추천|Suggested|Who to follow|팔로우 추천)[\s\-·•:—\/]*$/i.test(trimmed)) return true;
  return false;
}

function isValidListName(text) {
  return !isSystemListName(text);
}

// 리스트 이름에서 내 태그/핸들(@username), 알림 카운트, 부가 정보 말끔히 제거
function cleanListName(rawName) {
  if (!rawName) return 'Unknown List';
  var name = String(rawName).trim();

  var prev = '';
  var iterations = 0;
  while (prev !== name && iterations < 5) {
    prev = name;
    iterations++;

    // 1. " / X", " / Twitter" 접미사 제거
    name = name.replace(/\s*\/\s*(X|Twitter)$/i, '');
    // 2. 브라우저 탭 알림 카운트 제거: "(3) ", "[5] ", "(99+) " 등
    name = name.replace(/^\s*[\(\[]\d+\+?[\)\]]\s*/g, '');
    // 3. 시스템 접두사/접미사 정리 — 구분자(- · • : |)가 있을 때만 제거해 "Core Members", "우리팀 리스트 멤버" 같은 실제 이름을 보존
    name = name.replace(/^(리스트 멤버|List members|구성원 관리|멤버 관리|Manage members|Members)\s*[\-·•:|]+\s*/i, '');
    name = name.replace(/\s*[\-·•:|]+\s*(리스트 멤버|List members|구성원 관리|멤버 관리|Manage members|Members)$/i, '');
    // 4. 괄호로 둘러싸인 태그 제거: "리스트명 (@username)", "리스트명(@username)" 등
    name = name.replace(/\s*\(\s*@[A-Za-z0-9_]+\s*\)/g, '');
    name = name.replace(/\s*\([^\)]*@[^\)]*\)/g, '');
    // 5. 구분 기호 뒤에 붙은 태그 제거: "리스트명 · @username", "리스트명 - @username", "리스트명 | @username"
    name = name.replace(/\s*[\u00b7\-\/|•·]\s*@[A-Za-z0-9_]+/g, '');
    // 6. "by @username" 제거
    name = name.replace(/\s+by\s+@[A-Za-z0-9_]+/gi, '');
    // 7. 끝에 공백과 함께 붙은 "@username" 제거 ("연락처 me@site" 처럼 단어 중간의 @ 는 보존)
    name = name.replace(/\s+@[A-Za-z0-9_]+$/g, '');
    // 8. 앞에 붙은 "@username /", "@username :", "@username/" 제거
    name = name.replace(/^@[A-Za-z0-9_]+[\s\/:·•'-]+/g, '');

    name = name.trim();
  }

  return name || String(rawName).trim();
}

// 저장된 리스트 목록 객체의 태그 붙은 이름 정리, 중복 병합, 시스템 단어 리스트 삭제
// - 정제 후 이름이 겹쳐도 listId 가 서로 다르면 별개 리스트이므로 resolveListKey 규칙(접미사)으로 분리
// - 이미 깨끗한 키를 먼저 처리해, 원래 그 이름을 쓰던 리스트가 이름을 유지하도록 함
function sanitizeListsObject(lists) {
  var modified = false;
  var newLists = {};
  var src = lists || {};
  var keys = Object.keys(src);
  var cleanFirst = keys.filter(function (k) { return cleanListName(k) === k; })
    .concat(keys.filter(function (k) { return cleanListName(k) !== k; }));

  cleanFirst.forEach(function (key) {
    var val = src[key];
    // 1. 키 자체 또는 정제된 키가 시스템 단어인 경우(예: '멤버 관리') 제거
    var cleanKey = cleanListName(key);
    if (isSystemListName(key) || isSystemListName(cleanKey)) {
      modified = true;
      return;
    }
    var listId = val && val.listId;
    var targetKey = newLists[cleanKey] ? resolveListKey(newLists, cleanKey, listId).key : cleanKey;
    if (targetKey !== key) modified = true;

    var target = newLists[targetKey];
    if (target) {
      target.members = mergeHandles(target.members, val && val.members);
      if (!target.listId && listId) target.listId = listId;
    } else {
      newLists[targetKey] = Object.assign({}, val, {
        members: mergeHandles([], val && val.members)
      });
    }
  });
  return { newLists: newLists, modified: modified };
}

// ==========================================
// 2. URL / 화면 판별
// ==========================================

// URL 경로 분석: /i/lists/:id[/members|/followers] 또는 /:user/lists/:slug[/...] (전체 URL 또는 pathname 모두 지원)
function parseListUrl(pathnameOrUrl) {
  var path = String(pathnameOrUrl || '').replace(/^https?:\/\/[^\/]+/i, '').split(/[?#]/)[0].replace(/\/+$/, '');

  var iMatch = path.match(/^\/i\/lists\/([^\/]+)(?:\/(members|followers))?/);
  if (iMatch) {
    return { listId: iMatch[1], isMembers: iMatch[2] === 'members', isFollowers: iMatch[2] === 'followers', isMain: !iMatch[2] };
  }

  var userMatch = path.match(/^\/([^\/]+)\/lists\/([^\/]+)(?:\/(members|followers))?/);
  if (userMatch && ['i', 'lists', 'home', 'explore', 'notifications', 'messages'].indexOf(userMatch[1]) === -1) {
    return { listId: userMatch[2], isMembers: userMatch[3] === 'members', isFollowers: userMatch[3] === 'followers', isMain: !userMatch[3] };
  }
  return null;
}

// 활성화된 탭 텍스트 ("구성원" / "추천" 등). 탭이 없으면 null
function getActiveTabText(root) {
  if (!root || !root.querySelector) return null;
  var tab = root.querySelector('[role="tab"][aria-selected="true"]');
  return tab ? tab.textContent.trim() : null;
}

var AG_MEMBER_TAB_NAMES = ['구성원', '멤버', 'Members'];
var AG_SUGGESTED_TAB_NAMES = ['추천', 'Suggested'];

// 수집 정책: 수집하면 안 되는 경우 사유 문자열, 허용이면 null
// - 리스트 URL 이 아니면 차단 (좋아요/재게시 등 무관한 모달 배제)
// - 리스트 팔로워 페이지 차단 (팔로워는 멤버가 아님)
// - "추천" 탭 차단 (멤버가 아닌 추천 계정)
// - 자동 수집은 멤버 화면(또는 멤버 모달)에서, 탭이 있다면 "구성원" 탭일 때만 허용
function getScrapeBlockReason(urlInfo, root, dialog, isManual) {
  if (!urlInfo) return '리스트 페이지가 아닙니다. 리스트의 멤버 화면에서 시도해주세요.';
  if (urlInfo.isFollowers) return '리스트 팔로워는 멤버가 아니므로 수집하지 않습니다.';

  var activeTab = getActiveTabText(root);
  if (activeTab && AG_SUGGESTED_TAB_NAMES.indexOf(activeTab) !== -1) {
    return '"추천" 탭에서는 수집하지 않습니다. "구성원" 탭을 선택해주세요.';
  }

  if (!isManual) {
    if (!urlInfo.isMembers && !dialog) return '자동 수집은 리스트 멤버 화면에서만 동작합니다.';
    if (activeTab && AG_MEMBER_TAB_NAMES.indexOf(activeTab) === -1) return '"구성원" 탭에서만 자동 수집합니다.';
  }
  return null;
}

// ID 폴백 이름 ("리스트 (123)") 여부
function isFallbackListName(name) {
  return /^리스트 \([^)]+\)$/.test(String(name || ''));
}

// 같은 리스트(listId)가 다른 이름으로 이미 저장돼 있으면 그 키를 사용해 중복 생성을 막음.
// - 기존이 폴백 이름이고 새 이름이 실제 이름이면 { key: 새 이름, renameFrom: 기존 키 }
// - 반대로 이름은 같은데 서로 다른 listId 를 가진 별개 리스트라면 접미사를 붙여 충돌을 방지함.
function resolveListKey(lists, listName, listId) {
  if (!listId) return { key: listName, renameFrom: null };
  var map = lists || {};
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!map[k] || map[k].listId !== listId) continue;
    if (k === listName) return { key: listName, renameFrom: null };
    if (isFallbackListName(listName)) return { key: k, renameFrom: null };
    if (isFallbackListName(k)) return { key: listName, renameFrom: k };
    return { key: k, renameFrom: null };
  }
  // 동일 이름이 이미 존재하는데 다른 listId 를 가지고 있다면 서로 다른 리스트이므로 키를 구분
  if (map[listName] && map[listName].listId && map[listName].listId !== listId) {
    var shortSuffix = String(listId).slice(-4);
    var candidateKey = listName + ' (' + shortSuffix + ')';
    if (map[candidateKey] && map[candidateKey].listId !== listId) {
      candidateKey = listName + ' (' + listId + ')';
    }
    return { key: candidateKey, renameFrom: null };
  }
  return { key: listName, renameFrom: null };
}

// 리스트 멤버 저장/병합/승격 순수 로직 (background.js 및 테스트 러너 공용)
function applyListSave(rawLists, rawListName, incomingMembers, listId) {
  var cleanedName = cleanListName(rawListName);
  if (isSystemListName(cleanedName)) {
    return { success: false, message: '시스템 단어는 리스트 이름으로 저장할 수 없습니다.' };
  }

  var members = (Array.isArray(incomingMembers) ? incomingMembers : [])
    .filter(function (m) { return typeof m === 'string' && AG_HANDLE_RE.test(m); });
  if (members.length === 0) {
    return { success: false, message: '저장할 멤버가 없습니다.' };
  }

  var sanitized = sanitizeListsObject(rawLists || {});
  var lists = sanitized.newLists;
  var migrated = sanitized.modified;

  var resolved = resolveListKey(lists, cleanedName, listId);
  var listName = resolved.key;
  var renameFrom = resolved.renameFrom;
  var renamed = false;

  if (renameFrom && lists[renameFrom]) {
    var old = lists[renameFrom];
    delete lists[renameFrom];
    var target = lists[listName];
    lists[listName] = target
      ? Object.assign({}, target, { members: mergeHandles(target.members, old.members) })
      : old;
    renamed = true;
  }

  if (!lists[listName]) {
    lists[listName] = { color: AG_DEFAULT_LIST_COLOR, mode: 'normal', members: [] };
  }
  var idChanged = !!listId && lists[listName].listId !== listId;
  if (listId) lists[listName].listId = listId;

  var existing = lists[listName].members || [];
  var merged = mergeHandles(existing, members);
  var addedCount = merged.length - existing.length;

  if (addedCount === 0 && !migrated && !renamed && !idChanged) {
    return { success: true, lists: lists, listName: listName, count: existing.length, added: 0, noChange: true };
  }

  lists[listName].members = merged;
  return { success: true, lists: lists, listName: listName, count: merged.length, added: addedCount, noChange: false };
}

// ==========================================
// 3. 멤버 추출
// ==========================================

var AG_RECO_LABELS = ['팔로우 추천', 'Who to follow', '추천 사용자', '추천', 'Suggested', 'Connect',
  '팔로우할 만한 계정', '회원님을 위한 추천', 'You might like'];

// 제목/aria-label 이 "추천 영역" 표기인지 판별.
// 부분 문자열이 아니라 전체 일치로 비교해 "추천 작가", "Connected" 같은 실제 리스트 이름은 오탐하지 않음.
// "타임라인: 팔로우 추천" 처럼 콜론 앞 접두사가 붙은 경우 마지막 부분만 비교.
function isRecoLabel(text) {
  var t = String(text || '').trim();
  if (!t) return false;
  var last = t.split(':').pop().trim().toLowerCase();
  return AG_RECO_LABELS.some(function (kw) { return kw.toLowerCase() === last; });
}

// 가상 스크롤 목록에서 셀보다 앞에 있는 가장 가까운 섹션 제목 텍스트 (없으면 null)
// - 목록 전체가 아니라 "이 셀이 속한 구간"의 제목만 보므로, 아래쪽 추천 블록이 위쪽 멤버를 지우지 않음
function getPrecedingSectionHeading(cell) {
  var inner = cell.closest('div[data-testid="cellInnerDiv"]');
  if (!inner) return null;
  for (var sib = inner.previousElementSibling; sib; sib = sib.previousElementSibling) {
    var h = sib.matches('h1, h2, h3, [role="heading"]') ? sib : sib.querySelector('h1, h2, h3, [role="heading"]');
    if (h) return h.textContent.trim();
  }
  return null;
}

// 팔로우 추천 및 모달 창 뒤쪽 배경의 유저 셀 판별
function isExcludedUserCell(cell, dialog) {
  // 1. 멤버 모달이 열려있으면 모달 외부(배경/사이드바)의 셀은 무조건 제외
  if (dialog && !dialog.contains(cell)) return true;

  // 2. 우측 사이드바 컬럼 내부 셀 제외
  if (cell.closest('[data-testid="sidebarColumn"]') || cell.closest('aside')) return true;

  // 3. 추천 영역 표기(aria-label)를 가진 부모 컨테이너 제외 (전체 일치)
  for (var el = cell.parentElement; el; el = el.parentElement) {
    if (el.hasAttribute && el.hasAttribute('aria-label') && isRecoLabel(el.getAttribute('aria-label'))) return true;
    if (dialog && el === dialog) break;
  }

  // 4. 모달 내부에서도 "추천(Suggested)" 탭이 활성화된 경우 제외
  if (dialog) {
    var activeTab = dialog.querySelector('[role="tab"][aria-selected="true"]');
    if (activeTab && AG_SUGGESTED_TAB_NAMES.indexOf(activeTab.textContent.trim()) !== -1) return true;
  }

  // 5. 셀 바로 앞 구간 제목이 "팔로우 추천" 등이면 제외
  if (isRecoLabel(getPrecedingSectionHeading(cell))) return true;

  // 6. 가상 스크롤 셀이 아닌 구조: 셀을 감싼 section 안에서 셀보다 앞에 있는 마지막 제목이 추천 영역이면 제외
  if (!cell.closest('div[data-testid="cellInnerDiv"]')) {
    var section = cell.closest('section');
    if (section && (!dialog || dialog.contains(section))) {
      var hs = section.querySelectorAll('h1, h2, h3, [role="heading"]');
      var lastBefore = null;
      for (var i = 0; i < hs.length; i++) {
        // DOCUMENT_POSITION_FOLLOWING(4): cell 이 제목보다 뒤에 있음
        if (hs[i].compareDocumentPosition(cell) & 4) lastBefore = hs[i];
      }
      if (lastBefore && isRecoLabel(lastBefore.textContent)) return true;
    }
  }
  return false;
}

// 컨테이너 내부 UserCell 에서 순수 멤버 핸들 추출 (팔로우 추천 차단)
function extractMembersFromContainer(container, dialog) {
  if (!container) return [];
  var members = new Set();
  var ignoreList = ['home', 'explore', 'notifications', 'messages', 'lists', 'bookmarks', 'settings', 'i'];

  container.querySelectorAll('[data-testid="UserCell"]').forEach(function (cell) {
    if (isExcludedUserCell(cell, dialog || null)) return;

    // 1-1. href 분석
    var links = cell.querySelectorAll('a[role="link"], a[href^="/"]');
    for (var i = 0; i < links.length; i++) {
      var match = (links[i].getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (match && ignoreList.indexOf(match[1].toLowerCase()) === -1) {
        members.add('@' + match[1]);
        return;
      }
    }
    // 1-2. 텍스트 @ 분석
    var els = cell.querySelectorAll('span, div');
    for (var j = 0; j < els.length; j++) {
      var m = els[j].textContent.trim().match(/^@([A-Za-z0-9_]{1,15})$/);
      if (m) {
        members.add('@' + m[1]);
        return;
      }
    }
  });
  return Array.from(members);
}

// 같은 리스트/멤버 조합을 반복 전송하지 않도록 순서 무관한 서명 생성
function buildScrapeSignature(listName, members) {
  var sorted = (members || []).map(function (m) { return String(m).toLowerCase(); }).sort();
  return listName + '|' + sorted.join(',');
}

// ==========================================
// 4. 타임라인 배지
// ==========================================

// 빠른 검색을 위한 핸들(소문자) → 리스트 정보 배열 매핑
function buildHandleMap(listData) {
  var map = {};
  Object.keys(listData || {}).forEach(function (listName) {
    var info = listData[listName];
    if (!info || !Array.isArray(info.members)) return;
    info.members.forEach(function (handle) {
      var lower = String(handle).toLowerCase();
      if (!map[lower]) map[lower] = [];
      map[lower].push({ name: listName, color: info.color || AG_DEFAULT_LIST_COLOR, mode: info.mode || 'normal' });
    });
  });
  return map;
}

// 배지에 사용자 스타일 적용 (CSS 변수 및 인라인 !important 동시 지원).
function applyBadgeStyle(badge, bgColor, settings, isMainAuthor) {
  var s = Object.assign({}, AG_DEFAULT_BADGE_SETTINGS, settings || {});
  var size = isMainAuthor ? s.fontSize : Math.max(8, s.fontSize - 2);
  var finalBg = bgColor || AG_DEFAULT_LIST_COLOR;
  badge.style.setProperty('--ag-badge-bg', finalBg);
  badge.style.setProperty('--ag-badge-fg', s.textColor);
  badge.style.setProperty('--ag-badge-fs', size + 'px');
  badge.style.setProperty('background-color', finalBg, 'important');
  badge.style.setProperty('color', s.textColor, 'important');
  badge.style.setProperty('font-size', size + 'px', 'important');
  if (s.fontFamily && s.fontFamily !== 'system') {
    badge.style.setProperty('--ag-badge-ff', s.fontFamily);
    badge.style.setProperty('font-family', s.fontFamily, 'important');
  } else {
    badge.style.removeProperty('--ag-badge-ff');
    badge.style.removeProperty('font-family');
  }
}

// MutationObserver 가 확장 프로그램 자신이 삽입한 노드(배지)에 반응하지 않도록 판별
function isOwnInjectedNode(node) {
  if (!node || node.nodeType !== 1) return false;
  var cls = node.classList;
  return !!cls && (cls.contains('ag-badges-wrapper') || cls.contains('ag-list-badge'));
}

// ==========================================
// 5. 팝업 입력 처리
// ==========================================

// 쉼표/공백/줄바꿈으로 구분된 핸들 입력을 유효한 @handle 배열로 변환 (중복 제거)
function parseHandles(raw) {
  var seen = new Set();
  var out = [];
  String(raw || '').split(/[\s,]+/).forEach(function (h) {
    h = h.trim();
    if (!h) return;
    if (h.charAt(0) !== '@') h = '@' + h;
    if (!AG_HANDLE_RE.test(h)) return;
    var key = h.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(h);
  });
  return out;
}

// 가져오기(Import) JSON 검증 및 정규화. 형식이 잘못되면 null 반환 (listId 보존).
function normalizeImportedLists(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  var result = {};
  Object.keys(obj).forEach(function (key) {
    var val = obj[key];
    var members = (val && Array.isArray(val.members)) ? val.members : [];
    var entry = {
      color: (val && typeof val.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.color)) ? val.color : AG_DEFAULT_LIST_COLOR,
      mode: (val && AG_VALID_MODES.indexOf(val.mode) !== -1) ? val.mode : 'normal',
      members: parseHandles(members.filter(function (m) { return typeof m === 'string'; }).join(' '))
    };
    if (val && typeof val.listId === 'string' && /^[A-Za-z0-9_-]+$/.test(val.listId)) {
      entry.listId = val.listId;
    }
    result[key] = entry;
  });
  return sanitizeListsObject(result).newLists;
}

// 가져온 리스트를 기존 데이터에 병합 (기존 색상/모드 유지, 멤버만 합침).
// 이름이 같아도 listId 가 다르면 별개 리스트로 분리하고, 같은 listId 는 이름이 달라도 한 리스트로 합침.
function mergeImportedLists(lists, data) {
  Object.keys(data || {}).forEach(function (name) {
    var incoming = data[name];
    if (!incoming) return;
    var resolved = resolveListKey(lists, name, incoming.listId);
    var key = resolved.key;
    if (resolved.renameFrom && lists[resolved.renameFrom]) {
      var old = lists[resolved.renameFrom];
      delete lists[resolved.renameFrom];
      lists[key] = lists[key]
        ? Object.assign({}, lists[key], { members: mergeHandles(lists[key].members, old.members) })
        : old;
    }
    var cur = lists[key];
    if (!cur) {
      lists[key] = Object.assign({}, incoming, { members: mergeHandles([], incoming.members) });
      return;
    }
    cur.members = mergeHandles(cur.members, incoming.members);
    if (!cur.listId && incoming.listId) cur.listId = incoming.listId;
  });
  return lists;
}

// 팝업 "직접 리스트 추가" 처리. 이미 있는 리스트면 멤버만 추가하고 사용자가 정해둔 색상/모드는 유지.
function applyManualAdd(lists, listName, handles, color, mode) {
  var existing = lists[listName];
  if (existing) {
    existing.members = mergeHandles(existing.members, handles);
    return { created: false, total: existing.members.length };
  }
  lists[listName] = {
    color: (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : AG_DEFAULT_LIST_COLOR,
    mode: AG_VALID_MODES.indexOf(mode) !== -1 ? mode : 'normal',
    members: mergeHandles([], handles)
  };
  return { created: true, total: lists[listName].members.length };
}

// 팝업 [⚡ 가져오기] 대상 탭 검사. 문제가 없으면 null.
// tabs 권한이 없으므로 host_permissions 밖(X 가 아닌) 탭은 url 이 비어서 들어옴 → "X 페이지가 아님"으로 안내.
var AG_X_URL_RE = /^https?:\/\/([^\/]+\.)?(x|twitter)\.com\//;
function getSyncTabError(tab) {
  if (!tab || tab.id === undefined || tab.id === null) return '활성화된 탭을 찾을 수 없습니다.';
  if (!tab.url || !AG_X_URL_RE.test(tab.url)) return '현재 탭이 X(Twitter) 페이지가 아닙니다.';
  return null;
}

// 배지 래퍼를 붙일 위치. 이름 링크(<a>)가 있으면 그 부모, 없으면(인용 트윗 등) 이름 영역 자체.
function getBadgeAnchor(userInfoDiv) {
  if (!userInfoDiv) return null;
  var link = userInfoDiv.querySelector('a');
  if (link && link.parentNode) return link.parentNode;
  return userInfoDiv.firstElementChild || userInfoDiv;
}

// ==========================================
// 6. 백업 파일 (리스트 + 배지 설정)
// ==========================================

var AG_BACKUP_APP = 'banmo_tag';
var AG_FONT_FAMILIES = ['system', "'Arial', sans-serif", "'Roboto', sans-serif", "'Noto Sans KR', sans-serif",
  "'Pretendard', sans-serif", 'monospace', "'Georgia', serif"];

// 배지 설정 검증 (잘못된 값은 기본값으로)
function normalizeBadgeSettings(s) {
  var out = Object.assign({}, AG_DEFAULT_BADGE_SETTINGS);
  if (!s || typeof s !== 'object') return out;
  if (typeof s.textColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.textColor)) out.textColor = s.textColor;
  var size = parseInt(s.fontSize, 10);
  if (size >= 8 && size <= 20) out.fontSize = size;
  if (AG_FONT_FAMILIES.indexOf(s.fontFamily) !== -1) out.fontFamily = s.fontFamily;
  return out;
}

// 내보내기 파일 내용 생성
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
// 잘못된 형식이면 null, 아니면 { lists, badgeSettings(없으면 null) }
function parseBackup(obj) {
  if (obj && typeof obj === 'object' && obj.app === AG_BACKUP_APP && obj.lists && typeof obj.lists === 'object') {
    var lists = normalizeImportedLists(obj.lists);
    if (!lists) return null;
    return { lists: lists, badgeSettings: obj.badgeSettings ? normalizeBadgeSettings(obj.badgeSettings) : null };
  }
  var legacy = normalizeImportedLists(obj);
  return legacy ? { lists: legacy, badgeSettings: null } : null;
}
