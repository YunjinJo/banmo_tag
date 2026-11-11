// tests/unit/list-page.test.js — extension/shared/list-page.js 단위 테스트
// tests/test-runner.html 이 불러옵니다 (describe · it · assert… 도 거기에 있음). 실행 방법은 tests/unit/README.md

describe('리스트 URL 파싱 및 수집 차단 정책 (parseListUrl & getScrapeBlockReason)', () => {
  const sandbox = document.getElementById('sandbox');

  it('/i/lists/:id 및 /members, /followers URL 정확히 판별', () => {
    const mainInfo = parseListUrl('https://x.com/i/lists/123456789');
    assert(mainInfo !== null, '리스트 URL은 객체를 반환해야 함');
    assertEqual(mainInfo.isMain, true);
    assertEqual(mainInfo.isMembers, false);
    assertEqual(mainInfo.isFollowers, false);
    assertEqual(mainInfo.listId, '123456789');

    const membersInfo = parseListUrl('/i/lists/123456789/members');
    assertEqual(membersInfo.isMembers, true);
    assertEqual(membersInfo.isMain, false);

    const followersInfo = parseListUrl('/i/lists/123456789/followers');
    assertEqual(followersInfo.isFollowers, true);

    const homeInfo = parseListUrl('https://x.com/home');
    assertEqual(homeInfo, null);
  });

  it('비리스트 페이지 및 팔로워(/followers) 페이지는 자동/수동 모두 차단 사유 반환', () => {
    sandbox.innerHTML = '<div></div>';
    assert(getScrapeBlockReason(parseListUrl('/home'), sandbox, null, true) !== null, '비리스트 페이지 차단');
    assert(getScrapeBlockReason(parseListUrl('/i/lists/123/followers'), sandbox, null, true) !== null, '팔로워 뷰 차단');
  });

  it('"추천" 또는 "Suggested" 탭이 활성화된 경우 자동/수동 모두 차단 사유 반환', () => {
    sandbox.innerHTML = `
      <div role="dialog" id="dlg">
        <div role="tab" aria-selected="true">추천</div>
      </div>
    `;
    const dlg = sandbox.querySelector('#dlg');
    const urlInfo = parseListUrl('/i/lists/123/members');
    assert(getScrapeBlockReason(urlInfo, dlg, dlg, false) !== null, '자동 수집 추천 탭 차단');
    assert(getScrapeBlockReason(urlInfo, dlg, dlg, true) !== null, '수동 수집 추천 탭 차단');
  });

  it('일반 리스트 타임라인(/i/lists/:id, 모달 없음)은 자동 수집 차단, 수동 수집은 허용(null)', () => {
    sandbox.innerHTML = '<div id="main"></div>';
    const urlInfo = parseListUrl('/i/lists/123');
    assert(getScrapeBlockReason(urlInfo, sandbox, null, false) !== null, '일반 타임라인 자동 수집 차단');
    assertEqual(getScrapeBlockReason(urlInfo, sandbox, null, true), null);
  });

  it('멤버 뷰(/members)에서 "구성원" 탭 활성화 시 자동 수집 정상 허용(null)', () => {
    sandbox.innerHTML = `
      <div role="dialog" id="dlg">
        <div role="tab" aria-selected="true">구성원</div>
      </div>
    `;
    const dlg = sandbox.querySelector('#dlg');
    const urlInfo = parseListUrl('/i/lists/123/members');
    assertEqual(getScrapeBlockReason(urlInfo, dlg, dlg, false), null);
  });
});

describe('팝업 [가져오기] 대상 탭 검사 (getSyncTabError)', () => {
  it('탭 자체가 없을 때만 "활성화된 탭을 찾을 수 없습니다"', () => {
    assertEqual(getSyncTabError(undefined), '활성화된 탭을 찾을 수 없습니다.');
  });

  it('url 이 없는 탭(tabs 권한 없음 → X 가 아닌 탭)은 "X 페이지가 아닙니다"로 안내', () => {
    assertEqual(getSyncTabError({ id: 3 }), '현재 탭이 X(Twitter) 페이지가 아닙니다.');
    assertEqual(getSyncTabError({ id: 3, url: 'https://example.com/' }), '현재 탭이 X(Twitter) 페이지가 아닙니다.');
  });

  it('x.com / twitter.com 탭은 통과(null)', () => {
    assertEqual(getSyncTabError({ id: 3, url: 'https://x.com/i/lists/1/members' }), null);
    assertEqual(getSyncTabError({ id: 3, url: 'https://mobile.twitter.com/home' }), null);
  });
});

