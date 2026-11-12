// background.js — 백그라운드 (크롬: 서비스 워커, 파이어폭스: 이벤트 페이지)
//   content script 가 보낸 멤버 저장·교체 요청을 순서대로 처리하고, 설치/업데이트 때 저장 데이터를 정리합니다.
// 공통 로직(applyListSave, applyListReplace, sanitizeListsObject 등)은 shared/ 에 있습니다.
// - 크롬: manifest 의 background.service_worker 로 이 파일만 실행되므로 importScripts 로 shared/ 파일을 불러옴
// - 파이어폭스: background.scripts(manifest.firefox.json)로 shared/ 파일이 먼저 실행되고, 이벤트 페이지에는 importScripts 가 없음
// 아래 목록은 manifest.json 의 content_scripts 와 같은 순서로 둡니다 (`node scripts/validate.js` 가 확인).
if (typeof importScripts === 'function') {
  importScripts(
    'shared/base.js',
    'shared/list-names.js',
    'shared/list-data.js',
    'shared/list-page.js',
    'shared/badges.js',
    'shared/backup.js',
    'shared/health.js',
    'shared/ui.js'
  );
}

// ==========================================
// 저장 작업 큐
// ==========================================

// 여러 탭에서 동시에 읽기 → 쓰기가 겹치면 나중 쓰기가 앞선 변경을 덮어쓰므로 하나씩 순서대로 처리
let saveQueue = Promise.resolve();

function enqueue(task) {
  const run = saveQueue.then(task, task);
  saveQueue = run.catch(() => {});
  return run;
}

// 새 멤버가 저장되거나 뺀 멤버가 자동으로 정리되면 확장 프로그램 아이콘에 3초간 ✔ 표시 (팝업을 열어도 지워짐)
// 3초 타이머는 크롬 서비스 워커가 그 전에 종료되면 실행되지 않으므로, chrome.alarms 로 한 번 더 지움.
// 알람은 크롬에서 30초보다 짧게 정할 수 없어 30초 뒤 예비로만 씁니다.
const CLEAR_SAVED_BADGE_ALARM = 'banmo_tag-clear-saved-badge';
const SAVED_BADGE_MS = 3000;

function clearSavedBadge() {
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
}

function showSavedBadge() {
  try {
    chrome.action.setBadgeText({ text: '✔' });
    chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
    setTimeout(clearSavedBadge, SAVED_BADGE_MS);
    chrome.alarms?.create(CLEAR_SAVED_BADGE_ALARM, { delayInMinutes: 0.5 });
  } catch (e) {
    console.warn('Badge API error:', e);
  }
}

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === CLEAR_SAVED_BADGE_ALARM) clearSavedBadge();
});

// ==========================================
// 저장 · 교체
// ==========================================

// 자동 수집/[가져오기]: 기존 멤버에 새 멤버를 더함
// followRename: 이름을 믿을 만한 곳에서 읽었으면 true → X 에서 바뀐 리스트 이름을 따라감 (shared/list-data.js resolveListKey)
async function saveListMembers(rawListName, incomingMembers, listId, followRename) {
  const result = await chrome.storage.local.get(['lists']);
  const outcome = applyListSave(result.lists || {}, rawListName, incomingMembers, listId, { followRename });
  if (!outcome.success) {
    return { success: false, message: outcome.message };
  }
  if (outcome.noChange) {
    return { success: true, listName: outcome.listName, count: outcome.count, added: 0, noChange: true };
  }

  await chrome.storage.local.set({ lists: outcome.lists });
  if (outcome.added > 0) showSavedBadge();
  return { success: true, listName: outcome.listName, count: outcome.count, added: outcome.added };
}

// 뺀 멤버 정리: 이번에 확인한 멤버로 목록을 바꿈 (X 리스트에서 뺀 멤버 삭제)
// auto: 사용자가 확인하지 않은 자동 정리 (content.js 가 멤버 목록을 끝까지 본 것을 확인했을 때).
//       저장된 데이터 기준으로 지워도 되는지 한 번 더 확인하고(canAutoRemoveMembers), 안 되면 저장하지 않음
async function replaceListMembers(rawListName, seenMembers, listId, followRename, auto) {
  const result = await chrome.storage.local.get(['lists']);
  const outcome = applyListReplace(result.lists || {}, rawListName, seenMembers, listId, { followRename });
  if (!outcome.success) {
    return { success: false, message: outcome.message };
  }
  if (auto && !canAutoRemoveMembers(outcome)) {
    return { success: true, skipped: true, listName: outcome.listName, count: outcome.previousCount, added: 0, removedCount: 0 };
  }
  await chrome.storage.local.set({ lists: outcome.lists });
  if (auto) showSavedBadge();
  return {
    success: true,
    listName: outcome.listName,
    count: outcome.count,
    added: outcome.added,
    removedCount: outcome.removed.length
  };
}

// ==========================================
// 이벤트
// ==========================================

// 설치·업데이트 때 기존 데이터에 태그 붙은 이름이나 시스템 단어 리스트가 섞여 있으면 정리
chrome.runtime.onInstalled.addListener(() => {
  console.log('banmo_tag 확장 프로그램이 설치/업데이트되었습니다.');
  enqueue(async () => {
    const result = await chrome.storage.local.get(['lists']);
    if (!result.lists) return;
    const { newLists, modified } = sanitizeListsObject(result.lists);
    if (modified) await chrome.storage.local.set({ lists: newLists });
  }).catch(err => console.error('Storage migration failed:', err));
});

// content script 요청: action → 처리 함수 (data: { listName, members, listId, nameReliable, auto? })
const messageHandlers = {
  saveListMembers: data => saveListMembers(data.listName, data.members, data.listId, data.nameReliable === true),
  replaceListMembers: data => replaceListMembers(data.listName, data.members, data.listId, data.nameReliable === true, data.auto === true)
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request.data) return false;
  if (!Object.prototype.hasOwnProperty.call(messageHandlers, request.action)) return false;

  enqueue(() => messageHandlers[request.action](request.data))
    .then(sendResponse)
    .catch((err) => {
      console.error('Storage save failed:', err);
      sendResponse({ success: false, error: String(err && err.message || err) });
    });

  return true; // 비동기 응답을 위해 채널 유지
});
