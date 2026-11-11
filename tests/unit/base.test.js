// tests/unit/base.test.js — extension/shared/base.js 단위 테스트
// tests/test-runner.html 이 불러옵니다 (describe · it · assert… 도 거기에 있음). 실행 방법은 tests/unit/README.md

describe('핸들 · 색 · 모드 확인 (mergeHandles, isHexColor, isValidMode, getHandleFromProfileHref)', () => {
  it('mergeHandles: 대소문자만 다른 핸들은 먼저 나온 표기 하나만 남기고, 문자열이 아닌 값·빈 값은 버림', () => {
    assertDeepEqual(mergeHandles(['@Alice', ' @bob '], ['@alice', '@carol', '', null, 3]), ['@Alice', '@bob', '@carol']);
    assertDeepEqual(mergeHandles(undefined, 'x'), []);
  });

  it('isHexColor: #RRGGBB 형식만 색으로 인정', () => {
    assert(isHexColor('#1d9bf0'));
    assert(isHexColor('#FFFFFF'));
    assert(!isHexColor('#fff'), '3자리 색은 받지 않음');
    assert(!isHexColor('red'));
    assert(!isHexColor(null));
  });

  it('isValidMode: normal · highlight · dim 만', () => {
    AG_VALID_MODES.forEach(mode => assert(isValidMode(mode), mode));
    assert(!isValidMode('hide'));
    assert(!isValidMode(undefined));
  });

  it('getHandleFromProfileHref: "/handle" 형태의 프로필 주소만 핸들로 읽음', () => {
    assertEqual(getHandleFromProfileHref('/alice_01'), 'alice_01');
    assertEqual(getHandleFromProfileHref('/alice/status/1'), null);
    assertEqual(getHandleFromProfileHref('https://x.com/alice'), null);
    assertEqual(getHandleFromProfileHref('/too_long_username_123456'), null);
    assertEqual(getHandleFromProfileHref(null), null);
  });
});

describe('직접 입력한 핸들 읽기 (parseHandles)', () => {
  it('쉼표/공백/줄바꿈 구분 핸들을 정규화하고 유효하지 않은 핸들은 필터링', () => {
    const raw = 'user_one, @User_Two\n@invalid-handle! @too_long_username_123456 @user_one';
    const parsed = parseHandles(raw);
    assertDeepEqual(parsed, ['@user_one', '@User_Two']);
  });
});

describe('브라우저 구분 (getBrowserKind)', () => {
  it('moz-extension:// 이면 firefox, 그 밖에는 chrome', () => {
    assertEqual(getBrowserKind('moz-extension://1234-abcd/'), 'firefox');
    assertEqual(getBrowserKind('MOZ-EXTENSION://x/'), 'firefox');
    assertEqual(getBrowserKind('chrome-extension://abcdef/'), 'chrome');
    assertEqual(getBrowserKind(''), 'chrome');
    assertEqual(getBrowserKind(undefined), 'chrome');
  });
});
