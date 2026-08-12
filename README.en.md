# TicketJam NPB Ticket Dashboard

[한국어](README.md) · [日本語](README.ja.md) · **English**

A local dashboard that **automatically collects and tracks** NPB resale tickets from [ticketjam.jp](https://ticketjam.jp/categories/baseball) **for your trip dates**.
It periodically refreshes each game's lowest price, median, and listing count, and once enough refreshes accumulate it draws **price-trend charts**.

Zero dependencies. If you have Node 18 or newer, it just runs.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)
![Zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?logo=githubpages&logoColor=white)

## Running

```bash
npm start           # http://localhost:4173
```

On first launch, if no data has been collected it runs one collection automatically (about a minute), then refreshes every 10 minutes.
To run a single collection only, use `npm run refresh`.

## Setting your trip dates

`trip.start/end` in `config.json` defines the **collection window** — prices are only gathered inside it.
The date, region, and "single ticket only" filters in the UI **filter already-collected data in the browser**, so they apply instantly; changing the collection window itself means editing `config.json` and pushing.
Changing **start date / end date / region** at the top of the page and pressing **Apply** saves to `config.json` and re-collects immediately.
You can also edit it directly:

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

| Key | Description |
|---|---|
| `trip.start/end` | Range of game dates to collect (Japan time, inclusive on both ends) |
| `regions` | Prefecture filter. For Tokyo only, use `["東京都"]` |
| `ticketCount` | `1` restricts to listings you can buy a single ticket from; `null` means all |
| `refreshMinutes` | Refresh interval (minutes) for the local server. The deployed version's interval is the workflow cron |
| `scheduleTtlHours` | TTL (hours) of the fixture-schedule cache — schedules rarely change, so they aren't refetched every time |
| `maxPagesPerEvent` | Max pages collected per game (1 page = 100 listings) |
| `requestDelayMs` | Delay between requests. Requests are sent serially to be gentle on the site |

### Stadium locations, for reference

Tokyo Dome and Jingu Stadium are in `東京都`, Yokohama Stadium in `神奈川県`, ZOZO Marine in `千葉県`, and Belluna Dome in `埼玉県`.
For games inside Tokyo only, set `regions` to `["東京都"]`.

## The UI

- **Top tiles** — number of games in range, overall lowest price, average of per-game lows, total listings
- **Game cards by date** — matchup, stadium, time, lowest price, median, listing count, change since the last refresh, and a lowest-price sparkline
- **Detail** — lowest/median trend charts (hover to see values at each point) and a **list of the 15 cheapest listings** (price, quantity, seat, delivery method, source link)

All prices are **per ticket, in yen**, and all times are **Japan Standard Time (JST)**.

### Restricted-eligibility seats

**Restricted seats** such as `高校生` (high schooler), `シニア` (senior), and `女性限定` (women only) list far below everything else and distort the lowest price.
So they are **excluded** from the lowest/median statistics but kept in the list with a red "restricted" badge.

## How it works

1. Requests each team's `/tickets/{team}/battle_cards` once to get the remaining fixture schedule.
   Each game carries JSON-LD `SportsEvent` data, which gives the exact date, stadium, and prefecture.
2. Selects only the games matching the trip window and regions, then requests `/tickets/{team}/event/{id}` **sorted by ascending price**.
   Because of that sort, **the lowest price is always correct** even when only part of the pages are read.
3. Accumulates per-game statistics (min / p25 / median / max / count) as a time series in `data/history.json`, and writes the UI data to `data/latest.json`.

Game IDs are unique site-wide, so a game appearing on both the home and away team pages is merged into one entry rather than duplicated.

## Automated refresh & deployment

`.github/workflows/refresh.yml` runs **every 10 minutes**, collects prices, commits the results (`data/latest.json`,
`data/history.json`) to the repository, and deploys to GitHub Pages. No need to keep a Mac running locally.

- Because history accumulates in the repo, price trends show up in the deployed version too
- The deployed version is read-only — the "refresh now" button only appears when opened from the local server
- Manual run: Actions tab → *Refresh prices & publish* → Run workflow

## Files

```
config.json        configuration
server.js          HTTP server + auto-refresh scheduler
refresh-once.js    one-shot collection CLI
lib/http.js        request serialization and retries
lib/parse.js       JSON-LD / listing parsers
lib/store.js       config and history persistence (atomic writes)
lib/refresh.js     collection pipeline
public/            dashboard (static files)
data/              results — history.json (time series, committed), latest.json (regenerated each run, published only to Pages)
.github/workflows/ 10-minute collection + Pages deployment
```

## Notes

- This is for personal use, so requests are serial with a 0.7-second gap. Don't lower `requestDelayMs` further.
- If the site's HTML changes, only `lib/parse.js` needs fixing.
- TicketJam is peer-to-peer resale, so listings disappear constantly. Verify on the source link before buying.

## Keeping it always on (optional)

Create `~/Library/LaunchAgents/com.local.ticketjam.plist` to start it automatically at login.

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

Replace the `node` path with what `which node` reports, then register it with `launchctl load ~/Library/LaunchAgents/com.local.ticketjam.plist`.

---

## 👤 Contribution & development environment

| Item | Detail |
|---|---|
| **Contribution share** | **100%** (solo development) |
| **Commits** | 21 / 21 (mine / all human commits) |
| **Contributors** | 1 |
| **AI coding tool** | Claude Code |
| **Automated commits** | 264 (GitHub Actions collection/refresh that I configured — excluded from the count) |

<sub>Counting basis (snapshot as of 2026-08-12): commits reachable from **every branch** on origin (merge commits and empty commits excluded), counted by commit author email with one person’s multiple addresses merged; bot and automation commits are excluded.</sub>
