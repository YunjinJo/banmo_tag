// content.js
// 공통 순수 로직은 shared.js 에 있으며 manifest 에서 먼저 로드됩니다.
// 전체를 IIFE 로 감싸 팝업의 재주입(chrome.scripting) 시 중복 실행/재선언 오류를 방지합니다.
(() => {
  if (window.__agContentLoaded) return;
  // shared.js 가 없으면 어떤 기능도 동작할 수 없으므로 증상을 숨기지 말고 원인을 분명히 남기고 중단
  if (typeof sanitizeListsObject !== 'function') {
    console.error('[banmo_tag] shared.js 가 로드되지 않았습니다. 확장 프로그램을 새로고침해주세요.');
    return;
  }
  window.__agContentLoaded = true;

  const DEFAULT_BADGE_SETTINGS = AG_DEFAULT_BADGE_SETTINGS;

  // 1. 캐싱된 리스트 데이터
  let listData = {};
  // 사용자 핸들을 리스트 정보 배열로 매핑 (예: '@elonmusk': [{name: 'Tech', color: '#f00', mode}])
  let handleToListsMap = {};
  // 배지 스타일 설정
  let badgeSettings = { ...DEFAULT_BADGE_SETTINGS };
  // 마지막으로 background 에 보낸 (리스트명 + 멤버) 서명 — 동일 데이터 반복 전송 방지
  let lastSentSignature = '';
  let lastUrl = location.href;
  let isShutDown = false;
  const pendingTimers = new Set();

  // ==========================================
  // 0. 확장 프로그램 컨텍스트 관리
  // ==========================================

  // 확장 프로그램이 업데이트/새로고침되면 기존 탭의 content script 는 고아 상태가 되어
  // chrome.* 호출마다 "Extension context invalidated" 오류를 냅니다. 이를 감지해 스스로 정지합니다.
  function isContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
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

  function schedule(fn, delay) {
    const id = setTimeout(() => {
      pendingTimers.delete(id);
      fn();
    }, delay);
    pendingTimers.add(id);
  }

  function safeSessionGet(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }

  function safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* 용량 초과 등은 무시 */ }
  }

  // ==========================================
  // 1. 데이터 로드 및 스토리지 동기화
  // ==========================================

  function applyLists(rawLists) {
    // 마이그레이션 저장은 background/popup 이 담당하고, 여기서는 메모리에서만 정제해 사용
    listData = sanitizeListsObject(rawLists || {}).newLists;
    handleToListsMap = buildHandleMap(listData);
  }

  // 초기 데이터 로드
  function loadData() {
    chrome.storage.local.get(['lists', 'badgeSettings'], (result) => {
      if (chrome.runtime.lastError) return;
      applyLists(result.lists);
      badgeSettings = { ...DEFAULT_BADGE_SETTINGS, ...(result.badgeSettings || {}) };
      // 데이터 로드 전에 빈 데이터로 처리된 트윗이 있을 수 있으므로 초기화 후 재처리
      clearProcessedStyles();
      processTimeline();
    });
  }

  // 스토리지 변경 감지
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local' || isShutDown) return;
    let needsRefresh = false;
    if (changes.lists) {
      applyLists(changes.lists.newValue);
      // 리스트가 삭제/수정되었을 수 있으므로, 현재 화면 멤버를 다시 보낼 수 있게 서명 초기화
      lastSentSignature = '';
      needsRefresh = true;
    }
    if (changes.badgeSettings) {
      badgeSettings = { ...DEFAULT_BADGE_SETTINGS, ...(changes.badgeSettings.newValue || {}) };
      needsRefresh = true;
    }
    if (needsRefresh) {
      clearProcessedStyles(); // 설정 변경 시 재처리를 위해 초기화
      processTimeline();
    }
  });

  // 개별 트윗에 적용된 배지/강조 스타일 초기화 (가상 스크롤 DOM 재사용 대응)
  function resetTweetStyle(t) {
    delete t.dataset.agProcessed;
    t.style.borderLeft = '';
    t.style.opacity = '';
    t.querySelectorAll('.ag-badges-wrapper').forEach(w => w.remove());
  }

  // 기존에 처리된 스타일을 리셋하기 위해 변경 시 속성 제거
  function clearProcessedStyles() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(resetTweetStyle);
  }

  // ==========================================
  // 2. 리스트 멤버 추출 로직 (List Sync)
  // ==========================================

  // 현재 화면에 떠있는 리스트 멤버 모달 다이얼로그(창) 탐색
  function getMemberListDialog() {
    const dialogs = document.querySelectorAll('div[role="dialog"]');
    for (const dialog of dialogs) {
      const heading = dialog.querySelector('h2, h1, [role="heading"]');
      const headingText = heading ? heading.textContent : '';
      // 한국어 및 영어 키워드 또는 UserCell 포함 여부 확인
      const isMemberDialog =
        headingText.includes('멤버') ||
        headingText.includes('구성원') ||
        headingText.includes('Member') ||
        dialog.querySelector('[data-testid="UserCell"]') !== null;
      if (isMemberDialog) return dialog;
    }
    return null;
  }

  // 페이지에서 순수 리스트 이름 추출 (내 태그 및 불필요한 접미사 배제, 하이픈 포함 리스트명 보존)
  function getListNameFromPage(urlInfo, dialog) {
    let candidate = '';
    // 이름의 출처. 신뢰할 수 있는 출처(헤딩/캐시/title)에서 얻은 이름만 세션 캐시에 저장
    let reliable = true;
    const cacheKey = urlInfo && urlInfo.listId ? 'ag_list_name_' + urlInfo.listId : null;

    // 1. 모달 창 내부의 헤딩 (시스템 단어 배제)
    if (dialog) {
      for (const h of dialog.querySelectorAll('h2, h1, [role="heading"]')) {
        const text = cleanListName(h.textContent.trim());
        if (isValidListName(text)) {
          candidate = text;
          break;
        }
      }
    }

    // 2. DOM 내 메인 헤딩 요소 (primaryColumn / main) - 가장 신뢰도 높은 출처
    if (!candidate) {
      for (const h of document.querySelectorAll('[data-testid="primaryColumn"] h2, main h2, h1[role="heading"]')) {
        const raw = h.textContent.trim();
        if (raw.includes('팔로우 추천') || raw.includes('Who to follow')) continue;
        const text = cleanListName(raw);
        if (isValidListName(text)) {
          candidate = text;
          break;
        }
      }
    }

    // 3. 리스트 메인 페이지에서 저장해둔 이름 캐시 (멤버 하위 페이지에서 사용)
    if (!candidate && cacheKey && !urlInfo.isMain) {
      const cachedName = safeSessionGet(cacheKey);
      if (cachedName && isValidListName(cachedName)) candidate = cachedName;
    }

    // 4. document.title 분석 (' - ' 로 무조건 자르지 않고 cleanListName 으로 시스템 접두사만 제거하여 'AI - 연구자' 등 보존)
    if (!candidate) {
      const titleCleaned = cleanListName(document.title || '');
      if (isValidListName(titleCleaned)) candidate = titleCleaned;
    }

    // 5. TopNavBar 내 서브타이틀
    if (!candidate) {
      const topNavBar = document.querySelector('[data-testid="TopNavBar"], header[role="banner"]');
      if (topNavBar) {
        for (const span of topNavBar.querySelectorAll('span, div[dir="auto"]')) {
          const text = span.textContent.trim();
          if (text && text.length < 50 && isValidListName(text) &&
              !text.includes('팔로우 추천') && !text.includes('뒤로') &&
              !text.includes('Back') && !text.startsWith('@')) {
            candidate = text;
            reliable = false; // 표시 이름 등 엉뚱한 텍스트일 수 있으므로 캐시하지 않음
            break;
          }
        }
      }
    }

    // 6. listId 폴백
    const idFallback = urlInfo && urlInfo.listId ? '리스트 (' + urlInfo.listId + ')' : 'Unknown List';
    let finalName = cleanListName(candidate || idFallback);

    // 최종 검증: 정제 결과가 시스템 단어이면 ID 폴백 사용
    if (isSystemListName(finalName)) finalName = idFallback;

    // 신뢰할 수 있는 실제 리스트 이름일 때만 세션 캐시에 저장 (폴백 이름은 캐시하지 않음)
    if (cacheKey && reliable && finalName !== 'Unknown List' && !isFallbackListName(finalName)) {
      safeSessionSet(cacheKey, finalName);
    }
    return finalName;
  }

  // 화면 요소에서 순수 멤버 유저 핸들 추출 (팔로우 추천 철저히 차단)
  function extractMembersFromPage(dialog) {
    // 모달이 열려있으면 모달 내부만, 아니면 메인 콘텐츠 영역만 탐색
    const container = dialog || document.querySelector('[data-testid="primaryColumn"], main[role="main"]');
    return extractMembersFromContainer(container, dialog);
  }

  // 스크래핑 및 저장 실행
  // - isManual: 팝업의 [⚡ 가져오기] 요청 여부 (멤버 관리 화면 차단 및 중복 전송 방지를 우회)
  // - onSaved: background 저장 결과 콜백 (수동 요청 시 실제 저장 결과를 팝업에 전달)
  function scrapeListMembers(isManual = false, onSaved = null) {
    const urlInfo = parseListUrl(location.pathname);
    // 비리스트 페이지에서는 불필요한 DOM 탐색(getMemberListDialog) 전에 즉시 종료
    if (!urlInfo) {
      return { success: false, message: '리스트 페이지가 아닙니다. 리스트의 멤버 화면에서 시도해주세요.' };
    }
    const dialog = getMemberListDialog();

    // 리스트 메인 페이지는 자동 수집 대상이 아니라 아래에서 차단되지만, 이름이 가장 확실히 보이는 화면이므로
    // 차단 검사 전에 이름을 한 번 읽어 세션 캐시를 채워 둡니다 (이후 멤버 화면에서 사용).
    if (urlInfo.isMain && !dialog && !isManual) {
      getListNameFromPage(urlInfo, null);
    }

    // 수집 정책 (shared.js): 리스트 URL 아님 / 팔로워 페이지 / 추천 탭 / 자동 수집 허용 화면 여부
    const blockReason = getScrapeBlockReason(urlInfo, dialog || document, dialog, isManual);
    if (blockReason) {
      return { success: false, message: blockReason };
    }

    const listName = getListNameFromPage(urlInfo, dialog);
    // 시스템 단어(멤버 관리, 리스트 등)는 어떤 경우에도 리스트로 등록 불가
    if (isSystemListName(listName)) {
      return { success: false, message: '리스트 이름을 확인할 수 없습니다. 리스트 페이지에서 다시 시도해주세요.' };
    }

    const members = extractMembersFromPage(dialog);
    if (members.length === 0) {
      return { success: false, message: '순수 멤버를 찾을 수 없습니다. 멤버 목록이 보이는 상태에서 시도해주세요.' };
    }

    // 동일한 데이터는 다시 보내지 않음 (스크롤/DOM 변경마다 background 왕복 방지)
    const signature = buildScrapeSignature(listName, members);
    if (!isManual && signature === lastSentSignature) {
      return { success: true, listName, count: members.length, unchanged: true };
    }
    lastSentSignature = signature;

    try {
      chrome.runtime.sendMessage({ action: 'saveListMembers', data: { listName, listId: urlInfo.listId, members } }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          // 실패 시 다음 시도에서 다시 전송할 수 있도록 서명 초기화
          lastSentSignature = '';
          if (onSaved) {
            onSaved({
              success: false,
              message: (response && (response.message || response.error)) || '저장에 실패했습니다. 다시 시도해주세요.'
            });
          }
          return;
        }
        if (onSaved) {
          onSaved({ success: true, listName: response.listName || listName, count: response.count, added: response.added || 0 });
        }
      });
    } catch (err) {
      lastSentSignature = '';
      if (!isContextValid()) shutdown();
      return { success: false, message: '확장 프로그램 연결이 끊어졌습니다. 페이지를 새로고침해주세요.' };
    }

    return { success: true, pending: true, listName, count: members.length };
  }

  // 팝업 등의 외부 요청 수신
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'scrapeNow') return false;

    const res = scrapeListMembers(true, (saved) => sendResponse(saved));
    if (res.pending) return true; // background 저장 결과를 기다린 뒤 비동기 응답
    sendResponse(res);
    return false;
  });

  // ==========================================
  // 3. 타임라인 뱃지 주입 로직
  // ==========================================

  function getHandleFromUserInfo(userInfoDiv) {
    const handleSpan = Array.from(userInfoDiv.querySelectorAll('span'))
      .find(span => span.textContent.trim().startsWith('@'));
    if (handleSpan) return handleSpan.textContent.trim().toLowerCase();

    const link = userInfoDiv.querySelector('a[href^="/"]');
    if (link) {
      const match = (link.getAttribute('href') || '').match(/^\/([A-Za-z0-9_]{1,15})$/);
      if (match) return '@' + match[1].toLowerCase();
    }
    return null;
  }

  // tweets 를 넘기면 그 트윗만, 생략하면 화면의 모든 트윗을 처리
  function processTimeline(tweets) {
    if (isShutDown) return;
    // 저장된 리스트가 없으면 DOM 을 순회할 필요가 없음
    if (Object.keys(handleToListsMap).length === 0) return;

    (tweets || document.querySelectorAll('article[data-testid="tweet"]')).forEach(tweet => {
      const userInfoDivs = tweet.querySelectorAll('[data-testid="User-Name"]');
      if (userInfoDivs.length === 0) return;

      // X(Twitter) 가상 스크롤이 <article> 노드를 다른 작성자 트윗에 재사용하더라도
      // 현재 트윗 내 작성자 핸들 서명(handlesKey)을 비교해 다르면 이전 배지/스타일을 초기화 후 재처리
      const handles = Array.from(userInfoDivs).map(getHandleFromUserInfo);
      const handlesKey = handles.map(h => h || '').join(',') || 'none';
      if (tweet.dataset.agProcessed === handlesKey) return;
      if (tweet.dataset.agProcessed) {
        resetTweetStyle(tweet);
      }

      let highlightColor = '';
      let shouldDim = false;

      userInfoDivs.forEach((userInfoDiv, index) => {
        const isMainAuthor = index === 0;
        const handle = handles[index];
        const lists = handle && handleToListsMap[handle];
        if (!lists) return;

        // 인용 트윗처럼 이름에 <a> 링크가 없으면 이름 영역 자체에 붙임 (shared.js getBadgeAnchor)
        const anchor = getBadgeAnchor(userInfoDiv);
        if (!anchor) return;

        let wrapper = anchor.querySelector('.ag-badges-wrapper');
        if (!wrapper) {
          wrapper = document.createElement('span');
          wrapper.className = 'ag-badges-wrapper';
          anchor.appendChild(wrapper);
        }

        lists.forEach(list => {
          if (isMainAuthor) {
            // 여러 강조 리스트에 속한 경우 첫 번째 리스트 색상을 사용
            if (list.mode === 'highlight' && !highlightColor) highlightColor = list.color;
            else if (list.mode === 'dim') shouldDim = true;
          }

          const exists = Array.from(wrapper.children).some(
            el => el.classList.contains('ag-list-badge') && el.textContent === list.name
          );
          if (exists) return;

          const badge = document.createElement('span');
          badge.className = isMainAuthor ? 'ag-list-badge' : 'ag-list-badge mini-badge';
          badge.textContent = list.name;
          applyBadgeStyle(badge, list.color, badgeSettings, isMainAuthor);
          wrapper.appendChild(badge);
        });
      });

      // 강조가 흐리게보다 우선
      if (highlightColor) {
        tweet.style.borderLeft = `4px solid ${highlightColor}`;
      } else if (shouldDim) {
        tweet.style.opacity = '0.5';
      }

      tweet.dataset.agProcessed = handlesKey;
    });
  }

  // ==========================================
  // 4. MutationObserver 및 SPA 라우팅 감지
  // ==========================================

  // DOM 변경 시 전체 트윗을 다시 훑지 않고, 변경된 노드에 속한 트윗만 모아서 처리합니다.
  // (첫 로드/URL 변경/설정 변경 때만 전체 처리)
  const TWEET_SELECTOR = 'article[data-testid="tweet"]';
  const MAX_PENDING_TWEETS = 300;
  const pendingTweets = new Set();
  let needsFullScan = true;

  function collectTweets(node) {
    if (needsFullScan || node.nodeType !== 1) return;
    const own = node.closest(TWEET_SELECTOR);
    if (own) pendingTweets.add(own);
    node.querySelectorAll(TWEET_SELECTOR).forEach(t => pendingTweets.add(t));
    if (pendingTweets.size > MAX_PENDING_TWEETS) {
      needsFullScan = true;
      pendingTweets.clear();
    }
  }

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
  }, 200);

  function requestFullScan() {
    needsFullScan = true;
    debouncedProcess();
  }

  // SPA 라우팅 감지.
  // content script 는 격리된 world 에서 실행되므로 history.pushState 를 덮어써도 페이지의 내비게이션을
  // 가로챌 수 없습니다. 대신 DOM 변경(라우팅 시 항상 발생)과 popstate 시점에 URL 을 비교합니다.
  function checkUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    lastSentSignature = '';
    schedule(requestFullScan, 300);
    schedule(requestFullScan, 1200);
  }

  // MutationObserver 콜백은 비동기로 전달되므로 처리 중 플래그로는 자기 트리거를 막을 수 없습니다.
  // 대신 확장 프로그램이 직접 삽입한 배지 노드만 추가된 변경은 무시합니다.
  const observer = new MutationObserver((mutations) => {
    checkUrlChange();
    let hasRelevantChange = false;
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || isOwnInjectedNode(n)) continue;
        hasRelevantChange = true;
        collectTweets(n);
      }
    }
    if (hasRelevantChange) debouncedProcess();
  });

  function init() {
    // 이전 버전이 남긴 하단 알림 및 플로팅 버튼 요소 잔여물 정리
    document.getElementById('ag-floating-sync-btn')?.remove();
    document.getElementById('ag-toast')?.remove();

    loadData();

    // 첫 로드 시 바로 스크래핑 및 뱃지 처리 시도 (늦게 렌더링되는 화면 대응)
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
