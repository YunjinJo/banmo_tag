// popup.html / popup.js E2E: 실제 확장 프로그램 팝업 페이지를 열어 사용자 흐름을 검사
'use strict';

const {
  test, expect, mockXPage, setStorage, getStorage, getLists, openPopup, findXTabId, pointPopupAtTab, sendToTab
} = require('./helpers');

// chrome.storage 는 리스트를 이름순으로 돌려주므로, 순서가 아니라 이름으로 카드를 찾음
const listCard = (popup, name) => popup.locator('.list-card')
  .filter({ has: popup.locator('.list-name', { hasText: new RegExp(`^${name}$`) }) });

// 리스트 카드를 눌러 설정 시트를 엶
async function openSheet(popup, name) {
  await listCard(popup, name).click();
  await expect(popup.locator('#list-sheet')).toBeVisible();
  await expect(popup.locator('#sheet-title')).toHaveText(name);
}

test.describe('팝업 기본 동작', () => {
  test('탭(리스트 / 기본 스타일 / 도움말)을 키보드 ← → 로 오갈 수 있음', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    await expect(popup.locator('#panel-lists')).toBeVisible();
    await expect(popup.locator('#panel-style')).toBeHidden();

    // Tab 키만으로 탭 목록까지 이동할 수 있어야 함
    let reached = false;
    for (let i = 0; i < 20 && !reached; i++) {
      await popup.keyboard.press('Tab');
      reached = await popup.evaluate(() => document.activeElement && document.activeElement.id === 'tab-lists');
    }
    expect(reached, 'Tab 키로 [리스트] 탭에 도달해야 함').toBe(true);

    await popup.keyboard.press('ArrowRight');
    await expect(popup.locator('#tab-style')).toBeFocused();
    await expect(popup.locator('#tab-style')).toHaveAttribute('aria-selected', 'true');
    await expect(popup.locator('#badge-settings-body')).toBeVisible();
    await expect(popup.locator('#panel-lists')).toBeHidden();
    await popup.keyboard.press('End');
    await expect(popup.locator('#panel-help')).toBeVisible();
    await popup.keyboard.press('ArrowRight'); // 끝에서 처음으로
    await expect(popup.locator('#panel-lists')).toBeVisible();
    await expect(popup.locator('#tab-style')).toHaveAttribute('tabindex', '-1');
  });

  test('도움말 탭에 적은 [버튼 이름]이 모두 팝업에 실제로 있는 이름과 같음', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '테크': { color: '#0b74c4', mode: 'normal', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    await popup.locator('#tab-help').click();
    await expect(popup.locator('#panel-help')).toBeVisible();
    const helpLabels = await popup.locator('#panel-help strong').evaluateAll(els =>
      els.map(el => el.textContent.trim()).filter(t => /^\[.+\]$/.test(t)).map(t => t.slice(1, -1)));
    expect(helpLabels.length).toBeGreaterThan(5);

    // 팝업에 있는 이름: 버튼·탭 글자, 리스트 설정 창의 버튼, 폰트 목록 마지막 항목, 스캔 중 버튼 글자
    const buttonTexts = () => popup.locator('button').evaluateAll(els => els.map(el => el.textContent.trim()));
    const known = new Set(await buttonTexts());
    await popup.locator('#tab-lists').click();
    await openSheet(popup, '테크');
    for (const text of await buttonTexts()) known.add(text);
    known.add((await popup.locator('#badge-font-family option').last().textContent()).trim());
    known.add('스캔 중지'); // [끝까지 스캔]을 누르면 바뀌는 글자 (popup/sync.js)
    known.add('다른 폰트 직접 입력…'); // 파이어폭스의 폰트 목록 마지막 항목 (tests/firefox 에서 확인)

    const missing = helpLabels.filter(label => !known.has(label));
    expect(missing, '도움말에 적었지만 팝업에 없는 버튼 이름').toEqual([]);
  });

  test('리스트 탭 맨 아래 크레딧: YURO 는 제작자 X 프로필, GitHub 은 저장소로 새 탭에서 열림 (다른 탭에는 없음)', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    const credit = popup.locator('#panel-lists .credit');
    await expect(credit).toBeVisible();
    await expect(credit).toContainText('Made by YURO · GitHub');

    const author = popup.locator('#credit-author');
    const github = popup.locator('#credit-github');
    await expect(author).toHaveAttribute('href', 'https://x.com/YunjinJo98');
    await expect(github).toHaveAttribute('href', 'https://github.com/YunjinJo/banmo_tag');
    for (const link of [author, github]) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }

    // 누르면 팝업은 그대로 두고 새 탭이 열림 (x.com 은 테스트에서 가짜 응답)
    const [newTab] = await Promise.all([context.waitForEvent('page'), author.click()]);
    await expect.poll(() => newTab.url()).toBe('https://x.com/YunjinJo98');
    expect(popup.url()).toContain('popup.html');

    await popup.click('#tab-style');
    await expect(credit).toBeHidden();
  });

  test('X 가 아닌 탭에서 [현재 탭에서 가져오기]를 누르면 "X 페이지가 아닙니다" 안내', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    await popup.click('#sync-current-tab-btn');
    await expect(popup.locator('#sync-status')).toHaveText('현재 탭이 X(Twitter) 페이지가 아닙니다.');
    await expect(popup.locator('#sync-status')).toBeVisible();
  });

  test('안내 메시지의 닫기 버튼(마우스·키보드)을 누르면 바로 사라지고, 다음 안내는 다시 보임', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    const status = popup.locator('#sync-status');
    const closeBtn = popup.getByRole('button', { name: '안내 닫기' });
    await expect(closeBtn).toBeHidden(); // 안내가 없을 때는 버튼도 없음

    await popup.click('#sync-current-tab-btn');
    await expect(status).toBeVisible();
    await closeBtn.click();
    await expect(status).toBeHidden();

    await popup.click('#sync-current-tab-btn');
    await expect(status).toHaveText('현재 탭이 X(Twitter) 페이지가 아닙니다.');
    await closeBtn.focus();
    await popup.keyboard.press('Enter');
    await expect(status).toBeHidden();
    expect(await popup.evaluate(() => document.activeElement.id)).not.toBe('sync-status-close-btn');
  });

  test('기존 리스트에 직접 추가하면 멤버만 추가되고 색상·모드는 유지', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '테크': { color: '#ff0055', mode: 'highlight', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    await popup.click('#toggle-manual-add-btn');
    await expect(popup.locator('#manual-name')).toBeFocused();
    await popup.fill('#manual-name', '테크');
    await popup.fill('#manual-members', '@b, c');
    await popup.click('#manual-save-btn');
    await expect(popup.locator('#sync-status')).toContainText("기존 '테크' 리스트에 추가했습니다");

    const lists = await getLists(serviceWorker);
    expect(lists['테크']).toEqual({ color: '#ff0055', mode: 'highlight', members: ['@a', '@b', '@c'] });
    await expect(listCard(popup, '테크').locator('.list-count')).toHaveText('3명');
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

  test('리스트 카드에 배지·멤버 수·요약이 보이고, 정렬(이름순 / 멤버 수)을 바꾸면 저장됨', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: {
        '친구': { color: '#c8174d', mode: 'highlight', members: ['@alice', '@bob', '@carol'], style: { fontFamily: 'monospace' } },
        'AI': { color: '#7a3fd1', mode: 'normal', members: ['@x1', '@x2', '@x3', '@x4'] },
        '뉴스': { color: '#0b74c4', mode: 'dim', members: ['@n1', '@n2', '@n3', '@n4', '@n5'] }
      }
    });
    const popup = await openPopup(context, extensionId);
    await expect(popup.locator('#list-count')).toHaveText('3');
    await expect(popup.locator('.list-name')).toHaveText(['뉴스', '친구', 'AI']); // 한국어 정렬: 한글 먼저
    const friend = listCard(popup, '친구');
    // 줄에는 멤버 요약과 "개별 스타일"만 보이고, 타임라인 표시(강조 등)는 보이지 않음
    await expect(friend.locator('.list-info')).toHaveText('@alice, @bob 외 1명');
    await expect(friend.locator('.list-custom')).toHaveText('개별 스타일');
    await expect(friend).not.toContainText('강조');
    await expect(listCard(popup, 'AI').locator('.list-custom')).toHaveCount(0);
    await expect(listCard(popup, 'AI').locator('.list-count')).toHaveText('4명'); // 화면에는 4, 읽기 프로그램에는 "4명"
    await expect(popup.locator('#list-columns')).toBeVisible();
    await expect(popup.locator('#list-hint')).toBeVisible();
    await expect(friend.locator('.list-name')).toHaveCSS('background-color', 'rgb(200, 23, 77)');
    await expect(friend.locator('.list-name')).toHaveCSS('font-family', 'monospace');

    await popup.selectOption('#list-sort', 'members');
    await expect(popup.locator('.list-name')).toHaveText(['뉴스', 'AI', '친구']); // 5명, 4명, 3명
    await expect.poll(async () => (await getStorage(serviceWorker, ['uiSettings'])).uiSettings).toEqual({ theme: 'system', listSort: 'members' });

    const again = await openPopup(context, extensionId);
    await expect(again.locator('#list-sort')).toHaveValue('members');
    await expect(again.locator('.list-name')).toHaveText(['뉴스', 'AI', '친구']);
  });

  test('⋯ 메뉴: 열면 첫 항목에 포커스, Esc·바깥 클릭으로 닫힘', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    const menu = popup.locator('#app-menu');
    await expect(menu).toBeHidden();
    await popup.click('#menu-btn');
    await expect(menu).toBeVisible();
    await expect(popup.locator('#menu-btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(popup.locator('#export-btn')).toBeFocused();
    await popup.keyboard.press('ArrowDown');
    await expect(popup.locator('#import-btn')).toBeFocused();
    await popup.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(popup.locator('#menu-btn')).toBeFocused();

    await popup.click('#menu-btn');
    await popup.click('h2'); // 바깥
    await expect(menu).toBeHidden();
  });
});

