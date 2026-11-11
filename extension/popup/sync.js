// popup/sync.js — X 탭 연동([현재 탭에서 가져오기], [뺀 멤버 정리]) · X 화면 구조 경고
// 팝업 화면은 여러 파일로 나뉘어 있고, popup.html 이 shared.js → popup/*.js → popup.js 순서로 읽습니다.
// 파일들은 일반 스크립트라 최상위 함수·변수를 서로 공유합니다(목차는 popup.js 참고).

// ==========================================
// 4. X 탭 연동 ([현재 탭에서 가져오기], [뺀 멤버 정리])
// ==========================================

const TAB_CONNECTION_ERROR = '페이지에 연결할 수 없습니다. 트위터 탭을 새로고침(F5) 해주세요.';
const TAB_TIMEOUT_ERROR = '응답 시간이 초과되었습니다. 트위터 탭을 새로고침(F5) 후 다시 시도해주세요.';

// 탭의 content script 에 메시지를 보내고 응답을 기다림.
// 연결 실패는 { connectionError: true }, 시간 초과는 { timeoutError: true }
function sendTabMessage(tabId, message, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timeoutError: true });
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(chrome.runtime.lastError ? { connectionError: true } : response);
    });
  });
}

// 확장 프로그램 설치/새로고침 전에 열려 있던 탭에는 content script 가 없으므로 직접 넣음
async function injectContentScript(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['shared.js', 'content.js'] });
}

// 요청을 보낼 탭: 팝업이면 지금 보고 있는 탭, 새 탭 화면이면 열 때 보고 있던 탭
async function getTargetTab() {
  if (IS_TAB_VIEW && Number.isInteger(TARGET_TAB_ID)) {
    try {
      return await chrome.tabs.get(TARGET_TAB_ID);
    } catch {
      return null; // 그 탭이 닫힘
    }
  }
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab;
}

// 현재 X 탭에 요청을 보내고 응답을 받음. content script 가 없으면 한 번 넣고 다시 시도.
// 연결·시간 초과 문제는 { error: '안내 문구' } 로 정리해서 반환
async function requestFromActiveTab(message) {
  const activeTab = await getTargetTab();
  if (IS_TAB_VIEW && !activeTab) {
    return { error: '이 화면을 열 때 보던 X 탭을 찾을 수 없습니다. X 탭에서 팝업을 다시 열어주세요.' };
  }
  const tabError = getSyncTabError(activeTab);
  if (tabError) return { error: tabError };

  let response = await sendTabMessage(activeTab.id, message);
  if (response && response.connectionError) {
    try {
      await injectContentScript(activeTab.id);
    } catch {
      return { error: TAB_CONNECTION_ERROR };
    }
    response = await sendTabMessage(activeTab.id, message);
  }
  if (response && response.timeoutError) return { error: TAB_TIMEOUT_ERROR };
  if (!response || response.connectionError) return { error: TAB_CONNECTION_ERROR };
  return response;
}

function setupSyncButtons() {
  const syncBtn = byId('sync-current-tab-btn');
  const resyncBtn = byId('resync-replace-btn');
  syncBtn?.addEventListener('click', () => withButtonDisabled(syncBtn, syncCurrentTab));
  resyncBtn?.addEventListener('click', () => withButtonDisabled(resyncBtn, replaceSyncCurrentTab));
}

// [현재 탭에서 가져오기]: 현재 화면의 멤버를 저장
async function syncCurrentTab() {
  showSyncStatus('데이터 수집 중...', false);
  const response = await requestFromActiveTab({ action: 'scrapeNow' });
  if (response.error) {
    showSyncStatus(response.error, true);
  } else if (response.success) {
    const detail = response.added > 0 ? `새로 ${response.added}명 추가` : '새 멤버 없음';
    showSyncStatus(`'${response.listName}' 총 ${response.count}명 (${detail})`, false);
  } else {
    showSyncStatus(response.message || '리스트 멤버를 찾을 수 없습니다. 멤버 화면을 열어주세요.', true);
  }
}

// [뺀 멤버 정리]: 미리보기 → 확인 → 저장 (X 리스트에서 뺀 멤버 정리)
async function replaceSyncCurrentTab() {
  const preview = await requestFromActiveTab({ action: 'replacePreview' });
  if (preview.error || !preview.success) {
    showSyncStatus(preview.error || preview.message || '뺀 멤버 정리를 준비하지 못했습니다.', true);
    return;
  }
  if (preview.removed.length === 0 && preview.added === 0) {
    showSyncStatus(`'${preview.listName}' 멤버 목록이 이미 최신입니다. (${preview.seenCount}명)`, false);
    return;
  }
  if (!await askConfirm(buildReplaceConfirmText(preview), '교체')) return;

  const saved = await requestFromActiveTab({ action: 'replaceNow' });
  if (saved.error || !saved.success) {
    showSyncStatus(saved.error || saved.message || '뺀 멤버 정리에 실패했습니다.', true);
    return;
  }
  showSyncStatus(`'${saved.listName}' 멤버를 교체했습니다. 총 ${saved.count}명 (추가 ${saved.added}명, 삭제 ${saved.removedCount}명)`, false);
}

// 교체 확인 문구 (삭제될 핸들 일부를 보여 주고, 절반 이상 삭제되면 강하게 경고)
function buildReplaceConfirmText(preview) {
  const removed = preview.removed || [];
  const shown = removed.slice(0, 5).join(', ') + (removed.length > 5 ? ` 외 ${removed.length - 5}명` : '');
  const lines = [];
  if (preview.previousCount > 0 && removed.length * 2 >= preview.previousCount) {
    lines.push(`⚠️ 저장된 ${preview.previousCount}명 중 절반 이상이 삭제됩니다. 멤버 화면을 끝까지 스크롤했는지 꼭 확인하세요.`);
  }
  lines.push(`'${preview.listName}' 멤버를 이번에 멤버 화면에서 확인한 ${preview.seenCount}명으로 교체합니다.`);
  lines.push(`삭제 ${removed.length}명${removed.length ? ': ' + shown : ''} / 추가 ${preview.added}명`);
  lines.push('화면에 한 번도 나오지 않은 멤버는 삭제되니, 목록을 끝까지 스크롤한 뒤 진행하세요.');
  return lines.join('\n');
}

// ==========================================
// 5. X 화면 구조 경고
// ==========================================

function renderHealthWarning(health) {
  const el = byId('health-warning');
  if (!el) return;
  el.textContent = '';

  const warnings = getStructureWarnings(health, Date.now(), 14);
  if (warnings.length === 0) {
    el.style.display = 'none';
    return;
  }

  const title = document.createElement('strong');
  title.textContent = 'X 화면 구조가 바뀌었을 수 있습니다';
  el.appendChild(title);
  warnings.forEach((w) => {
    const line = document.createElement('div');
    line.textContent = `• ${w.label}: ${w.message} (${new Date(w.at).toLocaleString()})`;
    el.appendChild(line);
  });
  const hint = document.createElement('div');
  hint.textContent = '수집이나 배지가 동작하지 않으면 확장 프로그램 업데이트가 필요합니다.';
  el.appendChild(hint);
  el.style.display = 'block';
}

async function loadHealthWarning() {
  const result = await chrome.storage.local.get(['structureHealth']);
  renderHealthWarning(result.structureHealth);
}
