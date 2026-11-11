// tests/unit/health.test.js — extension/shared/health.js 단위 테스트
// tests/test-runner.html 이 불러옵니다 (describe · it · assert… 도 거기에 있음). 실행 방법은 tests/unit/README.md

describe('X 화면 구조 변화 감지 (diagnoseStructure & getStructureWarnings)', () => {
  const sandbox = document.getElementById('sandbox');
  const membersUrl = parseListUrl('/i/lists/1/members');
  const profileLinks = '<a href="/user_a">A</a><a href="/user_b">B</a><a href="/user_c">C</a>';

  it('멤버 화면: UserCell 이 있으면 정상, 프로필 링크만 있고 UserCell 이 없으면 구조 변경 의심', () => {
    sandbox.innerHTML = `<div data-testid="primaryColumn"><div data-testid="UserCell"><a href="/user_a">A</a></div></div>`;
    assertDeepEqual(diagnoseStructure(sandbox, membersUrl, null), { area: 'members', ok: true });

    sandbox.innerHTML = `<div data-testid="primaryColumn"><div data-testid="NewUserRow">${profileLinks}</div></div>`;
    const res = diagnoseStructure(sandbox, membersUrl, null);
    assertEqual(res.area, 'members');
    assertEqual(res.ok, false);
  });

  it('멤버 화면이 아직 로딩 중(사용자 링크 없음)이면 판단 보류(null)', () => {
    sandbox.innerHTML = `<div data-testid="primaryColumn"><div>로딩 중</div><a href="/home">Home</a></div>`;
    assertEqual(diagnoseStructure(sandbox, membersUrl, null), null);
  });

  it('타임라인: User-Name 이 있는 트윗이면 정상, 트윗은 있는데 User-Name 이 없으면 구조 변경 의심', () => {
    sandbox.innerHTML = `<article data-testid="tweet"><div data-testid="User-Name"><span>@a</span></div></article>`;
    assertDeepEqual(diagnoseStructure(sandbox, null, null), { area: 'timeline', ok: true });

    sandbox.innerHTML = '<article data-testid="tweet"></article>'.repeat(3);
    assertEqual(diagnoseStructure(sandbox, null, null).ok, false);

    sandbox.innerHTML = '<article></article>'.repeat(3);
    const res = diagnoseStructure(sandbox, null, null);
    assertEqual(res.ok, false, 'article 은 있는데 data-testid="tweet" 이 없음');
  });

  it('트윗이 거의 없는 화면(설정, 빈 타임라인)은 판단 보류(null)', () => {
    sandbox.innerHTML = '<div>설정 화면</div><article></article>';
    assertEqual(diagnoseStructure(sandbox, null, null), null);
  });

  it('getStructureWarnings 는 최근 ok:false 항목만 반환', () => {
    const now = Date.UTC(2026, 10, 4);
    const day = 24 * 60 * 60 * 1000;
    const warnings = getStructureWarnings({
      members: { ok: false, message: 'm', at: now - day },
      timeline: { ok: false, message: 't', at: now - 30 * day }
    }, now, 14);
    assertEqual(warnings.length, 1);
    assertEqual(warnings[0].area, 'members');
    assertEqual(getStructureWarnings({ members: { ok: true, at: now } }, now, 14).length, 0);
    assertEqual(getStructureWarnings(undefined, now, 14).length, 0);
  });
});
