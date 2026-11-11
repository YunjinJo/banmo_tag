// tests/unit/badges.test.js — extension/shared/badges.js 단위 테스트
// tests/test-runner.html 이 불러옵니다 (describe · it · assert… 도 거기에 있음). 실행 방법은 tests/unit/README.md

describe('타임라인 뱃지 매핑 (buildHandleMap)', () => {
  it('대소문자 무관(Case-insensitive) 핸들 검색 매핑 생성', () => {
    const lists = {
      'AI 연구자': { color: '#7928ca', mode: 'highlight', members: ['@YannLeCun', '@sama'] }
    };
    const map = buildHandleMap(lists);
    assert(map['@yannlecun'] !== undefined, '소문자 키로 조회 가능해야 함');
    assertEqual(map['@yannlecun'][0].name, 'AI 연구자');
    assertEqual(map['@yannlecun'][0].mode, 'highlight');
    assertEqual(map['@sama'][0].color, '#7928ca');
  });

  it('여러 리스트에 중복 소속된 유저의 다중 뱃지 매핑 확인', () => {
    const lists = {
      '테크': { color: '#1d9bf0', mode: 'normal', members: ['@elonmusk'] },
      '우주': { color: '#f4212e', mode: 'highlight', members: ['@elonmusk'] }
    };
    const map = buildHandleMap(lists);
    assertEqual(map['@elonmusk'].length, 2);
    assertEqual(map['@elonmusk'][0].name, '테크');
    assertEqual(map['@elonmusk'][1].name, '우주');
  });
});

describe('리스트 변경 시 바뀐 핸들만 다시 그리기 (diffHandleMaps & isTweetAffected)', () => {
  it('멤버 추가/삭제/색상·모드 변경된 핸들만 반환하고 그대로인 핸들은 제외', () => {
    const before = buildHandleMap({
      '테크': { color: '#111111', mode: 'normal', members: ['@same', '@removed', '@recolor'] }
    });
    const after = buildHandleMap({
      '테크': { color: '#111111', mode: 'normal', members: ['@same', '@added'] },
      '강조': { color: '#ff0000', mode: 'highlight', members: ['@recolor'] }
    });
    const changed = diffHandleMaps(before, after).sort();
    assertDeepEqual(changed, ['@added', '@recolor', '@removed']);
  });

  it('리스트 색상이 바뀌면 그 리스트의 모든 멤버가 바뀐 것으로 판단', () => {
    const before = buildHandleMap({ 'A': { color: '#111111', mode: 'normal', members: ['@a', '@b'] } });
    const after = buildHandleMap({ 'A': { color: '#222222', mode: 'normal', members: ['@a', '@b'] } });
    assertDeepEqual(diffHandleMaps(before, after).sort(), ['@a', '@b']);
    assertDeepEqual(diffHandleMaps(before, before), []);
  });

  it('트윗 처리 서명에 바뀐 핸들이 있을 때만 다시 그림', () => {
    assertEqual(isTweetAffected('@a,@b', ['@b']), true);
    assertEqual(isTweetAffected('@a,@b', new Set(['@c'])), false);
    assertEqual(isTweetAffected('@ab', ['@a']), false, '부분 문자열이 아니라 핸들 단위로 비교');
    assertEqual(isTweetAffected(undefined, ['@a']), false);
    assertEqual(isTweetAffected('@a', []), false);
  });
});

