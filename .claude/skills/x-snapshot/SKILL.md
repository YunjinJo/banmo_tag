---
name: x-snapshot
description: 사용자가 로그인한 크롬(Claude in Chrome)에서 실제 X(Twitter) 화면을 캡처해 banmo_tag 의 tests/fixtures/real/ 에 테스트 스냅샷으로 저장하고 검사합니다. "실제 X 화면 스냅샷 추가", "X 구조 바뀌었는지 확인", "배지가 실제 X 에서 안 붙어요" 같은 요청에 사용합니다. Claude in Chrome 이 연결되어 있어야 합니다.
---

# 실제 X 화면 스냅샷 (`tests/fixtures/real/`)

X 가 화면 구조를 바꾸면 수집·배지가 멈춥니다. 실제 화면 스냅샷을 쌓아 두면 `tests/e2e/real-snapshots.spec.js` 가 매번 검사해 알려 줍니다.

## 0. 준비

- **Claude in Chrome** 도구(`mcp__claude-in-chrome__*`)가 필요합니다. 먼저 `anthropic-skills:chrome-browser` 스킬을 불러 사용법을 따르세요. 연결되어 있지 않으면 사용자에게 Chrome 에 Claude 확장 프로그램을 설치·연결해 달라고 안내하고 멈춥니다.
- 사용자의 실제 계정으로 로그인된 브라우저입니다. **X 에 글쓰기·팔로우·리스트 수정 등 어떤 변경도 하지 않습니다.** 화면을 열고 읽기만 합니다. 새 탭에서 작업하고 사용자의 기존 탭은 건드리지 않습니다.
- 어떤 리스트 화면을 캡처할지 모르면 사용자에게 리스트 주소(`https://x.com/i/lists/<ID>`)를 물어봅니다.

## 1. 캡처할 화면 (필요한 것만)

| 종류 | 주소 | 기다릴 것 |
|---|---|---|
| members | `https://x.com/i/lists/<ID>/members` | 멤버 셀이 5개 이상 보일 때까지 |
| list-main | `https://x.com/i/lists/<ID>` | 리스트 이름 헤더와 트윗 몇 개 |
| timeline | `https://x.com/home` | 트윗 5개 이상, 가능하면 인용 트윗 1개 포함 |

## 2. 캡처

1. 새 탭에서 주소를 열고, 위의 "기다릴 것"이 보일 때까지 기다립니다 (필요하면 조금 스크롤).
2. 페이지에서 `tests/fixtures/capture-x-page.js` 의 내용을 실행합니다 (JavaScript 실행 도구 사용).
   - 이 스크립트는 트윗 본문·표시 이름·이미지·스크립트를 지우고 화면 구조와 `@핸들`, 프로필 링크만 남긴 HTML 을 만듭니다.
   - 클립보드 복사(`copy`)는 DevTools 전용이므로, 스크립트 마지막의 HTML 문자열을 **반환값으로** 받도록 실행합니다 (예: 스크립트의 `copy(html)` 대신 결과를 돌려주게 감싸서 실행).
3. 받은 HTML 을 `tests/fixtures/real/<종류>-<YYYY-MM>.html` 로 저장합니다 (예: `real/members-2026-11.html`). 같은 이름이 있으면 덮어쓰기 전에 사용자에게 확인합니다.

## 3. 개인정보 확인 (커밋 전에 꼭)

- 파일을 열어 남은 내용을 확인합니다: 트윗 본문이 "(본문 생략)", 표시 이름이 "텍스트" 로 바뀌었는지.
- 남는 것은 화면 구조, `@핸들`, 프로필 링크, 헤딩·탭 글자(리스트 이름 포함)입니다. 사용자에게 "이 핸들과 리스트 이름이 비공개 저장소에 올라갑니다" 라고 알리고 확인을 받습니다.

## 4. 검사

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); cd C:\banmo_tag
$env:FORCE_COLOR = $null; npx playwright test tests/e2e/real-snapshots.spec.js
```

- **통과**: 현재 코드가 실제 X 화면에서 동작합니다. `/banmo-pr` 절차로 스냅샷을 커밋·PR 합니다 (브랜치 예: `feature/x-snapshot-2026-11`).
- **실패**: X 구조가 바뀐 것입니다. 실패 메시지(어떤 선택자를 못 찾았는지)와 스냅샷의 해당 부분을 비교해 원인을 정리하고, `engineering:debug` 스킬로 수정 방안을 찾습니다. 수정은 `bugfix/x-structure-<내용>` 브랜치에서 하고, 합성 fixture(`tests/fixtures/synthetic/`)와 `diagnoseStructure` 도 함께 맞춥니다.

## 5. 실제 X 에서 확장 프로그램 확인 (선택)

사용자가 원하면, 사용자의 크롬에 설치된 banmo_tag 가 실제 X 에서 배지를 붙이는지 화면으로 확인합니다 (리스트 멤버의 트윗에 `.ag-list-badge` 가 있는지 읽기만). 확장 프로그램 설정은 바꾸지 않습니다.
