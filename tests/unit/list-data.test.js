// tests/unit/list-data.test.js — extension/shared/list-data.js 단위 테스트
// tests/test-runner.html 이 불러옵니다 (describe · it · assert… 도 거기에 있음). 실행 방법은 tests/unit/README.md

describe('기존 저장 데이터 자동 마이그레이션 (sanitizeListsObject)', () => {
  it('태그가 붙어있던 기존 리스트 키를 순수한 이름으로 변경 및 마이그레이션', () => {
    const oldLists = {
      '친구들 (@my_id)': { color: '#1d9bf0', mode: 'normal', members: ['@user1', '@user2'] },
      '개발자': { color: '#00ba7c', mode: 'highlight', members: ['@dev1'] }
    };
    const { newLists, modified } = sanitizeListsObject(oldLists);
    assertEqual(modified, true);
    assert(newLists['친구들'] !== undefined, '친구들 키가 생성되어야 함');
    assert(newLists['친구들 (@my_id)'] === undefined, '구버전 키는 삭제되어야 함');
    assertEqual(newLists['친구들'].members.length, 2);
  });

  it('태그 제거 후 키가 중복되는 경우 멤버 목록 자동 병합 및 중복 제거', () => {
    const oldLists = {
      '테크': { color: '#1d9bf0', mode: 'normal', members: ['@apple', '@google'] },
      '테크 (@my_id)': { color: '#1d9bf0', mode: 'normal', members: ['@google', '@meta'] }
    };
    const { newLists, modified } = sanitizeListsObject(oldLists);
    assertEqual(modified, true);
    assertEqual(Object.keys(newLists).length, 1);
    assertEqual(newLists['테크'].members.length, 3); // apple, google, meta
  });

  it('수정할 내역이 없는 순수 데이터는 modified: false 반환', () => {
    const cleanLists = {
      '테크': { color: '#1d9bf0', mode: 'normal', members: ['@apple'] }
    };
    const { modified } = sanitizeListsObject(cleanLists);
    assertEqual(modified, false);
  });

  it('스토리지 내 "멤버 관리" 등 시스템 단어 리스트 자동 삭제', () => {
    const oldLists = {
      '멤버 관리': { color: '#1d9bf0', mode: 'normal', members: ['@u1', '@u2'] },
      '정상 리스트': { color: '#1d9bf0', mode: 'normal', members: ['@u3'] }
    };
    const { newLists, modified } = sanitizeListsObject(oldLists);
    assertEqual(modified, true);
    assertEqual(newLists['멤버 관리'], undefined);
    assert(newLists['정상 리스트'] !== undefined, '정상 리스트는 유지되어야 함');
  });

  it('스토리지 내 (3) @tag/ 리스트 키가 순수 리스트명으로 자동 마이그레이션', () => {
    const oldLists = {
      '(3) @YunjinJo98/10일페 일요일 만날 사람~': { color: '#1d9bf0', mode: 'normal', members: ['@u1', '@u2'] }
    };
    const { newLists, modified } = sanitizeListsObject(oldLists);
    assertEqual(modified, true);
    assertEqual(newLists['(3) @YunjinJo98/10일페 일요일 만날 사람~'], undefined);
    assert(newLists['10일페 일요일 만날 사람~'] !== undefined);
    assertEqual(newLists['10일페 일요일 만날 사람~'].members.length, 2);
  });
});

