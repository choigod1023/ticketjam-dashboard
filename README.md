# 티켓잼 프로야구 티켓 대시보드

[ticketjam.jp](https://ticketjam.jp/categories/baseball) 의 NPB 리세일 티켓을 **여행 기간에 맞춰 자동으로 수집·추적**하는 로컬 대시보드입니다.
경기별 최저가 / 중앙값 / 출품 건수를 주기적으로 갱신하고, 갱신이 쌓이면 **가격 추이 그래프**를 그려줍니다.

의존성이 없습니다. Node 18 이상만 있으면 바로 실행됩니다.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)
![Zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?logo=githubpages&logoColor=white)

## 실행

```bash
npm start           # http://localhost:4173
```

첫 실행 시 수집 데이터가 없으면 자동으로 한 번 수집합니다(약 1분). 이후 10분마다 자동 갱신합니다.
수집만 한 번 돌리려면 `npm run refresh`.

## 여행 날짜 설정

`config.json` 의 `trip.start/end` 가 **수집 범위**입니다. 이 범위 안에서만 가격을 모읍니다.
화면의 날짜·지역·"1매만" 필터는 **이미 수집된 데이터를 브라우저에서 걸러 보여주는 것**이라 즉시 반영되고,
수집 범위 자체를 바꾸려면 `config.json` 을 고쳐 푸시해야 합니다.
브라우저 상단의 **시작일 / 종료일 / 지역**을 고치고 **적용**을 누르면 `config.json` 에 저장되고 즉시 재수집합니다.
직접 편집해도 됩니다:

```json
{
  "trip": { "start": "2026-08-05", "end": "2026-08-05" },
  "ticketCount": 1,
  "regions": ["東京都", "神奈川県", "千葉県", "埼玉県"],
  "refreshMinutes": 30,
  "maxPagesPerEvent": 3,
  "requestDelayMs": 700,
  "port": 4173
}
```

| 항목 | 설명 |
|---|---|
| `trip.start/end` | 수집할 경기 날짜 범위 (일본시간 기준, 양끝 포함) |
| `regions` | 도도부현 필터. 도쿄만 보려면 `["東京都"]` |
| `ticketCount` | `1` 이면 1매만 구매 가능한 매물로 한정. `null` 이면 전체 |
| `refreshMinutes` | 로컬 서버의 갱신 주기(분). 배포본 주기는 워크플로 cron |
| `scheduleTtlHours` | 경기 일정 캐시 수명(시간). 일정은 거의 안 바뀌므로 매번 받지 않는다 |
| `maxPagesPerEvent` | 경기당 최대 수집 페이지(1페이지=100건) |
| `requestDelayMs` | 요청 간격. 사이트 부담을 줄이려 요청을 직렬로 보냅니다 |

### 구장 위치 참고

도쿄돔·진구구장은 `東京都`, 요코하마스타디움은 `神奈川県`, ZOZO마린은 `千葉県`, 베루나돔은 `埼玉県` 입니다.
도쿄 시내 경기만 원하면 `regions` 를 `["東京都"]` 로 두세요.

## 화면

- **상단 타일** — 기간 내 경기 수, 전체 최저가, 경기별 최저가 평균, 총 출품 건수
- **날짜별 경기 카드** — 대진·구장·시각, 최저가, 중앙값, 출품 건수, 직전 갱신 대비 증감, 최저가 스파크라인
- **상세** — 최저가/중앙값 추이 그래프(마우스를 올리면 시점별 값 표시)와 **최저가 15건 목록**(가격·매수·좌석·수령방법·원본 링크)

가격은 모두 **1매 기준(엔)**, 시각은 **일본시간(JST)** 입니다.

### 자격제한 좌석

`高校生`·`シニア`·`女性限定` 같은 **자격제한 좌석**은 다른 매물보다 훨씬 싸게 나와서 최저가를 왜곡합니다.
그래서 이런 매물은 최저가/중앙값 통계에서 **제외**하고, 목록에는 빨간 `자격제한` 배지를 달아 남겨둡니다.

## 동작 방식

1. 팀별 `/tickets/{team}/battle_cards` 를 1회씩 요청해 잔여 경기 일정을 받습니다.
   각 경기에 JSON-LD `SportsEvent` 가 붙어 있어 날짜·구장·도도부현을 정확히 얻습니다.
2. 여행 기간 + 지역에 해당하는 경기만 골라 `/tickets/{team}/event/{id}` 를 **가격 오름차순**으로 요청합니다.
   정렬을 걸어두었기 때문에 페이지를 일부만 읽어도 **최저가는 항상 정확**합니다.
3. 경기별 통계(min / p25 / median / max / 건수)를 `data/history.json` 에 시계열로 누적하고,
   화면용 데이터를 `data/latest.json` 에 씁니다.

경기 ID는 사이트 전역에서 유일해서, 같은 경기가 홈/원정 양쪽 팀 페이지에 나와도 중복 없이 하나로 합쳐집니다.

## 자동 갱신 & 배포

`.github/workflows/refresh.yml` 이 **10분마다** 돌면서 가격을 수집하고, 결과(`data/latest.json`,
`data/history.json`)를 저장소에 커밋한 뒤 GitHub Pages 로 배포합니다. 로컬에서 맥을 켜둘 필요가 없습니다.

- 이력이 저장소에 쌓이므로 가격 추이가 배포본에서도 그대로 보입니다
- 배포본은 읽기 전용입니다 — "지금 갱신" 버튼은 로컬 서버로 열었을 때만 나타납니다
- 수동 실행: Actions 탭 → *Refresh prices & publish* → Run workflow

## 파일

```
config.json        설정
server.js          HTTP 서버 + 자동 갱신 스케줄러
refresh-once.js    1회 수집 CLI
lib/http.js        요청 직렬화·재시도
lib/parse.js       JSON-LD / 출품 목록 파서
lib/store.js       설정·이력 저장 (원자적 쓰기)
lib/refresh.js     수집 파이프라인
public/            대시보드 (정적 파일)
data/              수집 결과 — history.json(시계열, 커밋됨), latest.json(매 실행 재생성·Pages로만 배포)
.github/workflows/ 10분 주기 수집 + Pages 배포
```

## 참고

- 개인적으로 쓰는 용도로 요청을 직렬 + 0.7초 간격으로 보냅니다. `requestDelayMs` 를 더 줄이지 마세요.
- 사이트 HTML 구조가 바뀌면 `lib/parse.js` 만 고치면 됩니다.
- 티켓잼은 개인 간 리세일이라 매물이 수시로 사라집니다. 실제 구매 전 원본 링크에서 확인하세요.

## 항상 켜두고 싶다면 (선택)

`~/Library/LaunchAgents/com.local.ticketjam.plist` 를 만들어 로그인 시 자동 실행할 수 있습니다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>com.local.ticketjam</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/node</string><string>/Users/jangjunhyeok/ticketjam-dashboard/server.js</string></array>
  <key>WorkingDirectory</key><string>/Users/jangjunhyeok/ticketjam-dashboard</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

`node` 경로는 `which node` 로 확인해 바꾸고, `launchctl load ~/Library/LaunchAgents/com.local.ticketjam.plist` 로 등록합니다.