describe('배지 커스텀 스타일(!important) 적용 및 자체 노드 필터링 (applyBadgeStyle)', () => {
  const sandbox = document.getElementById('sandbox');

  it('applyBadgeStyle 호출 시 color, font-size, background-color에 !important 우선순위가 설정됨', () => {
    const badge = document.createElement('span');
    applyBadgeStyle(badge, '#7928ca', { textColor: '#00ffcc', fontSize: 14, fontFamily: 'monospace' }, true);
    assertEqual(badge.style.getPropertyPriority('color'), 'important');
    assertEqual(badge.style.getPropertyPriority('font-size'), 'important');
    assertEqual(badge.style.getPropertyValue('font-size'), '14px');
    assertEqual(badge.style.getPropertyPriority('font-family'), 'important');

    // 미니 배지는 기본 크기보다 2px 작게(최소 8px) 적용
    const miniBadge = document.createElement('span');
    applyBadgeStyle(miniBadge, '#1d9bf0', { textColor: '#ffffff', fontSize: 12, fontFamily: 'system' }, false);
    assertEqual(miniBadge.style.getPropertyValue('font-size'), '10px');
  });

  it('isOwnInjectedNode가 확장 프로그램이 주입한 배지/래퍼 노드를 정확히 판별', () => {
    sandbox.innerHTML = `
      <div class="ag-badges-wrapper" id="w">
        <span class="ag-list-badge" id="b">리스트</span>
      </div>
      <div data-testid="tweet" id="t">일반 트윗 노드</div>
    `;
    assertEqual(isOwnInjectedNode(sandbox.querySelector('#w')), true);
    assertEqual(isOwnInjectedNode(sandbox.querySelector('#b')), true);
    assertEqual(isOwnInjectedNode(sandbox.querySelector('#t')), false);
  });
});

describe('리스트별 배지 글자 스타일 (normalizeListStyle, getEffectiveBadgeSettings, setListStyle)', () => {
  it('normalizeListStyle: 올바른 항목만 남기고, 남는 게 없으면 null', () => {
    assertDeepEqual(normalizeListStyle({ textColor: '#000000', fontSize: '16', fontFamily: 'monospace', extra: 1 }),
      { textColor: '#000000', fontSize: 16, fontFamily: 'monospace' });
    assertDeepEqual(normalizeListStyle({ textColor: 'red', fontSize: 30 }), null);
    assertDeepEqual(normalizeListStyle({ fontSize: 8 }), { fontSize: 8 });
    assertEqual(normalizeListStyle(null), null);
    assertEqual(normalizeListStyle('x'), null);
  });

  it('getEffectiveBadgeSettings: 기본값 ← 공통 설정 ← 리스트 설정 순서로 덮어씀', () => {
    const common = { textColor: '#ffffff', fontSize: 12, fontFamily: 'system' };
    assertDeepEqual(getEffectiveBadgeSettings(common, { fontSize: 16 }), { textColor: '#ffffff', fontSize: 16, fontFamily: 'system' });
    assertDeepEqual(getEffectiveBadgeSettings(common, undefined), common);
    assertDeepEqual(getEffectiveBadgeSettings(common, { fontSize: 99, textColor: '#000000' }),
      { textColor: '#000000', fontSize: 12, fontFamily: 'system' }, '잘못된 값은 무시');
    assertDeepEqual(getEffectiveBadgeSettings(null, null), { textColor: '#ffffff', fontSize: 11, fontFamily: 'system' });
  });

  it('setListStyle: 일부 항목만 저장, null 은 지움, 다 지우면 style 자체 제거, 없는 리스트는 false', () => {
    const lists = { '테크': { color: '#1d9bf0', mode: 'normal', members: ['@a'] } };
    assertEqual(setListStyle(lists, '테크', { fontSize: 15 }), true);
    assertDeepEqual(lists['테크'].style, { fontSize: 15 });
    setListStyle(lists, '테크', { textColor: '#00ff00', bogus: 1 });
    assertDeepEqual(lists['테크'].style, { textColor: '#00ff00', fontSize: 15 });
    setListStyle(lists, '테크', { fontSize: null, textColor: null });
    assertEqual(lists['테크'].style, undefined);
    assertEqual(setListStyle(lists, '없음', { fontSize: 10 }), false);
  });

  it('clearAllListStyles / countListsWithStyle', () => {
    const lists = {
      A: { members: [], style: { fontSize: 15 } },
      B: { members: [] },
      C: { members: [], style: { fontFamily: 'monospace' } }
    };
    assertEqual(countListsWithStyle(lists), 2);
    assertEqual(clearAllListStyles(lists), 2);
    assertEqual(countListsWithStyle(lists), 0);
    assertEqual(lists.A.style, undefined);
  });

  it('배지 매핑에 리스트 스타일이 들어가고, 스타일이 바뀌면 그 리스트 멤버만 다시 그림 대상', () => {
    const before = { A: { color: '#111111', mode: 'normal', members: ['@a'] }, B: { color: '#222222', mode: 'normal', members: ['@b'] } };
    const after = { A: { color: '#111111', mode: 'normal', members: ['@a'], style: { fontSize: 16 } }, B: before.B };
    const map = buildHandleMap(after);
    assertDeepEqual(map['@a'][0].style, { fontSize: 16 });
    assertEqual(map['@b'][0].style, undefined, '스타일이 없으면 항목도 없음');
    assertDeepEqual(diffHandleMaps(buildHandleMap(before), map), ['@a']);
  });

  it('백업 가져오기·저장 정리·자동 수집 저장에서 리스트 스타일을 유지', () => {
    const imported = normalizeImportedLists({ '테크': { members: ['@a'], style: { fontSize: 15, textColor: 'bad' } } });
    assertDeepEqual(imported['테크'].style, { fontSize: 15 });
    const sanitized = sanitizeListsObject({ '테크 (@me)': { color: '#1d9bf0', mode: 'normal', members: ['@a'], style: { fontSize: 14 } } }).newLists;
    assertDeepEqual(sanitized['테크'].style, { fontSize: 14 });
    const saved = applyListSave({ '테크': { color: '#1d9bf0', mode: 'normal', listId: '1', members: ['@a'], style: { fontSize: 14 } } }, '테크', ['@b'], '1');
    assertDeepEqual(saved.lists['테크'].style, { fontSize: 14 });
    const replaced = applyListReplace({ '테크': { color: '#1d9bf0', mode: 'normal', listId: '1', members: ['@a'], style: { fontSize: 14 } } }, '테크', ['@b'], '1');
    assertDeepEqual(replaced.lists['테크'].style, { fontSize: 14 });
  });

  it('normalizeBadgeSettings 는 계속 빈 항목을 기본값으로 채움', () => {
    assertDeepEqual(normalizeBadgeSettings({ fontSize: 15 }), { textColor: '#ffffff', fontSize: 15, fontFamily: 'system' });
    assertDeepEqual(normalizeBadgeSettings(undefined), { textColor: '#ffffff', fontSize: 11, fontFamily: 'system' });
  });
});

