# DriveOn 이미지 생성 프롬프트

DriveOn 기획서·영상·차량 화면에 넣을 **가상 이미지**용 프롬프트입니다.

- **A. 지도(내비) 이미지:** 기획서와 영상에 쓸 장면 이미지와 지도 아이콘
- **B. 메뉴 사진:** 차량 화면 메뉴 카드에 넣을 음식 사진

매장·메뉴는 모두 가상이므로 실제 브랜드 로고, 포장지, 병 라벨, 차량 엠블럼이 나오지 않게 합니다.

---

# A. 지도(내비) 이미지

## 지금 차량 화면의 지도에 들어간 것 (실제 화면, 생성할 필요 없음)

| 위치 | 내용 |
| --- | --- |
| 지도 바탕 | 위성 사진(도로·지명 겹침) 또는 일반 지도(야간)이며, 오른쪽 위 🛰️/🗺️ 버튼으로 바꿉니다. |
| 경로 | 강남역 → 경부고속도로 → 판교IC → 정자동 실제 도로입니다. 지나온 길은 회색, 남은 길은 파랑, 정체 구간은 빨강입니다. |
| 왼쪽 위 | 길 안내 카드에 큰 화살표, 남은 거리, 길 이름이 나옵니다 (예: ↱ 770m 논현로). |
| 경로 위 | 📤 **주문 전송 지점 깃발**: "19:13 여기서 주문 전송". 정체로 시각이 바뀌면 주황색으로 "19:13 → 19:21"을 보여 주고, 핀이 움직이면 원래 자리에 흐린 핀과 점선을 잠깐 남깁니다. |
| 핀 | 🚗 내 차(진행 방향 화살표), 🏢 회사, 🏠 집, 가게 핀(음식 그림 + 앱 카드와 같은 번호)이 있습니다. |
| 아래 | 🏠 도착 시각 · 📍 남은 거리 · 📤 전송 시각(몇 km 앞) · 🚦 정체 +분 |

화면 캡처는 영상·기획서에 실제 화면을 그대로 쓰면 됩니다. 아래 프롬프트는 **실제 화면으로 보여 주기 어려운 장면**(차 안 전경, 개념도, 아이콘)용입니다.

## 공통 스타일 (지도 이미지)

```
Clean modern automotive UI concept render, night-time, dark interior, soft ambient light, high detail,
no brand logos, no car emblem, no readable real-world brand text, 16:9.
```

## 장면 이미지 (기획서·영상용, 16:9)

| 파일 이름 | 장면 | 설명 (한글) | 프롬프트 (영문) |
| --- | --- | --- | --- |
| `map-cockpit` | 차 안 전경 | 저녁 퇴근길, 운전석 뒤에서 본 센터 디스플레이. 왼쪽은 위성 내비, 오른쪽은 민트색 음식 주문 앱 | Interior of a modern electric sedan at dusk on a city highway, view from behind the driver's shoulder, wide center touchscreen split in two: left half a satellite navigation map with a bright blue route line and a small mint-green flag pin on the route, right half a bright mint-and-white food ordering app with large food photo cards, warm sunset light through windshield, no logos |
| `map-dispatch-pin` | 전송 지점 깃발 | 위성 지도 경로 위에 "여기서 주문 전송" 깃발이 꽂혀 있고, 그 앞을 차 화살표가 달려가는 클로즈업 | Close-up of a satellite navigation map on a car display, a thick blue route line along a highway, a white car arrow icon driving on the route, ahead of it a mint-green flag pin standing on the route with a small paper-plane send icon, glowing subtle pulse around the flag, dark UI overlay chips at the bottom |
| `map-jam-shift` | 정체 → 깃발 이동 | 두 칸 비교: 왼쪽은 원활(깃발 앞쪽), 오른쪽은 빨간 정체 구간이 생기고 깃발이 경로를 따라 집 쪽으로 옮겨감(원래 자리에 흐린 깃발, 점선 화살표) | Two-panel before-and-after infographic of a navigation map: left panel normal traffic with blue route and a mint flag pin at mid-route; right panel a red traffic-jam segment near the car and the mint flag moved further along the route toward a house icon, a faded ghost flag at the old position connected by an orange dotted arrow, minimal flat style, dark background |
| `map-timeline` | 핵심 아이디어 개념도 | 경로를 가로선으로 펼친 그림: 🚗 출발 → 📤 전송 지점 → 👨‍🍳 조리 → 🏠 도착, 차와 음식이 집에 동시에 도착 | Horizontal infographic timeline along a road: a car icon on the left, a mint flag labeled with a paper-plane icon in the middle marking the order send point, a chef icon above the road showing cooking, and on the right a house where the car and a delivery scooter arrive at the same moment, flat vector style, soft pastel colors, no text |
| `map-pickup` | 포장 수령 | 가는 길 매장 앞 갓길에 차가 서고, 점원이 창문으로 포장 봉투를 건넴 | Evening street in a Korean neighborhood, a car pulled over in front of a small fried chicken shop, a smiling staff member handing a takeaway paper bag through the open driver window, warm shop lights, shallow depth of field, no shop sign text, no logos |

