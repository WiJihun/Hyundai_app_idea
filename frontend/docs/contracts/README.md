# 인터페이스 계약

설계서 6번 형식을 따르고, 비어 있던 세부(ETA 보고 본문, 응답 필드)는 이 구현에서 정했습니다.
형식을 바꿀 때는 설계서를 먼저 고치고 팀에 공지한 뒤 이 문서와 서버를 맞춥니다.

- 시각은 모두 **epoch 밀리초**(숫자)입니다. ETA 보고에는 ISO 문자열도 받습니다.
- 금액은 원 단위 정수, 시간 길이는 분 단위 정수입니다.
- 오류 응답: `{ "error": "UNKNOWN_ITEM", "message": "메뉴에 없는 항목: m99" }` + HTTP 상태(400/402/404/409).

## 주문 API (P5)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/home?lat=&lng=&destLat=&destLng=[&category=치킨]` | 호출 화면: `recent` · `nearHome` · `onTheWay` (각 최대 3) |
| GET | `/stores/{id}/menu` | 메뉴 조회 |
| POST | `/orders` | 주문 생성 + 결제(모의). 바로 `SCHEDULED`(전송 대기) |
| POST | `/orders/{id}/eta` | 차량 ETA 보고(30초마다). 전송 시각 재계산 |
| GET | `/orders/{id}` | 상태 조회(전송 예정 시각 포함) |
| POST | `/orders/{id}/cancel` | 전송 전 취소(무료). 전송 후에는 409 `ALREADY_SENT` |
| GET | `/orders` | 전체 목록(POS용) |

### 메뉴 (P5 → P3·P4)

```json
{ "storeId": "s01", "name": "바삭마요치킨 정자점", "congestionMin": 0,
  "items": [
    { "id": "m02", "name": "청양마요치킨", "price": 21900, "prepMin": 20,
      "options": [{ "id": "o1", "name": "콜라 1.25L", "price": 2500 }] } ] }
```

### 주문 생성 `POST /orders`

```json
{ "storeId": "s01",
  "items": [{ "itemId": "m02", "qty": 1, "optionIds": ["o1"] }],
  "mode": "DELIVERY",
  "eta": { "destinationEta": 1794652800000, "waypointEta": null } }
```

- `mode`: `DELIVERY`(집 도착 기준) | `PICKUP`(경유지 매장 도착 기준, `waypointEta` 필수)
- `vehicle`(선택): `{ "plate": "12가 3456" }`. **포장일 때만** 저장해 POS에 보여 주고, 배달 주문이면 서버가 버린다(개인정보 최소 수집).
- 가격은 서버가 메뉴로 다시 계산합니다(앱이 보낸 금액을 믿지 않음). 메뉴에 없는 항목은 400.
- 결제 실패는 402 `PAYMENT_FAILED`.
- 이미 늦은 주문(전송 시각 ≤ 지금)은 즉시 `SENT`가 되고 `lateMin`(도착 후 몇 분 뒤 받는지)이 채워집니다.

### ETA 보고 `POST /orders/{id}/eta`

```json
{ "destinationEta": 1794653160000, "waypointEta": null }
```

전송 시각 = 수령 지점 도착 예정 + 수령 여유(배달 +3, 포장 −1) − 조리(메뉴 최대 + 매장 혼잡) − 배달(배달만).
지금 시각이 전송 시각을 지나면 서버가 매장으로 보냅니다. 전송 후 보고는 POS의 ‘고객 도착 예정’만 갱신합니다.

### 주문 응답

