// content.js + background.js E2E: 실제 확장 프로그램이 가짜 x.com 페이지에서 동작하는지 검사
'use strict';

const { test, expect, mockXPage, setStorage, getLists, getStorage, findXTabId, sendToTab } = require('./helpers');

const MEMBERS_URL = 'https://x.com/i/lists/123/members';

test.describe('리스트 멤버 자동 수집', () => {
  test('멤버 화면의 멤버만 저장하고, 목록 아래 추천 블록과 사이드바 추천 계정은 제외', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);

    await expect.poll(async () => {
      const lists = await getLists(serviceWorker);
      const entry = Object.values(lists).find(l => l.listId === '123');
      return entry ? entry.members : null;
    }).toEqual(['@alice', '@bob', '@dave_dev']);
  });

  test('새 멤버를 저장하면 아이콘에 ✔ 를 띄우고 3초 뒤 지움 (서비스 워커가 먼저 멈출 때를 대비한 30초 알람도 예약)', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);

    const badgeText = () => serviceWorker.evaluate(() => chrome.action.getBadgeText({}));
    await expect.poll(badgeText).toBe('✔');
    const alarm = await serviceWorker.evaluate(() => chrome.alarms.get('banmo_tag-clear-saved-badge'));
    expect(alarm, '예비 알람이 예약되어야 함').toBeTruthy();
    expect(alarm.scheduledTime - Date.now()).toBeGreaterThan(20 * 1000);
    await expect.poll(badgeText, { timeout: 6000 }).toBe('');
  });

  test('리스트 메인 화면에서 읽은 이름을 멤버 화면에서 사용 (임시 이름 "리스트 (ID)" 아님)', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123', 'synthetic/list-main.html');
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const page = await context.newPage();

    await page.goto('https://x.com/i/lists/123');
    // 메인 화면은 자동 수집 대상이 아니지만, 이름은 세션 캐시에 저장되어야 함
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ag_list_name_123'))).toBe('Core Members');
    expect(await getLists(serviceWorker)).toEqual({});

    await page.goto(MEMBERS_URL);
    await expect.poll(async () => Object.keys(await getLists(serviceWorker))).toEqual(['Core Members']);
    expect((await getLists(serviceWorker))['Core Members'].listId).toBe('123');
  });

  test('X 에서 리스트 이름이 바뀌면 저장된 이름도 따라 바뀌고(색·표시 방식 유지), 팝업에서 직접 지은 이름은 그대로 둠', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123', 'synthetic/list-main.html');
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    await setStorage(serviceWorker, {
      lists: { '옛 이름': { color: '#ff0055', mode: 'dim', listId: '123', members: ['@alice'] } }
    });
    const membersOf = async name => ((await getLists(serviceWorker))[name] || {}).members || null;
    const page = await context.newPage();

    // 이름을 읽지 못한 화면(임시 이름 "리스트 (123)")에서는 멤버만 더하고 저장된 이름은 그대로
    await page.goto(MEMBERS_URL);
    await expect.poll(() => membersOf('옛 이름')).toEqual(['@alice', '@bob', '@dave_dev']);
    expect(Object.keys(await getLists(serviceWorker))).toEqual(['옛 이름']);

    // 리스트 메인 화면에서 실제 이름("Core Members")을 읽은 뒤 멤버 화면에 가면 그 이름으로 바뀜
    await page.goto('https://x.com/i/lists/123');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ag_list_name_123'))).toBe('Core Members');
    await page.goto(MEMBERS_URL);
    await expect.poll(async () => Object.keys(await getLists(serviceWorker))).toEqual(['Core Members']);
    expect((await getLists(serviceWorker))['Core Members']).toEqual({
      color: '#ff0055', mode: 'dim', listId: '123', members: ['@alice', '@bob', '@dave_dev']
    });

    // 팝업에서 직접 지은 이름(customName)은 다시 수집해도 X 이름으로 바뀌지 않고, 멤버만 더해짐
    await setStorage(serviceWorker, {
      lists: { '내가 지은 이름': { color: '#ff0055', mode: 'dim', listId: '123', members: ['@alice'], customName: true } }
    });
    await page.reload();
    await expect.poll(() => membersOf('내가 지은 이름')).toEqual(['@alice', '@bob', '@dave_dev']);
    expect(Object.keys(await getLists(serviceWorker))).toEqual(['내가 지은 이름']);
  });

  test('멤버 화면 주소로 바로 들어가 홈 타임라인 위에 멤버 창이 떠도, 배경 제목("내 홈 타임라인")을 이름으로 쓰지 않음', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123/members', 'synthetic/members-modal-over-home.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);

    await expect.poll(async () => Object.keys(await getLists(serviceWorker))).toEqual(['리스트 (123)']);
    const entry = (await getLists(serviceWorker))['리스트 (123)'];
    expect(entry.listId).toBe('123');
    expect(entry.members).toEqual(['@alice', '@bob']);
  });

  test('리스트 메인 화면에서 읽은 이름이 있으면, 홈 타임라인 위의 멤버 창에서도 그 이름을 사용', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123', 'synthetic/list-main.html');
    await mockXPage(context, '/i/lists/123/members', 'synthetic/members-modal-over-home.html');
    const page = await context.newPage();

    await page.goto('https://x.com/i/lists/123');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('ag_list_name_123'))).toBe('Core Members');

    await page.goto(MEMBERS_URL);
    await expect.poll(async () => Object.keys(await getLists(serviceWorker))).toEqual(['Core Members']);
    expect((await getLists(serviceWorker))['Core Members'].members).toEqual(['@alice', '@bob']);
  });
});