test.describe('화면 테마 (시스템 / 라이트 / 다크)', () => {
  const bg = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  test('기본은 시스템 설정을 따름 (운영체제가 다크면 다크, 라이트면 라이트)', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    await expect(popup.locator('#theme-system')).toBeChecked();
    await popup.emulateMedia({ colorScheme: 'dark' });
    expect(await bg(popup)).toBe('rgb(15, 15, 17)');
    await popup.emulateMedia({ colorScheme: 'light' });
    expect(await bg(popup)).toBe('rgb(255, 255, 255)');
    expect(await popup.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  });

  test('직접 고른 테마는 시스템 설정보다 우선하고, 저장되어 다음에 열 때 첫 화면부터 적용됨', async ({ context, extensionId, serviceWorker }) => {
    const popup = await openPopup(context, extensionId);
    await popup.emulateMedia({ colorScheme: 'light' });
    await popup.click('#tab-style');
    await popup.locator('#theme-dark').check();
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await bg(popup)).toBe('rgb(15, 15, 17)');
    await expect.poll(async () => (await getStorage(serviceWorker, ['uiSettings'])).uiSettings).toEqual({ theme: 'dark', listSort: 'name' });

    // 다시 열 때: popup.js 가 chrome.storage 를 읽기 전(theme.js 시점)에 이미 다크여야 함 (깜빡임 없음)
    const again = await context.newPage();
    await again.emulateMedia({ colorScheme: 'light' });
    await again.route('**/popup.js', route => route.abort()); // popup.js 없이 theme.js 만으로
    await again.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(again.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await bg(again)).toBe('rgb(15, 15, 17)');

    // 라이트로 고정하면 운영체제가 다크여도 라이트
    await popup.emulateMedia({ colorScheme: 'dark' });
    await popup.locator('#theme-light').check();
    expect(await bg(popup)).toBe('rgb(255, 255, 255)');
    // 시스템으로 되돌리면 운영체제 설정(다크)을 따름
    await popup.locator('#theme-system').check();
    await expect(popup.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await bg(popup)).toBe('rgb(15, 15, 17)');
  });

  test('다른 창에서 테마를 바꾸면 열려 있는 화면에도 바로 반영', async ({ context, extensionId, serviceWorker }) => {
    const popup = await openPopup(context, extensionId);
    await setStorage(serviceWorker, { uiSettings: { theme: 'dark', listSort: 'name' } });
    await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(popup.locator('#theme-dark')).toBeChecked();
  });
});

