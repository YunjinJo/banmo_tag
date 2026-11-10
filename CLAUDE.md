# banmo_tag — Claude Code 작업 안내

X(Twitter) 타임라인에서 리스트 멤버에게 배지를 붙이는 브라우저 확장 프로그램입니다. **크롬과 파이어폭스(140+)를 같은 코드로** 지원합니다. `manifest.json` 만 다릅니다(크롬: `extension/manifest.json`, 파이어폭스: `extension/manifest.firefox.json` 을 합친 `dist/firefox/`, `npm run build:firefox`). 사용자 문서는 [README.md](README.md), 변경 내역은 [docs/CHANGELOG.md](docs/CHANGELOG.md).

## 작업 규칙 (꼭 지킬 것)

1. **브랜치 → PR**: `main` 에 직접 커밋·push 하지 않습니다. 최신 `main` 에서 `feature/<작업 이름>`(기능·개선) 또는 `bugfix/<작업 이름>`(버그 수정) 브랜치를 만들고, 커밋·push 후 `gh pr create` 로 PR 을 만듭니다. `.claude/hooks/block-main-commit.js` 훅이 main 커밋·push 를 막습니다. `/banmo-pr` 스킬이 이 절차를 따릅니다.
2. **merge 는 사용자가**: PR 은 사용자가 검토 후 merge 합니다. 요청이 없으면 merge 하지 않습니다.
3. **버전을 올리지 않음**: 릴리스는 사용자가 GitHub 에서 직접 만듭니다. 사용자가 요청하기 전에는 `extension/manifest.json` 버전을 올리지 않고, 변경 내용은 `docs/CHANGELOG.md` 맨 위 `## [Unreleased]` 에 적습니다. CI 는 Release·배포 파일을 만들지 않습니다(다시 추가하지 말 것). 릴리스 준비는 `/banmo-release`.
4. **검증 후 보고**: 코드를 바꾸면 아래 검사를 돌리고, PR 의 CI 결과까지 확인해 알립니다. 실패를 숨기지 않습니다.
5. **커밋 메시지·PR 에 모델 이름을 넣지 않습니다.**

## 명령

| 명령 | 내용 |
|---|---|
| `npm run check` | 정적 검사 + ESLint + 파이어폭스 호환성(`web-ext lint`) + Playwright E2E(Chromium) + 단위 테스트. **push 전에 실행** |
| `npm run test:firefox` | 실제 Firefox 에 임시 설치해 19가지 확인 (`FIREFOX_BIN` 또는 `%LOCALAPPDATA%\banmo_tag-test\firefox-*`) |
| `npm run firefox:live` (백그라운드) → `npm run firefox:run -- <스크립트.js>` | 화면에 보이는 Firefox 로 **로그인한 실제 x.com** 에서 확인. 로그인은 사용자가 `npm run firefox:login` 으로 먼저 (Claude 는 비밀번호를 넣지 않음). Firefox 는 브라우저라 computer use 로 클릭할 수 없으므로 이 도구를 씀. 도우미는 `tests/firefox/live.js` 머리말 |
| `powershell -ExecutionPolicy Bypass -File scripts\build.ps1` | 버전 확인 → 정적 검사 → 단위 테스트(Windows) → `dist\banmo_tag-v<버전>-chrome.zip`, `-firefox.zip` |
| `powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1` | `shared.js` 단위 테스트만 (Node.js 없이) |
| `npm run bump -- X.Y.Z` | **사용자가 릴리스를 요청할 때만**: `[Unreleased]` → 새 버전 항목 |
| `gh pr checks <번호> --watch` | PR 의 CI 결과 기다리기 |

## 구조

```
extension/        확장 프로그램 (Chrome 에 로드 / Firefox 임시 로드 / 배포 zip 내용)
  shared.js       순수 로직 (content·popup·background·테스트 공용)
  content.js      X 페이지: 멤버 수집, 배지, 화면 구조 점검
  popup.html/js   팝업 (탭 화면 ?view=tab 도 같은 파일)
  background.js   저장 큐 (크롬: 서비스 워커, 파이어폭스: 이벤트 페이지)
tests/            test-runner.html(단위), e2e/(Playwright), firefox/(실제 Firefox), fixtures/(X 화면)
scripts/          build.ps1, validate.js, bump-version.js
docs/             CHANGELOG, TEST_CASES, TEST_RESULTS, CODE_IMPROVEMENTS, PRIVACY
.claude/          훅(hooks/), 스킬(skills/), 설정(settings.json)
```

