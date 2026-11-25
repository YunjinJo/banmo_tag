# 단위 테스트 (`tests/unit/`)

`extension/shared/` 의 공통 코드를 **실제 파일 그대로** 불러와 검사합니다. 복사본을 따로 두지 않으므로, 여기서 통과하면 확장 프로그램이 쓰는 코드가 통과한 것입니다.

## 파일

테스트 파일은 `shared/` 의 파일마다 하나씩 있습니다. 어떤 함수의 테스트를 찾으려면 그 함수가 있는 파일 이름을 보면 됩니다.

| 테스트 파일 | 대상 (`extension/shared/`) | 내용 |
|---|---|---|
| `base.test.js` | `base.js` | 핸들 · 색 · 모드 확인, 직접 입력한 핸들 읽기, 브라우저 구분 |
| `list-names.test.js` | `list-names.js` | 리스트 이름 다듬기, 시스템 단어 걸러내기, 직접 입력한 이름 확인 |
| `list-data.test.js` | `list-data.js` | 저장 데이터 정리, 리스트 찾기 · 이름 변경, 수집 결과 저장 · 교체, 직접 추가, 멤버 삭제 |
| `list-page.test.js` | `list-page.js` | 리스트 주소 읽기, 화면에서 리스트 이름 · 멤버 읽기, 추천 계정 제외 |
| `badges.test.js` | `badges.js` | 핸들 → 리스트 표, 배지 모양 설정, 직접 입력한 폰트 확인, 트윗에 배지 그리기 |
| `backup.test.js` | `backup.js` | 백업 만들기 · 읽기 · 합치기 |
| `health.test.js` | `health.js` | X 화면 구조 점검 |
| `ui.test.js` | `ui.js` | 팝업 화면 설정, 리스트 정렬, 멤버 요약 |
| `symbols.test.js` | `shared/` 전체 | 모든 함수 · 상수가 로드되는지 (파일을 빠뜨렸거나 이름을 바꾼 경우) |

테스트 도구(`describe`, `it`, `assert`, `assertEqual`, `assertDeepEqual`)와 실행기는 [`../test-runner.html`](../test-runner.html) 안에 있습니다. 외부 라이브러리는 쓰지 않습니다.

## 실행

| 방법 | 명령 |
|---|---|
| 다른 검사와 함께 | `npm run check` (또는 `npm test`) |
| 단위 테스트만 | `npx playwright test tests/e2e/unit-runner.spec.js` |
| Node.js 없이 (Windows, Chrome 또는 Edge) | `powershell -ExecutionPolicy Bypass -File tests\run-tests.ps1` |
| 눈으로 보기 | `tests/test-runner.html` 을 브라우저로 열기 (실패한 테스트와 이유가 화면에 나옴) |

## 테스트 추가

1. 함수가 있는 `shared/<파일>.js` 에 맞는 `<파일>.test.js` 를 엽니다.
2. 알맞은 `describe(...)` 안에 `it('무엇을 확인하는지', () => { ... })` 를 추가합니다. 화면 요소가 필요하면 `document.getElementById('sandbox')` 안에 만들거나 `document.implementation.createHTMLDocument()` 로 별도 문서를 만듭니다.
3. `shared/` 에 **새 함수**를 만들었다면 `symbols.test.js` 의 목록에도 이름을 넣습니다. 빠뜨리면 `npm run validate` 가 알려 줍니다.
4. `npm run test:report -- --catalog` 로 [`docs/TEST_CASES.md`](../../docs/TEST_CASES.md) 의 목록을 다시 만듭니다.

`shared/` 에 **새 파일**을 만들었다면 `<파일>.test.js` 도 만들고 `tests/test-runner.html` 의 `<script src="unit/…">` 목록에 추가합니다 (빠뜨리면 `npm run validate` 가 알려 줍니다).

## 규칙

- 테스트 파일은 일반 스크립트(ES module 아님)입니다. 파일 맨 위에 `const` / `let` / `function` 을 두면 다른 테스트 파일과 이름이 겹칠 수 있으므로, 도우미는 `describe(...)` 안에 둡니다.
- 테스트는 서로 기대지 않게 씁니다. `#sandbox` 를 쓰는 테스트는 시작할 때 내용을 새로 채웁니다.
- 묶음 이름에는 번호를 붙이지 않습니다 (문서의 `U-01` 같은 번호는 `test:report` 가 붙입니다).
