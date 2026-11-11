// tests/unit/backup.test.js — extension/shared/backup.js 단위 테스트
// tests/test-runner.html 이 불러옵니다 (describe · it · assert… 도 거기에 있음). 실행 방법은 tests/unit/README.md

describe('백업에 배지 설정 포함 (buildBackup & parseBackup)', () => {
  it('내보낸 파일을 다시 읽으면 리스트와 배지 설정이 모두 복원됨', () => {
    const backup = buildBackup(
      { '테크': { color: '#ff0000', mode: 'dim', listId: '7', members: ['@a'] } },
      { textColor: '#000000', fontSize: 14, fontFamily: 'monospace' }
    );
    assertEqual(backup.app, 'banmo_tag');
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)));
    assertEqual(parsed.lists['테크'].mode, 'dim');
    assertEqual(parsed.lists['테크'].listId, '7');
    assertDeepEqual(parsed.badgeSettings, { textColor: '#000000', fontSize: 14, fontFamily: 'monospace' });
  });

  it('구버전 백업(리스트 객체만)도 그대로 읽고 badgeSettings 는 null', () => {
    const parsed = parseBackup({ '테크': { color: '#ff0000', mode: 'normal', members: ['@a'] } });
    assert(parsed !== null, '구버전 형식을 읽어야 함');
    assertEqual(parsed.badgeSettings, null);
    assertDeepEqual(parsed.lists['테크'].members, ['@a']);
    // "app" 이라는 이름의 리스트가 있는 구버전 파일도 리스트로 처리
    const withAppList = parseBackup({ 'app': { members: ['@b'] } });
    assertDeepEqual(withAppList.lists['app'].members, ['@b']);
  });

  it('잘못된 배지 설정 값은 기본값으로, 잘못된 형식은 null', () => {
    const s = normalizeBadgeSettings({ textColor: 'red', fontSize: 99, fontFamily: 'evil; color:red' });
    assertDeepEqual(s, { textColor: '#ffffff', fontSize: 11, fontFamily: 'system' });
    assertEqual(parseBackup(null), null);
    assertEqual(parseBackup([1, 2]), null);
  });
});

describe('가져온 백업 정리 (normalizeImportedLists)', () => {
  it('normalizeImportedLists가 배열/null을 거부하고 잘못된 mode/color 및 시스템 키를 정제', () => {
    assertEqual(normalizeImportedLists(null), null);
    assertEqual(normalizeImportedLists([1, 2, 3]), null);

    const rawImport = {
      '멤버 관리': { color: '#1d9bf0', mode: 'normal', members: ['@u1'] },
      '내 친구 (@me)': { color: 'invalid', mode: 'invalid_mode', listId: '123456789', members: ['alice', '@bob', 'bad-handle!'] }
    };
    const normalized = normalizeImportedLists(rawImport);
    assertEqual(normalized['멤버 관리'], undefined);
    assert(normalized['내 친구'] !== undefined, '정제된 키가 존재해야 함');
    assertEqual(normalized['내 친구'].color, '#1d9bf0');
    assertEqual(normalized['내 친구'].mode, 'normal');
    assertEqual(normalized['내 친구'].listId, '123456789');
    assertDeepEqual(normalized['내 친구'].members, ['@alice', '@bob']);
  });
});

describe('백업 병합 시 listId 기준 매칭 (mergeImportedLists)', () => {
  it('이름이 같아도 listId 가 다르면 별개 리스트로 추가', () => {
    const lists = { '친구': { color: '#ff0000', mode: 'highlight', listId: '11112222', members: ['@a'] } };
    mergeImportedLists(lists, { '친구': { color: '#1d9bf0', mode: 'normal', listId: '99998888', members: ['@b'] } });
    assertDeepEqual(lists['친구'].members, ['@a']);
    assertDeepEqual(lists['친구 (8888)'].members, ['@b']);
  });

  it('같은 listId 는 이름이 달라도 기존 리스트에 합치고 기존 색상/모드를 유지', () => {
    const lists = { '새 이름': { color: '#ff0000', mode: 'dim', listId: '42', members: ['@a'] } };
    mergeImportedLists(lists, { '옛 이름': { color: '#1d9bf0', mode: 'normal', listId: '42', members: ['@b', '@A'] } });
    assertEqual(Object.keys(lists).length, 1);
    assertEqual(lists['새 이름'].color, '#ff0000');
    assertEqual(lists['새 이름'].mode, 'dim');
    assertDeepEqual(lists['새 이름'].members, ['@a', '@b']);
  });

  it('없는 리스트는 그대로 추가하고 listId 없는 기존 리스트에는 listId 를 채움', () => {
    const lists = { '테크': { color: '#ff0000', mode: 'normal', members: ['@a'] } };
    mergeImportedLists(lists, {
      '테크': { color: '#1d9bf0', mode: 'normal', listId: '7', members: ['@b'] },
      '새 리스트': { color: '#00ff00', mode: 'normal', members: ['@c'] }
    });
    assertEqual(lists['테크'].listId, '7');
    assertEqual(lists['테크'].color, '#ff0000');
    assertDeepEqual(lists['새 리스트'].members, ['@c']);
  });
});
