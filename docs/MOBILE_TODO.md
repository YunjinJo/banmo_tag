# 모바일 지원 TODO

banmo_tag 를 휴대폰에서도 쓰기 위한 할 일 목록입니다. 2026-11-11 에 정리했습니다.

- 진행할 때마다 체크박스를 채우고, 끝난 일은 [CHANGELOG.md](CHANGELOG.md) `[Unreleased]` 에도 적습니다.
- 개발 방법은 [DEVELOPMENT.md](DEVELOPMENT.md)를 보세요. 모바일 외 할 일은 [TODO.md](TODO.md)에 있습니다.

## 전제

- **X 공식 앱에는 배지를 붙일 수 없습니다.** 안드로이드·iOS 모두 다른 앱이 X 앱 화면을 바꿀 방법이 없습니다. 그래서 **모바일 브라우저에서 x.com 을 열어 쓰는 경우만** 지원합니다.
- 코드 파일(`.js`/`.html`/`.css`)은 하나로 유지합니다. 브라우저마다 다른 것은 manifest 와 빌드뿐입니다(지금의 `extension/manifest.json` + `manifest.firefox.json` → `dist/firefox/` 방식).

## 브라우저별 가능 여부

| 브라우저 | 가능 여부 | 방법 | 조건 |
|---|---|---|---|
| Firefox (안드로이드) | ✅ 가능 | Firefox 확장 프로그램 그대로 | Mozilla 부가 기능 사이트(AMO)에 공개(listed) 등록, 무료 |
| Safari (아이폰·아이패드) | ✅ 가능 | Safari 웹 확장을 iOS 앱으로 감싸서 배포 | Mac + Xcode, Apple 개발자 계정(연 $99), App Store 심사 |
| 삼성 인터넷 (안드로이드) | ⚠️ 조건부 | 삼성 파트너 승인 후 앱으로 감싸서 갤럭시 스토어 배포 | 비공개 베타, 허가받은 개발자만 개발 가능. 지원 API·manifest 버전은 승인 후 공개 |
| Chrome (안드로이드·iOS) | ❌ 불가 | — | 모바일 Chrome 은 확장 프로그램을 지원하지 않음 |
| iOS 의 다른 브라우저 | ❌ 대부분 불가 | — | 일부 예외(Orion 등)만 확장 프로그램 지원 |

## 추천 순서

1. **공통 모바일 대응** → 2. **Firefox 안드로이드** → 3. **iOS Safari** → (필요하면) 4. **삼성 인터넷**

공통 대응은 모든 모바일 브라우저에 그대로 쓰입니다. Firefox 안드로이드는 비용이 없고 코드 변경이 가장 적습니다.

---

## 1. 공통 모바일 대응

### 1-1. 실제 모바일 x.com 화면 확인
- [ ] 모바일 x.com(좁은 화면)의 HTML 을 스냅샷으로 남기기 (안드로이드 Firefox 원격 디버깅 또는 데스크톱 브라우저의 모바일 화면 모드)
  - 확인할 것: 트윗(`data-testid="tweet"`), 이름 영역(`User-Name`), 멤버 화면의 사용자 칸(`UserCell`), 리스트 메인·멤버 창 구조
- [ ] 스냅샷을 `tests/fixtures/real/` 에 넣고 `real-snapshots.spec.js` 로 수집·배지가 되는지 확인
- [ ] 다르면 선택자 수정 (`shared.js` 의 `getBadgeAnchor`, `isExcludedUserCell`, `AG_DIM_TARGET_SELECTOR` 등)
- [ ] 모바일 합성 페이지(`tests/fixtures/synthetic/`)와 E2E 테스트 추가 (Playwright 의 모바일 기기 흉내 사용)

### 1-2. 타임라인 배지
- [ ] 이름 줄이 좁으므로 좁은 화면에서는 보이는 배지 수 줄이기 (지금 `AG_TIMELINE_MAX_BADGES = 3` → 화면 폭에 따라 2 등)
- [ ] **터치로 배지 이름 보기**: "+N" 과 말줄임 배지의 전체 이름은 지금 `title`(마우스를 올리는 툴팁)이라 터치 화면에서 안 보임 → 누르면 리스트 이름이 뜨는 작은 창
  - 배지를 눌러도 트윗이나 프로필로 넘어가지 않게 처리 (이벤트 전파 막기)
  - 창 바깥을 누르거나 스크롤하면 닫기
- [ ] 흐리게 모드·강조 테두리가 모바일 트윗 레이아웃에서 자연스러운지 확인