## 코드 규칙

- **`shared.js` 최상위에는 `function` 과 `var` 만**: 팝업이 content script 를 다시 주입할 때 같은 공간에서 재실행되므로 최상위 `const`/`let` 은 "이미 선언됨" 오류가 납니다. 함수 안에서는 `const`/`let`/화살표 함수를 씁니다. 새 함수는 `tests/test-runner.html` 에 단위 테스트를 추가하고, 마지막 "심볼 무결성" 목록에도 넣습니다.
- **화면에 글자를 넣을 때 `textContent` 만** (`innerHTML` 금지 — X 의 데이터와 사용자 입력이 섞임).
- **X 화면 구조에 의존하는 선택자**(`data-testid="UserCell"`, `article[data-testid="tweet"]`, `User-Name` 등)를 바꾸면 `tests/fixtures/` 와 `diagnoseStructure` 도 함께 봅니다. 실제 X 화면 스냅샷은 `/x-snapshot` 스킬로 `tests/fixtures/real/` 에 추가합니다.
- **팝업 동작을 바꾸면 `tests/e2e/popup.spec.js`**, X 페이지 동작이면 `tests/e2e/content.spec.js` 에 테스트를 추가합니다. `chrome.storage` 는 리스트를 **이름순**으로 돌려주므로, 테스트에서는 순서가 아니라 이름으로 줄을 찾습니다.
- **파이어폭스**: `extension/manifest.json` 에는 크롬용 키만 둡니다(`background.scripts` 를 넣으면 크롬에서 "'background.scripts' requires manifest version of 2 or lower." 오류). 파이어폭스 전용 키는 `extension/manifest.firefox.json` 에 적고, 그 `background.scripts` 는 `["shared.js", "background.js"]` 순서 유지. 파이어폭스 팝업에서 파일·색상 선택 창이나 다운로드를 여는 새 조작을 만들면 `popup.js` 의 `OPEN_IN_TAB_ON_FIREFOX` 선택자에 추가합니다(팝업이 닫히는 Firefox 버그 1292701).
- **배포 zip** 경로는 `/` 로 (build.ps1 가 처리, CI 가 검사).
- 문서: 사용자에게 보이는 변경은 CHANGELOG `[Unreleased]`, 저장하는 데이터가 바뀌면 `docs/PRIVACY.md`, 테스트를 추가·변경하면 `npm run test:report -- --catalog` 로 `docs/TEST_CASES.md` 목록을 다시 만듭니다(수동 시나리오는 직접 수정). 릴리스 때는 `npm run test:report -- --firefox --write` 로 `docs/TEST_RESULTS.md` 에 결과를 기록합니다. 팝업 화면을 바꾸면 `npm run docs:screenshots` 로 README 스크린샷(`docs/images/`)을 다시 찍습니다.

## 이 PC(Windows)에서 주의할 점

- 셸은 **Windows PowerShell 5.1**: `&&`/`||` 없음(`;` 와 `if ($?)` 사용). 명령 앞에 PATH 를 새로 읽어야 할 수 있음:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- Node.js 는 `%LOCALAPPDATA%\Programs\nodejs` (portable), git·gh 는 `C:\Program Files` 에 설치됨.
- 여러 줄 커밋 메시지·PR 본문은 파일로 써서 `git commit -F <파일>`, `gh pr create --body-file <파일>`.
- 파일을 PowerShell 로 쓸 때는 BOM 없는 UTF-8 (`[IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding($false)))`).
- 훅(`.claude/settings.json`)은 Git Bash 와 `node` 가 PATH 에 있어야 동작합니다. 새로 설치했다면 Claude Code 를 새 터미널에서 다시 시작하세요.