test.describe('타임라인 배지', () => {
  const LISTS = {
    '친구': { color: '#ff0000', mode: 'highlight', members: ['@alice'] },
    '동료': { color: '#00aa00', mode: 'normal', members: ['@bob'] }
  };

  async function openTimeline(context, serviceWorker, lists = LISTS) {
    await setStorage(serviceWorker, { lists });
    await mockXPage(context, '/home', 'synthetic/home-timeline.html');
    const page = await context.newPage();
    await page.goto('https://x.com/home');
    await expect(page.locator('[data-fixture-id="t-alice"] .ag-list-badge')).toHaveText('친구');
    return page;
  }

  test('리스트 멤버 트윗에 배지, 강조 모드는 왼쪽 테두리, 리스트에 없는 사람은 배지 없음', async ({ context, serviceWorker }) => {
    const page = await openTimeline(context, serviceWorker);
    const alice = page.locator('[data-fixture-id="t-alice"]');
    await expect(alice).toHaveCSS('border-left-width', '4px');
    await expect(alice).toHaveCSS('border-left-color', 'rgb(255, 0, 0)');
    await expect(page.locator('[data-fixture-id="t-bob"] .ag-list-badge')).toHaveText('동료');
    await expect(page.locator('[data-fixture-id="t-dave"] .ag-list-badge')).toHaveCount(0);
  });

  test('이름에 링크가 없는 인용 트윗 작성자에게도 미니 배지', async ({ context, serviceWorker }) => {
    const page = await openTimeline(context, serviceWorker);
    const mini = page.locator('[data-fixture-id="quote-card"] .ag-list-badge.mini-badge');
    await expect(mini).toHaveText('친구');
    // 인용 트윗을 쓴 사람(carol)은 리스트에 없으므로 본문 배지·테두리 없음
    const carol = page.locator('[data-fixture-id="t-carol-quote"]');
    await expect(carol.locator('.ag-list-badge:not(.mini-badge)')).toHaveCount(0);
    await expect(carol).toHaveCSS('border-left-width', '0px');
  });

  test('배지가 많으면 2개만 보이고 나머지는 "+N" (툴팁에 모든 리스트 이름), 긴 이름은 말줄임 + 전체 이름 툴팁', async ({ context, serviceWorker }) => {
    const longName = 'AI 연구자 모음 (국내·해외 연구소와 대학)';
    await setStorage(serviceWorker, {
      lists: {
        'A 친구': { color: '#c8174d', mode: 'normal', members: ['@alice'] },
        [longName]: { color: '#7a3fd1', mode: 'normal', members: ['@alice'] },
        'C 뉴스': { color: '#0b74c4', mode: 'normal', members: ['@alice'] },
        'D 동료': { color: '#0f7b3e', mode: 'normal', members: ['@alice', '@bob'] }
      }
    });
    await mockXPage(context, '/home', 'synthetic/home-timeline.html');
    const page = await context.newPage();
    await page.goto('https://x.com/home');

    const alice = page.locator('[data-fixture-id="t-alice"]');
    await expect(alice.locator('.ag-list-badge')).toHaveText(['A 친구', longName]);
    const more = alice.locator('.ag-badge-more');
    await expect(more).toHaveText('+2');
    await expect(more).toHaveAttribute('title', `banmo_tag 리스트 4개: A 친구, ${longName}, C 뉴스, D 동료`);

    const long = alice.locator('.ag-list-badge').nth(1);
    await expect(long).toHaveAttribute('title', longName);
    await expect(long).toHaveCSS('text-overflow', 'ellipsis');
    expect(await long.evaluate(el => el.scrollWidth > el.clientWidth), '긴 이름은 잘려서 보여야 함').toBe(true);

    // 3개 이하면 묶지 않음 (bob 은 1개)
    await expect(page.locator('[data-fixture-id="t-bob"] .ag-list-badge')).toHaveText(['D 동료']);
    await expect(page.locator('[data-fixture-id="t-bob"] .ag-badge-more')).toHaveCount(0);
  });

  test('흐리게 모드는 본문만 흐리게 하고 이름·배지는 또렷하게', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '뉴스': { color: '#0b74c4', mode: 'dim', members: ['@bob'] } } });
    await mockXPage(context, '/home', 'synthetic/home-timeline.html');
    const page = await context.newPage();
    await page.goto('https://x.com/home');

    const bob = page.locator('[data-fixture-id="t-bob"]');
    await expect(bob.locator('.ag-list-badge')).toHaveText('뉴스');
    await expect(bob).toHaveAttribute('data-ag-dim', 'body');
    await expect(bob).toHaveCSS('opacity', '1');
    await expect(bob.locator('[data-testid="tweetText"]')).toHaveCSS('opacity', '0.45');
    await expect(bob.locator('[data-testid="User-Name"]')).toHaveCSS('opacity', '1');
    await expect(bob.locator('.ag-list-badge')).toHaveCSS('opacity', '1');

    // 모드를 바꾸면 흐리게 표시가 지워짐
    await setStorage(serviceWorker, { lists: { '뉴스': { color: '#0b74c4', mode: 'normal', members: ['@bob'] } } });
    await expect(bob).not.toHaveAttribute('data-ag-dim', /.+/);
    await expect(bob.locator('[data-testid="tweetText"]')).toHaveCSS('opacity', '1');
  });

  test('리스트가 바뀌면 바뀐 사람의 트윗만 다시 그림 (다른 트윗의 배지는 그대로)', async ({ context, serviceWorker }) => {
    const page = await openTimeline(context, serviceWorker);
    // alice 배지에 표시를 남겨 두고, bob 의 리스트만 바꿈
    await page.locator('[data-fixture-id="t-alice"] .ag-list-badge').evaluate(el => { el.dataset.marker = 'keep'; });
    await page.locator('[data-fixture-id="quote-card"] .ag-list-badge').evaluate(el => { el.dataset.marker = 'keep'; });

    await setStorage(serviceWorker, {
      lists: { ...LISTS, '동료': { color: '#0000ff', mode: 'normal', members: ['@bob'] } }
    });
    await expect(page.locator('[data-fixture-id="t-bob"] .ag-list-badge')).toHaveCSS('background-color', 'rgb(0, 0, 255)');
    // 영향 없는 alice 트윗과 인용 카드의 배지는 다시 만들어지지 않음 (표시가 남아 있음)
    await expect(page.locator('[data-fixture-id="t-alice"] .ag-list-badge')).toHaveAttribute('data-marker', 'keep');
    await expect(page.locator('[data-fixture-id="quote-card"] .ag-list-badge')).toHaveAttribute('data-marker', 'keep');

    // alice 를 리스트에서 빼면 alice 의 배지·테두리와 인용 카드의 미니 배지가 사라짐
    await setStorage(serviceWorker, {
      lists: { '친구': { color: '#ff0000', mode: 'highlight', members: [] }, '동료': { color: '#0000ff', mode: 'normal', members: ['@bob'] } }
    });
    await expect(page.locator('[data-fixture-id="t-alice"] .ag-list-badge')).toHaveCount(0);
    await expect(page.locator('[data-fixture-id="t-alice"]')).toHaveCSS('border-left-width', '0px');
    await expect(page.locator('[data-fixture-id="quote-card"] .ag-list-badge')).toHaveCount(0);
    await expect(page.locator('[data-fixture-id="t-bob"] .ag-list-badge')).toHaveText('동료');
  });

  test('리스트별 글자 스타일이 그 리스트 배지에만 적용되고, 인용 미니 배지는 2px 작게', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, { badgeSettings: { textColor: '#ffffff', fontSize: 11, fontFamily: 'system' } });
    const page = await openTimeline(context, serviceWorker, {
      '친구': { color: '#ff0000', mode: 'normal', members: ['@alice'], style: { fontSize: 16, textColor: '#000000', fontFamily: 'monospace' } },
      '동료': { color: '#00aa00', mode: 'normal', members: ['@bob'] }
    });
    const aliceBadge = page.locator('[data-fixture-id="t-alice"] .ag-list-badge');
    await expect(aliceBadge).toHaveCSS('font-size', '16px');
    await expect(aliceBadge).toHaveCSS('color', 'rgb(0, 0, 0)');
    await expect(aliceBadge).toHaveCSS('font-family', 'monospace');
    await expect(page.locator('[data-fixture-id="quote-card"] .ag-list-badge.mini-badge')).toHaveCSS('font-size', '14px');

    // 스타일이 없는 리스트는 공통 설정
    const bobBadge = page.locator('[data-fixture-id="t-bob"] .ag-list-badge');
    await expect(bobBadge).toHaveCSS('font-size', '11px');
    await expect(bobBadge).toHaveCSS('color', 'rgb(255, 255, 255)');
  });

  test('한 리스트의 글자 스타일을 바꾸면 그 리스트 멤버의 트윗만 다시 그림', async ({ context, serviceWorker }) => {
    const page = await openTimeline(context, serviceWorker);
    await page.locator('[data-fixture-id="t-bob"] .ag-list-badge').evaluate(el => { el.dataset.marker = 'keep'; });

    await setStorage(serviceWorker, {
      lists: { ...LISTS, '친구': { ...LISTS['친구'], style: { fontSize: 18 } } }
    });
    await expect(page.locator('[data-fixture-id="t-alice"] .ag-list-badge')).toHaveCSS('font-size', '18px');
    await expect(page.locator('[data-fixture-id="t-bob"] .ag-list-badge')).toHaveAttribute('data-marker', 'keep');
  });

  test('X 가 트윗 DOM 을 다른 작성자 트윗에 재사용하면 이전 배지를 지우고 새 작성자 기준으로 다시 그림', async ({ context, serviceWorker }) => {
    const page = await openTimeline(context, serviceWorker);
    // alice 트윗의 작성자 영역을 bob 의 것으로 바꿔치기 (가상 스크롤 재사용 흉내)
    await page.evaluate(() => {
      const article = document.querySelector('[data-fixture-id="t-alice"]');
      const bobName = document.querySelector('[data-fixture-id="t-bob"] [data-testid="User-Name"]').cloneNode(true);
      bobName.querySelectorAll('.ag-badges-wrapper').forEach(w => w.remove());
      article.querySelector('[data-testid="User-Name"]').replaceWith(bobName);
    });
    const reused = page.locator('[data-fixture-id="t-alice"]');
    await expect(reused.locator('.ag-list-badge')).toHaveText('동료');
    await expect(reused).toHaveCSS('border-left-width', '0px');
  });

  // 팝업은 content script 가 응답하지 않으면 manifest 에 적힌 파일을 그 탭에 다시 넣음 (popup/sync.js injectContentScript).
  // 이미 들어 있는 탭에 또 넣어도 배지가 두 번 붙거나 동작이 멈추면 안 됨 (content.js 의 __agContentLoaded 확인).
  // 최상위 const/let 의 "이미 선언됨" 오류는 executeScript 결과로 돌아오지 않아 여기서는 잡지 못함
  // → 정적 검사(scripts/validate.js "content script 최상위 선언")가 확인
  test('content script 파일을 같은 탭에 다시 넣어도 배지가 한 번만 붙고 계속 동작', async ({ context, serviceWorker }) => {
    const page = await openTimeline(context, serviceWorker);
    const tabId = await findXTabId(serviceWorker);

    const results = await serviceWorker.evaluate(async (id) => {
      const [contentScript] = chrome.runtime.getManifest().content_scripts;
      const out = [];
      // 한 파일씩 넣어 어느 파일에서 오류가 났는지 알 수 있게
      for (const file of contentScript.js) {
        try {
          const [result] = await chrome.scripting.executeScript({ target: { tabId: id }, files: [file] });
          out.push(result && result.error ? `${file}: ${result.error.message || result.error}` : 'ok');
        } catch (error) {
          out.push(`${file}: ${error.message}`);
        }
      }
      return out;
    }, tabId);
    expect(results.filter(r => r !== 'ok')).toEqual([]);
    expect(results.length).toBeGreaterThan(1);

    // 배지가 두 번 붙지 않고, 저장 데이터가 바뀌면 여전히 반영됨
    await expect(page.locator('[data-fixture-id="t-alice"] .ag-list-badge')).toHaveCount(1);
    await setStorage(serviceWorker, { lists: { ...LISTS, '친구': { ...LISTS['친구'], members: [] } } });
    await expect(page.locator('[data-fixture-id="t-alice"] .ag-list-badge')).toHaveCount(0);
    await expect(page.locator('[data-fixture-id="t-bob"] .ag-list-badge')).toHaveCount(1);
  });
});

