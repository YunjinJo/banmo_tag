// background.js
// 서비스 워커로서 확장 프로그램의 백그라운드 작업을 처리합니다.
// 공통 로직(cleanListName, sanitizeListsObject, isSystemListName 등)은 shared.js 에 있습니다.
importScripts('shared.js');

// 저장 작업 직렬화 큐.
// 여러 탭/연속 스크래핑에서 get → set 이 겹치면 나중 쓰기가 앞선 변경을 덮어쓰므로 순서대로 처리합니다.
let saveQueue = Promise.resolve();

function enqueue(task) {
  const run = saveQueue.then(task, task);
  saveQueue = run.catch(() => {});
  return run;
}

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

chrome.runtime.onInstalled.addListener(() => {
  console.log('banmo_tag 확장 프로그램이 설치/업데이트되었습니다.');
  // 설치 또는 업데이트 시 기존 데이터에 태그/시스템 단어가 섞여있다면 자동 정제
  enqueue(async () => {
    const result = await chrome.storage.local.get(['lists']);
    if (!result.lists) return;
    const { newLists, modified } = sanitizeListsObject(result.lists);
    if (modified) await chrome.storage.local.set({ lists: newLists });
  }).catch(err => console.error('Storage migration failed:', err));
});

// content script와의 메시지 통신 처리
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request.data) return false;
  let task;
  if (request.action === 'saveListMembers') {
    task = () => saveListMembers(request.data.listName, request.data.members, request.data.listId);
  } else if (request.action === 'replaceListMembers') {
    task = () => replaceListMembers(request.data.listName, request.data.members, request.data.listId);
  } else {
    return false;
  }

  enqueue(task)
    .then(sendResponse)
    .catch(err => {
      console.error('Storage save failed:', err);
      sendResponse({ success: false, error: String(err && err.message || err) });
    });

  return true; // 비동기 응답을 위해 채널 유지
});