test.describe('리스트 설정 시트', () => {
  const COMMON = { textColor: '#ffffff', fontSize: 11, fontFamily: 'system' };

  test('카드를 누르면 시트가 열리고, Esc·닫기·바깥을 누르면 닫히며 포커스는 카드로 돌아감', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '친구': { color: '#ff0000', mode: 'normal', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    await expect(popup.locator('#sheet-close-btn')).toBeFocused();
    await expect(listCard(popup, '친구')).toHaveClass(/is-open/);
    // 시트가 열려 있는 동안 뒤 화면은 조작할 수 없음
    expect(await popup.evaluate(() => document.getElementById('app').inert)).toBe(true);

    await popup.keyboard.press('Escape');
    await expect(popup.locator('#list-sheet')).toBeHidden();
    await expect(listCard(popup, '친구')).toBeFocused();
    expect(await popup.evaluate(() => document.getElementById('app').inert)).toBe(false);

    await openSheet(popup, '친구');
    await popup.click('#sheet-close-btn');
    await expect(popup.locator('#list-sheet')).toBeHidden();
    await openSheet(popup, '친구');
    await popup.mouse.click(180, 20); // 시트 위쪽 어두운 배경
    await expect(popup.locator('#list-sheet')).toBeHidden();
  });

  test('[이름 바꾸기]: 색·표시 방식·글자 스타일·멤버는 그대로 새 이름으로 옮기고, 시트는 열린 채 새 이름을 보여 줌', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: {
        '친구': { color: '#ff0000', mode: 'highlight', listId: '123', members: ['@alice', '@bob'], style: { fontSize: 14 } },
        '동료': { color: '#00aa00', mode: 'normal', members: ['@carol'] }
      }
    });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    const toggle = popup.locator('#sheet-rename-toggle-btn');
    const input = popup.locator('#sheet-name-input');
    await expect(input).toHaveCount(0); // 처음에는 접혀 있음

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('닫기');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('친구');
    await expect(popup.locator('#sheet-rename-btn')).toBeDisabled(); // 지금 이름 그대로는 저장할 수 없음

    // 이미 있는 이름이면 안내하고 아무것도 바꾸지 않음. 입력하던 글자는 그대로
    await input.fill('동료');
    await popup.click('#sheet-rename-btn');
    await expect(popup.locator('#sync-status')).toContainText("'동료' 리스트가 이미 있습니다");
    expect(Object.keys(await getLists(serviceWorker)).sort()).toEqual(['동료', '친구']);
    await expect(input).toHaveValue('동료');

    // 다른 설정을 바꿔 시트가 다시 그려져도 입력하던 글자가 남아 있음
    await input.fill('  단짝 ');
    await popup.locator('#sheet-mode-dim').check();
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].mode).toBe('dim');
    await expect(input).toHaveValue('  단짝 ');

    await input.press('Enter');
    await expect.poll(async () => Object.keys(await getLists(serviceWorker)).sort()).toEqual(['단짝', '동료']);
    expect((await getLists(serviceWorker))['단짝']).toEqual({
      color: '#ff0000', mode: 'dim', listId: '123', members: ['@alice', '@bob'], style: { fontSize: 14 }, customName: true
    });

    // 시트는 닫히지 않고 새 이름을 보여 주며, 입력란은 접힘
    await expect(popup.locator('#sheet-title')).toHaveText('단짝');
    await expect(popup.locator('#list-sheet')).toBeVisible();
    await expect(input).toHaveCount(0);
    await expect(toggle).toHaveText('이름 바꾸기');
    await expect(toggle).toBeFocused();
    await expect(popup.locator('#sync-status')).toHaveText("리스트 이름을 '단짝'(으)로 바꿨습니다.");
    await expect(listCard(popup, '단짝')).toHaveClass(/is-open/);
    await expect(listCard(popup, '친구')).toHaveCount(0);
  });

  test('[이름 바꾸기]: 직접 지은 이름에는 [X 이름 따르기]가 보이고, 누르면 직접 지은 이름 표시를 지움', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: {
        '단짝': { color: '#ff0000', mode: 'normal', listId: '123', members: ['@alice'], customName: true },
        '메모': { color: '#00aa00', mode: 'normal', members: ['@bob'], manual: true }
      }
    });
    const popup = await openPopup(context, extensionId);

    // X 에서 가져온 리스트가 아니면(리스트 ID 없음) X 이름 안내가 없음
    await openSheet(popup, '메모');
    await popup.click('#sheet-rename-toggle-btn');
    await expect(popup.locator('#sheet-name-input')).toBeVisible();
    await expect(popup.locator('.name-note')).toHaveCount(0);
    await popup.click('#sheet-close-btn');

    await openSheet(popup, '단짝');
    await expect(popup.locator('#sheet-name-input')).toHaveCount(0); // 다른 리스트를 열면 다시 접힌 상태
    await popup.click('#sheet-rename-toggle-btn');
    await expect(popup.locator('.name-note')).toContainText('직접 지은 이름');
    await popup.click('#sheet-name-follow-btn');
    await expect.poll(async () => (await getLists(serviceWorker))['단짝'].customName).toBeUndefined();
    await expect(popup.locator('#sheet-name-follow-btn')).toHaveCount(0);
    await expect(popup.locator('.name-note')).toContainText('X 에서 리스트 이름을 바꾸면');
    await expect(popup.locator('#list-sheet')).toBeVisible();
  });

  test('배지 색(빠른 선택·직접 고르기)과 타임라인 표시(배지만/강조/흐리게)를 바꾸면 저장되고 미리보기에 반영', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '친구': { color: '#ff0000', mode: 'normal', members: ['@alice'] } } });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    // [다른 색] 버튼이 글자와 함께 보이고, 빠른 선택에 없는 색이면 선택 표시 + 점에 그 색
    const customBtn = popup.locator('.swatch-custom-btn');
    await expect(customBtn).toBeVisible();
    await expect(customBtn).toContainText('다른 색');
    await expect(customBtn).toHaveClass(/is-selected/);
    await expect(customBtn.locator('.swatch-custom-dot')).toHaveCSS('background-color', 'rgb(255, 0, 0)');

    await popup.click('#sheet-swatch-2'); // 초록
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].color).toBe('#0f7b3e');
    await expect(popup.locator('#sheet-swatch-2')).toHaveAttribute('aria-pressed', 'true');
    await expect(popup.locator('#sheet-swatch-2')).toBeFocused(); // 다시 그린 뒤에도 포커스 유지
    await expect(popup.locator('.list-style-preview')).toHaveCSS('background-color', 'rgb(15, 123, 62)');
    await expect(listCard(popup, '친구').locator('.list-name')).toHaveCSS('background-color', 'rgb(15, 123, 62)');
    // 빠른 선택 색을 쓰면 [다른 색]은 선택 표시 없이 무지개 점
    await expect(customBtn).not.toHaveClass(/is-selected/);
    await expect(customBtn.locator('.swatch-custom-dot')).toHaveCSS('background-image', /conic-gradient/);
    // 버튼의 어느 곳(글자 위)을 눌러도 색상 입력란이 눌려 색상 창이 열림
    expect(await customBtn.evaluate((btn) => {
      const r = btn.querySelector('span:not(.swatch-custom-dot)').getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2).id;
    })).toBe('sheet-color-custom');

    await popup.locator('#sheet-color-custom').evaluate((el) => { el.value = '#123456'; el.dispatchEvent(new Event('change')); });
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].color).toBe('#123456');

    await popup.locator('#sheet-mode-highlight').check();
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].mode).toBe('highlight');
    await expect(popup.locator('.tweet-preview')).toHaveCSS('box-shadow', /rgb\(18, 52, 86\)/);
    await expect(listCard(popup, '친구')).not.toContainText('강조'); // 표시 방식은 줄에 쓰지 않음

    await popup.locator('#sheet-mode-dim').check();
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].mode).toBe('dim');
    await expect(popup.locator('.tweet-preview .tweet-text')).toHaveCSS('opacity', '0.45');
    await expect(popup.locator('.tweet-preview .tweet-name')).toHaveCSS('opacity', '1');
  });

  test('글자 크기·색상·폰트를 그 리스트만 따로 저장하고, [공통 설정 따르기]로 되돌림', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: {
        '친구': { color: '#ff0000', mode: 'normal', members: ['@a'] },
        '동료': { color: '#00aa00', mode: 'normal', members: ['@b'] }
      },
      badgeSettings: COMMON
    });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    const size = popup.locator('#sheet-font-size');
    await expect(size).toHaveValue('11'); // 공통 설정 값이 보임
    await expect(popup.locator('#list-sheet .list-style-state')).toHaveText('공통 설정 사용 중');

    await size.selectOption('16');
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].style).toEqual({ fontSize: 16 });
    await expect(listCard(popup, '친구').locator('.list-custom')).toHaveText('개별 스타일');
    // 다시 그린 뒤에도 시트와 값이 유지됨
    await expect(size).toHaveValue('16');
    await expect(popup.locator('.list-style-preview')).toHaveCSS('font-size', '16px');
    await expect(popup.locator('#list-sheet .list-style-state')).toHaveText('이 리스트만 따로 설정됨');

    await popup.locator('#sheet-text-color').evaluate((el) => { el.value = '#000000'; el.dispatchEvent(new Event('change')); });
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].style).toEqual({ textColor: '#000000', fontSize: 16 });
    await popup.locator('#sheet-font-family').selectOption('monospace');
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].style)
      .toEqual({ textColor: '#000000', fontSize: 16, fontFamily: 'monospace' });
    // 다른 리스트에는 영향 없음
    expect((await getLists(serviceWorker))['동료'].style).toBeUndefined();
    await expect(popup.locator('#badge-custom-count')).toHaveText('개별 스타일을 쓰는 리스트 1개');

    await popup.click('#sheet-style-reset-btn');
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].style).toBeUndefined();
    await expect(size).toHaveValue('11');
    await expect(popup.locator('#list-sheet .list-style-state')).toHaveText('공통 설정 사용 중');
    await expect(popup.locator('#sheet-style-reset-btn')).toBeDisabled();
  });

  test('[멤버 N명 보기]로 멤버를 보고 지울 수 있음', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '친구': { color: '#ff0000', mode: 'normal', members: ['@a', '@b', '@c'] } } });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    await expect(popup.locator('#sheet-members')).toHaveCount(0);
    await popup.click('#sheet-members-btn');
    await expect(popup.locator('#sheet-members-btn')).toHaveAttribute('aria-expanded', 'true');
    await expect(popup.locator('#sheet-members .member-handle')).toHaveCount(3);

    await popup.getByRole('button', { name: "'@b' 제거" }).click();
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].members).toEqual(['@a', '@c']);
    await expect(popup.locator('#sheet-members .member-handle')).toHaveCount(2); // 펼침 유지
    await expect(popup.locator('#sheet-count')).toHaveText('2명');
  });

  test('리스트 삭제는 확인 상자에서 취소/확인할 수 있음 (브라우저 confirm 사용 안 함)', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '테크': { color: '#1d9bf0', mode: 'normal', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    let nativeDialog = false;
    popup.on('dialog', d => { nativeDialog = true; d.dismiss(); });

    await openSheet(popup, '테크');
    await popup.click('#sheet-delete-btn');
    await expect(popup.locator('#confirm-box')).toBeVisible();
    await expect(popup.locator('#confirm-text')).toContainText("'테크' 리스트를 삭제할까요?");
    await expect(popup.locator('#confirm-ok-btn')).toBeFocused();
    await popup.click('#confirm-cancel-btn');
    await expect(popup.locator('#confirm-box')).toBeHidden();
    await expect(popup.locator('#sheet-delete-btn')).toBeFocused(); // 포커스가 원래 버튼으로
    expect(Object.keys(await getLists(serviceWorker))).toEqual(['테크']);

    await popup.click('#sheet-delete-btn');
    await popup.click('#confirm-ok-btn');
    await expect.poll(async () => Object.keys(await getLists(serviceWorker))).toEqual([]);
    await expect(popup.locator('.empty-state')).toBeVisible();
    await expect(popup.locator('#list-columns')).toBeHidden(); // 빈 표에는 칸 이름·안내 없음
    await expect(popup.locator('#list-hint')).toBeHidden();
    await expect(popup.locator('#list-sheet')).toBeHidden(); // 지운 리스트의 시트는 닫힘
    expect(nativeDialog, '브라우저 기본 대화상자가 뜨면 안 됨').toBe(false);
  });

  test('[이 스타일을 모든 리스트에 적용]: 공통 설정이 그 스타일로 바뀌고 다른 리스트의 개별 스타일은 지워짐', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: {
        '친구': { color: '#ff0000', mode: 'normal', members: ['@a'], style: { fontSize: 18, fontFamily: 'monospace' } },
        '동료': { color: '#00aa00', mode: 'normal', members: ['@b'], style: { textColor: '#123456' } },
        '가족': { color: '#0000ff', mode: 'normal', members: ['@c'] }
      },
      badgeSettings: COMMON
    });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    await popup.click('#sheet-style-apply-all-btn');
    await expect(popup.locator('#confirm-text')).toContainText("'친구' 리스트의 글자 스타일을 모든 리스트에 적용할까요?");
    await popup.click('#confirm-ok-btn');
    await expect(popup.locator('#sync-status')).toContainText('모든 리스트에 적용했습니다');

    const stored = await getStorage(serviceWorker, ['lists', 'badgeSettings']);
    expect(stored.badgeSettings).toEqual({ textColor: '#ffffff', fontSize: 18, fontFamily: 'monospace' });
    expect(Object.values(stored.lists).map(l => l.style)).toEqual([undefined, undefined, undefined]);
    await expect(popup.locator('#badge-font-size')).toHaveValue('18');
    await expect(popup.locator('#badge-custom-count')).toHaveText('모든 리스트가 공통 스타일 사용 중');
  });

  test('팝업을 열면 시트가 저장된 공통 설정 값을 보여 줌', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { '친구': { color: '#ff0000', mode: 'normal', members: ['@a'] } },
      badgeSettings: { textColor: '#333333', fontSize: 14, fontFamily: 'monospace' }
    });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    await expect(popup.locator('#sheet-font-size')).toHaveValue('14');
    await expect(popup.locator('#sheet-font-family')).toHaveValue('monospace');
    await expect(popup.locator('#sheet-text-color')).toHaveValue('#333333');
  });
});

test.describe('배지 기본 스타일 (기본 스타일 탭)', () => {
  test('글자 크기·폰트를 바꾸면 저장되고, 리스트 카드 배지에도 반영', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '친구': { color: '#ff0000', mode: 'normal', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    await popup.click('#tab-style');
    await popup.selectOption('#badge-font-size', '15');
    await popup.selectOption('#badge-font-family', 'monospace');
    await expect.poll(async () => (await getStorage(serviceWorker, ['badgeSettings'])).badgeSettings)
      .toEqual({ textColor: '#ffffff', fontSize: 15, fontFamily: 'monospace' });
    await expect(popup.locator('#badge-preview')).toHaveCSS('font-size', '15px');
    await expect(listCard(popup, '친구').locator('.list-name')).toHaveCSS('font-size', '15px');

    await popup.click('#badge-reset-btn');
    await expect.poll(async () => (await getStorage(serviceWorker, ['badgeSettings'])).badgeSettings.fontSize).toBe(11);
  });

  test('공통 설정 [모든 리스트에 적용]: 개별 스타일을 모두 지움 (없으면 안내만)', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: {
        '친구': { color: '#ff0000', mode: 'normal', members: ['@a'], style: { fontSize: 18 } },
        '동료': { color: '#00aa00', mode: 'normal', members: ['@b'], style: { textColor: '#123456' } }
      },
      badgeSettings: { textColor: '#eeeeee', fontSize: 13, fontFamily: 'system' }
    });
    const popup = await openPopup(context, extensionId);
    await popup.click('#tab-style');
    await expect(popup.locator('#badge-custom-count')).toHaveText('개별 스타일을 쓰는 리스트 2개');
    await popup.click('#badge-apply-all-btn');
    await expect(popup.locator('#confirm-text')).toContainText('리스트 2개의 개별 글자 스타일을 지우고');
    await popup.click('#confirm-ok-btn');
    await expect(popup.locator('#sync-status')).toContainText('개별 스타일 2개 해제');
    await expect(popup.locator('#sync-status')).toBeVisible(); // 다른 탭에서도 보이는 알림

    const stored = await getStorage(serviceWorker, ['lists', 'badgeSettings']);
    expect(Object.values(stored.lists).map(l => l.style)).toEqual([undefined, undefined]);
    expect(stored.badgeSettings).toEqual({ textColor: '#eeeeee', fontSize: 13, fontFamily: 'system' }, '공통 설정은 그대로');

    await popup.click('#badge-apply-all-btn');
    await expect(popup.locator('#sync-status')).toHaveText('이미 모든 리스트가 공통 스타일을 사용하고 있습니다.');
    await expect(popup.locator('#confirm-box')).toBeHidden();
  });
});

