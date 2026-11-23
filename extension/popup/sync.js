// popup/sync.js — X 탭 연동: x.com 접근 권한 · [현재 탭에서 가져오기] · [끝까지 스캔] · [뺀 멤버 정리] · X 화면 구조 경고
// 팝업 코드는 화면 단위 파일로 나뉘어 있고 최상위 함수·변수를 서로 공유합니다 (파일 목록과 읽는 순서는 popup.js 머리말).

// ==========================================
// x.com 접근 권한
// ==========================================

// x.com 접근 권한 확인. 꺼져 있으면(파이어폭스에서 사용자가 거부한 경우 등) 안내와 [허용] 버튼 표시
async function setupPermissionCheck() {
  const banner = byId('permission-warning');
  if (!banner || !chrome.permissions) return;
  const origins = chrome.runtime.getManifest().host_permissions || [];

  const refresh = async () => {
    let granted;
    try {
      granted = await chrome.permissions.contains({ origins });
    } catch {
      granted = true; // 확인할 수 없으면 경고하지 않음
    }
    banner.style.display = granted ? 'none' : 'block';
  };

  byId('grant-permission-btn')?.addEventListener('click', async () => {
    let granted = false;
    try {
      granted = await chrome.permissions.request({ origins }); // 사용자 클릭 직후에 바로 요청해야 함
    } catch (err) {
      console.error('[banmo_tag] 권한 요청 실패:', err);
    }
    showSyncStatus(granted
      ? 'x.com 접근을 허용했습니다. 열려 있는 X 탭을 새로고침(F5)해주세요.'
      : 'x.com 접근이 허용되지 않았습니다.', !granted);
    refresh();
  });

  chrome.permissions.onAdded?.addListener(refresh);
  chrome.permissions.onRemoved?.addListener(refresh);
  await refresh();
}

// ==========================================
// X 탭에 요청 보내기
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