describe('화면에서 리스트 이름 읽기 (getMemberListDialog, firstValidCleanName, getListNameFromPage)', () => {
  // 가짜 X 화면: 탭 제목과 본문 HTML 로 별도 문서를 만듦 (테스트 러너 화면과 섞이지 않게)
  function makePage(title, bodyHtml) {
    const page = document.implementation.createHTMLDocument(title);
    page.body.innerHTML = bodyHtml;
    return page;
  }

  // content.js 가 넘기는 sessionStorage 캐시 대신 쓰는 가짜 캐시
  function makeCache(initial) {
    const store = Object.assign({}, initial);
    return {
      store,
      get: key => (key in store ? store[key] : null),
      set: (key, value) => { store[key] = value; }
    };
  }

  const mainUrl = parseListUrl('/i/lists/123');
  const membersUrl = parseListUrl('/i/lists/123/members');

  it('getMemberListDialog: 제목에 멤버·구성원·Member 가 있거나 UserCell 이 있는 창만 멤버 창으로 봄', () => {
    const other = makePage('', '<div role="dialog"><h2>게시하기</h2></div>');
    assertEqual(getMemberListDialog(other), null);

    const byTitle = makePage('', '<div role="dialog" id="post"><h2>게시하기</h2></div><div role="dialog" id="members"><h2>리스트 멤버</h2></div>');
    assertEqual(getMemberListDialog(byTitle).id, 'members');

    const byCell = makePage('', '<div role="dialog" id="cells"><div data-testid="UserCell"></div></div>');
    assertEqual(getMemberListDialog(byCell).id, 'cells');
  });

  it('firstValidCleanName: 시스템 단어와 건너뛸 글자를 지나 처음 나오는 올바른 이름', () => {
    const page = makePage('', '<h2>리스트</h2><h2>팔로우 추천</h2><h2>테크 뉴스 (@me)</h2><h2>다른 이름</h2>');
    const headings = page.querySelectorAll('h2');
    assertEqual(firstValidCleanName(headings, text => text.includes('팔로우 추천')), '테크 뉴스');
    assertEqual(firstValidCleanName(page.querySelectorAll('h3')), '');
  });

  it('리스트 메인 화면: 본문 제목을 이름으로 읽고 캐시에 적어 둠', () => {
    const page = makePage('X', '<main><h2>팔로우 추천</h2><h2>테크 뉴스</h2></main>');
    const cache = makeCache();
    assertEqual(getListNameFromPage(page, mainUrl, null, cache), '테크 뉴스');
    assertDeepEqual(cache.store, { ag_list_name_123: '테크 뉴스' });
  });

  it('멤버 창이 떠 있으면 배경 화면의 제목·탭 제목은 읽지 않고, 캐시에 적어 둔 이름을 씀', () => {
    const page = makePage('내 홈 타임라인', '<main><h2>내 홈 타임라인</h2></main><div role="dialog"><h2>리스트 멤버</h2></div>');
    const dialog = getMemberListDialog(page);
    assertEqual(getListNameFromPage(page, membersUrl, dialog, makeCache({ ag_list_name_123: '테크 뉴스' })), '테크 뉴스');
  });

  it('이름을 찾지 못하면 "리스트 (ID)" 임시 이름을 쓰고, 임시 이름은 캐시에 적지 않음', () => {
    const page = makePage('내 홈 타임라인', '<main><h2>내 홈 타임라인</h2></main><div role="dialog"><h2>리스트 멤버</h2></div>');
    const cache = makeCache();
    assertEqual(getListNameFromPage(page, membersUrl, getMemberListDialog(page), cache), '리스트 (123)');
    assertDeepEqual(cache.store, {});
    assertEqual(getListNameFromPage(page, null, getMemberListDialog(page), cache), 'Unknown List');
  });

  it('멤버 창의 제목이 실제 이름이면 그 이름을 씀', () => {
    const page = makePage('', '<div role="dialog"><h2>테크 뉴스</h2><div data-testid="UserCell"></div></div>');
    assertEqual(getListNameFromPage(page, membersUrl, getMemberListDialog(page)), '테크 뉴스');
  });

  it('본문 제목이 없으면 브라우저 탭 제목에서 읽음 ("AI - 연구자" 처럼 - 가 있는 이름 보존)', () => {
    const page = makePage('AI - 연구자', '<main></main>');
    assertEqual(getListNameFromPage(page, mainUrl, null), 'AI - 연구자');
  });

  it('상단 바에서 읽은 이름은 확실하지 않으므로 캐시에 적지 않음', () => {
    const page = makePage('', '<header role="banner"><span>뒤로</span><span>@me</span><span>테크 뉴스</span></header>');
    const cache = makeCache();
    assertEqual(getListNameFromPage(page, mainUrl, null, cache), '테크 뉴스');
    assertDeepEqual(cache.store, {});
  });
});

