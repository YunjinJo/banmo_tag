// shared/list-data.js — 저장된 리스트 데이터 다루기 (정리 · 저장 · 교체 · 직접 추가 · 멤버 삭제)
//
// 저장 형식 (chrome.storage.local 의 lists):
//   { [리스트 이름]: { color, mode, members, listId?, manual?, customName?, style? } }
//   - color: 배지 배경색, mode: normal | highlight | dim, members: ["@handle", …]
//   - listId: X 리스트 ID (자동 수집한 리스트), manual: 팝업에서 직접 만든 리스트면 true
//   - customName: 팝업에서 이름을 직접 바꾼 리스트면 true (X 에서 리스트 이름이 바뀌어도 이 이름을 유지)
//   - manualMembers: X 리스트(listId 있음)에 팝업에서 직접 추가한 멤버 ["@handle", …].
//     X 리스트에는 없는 멤버이므로, 뺀 멤버를 정리할 때(자동·[뺀 멤버 정리]) 지우지 않음
//   - style: 이 리스트만의 배지 글자 스타일 { textColor?, fontSize?, fontFamily? } (없는 항목은 공통 설정 사용)
// ⚠️ shared/ 파일의 최상위에는 function 선언과 var 만 씁니다 (이유는 shared/base.js 머리말).

// ==========================================
// 정리 · 저장할 이름 정하기
// ==========================================