describe('배지 부착 위치 (getBadgeAnchor)', () => {
  const sandbox = document.getElementById('sandbox');

  it('이름 링크가 있으면 링크의 부모 요소', () => {
    sandbox.innerHTML = `<div data-testid="User-Name" id="u"><div id="row"><a href="/alice">Alice</a></div><div><span>@alice</span></div></div>`;
    assertEqual(getBadgeAnchor(sandbox.querySelector('#u')).id, 'row');
  });

  it('링크가 없는 인용 트윗 이름 영역에서도 배지 위치를 반환 (첫 자식 요소)', () => {
    sandbox.innerHTML = `<div data-testid="User-Name" id="q"><div id="namebox"><span>Alice</span></div><div><span>@alice</span></div></div>`;
    const anchor = getBadgeAnchor(sandbox.querySelector('#q'));
    assert(anchor !== null, '배지 위치가 있어야 함');
    assertEqual(anchor.id, 'namebox');
  });
});

describe('타임라인 배지 묶기 (splitTimelineBadges, "+N")', () => {
  it('splitTimelineBadges: 3개까지는 모두, 넘으면 2개 + 나머지(+N)', () => {
    const mk = n => Array.from({ length: n }, (_, i) => ({ name: 'L' + i }));
    assertDeepEqual(splitTimelineBadges(mk(3)).visible.map(l => l.name), ['L0', 'L1', 'L2']);
    assertEqual(splitTimelineBadges(mk(3)).hidden.length, 0);
    const five = splitTimelineBadges(mk(5));
    assertDeepEqual(five.visible.map(l => l.name), ['L0', 'L1']);
    assertDeepEqual(five.hidden.map(l => l.name), ['L2', 'L3', 'L4']);
    assertDeepEqual(splitTimelineBadges(mk(4), 4).hidden, []);
    assertDeepEqual(splitTimelineBadges([]), { visible: [], hidden: [] });
  });

  it('splitTimelineBadges: 같은 이름 리스트는 한 번만', () => {
    const r = splitTimelineBadges([{ name: 'A' }, { name: 'A' }, { name: 'B' }, null]);
    assertDeepEqual(r.visible.map(l => l.name), ['A', 'B']);
  });

  it('isOwnInjectedNode: "+N" 묶음 배지도 자기 노드로 인식', () => {
    const more = document.createElement('span');
    more.className = 'ag-badge-more';
    assert(isOwnInjectedNode(more));
  });
});

