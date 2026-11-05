# banmo_tag (Chrome · Firefox Extension)

banmo_tag는 X(Twitter) 타임라인에서 내가 정한 리스트의 멤버를 한눈에 알아볼 수 있게 해 주는 브라우저 확장 프로그램입니다. 크롬(크롬 계열 브라우저)과 파이어폭스 140 이상을 같은 코드로 지원합니다. 리스트 멤버가 쓴 트윗의 이름 옆에 배지를 붙이고, 리스트별로 강조하거나 흐리게 표시합니다.

- 현재 버전: **v1.6.0** (변경 내역은 [docs/CHANGELOG.md](docs/CHANGELOG.md))
- 모든 데이터는 브라우저(`chrome.storage.local`)에만 저장되며 외부로 전송되지 않습니다. ([개인정보 처리방침](docs/PRIVACY.md))

---

## 주요 기능

### 1. 리스트 멤버 수집
- **자동 수집**: 리스트의 멤버 화면(`/i/lists/<ID>/members` 또는 멤버 창)을 열면 화면에 보이는 멤버를 자동으로 저장합니다. 스크롤해서 더 보이는 멤버도 이어서 추가됩니다.
- **즉시 수집**: 팝업의 **[현재 탭에서 가져오기]** 버튼으로 현재 탭에서 바로 수집합니다.
- **추천 계정 제외**: "팔로우 추천", "추천" 탭, 사이드바, 멤버 창 뒤쪽 화면의 계정은 수집하지 않습니다. 리스트 팔로워 화면도 수집하지 않습니다.
- **리스트 구분**: 같은 이름이라도 다른 리스트(`listId`가 다름)는 `친구 (8888)`처럼 따로 저장합니다.
- **뺀 멤버 정리**: 자동 수집은 멤버를 추가만 합니다. X 리스트에서 뺀 멤버를 정리하려면 멤버 화면을 끝까지 스크롤한 뒤 팝업의 **[뺀 멤버 정리]**를 누르세요. 이번에 화면에 나타난 멤버로 목록을 교체하며, 삭제될 멤버를 먼저 보여 주고 확인을 받습니다.
- **X 화면 구조 변화 경고**: X 가 화면 구조를 바꿔 수집·배지가 멈춘 것으로 보이면 팝업 맨 위에 경고를 띄웁니다.

### 2. 타임라인 배지
- 리스트 멤버가 쓴 트윗의 이름 옆에 리스트 이름 배지를 붙입니다. 여러 리스트에 속하면 배지가 나란히 표시됩니다.
- 배지가 4개 이상이면 2개만 보이고 나머지는 **+N** 으로 묶습니다. +N 에 마우스를 올리면 모든 리스트 이름이 보입니다.
- 긴 리스트 이름은 말줄임(…)으로 줄이고, 배지에 마우스를 올리면 전체 이름이 보입니다.
- 인용 트윗 작성자에게는 작은 **미니 배지**를 붙입니다.
- 리스트별 표시 모드: **배지만** / **강조**(트윗 왼쪽에 색 테두리) / **흐리게**(프로필 사진·본문·미디어만 흐리게, 이름과 배지는 또렷하게).

### 3. 팝업 관리
- 팝업은 **[리스트 | 기본 스타일 | 도움말]** 탭으로 나뉩니다.
- **화면 테마**: 기본은 운영체제의 라이트/다크 설정을 따르고, [기본 스타일] 탭에서 **시스템 / 라이트 / 다크**를 직접 고를 수 있습니다.
- **리스트 카드**: 배지 모양, 멤버 수, 표시 모드와 멤버 일부를 한눈에 보여 줍니다. **이름순 / 멤버 수**로 정렬할 수 있습니다(선택은 저장됨).
- 카드를 누르면 아래에서 **리스트 설정 창**이 올라옵니다: 배지 색(빠른 선택 또는 직접 고르기), 글자 크기·폰트·글자 색, 타임라인 표시(배지만/강조/흐리게), 미리보기, 멤버 보기·개별 삭제, 리스트 삭제.
- 오른쪽 위 **⋯ 메뉴**: 백업 파일로 내보내기 · 백업 파일 가져오기 · 모든 리스트 초기화.
- **직접 리스트 추가** ([+ 추가]): 핸들을 입력해 리스트를 만들거나 기존 리스트에 멤버를 추가합니다(기존 리스트의 색상·모드는 유지).
- **배지 글자 스타일 (글자 색상, 크기 8–20px, 폰트)**
  - **모든 리스트 공통**: [기본 스타일] 탭에서 정합니다.
  - **리스트별**: 리스트 카드를 누르면 그 리스트만의 글자 색상·크기·폰트를 정할 수 있습니다. 바꾼 항목만 따로 저장되고 나머지는 공통 설정을 따릅니다. [공통 설정 따르기]로 되돌립니다.
  - **모든 리스트에 적용**: 공통 설정의 [모든 리스트에 적용]은 리스트별 스타일을 지워 모두 공통 스타일을 쓰게 하고, 리스트별 [이 스타일을 모든 리스트에 적용]은 그 리스트의 스타일을 공통 스타일로 만듭니다.

