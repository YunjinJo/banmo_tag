# banmo_tag 개인정보 처리방침

시행일: 2026-11-25 (Chrome 웹 스토어 사용자 데이터 정책에 맞춰 정리: 다루는 정보, 제한적 사용 준수, [끝까지 스캔], 직접 입력한 폰트 이름과 크롬의 설치된 폰트 목록)

banmo_tag(이하 "확장 프로그램")는 X(Twitter) 타임라인에서, 사용자가 만든 X 리스트에 속한 사람의 트윗에 그 리스트 이름을 배지로 표시하는 브라우저 확장 프로그램입니다(크롬·파이어폭스). 이 문서는 확장 프로그램이 어떤 정보를 어떻게 다루는지 설명합니다.

## 요약

- 확장 프로그램은 X 페이지에서 **리스트 이름과 계정 핸들(@아이디)** 을 읽어, 배지를 표시하는 데에만 씁니다.
- 읽은 정보와 설정은 **사용자의 브라우저 안에서만** 저장하고 처리합니다. 개발자를 포함해 누구에게도, 어떤 서버로도 보내지 않습니다.
- 사용자 데이터를 판매하거나 제3자에게 넘기지 않습니다.
- 광고, 분석 도구, 외부 서버, 제3자 서비스, 원격 코드를 사용하지 않습니다.

## 다루는 정보

Chrome 웹 스토어의 사용자 데이터 정책은 브라우저 밖으로 보내지 않고 브라우저 안에서만 저장·처리하는 정보도 공개하도록 합니다. 확장 프로그램이 다루는 정보는 X 페이지에서 읽는 **웹사이트 콘텐츠**(리스트 이름, 계정 핸들)뿐이며, Chrome 웹 스토어 등록정보에도 이렇게 공개합니다. 이 밖에 크롬에서 사용자가 "글꼴" 권한을 허용했을 때만, 폰트 창을 여는 동안 설치된 폰트의 이름 목록을 팝업 안에서 쓰고 저장하지 않습니다(아래 "설치된 폰트 목록").

다음 정보는 읽거나 저장하지 않습니다.

- 사용자 본인의 이름, 이메일 주소 같은 개인 식별 정보
- 비밀번호, 로그인 정보, 쿠키
- 쪽지(DM) 등 개인 커뮤니케이션, 트윗 본문과 이미지
- 위치, 건강 정보, 금융·결제 정보
- 방문 기록, 마우스·키보드 입력 기록

## 페이지 내용 읽기

확장 프로그램은 `x.com`, `twitter.com` 페이지에서만 동작합니다.

- **리스트 화면**: 리스트 이름과 멤버 핸들을 읽어 저장합니다.
- **[끝까지 스캔]**: 사용자가 팝업에서 이 버튼을 누르면 멤버 목록을 자동으로 스크롤하며 같은 방식으로 멤버 핸들을 읽습니다. 스캔하는 동안 사용자가 X 화면을 스크롤하거나 누르면 스캔을 멈춥니다. 이때는 입력이 있었는지만 확인하고, 입력 내용이나 위치는 기록하지 않습니다.
- **타임라인**: 트윗 작성자(인용한 트윗의 작성자 포함)의 핸들을 읽어, 저장된 리스트 멤버이면 배지를 붙입니다.
- **현재 주소(URL)**: 리스트 화면인지 알아보는 데에만 쓰고 저장하지 않습니다.
- **화면 구조 점검**: X 화면 구조가 바뀌었는지 알기 위해 멤버 목록·트윗 요소가 화면에 있는지만 확인합니다.

이 처리는 모두 브라우저 안에서만 이루어지며, 읽은 내용은 어디로도 보내지 않습니다.

## 브라우저에 저장하는 정보

