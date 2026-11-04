// popup.html / popup.js E2E: 실제 확장 프로그램 팝업 페이지를 열어 사용자 흐름을 검사
'use strict';

const {
  test, expect, mockXPage, setStorage, getStorage, getLists, openPopup, findXTabId, pointPopupAtTab
} = require('./helpers');

test.describe('팝업 기본 동작', () => {
  test('배지 스타일 설정을 키보드(Tab → Enter/Space)로 열고 닫을 수 있음', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    const header = popup.locator('#toggle-badge-settings');
    expect(await header.evaluate(el => el.tagName)).toBe('BUTTON');

    // Tab 키만으로 머리글까지 이동할 수 있어야 함
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await popup.keyboard.press('Tab');
      reached = await popup.evaluate(() => document.activeElement && document.activeElement.id === 'toggle-badge-settings');
    }
    expect(reached, 'Tab 키로 배지 스타일 설정 머리글에 도달해야 함').toBe(true);

    await popup.keyboard.press('Enter');
    await expect(popup.locator('#badge-settings-body')).toBeVisible();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await popup.keyboard.press('Space');
    await expect(popup.locator('#badge-settings-body')).toBeHidden();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
  });

  test('X 가 아닌 탭에서 [가져오기]를 누르면 "X 페이지가 아닙니다" 안내', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    await popup.click('#sync-current-tab-btn');
    await expect(popup.locator('#sync-status')).toHaveText('현재 탭이 X(Twitter) 페이지가 아닙니다.');
  });

  test('기존 리스트에 직접 추가하면 멤버만 추가되고 색상·모드는 유지', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '테크': { color: '#ff0055', mode: 'highlight', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    await popup.click('#toggle-manual-add-btn');
    await popup.fill('#manual-name', '테크');
    await popup.fill('#manual-members', '@b, c');
    await popup.click('#manual-save-btn');
    await expect(popup.locator('#sync-status')).toContainText("기존 '테크' 리스트에 추가했습니다");

    const lists = await getLists(serviceWorker);
    expect(lists['테크']).toEqual({ color: '#ff0055', mode: 'highlight', members: ['@a', '@b', '@c'] });
  });

  test('"X" 같은 이름도 직접 추가할 수 있고, 팝업을 다시 열어도 남아 있음', async ({ context, extensionId, serviceWorker }) => {
    const popup = await openPopup(context, extensionId);
    await popup.click('#toggle-manual-add-btn');
    await popup.fill('#manual-name', 'X');
    await popup.fill('#manual-members', '@a');
    await popup.click('#manual-save-btn');
    await expect(popup.locator('#sync-status')).toContainText("'X' 리스트가 저장되었습니다");
    await popup.close();

    // 다시 열면 팝업이 데이터를 정제하며 저장하는데, 이때 지워지면 안 됨
    const again = await openPopup(context, extensionId);
    await expect(again.locator('.list-name')).toHaveText(['X']);
    await again.waitForTimeout(300);
    expect((await getLists(serviceWorker))['X']).toMatchObject({ members: ['@a'], manual: true });
  });

  test('리스트 삭제는 팝업 안 확인 상자에서 취소/확인할 수 있음 (브라우저 confirm 사용 안 함)', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '테크': { color: '#1d9bf0', mode: 'normal', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    let nativeDialog = false;
    popup.on('dialog', d => { nativeDialog = true; d.dismiss(); });

    await popup.click('.delete-list-btn');
    await expect(popup.locator('#confirm-box')).toBeVisible();
    await expect(popup.locator('#confirm-text')).toContainText("'테크' 리스트를 삭제할까요?");
    await popup.click('#confirm-cancel-btn');
    await expect(popup.locator('#confirm-box')).toBeHidden();
    expect(Object.keys(await getLists(serviceWorker))).toEqual(['테크']);

    await popup.click('.delete-list-btn');
    await popup.click('#confirm-ok-btn');
    await expect.poll(async () => Object.keys(await getLists(serviceWorker))).toEqual([]);
    await expect(popup.locator('.empty-state')).toBeVisible();
    expect(nativeDialog, '브라우저 기본 대화상자가 뜨면 안 됨').toBe(false);
  });
});