// 가상 스크롤 흉내: 멤버 목록에 그려진 줄을 handles 로 바꿈.
// firstIndex: 첫 줄이 목록의 몇 번째 줄인지, total: 불러온 목록의 전체 줄 수, loading: 맨 아래에 "더 불러오는 중" 줄을 둘지
async function showMemberRows(page, handles, { firstIndex, total, loading = false }) {
  await page.evaluate(([list, first, count, isLoading]) => {
    const ROW = 72;
    const wrapper = document.getElementById('member-rows');
    const template = wrapper.querySelector('[data-testid="cellInnerDiv"]').cloneNode(true);
    wrapper.replaceChildren();
    wrapper.style.minHeight = (count * ROW) + 'px';
    const place = (row, index) => {
      row.style.transform = `translateY(${index * ROW}px)`;
      wrapper.appendChild(row);
    };
    list.forEach((handle, i) => {
      const row = template.cloneNode(true);
      row.querySelectorAll('a').forEach(a => a.setAttribute('href', '/' + handle));
      row.querySelectorAll('span').forEach((s) => {
        s.textContent = s.textContent.startsWith('@') ? '@' + handle : handle;
      });
      place(row, first + i);
    });
    if (isLoading) {
      const row = document.createElement('div');
      row.setAttribute('data-testid', 'cellInnerDiv');
      row.style.cssText = 'position: absolute; width: 100%;';
      const spinner = document.createElement('div');
      spinner.setAttribute('role', 'progressbar');
      row.appendChild(spinner);
      place(row, first + list.length);
    }
  }, [handles, firstIndex, total, loading]);
}

