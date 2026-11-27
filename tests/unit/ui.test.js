// tests/unit/ui.test.js — extension/shared/ui.js 단위 테스트
// tests/test-runner.html 이 불러옵니다 (describe · it · assert… 도 거기에 있음). 실행 방법은 tests/unit/README.md

describe('팝업 화면 설정 · 리스트 정렬 · 멤버 요약 · 빠른 선택 색', () => {
  it('normalizeUiSettings: 잘못된 값은 기본값(시스템 테마, 이름순)', () => {
    assertDeepEqual(normalizeUiSettings(undefined), { theme: 'system', listSort: 'name' });
    assertDeepEqual(normalizeUiSettings({ theme: 'dark', listSort: 'members' }), { theme: 'dark', listSort: 'members' });
    assertDeepEqual(normalizeUiSettings({ theme: 'light', listSort: 'priority' }), { theme: 'light', listSort: 'priority' });
    assertDeepEqual(normalizeUiSettings({ theme: 'blue', listSort: 1, extra: true }), { theme: 'system', listSort: 'name' });
    assertDeepEqual(normalizeUiSettings('dark'), { theme: 'system', listSort: 'name' });
  });

  it('sortListNames: 이름순(한국어 정렬: 한글 먼저) / 멤버 많은 순(같으면 이름순), 멤버 배열이 없는 항목 제외', () => {
    const lists = {
      '친구': { members: ['@a', '@b'] },
      'AI': { members: ['@a'] },
      '가족': { members: ['@a', '@b'] },
      '깨짐': { members: 'x' }
    };
    assertDeepEqual(sortListNames(lists, 'name'), ['가족', '친구', 'AI']);
    assertDeepEqual(sortListNames(lists, 'members'), ['가족', '친구', 'AI']);
    assertDeepEqual(sortListNames(lists, 'unknown'), ['가족', '친구', 'AI']);
    assertDeepEqual(sortListNames(undefined, 'name'), []);
  });

  it('sortListNames: 배지 순서(priority)대로, 정하지 않은 리스트는 그 뒤에 이름순', () => {
    const lists = {
      '친구': { members: ['@a'] },
      'AI': { members: ['@a'], priority: 1 },
      '가족': { members: ['@a'] }
    };
    assertDeepEqual(sortListNames(lists, 'priority'), ['AI', '가족', '친구']);
  });

  it('summarizeMembers: 멤버 일부 + "외 N명", 없으면 "멤버 없음"', () => {
    assertEqual(summarizeMembers(['@a', '@b', '@c', '@d']), '@a, @b 외 2명');
    assertEqual(summarizeMembers(['@a', '@b']), '@a, @b');
    assertEqual(summarizeMembers(['@a', '@b', '@c'], 3), '@a, @b, @c');
    assertEqual(summarizeMembers([]), '멤버 없음');
    assertEqual(summarizeMembers(undefined), '멤버 없음', '배열이 아니면 멤버 없음');
  });

  it('빠른 선택 색은 모두 흰 글자와 대비 4.5:1 이상 (WCAG AA)', () => {
    const lum = (hex) => {
      const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    AG_SWATCH_COLORS.forEach(([color, label]) => {
      const ratio = 1.05 / (lum(color) + 0.05);
      assert(ratio >= 4.5, `${label}(${color}) 대비 ${ratio.toFixed(2)}`);
      assert(isHexColor(color), `${color} 형식`);
    });
  });
});
