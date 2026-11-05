// 예시: npm run firefox:run -- tests/firefox/live-example.js
// 홈 타임라인의 배지와 저장된 리스트를 읽고 스크린샷을 남깁니다 (저장 데이터는 바꾸지 않음).
// 스크립트 파일은 도우미를 받는 async 함수를 module.exports 로 내보내고, 돌려준 값이 JSON 으로 출력됩니다.
// (파일 내용이 함수 안에서 실행되므로 'use strict' 는 쓰지 않습니다.)

module.exports = async ({ x, badges, storage, shot }) => {
  await x('/home');
  const homeBadges = await badges({ all: true });
  const { lists = {} } = await storage(['lists']);
  return {
    tweetsOnScreen: homeBadges.length,
    tweetsWithBadges: homeBadges.filter(b => b.length > 0).length,
    lists: Object.entries(lists).map(([name, l]) => `${name} (${(l.members || []).length}명)`),
    screenshot: await shot(undefined, 'home')
  };
};