test.describe('설치된 폰트 고르기 · 다른 폰트 직접 입력', () => {
  const ONE_LIST = { '친구': { color: '#ff0000', mode: 'normal', members: ['@a'] }, '동료': { color: '#00aa00', mode: 'normal', members: ['@b'] } };

  // 크롬의 설치 폰트 목록(window.queryLocalFonts)과 그 권한 상태를 흉내 냄. 부른 횟수는 window.__fontQueries.
  // state: 권한 상태, fonts: 돌려줄 목록, tabFonts: 새 탭 화면(?view=tab)에서 돌려줄 목록 (권한 창에서 [허용]을 누른 경우)
  async function fakeLocalFonts(context, { state, fonts = [], tabFonts = fonts }) {
    await context.addInitScript(({ state, fonts, tabFonts }) => {
      const original = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = d => (d && d.name === 'local-fonts' ? Promise.resolve({ state }) : original(d));
      window.__fontQueries = 0;
      window.queryLocalFonts = async () => {
        window.__fontQueries++;
        return location.search.includes('view=tab') ? tabFonts : fonts;
      };
    }, { state, fonts, tabFonts });
  }

  // 실제 크롬의 "글꼴" 권한을 이 확장 프로그램에 허용 (권한 창 [허용]과 같은 상태).
  // Playwright 의 grantPermissions 는 chrome-extension 주소를 "null" 로 바꿔 버려서 CDP 로 직접 보냄
  async function grantLocalFonts(page, extensionId) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Browser.setPermission', { origin: `chrome-extension://${extensionId}`, permission: { name: 'local-fonts' }, setting: 'granted' });
  }

  const visibleOptions = popup => popup.locator('#font-list .font-option:visible');

  test('공통 설정: [설치된 폰트에서 고르기…] 창에서 이름을 직접 적어 저장하고, 고를 수 있는 폰트로 다시 바꿀 수 있음', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: ONE_LIST });
    const popup = await openPopup(context, extensionId);
    await popup.click('#tab-style');
    const select = popup.locator('#badge-font-family');
    await expect(select.locator('option').last()).toHaveText('설치된 폰트에서 고르기…');
    await select.selectOption('custom:');
    await expect(popup.locator('#font-dialog')).toBeVisible();
    await expect(popup.locator('#font-dialog-title')).toHaveText('설치된 폰트 고르기');
    await expect(select).toHaveValue('system', { message: '창을 여는 항목은 고른 값으로 남지 않음' });
    await expect(popup.locator('#font-dialog-target')).toHaveText('모든 리스트 배지에 쓸 기본 폰트');
    await expect(popup.locator('#font-name-input')).toBeFocused();
    await expect(popup.locator('#font-ok-btn')).toBeDisabled();
    // 아직 권한을 묻지 않은 크롬 팝업: 목록 대신 권한 안내
    await expect(popup.locator('#font-permission')).toBeVisible();
    await expect(popup.locator('#font-load-btn')).toHaveText('새 탭에서 권한 허용하기');

    // 쓸 수 없는 글자 → 저장 불가
    await popup.fill('#font-name-input', "Bad'; color: red");
    await expect(popup.locator('#font-check')).toHaveClass(/error/);
    await expect(popup.locator('#font-ok-btn')).toBeDisabled();

    // 설치되지 않은 이름: 안내는 하지만 저장은 됨 (다른 컴퓨터에는 있을 수 있음)
    await popup.fill('#font-name-input', '  No Such Font  Banmo ');
    await expect(popup.locator('#font-check')).toHaveClass(/warn/);
    await expect(popup.locator('#font-check')).toContainText('찾지 못했습니다');
    await expect(popup.locator('#font-dialog-preview')).toHaveCSS('font-family', /No Such Font Banmo/);
    await popup.click('#font-ok-btn');
    await expect(popup.locator('#font-dialog')).toBeHidden();
    await expect(select).toBeFocused();
    await expect.poll(async () => (await getStorage(serviceWorker, ['badgeSettings'])).badgeSettings)
      .toEqual({ textColor: '#ffffff', fontSize: 11, fontFamily: "'No Such Font Banmo', sans-serif" });
    await expect(select).toHaveValue("'No Such Font Banmo', sans-serif");
    await expect(select.locator('option:checked')).toHaveText('No Such Font Banmo');
    await expect(popup.locator('#badge-preview')).toHaveCSS('font-family', /No Such Font Banmo/);
    await popup.click('#tab-lists');
    await expect(listCard(popup, '친구').locator('.list-name')).toHaveCSS('font-family', /No Such Font Banmo/);

    // 다시 열면 지금 이름이 들어 있고, 고를 수 있는 폰트로 바꾸면 직접 입력 항목은 목록에서 빠짐
    await popup.click('#tab-style');
    await select.selectOption('custom:');
    await expect(popup.locator('#font-name-input')).toHaveValue('No Such Font Banmo');
    await popup.keyboard.press('Escape');
    await expect(popup.locator('#font-dialog')).toBeHidden();
    await select.selectOption('monospace');
    await expect.poll(async () => (await getStorage(serviceWorker, ['badgeSettings'])).badgeSettings.fontFamily).toBe('monospace');
    await expect(select.locator('option', { hasText: 'No Such Font Banmo' })).toHaveCount(0);
  });

  test('리스트 시트: 그 리스트만 직접 입력한 폰트를 쓰고(Enter 로 적용), 취소하면 그대로', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: ONE_LIST });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    await popup.locator('#sheet-font-family').selectOption('custom:');
    await expect(popup.locator('#font-dialog-target')).toHaveText("'친구' 리스트 배지에 쓸 폰트");
    await expect(popup.locator('#font-dialog-preview')).toHaveText('친구');
    await expect(popup.locator('#list-sheet')).toHaveJSProperty('inert', true);

    await popup.fill('#font-name-input', 'Banmo Cancel Font');
    await popup.click('#font-cancel-btn');
    await expect(popup.locator('#font-dialog')).toBeHidden();
    expect((await getLists(serviceWorker))['친구'].style).toBeUndefined();

    await popup.locator('#sheet-font-family').selectOption('custom:');
    await popup.fill('#font-name-input', 'Banmo List Font');
    await popup.press('#font-name-input', 'Enter');
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].style).toEqual({ fontFamily: "'Banmo List Font', sans-serif" });
    expect((await getLists(serviceWorker))['동료'].style).toBeUndefined();
    await expect(popup.locator('#sheet-font-family')).toHaveValue("'Banmo List Font', sans-serif");
    await expect(popup.locator('.list-style-preview')).toHaveCSS('font-family', /Banmo List Font/);
    await expect(popup.locator('#list-sheet .list-style-state')).toHaveText('이 리스트만 따로 설정됨');
  });

  test('크롬: 권한이 있으면 창을 열자마자 설치된 폰트 목록이 나오고, 검색 · ↑↓ · Enter 로 고름', async ({ context, extensionId, serviceWorker }) => {
    await fakeLocalFonts(context, {
      state: 'granted',
      fonts: [{ family: 'Banmo Test Sans', style: 'Regular' }, { family: 'Banmo Test Sans', style: 'Bold' }, { family: '반모 고딕' }, { family: 'Banmo Serif' }]
    });
    await setStorage(serviceWorker, { lists: ONE_LIST });
    const popup = await openPopup(context, extensionId);
    await popup.click('#tab-style');
    await popup.locator('#badge-font-family').selectOption('custom:');

    // 버튼을 누르지 않아도 목록이 나옴. 굵기별 항목은 하나로, 보기 글자는 그 폰트로
    await expect(popup.locator('#font-list .font-option')).toHaveCount(3);
    await expect(popup.locator('#font-permission')).toBeHidden();
    await expect(popup.locator('#font-browser-note')).toBeHidden();
    await expect(popup.locator('#font-list-count')).toHaveText('설치된 폰트 3개');
    await expect(popup.locator('#font-name-input')).toHaveAttribute('aria-expanded', 'true');
    const testSans = popup.locator('#font-list .font-option', { hasText: 'Banmo Test Sans' });
    await expect(testSans.locator('.font-option-sample')).toHaveCSS('font-family', /^"Banmo Test Sans", sans-serif$/);

    // 공백·대소문자 무시 검색: 같은 폰트면 그 줄을 고르고, 적용할 때는 실제 이름을 씀
    await popup.fill('#font-name-input', 'banmo');
    await expect(visibleOptions(popup)).toHaveCount(2);
    await expect(popup.locator('#font-list-count')).toHaveText('설치된 폰트 3개 중 2개');
    await popup.fill('#font-name-input', 'banmotestsans');
    await expect(visibleOptions(popup)).toHaveCount(1);
    await expect(testSans).toHaveAttribute('aria-selected', 'true');
    await expect(popup.locator('#font-check')).toHaveText("이 컴퓨터에 설치된 폰트 'Banmo Test Sans'(으)로 적용합니다.");
    await expect(popup.locator('#font-dialog-preview')).toHaveCSS('font-family', /Banmo Test Sans/);
    await popup.fill('#font-name-input', 'Banmo Test Sans');
    await expect(popup.locator('#font-check')).toHaveText('이 컴퓨터에 설치된 폰트입니다.');
    await popup.fill('#font-name-input', 'zzz');
    await expect(popup.locator('#font-list-empty')).toBeVisible();

    // ↑↓ 는 보이는 줄 사이를 옮기며 입력란에 이름을 넣고(거르기는 그대로), Enter 로 적용
    await popup.fill('#font-name-input', 'banmo');
    await popup.keyboard.press('ArrowDown');
    await expect(popup.locator('#font-name-input')).toHaveValue('Banmo Serif');
    await popup.keyboard.press('ArrowDown');
    await expect(popup.locator('#font-name-input')).toHaveValue('Banmo Test Sans');
    await expect(visibleOptions(popup)).toHaveCount(2);
    await expect(popup.locator('#font-dialog-preview')).toHaveCSS('font-family', /Banmo Test Sans/);
    await popup.keyboard.press('Enter');
    await expect.poll(async () => (await getStorage(serviceWorker, ['badgeSettings'])).badgeSettings?.fontFamily).toBe("'Banmo Test Sans', sans-serif");

    // 다시 열면 다시 묻지 않고 같은 목록, 지금 폰트가 골라져 있음
    await popup.locator('#badge-font-family').selectOption('custom:');
    await expect(testSans).toHaveAttribute('aria-selected', 'true');
    await expect(visibleOptions(popup)).toHaveCount(3);
    expect(await popup.evaluate(() => window.__fontQueries)).toBe(1);

    // 공백 없이 적고 Enter 해도 실제 이름으로 저장
    await popup.fill('#font-name-input', '반모고딕');
    await popup.keyboard.press('Enter');
    await expect.poll(async () => (await getStorage(serviceWorker, ['badgeSettings'])).badgeSettings?.fontFamily).toBe("'반모 고딕', sans-serif");
  });

  test('크롬: 목록의 줄을 누르면 고르고, 두 번 누르면 바로 적용 (리스트 시트)', async ({ context, extensionId, serviceWorker }) => {
    await fakeLocalFonts(context, { state: 'granted', fonts: [{ family: 'Banmo Test Sans' }, { family: '반모 고딕' }] });
    await setStorage(serviceWorker, { lists: ONE_LIST });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    await popup.locator('#sheet-font-family').selectOption('custom:');
    const gothic = popup.locator('#font-list .font-option', { hasText: '반모 고딕' });
    await gothic.click();
    await expect(popup.locator('#font-name-input')).toHaveValue('반모 고딕');
    await expect(popup.locator('#font-name-input')).toBeFocused({ message: '줄을 눌러도 입력란에 포커스가 남음' });
    await expect(popup.locator('#font-dialog-preview')).toHaveCSS('font-family', /반모 고딕/);
    await popup.locator('#font-list .font-option', { hasText: 'Banmo Test Sans' }).dblclick();
    await expect(popup.locator('#font-dialog')).toBeHidden();
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].style).toEqual({ fontFamily: "'Banmo Test Sans', sans-serif" });
  });

  test('크롬 팝업에서 아직 권한을 묻지 않았으면 새 탭 화면에서 허용받고, 그 탭에서 이어서 고름', async ({ context, extensionId, serviceWorker }) => {
    // 실제 크롬 팝업은 권한 창을 띄우지 않고 빈 목록을 돌려줌. 새 탭 화면에서는 권한 창에서 [허용]을 누른 것처럼
    await fakeLocalFonts(context, { state: 'prompt', fonts: [], tabFonts: [{ family: 'Banmo Tab Font' }] });
    await setStorage(serviceWorker, { lists: ONE_LIST });
    const popup = await openPopup(context, extensionId);
    await openSheet(popup, '친구');
    await popup.locator('#sheet-font-family').selectOption('custom:');
    await expect(popup.locator('#font-permission-text')).toContainText('새 탭에서 이어서 엽니다');
    expect(await popup.evaluate(() => window.__fontQueries)).toBe(0); // 팝업에서는 부르지 않음
    const [tabView] = await Promise.all([context.waitForEvent('page'), popup.click('#font-load-btn')]);
    await tabView.waitForLoadState();
    const url = new URL(tabView.url());
    expect(url.searchParams.get('view')).toBe('tab');
    expect(url.searchParams.get('font')).toBe('list');
    expect(url.searchParams.get('list')).toBe('친구');

    // 새 탭 화면: 그 리스트의 시트와 폰트 창이 열려 있고, [설치된 폰트 목록 보기]를 누르면 (권한 창 → 허용) 목록이 나옴
    await expect(tabView.locator('#sheet-title')).toHaveText('친구');
    await expect(tabView.locator('#font-dialog')).toBeVisible();
    await expect(tabView.locator('#font-dialog-target')).toHaveText("'친구' 리스트 배지에 쓸 폰트");
    await expect(tabView.locator('#font-list-status')).toContainText('새 탭에서 열었습니다');
    await expect(tabView.locator('#font-load-btn')).toHaveText('설치된 폰트 목록 보기');
    await tabView.click('#font-load-btn');
    await expect(tabView.locator('#font-list .font-option')).toHaveCount(1);
    await expect(tabView.locator('#font-list-status')).toContainText('다음부터는 팝업에서도 바로 목록이 보입니다');
    await tabView.locator('#font-list .font-option').click();
    await tabView.click('#font-ok-btn');
    await expect.poll(async () => (await getLists(serviceWorker))['친구'].style).toEqual({ fontFamily: "'Banmo Tab Font', sans-serif" });
    await expect(tabView.locator('#sync-status')).toContainText('이 탭은 닫아도 됩니다');
  });

  test('크롬: 공통 설정에서 연 창도 새 탭 화면의 [기본 스타일] 탭에서 이어서 열리고, 권한 창을 닫으면 다시 안내', async ({ context, extensionId }) => {
    await fakeLocalFonts(context, { state: 'prompt' });
    const popup = await openPopup(context, extensionId);
    await popup.click('#tab-style');
    await popup.locator('#badge-font-family').selectOption('custom:');
    const [tabView] = await Promise.all([context.waitForEvent('page'), popup.click('#font-load-btn')]);
    await tabView.waitForLoadState();
    expect(new URL(tabView.url()).searchParams.get('font')).toBe('common');
    await expect(tabView.locator('#tab-style')).toHaveAttribute('aria-selected', 'true');
    await expect(tabView.locator('#font-dialog-target')).toHaveText('모든 리스트 배지에 쓸 기본 폰트');
    // 새 탭 화면에서 권한 창을 닫아 버린 경우 (빈 목록)
    await tabView.click('#font-load-btn');
    await expect(tabView.locator('#font-list-status')).toContainText('목록을 받지 못했습니다');
    await expect(tabView.locator('#font-list-status')).toHaveClass(/error/);
    await expect(tabView.locator('#font-permission')).toBeVisible();
  });

  test('크롬: 글꼴 권한을 차단했으면 안내하고, [크롬 설정 열기]가 이 확장 프로그램의 권한 설정 화면을 엶', async ({ context, extensionId }) => {
    await fakeLocalFonts(context, { state: 'denied' });
    const popup = await openPopup(context, extensionId);
    await popup.evaluate(() => { chrome.tabs.create = async (o) => { window.__createdTab = o.url; return {}; }; });
    await popup.click('#tab-style');
    await popup.locator('#badge-font-family').selectOption('custom:');
    await expect(popup.locator('#font-permission-text')).toContainText('차단되어 있어');
    await expect(popup.locator('#font-load-btn')).toHaveText('크롬 설정 열기');
    await popup.click('#font-load-btn');
    expect(await popup.evaluate(() => window.__createdTab))
      .toBe(`chrome://settings/content/siteDetails?site=${encodeURIComponent(`chrome-extension://${extensionId}`)}`);
    expect(await popup.evaluate(() => window.__fontQueries)).toBe(0);
  });

  test('크롬: 실제 글꼴 권한을 허용해 두면 이 컴퓨터의 폰트가 바로 목록에 나옴 (실제 queryLocalFonts)', async ({ context, extensionId, serviceWorker }) => {
    const popup = await openPopup(context, extensionId);
    await grantLocalFonts(popup, extensionId);
    await popup.click('#tab-style');
    await popup.locator('#badge-font-family').selectOption('custom:');
    // 처음 한 번은 운영체제의 폰트를 모으느라 몇 초 걸릴 수 있음
    await expect(popup.locator('#font-list .font-option').first()).toBeVisible({ timeout: 20_000 });
    expect(await popup.locator('#font-list .font-option').count()).toBeGreaterThan(0);
    await popup.focus('#font-name-input');
    await popup.keyboard.press('ArrowDown');
    const picked = await popup.inputValue('#font-name-input');
    expect(picked.length).toBeGreaterThan(0);
    await expect(popup.locator('#font-check')).toHaveText('이 컴퓨터에 설치된 폰트입니다.');
    await popup.keyboard.press('Enter');
    await expect.poll(async () => (await getStorage(serviceWorker, ['badgeSettings'])).badgeSettings?.fontFamily)
      .toBe(await popup.evaluate(name => window.buildFontFamily(name), picked));
  });

  test('설치 폰트 목록이 없는 브라우저(파이어폭스)에서는 목록 대신 이름을 직접 적는 창', async ({ context, extensionId }) => {
    await context.addInitScript(() => { window.queryLocalFonts = undefined; });
    const popup = await openPopup(context, extensionId);
    await popup.click('#tab-style');
    await expect(popup.locator('#badge-font-family option').last()).toHaveText('다른 폰트 직접 입력…');
    await popup.locator('#badge-font-family').selectOption('custom:');
    await expect(popup.locator('#font-dialog-title')).toHaveText('다른 폰트 쓰기');
    await expect(popup.locator('#font-list-area')).toBeHidden();
    await expect(popup.locator('#font-browser-note')).toBeVisible();
  });
});

