// tests/unit/list-names.test.js — extension/shared/list-names.js 단위 테스트
// tests/test-runner.html 이 불러옵니다 (describe · it · assert… 도 거기에 있음). 실행 방법은 tests/unit/README.md

describe('리스트 이름 태그 제거 (cleanListName)', () => {
  it('브라우저 타이틀에 붙은 (@내태그) 제거 확인', () => {
    const input = '내 친구들 (@black_tag) / X';
    assertEqual(cleanListName(input), '내 친구들');
  });

  it('구분 기호(·)와 함께 붙은 태그 제거 확인', () => {
    const input = '코인 뉴스 · @developer';
    assertEqual(cleanListName(input), '코인 뉴스');
  });

  it('대시(-)와 함께 붙은 태그 제거 확인', () => {
    const input = 'IT 주요 소식 - @my_handle';
    assertEqual(cleanListName(input), 'IT 주요 소식');
  });

  it('앞쪽에 붙은 태그 및 슬래시(@tag/list) 제거 확인', () => {
    const input = '@author/react-devs / X';
    assertEqual(cleanListName(input), 'react-devs');
  });

  it('by @tag 형태의 제작자 표기 제거 확인', () => {
    const input = '주식 고수들 by @trader_pro';
    assertEqual(cleanListName(input), '주식 고수들');
  });

  it('리스트 ID만 있는 경우 괄호 보존 확인 (ID는 태그가 아님)', () => {
    const input = '리스트 (21045591795666661778)';
    assertEqual(cleanListName(input), '리스트 (21045591795666661778)');
  });

  it('시스템 접두사(리스트 멤버 - ) 제거 및 순수 이름 추출 확인', () => {
    const input = '리스트 멤버 - 글로벌 뉴스 (@media) / Twitter';
    assertEqual(cleanListName(input), '글로벌 뉴스');
  });

  it('단독 시스템 단어 "리스트"는 cleanListName으로도 제거되지 않음 (별도 검증 필요)', () => {
    // cleanListName은 "리스트"를 그대로 반환 (이름 정제 함수)
    // 실제 차단은 getListNameFromPage의 isValidListName에서 수행됨
    assertEqual(cleanListName('리스트'), '리스트');
    assertEqual(cleanListName('Lists'), 'Lists');
  });

  it('브라우저 탭 알림 카운트 (3) 및 작성자 태그가 결합된 리스트명 완벽 정제', () => {
    const input = '(3) @YunjinJo98/10일페 일요일 만날 사람~';
    assertEqual(cleanListName(input), '10일페 일요일 만날 사람~');
  });

  it('대괄호 알림 카운트 [99+] 및 콜론 태그 정제', () => {
    const input = '[99+] @developer: AI 연구 모임 / X';
    assertEqual(cleanListName(input), 'AI 연구 모임');
  });
});

describe('실제 리스트 이름 보존 (cleanListName 과잉 정제 방지)', () => {
  it('구분자 없이 끝에 붙은 "Members"/"리스트 멤버"는 이름의 일부로 보존', () => {
    assertEqual(cleanListName('Core Members'), 'Core Members');
    assertEqual(cleanListName('우리팀 리스트 멤버'), '우리팀 리스트 멤버');
    assertEqual(cleanListName('Core Members / X'), 'Core Members');
  });

  it('구분자 없이 앞에 붙은 "Members"도 보존 ("Members Only Club")', () => {
    assertEqual(cleanListName('Members Only Club'), 'Members Only Club');
  });

  it('구분자가 있는 시스템 접두사/접미사는 계속 제거', () => {
    assertEqual(cleanListName('Friends - Members'), 'Friends');
    assertEqual(cleanListName('List members · Friends'), 'Friends');
    assertEqual(cleanListName('리스트 멤버: 우리팀'), '우리팀');
  });

  it('X 화면 읽기용 제목("타임라인: 리스트 멤버")은 리스트 이름이 될 수 없음', () => {
    assertEqual(isValidListName(cleanListName('타임라인: 리스트 멤버')), false);
    assertEqual(isValidListName(cleanListName('Timeline: List members')), false);
    assertEqual(isValidListName(cleanListName('타임라인')), false);
    assertEqual(cleanListName('타임라인: 우리팀'), '우리팀');
    assertEqual(cleanListName('타임라인 정리 모음'), '타임라인 정리 모음', '접두사가 아닌 실제 이름은 보존');
  });

  it('단어 중간의 @ 는 보존하고, 공백 뒤 끝에 붙은 @핸들만 제거', () => {
    assertEqual(cleanListName('연락처 me@site'), '연락처 me@site');
    assertEqual(cleanListName('코인 뉴스 @developer'), '코인 뉴스');
  });
});

describe('시스템 단어 리스트 이름 차단 (isValidListName)', () => {
  it('"리스트" 단독 단어는 유효한 리스트 이름으로 거부 (시스템 네비게이션 텍스트)', () => {
    assertEqual(isValidListName('리스트'), false);
    assertEqual(isValidListName('Lists'), false);
    assertEqual(isValidListName('목록'), false);
  });

  it('"멤버 관리", "구성원 관리", "Manage members" 등 관리 화면 텍스트는 거부', () => {
    assertEqual(isValidListName('멤버 관리'), false);
    assertEqual(isValidListName('구성원 관리'), false);
    assertEqual(isValidListName('Manage members'), false);
    assertEqual(isValidListName('List members'), false);
    assertEqual(isValidListName('Members'), false);
    assertEqual(isValidListName('구성원'), false);
    assertEqual(isValidListName('멤버'), false);
  });

  it('"리스트"를 포함하되 실제 이름인 경우는 허용', () => {
    assertEqual(isValidListName('리스트 (12345)'), true);
    assertEqual(isValidListName('내 리스트'), true);
    assertEqual(isValidListName('코인 리스트 모음'), true);
  });

  it('기타 시스템 단어(홈, 탐색하기, 알림 등)도 거부', () => {
    assertEqual(isValidListName('홈'), false);
    assertEqual(isValidListName('Home'), false);
    assertEqual(isValidListName('Explore'), false);
    assertEqual(isValidListName('알림'), false);
  });

  it('일반 리스트 이름은 정상 허용', () => {
    assertEqual(isValidListName('코인 뉴스'), true);
    assertEqual(isValidListName('IT 주요 소식'), true);
    assertEqual(isValidListName('AI 연구자'), true);
  });
});