| 정보 | 저장 위치 | 용도 |
|---|---|---|
| 리스트 이름(팝업에서 직접 바꾼 이름인지 표시 포함), 리스트 ID, 멤버 핸들(@아이디, 팝업에서 직접 추가한 멤버인지 표시 포함) | `chrome.storage.local` | 타임라인에서 리스트 멤버를 알아보고 배지를 붙이기 위해 |
| 리스트별 배지 색상, 표시 모드(배지만/강조/흐리게), 리스트별 배지 글자 스타일(글자 색상·크기·폰트) | `chrome.storage.local` | 사용자가 정한 표시 방식을 유지하기 위해 |
| 배지 스타일 설정(글자 색상, 크기, 폰트) | `chrome.storage.local` | 배지 모양을 유지하기 위해 |
| 팝업 화면 설정(테마: 시스템/라이트/다크, 리스트 정렬 방식) | `chrome.storage.local` (테마는 팝업을 열 때 깜빡이지 않도록 확장 프로그램 페이지의 `localStorage` 에도 한 번 더 저장) | 사용자가 고른 팝업 화면 모양을 유지하기 위해 |
| 현재 보고 있는 리스트의 이름 | X 탭의 `sessionStorage` (탭을 닫으면 삭제) | 리스트 메인 화면에서 멤버 화면으로 이동할 때 이름을 이어 쓰기 위해 |
| 화면 구조 점검 결과 (영역: 멤버 수집/타임라인, 정상 여부, 안내 문구, 확인 시각) | `chrome.storage.local` | X 화면 구조가 바뀌어 기능이 멈췄을 때 팝업에서 알려 주기 위해. URL·화면 내용·핸들은 저장하지 않음 |

멤버 핸들은 X에서 공개적으로 보이는 정보이며, 사용자가 리스트 멤버 화면을 열거나 [끝까지 스캔]을 누르거나 팝업에서 직접 입력했을 때만 저장됩니다. [끝까지 스캔]의 진행 상황(읽은 멤버 수 등)은 그 X 탭의 메모리에만 있고, 탭을 닫거나 다른 화면으로 가면 사라집니다.

폰트는 목록에서 고른 폰트이거나, 사용자가 폰트 창에서 고르거나 적은 **폰트 이름 하나**만 저장합니다(예: `'나눔고딕', sans-serif`). 폰트 파일을 저장하거나 내려받지 않습니다.

## 설치된 폰트 목록 (크롬·엣지, 사용자가 "글꼴" 권한을 허용한 경우만)

[설치된 폰트에서 고르기…] 창은 이 컴퓨터에 설치된 폰트의 **이름 목록**(`window.queryLocalFonts()`)을 보여 줍니다. 크롬의 "글꼴" 권한이 필요하며, 사용자가 권한 창에서 [허용]을 누른 경우에만 읽습니다.

- 권한을 묻는 것은 사용자가 창의 [새 탭에서 권한 허용하기] → [설치된 폰트 목록 보기]를 눌렀을 때뿐입니다.
- 한 번 허용한 뒤에는 사용자가 이 창을 열 때마다 목록을 읽어 보여 줍니다. 창을 열지 않으면 읽지 않습니다.
- 목록은 고르기·검색과 "이 컴퓨터에 설치된 폰트입니다" 안내에만 쓰고, **저장하거나 어디로도 보내지 않습니다.** 팝업이나 그 탭을 닫으면 사라집니다.
- 폰트 파일의 내용은 읽지 않습니다. 이름만 쓰고, 목록의 보기 글자(`가나다 Abc`)는 브라우저가 그 이름의 폰트로 그립니다.
- 권한은 크롬 설정(이 확장 프로그램의 사이트 설정 > 글꼴)에서 언제든 끌 수 있습니다. 창의 [크롬 설정 열기]가 그 화면을 엽니다.
- 파이어폭스에는 이 기능이 없어 목록이 보이지 않습니다.

입력한 폰트가 설치되어 있는지 알려 줄 때는, 팝업 안에서 같은 글자를 그 폰트와 기본 글꼴로 그려 폭이 다른지만 비교합니다. 결과는 저장하지 않습니다.

## 권한을 쓰는 이유

| 권한 | 이유 |
|---|---|
| `storage` | 위 표의 데이터를 브라우저에 저장 |
| `scripting` | 확장 프로그램 설치·업데이트 전에 열려 있던 X 탭에 기능을 다시 연결. 사용자가 팝업 버튼을 눌렀는데 그 탭이 응답하지 않을 때만, 확장 프로그램에 들어 있는 파일만 넣음 |
| `alarms` | 새 멤버를 저장했을 때 아이콘에 잠깐 띄우는 ✔ 표시를 지우기 위해 (데이터를 읽거나 보내지 않음) |
| `x.com`, `twitter.com` 접근 | 리스트 멤버 수집, 타임라인 배지 표시, 팝업에서 현재 X 탭에 요청 보내기 |
| 글꼴 (크롬·엣지가 사용자에게 묻는 권한, manifest 에는 없음) | 폰트 창에서 설치된 폰트 이름 목록을 보여 주기 위해 (위 "설치된 폰트 목록") |