describe('정제 중 동명 이질 리스트 분리 (sanitizeListsObject)', () => {
  it('정제 후 이름이 같아도 listId 가 다르면 합치지 않고 각자의 멤버/색상/모드를 유지', () => {
    const { newLists, modified } = sanitizeListsObject({
      'A (@x)': { color: '#ff0000', mode: 'highlight', members: ['@a1'], listId: '1' },
      'A': { color: '#00ff00', mode: 'dim', members: ['@b1'], listId: '2' }
    });
    assertEqual(modified, true);
    assertEqual(Object.keys(newLists).length, 2);
    // 원래 "A" 를 쓰던 리스트(id 2)가 이름을 유지
    assertEqual(newLists['A'].listId, '2');
    assertEqual(newLists['A'].mode, 'dim');
    assertDeepEqual(newLists['A'].members, ['@b1']);
    assertEqual(newLists['A (1)'].listId, '1');
    assertEqual(newLists['A (1)'].color, '#ff0000');
    assertDeepEqual(newLists['A (1)'].members, ['@a1']);
  });

  it('같은 listId 이거나 한쪽에 listId 가 없으면 기존처럼 병합', () => {
    const same = sanitizeListsObject({
      'B': { color: '#111111', mode: 'normal', members: ['@x'], listId: '9' },
      'B (@me)': { color: '#222222', mode: 'normal', members: ['@y'], listId: '9' }
    }).newLists;
    assertEqual(Object.keys(same).length, 1);
    assertDeepEqual(same['B'].members, ['@x', '@y']);

    const noId = sanitizeListsObject({
      'C': { color: '#111111', mode: 'normal', members: ['@x'] },
      'C (@me)': { color: '#222222', mode: 'normal', members: ['@y'], listId: '5' }
    }).newLists;
    assertEqual(Object.keys(noId).length, 1);
    assertEqual(noId['C'].listId, '5');
  });

  it('분리된 결과를 다시 정제해도 바뀌지 않음 (무한 저장 루프 없음)', () => {
    const first = sanitizeListsObject({
      'A (@x)': { members: ['@a1'], listId: '1' },
      'A': { members: ['@b1'], listId: '2' }
    }).newLists;
    const second = sanitizeListsObject(first);
    assertEqual(second.modified, false);
    assertDeepEqual(second.newLists, first);
  });

  it('백업 가져오기(normalizeImportedLists)에서도 동명 이질 리스트가 분리됨', () => {
    const imp = normalizeImportedLists({
      'A (@x)': { members: ['@a1'], listId: '1' },
      'A': { members: ['@b1'], listId: '2' }
    });
    assertEqual(Object.keys(imp).length, 2);
  });
});

describe('폴백 리스트명 자동 승격 및 listId 기반 병합 (resolveListKey)', () => {
  it('isFallbackListName이 "리스트 (12345)" 형태만 정확히 폴백으로 감지', () => {
    assertEqual(isFallbackListName('리스트 (123456)'), true);
    assertEqual(isFallbackListName('코인 리스트 (2026)'), false);
    assertEqual(isFallbackListName('내 리스트'), false);
  });

  it('기존에 "리스트 (ID)"로 저장된 항목이 있을 때 실제 리스트명이 들어오면 renameFrom 반환하여 승격 유도', () => {
    const lists = {
      '리스트 (999888)': { color: '#ff0000', mode: 'highlight', listId: '999888', members: ['@u1'] }
    };
    const resolved = resolveListKey(lists, '진짜 리스트 이름', '999888');
    assertEqual(resolved.renameFrom, '리스트 (999888)');
    assertEqual(resolved.key, '진짜 리스트 이름');
  });

  it('이미 실제 이름으로 저장된 리스트(listId 일치)에 폴백 이름이 들어오면 기존 실제 이름을 유지', () => {
    const lists = {
      '실제 이름': { color: '#00ba7c', mode: 'normal', listId: '777666', members: ['@u1', '@u2'] }
    };
    const resolved = resolveListKey(lists, '리스트 (777666)', '777666');
    assertEqual(resolved.renameFrom, null);
    assertEqual(resolved.key, '실제 이름');
  });

  it('이름이 같지만 서로 다른 listId 를 가진 별개 리스트는 접미사를 붙여 충돌을 방지', () => {
    const lists = {
      '친구': { color: '#1d9bf0', mode: 'normal', listId: '11112222', members: ['@a'] }
    };
    const resolved = resolveListKey(lists, '친구', '99998888');
    assertEqual(resolved.renameFrom, null);
    assertEqual(resolved.key, '친구 (8888)');
  });
});