test.describe('X 리스트에서 뺀 멤버 자동 정리', () => {
  const membersOf = async sw => ((await getLists(sw))['Core Members'] || {}).members || [];
  // 자동 정리는 목록 끝에 닿은 상태가 2.5초 유지된 뒤에 하므로, "지우지 않음"은 그보다 길게 기다린 뒤 확인
  const WAIT_PAST_SETTLE_MS = 3800;

  test('멤버 목록 전체가 보이면 뺀 멤버를 지움 (색·표시 방식과 직접 추가한 멤버는 유지)', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: {
        'Core Members': {
          color: '#123456', mode: 'dim', listId: '123',
          members: ['@alice', '@bob', '@dave_dev', '@gone_user', '@my_pick'], manualMembers: ['@my_pick']
        }
      }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);

    await expect.poll(() => membersOf(serviceWorker), { timeout: 10000 }).toEqual(['@alice', '@bob', '@dave_dev', '@my_pick']);
    const entry = (await getLists(serviceWorker))['Core Members'];
    expect(entry.color).toBe('#123456');
    expect(entry.mode).toBe('dim');
    expect(entry.manualMembers).toEqual(['@my_pick']);
    await expect.poll(() => serviceWorker.evaluate(() => chrome.action.getBadgeText({}))).toBe('✔');
  });

  test('저장된 멤버의 절반 넘게 지워질 상황이면 자동으로는 지우지 않음', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@alice', '@gone1', '@gone2', '@gone3', '@gone4', '@gone5'] } }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);
    await expect.poll(() => membersOf(serviceWorker)).toContain('@dave_dev');

    await page.waitForTimeout(WAIT_PAST_SETTLE_MS);
    expect(await membersOf(serviceWorker)).toEqual(['@alice', '@gone1', '@gone2', '@gone3', '@gone4', '@gone5', '@bob', '@dave_dev']);
  });

  test('가상 스크롤: 불러오는 중에는 지우지 않고, 맨 위부터 끝까지 이어서 본 뒤에 지움', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@alice', '@bob', '@dave_dev', '@erin', '@frank', '@gone_user'] } }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-loading.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);

    // 처음 화면: alice, bob, dave_dev + "더 불러오는 중" → 끝이 아니므로 그대로
    await page.waitForTimeout(WAIT_PAST_SETTLE_MS);
    expect(await membersOf(serviceWorker)).toContain('@gone_user');

    // 스크롤: 위쪽 줄이 사라지고 다음 멤버가 나타남 (dave_dev 가 겹침), 목록의 끝
    await showMemberRows(page, ['dave_dev', 'erin', 'frank'], { firstIndex: 2, total: 5 });
    await expect.poll(() => membersOf(serviceWorker), { timeout: 10000 }).toEqual(['@alice', '@bob', '@dave_dev', '@erin', '@frank']);
  });

  test('가상 스크롤: 새 줄 없이 "더 불러오는 중" 줄만 사라져도 끝을 다시 확인해 지움', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@alice', '@bob', '@dave_dev', '@gone_user'] } }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-loading.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);
    await page.waitForTimeout(WAIT_PAST_SETTLE_MS);
    expect(await membersOf(serviceWorker)).toContain('@gone_user');

    // 마지막 쪽이었음: 불러오는 표시 줄이 사라질 뿐 새 줄은 추가되지 않음 (실제 X 의 목록 끝)
    await page.evaluate(() => {
      const wrapper = document.getElementById('member-rows');
      wrapper.querySelector('[role="progressbar"]').closest('[data-testid="cellInnerDiv"]').remove();
      wrapper.style.minHeight = '216px';
    });
    await expect.poll(() => membersOf(serviceWorker), { timeout: 10000 }).toEqual(['@alice', '@bob', '@dave_dev']);
  });

  test('가상 스크롤: 화면 구조 변화 없이 끝 상태가 되어도, 스크롤이 멈춘 뒤 다시 확인해 지움', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@alice', '@bob', '@dave_dev', '@gone_user'] } }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-loading.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);
    await page.waitForTimeout(WAIT_PAST_SETTLE_MS);
    expect(await membersOf(serviceWorker)).toContain('@gone_user');

    // 줄이 추가되거나 사라지지 않고 속성만 바뀜 (MutationObserver 가 보지 않는 변화) → 스크롤 이벤트로 다시 확인
    await page.evaluate(() => {
      const wrapper = document.getElementById('member-rows');
      wrapper.querySelector('[role="progressbar"]').removeAttribute('role');
      wrapper.style.minHeight = '216px';
      wrapper.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => membersOf(serviceWorker), { timeout: 10000 }).toEqual(['@alice', '@bob', '@dave_dev']);
  });

  test('가상 스크롤: 중간을 건너뛰어 끝에 닿으면 지우지 않음 (그 사이 멤버를 못 봤을 수 있음)', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@alice', '@bob', '@dave_dev', '@erin', '@frank', '@gina', '@gone_user'] } }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-loading.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);
    await page.waitForTimeout(800);

    // alice, bob, dave_dev 다음에 erin 을 건너뛰고 frank, gina(끝)만 보임
    await showMemberRows(page, ['frank', 'gina'], { firstIndex: 4, total: 6 });
    await page.waitForTimeout(WAIT_PAST_SETTLE_MS);
    expect(await membersOf(serviceWorker)).toEqual(['@alice', '@bob', '@dave_dev', '@erin', '@frank', '@gina', '@gone_user']);
  });
});