test.describe('백업', () => {
  test('내보내기 파일에 리스트와 배지 설정이 함께 들어감', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { '테크': { color: '#ff0055', mode: 'dim', listId: '7', members: ['@a'] } },
      badgeSettings: { textColor: '#000000', fontSize: 14, fontFamily: 'monospace' }
    });
    const popup = await openPopup(context, extensionId);
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('#export-btn')]);
    const stream = await download.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk;
    const backup = JSON.parse(text);

    expect(backup.app).toBe('banmo_tag');
    expect(backup.lists['테크']).toEqual({ color: '#ff0055', mode: 'dim', listId: '7', members: ['@a'] });
    expect(backup.badgeSettings).toEqual({ textColor: '#000000', fontSize: 14, fontFamily: 'monospace' });
  });

  test('가져오기 → 덮어쓰기는 리스트와 배지 설정을 모두 복원', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '옛 리스트': { color: '#1d9bf0', mode: 'normal', members: ['@old'] } } });
    const popup = await openPopup(context, extensionId);
    const backup = {
      app: 'banmo_tag', backupVersion: 2,
      lists: { '새 리스트': { color: '#00ff00', mode: 'highlight', members: ['@new'] } },
      badgeSettings: { textColor: '#111111', fontSize: 16, fontFamily: 'monospace' }
    };
    await popup.setInputFiles('#import-file', {
      name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))
    });
    await expect(popup.locator('#import-choice')).toBeVisible();
    await expect(popup.locator('#import-choice-text')).toContainText('배지 스타일 설정 포함');
    await popup.click('#import-replace-btn');
    await popup.click('#confirm-ok-btn');
    await expect(popup.locator('#sync-status')).toContainText('리스트 + 배지 설정');

    const stored = await getStorage(serviceWorker, ['lists', 'badgeSettings']);
    expect(Object.keys(stored.lists)).toEqual(['새 리스트']);
    expect(stored.badgeSettings).toEqual({ textColor: '#111111', fontSize: 16, fontFamily: 'monospace' });
    await expect(popup.locator('#badge-font-size')).toHaveValue('16');
  });
});

test.describe('X 화면 구조 변화 경고', () => {
  test('구조 이상이 기록되면 팝업에 경고가 보이고, 해제되면 바로 사라짐', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      structureHealth: { members: { ok: false, message: '멤버 목록에서 사용자 셀(UserCell)을 찾지 못했습니다.', at: Date.now() } }
    });
    const popup = await openPopup(context, extensionId);
    const banner = popup.locator('#health-warning');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('X 화면 구조가 바뀌었을 수 있습니다');
    await expect(banner).toContainText('멤버 수집');

    await setStorage(serviceWorker, { structureHealth: { members: { ok: true, message: '', at: Date.now() } } });
    await expect(banner).toBeHidden();
  });

  test('2주가 지난 경고는 표시하지 않음', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      structureHealth: { timeline: { ok: false, message: 'old', at: Date.now() - 20 * 24 * 60 * 60 * 1000 } }
    });
    const popup = await openPopup(context, extensionId);
    await expect(popup.locator('#health-warning')).toBeHidden();
  });
});

test.describe('팝업 ↔ X 탭 연동', () => {
  test('[가져오기]로 현재 X 탭의 멤버를 즉시 저장', async ({ context, extensionId, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const xPage = await context.newPage();
    await xPage.goto('https://x.com/i/lists/123/members');
    const tabId = await findXTabId(serviceWorker);

    const popup = await openPopup(context, extensionId);
    await pointPopupAtTab(popup, tabId, 'https://x.com/i/lists/123/members');
    await popup.click('#sync-current-tab-btn');
    await expect(popup.locator('#sync-status')).toContainText('총 3명');
  });

  test('[교체 동기화]: 미리보기 확인 상자 → 확인 시 뺀 멤버 삭제', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@alice', '@bob', '@dave_dev', '@gone_user'] } }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const xPage = await context.newPage();
    await xPage.goto('https://x.com/i/lists/123/members');
    await xPage.waitForTimeout(800);
    const tabId = await findXTabId(serviceWorker);

    const popup = await openPopup(context, extensionId);
    await pointPopupAtTab(popup, tabId, 'https://x.com/i/lists/123/members');

    // 취소하면 아무것도 바뀌지 않음
    await popup.click('#resync-replace-btn');
    await expect(popup.locator('#confirm-text')).toContainText('삭제 1명: @gone_user');
    await popup.click('#confirm-cancel-btn');
    expect((await getLists(serviceWorker))['Core Members'].members).toContain('@gone_user');

    // 확인하면 교체
    await popup.click('#resync-replace-btn');
    await expect(popup.locator('#confirm-box')).toBeVisible();
    await popup.click('#confirm-ok-btn');
    await expect(popup.locator('#sync-status')).toContainText('삭제 1명');
    const lists = await getLists(serviceWorker);
    expect(lists['Core Members'].members).toEqual(['@alice', '@bob', '@dave_dev']);
    expect(lists['Core Members'].mode).toBe('dim');
  });

  test('[교체 동기화]: 이미 최신이면 확인 없이 안내만', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'normal', listId: '123', members: ['@alice', '@bob', '@dave_dev'] } }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const xPage = await context.newPage();
    await xPage.goto('https://x.com/i/lists/123/members');
    await xPage.waitForTimeout(800);
    const tabId = await findXTabId(serviceWorker);

    const popup = await openPopup(context, extensionId);
    await pointPopupAtTab(popup, tabId, 'https://x.com/i/lists/123/members');
    await popup.click('#resync-replace-btn');
    await expect(popup.locator('#sync-status')).toContainText('이미 최신입니다');
    await expect(popup.locator('#confirm-box')).toBeHidden();
  });
});
