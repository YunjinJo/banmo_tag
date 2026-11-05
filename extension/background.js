// background.js — 백그라운드 (크롬: 서비스 워커, 파이어폭스: 이벤트 페이지)
//   content script 가 보낸 멤버 저장·교체 요청을 순서대로 처리하고, 설치/업데이트 때 저장 데이터를 정리합니다.
// 공통 로직(applyListSave, applyListReplace, sanitizeListsObject 등)은 shared.js 에 있습니다.
// - 크롬: manifest 의 background.service_worker 로 이 파일만 실행되므로 importScripts 로 shared.js 를 불러옴
// - 파이어폭스: background.scripts 로 shared.js 가 먼저 실행되고, 이벤트 페이지에는 importScripts 가 없음
if (typeof importScripts === 'function') importScripts('shared.js');

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

// 새 멤버가 저장되면 확장 프로그램 아이콘에 3초간 ✔ 표시
function showSavedBadge() {
  try {
    chrome.action.setBadgeText({ text: '✔' });
    chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: '' }).catch(() => {});
    }, 3000);
  } catch (e) {
    console.warn('Badge API error:', e);
  }
}

// ==========================================
// 저장 · 교체
// ==========================================

// 자동 수집/[가져오기]: 기존 멤버에 새 멤버를 더함
async function saveListMembers(rawListName, incomingMembers, listId) {
  const result = await chrome.storage.local.get(['lists']);
  const outcome = applyListSave(result.lists || {}, rawListName, incomingMembers, listId);
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

// 교체 동기화: 이번에 확인한 멤버로 목록을 바꿈 (X 리스트에서 뺀 멤버 정리)
async function replaceListMembers(rawListName, seenMembers, listId) {
  const result = await chrome.storage.local.get(['lists']);
  const outcome = applyListReplace(result.lists || {}, rawListName, seenMembers, listId);
  if (!outcome.success) {
    return { success: false, message: outcome.message };
  }
  await chrome.storage.local.set({ lists: outcome.lists });
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

// content script 요청: action → 처리 함수 (data: { listName, members, listId })
const messageHandlers = {
  saveListMembers: data => saveListMembers(data.listName, data.members, data.listId),
  replaceListMembers: data => replaceListMembers(data.listName, data.members, data.listId)
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
