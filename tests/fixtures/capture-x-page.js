// capture-x-page.js — 실제 X 화면을 테스트용 스냅샷으로 저장하는 스크립트
//
// 사용법
//   1. Chrome 에서 x.com 의 확인하고 싶은 화면을 엽니다 (리스트 멤버 화면, 홈 타임라인 등).
//      멤버/트윗이 몇 개 보일 때까지 기다립니다.
//   2. F12 → Console 탭에 이 파일 전체를 붙여 넣고 Enter.
//   3. 클립보드에 복사된 내용을 tests/fixtures/real/<이름>.html 로 저장합니다.
//      (예: real/list-members-2026-11.html, real/home-timeline-2026-11.html)
//   4. 커밋 전에 파일을 열어 남기고 싶지 않은 내용이 없는지 확인합니다.
//
// 개인정보 보호: 트윗 본문·표시 이름·이미지·스크립트·스타일은 지우고, 화면 구조(태그, data-testid, role,
// aria-label 등)와 @핸들·프로필 링크만 남깁니다. 핸들은 X 에서 공개된 정보지만, 누구의 핸들이 들어 있는지
// 한 번 확인하세요.
(function captureXPage() {
  'use strict';

  var KEEP_ATTRS = ['data-testid', 'role', 'aria-label', 'aria-labelledby', 'aria-selected', 'aria-modal',
    'id', 'dir', 'tabindex', 'href', 'datetime'];
  var DROP_TAGS = ['script', 'style', 'link', 'noscript', 'iframe', 'video', 'audio', 'source', 'canvas', 'img', 'picture', 'svg', 'meta'];

  var path = location.pathname;
  var kind = /\/lists\/[^/]+\/members/.test(path) ? 'members'
    : /\/lists\/[^/]+\/?$/.test(path) ? 'list-main'
      : 'timeline';

  var root = document.documentElement.cloneNode(true);

  // 1. 필요 없는 요소 제거
  DROP_TAGS.forEach(function (tag) {
    root.querySelectorAll(tag).forEach(function (el) { el.remove(); });
  });

  // 2. 트윗 본문 지우기
  root.querySelectorAll('[data-testid="tweetText"]').forEach(function (el) { el.textContent = '(본문 생략)'; });

  // 3. 속성 정리 (구조 판단에 필요한 속성만 유지, 외부 링크/쿼리 제거)
  root.querySelectorAll('*').forEach(function (el) {
    Array.prototype.slice.call(el.attributes).forEach(function (attr) {
      if (KEEP_ATTRS.indexOf(attr.name) === -1) {
        el.removeAttribute(attr.name);
      } else if (attr.name === 'href') {
        var v = attr.value;
        if (!/^\/[^/]/.test(v)) el.removeAttribute('href');
        else el.setAttribute('href', v.split('?')[0]);
      }
    });
  });

  // 4. 텍스트 정리: @핸들, 화면 제목/탭/헤딩 텍스트는 유지하고 나머지 문장은 "텍스트" 로 바꿈
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  var texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  texts.forEach(function (node) {
    var t = node.nodeValue.trim();
    if (!t) return;
    var parent = node.parentElement;
    var keep = /^@[A-Za-z0-9_]{1,15}$/.test(t) ||
      (parent && parent.closest('h1, h2, h3, [role="heading"], [role="tab"], title, time'));
    if (!keep) node.nodeValue = '텍스트';
  });

  // 5. 메타 정보 (테스트가 이 URL 로 페이지를 띄우고 kind 에 맞는 검사를 함)
  var head = root.querySelector('head') || root.insertBefore(document.createElement('head'), root.firstChild);
  var metaKind = document.createElement('meta');
  metaKind.setAttribute('name', 'ag-fixture-kind');
  metaKind.setAttribute('content', kind);
  var metaUrl = document.createElement('meta');
  metaUrl.setAttribute('name', 'ag-fixture-url');
  metaUrl.setAttribute('content', 'https://x.com' + path);
  var charset = document.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  head.insertBefore(metaUrl, head.firstChild);
  head.insertBefore(metaKind, head.firstChild);
  head.insertBefore(charset, head.firstChild);

  var html = '<!DOCTYPE html>\n<!-- 실제 X 화면 스냅샷 (' + new Date().toISOString().slice(0, 10) + ', ' + kind +
    ') — capture-x-page.js 로 생성, 본문/이름/이미지 제거됨 -->\n' + root.outerHTML;

  if (typeof copy === 'function') {
    copy(html);
    console.log('[banmo_tag] 스냅샷을 클립보드에 복사했습니다 (' + kind + ', ' + Math.round(html.length / 1024) +
      'KB). tests/fixtures/real/ 에 .html 로 저장하세요.');
  } else {
    console.log(html);
  }
})();
