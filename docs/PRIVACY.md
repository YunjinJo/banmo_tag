# banmo_tag 개인정보 처리방침

시행일: 2026-11-04

banmo_tag(이하 "확장 프로그램")는 X(Twitter) 타임라인에서 사용자가 정한 리스트의 멤버를 배지로 표시하는 크롬 확장 프로그램입니다. 이 문서는 확장 프로그램이 어떤 정보를 다루는지 설명합니다.

## 요약

- 확장 프로그램은 **개인정보를 수집하거나 외부로 전송하지 않습니다.**
- 모든 데이터는 **사용자의 브라우저 안에만** 저장됩니다.
- 광고, 분석 도구, 외부 서버, 제3자 서비스를 사용하지 않습니다.

## 브라우저에 저장하는 정보

| 정보 | 저장 위치 | 용도 |
|---|---|---|
| 리스트 이름, 리스트 ID, 멤버 핸들(@아이디) | `chrome.storage.local` | 타임라인에서 리스트 멤버를 알아보고 배지를 붙이기 위해 |
| 리스트별 배지 색상, 표시 모드(기본/강조/흐리게) | `chrome.storage.local` | 사용자가 정한 표시 방식을 유지하기 위해 |
| 배지 스타일 설정(글자 색상, 크기, 폰트) | `chrome.storage.local` | 배지 모양을 유지하기 위해 |
| 현재 보고 있는 리스트의 이름 | X 탭의 `sessionStorage` (탭을 닫으면 삭제) | 리스트 메인 화면에서 멤버 화면으로 이동할 때 이름을 이어 쓰기 위해 |

멤버 핸들은 X에서 공개적으로 보이는 정보이며, 사용자가 리스트 멤버 화면을 열거나 직접 입력했을 때만 저장됩니다.

## 페이지 내용 읽기

확장 프로그램은 `x.com`, `twitter.com` 페이지에서만 동작합니다.

- 리스트 멤버 화면에서 리스트 이름과 멤버 핸들을 읽어 저장합니다.
- 타임라인에서 트윗 작성자 핸들을 읽어, 저장된 리스트 멤버인지 확인합니다.

이 처리는 모두 브라우저 안에서만 이루어지며, 읽은 내용은 어디로도 보내지 않습니다. 트윗 본문, 쪽지, 비밀번호, 로그인 정보, 방문 기록은 읽거나 저장하지 않습니다.

## 권한을 쓰는 이유

| 권한 | 이유 |
|---|---|
| `storage` | 위 표의 데이터를 브라우저에 저장 |
| `scripting` | 확장 프로그램 설치·업데이트 전에 열려 있던 X 탭에 기능을 다시 연결 |
| `x.com`, `twitter.com` 접근 | 리스트 멤버 수집과 타임라인 배지 표시 |

## 백업 파일

팝업의 📤 내보내기를 누르면 리스트와 배지 설정이 JSON 파일로 **사용자의 컴퓨터에** 저장됩니다. 이 파일은 사용자가 직접 관리하며, 확장 프로그램이 다른 곳으로 보내지 않습니다.

## 데이터 삭제

- 팝업의 🗑️ 초기화 버튼으로 저장된 리스트를 모두 지울 수 있습니다.
- 확장 프로그램을 제거하면 브라우저에 저장된 데이터도 함께 삭제됩니다.

## 변경

이 방침이 바뀌면 이 문서와 시행일을 갱신합니다.

## 문의

Chrome 웹 스토어 등록 페이지에 적힌 개발자 연락처로 문의해 주세요.

---

## English summary

banmo_tag does not collect, transmit, sell, or share any personal data. List names, list IDs, member handles, display colors/modes and badge style settings are stored only in the user's browser (`chrome.storage.local`, plus a tab-scoped `sessionStorage` cache of the current list name). The extension runs only on x.com / twitter.com, reads list member handles and tweet author handles locally to show badges, and never sends page content anywhere. It uses no analytics, ads, remote servers, or remote code. Users can delete all data with the reset button or by uninstalling the extension.
