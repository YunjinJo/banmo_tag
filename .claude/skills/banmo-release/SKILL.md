---
name: banmo-release
description: banmo_tag 새 버전 릴리스 준비 — 버전 올리기, 배포 zip 빌드(크롬·파이어폭스 공용), GitHub 릴리스 본문 초안, Chrome 웹 스토어·Mozilla AMO 제출 체크리스트. 사용자가 "릴리스 준비", "버전 X.Y.Z 로 올려줘", "배포하자"라고 할 때만 사용합니다. GitHub Release 자체는 사용자가 직접 만듭니다.
disable-model-invocation: true
---

# banmo_tag 릴리스 준비

릴리스는 **사용자가 GitHub 에서 직접** 만듭니다. 이 스킬은 그 전까지의 준비만 합니다.
GitHub Release 생성, 태그 push, 웹 스토어·AMO 업로드는 하지 않습니다 (사용자가 명시적으로 요청한 경우 제외).

## 1. 버전 정하기

- 사용자가 버전을 말하지 않았으면 `docs/CHANGELOG.md` 의 `## [Unreleased]` 내용을 보고 제안합니다.
  - 새 기능(Added) 있음 → 부 버전 (1.6.0 → 1.7.0), 버그 수정만 → 수정 버전 (1.6.0 → 1.6.1)
- `[Unreleased]` 가 비어 있으면 릴리스할 내용이 없다고 알립니다.

## 2. 버전 올리기 (브랜치 → PR, /banmo-pr 절차)

```powershell
git checkout main; git pull -q origin main; git checkout -b release/vX.Y.Z
npm run bump -- X.Y.Z
```

- `[Unreleased]` 내용이 `## [vX.Y.Z] - 날짜` 로 옮겨졌는지 확인하고 문장을 다듬습니다.
- `npm run check`, `scripts\build.ps1`, `npm run test:firefox` 모두 통과 확인 → 커밋·push → PR ("vX.Y.Z 릴리스 준비") → CI 확인.
- 사용자가 PR 을 merge 할 때까지 기다립니다.

## 3. 배포 zip 과 릴리스 본문 (merge 후)

```powershell
git checkout main; git pull -q origin main
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

- 결과: `dist\banmo_tag-vX.Y.Z.zip` (크롬·파이어폭스 공용, 경로 `/` 확인됨)
- `docs/CHANGELOG.md` 의 vX.Y.Z 항목을 릴리스 본문 초안으로 정리해 사용자에게 보여 줍니다 (사용자 관점 요약 3~5줄 + 전체 내용).

## 4. 사용자에게 줄 체크리스트

**GitHub Release (사용자가 직접)**
- [ ] Releases → Draft a new release → 태그 `vX.Y.Z` (target: main), 제목 `banmo_tag vX.Y.Z`
- [ ] 본문 붙여 넣기, `dist\banmo_tag-vX.Y.Z.zip` 첨부 → Publish

**Chrome 웹 스토어 (쓰는 경우)**
- [ ] 개발자 대시보드에서 같은 zip 업로드, 변경 사항 입력
- [ ] 권한(storage, scripting, x.com 접근) 사용 이유가 그대로인지, 개인정보 항목이 `docs/PRIVACY.md` 와 맞는지

**Mozilla AMO (파이어폭스, 쓰는 경우)**
- [ ] addons.mozilla.org 개발자 허브에서 같은 zip 업로드 (목록 비공개 "unlisted" 가능)
- [ ] `web-ext lint` 경고가 `BACKGROUND_SERVICE_WORKER_IGNORED` 1건뿐인지 (`npm run lint:firefox`)
- [ ] 데이터 수집 신고(`data_collection_permissions: none`)가 유지되는지

**릴리스 후**
- [ ] 크롬 `chrome://extensions` 새로고침 / 파이어폭스에서 새 버전 동작 확인