describe('리스트 저장 통합 파이프라인 및 하이픈 보존 (applyListSave & mergeHandles)', () => {
  it('하이픈(-)이 포함된 실제 리스트 이름("AI - 연구자")이 잘리지 않고 온전히 보존됨', () => {
    const title = '리스트 멤버 - AI - 연구자 (@my_handle) / X';
    assertEqual(cleanListName(title), 'AI - 연구자');
  });

  it('applyListSave가 폴백 리스트를 실제 이름으로 승격하고 기존 색상/모드/멤버를 보존하여 병합', () => {
    const initial = {
      '리스트 (555666)': { color: '#ff0055', mode: 'highlight', listId: '555666', members: ['@Alpha'] }
    };
    const res = applyListSave(initial, 'AI - 연구자 (@me)', ['@alpha', '@Beta'], '555666');
    assertEqual(res.success, true);
    assertEqual(res.listName, 'AI - 연구자');
    assertEqual(res.added, 1);
    assertEqual(res.count, 2);
    assertEqual(res.lists['리스트 (555666)'], undefined);
    assertEqual(res.lists['AI - 연구자'].color, '#ff0055');
    assertEqual(res.lists['AI - 연구자'].mode, 'highlight');
    assertDeepEqual(res.lists['AI - 연구자'].members, ['@Alpha', '@Beta']);
  });

  it('applyListSave가 변경 사항이 없을 때 noChange: true를 반환하여 불필요한 스토리지 쓰기 방지', () => {
    const initial = {
      '테크': { color: '#1d9bf0', mode: 'normal', listId: '100', members: ['@user1', '@user2'] }
    };
    const res = applyListSave(initial, '테크', ['@USER1', '@user2'], '100');
    assertEqual(res.success, true);
    assertEqual(res.noChange, true);
    assertEqual(res.added, 0);
  });
});

describe('멤버 목록 교체 동기화 (applyListReplace)', () => {
  it('확인되지 않은 멤버는 삭제, 새 멤버는 추가, 기존 표기·색상·모드·listId 는 유지', () => {
    const initial = { '테크': { color: '#ff0055', mode: 'highlight', listId: '100', members: ['@Alice', '@bob', '@gone'] } };
    const res = applyListReplace(initial, '테크', ['@alice', '@BOB', '@new_one'], '100');
    assertEqual(res.success, true);
    assertEqual(res.listName, '테크');
    assertDeepEqual(res.lists['테크'].members, ['@Alice', '@bob', '@new_one']);
    assertDeepEqual(res.removed, ['@gone']);
    assertEqual(res.added, 1);
    assertEqual(res.previousCount, 3);
    assertEqual(res.lists['테크'].color, '#ff0055');
    assertEqual(res.lists['테크'].mode, 'highlight');
  });

  it('입력 객체를 바꾸지 않음 (미리보기에 그대로 사용 가능)', () => {
    const initial = { '테크': { color: '#ff0055', mode: 'normal', listId: '100', members: ['@a', '@b'] } };
    const snapshot = JSON.stringify(initial);
    applyListReplace(initial, '테크', ['@a'], '100');
    assertEqual(JSON.stringify(initial), snapshot);
  });

  it('같은 listId 의 폴백 이름("리스트 (ID)")은 실제 이름으로 승격하며 교체', () => {
    const initial = { '리스트 (555)': { color: '#00ff00', mode: 'dim', listId: '555', members: ['@x', '@y'] } };
    const res = applyListReplace(initial, '진짜 이름', ['@y'], '555');
    assertEqual(res.listName, '진짜 이름');
    assertEqual(res.lists['리스트 (555)'], undefined);
    assertDeepEqual(res.lists['진짜 이름'].members, ['@y']);
    assertEqual(res.lists['진짜 이름'].mode, 'dim');
    assertDeepEqual(res.removed, ['@x']);
  });

  it('확인한 멤버가 없거나 시스템 단어 이름이면 실패 (목록을 비우지 않음)', () => {
    assertEqual(applyListReplace({}, '테크', [], '1').success, false);
    assertEqual(applyListReplace({}, '테크', ['bad-handle!'], '1').success, false);
    assertEqual(applyListReplace({}, '멤버 관리', ['@a'], '1').success, false);
  });
});

describe('직접 리스트 추가 (applyManualAdd)', () => {
  it('기존 리스트에 추가하면 멤버만 합치고 사용자가 정한 색상/모드/listId 는 유지', () => {
    const lists = { '테크': { color: '#ff0055', mode: 'highlight', listId: '1', members: ['@a'] } };
    const res = applyManualAdd(lists, '테크', ['@b', '@A'], '#1d9bf0', 'normal');
    assertEqual(res.created, false);
    assertEqual(res.total, 2);
    assertEqual(lists['테크'].color, '#ff0055');
    assertEqual(lists['테크'].mode, 'highlight');
    assertEqual(lists['테크'].listId, '1');
  });

  it('새 리스트는 폼의 색상/모드로 만들고, 잘못된 값은 기본값 사용', () => {
    const lists = {};
    const res = applyManualAdd(lists, '새 리스트', ['@a'], '#00ff00', 'dim');
    assertEqual(res.created, true);
    assertEqual(lists['새 리스트'].color, '#00ff00');
    assertEqual(lists['새 리스트'].mode, 'dim');
    applyManualAdd(lists, '다른 리스트', ['@a'], 'red', 'bogus');
    assertEqual(lists['다른 리스트'].color, '#1d9bf0');
    assertEqual(lists['다른 리스트'].mode, 'normal');
  });
});