## 지도 아이콘 (선택, 투명 배경 1:1)

지금은 이모지와 코드로 그린 아이콘을 씁니다. 통일된 아이콘이 필요하면 아래로 만들어 `vehicle-web/img/map/`에 넣습니다.

**공통 스타일 (아이콘)**

```
Flat vector map icon, bold simple shapes, thick white outline, soft drop shadow, transparent background, centered, 1:1, no text.
```

| 파일 이름 | 아이콘 | 프롬프트 (영문) |
| --- | --- | --- |
| `icon-car` | 내 차 | Navigation car arrow icon, white chevron arrow inside a blue circle with a soft blue glow ring, top-down |
| `icon-dispatch-flag` | 주문 전송 깃발 | Mint green flag on a white pole with a small white paper-plane symbol on the flag, round mint base dot |
| `icon-home` | 집 | Simple house icon in a white circle, green roof |
| `icon-office` | 회사 | Simple office building icon in a white circle, gray tones |
| `icon-store-chicken` | 치킨 가게 핀 | Map pin shaped like a rounded teardrop, white fill with dark border, a fried chicken drumstick inside |
| `icon-store-pizza` | 피자 가게 핀 | Same teardrop map pin style, a pizza slice inside |
| `icon-store-burger` | 버거 가게 핀 | Same teardrop map pin style, a burger inside |
| `icon-store-snack` | 분식 가게 핀 | Same teardrop map pin style, a bowl of red tteokbokki inside |
| `icon-store-cafe` | 카페 핀 | Same teardrop map pin style, a coffee cup inside |
| `icon-jam` | 정체 | Traffic light icon with red light glowing, small red warning wave |

---

# B. 메뉴 사진

차량 화면(`vehicle-web`)의 메뉴 그림 카드에 넣을 **가상 음식 사진**입니다.

## 공통 규칙 (모든 프롬프트 앞이나 뒤에 붙이기)

**공통 스타일 (영문, 복사해서 사용)**

```
Professional food photography for a delivery app menu card. Single dish centered with generous empty margin around it,
45-degree overhead angle, soft warm studio lighting, shallow depth of field, appetizing and glossy,
plain seamless pastel background (color given below), no text, no logo, no brand, no packaging print, no hands, no people,
square 1:1, high detail, photorealistic.
```

**네거티브 프롬프트 (지원하는 도구만)**

```
text, letters, watermark, logo, brand name, label, menu board, hands, people, cutlery clutter, dark background, blurry, cartoon, illustration
```

| 항목 | 값 |
| --- | --- |
| 비율·크기 | 1:1, 1024×1024 이상. 화면 카드는 4:3으로 잘리니 음식을 가운데에 두고 위아래 여백을 남깁니다. |
| 저장 형식 | `.webp` 또는 `.png`. 아래 표의 파일 이름으로 `vehicle-web/img/menu/`에 넣습니다. |
| 배경색 | 카테고리별 파스텔 단색. 앱의 그림 칸 색과 맞춥니다. 치킨은 `#FFE2B8`(살구), 피자는 `#FFC9B5`(연한 토마토), 버거는 `#FFE7A0`(연노랑), 분식은 `#FFC6CC`(연분홍), 카페·음료는 `#E2D2C0`(라떼 베이지)입니다. |
| 같은 이름 메뉴 | 후라이드치킨은 매장 4곳, 떡볶이는 2곳에 있습니다. 사진은 한 장만 만들어 함께 씁니다. |

---

## 1. 치킨 (배경 `#FFE2B8` 살구색)