// 저장된 리스트를 정리: 태그 붙은 이름 정제, 같은 리스트 병합, 시스템 단어 리스트 삭제.
// - 정제 후 이름이 같아도 listId 가 다르면 별개 리스트이므로 resolveListKey 규칙(접미사)으로 분리
// - 이미 깨끗한 키를 먼저 처리해, 원래 그 이름을 쓰던 리스트가 이름을 유지하도록 함
// - 사용자가 직접 추가했거나(manual: true) 이름을 직접 바꾼(customName: true) 리스트는 "X", "Home" 같은 이름도 유지
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
    // 사용자가 직접 정한 이름인지 (직접 추가한 리스트, 또는 팝업에서 이름을 바꾼 리스트)
    const userNamed = !!(val && (val.manual === true || val.customName === true));
    let cleanKey = cleanListName(key);

    if (!userNamed && (isSystemListName(key) || isSystemListName(cleanKey))) {
      modified = true; // 시스템 단어 리스트 삭제
      return;
    }
    if (userNamed && (!cleanKey || cleanKey === 'Unknown List')) cleanKey = key;

    const listId = val && val.listId;
    const targetKey = newLists[cleanKey] ? resolveListKey(newLists, cleanKey, listId).key : cleanKey;
    if (targetKey !== key) modified = true;

    const target = newLists[targetKey];
    if (target) {
      target.members = mergeHandles(target.members, val && val.members);
      mergeManualMembers(target, val);
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
//   · followRename 이 true 면 X 에서 리스트 이름이 바뀐 것으로 보고 새 이름으로 옮김 { key: 새 이름, renameFrom: 기존 키 }.
//     단, 팝업에서 직접 지은 이름(customName)이거나 새 이름을 다른 리스트가 쓰고 있으면 기존 키를 유지.
//     (멤버 수집에서만 true. 백업 가져오기·저장 데이터 정리는 지금 이름을 유지해야 하므로 넘기지 않음)
// - 같은 이름인데 다른 listId 를 가진 별개 리스트가 있으면 "이름 (ID 끝 4자리)" 로 구분
function resolveListKey(lists, listName, listId, followRename) {
  if (!listId) return { key: listName, renameFrom: null };
  const map = lists || {};

  for (const key of Object.keys(map)) {
    if (!map[key] || map[key].listId !== listId) continue;
    if (key === listName) return { key: listName, renameFrom: null };
    if (isFallbackListName(listName)) return { key, renameFrom: null };
    if (isFallbackListName(key)) return { key: listName, renameFrom: key };
    if (followRename && map[key].customName !== true && !map[listName]) return { key: listName, renameFrom: key };
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
  if (target) {
    lists[toKey] = Object.assign({}, target, { members: mergeHandles(target.members, old.members) });
    mergeManualMembers(lists[toKey], old);
  } else {
    lists[toKey] = old;
  }
  return true;
}

// 두 리스트를 합칠 때 "직접 추가한 멤버" 표시도 합침 (target 을 바꿈)
function mergeManualMembers(target, source) {
  if (!source || !Array.isArray(source.manualMembers) || source.manualMembers.length === 0) return;
  target.manualMembers = mergeHandles(target.manualMembers, source.manualMembers);
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
// followRename: X 에서 바뀐 리스트 이름을 따라갈지 (resolveListKey 참고)
function prepareListEntry(lists, cleanedName, listId, followRename) {
  const resolved = resolveListKey(lists, cleanedName, listId, followRename);
  const renamed = moveRenamedList(lists, resolved.renameFrom, resolved.key);
  if (!lists[resolved.key]) {
    lists[resolved.key] = { color: AG_DEFAULT_LIST_COLOR, mode: 'normal', members: [] };
  }
  return { listName: resolved.key, renamed };
}

// ==========================================
// 저장 · 교체 · 직접 추가 · 멤버 삭제
// ==========================================

// 자동 수집 결과 저장: 기존 멤버에 새 멤버를 더함 (background.js 에서 사용)
// options.followRename: 같은 listId 가 다른 이름으로 저장돼 있으면 이번 이름으로 바꿈 (X 에서 리스트 이름이 바뀐 경우.
//   이름을 믿을 만한 곳에서 읽었을 때만 넘김. 색·표시 방식·글자 스타일·멤버는 그대로)
// 반환: { success, lists, listName, count, added, noChange } 또는 { success: false, message }
function applyListSave(rawLists, rawListName, incomingMembers, listId, options) {
  const incoming = prepareIncomingMembers(rawListName, incomingMembers, '저장할 멤버가 없습니다.');
  if (incoming.error) return { success: false, message: incoming.error };

  const followRename = !!(options && options.followRename);
  const sanitized = sanitizeListsObject(rawLists || {});
  const lists = sanitized.newLists;
  const { listName, renamed } = prepareListEntry(lists, incoming.cleanedName, listId, followRename);

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
// - 팝업에서 직접 추가한 멤버(manualMembers)는 X 리스트에 없는 것이 당연하므로 지우지 않음.
//   이번에 X 리스트에서 확인된 멤버는 직접 추가 표시를 뗌 (이제 X 리스트의 멤버)
// - 색상/모드/listId 는 유지. 임시 이름("리스트 (ID)")이면 실제 이름으로 승격
// - 입력을 바꾸지 않고 새 lists 를 반환하므로 미리보기에도 그대로 사용 가능
// - options.followRename: applyListSave 와 같음
function applyListReplace(rawLists, rawListName, seenMembers, listId, options) {
  const incoming = prepareIncomingMembers(rawListName, seenMembers,
    '확인한 멤버가 없습니다. 리스트의 멤버 화면을 열어 끝까지 스크롤해주세요.');
  if (incoming.error) return { success: false, message: incoming.error };

  const lists = sanitizeListsObject(JSON.parse(JSON.stringify(rawLists || {}))).newLists;
  const { listName } = prepareListEntry(lists, incoming.cleanedName, listId, !!(options && options.followRename));
  const entry = lists[listName];
  if (listId) entry.listId = listId;

  const lower = handle => String(handle).toLowerCase();
  const seen = new Set(incoming.members.map(lower));
  const manualMembers = (Array.isArray(entry.manualMembers) ? entry.manualMembers : []).filter(h => !seen.has(lower(h)));
  const manual = new Set(manualMembers.map(lower));
  const isKept = handle => seen.has(lower(handle)) || manual.has(lower(handle));
  const existing = entry.members || [];
  const kept = existing.filter(isKept);
  const removed = existing.filter(h => !isKept(h));
  const merged = mergeHandles(kept, incoming.members);

  entry.members = merged;
  if (manualMembers.length > 0) entry.manualMembers = manualMembers;
  else delete entry.manualMembers;
  return {
    success: true,
    lists,
    listName,
    previousCount: existing.length,
    count: merged.length,
    added: merged.length - kept.length,
    removed,
    manualList: entry.manual === true
  };
}

// 멤버 화면을 끝까지 확인했을 때, 확인 없이 자동으로 뺀 멤버를 지워도 되는지 (plan: applyListReplace 결과)
// - 지울 멤버가 없으면 할 일이 없음
// - 팝업에서 직접 만든 리스트(manual)는 이름이 같은 X 리스트와 합쳐진 것일 수 있어 자동으로는 지우지 않음
// - 저장된 멤버의 절반 넘게 지워지면 화면을 잘못 읽었을 수 있어 자동으로는 지우지 않음
//   (이런 경우는 팝업 [뺀 멤버 정리]에서 지울 멤버를 확인한 뒤 진행)
function canAutoRemoveMembers(plan) {
  if (!plan || !plan.success || plan.manualList || !Array.isArray(plan.removed)) return false;
  return plan.removed.length > 0 && plan.removed.length * 2 <= plan.previousCount;
}

// 팝업 "직접 리스트 추가": 이미 있는 리스트면 멤버만 추가하고 색상/모드는 유지.
// 새로 만든 리스트에는 manual: true 를 붙여, "X"·"Home" 같은 이름도 정리 과정에서 지워지지 않게 함.
// X 리스트(listId 있음)에 새로 더한 멤버는 manualMembers 에 적어, 뺀 멤버를 정리할 때 지워지지 않게 함.
function applyManualAdd(lists, listName, handles, color, mode) {
  const existing = lists[listName];
  if (existing) {
    const before = new Set((existing.members || []).map(h => String(h).toLowerCase()));
    existing.members = mergeHandles(existing.members, handles);
    if (existing.listId) {
      const fresh = existing.members.filter(h => !before.has(h.toLowerCase()));
      if (fresh.length > 0) existing.manualMembers = mergeHandles(existing.manualMembers, fresh);
    }
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

// 팝업에서 리스트 이름 바꾸기: 색·표시 방식·글자 스타일·멤버·listId 는 그대로 새 이름으로 옮김.
// customName: true 를 붙여, 이후 X 에서 읽은 이름으로 덮어쓰지 않고 "X"·"Home" 같은 이름도 정리 과정에서 지워지지 않게 함.
// 반환: { success: true, name } 또는 { success: false, message } (실패하면 lists 를 바꾸지 않음)
function renameList(lists, fromName, rawNewName) {
  const entry = lists && lists[fromName];
  if (!entry) return { success: false, message: '리스트를 찾을 수 없습니다.' };

  const trimmed = String(rawNewName || '').trim();
  const name = trimmed ? cleanListName(trimmed) : '';
  const nameError = getManualListNameError(name);
  if (nameError) return { success: false, message: nameError };
  if (name === fromName) return { success: false, message: '지금 이름과 같습니다.' };
  if (lists[name]) return { success: false, message: `'${name}' 리스트가 이미 있습니다. 다른 이름을 입력해주세요.` };

  delete lists[fromName];
  lists[name] = entry;
  entry.customName = true;
  return { success: true, name };
}

// 리스트에서 멤버 한 명 제거 (대소문자 무시). 실제로 지웠으면 true
function removeMemberFromLists(lists, listName, handleToRemove) {
  const list = lists && lists[listName];
  if (!list || !Array.isArray(list.members)) return false;
  const target = String(handleToRemove || '').trim().toLowerCase();
  if (!target) return false;
  const before = list.members.length;
  list.members = list.members.filter(h => String(h).toLowerCase() !== target);
  if (Array.isArray(list.manualMembers)) {
    list.manualMembers = list.manualMembers.filter(h => String(h).toLowerCase() !== target);
    if (list.manualMembers.length === 0) delete list.manualMembers;
  }
  return list.members.length !== before;
}