describe('팔로우 추천 차단 및 모달 창 격리 (isExcludedUserCell)', () => {
  const sandbox = document.getElementById('sandbox');

  it('모달 창(dialog) 내부의 정상 멤버 셀은 포함(false) 판정', () => {
    sandbox.innerHTML = `
      <div role="dialog">
        <div data-testid="UserCell" id="cell-inside-dialog">
          <a href="/member_user">@member_user</a>
        </div>
      </div>
    `;
    const dialog = sandbox.querySelector('div[role="dialog"]');
    const cell = sandbox.querySelector('#cell-inside-dialog');
    assertEqual(isExcludedUserCell(cell, dialog), false);
  });

  it('모달 창이 열렸을 때, 창 뒤쪽 배경의 유저 셀은 100% 차단(true) 판정', () => {
    sandbox.innerHTML = `
      <div id="background-page">
        <div data-testid="UserCell" id="cell-behind-dialog">
          <a href="/recommended_user">@recommended_user</a>
        </div>
      </div>
      <div role="dialog">
        <h2>멤버 목록</h2>
      </div>
    `;
    const dialog = sandbox.querySelector('div[role="dialog"]');
    const cell = sandbox.querySelector('#cell-behind-dialog');
    assertEqual(isExcludedUserCell(cell, dialog), true);
  });

  it('사이드바(sidebarColumn, aside) 내부의 팔로우 추천 셀 차단 판정', () => {
    sandbox.innerHTML = `
      <div data-testid="sidebarColumn">
        <aside>
          <div data-testid="UserCell" id="cell-in-sidebar">
            <a href="/sidebar_reco">@sidebar_reco</a>
          </div>
        </aside>
      </div>
    `;
    const cell = sandbox.querySelector('#cell-in-sidebar');
    assertEqual(isExcludedUserCell(cell, null), true);
  });

  it('aria-label="팔로우 추천" 컨테이너 내부 셀 차단 판정', () => {
    sandbox.innerHTML = `
      <div aria-label="팔로우 추천">
        <div data-testid="UserCell" id="cell-reco-label">
          <a href="/who_to_follow">@who_to_follow</a>
        </div>
      </div>
    `;
    const cell = sandbox.querySelector('#cell-reco-label');
    assertEqual(isExcludedUserCell(cell, null), true);
  });

  it('모달 내부라도 "추천" 탭 활성화 시 셀 차단 판정', () => {
    sandbox.innerHTML = `
      <div role="dialog">
        <div role="tab" aria-selected="true">추천</div>
        <div data-testid="UserCell" id="cell-reco-tab">
          <a href="/suggested_user">@suggested_user</a>
        </div>
      </div>
    `;
    const dialog = sandbox.querySelector('div[role="dialog"]');
    const cell = sandbox.querySelector('#cell-reco-tab');
    assertEqual(isExcludedUserCell(cell, dialog), true);
  });
});

