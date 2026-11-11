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
