// tests/fixtures/real/*.html (실제 X 화면 스냅샷)을 자동으로 검사.
// X 가 화면 구조를 바꾸면 여기서 실패해 알려 줍니다. 스냅샷 만드는 법은 tests/fixtures/README.md 참고.
'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect, FIXTURE_DIR, mockXPage, getLists, getStorage } = require('./helpers');

const REAL_DIR = path.join(FIXTURE_DIR, 'real');
const files = fs.existsSync(REAL_DIR) ? fs.readdirSync(REAL_DIR).filter(f => f.endsWith('.html')) : [];

function readMeta(html, name) {
  const m = html.match(new RegExp(`<meta[^>]+name="${name}"[^>]+content="([^"]*)"`));
  return m ? m[1] : null;
}

test.describe('실제 X 화면 스냅샷', () => {
  test.skip(files.length === 0, 'tests/fixtures/real/ 에 스냅샷이 없습니다 (tests/fixtures/README.md 참고)');

  for (const file of files) {
    const html = fs.readFileSync(path.join(REAL_DIR, file), 'utf8');
    const kind = readMeta(html, 'ag-fixture-kind');
    const url = readMeta(html, 'ag-fixture-url');

    test(`${file} (${kind})`, async ({ context, serviceWorker }) => {
      expect(url, 'ag-fixture-url 메타 태그가 필요합니다').toMatch(/^https:\/\/x\.com\//);
      const urlPath = new URL(url).pathname;
      await mockXPage(context, urlPath, path.join('real', file));
      const page = await context.newPage();
      await page.goto(url);
      // 구조 진단이 기록될 만큼 기다림 (content.js 의 확인 주기 + 안정화 시간)
      await page.waitForTimeout(4000);

      const health = (await getStorage(serviceWorker, ['structureHealth'])).structureHealth || {};
      if (kind === 'members') {
        expect(health.members && health.members.ok, `구조 경고: ${health.members && health.members.message}`).not.toBe(false);
        const lists = await getLists(serviceWorker);
        const total = Object.values(lists).reduce((n, l) => n + l.members.length, 0);
        expect(total, '실제 멤버 화면에서 멤버를 1명 이상 수집해야 함').toBeGreaterThan(0);
        // 리스트 이름이 시스템 단어나 "타임라인" 같은 화면 제목이 아니어야 함
        Object.keys(lists).forEach(name => expect(name).not.toMatch(/^(타임라인|Timeline|리스트 멤버|List members)$/));
      } else if (kind === 'list-main') {
        const listId = urlPath.split('/')[3];
        const cached = await page.evaluate(id => sessionStorage.getItem('ag_list_name_' + id), listId);
        expect(cached, '리스트 메인 화면에서 이름을 읽어야 함').toBeTruthy();
      } else {
        expect(health.timeline && health.timeline.ok, `구조 경고: ${health.timeline && health.timeline.message}`).not.toBe(false);
        const tweets = await page.locator('article[data-testid="tweet"] [data-testid="User-Name"]').count();
        expect(tweets, '트윗 작성자 영역(User-Name)을 찾아야 함').toBeGreaterThan(0);
      }
    });
  }
});