describe('추천 계정 필터 범위 축소 (isExcludedUserCell)', () => {
  const sandbox = document.getElementById('sandbox');

  it('목록 아래쪽에 "팔로우 추천" 제목이 있어도 그 위의 멤버는 수집하고, 아래 셀만 제외', () => {
    sandbox.innerHTML = `
      <div data-testid="primaryColumn"><section><div id="list">
        <div data-testid="cellInnerDiv"><div data-testid="UserCell"><a href="/alice">Alice</a></div></div>
        <div data-testid="cellInnerDiv"><div data-testid="UserCell"><a href="/bob">Bob</a></div></div>
        <div data-testid="cellInnerDiv"><h2>팔로우 추천</h2></div>
        <div data-testid="cellInnerDiv"><div data-testid="UserCell"><a href="/carol">Carol</a></div></div>
      </div></section></div>`;
    assertDeepEqual(extractMembersFromContainer(sandbox.querySelector('#list'), null), ['@alice', '@bob']);
  });

  it('aria-label 에 "Connect"/"추천"이 일부 포함된 것만으로는 제외하지 않음 (전체 일치)', () => {
    sandbox.innerHTML = `
      <div aria-label="타임라인: Connected 친구들" id="c1">
        <div data-testid="cellInnerDiv"><div data-testid="UserCell"><a href="/dave">Dave</a></div></div>
      </div>
      <div aria-label="타임라인: 추천 작가 모음" id="c2">
        <div data-testid="cellInnerDiv"><div data-testid="UserCell"><a href="/erin">Erin</a></div></div>
      </div>`;
    assertDeepEqual(extractMembersFromContainer(sandbox.querySelector('#c1'), null), ['@dave']);
    assertDeepEqual(extractMembersFromContainer(sandbox.querySelector('#c2'), null), ['@erin']);
  });

  it('"타임라인: 팔로우 추천" 처럼 접두사가 붙은 추천 영역 표기는 계속 제외', () => {
    sandbox.innerHTML = `
      <div aria-label="타임라인: 팔로우 추천" id="c3">
        <div data-testid="UserCell"><a href="/reco">Reco</a></div>
      </div>`;
    assertDeepEqual(extractMembersFromContainer(sandbox.querySelector('#c3'), null), []);
  });

  it('리스트 헤더 이름("추천 작가")이 앞에 있어도 멤버를 제외하지 않음', () => {
    sandbox.innerHTML = `
      <div id="list2">
        <div data-testid="cellInnerDiv"><h2>추천 작가</h2></div>
        <div data-testid="cellInnerDiv"><div data-testid="UserCell"><a href="/frank">Frank</a></div></div>
      </div>`;
    assertDeepEqual(extractMembersFromContainer(sandbox.querySelector('#list2'), null), ['@frank']);
  });
});

describe('순수 멤버 유저 추출 (extractMembersFromContainer)', () => {
  const sandbox = document.getElementById('sandbox');

  it('멤버 모달 창 내부의 실제 멤버들만 정확히 추출 (배경 추천 계정 배제)', () => {
    sandbox.innerHTML = `
      <div id="background-page">
        <div data-testid="UserCell"><a href="/fake_reco_user">@fake_reco_user</a></div>
      </div>
      <div role="dialog" id="active-dialog">
        <div role="tab" aria-selected="true">구성원</div>
        <div data-testid="UserCell"><a href="/real_member1">@real_member1</a></div>
        <div data-testid="UserCell"><a href="/real_member2">@real_member2</a></div>
      </div>
    `;
    const dialog = sandbox.querySelector('#active-dialog');
    const members = extractMembersFromContainer(dialog, dialog);
    assertDeepEqual(members, ['@real_member1', '@real_member2']);
  });

  it('시스템 예약어 링크(home, explore 등)는 멤버에서 제외', () => {
    sandbox.innerHTML = `
      <div data-testid="primaryColumn" id="members-page">
        <div data-testid="UserCell"><a href="/home">Home</a></div>
        <div data-testid="UserCell"><a href="/valid_user">@valid_user</a></div>
      </div>
    `;
    const container = sandbox.querySelector('#members-page');
    const members = extractMembersFromContainer(container, null);
    assertDeepEqual(members, ['@valid_user']);
  });
});

describe('수집 결과 서명 (buildScrapeSignature)', () => {
  it('buildScrapeSignature가 멤버 순서와 대소문자에 무관하게 동일한 시그니처 생성', () => {
    const sig1 = buildScrapeSignature('테크', ['@Bob', '@alice']);
    const sig2 = buildScrapeSignature('테크', ['@ALICE', '@bob']);
    assertEqual(sig1, sig2);
  });
});
