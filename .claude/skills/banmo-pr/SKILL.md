---
name: banmo-pr
description: banmo_tag 저장소에서 코드를 바꾼 뒤 브랜치 생성 → 로컬 검사 → 커밋·push → GitHub PR 생성 → CI 확인까지 정해진 순서로 진행합니다. banmo_tag 의 코드·문서·설정을 수정하는 모든 작업에서 사용하세요 (main 에 직접 커밋하지 않음).
---

# banmo_tag 작업 흐름 (브랜치 → PR)

CLAUDE.md 의 "작업 규칙"을 따르는 표준 절차입니다. 단계를 건너뛰지 마세요.

## 0. 준비 (PowerShell 5.1)

모든 명령 앞에 PATH 를 새로 읽습니다.

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); cd C:\banmo_tag
```

## 1. 브랜치

- 현재 브랜치와 변경 사항 확인: `git status -sb`
- 새 작업이면 최신 main 에서 시작: `git checkout main; git pull -q origin main; git checkout -b <브랜치>`
  - 기능·개선: `feature/<짧은-kebab-이름>`, 버그 수정: `bugfix/<짧은-kebab-이름>`
  - 아직 merge 되지 않은 PR 의 변경이 필요하면 그 브랜치에서 갈라지고, PR 본문에 "PR #N 이후 merge" 라고 적습니다.
- 이미 작업 브랜치에 있으면 그대로 진행합니다. **main 이면 절대 커밋하지 않습니다** (훅이 막음).

## 2. 변경

- CLAUDE.md 의 "코드 규칙"을 따릅니다 (shared/*.js 최상위 function/var, textContent, 테스트 추가 등).
- 사용자에게 보이는 변경은 `docs/CHANGELOG.md` 의 `## [Unreleased]` 에 Added / Changed / Fixed 로 적습니다. **버전은 올리지 않습니다.**
- 테스트 수가 바뀌면 `docs/TEST_CASES.md`, 저장 데이터가 바뀌면 `docs/PRIVACY.md`, 사용법이 바뀌면 `README.md`, 개발 방법(명령·테스트·빌드·릴리스)이 바뀌면 `docs/DEVELOPMENT.md` 를 고칩니다.

## 3. 로컬 검사 (모두 통과해야 다음 단계)

```powershell
$env:FORCE_COLOR = $null; npm run check
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

- 파이어폭스에 영향이 있는 변경(manifest, background, popup, content)이면 `npm run test:firefox` 도 실행합니다.
- 실패하면 원인을 고치고 다시 실행합니다. 테스트를 지우거나 약하게 바꿔서 통과시키지 않습니다.

## 4. 커밋 · push

- `git add -A; git status --short` 로 올라갈 파일을 확인합니다 (node_modules, dist, 개인 백업 파일이 없는지).
- 커밋 메시지는 파일로 씁니다 (영어 제목 한 줄 + 빈 줄 + 변경 요약). 모델 이름은 넣지 않습니다.

```powershell
$msg = Join-Path $env:TEMP 'banmo_tag-commit.txt'
[IO.File]::WriteAllText($msg, "<제목>`n`n- <변경 1>`n- <변경 2>`n", (New-Object System.Text.UTF8Encoding($false)))
git commit -q -F $msg; git push -u origin <브랜치>
```

## 5. PR

- 본문을 파일로 쓰고 `gh pr create --repo YunjinJo/banmo_tag --base main --head <브랜치> --title "<한국어 제목>" --body-file <파일>`
- 본문 구성: **변경 내용**(무엇을 왜) / **확인 방법**(실행한 검사와 결과 표) / **알아둘 점**(사용자가 직접 확인할 것, 남은 일).
- 이미 같은 브랜치의 PR 이 열려 있으면 새로 만들지 않고 push 만 합니다 (`gh pr list --head <브랜치>`).

## 6. CI 확인과 보고

```powershell
gh pr checks <번호> --repo YunjinJo/banmo_tag --watch --interval 15
```

- 결과(정적 검사, E2E, 파이어폭스, Windows 테스트·패키징)를 확인하고, 실패하면 로그(`gh run view <id> --log-failed`)를 보고 고친 뒤 다시 push 합니다.
- 사용자에게 PR 링크와 결과를 알립니다. **merge 는 요청이 있을 때만** 합니다.