### 4. 백업 및 복원
- 내보내기 (⋯ 메뉴): 리스트(멤버·색상·모드·리스트별 글자 스타일·`listId`)와 **공통 배지 스타일 설정**을 JSON 파일로 저장합니다.
- 가져오기 (⋯ 메뉴): **병합**(기존 리스트에 멤버만 합침, 현재 배지 설정 유지) 또는 **덮어쓰기**(파일 내용으로 교체, 배지 설정도 복원)를 고릅니다. 이전 버전에서 내보낸 파일도 읽을 수 있습니다.

---

## 폴더 구조

```
extension/        Chrome 에 로드하는 확장 프로그램 파일 (배포 zip 내용)
tests/            shared.js 단위 테스트 (test-runner.html, run-tests.ps1, run-tests.bat)
tests/e2e/        Playwright E2E 테스트 (실제 확장 프로그램을 Chromium 에 로드)
tests/fixtures/   E2E 용 X 화면 (synthetic: 합성, real: 실제 화면 스냅샷)
tests/firefox/    실제 Firefox 동작 확인 (firefox-check.js)
scripts/          build.ps1, validate.js (정적 검사), bump-version.js
docs/             CHANGELOG, 테스트 명세, 개선 과제, 개인정보 처리방침
dist/             빌드 결과 zip (git 에 올리지 않음)
```

## 설치 (개발용)

**크롬**
1. `chrome://extensions`에서 **개발자 모드**를 켭니다.
2. **압축해제된 확장 프로그램을 로드합니다**를 누르고 `extension` 폴더를 선택합니다.

**파이어폭스 (140 이상)**
1. 주소창에 `about:debugging#/runtime/this-firefox` 를 엽니다.
2. **임시 부가 기능 로드…**를 누르고 `extension\manifest.json` 을 선택합니다.
3. 임시 설치는 파이어폭스를 다시 시작하면 사라집니다. 계속 쓰려면 Mozilla 서명이 필요합니다(부가 기능 사이트 AMO 에 올려 서명. 목록에 공개하지 않는 "unlisted" 도 가능).

**파이어폭스에서 알아둘 점**
- 파이어폭스는 팝업에서 파일·색상 선택 창이나 다운로드를 열면 팝업이 닫혀 버립니다. 그래서 팝업에서 내보내기, 가져오기, 색상 직접 고르기를 누르면 같은 화면이 **새 탭**에서 열립니다(리스트 설정 창에서 눌렀으면 그 창도 열린 채로). 팝업 위쪽 [↗] 버튼으로 언제든 새 탭에서 열 수 있으며, 새 탭에서도 [현재 탭에서 가져오기]·[뺀 멤버 정리]는 열 때 보던 X 탭을 대상으로 동작합니다.
- 설치할 때 x.com 접근을 허용하지 않았다면 팝업에 안내와 [x.com 접근 허용] 버튼이 나타납니다.

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
| `npm run lint` | ESLint. `shared.js` 함수 이름을 바꾸거나 지웠는데 다른 파일이 아직 쓰고 있으면 여기서 잡힘 |
| `npm test` | Playwright: 실제 확장 프로그램 E2E 테스트(Chromium) + `shared.js` 단위 테스트 |
| `npm run lint:firefox` | 파이어폭스 호환성 검사 (`web-ext lint`, Mozilla 부가 기능 사이트와 같은 검사) |
| `npm run test:firefox` | 실제 Firefox 에 임시 설치해 주요 동작 확인 (`FIREFOX_BIN` 에 Firefox 경로 지정. 받기: `npx @puppeteer/browsers install firefox@stable`) |
| `npm run bump -- 1.7.0` | 릴리스할 때만: 버전 올리기 (manifest, CHANGELOG 의 `[Unreleased]` → 새 버전 항목, README, 테스트 러너 제목을 한 번에 변경) |

## 테스트