test.describe('팝업 [뺀 멤버 정리] 요청 (목록 끝을 확인하지 못한 화면에서 직접 정리)', () => {
  test('이번 방문에서 본 멤버(스크롤로 사라진 멤버 포함)로 교체하고, 한 번도 안 보인 멤버만 삭제', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@alice', '@bob', '@gone_user'] } }
    });
    // "더 불러오는 중" 상태의 화면: 자동 정리는 하지 않음
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-loading.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);
    // 자동 수집이 dave_dev 를 추가할 때까지 대기
    await expect.poll(async () => (await getLists(serviceWorker))['Core Members'].members).toContain('@dave_dev');

    // 가상 스크롤 흉내: alice 셀이 DOM 에서 사라지고 새 멤버 carol_new 가 나타남
    await page.evaluate(() => {
      const aliceCell = document.querySelector('#member-list a[href="/alice"]').closest('[data-testid="cellInnerDiv"]');
      const list = aliceCell.parentElement;
      const carol = aliceCell.cloneNode(true);
      carol.querySelectorAll('a').forEach(a => a.setAttribute('href', '/carol_new'));
      carol.querySelectorAll('span').forEach(s => {
        s.textContent = s.textContent.startsWith('@') ? '@carol_new' : 'Carol New';
      });
      aliceCell.remove();
      list.insertBefore(carol, list.firstChild);
    });
    await expect.poll(async () => (await getLists(serviceWorker))['Core Members'].members).toContain('@carol_new');

    const tabId = await findXTabId(serviceWorker);
    const preview = await sendToTab(serviceWorker, tabId, { action: 'replacePreview' });
    expect(preview.success).toBe(true);
    expect(preview.listName).toBe('Core Members');
    expect(preview.seenCount).toBe(4); // alice(스크롤로 사라짐), bob, dave_dev, carol_new
    expect(preview.removed).toEqual(['@gone_user']);

    const saved = await sendToTab(serviceWorker, tabId, { action: 'replaceNow' });
    expect(saved.success).toBe(true);
    expect(saved.removedCount).toBe(1);

    const lists = await getLists(serviceWorker);
    expect(lists['Core Members'].members.sort()).toEqual(['@alice', '@bob', '@carol_new', '@dave_dev']);
    expect(lists['Core Members'].color).toBe('#123456');
    expect(lists['Core Members'].mode).toBe('dim');
  });

  test('멤버 화면이 아니면 교체하지 않음', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { 'Core Members': { color: '#123456', mode: 'normal', listId: '123', members: ['@alice'] } } });
    await mockXPage(context, '/i/lists/123', 'synthetic/list-main.html');
    const page = await context.newPage();
    await page.goto('https://x.com/i/lists/123');
    await page.waitForTimeout(800);

    const tabId = await findXTabId(serviceWorker);
    const preview = await sendToTab(serviceWorker, tabId, { action: 'replacePreview' });
    expect(preview.success).toBe(false);
    expect((await getLists(serviceWorker))['Core Members'].members).toEqual(['@alice']);
  });
});

