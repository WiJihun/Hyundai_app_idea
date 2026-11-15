# DriveOn — 도착 시간에 맞춰 주문을 보내는 차량용 음식 주문 앱

운전 중 Gleo에게 말로 주문하면, Pleos 내비의 도착 예정 시간에서 조리·배달 시간을 거꾸로 계산해 **알맞은 시각에 매장으로 주문을 자동 전송**하는 차량 앱입니다. 운전자와 음식이 집에 같이 도착합니다.

## 공모전 심사용 안내

| 항목 | 내용 |
| --- | --- |
| 앱 이름 | DriveOn |
| APK | [`apk/DriveOn_DriveOn_release.apk`](apk/DriveOn_DriveOn_release.apk) (release, 서명됨) |
| 차량 앱 소스 | [`frontend/vehicle-app/`](frontend/vehicle-app) — Kotlin, Pleos Connect SDK |
| 서버 · 화면 소스 | [`frontend/`](frontend) — Node.js 서버, 차량 화면(웹), 매장 POS, 데모 패널 |
| 에뮬레이터 | Pleos Connect Emulator **v2.1.0** (Android 14 · API 34 · x86_64) |
| 화면 규격 | **2560×1440, 12.8인치, mdpi(160dpi), 가로** (에뮬레이터 기본 기기 Pleos Connect v2.1.0) |

### 실행 방법

DriveOn 앱은 주문·매장·전송 시각 계산을 맡는 **DriveOn 서버**와 함께 동작합니다. 서버를 PC에서 먼저 켜고, 에뮬레이터에 APK를 설치합니다.

1. **서버 실행** (Node.js 23.6 이상, 추가 설치 없음)
   ```bash
   cd frontend
   npm start
   ```
   → `http://localhost:4173` (시연 무대: 차량 화면 + 매장 POS + 데모 패널)
2. **Pleos Connect Emulator v2.1.0 실행** — Android Studio › Device Manager › Pleos Connect v2.1.0 ▶ (AVD: RAM 4GB, Cold boot)
3. **APK 설치** (`-g`: 마이크·차속 권한 자동 허용)
   ```bash
   adb install -r -g apk/DriveOn_DriveOn_release.apk
   ```
4. 차량 화면 아래 줄의 **DriveOn** 아이콘 실행
   - 앱이 PC 서버(`http://10.0.2.2:4173`)에 연결하고, 목적지가 없으면 Pleos 내비로 집(정자동)까지 경로를 요청합니다.
   - 상태바에 `📡 Pleos 내비`가 뜨면 실제 내비의 남은 시간·거리·길 안내로 동작 중입니다.
5. **시연**
   - 위쪽 **Gleo** 버튼 → “치킨 시켜줘” (Pleos 음성 인식) → 메뉴 → “배달” → 결제(정차: 비밀번호 6자리 아무 숫자 / 주행: “응”)
   - 지도 위 📤 깃발 = 매장으로 주문이 들어가는 지점·시각, 매장 POS(`http://localhost:4173/pos/`)에 그 시각에 주문 도착
   - 포장(“가는 길에 있는 데로” → “포장”)을 고르면 Pleos 내비 경로에 매장 경유지가 추가됩니다.

에뮬레이터 없이 보기: PC 브라우저에서 `http://localhost:4173/` (시연 무대), `http://localhost:4173/voice/` (Gleo 음성 주문 콘솔), 서버 없이 [`frontend/dashboard/index.html`](frontend/dashboard/index.html) (화면 23장면).

### 테스트 환경 및 필요한 설정