test.describe('설정 시트 (배지 순서 · 타임라인 배지 표시)', () => {
  const LISTS = {
    '친구': { color: '#c8174d', mode: 'normal', members: ['@a'] },
    'AI': { color: '#7a3fd1', mode: 'normal', members: ['@a'] },
    '뉴스': { color: '#0b74c4', mode: 'normal', members: ['@a'] }
  };
  const priorityNames = popup => popup.locator('#priority-list .priority-name');
  const storedPriority = async (sw) => {
    const lists = await getLists(sw);
    return Object.fromEntries(Object.entries(lists).map(([name, l]) => [name, l.priority]));
  };

  async function openSettings(popup) {
    await popup.click('#settings-btn');
    await expect(popup.locator('#settings-sheet')).toBeVisible();
    await expect(popup.locator('#settings-close-btn')).toBeFocused();
  }

  test('⚙ 버튼으로 열고, Esc·닫기·바깥을 누르면 닫히며 포커스는 ⚙ 버튼으로 돌아감', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: LISTS });
    const popup = await openPopup(context, extensionId);
    await openSettings(popup);
    // 처음에는 이름순 (한글 먼저), 이름순으로 되돌리기는 누를 수 없음
    await expect(priorityNames(popup)).toHaveText(['뉴스', '친구', 'AI']);
    await expect(popup.locator('#priority-state')).toHaveText('이름순 (아직 정하지 않음)');
    await expect(popup.locator('#priority-reset-btn')).toBeDisabled();
    await expect(popup.locator('#priority-up-0')).toBeDisabled();
    await expect(popup.locator('#priority-down-2')).toBeDisabled();
    await expect(popup.locator('#app')).toHaveJSProperty('inert', true);

    await popup.keyboard.press('Escape');
    await expect(popup.locator('#settings-sheet')).toBeHidden();
    await expect(popup.locator('#settings-btn')).toBeFocused();
    await expect(popup.locator('#app')).toHaveJSProperty('inert', false);

    await openSettings(popup);
    await popup.click('#settings-close-btn');
    await expect(popup.locator('#settings-sheet')).toBeHidden();
    await openSettings(popup);
    await popup.mouse.click(5, 5); // 시트 바깥(어두운 배경)
    await expect(popup.locator('#settings-sheet')).toBeHidden();
  });

  test('배지 순서: ▲ ▼ 로 옮기면 저장되고, 포커스는 옮긴 줄을 따라감. 리스트 표 "배지 순서" 정렬도 같은 순서', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: LISTS });
    const popup = await openPopup(context, extensionId);
    await openSettings(popup);

    await popup.click('#priority-up-2'); // AI 를 한 칸 앞으로
    await expect(priorityNames(popup)).toHaveText(['뉴스', 'AI', '친구']);
    await expect(popup.locator('#priority-up-1')).toBeFocused();
    await expect.poll(() => storedPriority(serviceWorker)).toEqual({ '뉴스': 1, 'AI': 2, '친구': 3 });
    await expect(popup.locator('#priority-state')).toHaveText('직접 정한 순서');

    await popup.keyboard.press('Enter'); // 같은 버튼을 한 번 더 → 맨 앞. ▲ 를 누를 수 없으니 ▼ 로 포커스
    await expect(priorityNames(popup)).toHaveText(['AI', '뉴스', '친구']);
    await expect(popup.locator('#priority-down-0')).toBeFocused();
    await popup.click('#priority-down-1'); // 뉴스를 맨 뒤로
    await expect(priorityNames(popup)).toHaveText(['AI', '친구', '뉴스']);
    await expect.poll(() => storedPriority(serviceWorker)).toEqual({ 'AI': 1, '친구': 2, '뉴스': 3 });

    // 미리보기도 배지 순서대로 (보일 배지 수 기본 3개)
    await expect(popup.locator('#display-preview .preview-author').first().locator('.ag-list-badge')).toHaveText(['AI', '친구', '뉴스']);

    await popup.keyboard.press('Escape');
    await popup.selectOption('#list-sort', 'priority');
    await expect(popup.locator('.list-name')).toHaveText(['AI', '친구', '뉴스']);
    await expect.poll(async () => (await getStorage(serviceWorker, ['uiSettings'])).uiSettings).toEqual({ theme: 'system', listSort: 'priority' });
  });

  test('배지 순서: 줄을 끌어서 옮길 수 있고, [이름순으로 되돌리기]는 확인 후 순서를 지움', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: LISTS });
    const popup = await openPopup(context, extensionId);
    await openSettings(popup);

    const row = name => popup.locator('#priority-list .priority-row').filter({ has: popup.locator('.priority-name', { hasText: new RegExp(`^${name}$`) }) });
    // AI(맨 뒤)를 뉴스(맨 앞) 줄의 위쪽 절반에 놓음 → 맨 앞
    await row('AI').dragTo(row('뉴스'), { targetPosition: { x: 20, y: 3 } });
    await expect(priorityNames(popup)).toHaveText(['AI', '뉴스', '친구']);
    // AI 를 친구(맨 뒤) 줄의 아래쪽 절반에 놓음 → 맨 뒤
    const box = await row('친구').boundingBox();
    await row('AI').dragTo(row('친구'), { targetPosition: { x: 20, y: box.height - 3 } });
    await expect(priorityNames(popup)).toHaveText(['뉴스', '친구', 'AI']);
    await expect.poll(() => storedPriority(serviceWorker)).toEqual({ '뉴스': 1, '친구': 2, 'AI': 3 });

    await popup.click('#priority-up-2');
    await expect(priorityNames(popup)).toHaveText(['뉴스', 'AI', '친구']);
    await popup.click('#priority-reset-btn');
    await expect(popup.locator('#confirm-text')).toHaveText('배지 순서를 이름순으로 되돌릴까요?');
    await popup.click('#confirm-cancel-btn');
    await expect(priorityNames(popup)).toHaveText(['뉴스', 'AI', '친구']);
    await popup.click('#priority-reset-btn');
    await popup.click('#confirm-ok-btn');
    await expect(priorityNames(popup)).toHaveText(['뉴스', '친구', 'AI']);
    await expect(popup.locator('#priority-reset-btn')).toBeDisabled();
    await expect.poll(() => storedPriority(serviceWorker)).toEqual({ '뉴스': undefined, '친구': undefined, 'AI': undefined });
  });

  test('표시 설정: 보일 배지 수 · 긴 이름 줄이기 · 줄일 길이 · 모양 · 인용 배지 · 흐리게 정도를 바꾸면 저장되고 미리보기에 반영', async ({ context, extensionId, serviceWorker }) => {
    const longName = 'AI 연구자 모음 (국내·해외 연구소와 대학)';
    await setStorage(serviceWorker, { lists: { ...LISTS, [longName]: { color: '#0f7b3e', mode: 'normal', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    await openSettings(popup);
    const stored = async () => (await getStorage(serviceWorker, ['displaySettings'])).displaySettings;
    const author = popup.locator('#display-preview .preview-author').first();
    const quote = popup.locator('#display-preview .preview-quote');

    // 기본값: 3개 + "+1", 말줄임 켬(약 10글자), 둥글게, 인용 배지 켬, 흐리게 보통
    await expect(popup.locator('#display-max-badges')).toHaveValue('3');
    await expect(popup.locator('#display-ellipsis')).toBeChecked();
    await expect(popup.locator('#display-name-width')).toHaveValue('10');
    await expect(popup.locator('#display-shape-round')).toBeChecked();
    await expect(popup.locator('#display-quote-badges')).toBeChecked();
    await expect(popup.locator('#display-dim-normal')).toBeChecked();
    await expect(author.locator('.ag-list-badge')).toHaveCount(3);
    await expect(author.locator('.ag-badge-more')).toHaveText('+1');
    await expect(quote.locator('.ag-list-badge.mini-badge')).toHaveCount(3);

    await popup.fill('#display-max-badges', '1');
    await expect(author.locator('.ag-list-badge')).toHaveCount(1);
    await expect(author.locator('.ag-badge-more')).toHaveText('+3');
    await popup.fill('#display-max-badges', '0'); // 0 = 모두
    await expect(author.locator('.ag-list-badge')).toHaveCount(4);
    await expect(author.locator('.ag-badge-more')).toHaveCount(0);

    const longBadge = author.locator('.ag-list-badge', { hasText: longName });
    expect(await longBadge.evaluate(el => el.scrollWidth > el.clientWidth), '말줄임 켬: 긴 이름이 잘림').toBe(true);
    const width10 = await longBadge.evaluate(el => el.clientWidth);
    await popup.fill('#display-name-width', '6');
    await expect.poll(() => longBadge.evaluate(el => el.clientWidth), { message: '약 6글자 폭으로 더 짧게' }).toBeLessThan(width10);
    await popup.locator('#display-ellipsis').uncheck();
    await expect(popup.locator('#display-name-width')).toBeDisabled();
    await expect.poll(() => longBadge.evaluate(el => el.scrollWidth <= el.clientWidth), { message: '말줄임 끔: 전체 이름' }).toBe(true);

    await popup.locator('#display-shape-square').check();
    await expect(author.locator('.ag-list-badge').first()).toHaveCSS('border-top-left-radius', '4px');
    // 팝업의 다른 배지(리스트 표)도 같은 모양
    await expect(popup.locator('.list-name').first()).toHaveCSS('border-top-left-radius', '4px');

    await popup.locator('#display-quote-badges').uncheck();
    await expect(quote.locator('.ag-badges-wrapper')).toHaveCount(0);
    await popup.locator('#display-dim-strong').check();
    await expect(popup.locator('#display-preview .tweet-preview.is-dim .tweet-text')).toHaveCSS('opacity', '0.25');

    await expect.poll(stored).toEqual({ maxBadges: 0, ellipsis: false, nameWidth: 6, badgeShape: 'square', quoteBadges: false, dimLevel: 'strong' });

    // 다시 열어도 그대로, [표시 설정 기본값]으로 되돌림
    const again = await openPopup(context, extensionId);
    await again.click('#settings-btn');
    await expect(again.locator('#display-max-badges')).toHaveValue('0');
    await expect(again.locator('#display-shape-square')).toBeChecked();
    await expect(again.locator('#display-dim-strong')).toBeChecked();
    await again.click('#display-reset-btn');
    await expect(again.locator('#display-max-badges')).toHaveValue('3');
    await expect.poll(stored).toEqual({ maxBadges: 3, ellipsis: true, nameWidth: 10, badgeShape: 'round', quoteBadges: true, dimLevel: 'normal' });
    // 열려 있던 다른 창에도 바로 반영
    await expect(popup.locator('#display-max-badges')).toHaveValue('3');
    await expect(popup.locator('#display-shape-round')).toBeChecked();
  });

  test('숫자 칸(보일 배지 수 · 줄일 길이): 적는 동안 바로 저장, 범위를 넘거나 비우면 칸을 벗어날 때 맞춤', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: LISTS });
    const popup = await openPopup(context, extensionId);
    await openSettings(popup);
    const stored = async () => (await getStorage(serviceWorker, ['displaySettings'])).displaySettings;
    const max = popup.getByLabel('보일 배지 수');
    const width = popup.getByLabel('줄일 길이');
    const author = popup.locator('#display-preview .preview-author').first();
    await expect(max).toHaveAttribute('type', 'number');
    await expect(max).toHaveAttribute('min', '0');
    await expect(max).toHaveAttribute('max', '10');
    await expect(width).toHaveAttribute('min', '4');
    await expect(width).toHaveAttribute('max', '30');

    // 키보드로 적으면 칸을 벗어나지 않아도 바로 저장되고 미리보기가 바뀜
    await max.click();
    await max.press('Control+A');
    await max.pressSequentially('2');
    await expect.poll(async () => (await stored())?.maxBadges).toBe(2);
    await expect(author.locator('.ag-list-badge')).toHaveCount(2);
    await expect(author.locator('.ag-badge-more')).toHaveText('+1');
    await expect(max).toBeFocused();

    // 범위를 넘는 값은 적는 동안 저장하지 않고, 칸을 벗어나면 가장 가까운 값(10)으로
    await max.fill('50');
    await expect(author.locator('.ag-list-badge')).toHaveCount(2);
    expect((await stored()).maxBadges).toBe(2);
    await max.press('Tab');
    await expect(max).toHaveValue('10');
    await expect.poll(async () => (await stored()).maxBadges).toBe(10);
    await expect(author.locator('.ag-list-badge')).toHaveCount(3);

    // 비우면 원래 값으로, "05" 는 5 로 저장되고 칸을 벗어나면 "5"
    await max.fill('');
    await max.press('Enter');
    await expect(max).toHaveValue('10');
    await max.fill('05');
    await expect.poll(async () => (await stored()).maxBadges).toBe(5);
    await expect(max).toHaveValue('05');
    await max.press('Tab');
    await expect(max).toHaveValue('5');

    // 두 자리를 한 글자씩 적어도 앞 글자("1")를 저장한 알림이 적던 "10" 을 되돌리지 않음
    await max.click();
    await max.press('Control+A');
    await max.pressSequentially('10', { delay: 30 });
    await expect.poll(async () => (await stored()).maxBadges).toBe(10);
    await popup.waitForTimeout(300);
    await expect(max).toHaveValue('10');
    await max.press('Enter');
    await expect(max).toHaveValue('10');

    // 줄일 길이: 최솟값보다 작으면 4, 범위 안의 아무 숫자(12)나 그대로
    await width.fill('2');
    await width.press('Tab');
    await expect(width).toHaveValue('4');
    await expect.poll(async () => (await stored()).nameWidth).toBe(4);
    await width.fill('12');
    await expect.poll(async () => (await stored()).nameWidth).toBe(12);
    await expect(author.locator('.ag-badges-wrapper')).toHaveCSS('--ag-badge-max-w', '12em');
    expect(await stored()).toEqual({ maxBadges: 10, ellipsis: true, nameWidth: 12, badgeShape: 'round', quoteBadges: true, dimLevel: 'normal' });
  });

  test('리스트가 없으면 배지 순서에 안내, 미리보기는 보기 리스트로', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    await openSettings(popup);
    await expect(popup.locator('#priority-list')).toHaveText('저장된 리스트가 없습니다.');
    await expect(popup.locator('#display-preview .preview-author').first().locator('.ag-list-badge')).toHaveCount(3);
  });
});

