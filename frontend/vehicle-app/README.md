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

## 지금 들어 있는 것 (2단계: DriveOn 화면 + 실제 Pleos 내비)

`app/src/main/java/ai/driveon/car/MainActivity.kt`

- **화면**: 지금까지 만든 DriveOn 차량 화면(`/car/`)을 WebView로 그대로 띄운다 — 주문·사진 메뉴·결제·주문 현황·지도 깃발 전부
- **데이터**: Pleos **NaviHelper SDK 3.0.5**로 집까지 남은 시간(`remainTime`, 초)·거리(`remainDistance`, m)를 10초마다 받아
  서버 `POST /car/nav`로 보낸다. 서버는 가상 주행 대신 이 값으로 도착 예정과 **매장 전송 시각**을 계산한다
  (상태바에 `📡 Pleos 내비` 표시, 자동 빨리감기는 꺼지고 1배속)
- 목적지가 없으면 앱이 집(정자동)으로 경로를 요청한다

### 실행

1. PC에서 DriveOn 서버 실행: `frontend`에서 `npm start` (에뮬레이터에서는 `http://10.0.2.2:4173`으로 접속)
2. Pleos Connect Emulator(API 34, v2.1.0)를 켠다
   (공식 안내: https://document.pleos.ai/docs/connect/guide/getting-started/application-development/setup-connect-sdk-emulator)
3. Android Studio에서 이 폴더(`frontend/vehicle-app`)를 열고 ▶ 실행
   - 명령어로는: `gradlew assembleDebug` → `adb install -r -g app/build/outputs/apk/debug/app-debug.apk`

빌드 환경: Gradle 9.9.1 · Android Gradle Plugin 9.5.1 · compileSdk 37 · minSdk 28 · Android Studio 내장 JDK

### 확인된 것 / 남은 일

- ✅ 에뮬레이터에서 실제 Pleos 내비(집까지 17분·6.7km) 값으로 주문 → 조리+배달(30분)보다 짧아 즉시 전송까지 확인
- ⚠ 에뮬레이터 내비는 차 위치가 고정이라 주행하며 남은 시간이 줄어드는 장면은 재현되지 않음 (실차에서는 같은 코드로 갱신)
- ⚠ 주행(D·속도>0)하면 Android Automotive가 앱 화면을 막는다(“주행 중에는 사용할 수 없습니다”)
  → 주행 중 화면을 운전 방해 최적화(distraction-optimized)로 만들고 Pleos 앱 심사 승인, 또는 주행 중엔 Gleo 음성으로만
- ⚠ WebView에는 브라우저 음성 인식이 없어 마이크 주문은 아직 안 됨 → Gleo Interface / Pleos STT로 연결 예정
- 지도 위 차 위치는 아직 서버의 가상 경로(강남→정자동) 기준