```json
{ "id": "ord-0001", "status": "SCHEDULED", "mode": "DELIVERY",
  "storeId": "s01", "storeName": "바삭마요치킨 정자점",
  "lines": [{ "itemId": "m02", "name": "청양마요치킨", "qty": 1, "optionIds": [], "options": [], "unitPrice": 21900, "lineTotal": 21900 }],
  "total": 21900, "prepMin": 20, "deliveryMin": 10, "marginMin": 3,
  "pickupEta": 1794652800000, "dispatchAt": 1794651180000, "sentAt": null, "lateMin": null,
  "payment": { "provider": "mock-incar-payment", "approvalNo": "MOCK-000001" },
  "etaHistory": [{ "at": 1794649000000, "pickupEta": 1794652800000, "dispatchAt": 1794651180000 }],
  "display": { "pickupEta": "19:40", "dispatchAt": "19:13", "sentAt": null, "readyAt": "19:43" } }
```

상태: `SCHEDULED`(전송 대기) → `SENT`(매장 전송, 시연 끝) / `CANCELLED`.

포장 주문에는 `"vehicle": { "plate": "12가 3456" }`과 `"customerArrivedAt"`(차가 매장 경유지에 닿은 시각, 그전에는 `null`)이 붙습니다.
SSE `pos.order`의 `kind`는 `created` · `updated` · `sent` · `cancelled` · `arrived`(포장 고객 도착) · `accepted`(매장 접수) · `done`(조리 완료)입니다.

매장 쪽 처리 상태 `storeStatus`: 매장 전송(`SENT`) 순간 `NEW` → POS에서 접수하면 `ACCEPTED`(`acceptedAt`) → 조리 완료하면 `DONE`(`doneAt`). 전송 전에는 `null`.
주문 응답에는 `itemsTotal`(메뉴 합계), `deliveryTip`(배달팁, 포장이면 0), `total`(결제금액)과 `payment.card`(`issuer`·`name`·`last4`), `payment.installment`가 있습니다.

## Gleo 해석 결과 (P4 → P3)

```json
{ "intent": "ADD_ITEM", "storeId": "s01", "itemId": "m02", "qty": 1, "optionIds": ["o1"],
  "needsConfirm": true, "ttsText": "청양마요치킨 한 마리, 21,900원이에요. 음료 추가할까요?" }
```

`intent`: `START_FOOD_ORDER` · `REORDER_FAVORITE` · `CHECK_ORDER_STATUS` · `CANCEL` · `SELECT_STORE` · `OPEN_MENU` · `CLOSE_MENU` ·
`ADD_ITEM` · `ADD_OPTION` · `REMOVE_ITEM` · `CHOOSE_MODE` · `CONFIRM` · `DENY` · `UNKNOWN`

## 주행 상태 이벤트 (P3 내부, 데모 패널과 공유)

```json
{ "speedKmh": 0, "gear": "D", "state": "STOPPED", "ts": 1731580000 }
```

웹 프로토타입에서는 `GET /state`의 `car` 필드(`state`, `speedKmh`, `uxRestricted`)가 같은 역할을 합니다.

## 시연 전용 API (웹 프로토타입에만 있음)

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/events` | SSE: `state`(250ms) · `gleo.say` · `pos.order` |
| GET | `/state` | 시계 · 차량 · 대화 세션 · 주문 · 매장 혼잡 |
| POST | `/gleo/utterance` | `{ "text": "치킨 시켜줘" }` → Gleo 해석 결과 |
| POST | `/gleo/action` | 화면 터치: `{ "type": "SELECT_STORE", "storeId": "s03" }` 등 |
| POST | `/demo/control` | `{ "action": "jam", "value": 6 }` — `reset` `speed` `pause` `resume` `drive` `stop` `park` `jam` `fast` `clearTraffic` `failNextPayment` `autoFastForward` |
| POST | `/pos/stores/{id}/congestion` | `{ "extraPrepMin": 5 }` 매장 혼잡 보정 |
| POST | `/pos/orders/{id}/accept` | 매장 접수 (`NEW` → `ACCEPTED`). 전송 전이면 409 `NOT_SENT` |
| POST | `/pos/orders/{id}/complete` | 조리 완료 (`ACCEPTED` → `DONE`). 접수 전이면 409 `NOT_ACCEPTED` |