test.describe('[끝까지 스캔] 자동 스크롤', () => {
  // synthetic/list-members-virtual.html: 멤버 45명(@member01~45), 15명씩 불러오는 가상 스크롤 화면
  const ALL_MEMBERS = Array.from({ length: 45 }, (_, i) => '@member' + String(i + 1).padStart(2, '0'));
  const statusOf = (sw, tabId) => sendToTab(sw, tabId, { action: 'autoScanStatus' });

  test('맨 위부터 끝까지 자동으로 스크롤하며 모든 멤버를 읽고, 끝난 뒤에도 뺀 멤버는 자동으로 지우지 않음 (팝업 확인을 기다림)', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, {
      lists: { 'Core Members': { color: '#123456', mode: 'dim', listId: '123', members: ['@member01', '@member02', '@gone_user'] } }
    });
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-virtual.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);
    // 목록 중간에서 시작해도 맨 위로 돌아가서 읽음
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(500);

    const tabId = await findXTabId(serviceWorker);
    const started = await sendToTab(serviceWorker, tabId, { action: 'autoScanStart' });
    expect(started.success).toBe(true);
    expect(started.state).toBe('running');

    await expect.poll(async () => (await statusOf(serviceWorker, tabId)).state, { timeout: 45000, intervals: [500] }).toBe('done');
    const status = await statusOf(serviceWorker, tabId);
    expect(status.seenCount).toBe(45);
    expect(status.listName).toBe('Core Members');

    const preview = await sendToTab(serviceWorker, tabId, { action: 'replacePreview' });
    expect(preview.success).toBe(true);
    expect(preview.seenCount).toBe(45);
    expect(preview.removed).toEqual(['@gone_user']);

    // 끝까지 본 상태가 자동 정리 대기 시간(2.5초)을 넘겨도 지우지 않음. 새 멤버 추가(자동 수집)는 그대로 됨
    await page.waitForTimeout(3800);
    const members = (await getLists(serviceWorker))['Core Members'].members;
    expect(members).toContain('@gone_user');
    expect(members).toContain('@member45');
    expect(members.filter(m => m !== '@gone_user').sort()).toEqual(ALL_MEMBERS);
  });

  test('사용자가 X 화면을 직접 스크롤하면 멈추고, 중지 요청으로도 멈춤', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members-virtual.html');
    const page = await context.newPage();
    await page.goto(MEMBERS_URL);
    await page.waitForTimeout(500);
    const tabId = await findXTabId(serviceWorker);

    expect((await sendToTab(serviceWorker, tabId, { action: 'autoScanStart' })).state).toBe('running');
    await page.waitForTimeout(1500);
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 200);
    await expect.poll(async () => (await statusOf(serviceWorker, tabId)).state).toBe('stopped');
    expect((await statusOf(serviceWorker, tabId)).message).toContain('직접 스크롤');

    expect((await sendToTab(serviceWorker, tabId, { action: 'autoScanStart' })).state).toBe('running');
    const stopped = await sendToTab(serviceWorker, tabId, { action: 'autoScanStop' });
    expect(stopped.state).toBe('stopped');
    // 멈춘 뒤에는 더 스크롤하지 않음
    const y = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
  });

  test('멤버 화면이 아니면 시작하지 않음', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/i/lists/123', 'synthetic/list-main.html');
    const page = await context.newPage();
    await page.goto('https://x.com/i/lists/123');
    await page.waitForTimeout(800);

    const tabId = await findXTabId(serviceWorker);
    const started = await sendToTab(serviceWorker, tabId, { action: 'autoScanStart' });
    expect(started.success).toBe(false);
    expect((await statusOf(serviceWorker, tabId)).state).toBe('idle');
  });
});