describe('직접 추가한 리스트는 "X"·"Home" 같은 이름도 허용 (manual)', () => {
  it('직접 추가로 만든 리스트에는 manual: true 가 붙고, 정제 과정에서 지워지지 않음', () => {
    const lists = {};
    applyManualAdd(lists, 'X', ['@a'], '#00ff00', 'normal');
    applyManualAdd(lists, 'Home', ['@b'], '#00ff00', 'normal');
    assertEqual(lists['X'].manual, true);
    const { newLists, modified } = sanitizeListsObject(lists);
    assertEqual(modified, false);
    assertDeepEqual(Object.keys(newLists).sort(), ['Home', 'X']);
  });

  it('자동 수집으로 생긴 시스템 단어 리스트(manual 없음)는 계속 삭제', () => {
    const { newLists } = sanitizeListsObject({
      'X': { color: '#1d9bf0', mode: 'normal', members: ['@a'] },
      '멤버 관리': { color: '#1d9bf0', mode: 'normal', members: ['@b'] },
      '수동 리스트': { color: '#1d9bf0', mode: 'normal', members: ['@c'], manual: true }
    });
    assertDeepEqual(Object.keys(newLists), ['수동 리스트']);
    assertEqual(applyListSave({}, 'Home', ['@a'], '1').success, false, '자동 수집은 여전히 차단');
  });

  it('백업 가져오기에서도 manual 표시를 보존해 "X" 리스트가 사라지지 않음', () => {
    const imp = normalizeImportedLists({ 'X': { color: '#ff0000', mode: 'dim', members: ['@a'], manual: true } });
    assertEqual(imp['X'].manual, true);
    assertEqual(imp['X'].mode, 'dim');
  });

  it('getManualListNameError: 빈 이름·50자 초과만 거부', () => {
    assertEqual(getManualListNameError('X'), null);
    assertEqual(getManualListNameError('리스트'), null);
    assertEqual(getManualListNameError('   '), '리스트 이름을 입력해주세요.');
    assertEqual(getManualListNameError('가'.repeat(51)), '리스트 이름은 50자 이하로 입력해주세요.');
  });
});

describe('개별 멤버 삭제 (removeMemberFromLists 검증)', () => {
  it('특정 핸들만 대소문자 무관하게 리스트에서 정확하게 제거하고 변경 여부를 반환', () => {
    const listData = {
      '개발자': { color: '#1d9bf0', mode: 'normal', members: ['@user1', '@User2', '@user3'] }
    };
    const changed = removeMemberFromLists(listData, '개발자', '@user2');
    assertEqual(changed, true);
    assertDeepEqual(listData['개발자'].members, ['@user1', '@user3']);

    const unchanged = removeMemberFromLists(listData, '개발자', '@nonexistent');
    assertEqual(unchanged, false);
  });
});