// 확장 프로그램 설치/새로고침 전에 열려 있던 탭에는 content script 가 없으므로 직접 넣음.
// 넣을 파일은 manifest.json 의 content_scripts 에 적힌 것 그대로 (shared/*.js → content.js, styles.css)
async function injectContentScript(tabId) {
  const [contentScript] = chrome.runtime.getManifest().content_scripts;
  await chrome.scripting.insertCSS({ target: { tabId }, files: contentScript.css });
  await chrome.scripting.executeScript({ target: { tabId }, files: contentScript.js });
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

// ==========================================
// [현재 탭에서 가져오기] · [뺀 멤버 정리]
// ==========================================

function setupSyncButtons() {
  const syncBtn = byId('sync-current-tab-btn');
  const resyncBtn = byId('resync-replace-btn');
  const scanBtn = byId('auto-scan-btn');
  syncBtn?.addEventListener('click', () => withButtonDisabled(syncBtn, syncCurrentTab));
  resyncBtn?.addEventListener('click', () => withButtonDisabled(resyncBtn, () => replaceSyncCurrentTab()));
  scanBtn?.addEventListener('click', onAutoScanClick);
  resumeAutoScan();
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

// ==========================================
// [끝까지 스캔]: X 탭이 멤버 목록을 자동으로 스크롤하며 읽고(content.js), 팝업은 진행 상황을 보여 줌.
// 끝나면 [뺀 멤버 정리]와 같은 미리보기 확인 상자를 띄움. 스캔 중에는 버튼이 [스캔 중지]로 바뀜.
// 팝업이 닫혀도 스캔은 X 탭에서 계속되고, 다시 열면 진행 상황(또는 그 사이에 끝난 결과)을 이어서 보여 줌 (resumeAutoScan)
// ==========================================

const AUTO_SCAN_POLL_MS = 600;
let autoScanPolling = false;

function setAutoScanUi(running) {
  const scanBtn = byId('auto-scan-btn');
  const resyncBtn = byId('resync-replace-btn');
  if (scanBtn) {
    scanBtn.textContent = running ? '스캔 중지' : '끝까지 스캔';
    scanBtn.classList.toggle('scanning', running);
  }
  if (resyncBtn) resyncBtn.disabled = running;
}

async function onAutoScanClick() {
  const scanBtn = byId('auto-scan-btn');
  if (autoScanPolling) {
    await requestFromActiveTab({ action: 'autoScanStop' }); // 결과 안내는 진행 상황 확인(pollAutoScan)에서
    return;
  }
  scanBtn.disabled = true;
  try {
    showSyncStatus('멤버 화면을 맨 위부터 스캔합니다...', false, true);
    const response = await requestFromActiveTab({ action: 'autoScanStart' });
    if (response.error || !response.success) {
      showSyncStatus(response.error || response.message || '스캔을 시작하지 못했습니다.', true);
      return;
    }
  } finally {
    scanBtn.disabled = false;
  }
  pollAutoScan();
}

// 팝업을 열 때 X 탭에서 스캔이 진행 중이면 진행 상황을 이어서 보여 줌 (content script 를 새로 넣지는 않음).
// 팝업이 닫힌 사이에 스캔이 끝났거나 멈췄으면, 아직 보여 주지 않은 결과를 보여 줌 (끝났으면 미리보기 확인 상자)
async function resumeAutoScan() {
  const tab = await getTargetTab();
  if (!tab || getSyncTabError(tab)) return;
  const status = await sendTabMessage(tab.id, { action: 'autoScanStatus' }, 1500);
  if (!status || !status.success) return;
  if (status.state === 'running') pollAutoScan();
  else if (status.state !== 'idle' && !status.reported) showAutoScanResult(status);
}

// 스캔이 끝날 때까지 진행 상황을 확인. 끝까지 읽었으면 미리보기 확인 상자로
async function pollAutoScan() {
  if (autoScanPolling) return;
  autoScanPolling = true;
  setAutoScanUi(true);
  let status;
  try {
    for (;;) {
      status = await requestFromActiveTab({ action: 'autoScanStatus' });
      if (status.error || !status.success || status.state !== 'running') break;
      showSyncStatus(`'${status.listName}' 멤버 화면을 스크롤하며 확인 중... ${status.seenCount}명`, false, true);
      await new Promise(resolve => setTimeout(resolve, AUTO_SCAN_POLL_MS));
    }
  } finally {
    autoScanPolling = false;
    setAutoScanUi(false);
  }
  await showAutoScanResult(status);
}

// 스캔 결과 안내. 끝까지 읽었으면 미리보기 확인 상자.
// 보여 준 뒤 X 탭에 알려서 다음에 팝업을 열 때 또 보여 주지 않음 (확인 상자에 답하기 전에 팝업이 닫히면 다음에 다시 보여 줌)
async function showAutoScanResult(status) {
  if (status.error) {
    showSyncStatus(status.error, true);
    return;
  }
  if (status.state === 'done') {
    await replaceSyncCurrentTab({ afterScan: true });
  } else if (status.state === 'idle') {
    showSyncStatus('스캔이 멈췄습니다. 멤버 화면에서 다시 시도해주세요.', true);
    return;
  } else {
    showSyncStatus(status.message || '스캔이 멈췄습니다.', status.state === 'failed');
  }
  await requestFromActiveTab({ action: 'autoScanReported' });
}

// [뺀 멤버 정리]: 미리보기 → 확인 → 저장 (X 리스트에서 뺀 멤버 정리)
// afterScan: [끝까지 스캔]이 끝난 뒤 (확인 상자 문구가 달라짐)
async function replaceSyncCurrentTab({ afterScan = false } = {}) {
  const preview = await requestFromActiveTab({ action: 'replacePreview' });
  if (preview.error || !preview.success) {
    showSyncStatus(preview.error || preview.message || '뺀 멤버 정리를 준비하지 못했습니다.', true);
    return;
  }
  if (preview.removed.length === 0 && preview.added === 0) {
    const done = afterScan ? '끝까지 스캔했습니다. ' : '';
    showSyncStatus(`${done}'${preview.listName}' 멤버 목록이 이미 최신입니다. (${preview.seenCount}명)`, false);
    return;
  }
  if (afterScan) hideSyncStatus();
  if (!await askConfirm(buildReplaceConfirmText(preview, afterScan), '교체')) return;

  const saved = await requestFromActiveTab({ action: 'replaceNow' });
  if (saved.error || !saved.success) {
    showSyncStatus(saved.error || saved.message || '뺀 멤버 정리에 실패했습니다.', true);
    return;
  }
  showSyncStatus(`'${saved.listName}' 멤버를 교체했습니다. 총 ${saved.count}명 (추가 ${saved.added}명, 삭제 ${saved.removedCount}명)`, false);
}

// 교체 확인 문구 (삭제될 핸들 일부를 보여 주고, 절반 이상 삭제되면 강하게 경고)
// afterScan: [끝까지 스캔]으로 맨 위부터 끝까지 읽은 뒤 (스크롤 안내 대신 스캔 결과라고 알림)
function buildReplaceConfirmText(preview, afterScan = false) {
  const removed = preview.removed || [];
  const shown = removed.slice(0, 5).join(', ') + (removed.length > 5 ? ` 외 ${removed.length - 5}명` : '');
  const lines = [];
  if (preview.previousCount > 0 && removed.length * 2 >= preview.previousCount) {
    lines.push(afterScan
      ? `⚠️ 저장된 ${preview.previousCount}명 중 절반 이상이 삭제됩니다. X 리스트의 멤버 수와 맞는지 확인하세요.`
      : `⚠️ 저장된 ${preview.previousCount}명 중 절반 이상이 삭제됩니다. 멤버 화면을 끝까지 스크롤했는지 꼭 확인하세요.`);
  }
  if (afterScan) lines.push('멤버 화면을 맨 위부터 끝까지 스캔했습니다.');
  lines.push(`'${preview.listName}' 멤버를 이번에 멤버 화면에서 확인한 ${preview.seenCount}명으로 교체합니다.`);
  lines.push(`삭제 ${removed.length}명${removed.length ? ': ' + shown : ''} / 추가 ${preview.added}명`);
  if (!afterScan) lines.push('화면에 한 번도 나오지 않은 멤버는 삭제되니, 목록을 끝까지 스크롤한 뒤 진행하세요.');
  return lines.join('\n');
}

// ==========================================
// X 화면 구조 경고
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