test.describe('새 탭에서 열기 · 파이어폭스 팝업 우회 · x.com 접근 권한', () => {
  test('↗ 새 탭에서 열기: 같은 화면이 탭으로 열리고, 그 탭의 [가져오기]는 원래 보던 X 탭을 대상으로 동작', async ({ context, extensionId, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const xPage = await context.newPage();
    await xPage.goto('https://x.com/i/lists/123/members');
    const tabId = await findXTabId(serviceWorker);

    const popup = await openPopup(context, extensionId);
    await pointPopupAtTab(popup, tabId, 'https://x.com/i/lists/123/members');
    const [tabView] = await Promise.all([context.waitForEvent('page'), popup.click('#open-tab-btn')]);
    await tabView.waitForLoadState();
    const url = new URL(tabView.url());
    expect(url.searchParams.get('view')).toBe('tab');
    expect(url.searchParams.get('targetTab')).toBe(String(tabId));
    await expect(tabView.locator('body')).toHaveClass(/tab-view/);
    await expect(tabView.locator('#open-tab-btn')).toBeHidden();

    // 새 탭 화면 자신이 활성 탭이지만, 요청은 열 때 보던 X 탭으로 감
    await tabView.click('#sync-current-tab-btn');
    await expect(tabView.locator('#sync-status')).toContainText('총 3명');
  });

  test('새 탭 화면에서 원래 X 탭이 닫혔으면 안내', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html?view=tab&targetTab=987654321`);
    await page.click('#sync-current-tab-btn');
    await expect(page.locator('#sync-status')).toContainText('이 화면을 열 때 보던 X 탭을 찾을 수 없습니다');
  });

  test('크롬 팝업에서는 ⋯ 메뉴의 [백업 파일 가져오기]가 바로 파일 선택 창을 엶 (파이어폭스 우회가 끼어들지 않음)', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    await expect(popup.locator('#firefox-note')).toBeHidden();
    await popup.click('#menu-btn');
    const [chooser] = await Promise.all([popup.waitForEvent('filechooser'), popup.click('#import-btn')]);
    expect(chooser).toBeTruthy();
    await expect(popup.locator('#app-menu')).toBeHidden(); // 항목을 누르면 메뉴가 닫힘
  });

  test('파이어폭스 팝업에서는 가져오기가 파일 선택 창 대신 새 탭 화면을 엶', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '친구': { color: '#ff0000', mode: 'normal', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    // 확장 프로그램 주소가 moz-extension:// 인 것처럼 (파이어폭스)
    await popup.evaluate(() => { chrome.runtime.getURL = path => 'moz-extension://test-uuid/' + (path || ''); });

    let fileChooserOpened = false;
    popup.on('filechooser', () => { fileChooserOpened = true; });
    await popup.click('#menu-btn');
    const [importTab] = await Promise.all([context.waitForEvent('page'), popup.locator('#import-btn').click({ noWaitAfter: true })]);
    expect(new URL(importTab.url()).searchParams.get('view')).toBe('tab');
    expect(fileChooserOpened).toBe(false);
  });

  test('파이어폭스 팝업에서 시트의 [다른 색]도 새 탭 화면으로, 그 탭에서는 같은 리스트 시트가 열려 있음', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '친구': { color: '#ff0000', mode: 'normal', members: ['@a'] } } });
    const popup = await openPopup(context, extensionId);
    await popup.evaluate(() => { chrome.runtime.getURL = path => 'moz-extension://test-uuid/' + (path || ''); });
    await openSheet(popup, '친구');
    const [colorTab] = await Promise.all([
      context.waitForEvent('page'),
      popup.locator('#sheet-color-custom').click({ noWaitAfter: true })
    ]);
    const url = new URL(colorTab.url());
    expect(url.searchParams.get('view')).toBe('tab');
    expect(url.searchParams.get('list')).toBe('친구');
    await expect(colorTab.locator('#list-sheet')).toBeVisible();
    await expect(colorTab.locator('#sheet-title')).toHaveText('친구');
  });

  test('x.com 접근 권한이 있으면 안내 없음, 꺼져 있으면 안내와 [허용] 버튼', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId);
    await expect(popup.locator('#permission-warning')).toBeHidden(); // 크롬은 설치할 때 허용됨

    // 권한이 꺼진 상황 (파이어폭스에서 사용자가 거부한 경우)
    await context.addInitScript(() => {
      if (!location.search.includes('permtest')) return;
      let granted = false;
      chrome.permissions.contains = async () => granted;
      chrome.permissions.request = async () => { granted = true; return true; };
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html?permtest=1`);
    await expect(page.locator('#permission-warning')).toBeVisible();
    await page.click('#grant-permission-btn');
    await expect(page.locator('#sync-status')).toContainText('x.com 접근을 허용했습니다');
    await expect(page.locator('#permission-warning')).toBeHidden();
  });
});