- Windows 11, Android Studio(내장 JDK), Pleos Connect Emulator v2.1.0, Node.js 23.6+
- 에뮬레이터 → PC 서버 주소는 `10.0.2.2:4173` 고정 (PC에서 `npm start`가 켜져 있어야 함)
- 앱 권한: `pleos.car.permission.NAVI_ROUTE` · `NAVI_ROUTE_SEARCH` · `NAVI_CUSTOM_MAP` · `STT_SERVICE` · `TTS_SERVICE`, `RECORD_AUDIO`, `android.car.permission.CAR_SPEED` · `CAR_POWERTRAIN`
- 음성: 키 없이 차량 온디바이스 엔진으로 동작. Pleos 서버 인식은 소스 빌드 시 `frontend/vehicle-app/local.properties`에 `pleos.clientId`, `pleos.clientSecret` 입력
- 주행 상태 시험: `adb forward tcp:8088 tcp:8088` → `http://127.0.0.1:8088/` (Pleos Virtual Console)에서 기어 D + ACCEL → 앱이 주행 중 화면 제한·차속을 서버로 보고
- 소스 빌드: `frontend/vehicle-app`에서 `gradlew assembleDebug` (Gradle 9.9.1, AGP 9.5.1, compileSdk 37, minSdk 28, targetSdk 34)

### 사용한 Pleos · 차량 API

| 기능 | API |
| --- | --- |
| 집·경유지까지 남은 시간·거리 → 매장 전송 시각 역산 | NaviHelper `getDestinationInfo`, `onDrivingInfo` |
| 현재 위치·주소, 실시간 길 안내 | NaviHelper `getCurrentLocationInfo`, `getTBTInfo` |
| 포장 매장 경유지, 도착 이벤트, 내비 화면 | NaviHelper `addWaypoint`·`removeWaypoint`, `onWayPointArrived`·`onDestinationArrived`, `requestNavigationScreen` |
| 음성 주문 · 안내 음성 | Pleos SpeechToText 3.3.1, TextToSpeech 3.3.1 |
| 주행 중 화면 제한 · 차속 · 기어 | Android Automotive `CarUxRestrictionsManager`, `CarPropertyManager` |

자세한 내용: [`frontend/README.md`](frontend/README.md), [`frontend/vehicle-app/README.md`](frontend/vehicle-app/README.md)

---

# 팀 저장소 안내 (Hyundai App Idea)

현대차 앱 공모전 팀 레포지토리.

## 팀원
- @WiJihun (관리자)
- @Onjunhwi
- @jeonghasang
- @qortmdcjf

## 폴더 구조
| 폴더 | 내용 |
|---|---|
| [`story/`](story) | 기획 · 스토리 · 시나리오 · 발표 자료 |
| [`frontend/`](frontend) | 앱 화면(UI) |
| [`backend/`](backend) | 서버 · API · DB |

## 시작하기
```bash
git clone https://github.com/WiJihun/Hyundai_app_idea.git
cd Hyundai_app_idea
```

## 작업 규칙
1. `main`에 직접 push 하지 않는다. 항상 브랜치를 만들어 작업한다.
   - **새로운 작업**을 시작하거나, 지금 하던 것과 **방향이 다른 작업**을 하게 되면 기존 브랜치에 이어서 하지 말고 **새 브랜치를 연다.**
   - 브랜치 하나에는 작업 하나만 담는다. (예: 로그인 화면 작업 중 지도 기능이 필요해지면 → `feature/map` 새 브랜치)
   ```bash
   git switch main
   git pull
   git switch -c feature/작업이름
   ```
2. 작업 후 커밋 → push → GitHub에서 Pull Request(PR) 생성.
   ```bash
   git add .
   git commit -m "feat: 무엇을 했는지"
   git push -u origin feature/작업이름
   ```
3. 팀원 1명 이상 확인 후 `main`에 merge.
4. merge 후 다른 팀원은 `git switch main && git pull`로 최신화.

### 브랜치 이름
- `feature/…` 새 기능 · `fix/…` 버그 수정 · `docs/…` 문서/기획

### 커밋 메시지
- `feat:` 기능 추가 · `fix:` 버그 수정 · `docs:` 문서 · `design:` 디자인/UI
