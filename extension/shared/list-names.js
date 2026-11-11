// shared/list-names.js — 리스트 이름 정리 · 검사
// X 화면(제목, 탭 제목)에서 읽은 글자를 순수한 리스트 이름으로 다듬고, 이름이 될 수 없는 화면·메뉴 단어를 걸러냅니다.
// ⚠️ shared/ 파일의 최상위에는 function 선언과 var 만 씁니다 (이유는 shared/base.js 머리말).

// ==========================================
// 규칙 (단어 · 정규식)
// ==========================================

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

// ==========================================
// 함수
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