## Chrome 웹 스토어 사용자 데이터 정책 준수

banmo_tag 의 사용자 데이터 사용은 제한적 사용(Limited Use) 요구사항을 포함한 [Chrome 웹 스토어 사용자 데이터 정책](https://developer.chrome.com/docs/webstore/program-policies/limited-use)을 준수합니다.

- 위에 적은 정보는 확장 프로그램의 단일 목적(X 타임라인에 리스트 배지 표시)에 필요한 기능에만 씁니다.
- 사용자 데이터를 판매하거나 제3자에게 전송하지 않습니다.
- 사용자 데이터를 광고(개인 맞춤 광고 포함)나 신용도 판단·대출 목적으로 쓰지 않습니다.
- 데이터가 브라우저 밖으로 나가지 않으므로, 개발자를 포함한 어떤 사람도 사용자 데이터를 볼 수 없습니다.

## 백업 파일

- 팝업 ⋯ 메뉴의 [백업 파일로 내보내기]를 누르면 리스트와 배지 설정이 JSON 파일로 **사용자의 컴퓨터에** 저장됩니다.
- [백업 파일 가져오기]는 사용자가 고른 백업 파일을 브라우저 안에서 읽어 리스트와 설정을 복원합니다.

백업 파일은 사용자가 직접 관리하며, 확장 프로그램이 다른 곳으로 보내지 않습니다.

## 데이터 삭제

- 팝업 ⋯ 메뉴의 [모든 리스트 초기화]로 저장된 리스트를 모두 지울 수 있습니다.
- 확장 프로그램을 제거하면 브라우저에 저장된 데이터도 함께 삭제됩니다.

## 변경

이 방침이 바뀌면 이 문서와 시행일을 갱신합니다.

## 문의

Chrome 웹 스토어 등록 페이지에 적힌 개발자 연락처로 문의해 주세요.

---

## 파이어폭스

파이어폭스용 설정(`extension/manifest.firefox.json` 의 `browser_specific_settings.gecko.data_collection_permissions`)에는 수집하는 데이터가 없음(`none`)으로 신고합니다. 파이어폭스의 "수집"은 데이터를 외부로 보내는 것을 뜻하며, 확장 프로그램은 아무것도 외부로 보내지 않기 때문입니다. 파이어폭스에서도 위 내용이 그대로 적용됩니다.

## English summary

banmo_tag shows badges on the X (Twitter) timeline for tweets by members of the user's own X lists. To do this it reads list names and account handles (@username) from x.com / twitter.com pages — "website content" in Chrome Web Store terms — and handles them only inside the user's browser. List names, list IDs, member handles, display colors/modes, badge style settings, popup display preferences (theme and list sort order) and a page-structure check status (area, ok flag, message, time; no URLs or page content) are stored only in the browser (`chrome.storage.local`, a copy of the theme choice in the extension page's `localStorage`, plus a tab-scoped `sessionStorage` cache of the current list name). The optional "scan to end" (끝까지 스캔) feature scrolls the member list automatically and only checks whether the user scrolled or clicked in order to stop; input is not recorded. The badge font setting stores only a font name (one picked from the list, or one the user typed); no font files are stored or downloaded. In Chrome/Edge, only after the user has allowed the browser's Local Fonts permission (asked only when the user clicks the button for it), the font picker reads the names of installed fonts (`window.queryLocalFonts()`) each time the user opens it, to list them for picking; this list is kept only in the open popup page and is never stored or sent anywhere, and font file contents are not read. The extension does not read or store personal identity information, passwords, cookies, messages, tweet text, location, health or financial data, browsing history, or keystrokes. No data is ever sent to the developer, a server, or any third party, and there are no analytics, ads, or remote code.

The use of user data by banmo_tag complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements: data is used only for the extension's single purpose, is never sold or transferred to third parties, is never used for advertising, creditworthiness or lending, and is never read by humans. Users can delete all data with the reset button or by uninstalling the extension.