describe('X 에서 바뀐 리스트 이름 따라가기 (resolveListKey followRename, applyListSave, applyListReplace)', () => {
  const stored = () => ({
    '옛 이름': { color: '#ff0055', mode: 'highlight', listId: '555', members: ['@a'], style: { fontSize: 14 } }
  });

  it('followRename 을 넘기지 않으면 예전처럼 저장된 이름을 유지 (백업 가져오기·저장 데이터 정리)', () => {
    const resolved = resolveListKey(stored(), '새 이름', '555');
    assertEqual(resolved.key, '옛 이름');
    assertEqual(resolved.renameFrom, null);
  });

  it('followRename 이면 같은 listId 의 리스트를 새 이름으로 옮김', () => {
    const resolved = resolveListKey(stored(), '새 이름', '555', true);
    assertEqual(resolved.key, '새 이름');
    assertEqual(resolved.renameFrom, '옛 이름');
  });

  it('팝업에서 직접 지은 이름(customName)은 X 이름으로 바꾸지 않음', () => {
    const lists = stored();
    lists['옛 이름'].customName = true;
    const resolved = resolveListKey(lists, '새 이름', '555', true);
    assertEqual(resolved.key, '옛 이름');
    assertEqual(resolved.renameFrom, null);
  });

  it('새 이름을 다른 리스트가 쓰고 있으면 옮기지 않음 (다른 리스트와 섞이지 않게)', () => {
    const lists = stored();
    lists['새 이름'] = { color: '#00aa00', mode: 'normal', listId: '777', members: ['@z'] };
    assertEqual(resolveListKey(lists, '새 이름', '555', true).key, '옛 이름');

    // 이름이 겹쳐 "친구 (8888)" 로 저장된 리스트는 다시 수집해도 그 이름을 유지
    const friends = {
      '친구': { color: '#1d9bf0', mode: 'normal', listId: '11112222', members: ['@a'] },
      '친구 (8888)': { color: '#1d9bf0', mode: 'normal', listId: '99998888', members: ['@b'] }
    };
    const resolved = resolveListKey(friends, '친구', '99998888', true);
    assertEqual(resolved.key, '친구 (8888)');
    assertEqual(resolved.renameFrom, null);
  });

  it('임시 이름("리스트 (ID)")으로는 바꾸지 않음', () => {
    assertEqual(resolveListKey(stored(), '리스트 (555)', '555', true).key, '옛 이름');
  });

  it('applyListSave: 이름만 바뀌고 색·표시 방식·글자 스타일·멤버는 그대로, 새 멤버는 더함', () => {
    const result = applyListSave(stored(), '새 이름', ['@a', '@b'], '555', { followRename: true });
    assertEqual(result.success, true);
    assertEqual(result.listName, '새 이름');
    assertEqual(result.noChange, false);
    assertDeepEqual(Object.keys(result.lists), ['새 이름']);
    assertDeepEqual(result.lists['새 이름'], {
      color: '#ff0055', mode: 'highlight', listId: '555', members: ['@a', '@b'], style: { fontSize: 14 }
    });
  });

  it('applyListSave: 새 멤버가 없어도 이름이 바뀌었으면 저장함 (noChange 아님)', () => {
    const result = applyListSave(stored(), '새 이름', ['@a'], '555', { followRename: true });
    assertEqual(result.noChange, false);
    assertEqual(result.added, 0);
    assertDeepEqual(Object.keys(result.lists), ['새 이름']);
  });

  it('applyListSave: 옵션이 없거나 followRename 이 false 면 이름을 바꾸지 않음 (이름을 확실히 읽지 못한 경우)', () => {
    assertDeepEqual(Object.keys(applyListSave(stored(), '새 이름', ['@a', '@b'], '555').lists), ['옛 이름']);
    assertDeepEqual(Object.keys(applyListSave(stored(), '새 이름', ['@a', '@b'], '555', { followRename: false }).lists), ['옛 이름']);
  });

  it('applyListReplace: 교체하면서 이름도 따라가고, 입력은 바꾸지 않음', () => {
    const lists = stored();
    const result = applyListReplace(lists, '새 이름', ['@b'], '555', { followRename: true });
    assertEqual(result.listName, '새 이름');
    assertDeepEqual(result.lists['새 이름'].members, ['@b']);
    assertEqual(result.lists['새 이름'].color, '#ff0055');
    assertDeepEqual(result.removed, ['@a']);
    assertDeepEqual(Object.keys(lists), ['옛 이름']);
  });
});