describe('트윗에 배지 그리기 (getHandleFromUserInfo, addBadges, renderTweet, resetTweetStyle)', () => {
  const sandbox = document.getElementById('sandbox');

  // 가짜 트윗: 작성자(첫 번째)와 인용된 작성자(그 뒤)의 이름 영역 + 본문
  function makeTweet(handles, bodyHtml) {
    const names = handles.map(h => `<div data-testid="User-Name"><div><a href="/${h}">${h}</a></div><div><span>@${h}</span></div></div>`);
    sandbox.innerHTML = `<article data-testid="tweet">${names.join('')}${bodyHtml === undefined ? '<div data-testid="tweetText">본문</div>' : bodyHtml}</article>`;
    return sandbox.querySelector('article');
  }
  const badgeTexts = root => Array.from(root.querySelectorAll('.ag-list-badge'), b => b.textContent);
  const settings = AG_DEFAULT_BADGE_SETTINGS;

  it('getHandleFromUserInfo: "@핸들" 글자를 소문자로, 없으면 프로필 링크에서, 둘 다 없으면 null', () => {
    sandbox.innerHTML = `
      <div id="span"><a href="/Alice">Alice</a><span>@Alice</span></div>
      <div id="link"><a href="/Bob_01">Bob</a></div>
      <div id="none"><span>이름만</span></div>`;
    assertEqual(getHandleFromUserInfo(sandbox.querySelector('#span')), '@alice');
    assertEqual(getHandleFromUserInfo(sandbox.querySelector('#link')), '@bob_01');
    assertEqual(getHandleFromUserInfo(sandbox.querySelector('#none')), null);
  });

  it('addBadges: 리스트 이름을 배지 글자와 툴팁으로 넣고, 다시 불러도 배지가 겹쳐 쌓이지 않음', () => {
    const tweet = makeTweet(['alice']);
    const userInfo = tweet.querySelector(AG_USER_NAME_SELECTOR);
    const lists = [{ name: '친구', color: '#1d9bf0', mode: 'normal' }, { name: '개발', color: '#7928ca', mode: 'normal' }];
    addBadges(userInfo, lists, true, settings);
    addBadges(userInfo, lists, true, settings);
    assertEqual(tweet.querySelectorAll('.ag-badges-wrapper').length, 1);
    assertDeepEqual(badgeTexts(tweet), ['친구', '개발']);
    assertEqual(tweet.querySelector('.ag-list-badge').title, '친구');
    assertEqual(tweet.querySelectorAll('.mini-badge').length, 0, '원 작성자는 일반 배지');
  });

  it('addBadges: 리스트가 3개를 넘으면 2개만 보이고 나머지는 "+N" (툴팁에 전체 이름)', () => {
    const tweet = makeTweet(['alice']);
    const lists = ['가', '나', '다', '라'].map(name => ({ name, color: '#1d9bf0', mode: 'normal' }));
    addBadges(tweet.querySelector(AG_USER_NAME_SELECTOR), lists, true, settings);
    assertDeepEqual(badgeTexts(tweet), ['가', '나']);
    const more = tweet.querySelector('.ag-badge-more');
    assertEqual(more.textContent, '+2');
    assert(more.title.includes('가, 나, 다, 라'), more.title);
    assertEqual(more.getAttribute('aria-label'), more.title);
  });

  it('renderTweet: 리스트 멤버의 트윗에 배지를 붙이고 처리 표시를 남김. 멤버가 아니면 배지 없음', () => {
    const map = buildHandleMap({ '친구': { color: '#1d9bf0', mode: 'normal', members: ['@Alice'] } });
    const member = makeTweet(['alice']);
    renderTweet(member, map, settings);
    assertDeepEqual(badgeTexts(member), ['친구']);
    assertEqual(member.dataset.agProcessed, '@alice');
    assertEqual(member.style.borderLeftStyle, '', '배지만 모드는 테두리 없음');

    const stranger = makeTweet(['zed']);
    renderTweet(stranger, map, settings);
    assertDeepEqual(badgeTexts(stranger), []);
    assertEqual(stranger.dataset.agProcessed, '@zed');
  });

  it('renderTweet: 강조 모드는 왼쪽 테두리, 흐리게 모드는 data-ag-dim, 둘 다면 강조가 우선', () => {
    const lists = {
      '강조': { color: '#ff0000', mode: 'highlight', members: ['@hi', '@both'] },
      '흐림': { color: '#1d9bf0', mode: 'dim', members: ['@dim', '@both'] }
    };
    const map = buildHandleMap(lists);

    const highlighted = makeTweet(['hi']);
    renderTweet(highlighted, map, settings);
    assertEqual(highlighted.style.borderLeftWidth, '4px');
    assertEqual(highlighted.style.borderLeftStyle, 'solid');
    assertEqual(highlighted.dataset.agDim, undefined);

    const dimmed = makeTweet(['dim']);
    renderTweet(dimmed, map, settings);
    assertEqual(dimmed.dataset.agDim, 'body', '본문이 있으면 본문만 흐리게');
    assertEqual(dimmed.style.borderLeftStyle, '');

    const noBody = makeTweet(['dim'], '');
    renderTweet(noBody, map, settings);
    assertEqual(noBody.dataset.agDim, 'all', '흐리게 할 부분을 못 찾으면 트윗 전체');

    const both = makeTweet(['both']);
    renderTweet(both, map, settings);
    assertEqual(both.style.borderLeftStyle, 'solid');
    assertEqual(both.dataset.agDim, undefined);
  });

  it('renderTweet: 인용된 작성자는 미니 배지만 붙고, 그 리스트의 강조·흐리게는 트윗에 적용하지 않음', () => {
    const map = buildHandleMap({ '강조': { color: '#ff0000', mode: 'highlight', members: ['@quoted'] } });
    const tweet = makeTweet(['writer', 'quoted']);
    renderTweet(tweet, map, settings);
    const [mainInfo, quotedInfo] = tweet.querySelectorAll(AG_USER_NAME_SELECTOR);
    assertEqual(mainInfo.querySelectorAll('.ag-list-badge').length, 0);
    assertEqual(quotedInfo.querySelectorAll('.ag-list-badge.mini-badge').length, 1);
    assertEqual(tweet.style.borderLeftStyle, '');
    assertEqual(tweet.dataset.agProcessed, '@writer,@quoted');
  });

  it('renderTweet: 같은 작성자면 다시 그리지 않고, X 가 트윗 DOM 을 다른 작성자에게 재사용하면 지우고 다시 그림', () => {
    const map = buildHandleMap({
      '강조': { color: '#ff0000', mode: 'highlight', members: ['@alice'] },
      '친구': { color: '#1d9bf0', mode: 'normal', members: ['@bob'] }
    });
    const tweet = makeTweet(['alice']);
    renderTweet(tweet, map, settings);
    tweet.querySelector('.ag-list-badge').textContent = '표시';
    renderTweet(tweet, map, settings);
    assertDeepEqual(badgeTexts(tweet), ['표시'], '이미 처리한 트윗은 건드리지 않음');

    // 같은 DOM 이 @bob 의 트윗으로 바뀜
    tweet.querySelector('a').setAttribute('href', '/bob');
    tweet.querySelector('[data-testid="User-Name"] > div:last-child span').textContent = '@bob';
    renderTweet(tweet, map, settings);
    assertDeepEqual(badgeTexts(tweet), ['친구']);
    assertEqual(tweet.style.borderLeftStyle, '', '이전 작성자의 강조 테두리는 지워짐');
    assertEqual(tweet.dataset.agProcessed, '@bob');
  });

  it('resetTweetStyle: 배지 · 테두리 · 흐리게 · 처리 표시를 모두 지움', () => {
    const map = buildHandleMap({ '흐림': { color: '#1d9bf0', mode: 'dim', members: ['@alice'] } });
    const tweet = makeTweet(['alice']);
    renderTweet(tweet, map, settings);
    tweet.style.borderLeft = '4px solid red';
    resetTweetStyle(tweet);
    assertEqual(tweet.querySelectorAll('.ag-badges-wrapper').length, 0);
    assertEqual(tweet.style.borderLeftStyle, '');
    assertEqual(tweet.dataset.agDim, undefined);
    assertEqual(tweet.dataset.agProcessed, undefined);
  });
});
