# banmo_tag 개발 가이드

banmo_tag 를 고치거나 테스트·빌드·릴리스하는 사람을 위한 문서입니다. 설치와 사용법은 [README](../README.md)를 보세요.

## 목차

- [폴더 구조](#폴더-구조)
- [코드 구조](#코드-구조)
- [소스 코드로 설치](#소스-코드로-설치)
- [개발 환경](#개발-환경)
- [테스트](#테스트)
- [CI (GitHub Actions)](#ci-github-actions)
- [릴리스 (수동)](#릴리스-수동)
- [빌드](#빌드)
- [문서](#문서)

## 폴더 구조

```
extension/         확장 프로그램 파일 (manifest.json 은 크롬용, manifest.firefox.json 은 파이어폭스 전용 항목)
extension/shared/  공통 로직. X 페이지·팝업·백그라운드·단위 테스트가 함께 씀 (주제별 파일)
extension/popup/   팝업 화면별 코드와 popup.css. 시작점은 extension/popup.js
tests/             단위 테스트 실행기 (test-runner.html, run-tests.ps1, run-tests.bat)
tests/unit/        단위 테스트 (shared/ 의 파일마다 하나씩, README.md 참고)
tests/e2e/         Playwright E2E 테스트 (실제 확장 프로그램을 Chromium 에 로드)
tests/fixtures/    E2E 용 X 화면 (synthetic: 합성, real: 실제 화면 스냅샷)
tests/firefox/     실제 Firefox 동작 확인 (firefox-check.js)
scripts/           build.ps1, build-firefox.js, validate.js (정적 검사), bump-version.js, test-report.js, readme-screenshots.js
docs/              CHANGELOG, 테스트 목록·결과, 개선 과제, 개인정보 처리방침
docs/images/       README 스크린샷 (npm run docs:screenshots 로 다시 찍음)
dist/              빌드 결과 zip, 파이어폭스용 폴더 dist/firefox/ (git 에 올리지 않음)
```

## 코드 구조

확장 프로그램은 세 곳에서 실행되고, 세 곳이 `extension/shared/` 의 같은 코드를 씁니다.

| 실행되는 곳 | 파일 | 하는 일 |
|---|---|---|
| X 페이지 | `content.js`, `styles.css` | 리스트 멤버 화면에서 멤버 수집, 타임라인에 배지, X 화면 구조 점검 |
| 팝업 | `popup.html`, `popup.js`, `popup/`, `theme.js` | 리스트 관리, 배지 스타일, 백업 |
| 백그라운드 | `background.js` | X 페이지가 보낸 수집 결과를 차례대로 저장, 아이콘의 ✔ 표시 |

### 공통 코드 (`extension/shared/`)

저장소나 화면 상태를 갖지 않고, 받은 값만으로 결과를 돌려주는 코드입니다. 그래서 [`tests/unit/`](../tests/unit/README.md) 에서 실제 파일을 그대로 불러 검사합니다.

| 파일 | 내용 | 대표 함수 |
|---|---|---|
| `base.js` | 기본값, 핸들·색·모드 확인, 브라우저 구분 | `mergeHandles`, `parseHandles`, `getBrowserKind` |
| `list-names.js` | 화면에서 읽은 글자를 리스트 이름으로 다듬기, 시스템 단어 걸러내기 | `cleanListName`, `isValidListName` |
| `list-data.js` | 저장된 리스트 데이터: 정리·저장·교체·직접 추가·멤버 삭제, 뺀 멤버를 자동으로 지워도 되는지 | `sanitizeListsObject`, `applyListSave`, `applyListReplace`, `canAutoRemoveMembers` |
| `list-page.js` | X 리스트 화면 읽기: 주소, 수집해도 되는 화면인지, 리스트 이름, 멤버 | `parseListUrl`, `getListNameFromPage`, `extractMembersFromContainer` |
| `badges.js` | 타임라인 배지: 핸들 → 리스트 표, 글자 스타일, 트윗에 그리기 | `buildHandleMap`, `applyBadgeStyle`, `renderTweet` |
| `backup.js` | 백업 만들기·읽기·합치기 | `buildBackup`, `parseBackup`, `mergeImportedLists` |
| `health.js` | X 가 화면 구조를 바꿨는지 진단 | `diagnoseStructure`, `getStructureWarnings` |
| `ui.js` | 팝업 화면 설정, 리스트 정렬, 멤버 요약 | `normalizeUiSettings`, `sortListNames` |

- 모두 일반 스크립트(ES module 아님)라 함수가 전역에 놓이고, 파일끼리 서로의 함수를 씁니다. **최상위에는 `function` 과 `var` 만** 씁니다(팝업이 content script 를 다시 넣을 때 같은 공간에서 다시 실행되므로 `const`/`let` 은 "이미 선언됨" 오류가 남. `npm run validate` 가 확인).
- **읽는 순서의 기준은 `extension/manifest.json` 의 `content_scripts`** 입니다. 같은 목록이 `manifest.firefox.json`(`background.scripts`), `background.js`(`importScripts`), `popup.html`, `tests/test-runner.html` 에도 있고, `npm run validate` 가 다섯 곳이 같은지 확인합니다.

### X 페이지 (`content.js`)

"언제·무엇을"을 맡습니다. 저장 데이터와 화면 변화를 지켜보다가(타이머, `MutationObserver`, 팝업 메시지) 필요한 일을 시킵니다. 화면에서 이름·멤버를 읽거나 트윗에 배지를 그리는 "어떻게"는 `shared/list-page.js`, `shared/badges.js`, `shared/health.js` 에 있습니다. 파일 맨 위에 목차가 있습니다.

### 팝업 (`extension/popup/`)

화면 단위로 나뉘어 있고, `popup.html` 이 아래 순서로 읽습니다. 일반 스크립트라 최상위 함수·변수를 서로 공유합니다.

| 파일 | 내용 |
|---|---|
| `core.js` | 상태, 작은 도우미(`byId`, `makeElement`), 공통 UI(상태 메시지, 확인 상자), 리스트 저장 큐(`updateLists`) |
| `tab-view.js` | 새 탭에서 열기(`popup.html?view=tab`), 파이어폭스 팝업 우회 |
| `nav.js` | 탭(리스트·배지 스타일·도움말), ⋯ 메뉴 |
| `ui-settings.js` | 화면 설정(테마, 리스트 정렬) |
| `sync.js` | X 탭 연동: 접근 권한, [현재 탭에서 가져오기], [뺀 멤버 정리], 화면 구조 경고 |
| `backup.js` | 백업·복원·초기화 |
| `manual-add.js` | 직접 리스트 추가 |
| `lists.js` | 리스트 표 |
| `sheet.js` | 리스트 설정 창: 이름 바꾸기, 배지 색, 글자 스타일, 타임라인 표시, 미리보기, 멤버, 삭제 |
| `badge.js` | 배지 기본 스타일(모든 리스트 공통) |
| `../popup.js` | 시작점. 위 파일의 `setup…` 함수를 연결 (마지막에 읽힘) |
| `popup.css` | 화면 모양 (`popup.html` 에 `<style>` 을 쓰지 않음) |

### 어디를 고치면 되나

| 고치려는 것 | 볼 곳 |
|---|---|
| 리스트 이름이 잘못 읽힘 | `shared/list-names.js`(다듬기 규칙), `shared/list-page.js` 의 `getListNameFromPage` |
| 멤버가 빠지거나 추천 계정이 섞임 | `shared/list-page.js` 의 `isExcludedUserCell`, `extractMembersFromContainer` |
| 배지 위치·모양, 강조·흐리게 | `shared/badges.js`, `styles.css` |
| 수집하는 시점, 배지를 다시 그리는 시점 | `content.js` |
| 저장 규칙(합치기, 이름 변경, 교체) | `shared/list-data.js`, `background.js` |
| 뺀 멤버 자동 정리(목록을 맨 위부터 끝까지 봤는지) | `shared/list-page.js` 의 `readMemberListWindow`·`trackMemberListProgress`, `content.js` 의 `syncRemovedMembers`. 목록 끝에서는 줄이 추가되지 않으므로 `onMemberListScroll`(스크롤)과 줄이 사라지는 변화로도 다시 확인 |
| 팝업 화면 | `popup/` 의 해당 화면 파일, `popup/popup.css`, `popup.html` |
| X 가 화면 구조를 바꿈 | `shared/list-page.js`·`shared/badges.js` 의 선택자, `shared/health.js`, `tests/fixtures/` |

### 파일을 새로 만들 때

- **`shared/`**: 위의 다섯 곳에 같은 순서로 넣고, `tests/unit/<이름>.test.js` 를 만들어 `tests/test-runner.html` 에 추가합니다. 새 함수는 `tests/unit/symbols.test.js` 목록에도 넣습니다.
- **`popup/`**: `popup.html` 에 `popup.js` 보다 앞에 넣고, `popup.js` 머리말의 파일 목록에 한 줄 적습니다. 최상위 이름이 다른 팝업 파일과 겹치면 안 됩니다.
- 빠뜨리면 `npm run validate`(목록)와 `npm run lint`(없는 함수, 겹치는 이름)가 알려 줍니다.

## 소스 코드로 설치

릴리스 zip 대신 이 저장소의 파일을 바로 로드합니다. 코드를 고친 뒤에는 확장 프로그램 관리 화면에서 새로고침(↻)을 누릅니다.

**크롬**
1. `chrome://extensions`에서 **개발자 모드**를 켭니다.
2. **압축해제된 확장 프로그램을 로드합니다**를 누르고 `extension` 폴더를 선택합니다.

**파이어폭스 (140 이상)**
1. 주소창에 `about:debugging#/runtime/this-firefox` 를 엽니다.
2. 파이어폭스용 폴더를 만듭니다: `npm run build:firefox` → `dist\firefox\`
   - `extension/manifest.json` 은 크롬용입니다. 파이어폭스 전용 항목(`background.scripts`, 확장 프로그램 ID 등)은 `extension/manifest.firefox.json` 에 있고, 빌드할 때 합쳐집니다.
   - 코드를 고친 뒤에는 다시 실행하고, about:debugging 에서 [다시 로드]를 누릅니다.
3. **임시 부가 기능 로드…**를 누르고 `dist\firefox\manifest.json` 을 선택합니다.
4. 임시 설치는 파이어폭스를 다시 시작하면 사라집니다. 계속 쓰려면 Mozilla 서명이 필요합니다(부가 기능 사이트 AMO 에 올려 서명. 목록에 공개하지 않는 "unlisted" 도 가능).

> 다른 폴더(예: 예전 `antigravity-extension`)에서 로드하던 확장 프로그램은 ID 가 달라 저장 데이터가 넘어오지 않습니다. 옮기기 전에 팝업의 ⋯ 메뉴에서 내보내기를 하고, 새로 로드한 뒤 가져오기(덮어쓰기)를 하세요.

## 개발 환경

Node.js 22 이상이 필요합니다. 처음 한 번 개발 도구를 설치합니다.

```powershell
npm ci
npx playwright install chromium   # E2E 테스트용 Chromium (일반 Chrome 은 폴더에서 확장 프로그램 로드 옵션을 지원하지 않음)
```

| 명령 | 내용 |
|---|---|
| `npm run check` | 정적 검사 + ESLint + 파이어폭스 호환성 검사 + E2E 를 모두 실행 (push 전에 권장) |
| `npm run validate` | 정적 검사 (`scripts/validate.js`) |
| `npm run lint` | ESLint. `shared/` 의 함수 이름을 바꾸거나 지웠는데 다른 파일이 아직 쓰고 있으면 여기서 잡힘 |
| `npm test` | Playwright: 실제 확장 프로그램 E2E 테스트(Chromium) + 단위 테스트(`tests/unit/`) |
| `npm run lint:firefox` | 파이어폭스 호환성 검사 (`web-ext lint`, Mozilla 부가 기능 사이트와 같은 검사) |
| `npm run test:firefox` | 실제 Firefox 에 임시 설치해 주요 동작 확인 (`FIREFOX_BIN` 에 Firefox 경로 지정. 받기: `npx @puppeteer/browsers install firefox@stable`) |
| `npm run firefox:login` / `firefox:live` / `firefox:run` | 화면에 보이는 Firefox 로 **실제 x.com** 에서 확인하는 조작 도구 (아래 "실제 x.com 에서 Firefox 확인") |
| `npm run docs:screenshots` | README 스크린샷(`docs/images/`)을 다시 찍기. 팝업 화면을 바꾼 뒤 실행 |
| `npm run bump -- 1.7.0` | 릴리스할 때만: 버전 올리기 (manifest, CHANGELOG 의 `[Unreleased]` → 새 버전 항목, README, 테스트 러너 제목을 한 번에 변경) |

## 테스트

- **E2E (Playwright)**: `npm test`. 실제 확장 프로그램을 Chromium 에 로드하고, `x.com` 요청에는 `tests/fixtures/` 의 HTML 로 응답해 팝업·content script·background 를 함께 검사합니다. 실제 X 서버나 로그인은 쓰지 않습니다.
- **실제 X 화면 스냅샷**: `tests/fixtures/real/` 에 넣으면 자동으로 검사됩니다. 만드는 법은 [tests/fixtures/README.md](../tests/fixtures/README.md) 참고.
- **실제 x.com 에서 Firefox 확인 (수동, 로그인 필요)**: 화면에 보이는 Firefox 를 명령으로 조작해, 로그인한 실제 x.com 에서 멤버 수집·배지·팝업을 확인합니다. 테스트 전용 프로필(`%LOCALAPPDATA%\banmo_tag-test\ff-live-profile`, 평소 쓰는 Firefox 와 별개)을 씁니다.
  1. `npm run firefox:login` — 자동화 없이 Firefox 가 열리면 x.com 에 로그인하고 창을 닫습니다 (자동화 모드 창에서는 X 가 로그인을 막음). 처음 한 번만.
  2. `npm run firefox:live` — 같은 프로필로 Firefox 를 열고 `extension/` 을 임시 설치한 뒤 명령을 기다립니다. 창을 닫으면 끝납니다.
  3. 다른 터미널에서 `npm run firefox:run -- tests/firefox/live-example.js` 또는 `npm run firefox:run -- -e "await x('/home'); return await badges({ all: true });"`. 쓸 수 있는 도우미는 [tests/firefox/live.js](../tests/firefox/live.js) 맨 위 설명 참고.
  - Firefox 는 뒤쪽 탭의 타이머를 크게 늦춰서 배지가 수십 초 늦게 붙을 수 있으므로, 확인할 때는 x.com 탭을 앞에 둡니다(도우미 `x()`·`front()` 가 처리).
  - 명령은 이 PC 안(127.0.0.1)에서, 실행할 때마다 새로 만드는 토큰이 있어야만 받습니다. 테스트 프로필에는 x.com 로그인 정보가 남으므로, 다 쓰면 폴더를 지워도 됩니다.
- **단위 테스트** ([tests/unit/](../tests/unit/README.md)): `extension/shared/` 의 파일마다 테스트 파일이 하나씩 있습니다. `npm test` 에 포함됩니다. 단위 테스트만 돌리려면 (Node.js 없이, Chrome 또는 Edge만 있으면 됨):
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
  ```
  탐색기에서 `tests\run-tests.bat` 더블 클릭, 또는 `tests\test-runner.html` 을 브라우저로 열어도 됩니다.

테스트 목록과 수동 확인 시나리오는 [docs/TEST_CASES.md](TEST_CASES.md)에, 버전별 테스트 결과는 [docs/TEST_RESULTS.md](TEST_RESULTS.md)에 있습니다. `npm run test:report -- --firefox --write` 로 모든 자동 검사를 실행하고 결과를 기록합니다.

## CI (GitHub Actions)

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)이 `main` push 와 PR 마다 자동으로 실행됩니다. **검사와 테스트만 하며, GitHub Release 나 배포 파일은 만들지 않습니다** (저장소 쓰기 권한 없음).

| 단계 | 러너 | 내용 |
|---|---|---|
| 정적 검사 | Ubuntu | [`scripts/validate.js`](../scripts/validate.js): manifest 형식·참조 파일·크롬/파이어폭스 공용 설정, 공통 코드(`shared/`) 로드 목록, 버전 일치, JS 문법, MV3 CSP 위반(인라인 스크립트·핸들러), `eval`·원격 코드 금지, 문서 링크 + **ESLint** + **파이어폭스 호환성(`web-ext lint`)** |
| E2E 테스트 | Ubuntu | Playwright 로 실제 확장 프로그램을 Chromium 에 로드해 검사 (실패하면 테스트 보고서를 Artifacts 에 업로드) |
| 파이어폭스 동작 확인 | Ubuntu | 최신 안정판 Firefox 를 받아 확장 프로그램을 임시 설치하고 주요 동작 확인 (`tests/firefox/firefox-check.js`) |
| 테스트 및 패키징 확인 | Windows | `scripts/build.ps1`: 단위 테스트(headless Chrome) → zip 을 만들어 필수 파일이 들어 있는지 확인 (업로드하지 않음) |

**Dependabot**: GitHub Actions 와 개발용 npm 패키지의 새 버전을 매주 월요일 확인해 PR 을 만듭니다. PR 에서도 CI 가 돌기 때문에 통과한 것만 merge 하면 됩니다.

> 브랜치 보호 규칙(필수 검사)을 설정하지 않으면 테스트가 실패하는 코드도 `main` 에 push 될 수 있습니다. 저장소가 공개라 무료 플랜에서도 설정할 수 있습니다(Settings → Branches). 설정하지 않았다면 릴리스하기 전에 GitHub 의 Actions 탭에서 마지막 실행이 통과했는지 확인하세요.

## 릴리스 (수동)

릴리스는 GitHub 에서 직접 만듭니다. 릴리스하기 전까지는 버전을 올리지 않고, 변경 사항은 `docs/CHANGELOG.md` 맨 위 `## [Unreleased]` 항목에 모읍니다.

1. 버전 올리기: `npm run bump -- X.Y.Z` → `[Unreleased]` 내용이 `## [vX.Y.Z]` 항목이 됩니다. 내용을 확인하고 커밋·push 합니다.
2. GitHub Actions 의 CI 가 통과했는지 확인합니다.
3. 배포 zip 만들기: `powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1` → `dist\banmo_tag-vX.Y.Z-chrome.zip`, `dist\banmo_tag-vX.Y.Z-firefox.zip`
4. GitHub 저장소 → **Releases** → **Draft a new release** → 태그 `vX.Y.Z` 생성, 제목 `banmo_tag vX.Y.Z`, 본문에 CHANGELOG 의 해당 버전 내용 붙여 넣기, zip 두 개 첨부 → **Publish release**
5. Chrome 웹 스토어에는 `-chrome.zip`, Mozilla 부가 기능 사이트(addons.mozilla.org)에는 `-firefox.zip` 을 올립니다. 두 zip 은 `manifest.json` 만 다릅니다(크롬 MV3 는 `background.scripts` 를 허용하지 않고, 파이어폭스는 `background.service_worker` 를 지원하지 않음).

## 빌드

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

버전 일치 확인(`extension/manifest.json` ↔ `docs/CHANGELOG.md`) → 정적 검사·ESLint(Node.js 가 있을 때) → 단위 테스트 → `dist/banmo_tag-v<버전>-chrome.zip` 과 `dist/banmo_tag-v<버전>-firefox.zip`(파이어폭스용 manifest 를 합친 `dist/firefox/` 를 압축) 생성 순서로 진행합니다. 하나라도 실패하면 zip을 만들지 않습니다.

## 문서
- [docs/CHANGELOG.md](CHANGELOG.md): 버전별 변경 내역
- [docs/TEST_CASES.md](TEST_CASES.md): 자동 테스트 목록과 수동 확인 시나리오
- [docs/TEST_RESULTS.md](TEST_RESULTS.md): 버전별 테스트 결과
- [docs/CODE_IMPROVEMENTS.md](CODE_IMPROVEMENTS.md): 코드 개선 과제와 진행 상태
- [docs/TODO.md](TODO.md): 남은 할 일 (실제 화면 확인, 배포, 코드 개선, 정리)
- [docs/MOBILE_TODO.md](MOBILE_TODO.md): 모바일(안드로이드·아이폰) 지원 할 일 목록
- [docs/PRIVACY.md](PRIVACY.md): 개인정보 처리방침
