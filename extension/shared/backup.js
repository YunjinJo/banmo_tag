// shared/backup.js — 백업 파일 만들기 · 읽기 · 기존 데이터에 합치기
// ⚠️ shared/ 파일의 최상위에는 function 선언과 var 만 씁니다 (이유는 shared/base.js 머리말).

// 백업 파일
var AG_BACKUP_APP = 'banmo_tag';

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

// 백업 파일의 리스트 객체 검증·정리. 형식이 잘못되면 null (listId, manual·customName 표시, 직접 추가한 멤버 표시는 보존)
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
    if (val && val.customName === true) entry.customName = true;
    if (val && Array.isArray(val.manualMembers)) {
      // 직접 추가한 멤버 표시는 실제 멤버에 있는 핸들만
      const memberSet = new Set(entry.members.map(m => m.toLowerCase()));
      const manualMembers = parseHandles(val.manualMembers.filter(m => typeof m === 'string').join(' '))
        .filter(m => memberSet.has(m.toLowerCase()));
      if (manualMembers.length > 0) entry.manualMembers = manualMembers;
    }
    const style = normalizeListStyle(val && val.style);
    if (style) entry.style = style;
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
    mergeManualMembers(current, incoming);
    if (!current.listId && incoming.listId) current.listId = incoming.listId;
  });
  return lists;
}
