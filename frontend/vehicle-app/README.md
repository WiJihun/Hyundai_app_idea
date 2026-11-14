# 차량 앱 (Kotlin · Pleos Connect) — 옮겨 갈 때의 안내

지금은 `vehicle-web/`의 웹 화면이 차량 앱 역할을 합니다. Android Studio와 Pleos Connect SDK·에뮬레이터를 준비하면
이 폴더에 Kotlin + Jetpack Compose 앱을 만들고, 서버는 그대로 둔 채 아래 대응표대로 바꿔 끼웁니다.

| 웹 프로토타입 | Kotlin 앱에서 | 비고 |
| --- | --- | --- |
| `server/src/car.ts` 가상 차량의 ETA | **NaviHelper SDK** — 목적지·경유지까지 남은 시간 | `EtaProvider` 인터페이스로 분리. 대안: 외부 길찾기 API |
| 가상 차량의 포장 경유지 추가 | NaviHelper 경유지 추가 | |
| 가상 차량의 `uxRestricted` | **CarUxRestrictions** | 차속을 직접 보지 않음 |
| 데모 패널 주행/정차 버튼 | 에뮬레이터 기어 주입 + 앱 내 디버그 화면 | 설계서 4-2 |
| 현재 위치 | **Fused Location SDK** | `/home?lat=&lng=` 로 보냄 |
| 30초 ETA 보고 (`app.ts`의 `reportEtaAll`) | 앱의 30초 타이머 → `POST /orders/{id}/eta` | |
| `gleo/nlu.ts`, `gleo/dialog.ts` | **Gleo AI SDK** STT · LLM · TTS | LLM에는 해당 매장 메뉴 JSON만 근거로 넘김 |
| 브라우저 음성 인식·합성 | Gleo STT · TTS | |
| “글레오, 치킨 시켜줘”로 앱 호출 | **Gleo Interface** `assets/schema.json`에 기능 3개 등록 | 아래 표. 설명은 영어, Gleo 심사 필요 |
| 최근 주문(서버 메모리) | **Sync SDK**로 스마트폰과 동기화 | |
| 모의 결제 (`payment.ts`) | 인카페이먼트 연동 시 `PaymentProvider` 어댑터만 교체 | 결제정보는 앱에 저장하지 않음 |

Gleo Interface에 등록할 기능(설계서 4-3):

| function | 하는 일 | 발화 예 |
| --- | --- | --- |
| `START_FOOD_ORDER` | 호출 화면을 열고 주문 시작 | “글레오, 치킨 시켜줘” |
| `REORDER_FAVORITE` | 최근 주문 재주문 | “늘 먹던 걸로 시켜줘” |
| `CHECK_ORDER_STATUS` | 전송 예정 시각·상태 안내 | “치킨 언제 들어가?” |

`schema.json`의 정확한 형식은 Pleos Playground 문서를 확인한 뒤 작성합니다.
서버 주소는 에뮬레이터에서 `http://10.0.2.2:4173`(서버를 `HOST=0.0.0.0`으로 실행)입니다.