| 파일 이름 | 메뉴 | 사진 설명 (한글) | 프롬프트 (영문) |
| --- | --- | --- | --- |
| `chicken-gochu-mayo` | 고추마요치킨 | 바삭한 순살 튀김 위에 하얀 마요 소스를 지그재그로 뿌리고 송송 썬 초록·빨간 고추를 올림 | Korean fried chicken pieces piled in a shallow white bowl, drizzled with zigzag lines of creamy white mayo sauce, topped with thinly sliced green and red chili peppers, crispy golden crust |
| `chicken-cheongyang-mayo` | 청양마요치킨 | 고추마요보다 매운 버전. 청양고추가 더 많고 마요 위에 붉은 고춧가루가 살짝 뿌려짐 | Spicy Korean fried chicken with creamy mayo drizzle, generously topped with chopped green Cheongyang chili peppers and a light dusting of red chili flakes, crispy golden crust, extra spicy look |
| `chicken-fried` | 후라이드치킨 | 기본 후라이드. 뼈 있는 조각, 겉은 바삭하고 황금빛, 무 한 조각 곁들임 | Classic Korean crispy fried chicken, bone-in pieces with craggy golden-brown crust, stacked in a paper-lined basket, a small side dish of white pickled radish cubes |
| `chicken-yangnyeom` | 양념치킨 | 빨갛고 윤기 나는 달콤매콤 양념 코팅, 깨 뿌림 | Korean yangnyeom chicken, pieces fully coated in glossy sticky sweet-and-spicy red sauce, sprinkled with toasted sesame seeds, shiny caramelized surface |
| `chicken-banban` | 반반치킨 | 접시 절반은 후라이드, 절반은 양념. 가운데에서 깔끔하게 나뉨 | Half-and-half Korean chicken on one round plate: left half crispy golden fried chicken, right half glossy red yangnyeom sauced chicken, clean dividing line in the middle, sesame seeds on the sauced side |
| `chicken-ganjang` | 간장치킨 | 갈색 간장 소스로 윤기 나는 치킨, 통깨와 쪽파 | Korean soy garlic chicken, pieces glazed in glossy dark amber soy sauce, sprinkled with sesame seeds and chopped green onion |
| `chicken-garlic` | 마늘치킨 | 바삭한 치킨 위에 튀긴 마늘 플레이크와 통마늘이 듬뿍 | Korean garlic fried chicken, golden pieces covered with crispy fried garlic flakes and whole roasted garlic cloves, light honey-garlic glaze |
| `chicken-bbq` | 숯불바베큐치킨 | 숯불에 구운 그을음 자국, 진한 바베큐 소스 | Charcoal-grilled Korean BBQ chicken, smoky char marks, brushed with thick dark barbecue sauce, slightly blackened edges, a few grill-marked pieces |

## 2. 피자 (배경 `#FFC9B5` 연한 토마토색)

| 파일 이름 | 메뉴 | 사진 설명 (한글) | 프롬프트 (영문) |
| --- | --- | --- | --- |
| `pizza-pepperoni` | 페퍼로니피자 | 둥근 피자 위 페퍼로니가 빈틈없이 덮임, 한 조각 살짝 들려 치즈가 늘어남 | Whole round pepperoni pizza viewed from above at an angle, covered edge to edge with crispy cupped pepperoni slices, one slice slightly lifted with stretchy melted mozzarella |
| `pizza-bulgogi` | 불고기피자 | 달콤한 소불고기, 양파, 피망, 모차렐라 | Korean bulgogi pizza, thinly sliced marinated beef bulgogi, caramelized onions, green bell pepper and mushrooms on melted mozzarella, golden crust |
| `pizza-potato` | 포테이토피자 | 웨지 감자, 베이컨 조각, 옥수수, 마요 드리즐 | Korean potato pizza topped with roasted potato wedges, bacon bits, sweet corn and a drizzle of mayo, melted cheese, golden crust |
| `pizza-margherita` | 마르게리따 | 화덕에 구운 얇은 도우, 토마토소스, 생모차렐라, 바질 잎 | Wood-fired Neapolitan margherita pizza, blistered leopard-spotted crust, bright red tomato sauce, fresh mozzarella rounds, fresh basil leaves |
| `pizza-gorgonzola` | 고르곤졸라 | 화덕 도우 위 하얀 치즈, 옆에 꿀 종지 | Wood-fired gorgonzola pizza with white cheese base and blue cheese crumbles, light char on crust, a small ramekin of golden honey on the side |

## 3. 버거 (배경 `#FFE7A0` 연노랑)

| 파일 이름 | 메뉴 | 사진 설명 (한글) | 프롬프트 (영문) |
| --- | --- | --- | --- |
| `burger-double-cheese` | 더블치즈버거 | 패티 두 장과 녹아내리는 체다 두 장, 참깨 번 | Double cheeseburger, two beef patties with melting cheddar slices dripping down the sides, pickles, sesame seed bun, front three-quarter view |
| `burger-bacon` | 베이컨버거 | 바삭한 베이컨, 양상추, 토마토, 패티 | Bacon burger with crispy bacon strips, beef patty, lettuce, tomato slice and cheese in a toasted brioche bun, front three-quarter view |

## 4. 분식 (배경 `#FFC6CC` 연분홍)