- **E2E (Playwright)**: `npm test`. 실제 확장 프로그램을 Chromium 에 로드하고, `x.com` 요청에는 `tests/fixtures/` 의 HTML 로 응답해 팝업·content script·background 를 함께 검사합니다. 실제 X 서버나 로그인은 쓰지 않습니다.
- **실제 X 화면 스냅샷**: `tests/fixtures/real/` 에 넣으면 자동으로 검사됩니다. 만드는 법은 [tests/fixtures/README.md](tests/fixtures/README.md) 참고.
- **`shared.js` 단위 테스트만** (Node.js 없이, Chrome 또는 Edge만 있으면 됨):
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
  ```
  탐색기에서 `tests\run-tests.bat` 더블 클릭, 또는 `tests\test-runner.html` 을 브라우저로 열어도 됩니다.

테스트 목록과 수동 확인 시나리오는 [docs/TEST_CASES.md](docs/TEST_CASES.md)에 있습니다.

## CI (GitHub Actions)

[`.github/workflows/ci.yml`](.github/workflows/ci.yml)이 `main` push 와 PR 마다 자동으로 실행됩니다. **검사와 테스트만 하며, GitHub Release 나 배포 파일은 만들지 않습니다** (저장소 쓰기 권한 없음).

| 단계 | 러너 | 내용 |
|---|---|---|
| 정적 검사 | Ubuntu | [`scripts/validate.js`](scripts/validate.js): manifest 형식·참조 파일·크롬/파이어폭스 공용 설정, 버전 일치, JS 문법, MV3 CSP 위반(인라인 스크립트·핸들러), `eval`·원격 코드 금지, 문서 링크 + **ESLint** + **파이어폭스 호환성(`web-ext lint`)** |
| E2E 테스트 | Ubuntu | Playwright 로 실제 확장 프로그램을 Chromium 에 로드해 검사 (실패하면 테스트 보고서를 Artifacts 에 업로드) |
| 파이어폭스 동작 확인 | Ubuntu | 최신 안정판 Firefox 를 받아 확장 프로그램을 임시 설치하고 주요 동작 확인 (`tests/firefox/firefox-check.js`) |
| 테스트 및 패키징 확인 | Windows | `scripts/build.ps1`: 단위 테스트(headless Chrome) → zip 을 만들어 필수 파일이 들어 있는지 확인 (업로드하지 않음) |

**Dependabot**: GitHub Actions 와 개발용 npm 패키지의 새 버전을 매주 월요일 확인해 PR 을 만듭니다. PR 에서도 CI 가 돌기 때문에 통과한 것만 merge 하면 됩니다.

> 무료 플랜의 비공개 저장소는 브랜치 보호 규칙을 쓸 수 없어, 테스트가 실패하는 코드도 `main` 에 push 될 수 있습니다. 릴리스하기 전에 GitHub 의 Actions 탭에서 마지막 실행이 통과했는지 확인하세요.

## 릴리스 (수동)

릴리스는 GitHub 에서 직접 만듭니다. 릴리스하기 전까지는 버전을 올리지 않고, 변경 사항은 `docs/CHANGELOG.md` 맨 위 `## [Unreleased]` 항목에 모읍니다.

1. 버전 올리기: `npm run bump -- X.Y.Z` → `[Unreleased]` 내용이 `## [vX.Y.Z]` 항목이 됩니다. 내용을 확인하고 커밋·push 합니다.
2. GitHub Actions 의 CI 가 통과했는지 확인합니다.
3. 배포 zip 만들기: `powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1` → `dist\banmo_tag-vX.Y.Z.zip`
4. GitHub 저장소 → **Releases** → **Draft a new release** → 태그 `vX.Y.Z` 생성, 제목 `banmo_tag vX.Y.Z`, 본문에 CHANGELOG 의 해당 버전 내용 붙여 넣기, zip 첨부 → **Publish release**
5. (파이어폭스 배포 시) 같은 zip 을 Mozilla 부가 기능 사이트(addons.mozilla.org)에 올려 서명받습니다. 크롬과 파이어폭스가 같은 zip 을 씁니다.

## 빌드

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

버전 일치 확인(`extension/manifest.json` ↔ `docs/CHANGELOG.md`) → 정적 검사·ESLint(Node.js 가 있을 때) → 단위 테스트 → `dist/banmo_tag-v<버전>.zip` 생성 순서로 진행합니다. 하나라도 실패하면 zip을 만들지 않습니다.

## 문서
- [docs/CHANGELOG.md](docs/CHANGELOG.md): 버전별 변경 내역
- [docs/TEST_CASES.md](docs/TEST_CASES.md): 자동 테스트 스위트와 수동 QA 시나리오
- [docs/CODE_IMPROVEMENTS.md](docs/CODE_IMPROVEMENTS.md): 코드 개선 과제와 진행 상태
- [docs/PRIVACY.md](docs/PRIVACY.md): 개인정보 처리방침
