// theme.js — 팝업 화면 테마를 첫 화면을 그리기 전에 적용 (깜빡임 방지)
//
// popup.html 의 <head> 에서 가장 먼저 읽힙니다.
// 기준값은 chrome.storage.local 의 uiSettings.theme('system' | 'light' | 'dark') 이지만
// chrome.storage 는 비동기라 첫 화면에 늦으므로, popup.js 가 마지막 선택을 localStorage 에도 적어 두고
// 여기서는 그 값을 바로 씁니다. 'system' 이면 아무것도 하지 않고 CSS 의 prefers-color-scheme 을 따릅니다.
// (localStorage 키는 popup.js 의 THEME_CACHE_KEY 와 같아야 합니다.)
(function applyCachedTheme() {
  let cached;
  try {
    cached = localStorage.getItem('banmo_tag.theme');
  } catch {
    return; // 저장소를 쓸 수 없으면 시스템 설정을 따름
  }
  if (cached === 'light' || cached === 'dark') document.documentElement.dataset.theme = cached;
})();