| 파일 이름 | 메뉴 | 사진 설명 (한글) | 프롬프트 (영문) |
| --- | --- | --- | --- |
| `snack-tteokbokki` | 떡볶이 | 국물 자작한 옛날 떡볶이, 어묵, 삶은 달걀 반쪽, 대파 | Korean tteokbokki in a shallow pan, chewy rice cakes in glossy red gochujang sauce with fish cake slices, a halved boiled egg and sliced green onion |
| `snack-rose-tteokbokki` | 로제떡볶이 | 크림과 고추장을 섞은 주황빛 로제 소스, 치즈 | Rose tteokbokki, rice cakes in creamy orange-pink rosé sauce (cream mixed with gochujang), melted cheese on top, sausage slices, parsley flakes |
| `snack-gimbap` | 김밥 | 썰어 놓은 김밥, 단면에 단무지·시금치·당근·달걀 | Sliced Korean gimbap rolls arranged in a row, cross-sections showing yellow pickled radish, spinach, carrot, egg and ham, glossy seaweed brushed with sesame oil |
| `snack-sundae` | 순대 | 썰어 놓은 순대, 소금 종지 | Sliced Korean sundae blood sausage on a plate, glass noodle filling visible in cross-section, small dish of seasoned salt on the side |
| `snack-twigim` | 모둠튀김 | 김말이, 고구마튀김, 오징어튀김, 새우튀김 | Assorted Korean twigim fritters in a paper-lined basket: seaweed noodle rolls, sweet potato tempura, squid tempura and shrimp tempura, crispy golden batter |

## 5. 카페 (배경 `#E2D2C0` 라떼 베이지)

| 파일 이름 | 메뉴 | 사진 설명 (한글) | 프롬프트 (영문) |
| --- | --- | --- | --- |
| `cafe-iced-americano` | 아이스 아메리카노 | 투명 테이크아웃 컵에 얼음, 진한 커피. 컵에 인쇄 없음 | Iced americano in a clear plain plastic takeaway cup with dome lid and straw, ice cubes, dark coffee, condensation droplets, no print on cup |
| `cafe-latte` | 카페라떼 | 하얀 머그에 라떼아트 하트 | Hot cafe latte in a plain white ceramic cup on saucer, heart-shaped latte art, top-down angle |

## 6. 추가 메뉴 (작은 아이콘 크기로 쓰므로 단순하게)

| 파일 이름 | 메뉴 | 사진 설명 (한글) | 프롬프트 (영문) |
| --- | --- | --- | --- |
| `side-cola-large` | 콜라 1.25L | 라벨 없는 페트병, 갈색 탄산음료 | Plain unlabeled 1.25L PET bottle of dark cola with red cap, no label, no logo, fizz bubbles |
| `side-cider-large` | 사이다 1.25L | 라벨 없는 초록 페트병, 투명 탄산 | Plain unlabeled 1.25L green-tinted PET bottle of clear lemon-lime soda, no label, no logo |
| `side-cola-small` | 콜라 500ml | 라벨 없는 작은 병 | Plain unlabeled 500ml bottle of dark cola with red cap, no label, no logo |
| `side-cheese-ball` | 치즈볼 | 동그란 치즈볼 여러 개, 하나는 갈라져 치즈가 늘어남 | Golden fried Korean cheese balls in a small paper cup, one ball pulled apart with stretchy mozzarella |
| `side-fries` | 감자튀김 | 종이컵에 담긴 감자튀김 | Crispy golden french fries in a plain paper cup, lightly salted |
| `side-garlic-dip` | 갈릭디핑소스 | 작은 종지 속 크림색 갈릭 소스 | Small ramekin of creamy garlic dipping sauce with parsley flakes |
| `side-cheese-crust` | 치즈크러스트 | 피자 가장자리에서 치즈가 흘러나옴 | Close-up of a pizza crust edge stuffed with melted mozzarella oozing out of the cut |

---

## (선택) 카테고리 대표 이미지

홈 화면 카테고리 타일에 쓸 이미지입니다. 지금은 이모지를 쓰고 있으며, 원하면 교체할 수 있습니다.
배경은 투명이거나 위 카테고리 색으로 하고, 음식 하나를 아이콘처럼 크게 넣습니다.

| 파일 이름 | 프롬프트 (영문) |
| --- | --- |
| `cat-chicken` | A single crispy Korean fried chicken drumstick, isolated, centered, glossy, pastel apricot background |
| `cat-pizza` | A single pepperoni pizza slice with stretchy cheese, isolated, centered, pastel tomato background |
| `cat-burger` | A single cheeseburger, isolated, centered, front view, pastel yellow background |
| `cat-snack` | A small bowl of red tteokbokki, isolated, centered, pastel pink background |
| `cat-cafe` | A single iced coffee in a clear plain cup, isolated, centered, latte beige background |