describe('팝업에서 리스트 이름 바꾸기 (renameList)', () => {
  it('색·표시 방식·글자 스타일·멤버·listId 를 그대로 새 이름으로 옮기고 customName 을 붙임', () => {
    const lists = {
      '친구': { color: '#ff0055', mode: 'dim', listId: '555', members: ['@a', '@b'], style: { fontSize: 14 } },
      '동료': { color: '#00aa00', mode: 'normal', members: ['@c'] }
    };
    const result = renameList(lists, '친구', '  단짝  ');
    assertDeepEqual(result, { success: true, name: '단짝' });
    assertDeepEqual(Object.keys(lists).sort(), ['단짝', '동료']);
    assertDeepEqual(lists['단짝'], {
      color: '#ff0055', mode: 'dim', listId: '555', members: ['@a', '@b'], style: { fontSize: 14 }, customName: true
    });
  });

  it('빈 이름·50자 초과·같은 이름·이미 있는 이름·없는 리스트는 실패하고 아무것도 바꾸지 않음', () => {
    const lists = {
      '친구': { color: '#ff0055', mode: 'dim', members: ['@a'] },
      '동료': { color: '#00aa00', mode: 'normal', members: ['@c'] }
    };
    const before = JSON.stringify(lists);
    assertEqual(renameList(lists, '친구', '   ').success, false);
    assertEqual(renameList(lists, '친구', 'a'.repeat(51)).success, false);
    assertEqual(renameList(lists, '친구', '친구').success, false);
    const taken = renameList(lists, '친구', '동료');
    assertEqual(taken.success, false);
    assert(taken.message.includes('이미 있습니다'), '이미 있는 이름이라고 알려야 함');
    assertEqual(renameList(lists, '없는 리스트', '새 이름').success, false);
    assertEqual(JSON.stringify(lists), before);
  });

  it('대소문자만 다른 이름으로는 바꿀 수 있음', () => {
    const lists = { 'ai': { color: '#ff0055', mode: 'normal', members: ['@a'] } };
    assertEqual(renameList(lists, 'ai', 'AI').success, true);
    assertDeepEqual(Object.keys(lists), ['AI']);
  });

  it('직접 지은 이름은 "Home" 같은 시스템 단어여도 정리 과정에서 지워지지 않고, 다시 수집해도 유지', () => {
    const lists = { '친구': { color: '#ff0055', mode: 'normal', listId: '555', members: ['@a'] } };
    assertEqual(renameList(lists, '친구', 'Home').success, true);

    const { newLists, modified } = sanitizeListsObject(lists);
    assertEqual(modified, false);
    assertDeepEqual(Object.keys(newLists), ['Home']);

    const saved = applyListSave(lists, '친구', ['@a', '@b'], '555', { followRename: true });
    assertDeepEqual(Object.keys(saved.lists), ['Home']);
    assertDeepEqual(saved.lists['Home'].members, ['@a', '@b']);
  });

  it('customName 을 지우면 다음 수집 때 다시 X 이름을 따라감 ([X 이름 따르기])', () => {
    const lists = { '단짝': { color: '#ff0055', mode: 'normal', listId: '555', members: ['@a'], customName: true } };
    delete lists['단짝'].customName;
    const saved = applyListSave(lists, '친구', ['@a'], '555', { followRename: true });
    assertDeepEqual(Object.keys(saved.lists), ['친구']);
  });
});

