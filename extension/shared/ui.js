// shared/ui.js — 팝업 화면용 순수 로직 (화면 설정 · 리스트 정렬 · 멤버 요약)
// ⚠️ shared/ 파일의 최상위에는 function 선언과 var 만 씁니다 (이유는 shared/base.js 머리말).

// 팝업 화면 설정 (chrome.storage.local 의 uiSettings). 테마: 시스템 설정 따르기 / 라이트 / 다크
var AG_THEMES = ['system', 'light', 'dark'];
var AG_LIST_SORTS = ['name', 'members'];
var AG_MODE_LABELS = { normal: '배지만', highlight: '강조', dim: '흐리게' };

// 리스트 배지 색 빠른 선택 (모두 흰 글자와 대비 4.5:1 이상, WCAG AA)
var AG_SWATCH_COLORS = [
  ['#c8174d', '빨강'], ['#b45309', '주황'], ['#0f7b3e', '초록'],
  ['#0b74c4', '파랑'], ['#7a3fd1', '보라'], ['#536471', '회색']
];

function normalizeUiSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    theme: AG_THEMES.indexOf(s.theme) !== -1 ? s.theme : 'system',
    listSort: AG_LIST_SORTS.indexOf(s.listSort) !== -1 ? s.listSort : 'name'
  };
}

// 팝업 목록 순서: 'name' 이름순, 'members' 멤버 많은 순 (같으면 이름순)
function sortListNames(lists, sortKey) {
  const all = lists || {};
  const names = Object.keys(all).filter(n => all[n] && Array.isArray(all[n].members));
  const byName = (a, b) => a.localeCompare(b, 'ko');
  if (sortKey === 'members') {
    return names.sort((a, b) => (all[b].members.length - all[a].members.length) || byName(a, b));
  }
  return names.sort(byName);
}

// 리스트 줄의 멤버 요약: "@a, @b 외 3명" (멤버가 없으면 "멤버 없음")
function summarizeMembers(members, maxHandles) {
  const max = maxHandles || 2;
  const all = Array.isArray(members) ? members : [];
  if (all.length === 0) return '멤버 없음';
  const shown = all.slice(0, max).join(', ');
  return all.length > max ? `${shown} 외 ${all.length - max}명` : shown;
}