test.describe('X 화면 구조 변화 감지', () => {
  test('멤버 화면에 UserCell 이 없으면 경고를 기록하고, 정상 화면을 다시 보면 해제', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/i/lists/999/members', 'synthetic/members-changed.html');
    await mockXPage(context, '/i/lists/123/members', 'synthetic/list-members.html');
    const page = await context.newPage();

    await page.goto('https://x.com/i/lists/999/members');
    await expect.poll(async () => {
      const h = (await getStorage(serviceWorker, ['structureHealth'])).structureHealth;
      return h && h.members && h.members.ok;
    }, { timeout: 12_000 }).toBe(false);
    // 구조를 못 알아봤으므로 저장된 리스트도 없어야 함
    expect(await getLists(serviceWorker)).toEqual({});

    await page.goto(MEMBERS_URL);
    await expect.poll(async () => {
      const h = (await getStorage(serviceWorker, ['structureHealth'])).structureHealth;
      return h && h.members && h.members.ok;
    }, { timeout: 12_000 }).toBe(true);
  });

  test('타임라인에 data-testid="tweet" 이 없으면 경고 기록', async ({ context, serviceWorker }) => {
    await mockXPage(context, '/home', 'synthetic/timeline-changed.html');
    const page = await context.newPage();
    await page.goto('https://x.com/home');
    await expect.poll(async () => {
      const h = (await getStorage(serviceWorker, ['structureHealth'])).structureHealth;
      return h && h.timeline && h.timeline.ok;
    }, { timeout: 12_000 }).toBe(false);
  });

  test('정상 타임라인에서는 아무것도 기록하지 않음', async ({ context, serviceWorker }) => {
    await setStorage(serviceWorker, { lists: { '친구': { color: '#ff0000', mode: 'normal', members: ['@alice'] } } });
    await mockXPage(context, '/home', 'synthetic/home-timeline.html');
    const page = await context.newPage();
    await page.goto('https://x.com/home');
    await expect(page.locator('[data-fixture-id="t-alice"] .ag-list-badge')).toHaveText('친구');
    await page.waitForTimeout(3500);
    expect((await getStorage(serviceWorker, ['structureHealth'])).structureHealth).toBeUndefined();
  });
});