describe('직접 추가한 멤버 표시 (manualMembers: applyManualAdd, applyListReplace, removeMemberFromLists)', () => {
  it('X 리스트(listId 있음)에 직접 더한 새 멤버만 manualMembers 에 적음 (이미 있던 멤버는 적지 않음)', () => {
    const lists = { '테크': { color: '#ff0055', mode: 'normal', listId: '1', members: ['@a'] } };
    applyManualAdd(lists, '테크', ['@A', '@pick'], '#1d9bf0', 'normal');
    assertDeepEqual(lists['테크'].members, ['@a', '@pick']);
    assertDeepEqual(lists['테크'].manualMembers, ['@pick']);
    applyManualAdd(lists, '테크', ['@pick', '@second'], '#1d9bf0', 'normal');
    assertDeepEqual(lists['테크'].manualMembers, ['@pick', '@second']);
  });

  it('listId 없는 리스트와 새로 만든 리스트에는 적지 않음 (X 리스트와 비교할 일이 없음)', () => {
    const lists = { '직접': { color: '#ff0055', mode: 'normal', members: ['@a'], manual: true } };
    applyManualAdd(lists, '직접', ['@b'], '#1d9bf0', 'normal');
    applyManualAdd(lists, '새 리스트', ['@c'], '#1d9bf0', 'normal');
    assertEqual(lists['직접'].manualMembers, undefined);
    assertEqual(lists['새 리스트'].manualMembers, undefined);
  });

  it('뺀 멤버 정리는 직접 추가한 멤버를 지우지 않고, X 리스트에서 확인된 멤버는 직접 추가 표시를 뗌', () => {
    const initial = {
      '테크': { color: '#ff0055', mode: 'normal', listId: '1', members: ['@a', '@gone', '@pick', '@joined'], manualMembers: ['@pick', '@Joined'] }
    };
    const res = applyListReplace(initial, '테크', ['@a', '@joined'], '1');
    assertDeepEqual(res.lists['테크'].members, ['@a', '@pick', '@joined']);
    assertDeepEqual(res.removed, ['@gone']);
    assertDeepEqual(res.lists['테크'].manualMembers, ['@pick']);

    const allSeen = applyListReplace(initial, '테크', ['@a', '@joined', '@pick'], '1');
    assertEqual(allSeen.lists['테크'].manualMembers, undefined, '모두 X 리스트에서 확인되면 표시가 없어짐');
  });

  it('멤버를 지우면 직접 추가 표시에서도 지움', () => {
    const lists = { '테크': { color: '#ff0055', mode: 'normal', listId: '1', members: ['@a', '@pick'], manualMembers: ['@Pick'] } };
    assertEqual(removeMemberFromLists(lists, '테크', '@pick'), true);
    assertDeepEqual(lists['테크'].members, ['@a']);
    assertEqual(lists['테크'].manualMembers, undefined);
  });

  it('리스트를 합칠 때 직접 추가 표시도 합침 (mergeManualMembers, sanitizeListsObject, moveRenamedList)', () => {
    const target = { members: ['@a'], manualMembers: ['@a'] };
    mergeManualMembers(target, { manualMembers: ['@A', '@b'] });
    assertDeepEqual(target.manualMembers, ['@a', '@b']);
    mergeManualMembers(target, { members: ['@c'] });
    assertDeepEqual(target.manualMembers, ['@a', '@b'], '표시가 없는 리스트를 합쳐도 그대로');

    const { newLists } = sanitizeListsObject({
      '친구': { color: '#ff0055', mode: 'normal', listId: '9', members: ['@a'] },
      '친구 (@me)': { color: '#ff0055', mode: 'normal', listId: '9', members: ['@pick'], manualMembers: ['@pick'] }
    });
    assertDeepEqual(newLists['친구'].manualMembers, ['@pick']);

    const lists = {
      '리스트 (5)': { color: '#ff0055', mode: 'normal', listId: '5', members: ['@x'], manualMembers: ['@x'] },
      '진짜 이름': { color: '#00ff00', mode: 'dim', members: ['@y'] }
    };
    moveRenamedList(lists, '리스트 (5)', '진짜 이름');
    assertDeepEqual(lists['진짜 이름'].manualMembers, ['@x']);
  });
});

describe('뺀 멤버를 자동으로 지워도 되는지 (canAutoRemoveMembers)', () => {
  const stored = members => ({ '테크': { color: '#ff0055', mode: 'normal', listId: '1', members } });

  it('지울 멤버가 있고 저장된 멤버의 절반 이하면 허용', () => {
    assertEqual(canAutoRemoveMembers(applyListReplace(stored(['@a', '@b', '@c', '@gone']), '테크', ['@a', '@b', '@c'], '1')), true);
    assertEqual(canAutoRemoveMembers(applyListReplace(stored(['@a', '@gone']), '테크', ['@a'], '1')), true, '정확히 절반');
  });

  it('지울 멤버가 없으면 할 일이 없음', () => {
    assertEqual(canAutoRemoveMembers(applyListReplace(stored(['@a', '@b']), '테크', ['@a', '@b', '@new'], '1')), false);
  });

  it('절반 넘게 지워지면 자동으로는 지우지 않음 (화면을 잘못 읽었을 수 있음)', () => {
    assertEqual(canAutoRemoveMembers(applyListReplace(stored(['@a', '@g1', '@g2']), '테크', ['@a'], '1')), false);
  });

  it('팝업에서 직접 만든 리스트(manual)와 실패한 계획은 자동으로 지우지 않음', () => {
    const manualList = { '테크': { color: '#ff0055', mode: 'normal', listId: '1', manual: true, members: ['@a', '@b', '@c', '@gone'] } };
    assertEqual(canAutoRemoveMembers(applyListReplace(manualList, '테크', ['@a', '@b', '@c'], '1')), false);
    assertEqual(canAutoRemoveMembers(applyListReplace({}, '테크', [], '1')), false);
    assertEqual(canAutoRemoveMembers(null), false);
  });
});
