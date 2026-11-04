# banmo_tag (Chrome Extension)

banmo_tag는 X(Twitter) 타임라인에서 내가 정한 리스트의 멤버를 한눈에 알아볼 수 있게 해 주는 크롬 확장 프로그램입니다. 리스트 멤버가 쓴 트윗의 이름 옆에 배지를 붙이고, 리스트별로 강조하거나 흐리게 표시합니다.

- 현재 버전: **v1.4.1** (변경 내역은 [docs/CHANGELOG.md](docs/CHANGELOG.md))
- 모든 데이터는 브라우저(`chrome.storage.local`)에만 저장되며 외부로 전송되지 않습니다. ([개인정보 처리방침](docs/PRIVACY.md))

---

## 주요 기능

### 1. 리스트 멤버 수집
- **자동 수집**: 리스트의 멤버 화면(`/i/lists/<ID>/members` 또는 멤버 창)을 열면 화면에 보이는 멤버를 자동으로 저장합니다. 스크롤해서 더 보이는 멤버도 이어서 추가됩니다.
- **즉시 수집**: 팝업의 **[⚡ 현재 열린 트위터 리스트 가져오기]** 버튼으로 현재 탭에서 바로 수집합니다.
- **추천 계정 제외**: "팔로우 추천", "추천" 탭, 사이드바, 멤버 창 뒤쪽 화면의 계정은 수집하지 않습니다. 리스트 팔로워 화면도 수집하지 않습니다.
- **리스트 구분**: 같은 이름이라도 다른 리스트(`listId`가 다름)는 `친구 (8888)`처럼 따로 저장합니다.

### 2. 타임라인 배지
- 리스트 멤버가 쓴 트윗의 이름 옆에 리스트 이름 배지를 붙입니다. 여러 리스트에 속하면 배지가 나란히 표시됩니다.
- 인용 트윗 작성자에게는 작은 **미니 배지**를 붙입니다.
- 리스트별 표시 모드: **기본**(배지만) / **강조**(트윗 왼쪽에 색 테두리) / **흐리게**(반투명).

### 3. 팝업 관리
- 리스트별 배지 색상과 표시 모드 변경, 멤버 목록 펼쳐 보기, 멤버 개별 삭제, 리스트 삭제, 전체 초기화.
- **직접 리스트 추가**: 핸들을 입력해 리스트를 만들거나 기존 리스트에 멤버를 추가합니다(기존 리스트의 색상·모드는 유지).
- **배지 스타일 설정**: 글자 색상, 크기(8–20px), 폰트.

### 4. 백업 및 복원
- 📤 내보내기: 리스트(멤버·색상·모드·`listId`)와 **배지 스타일 설정**을 JSON 파일로 저장합니다.
- 📥 가져오기: **병합**(기존 리스트에 멤버만 합침, 현재 배지 설정 유지) 또는 **덮어쓰기**(파일 내용으로 교체, 배지 설정도 복원)를 고릅니다. 이전 버전에서 내보낸 파일도 읽을 수 있습니다.

---

## 폴더 구조

```
extension/   Chrome 에 로드하는 확장 프로그램 파일 (배포 zip 내용)
tests/       자동 테스트 (test-runner.html, run-tests.ps1, run-tests.bat)
scripts/     빌드 스크립트 (build.ps1)
docs/        CHANGELOG, 테스트 명세, 개선 과제, 개인정보 처리방침
dist/        빌드 결과 zip (git 에 올리지 않음)
```

## 설치 (개발용)

1. `chrome://extensions`에서 **개발자 모드**를 켭니다.
2. **압축해제된 확장 프로그램을 로드합니다**를 누르고 `extension` 폴더를 선택합니다.

> 다른 폴더(예: 예전 `antigravity-extension`)에서 로드하던 확장 프로그램은 ID 가 달라 저장 데이터가 넘어오지 않습니다. 옮기기 전에 팝업에서 📤 내보내기를 하고, 새로 로드한 뒤 📥 가져오기(덮어쓰기)를 하세요.

## 테스트

Chrome 또는 Edge만 있으면 별도 설치 없이 실행됩니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\tests\run-tests.ps1
```

- 탐색기에서 `tests\run-tests.bat` 더블 클릭으로도 실행됩니다.
- 브라우저에서 보기: `tests\test-runner.html` 열기
테스트 목록과 수동 확인 시나리오는 [docs/TEST_CASES.md](docs/TEST_CASES.md)에 있습니다.

## CI/CD (GitHub Actions)

[`.github/workflows/ci.yml`](.github/workflows/ci.yml)이 `main` push 와 PR 마다 자동으로 실행됩니다.

| 단계 | 러너 | 내용 |
|---|---|---|
| 정적 검사 | Ubuntu | [`scripts/validate.js`](scripts/validate.js): manifest 형식·참조 파일, 버전 일치, JS 문법, MV3 CSP 위반(인라인 스크립트·핸들러), `eval`·원격 코드 금지, 문서 링크 |
| 테스트 및 빌드 | Windows | `scripts/build.ps1`: 자동 테스트(headless Chrome) → `banmo_tag-v<버전>.zip` 을 실행 결과(Artifacts)에 업로드 |
| 릴리스 | Ubuntu | `main` push 이고 **새 버전**일 때만 GitHub Release `v<버전>` 생성, zip 첨부, CHANGELOG 내용을 릴리스 노트로 사용 |

**새 버전 배포 방법**: `extension/manifest.json`의 `version`과 `docs/CHANGELOG.md` 맨 위 `## [vX.Y.Z]`를 함께 올려 `main`에 push 하면 됩니다. 버전이 같으면 검사·테스트·빌드만 하고 릴리스는 건너뜁니다.

정적 검사는 로컬에서도 실행할 수 있습니다(Node.js 필요): `node scripts/validate.js`

## 빌드

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

버전 일치 확인(`extension/manifest.json` ↔ `docs/CHANGELOG.md`) → 자동 테스트 → `dist/banmo_tag-v<버전>.zip` 생성 순서로 진행합니다. 테스트가 하나라도 실패하면 zip을 만들지 않습니다.

## 문서
- [docs/CHANGELOG.md](docs/CHANGELOG.md): 버전별 변경 내역
- [docs/TEST_CASES.md](docs/TEST_CASES.md): 자동 테스트 스위트와 수동 QA 시나리오
- [docs/CODE_IMPROVEMENTS.md](docs/CODE_IMPROVEMENTS.md): 코드 개선 과제와 진행 상태
- [docs/PRIVACY.md](docs/PRIVACY.md): 개인정보 처리방침