test.describe('백업', () => {
  test('내보내기 파일에 리스트(배지 순서 포함)와 배지 글자 스타일 · 표시 설정이 함께 들어감', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { '테크': { color: '#ff0055', mode: 'dim', listId: '7', members: ['@a'], priority: 1 } },
      badgeSettings: { textColor: '#000000', fontSize: 14, fontFamily: 'monospace' },
      displaySettings: { maxBadges: 5, ellipsis: false, nameWidth: 14, badgeShape: 'square', quoteBadges: false, dimLevel: 'light' }
    });
    const popup = await openPopup(context, extensionId);
    await popup.click('#menu-btn');
    const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('#export-btn')]);
    const stream = await download.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk;
    const backup = JSON.parse(text);

    expect(backup.app).toBe('banmo_tag');
    expect(backup.lists['테크']).toEqual({ color: '#ff0055', mode: 'dim', listId: '7', members: ['@a'], priority: 1 });
    expect(backup.badgeSettings).toEqual({ textColor: '#000000', fontSize: 14, fontFamily: 'monospace' });
    expect(backup.displaySettings).toEqual({ maxBadges: 5, ellipsis: false, nameWidth: 14, badgeShape: 'square', quoteBadges: false, dimLevel: 'light' });
  });

  test('가져오기 → 덮어쓰기는 리스트와 배지 설정(글자 스타일 · 표시 설정)을 모두 복원', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '옛 리스트': { color: '#1d9bf0', mode: 'normal', members: ['@old'] } } });
    const popup = await openPopup(context, extensionId);
    const backup = {
      app: 'banmo_tag', backupVersion: 2,
      lists: { '새 리스트': { color: '#00ff00', mode: 'highlight', members: ['@new'] } },
      badgeSettings: { textColor: '#111111', fontSize: 16, fontFamily: 'monospace' },
      displaySettings: { maxBadges: 2, ellipsis: true, nameWidth: 8, badgeShape: 'square', quoteBadges: true, dimLevel: 'strong' }
    };
    await popup.setInputFiles('#import-file', {
      name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup))
    });
    await expect(popup.locator('#import-choice')).toBeVisible();
    await expect(popup.locator('#import-choice-text')).toContainText('배지 스타일·표시 설정 포함');
    await popup.click('#import-replace-btn');
    await popup.click('#confirm-ok-btn');
    await expect(popup.locator('#sync-status')).toContainText('리스트 + 배지 설정');

    const stored = await getStorage(serviceWorker, ['lists', 'badgeSettings', 'displaySettings']);
    expect(Object.keys(stored.lists)).toEqual(['새 리스트']);
    expect(stored.badgeSettings).toEqual({ textColor: '#111111', fontSize: 16, fontFamily: 'monospace' });
    expect(stored.displaySettings).toEqual({ maxBadges: 2, ellipsis: true, nameWidth: 8, badgeShape: 'square', quoteBadges: true, dimLevel: 'strong' });
    await expect(popup.locator('#badge-font-size')).toHaveValue('16');
    await expect(popup.locator('#display-max-badges')).toHaveValue('2');
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

  test('[뺀 멤버 정리]: 미리보기 확인 상자 → 확인 시 뺀 멤버 삭제', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@alice', '@bob', '@dave_dev', '@gone_user'] } }
    });
    // "더 불러오는 중" 상태의 멤버 화면 (목록 끝을 확인하지 못해 자동으로는 정리하지 않는 상황)
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-loading.html');
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

  test('[끝까지 스캔]: 진행 상황을 보여 주고, 끝나면 미리보기 확인 상자 → 확인 시 뺀 멤버 삭제', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@member01', '@gone_user'] } }
    });
    // 멤버 45명을 15명씩 불러오는 가상 스크롤 화면
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-virtual.html');
    const xPage = await context.newPage();
    await xPage.goto('https://x.com/i/lists/123/members');
    await xPage.waitForTimeout(800);
    const tabId = await findXTabId(serviceWorker);

    const popup = await openPopup(context, extensionId);
    await pointPopupAtTab(popup, tabId, 'https://x.com/i/lists/123/members');
    await popup.click('#auto-scan-btn');
    await expect(popup.locator('#auto-scan-btn')).toHaveText('스캔 중지');
    await expect(popup.locator('#resync-replace-btn')).toBeDisabled();
    await expect(popup.locator('#sync-status')).toContainText('확인 중');

    await expect(popup.locator('#confirm-box')).toBeVisible({ timeout: 45000 });
    await expect(popup.locator('#confirm-text')).toContainText('끝까지 스캔했습니다');
    await expect(popup.locator('#confirm-text')).toContainText('45명으로 교체');
    await expect(popup.locator('#confirm-text')).toContainText('삭제 1명: @gone_user');
    await expect(popup.locator('#auto-scan-btn')).toHaveText('끝까지 스캔');
    await popup.click('#confirm-ok-btn');
    await expect(popup.locator('#sync-status')).toContainText('삭제 1명');

    const members = (await getLists(serviceWorker))['Core Members'].members;
    expect(members).toHaveLength(45);
    expect(members).not.toContain('@gone_user');
  });

  test('[끝까지 스캔]: 팝업이 닫힌 사이에 끝났으면 다시 열 때 미리보기 확인 상자를 띄우고, 한 번 답한 뒤에는 다시 띄우지 않음', async ({ context, extensionId, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@member01', '@gone_user'] } }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-virtual.html');
    const xPage = await context.newPage();
    await xPage.goto('https://x.com/i/lists/123/members');
    await xPage.waitForTimeout(800);
    const tabId = await findXTabId(serviceWorker);

    // 팝업 없이 시작 (팝업에서 시작한 뒤 팝업을 닫은 것과 같음)
    expect((await sendToTab(serviceWorker, tabId, { action: 'autoScanStart' })).state).toBe('running');
    await expect.poll(async () => (await sendToTab(serviceWorker, tabId, { action: 'autoScanStatus' })).state,
      { timeout: 45000, intervals: [500] }).toBe('done');

    // 다시 엶 (탭 화면이 그 X 탭을 보도록: 팝업이 열릴 때 바로 확인하므로 pointPopupAtTab 으로는 늦음)
    const openTabView = async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html?view=tab&targetTab=${tabId}`);
      await page.waitForSelector('#list-container');
      return page;
    };
    const popup = await openTabView();
    await expect(popup.locator('#confirm-box')).toBeVisible();
    await expect(popup.locator('#confirm-text')).toContainText('끝까지 스캔했습니다');
    await expect(popup.locator('#confirm-text')).toContainText('삭제 1명: @gone_user');
    await popup.click('#confirm-cancel-btn');
    await expect(popup.locator('#confirm-box')).toBeHidden();
    await expect.poll(async () => (await sendToTab(serviceWorker, tabId, { action: 'autoScanStatus' })).reported).toBe(true);
    await popup.close();

    // 답한 뒤 다시 열면 확인 상자를 또 띄우지 않음. 취소했으므로 뺀 멤버는 그대로
    const again = await openTabView();
    await again.waitForTimeout(1500);
    await expect(again.locator('#confirm-box')).toBeHidden();
    expect((await getLists(serviceWorker))['Core Members'].members).toContain('@gone_user');
  });

  test('[끝까지 스캔] 중 [스캔 중지]를 누르면 멈추고 안내', async ({ context, extensionId, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-virtual.html');
    const xPage = await context.newPage();
    await xPage.goto('https://x.com/i/lists/123/members');
    await xPage.waitForTimeout(800);
    const tabId = await findXTabId(serviceWorker);

    const popup = await openPopup(context, extensionId);
    await pointPopupAtTab(popup, tabId, 'https://x.com/i/lists/123/members');
    await popup.click('#auto-scan-btn');
    await expect(popup.locator('#auto-scan-btn')).toHaveText('스캔 중지');
    await popup.click('#auto-scan-btn');
    await expect(popup.locator('#sync-status')).toContainText('스캔을 멈췄습니다');
    await expect(popup.locator('#auto-scan-btn')).toHaveText('끝까지 스캔');
    await expect(popup.locator('#resync-replace-btn')).toBeEnabled();
    await expect(popup.locator('#confirm-box')).toBeHidden();
  });

  test('X 멤버 화면이 아닌 탭에서 [끝까지 스캔]을 누르면 안내만', async ({ context, extensionId, serviceWorker }) => {
    await mockXPage(context, '/home', 'synthetic/home-timeline.html');
    const xPage = await context.newPage();
    await xPage.goto('https://x.com/home');
    await xPage.waitForTimeout(800);
    const tabId = await findXTabId(serviceWorker);

    const popup = await openPopup(context, extensionId);
    await pointPopupAtTab(popup, tabId, 'https://x.com/home');
    await popup.click('#auto-scan-btn');
    await expect(popup.locator('#sync-status')).toContainText('리스트 페이지가 아닙니다');
    await expect(popup.locator('#auto-scan-btn')).toHaveText('끝까지 스캔');
  });

  test('[뺀 멤버 정리]: 이미 최신이면 확인 없이 안내만', async ({ context, extensionId, serviceWorker }) => {
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