### 1-3. 팝업 화면
- [ ] 팝업 너비 고정(`body { width: 360px }`) 해제: 모바일에서는 화면 전체 폭으로 열리므로 반응형으로
- [ ] 버튼·선택 칸을 터치하기 쉬운 크기(최소 44px)로
- [ ] 아래에서 올라오는 리스트 설정 창이 모바일 화면 높이·가상 키보드와 잘 맞는지 확인
- [ ] 파일 백업 내보내기·가져오기와 색상 선택이 모바일에서 동작하는지 확인 (파일 저장·선택 방식이 데스크톱과 다름)
- [ ] 마우스를 올려야 보이는 정보(`title` 툴팁)를 화면에 보이는 글로 바꾸기

### 1-4. 기기 사이 데이터
- [ ] 지금은 기기마다 따로 저장(`storage.local`). 백업 파일로 옮기는 방법을 README 에 안내
- [ ] (선택) `storage.sync` 검토: 같은 브라우저 계정끼리만 맞춰짐 (Firefox 데스크톱 ↔ Firefox 안드로이드는 가능, 크롬 ↔ Safari 는 불가). 저장 용량 한도(항목당 8KB 정도) 때문에 멤버가 많은 리스트는 나눠 저장해야 함

---

## 2. Firefox 안드로이드

- [ ] `extension/manifest.firefox.json` 의 `gecko_android.strict_min_version`(지금 142.0) 확인
- [ ] 휴대폰을 USB 로 연결하고 `web-ext run --target=firefox-android --source-dir dist/firefox` 로 실제 기기에서 실행 (`npm run` 명령으로 추가)
- [ ] 실제 기기에서 확인: 멤버 자동 수집, [현재 탭에서 가져오기], 배지·강조·흐리게, 팝업 전체 화면, 백업, x.com 접근 권한 안내
- [ ] 데스크톱 Firefox 팝업 버그 우회(`OPEN_IN_TAB_ON_FIREFOX`: 파일·색상 창을 새 탭에서 열기)가 안드로이드에서도 자연스러운지 확인하고, 필요 없으면 안드로이드에서는 끄기
- [ ] `tests/firefox/firefox-check.js` 에 모바일 화면 크기 확인 추가 (가능한 범위)
- [ ] AMO 에 공개(listed) 등록, "Android 지원" 체크, 설명·스크린샷 준비
- [ ] README 설치 안내에 "Firefox 안드로이드" 추가, `docs/TEST_CASES.md` 수동 시나리오 추가

---

## 3. iOS Safari

- [ ] Mac, Xcode, Apple 개발자 계정 준비
- [ ] Safari 용 빌드 추가: `scripts/build-safari.js` → `dist/safari/` (크롬용 manifest 기준, Safari 전용 항목만 덧붙임)
- [ ] `xcrun safari-web-extension-converter dist/safari` 로 Xcode 프로젝트 만들기 (iOS 앱 + 확장 프로그램)
- [ ] 확인할 차이점
  - [ ] x.com 접근은 사용자가 설정 → Safari → 확장 프로그램에서 직접 허용 → 팝업 안내 문구
  - [ ] iOS 는 background 를 자주 멈춤 → background 에 상태를 오래 두지 않는지 확인 (지금은 저장소 기반이라 괜찮을 것으로 예상)
  - [ ] `chrome.*` API(`storage`, `scripting`, `tabs`, `action`) 동작 확인
  - [ ] 백업 파일 내보내기·가져오기 동작 확인
- [ ] iOS 시뮬레이터와 실제 기기에서 테스트 (Mac 의 Safari 웹 검사기로 디버깅)
- [ ] TestFlight 로 먼저 배포해 시험
- [ ] App Store 제출: 개인정보 처리방침 URL(`docs/PRIVACY.md` 내용), 앱 설명·스크린샷, 심사 대응
- [ ] README 설치 안내에 "아이폰·아이패드" 추가

---

## 4. 삼성 인터넷 (필요할 때)

- [ ] 삼성 인터넷 확장 프로그램 파트너 신청 (문의: browser@samsung.com) → 승인 대기
- [ ] 승인 후 받는 문서로 확인: 지원 manifest 버전(공개 예시는 Manifest V2), 지원 API, 앱으로 감싸는 방법, 테스트 방법
- [ ] 필요하면 MV2 용 manifest 와 빌드 추가 (`background` page, `browser_action` 등)
- [ ] 안드로이드 앱으로 감싸서 삼성 검증 → 갤럭시 스토어 등록

---

## 참고 자료

- [Samsung Internet Extension 가이드 (삼성 개발자)](https://developer.samsung.com/browser/android/extension-guide.html)
- [Samsung Browser 확장 프로그램 개발 개요 (삼성 개발자)](https://developer.samsung.com/internet/android/extensions-dev-overview.html)
- [Install extensions for Samsung Browser (삼성 고객지원)](https://www.samsung.com/us/support/answer/ANS10012967/)
- [Turn-Off-the-Lights-Samsung-extension (삼성 인터넷 확장 프로그램 공개 예시, GitHub)](https://github.com/turnoffthelights/Turn-Off-the-Lights-Samsung-extension)
