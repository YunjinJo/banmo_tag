// content.js — X(x.com / twitter.com) 페이지 안에서 실행
//   1) 리스트 멤버 화면에서 멤버를 읽어 저장 (background.js 로 전송)
//   2) 타임라인 트윗 작성자 옆에 리스트 배지를 붙이고 강조/흐리게 표시
//   3) X 화면 구조가 바뀌었는지 점검해 팝업 경고용으로 기록
//
// 이 파일은 "언제 · 무엇을" 을 맡습니다: 저장 데이터와 화면 변화를 지켜보다가 필요한 일을 시킵니다.
// "어떻게"(화면에서 이름·멤버 읽기, 트윗에 배지 그리기, 구조 진단)는 manifest 에서 먼저 로드되는 shared/ 에 있습니다.
//   shared/list-page.js  parseListUrl, getMemberListDialog, getListNameFromPage, extractMembersFromContainer …
//   shared/badges.js     buildHandleMap, renderTweet, resetTweetStyle …
//   shared/health.js     diagnoseStructure
// 전체를 즉시 실행 함수로 감싸, 팝업이 다시 주입(chrome.scripting)해도 두 번 실행되지 않게 합니다.
//
// 목차
//   0. 시작 조건 / 상수 / 상태
//   1. 확장 프로그램 연결 · 타이머
//   2. 저장 데이터 불러오기 · 변경 반영
//   3. 멤버 수집 · 교체 동기화
//   4. 팝업 메시지 처리
//   5. 타임라인 배지
//   6. 화면 구조 점검
//   7. 화면 변화 감지 · 시작
(() => {
  // ==========================================
  // 0. 시작 조건 / 상수 / 상태
  // ==========================================

  if (window.__agContentLoaded) return;
  // shared/ 파일이 없으면 어떤 기능도 동작할 수 없으므로, 원인을 분명히 남기고 중단
  if (typeof sanitizeListsObject !== 'function') {
    console.error('[banmo_tag] shared/ 파일이 로드되지 않았습니다. 확장 프로그램을 새로고침해주세요.');
    return;
  }
  window.__agContentLoaded = true;

  const DEFAULT_BADGE_SETTINGS = AG_DEFAULT_BADGE_SETTINGS;
  // 한 번에 모아 둘 "변경된 트윗" 최대 수. 넘으면 전체를 다시 훑는 편이 빠름
  const MAX_PENDING_TWEETS = 300;
  // 화면 구조 점검: 같은 결과가 이 시간 이상 유지될 때만 기록 (로딩 중 일시적인 상태 무시)
  const HEALTH_SETTLE_MS = 2500;

  // 저장된 리스트 (정제된 상태)
  let listData = {};
  // 핸들(소문자) → 소속 리스트 정보 배열 (예: '@alice': [{ name: '친구', color: '#f00', mode, style? }])
  let handleToListsMap = {};
  let badgeSettings = { ...DEFAULT_BADGE_SETTINGS };
  // 마지막으로 background 에 보낸 (리스트명 + 멤버) 서명 — 같은 데이터 반복 전송 방지
  let lastSentSignature = '';
  let lastUrl = location.href;
  let isShutDown = false;
  const pendingTimers = new Set();

  // 이번 방문에서 멤버 화면에 나타난 멤버 누적: listId → { listName, handles: Map<소문자, 원래 표기> }
  // X 목록은 가상 스크롤이라 화면 밖 멤버는 DOM 에서 사라지므로, "교체 동기화"는 이 누적 목록을 씀
  const seenByList = new Map();

  // 화면 구조 점검 상태: storage 의 structureHealth, 그리고 아직 기록하지 않은 최근 결과(area → { ok, message, firstAt })
  let storedHealth = {};
  const pendingHealth = {};

  // DOM 변경으로 다시 처리할 트윗 (전체를 매번 훑지 않기 위해 모아 둠)
  const pendingTweets = new Set();
  let needsFullScan = true;

  // ==========================================
  // 1. 확장 프로그램 연결 · 타이머
  // ==========================================

  // 확장 프로그램이 업데이트/새로고침되면 기존 탭의 content script 는 고아 상태가 되어
  // chrome.* 호출마다 "Extension context invalidated" 오류를 냅니다. 이를 감지해 스스로 멈춥니다.
  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function shutdown() {
    if (isShutDown) return;
    isShutDown = true;
    observer.disconnect();
    window.removeEventListener('popstate', checkUrlChange);
    pendingTimers.forEach(clearTimeout);
    pendingTimers.clear();
    window.__agContentLoaded = false;
  }

  // shutdown 때 한꺼번에 취소할 수 있는 setTimeout
  function schedule(fn, delay) {
    const id = setTimeout(() => {
      pendingTimers.delete(id);
      fn();
    }, delay);
    pendingTimers.add(id);
  }

  // 읽은 리스트 이름을 이 탭 안에서 기억해 두는 곳 (getListNameFromPage 가 씀). sessionStorage 를 쓸 수 없으면 조용히 넘어감
  const listNameCache = {
    get(key) {
      try { return sessionStorage.getItem(key); } catch { return null; }
    },
    set(key, value) {
      try { sessionStorage.setItem(key, value); } catch { /* 용량 초과 등은 무시 */ }
    }
  };

  // ==========================================
  // 2. 저장 데이터 불러오기 · 변경 반영
  // ==========================================

  // 저장 형식 정리(마이그레이션) 결과를 저장하는 일은 background/popup 이 하고, 여기서는 메모리에서만 정제
  function applyLists(rawLists) {
    listData = sanitizeListsObject(rawLists || {}).newLists;
    handleToListsMap = buildHandleMap(listData);
  }

  function loadData() {
    chrome.storage.local.get(['lists', 'badgeSettings', 'structureHealth'], (result) => {
      if (chrome.runtime.lastError) return;
      applyLists(result.lists);
      badgeSettings = { ...DEFAULT_BADGE_SETTINGS, ...(result.badgeSettings || {}) };
      storedHealth = result.structureHealth || {};
      // 데이터가 오기 전에 빈 데이터로 처리된 트윗이 있을 수 있으므로 초기화 후 다시 처리
      clearProcessedStyles();
      processTimeline();
    });
  }

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local' || isShutDown) return;

    if (changes.structureHealth) {
      storedHealth = changes.structureHealth.newValue || {};
    }

    let changedHandles = null;
    if (changes.lists) {
      const oldMap = handleToListsMap;
      applyLists(changes.lists.newValue);
      // 리스트가 지워졌거나 바뀌었을 수 있으므로, 현재 화면의 멤버를 다시 보낼 수 있게 서명 초기화
      lastSentSignature = '';
      changedHandles = diffHandleMaps(oldMap, handleToListsMap);
    }

    if (changes.badgeSettings) {
      // 배지 모양은 모든 배지에 영향을 주므로 전체 다시 그리기
      badgeSettings = { ...DEFAULT_BADGE_SETTINGS, ...(changes.badgeSettings.newValue || {}) };
      clearProcessedStyles();
      processTimeline();
    } else if (changedHandles && changedHandles.length > 0) {
      // 리스트 변경은 표시가 달라진 사람의 트윗만 다시 그림 (멤버 화면 스크롤 중 잦은 저장에도 가볍게)
      refreshTweetsByHandles(changedHandles);
    }
  });

  // ==========================================
  // 3. 멤버 수집 · 교체 동기화
  // ==========================================

  // 화면의 멤버 핸들 (멤버 창이 열려 있으면 창 안만, 아니면 본문만)
  function extractMembersFromPage(dialog) {
    const container = dialog || document.querySelector('[data-testid="primaryColumn"], main[role="main"]');
    return extractMembersFromContainer(container, dialog);
  }

  // 멤버 화면에서 본 멤버를 이번 방문 누적 목록에 더함
  function rememberSeenMembers(listId, listName, members) {
    let seen = seenByList.get(listId);
    if (!seen) {
      seen = { listName, handles: new Map() };
      seenByList.set(listId, seen);
    }
    seen.listName = listName;
    members.forEach((member) => {
      const lower = member.toLowerCase();
      if (!seen.handles.has(lower)) seen.handles.set(lower, member);
    });
  }

  // 지금 화면에서 수집할 수 있는 멤버를 읽고 이번 방문 누적 목록에 더함.
  // 성공: { success: true, urlInfo, listName, members }, 실패: { success: false, message }
  function collectVisibleMembers(isManual) {
    const urlInfo = parseListUrl(location.pathname);
    // 리스트가 아닌 화면에서는 DOM 을 살펴보기 전에 바로 종료
    if (!urlInfo) {
      return { success: false, message: '리스트 페이지가 아닙니다. 리스트의 멤버 화면에서 시도해주세요.' };
    }
    const dialog = getMemberListDialog(document);

    // 리스트 메인 화면은 자동 수집 대상이 아니라 아래에서 막히지만, 이름이 가장 확실히 보이는 화면이므로
    // 막기 전에 이름을 한 번 읽어 세션 캐시를 채워 둠 (이후 멤버 화면에서 사용)
    if (urlInfo.isMain && !dialog && !isManual) {
      getListNameFromPage(document, urlInfo, null, listNameCache);
    }

    const blockReason = getScrapeBlockReason(urlInfo, dialog || document, dialog, isManual);
    if (blockReason) return { success: false, message: blockReason };

    const listName = getListNameFromPage(document, urlInfo, dialog, listNameCache);
    if (isSystemListName(listName)) {
      return { success: false, message: '리스트 이름을 확인할 수 없습니다. 리스트 페이지에서 다시 시도해주세요.' };
    }

    const members = extractMembersFromPage(dialog);
    if (members.length === 0) {
      return { success: false, message: '순수 멤버를 찾을 수 없습니다. 멤버 목록이 보이는 상태에서 시도해주세요.' };
    }

    // 교체 동기화용 누적은 멤버 화면(또는 멤버 창)에서 본 멤버만
    if (urlInfo.isMembers || dialog) rememberSeenMembers(urlInfo.listId, listName, members);

    return { success: true, urlInfo, listName, members };
  }

  // 멤버를 읽어 background 에 저장 요청
  // - isManual: 팝업 [⚡ 가져오기] 요청 (자동 수집 화면 제한과 중복 전송 방지를 건너뜀)
  // - onSaved: background 저장 결과를 받을 콜백 (팝업에 실제 결과를 전달할 때)
  function scrapeListMembers(isManual = false, onSaved = null) {
    const collected = collectVisibleMembers(isManual);
    if (!collected.success) return collected;
    const { urlInfo, listName, members } = collected;

    // 같은 데이터는 다시 보내지 않음 (스크롤/DOM 변경마다 background 를 오가지 않게)
    const signature = buildScrapeSignature(listName, members);
    if (!isManual && signature === lastSentSignature) {
      return { success: true, listName, count: members.length, unchanged: true };
    }
    lastSentSignature = signature;

    const reportFailure = (response) => {
      lastSentSignature = ''; // 다음 시도에서 다시 보낼 수 있게
      if (!onSaved) return;
      onSaved({
        success: false,
        message: (response && (response.message || response.error)) || '저장에 실패했습니다. 다시 시도해주세요.'
      });
    };

    try {
      const message = { action: 'saveListMembers', data: { listName, listId: urlInfo.listId, members } };
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          reportFailure(response);
          return;
        }
        if (onSaved) {
          onSaved({ success: true, listName: response.listName || listName, count: response.count, added: response.added || 0 });
        }
      });
    } catch {
      lastSentSignature = '';
      if (!isContextValid()) shutdown();
      return { success: false, message: '확장 프로그램 연결이 끊어졌습니다. 페이지를 새로고침해주세요.' };
    }

    return { success: true, pending: true, listName, count: members.length };
  }

  // 교체 동기화 계획: 이번 방문 누적 목록과 저장 데이터를 비교 (저장하지 않음)
  function getReplacePlan() {
    const collected = collectVisibleMembers(true);
    const urlInfo = parseListUrl(location.pathname);
    const seen = urlInfo && seenByList.get(urlInfo.listId);
    if (!seen || seen.handles.size === 0) {
      return {
        success: false,
        message: collected.success ? '교체 동기화는 리스트의 "멤버" 화면에서만 할 수 있습니다.' : collected.message
      };
    }

    const handles = Array.from(seen.handles.values());
    const plan = applyListReplace(listData, seen.listName, handles, urlInfo.listId);
    if (!plan.success) return plan;
    return {
      success: true,
      listId: urlInfo.listId,
      rawListName: seen.listName,
      listName: plan.listName,
      handles,
      seenCount: handles.length,
      previousCount: plan.previousCount,
      added: plan.added,
      removed: plan.removed
    };
  }

  // ==========================================
  // 4. 팝업 메시지 처리
  // ==========================================

  // 각 처리 함수는 응답을 나중에 보내면(비동기) true 를 반환
  const messageHandlers = {
    // [⚡ 가져오기]: 지금 화면의 멤버 저장
    scrapeNow(sendResponse) {
      const result = scrapeListMembers(true, saved => sendResponse(saved));
      if (result.pending) return true; // background 저장 결과를 기다린 뒤 응답
      sendResponse(result);
      return false;
    },

    // [🔄 교체 동기화] 1단계: 미리보기 (몇 명이 삭제/추가되는지)
    replacePreview(sendResponse) {
      const plan = getReplacePlan();
      if (!plan.success) {
        sendResponse(plan);
        return false;
      }
      sendResponse({
        success: true,
        listName: plan.listName,
        seenCount: plan.seenCount,
        previousCount: plan.previousCount,
        added: plan.added,
        removed: plan.removed
      });
      return false;
    },

    // [🔄 교체 동기화] 2단계: 실제 저장 (background 저장 큐에서 처리)
    replaceNow(sendResponse) {
      const plan = getReplacePlan();
      if (!plan.success) {
        sendResponse(plan);
        return false;
      }
      try {
        const message = {
          action: 'replaceListMembers',
          data: { listName: plan.rawListName, listId: plan.listId, members: plan.handles }
        };
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError || !response) {
            sendResponse({ success: false, message: '저장에 실패했습니다. 다시 시도해주세요.' });
            return;
          }
          sendResponse(response);
        });
      } catch {
        if (!isContextValid()) shutdown();
        sendResponse({ success: false, message: '확장 프로그램 연결이 끊어졌습니다. 페이지를 새로고침해주세요.' });
        return false;
      }
      return true;
    }
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const action = request && request.action;
    if (!Object.prototype.hasOwnProperty.call(messageHandlers, action)) return false;
    return messageHandlers[action](sendResponse);
  });

  // ==========================================
  // 5. 타임라인 배지 (그리는 방법은 shared/badges.js 의 renderTweet)
  // ==========================================

  // 모든 트윗에서 배지·강조·흐리게 표시를 지움
  function clearProcessedStyles() {
    document.querySelectorAll(AG_TWEET_SELECTOR).forEach(resetTweetStyle);
  }

  // 바뀐 핸들이 들어 있는 트윗만 초기화 후 다시 처리
  function refreshTweetsByHandles(changedHandles) {
    const changed = new Set(changedHandles);
    const affected = [];
    document.querySelectorAll(AG_TWEET_SELECTOR).forEach((tweet) => {
      if (isTweetAffected(tweet.dataset.agProcessed, changed)) {
        resetTweetStyle(tweet);
        affected.push(tweet);
      }
    });
    if (affected.length > 0) processTimeline(affected);
  }

  // tweets 를 넘기면 그 트윗만, 생략하면 화면의 모든 트윗을 처리
  function processTimeline(tweets) {
    if (isShutDown) return;
    // 저장된 리스트가 없으면 DOM 을 훑을 필요가 없음
    if (Object.keys(handleToListsMap).length === 0) return;
    (tweets || document.querySelectorAll(AG_TWEET_SELECTOR)).forEach(tweet => renderTweet(tweet, handleToListsMap, badgeSettings));
  }

  // ==========================================
  // 6. 화면 구조 점검 (팝업 경고용)
  // ==========================================

  function saveHealth(area, ok, message, at) {
    const next = { ...storedHealth, [area]: { ok, message, at } };
    storedHealth = next;
    try {
      chrome.storage.local.set({ structureHealth: next }).catch(() => {});
    } catch {
      if (!isContextValid()) shutdown();
    }
  }

  function checkStructureHealth() {
    if (isShutDown) return;
    const urlInfo = parseListUrl(location.pathname);
    const result = diagnoseStructure(document, urlInfo, urlInfo ? getMemberListDialog(document) : null);
    if (!result) return; // 판단할 수 없는 화면

    const now = Date.now();
    // 정상 결과에는 message 가 없으므로(undefined) 항상 문자열로 맞춰 비교
    const message = result.message || '';

    // 새 결과면 기록을 미루고, 결과가 유지되는지 나중에 한 번 더 확인
    const pending = pendingHealth[result.area];
    if (!pending || pending.ok !== result.ok || pending.message !== message) {
      pendingHealth[result.area] = { ok: result.ok, message, firstAt: now };
      schedule(checkStructureHealth, HEALTH_SETTLE_MS + 100);
      return;
    }
    if (now - pending.firstAt < HEALTH_SETTLE_MS) return;

    const stored = storedHealth[result.area];
    const sameAsStored = stored && stored.ok === result.ok && (stored.message || '') === message;
    if (sameAsStored) return;
    // 정상 상태를 처음 확인한 경우(기록 없음)는 굳이 쓰지 않음
    if (!stored && result.ok) return;

    saveHealth(result.area, result.ok, message, now);
  }

  // ==========================================
  // 7. 화면 변화 감지 · 시작
  // ==========================================

  // 추가된 노드에 속한 트윗을 다시 처리할 목록에 모음
  function collectTweets(node) {
    if (needsFullScan || node.nodeType !== 1) return;
    const own = node.closest(AG_TWEET_SELECTOR);
    if (own) pendingTweets.add(own);
    node.querySelectorAll(AG_TWEET_SELECTOR).forEach(t => pendingTweets.add(t));
    if (pendingTweets.size > MAX_PENDING_TWEETS) {
      needsFullScan = true;
      pendingTweets.clear();
    }
  }

  // DOM 변경을 200ms 묶어서: 배지 처리 → 멤버 자동 수집 → 화면 구조 점검
  const debouncedProcess = debounce(() => {
    if (isShutDown) return;
    if (!isContextValid()) {
      shutdown();
      return;
    }
    if (needsFullScan) {
      needsFullScan = false;
      pendingTweets.clear();
      processTimeline();
    } else if (pendingTweets.size > 0) {
      const batch = Array.from(pendingTweets).filter(t => t.isConnected);
      pendingTweets.clear();
      processTimeline(batch);
    }
    scrapeListMembers(false);
    checkStructureHealth();
  }, 200);

  function requestFullScan() {
    needsFullScan = true;
    debouncedProcess();
  }

  // SPA 화면 이동 감지.
  // content script 는 페이지와 분리된 공간에서 실행되어 history.pushState 를 가로챌 수 없으므로,
  // DOM 변경(화면 이동 때 항상 발생)과 popstate 때 URL 을 비교합니다.
  function checkUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    lastSentSignature = '';

    // 다른 화면으로 가면 "이번 방문" 누적 멤버를 비움 (같은 리스트의 멤버 화면에 머무는 경우만 유지)
    const info = parseListUrl(location.pathname);
    for (const id of Array.from(seenByList.keys())) {
      if (!info || info.listId !== id || !info.isMembers) seenByList.delete(id);
    }

    schedule(requestFullScan, 300);
    schedule(requestFullScan, 1200);
  }

  // MutationObserver 콜백은 비동기라 "처리 중" 표시로는 자기 변경을 걸러낼 수 없으므로,
  // 확장 프로그램이 직접 넣은 배지 노드만 추가된 변경은 무시합니다.
  const observer = new MutationObserver((mutations) => {
    checkUrlChange();
    let hasRelevantChange = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1 || isOwnInjectedNode(node)) continue;
        hasRelevantChange = true;
        collectTweets(node);
      }
    }
    if (hasRelevantChange) debouncedProcess();
  });

  function init() {
    // 이전 버전이 남긴 하단 알림·플로팅 버튼 정리
    document.getElementById('ag-floating-sync-btn')?.remove();
    document.getElementById('ag-toast')?.remove();

    loadData();

    // 늦게 그려지는 화면에 대비해 여러 번 처리
    requestFullScan();
    schedule(requestFullScan, 500);
    schedule(requestFullScan, 1500);
    schedule(requestFullScan, 3000);

    window.addEventListener('popstate', checkUrlChange);
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

    console.log('[banmo_tag] Content Script Initialized.');
  }

  init();
})();
