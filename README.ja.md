# チケジャム プロ野球チケット ダッシュボード

[한국어](README.md) · **日本語** · [English](README.en.md)

[ticketjam.jp](https://ticketjam.jp/categories/baseball) の NPB リセールチケットを **旅行期間に合わせて自動で収集・追跡** するローカルダッシュボードです。
試合ごとの最安値 / 中央値 / 出品件数を定期的に更新し、更新が溜まると **価格推移グラフ** を描画します。

依存パッケージはありません。Node 18 以上があればすぐに動きます。

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)
![Zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?logo=githubpages&logoColor=white)

## 実行

```bash
npm start           # http://localhost:4173
```

初回起動時に収集データが無ければ、自動的に 1 回収集します（約 1 分）。以降は 10 分ごとに自動更新します。
収集だけを 1 回実行したい場合は `npm run refresh`。

## 旅行日程の設定

`config.json` の `trip.start/end` が **収集範囲** です。この範囲内の価格だけを集めます。
画面上の日付・地域・「1 枚のみ」フィルタは **すでに収集済みのデータをブラウザ側で絞り込んで表示するもの** なので即時反映されますが、
収集範囲そのものを変えるには `config.json` を編集して push する必要があります。
ブラウザ上部の **開始日 / 終了日 / 地域** を変更して **適用** を押すと `config.json` に保存され、すぐに再収集します。
直接編集しても構いません:

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

| 項目 | 説明 |
|---|---|
| `trip.start/end` | 収集対象の試合日の範囲（日本時間基準、両端を含む） |
| `regions` | 都道府県フィルタ。東京だけ見たいなら `["東京都"]` |
| `ticketCount` | `1` なら 1 枚のみ購入可能な出品に限定。`null` なら全件 |
| `refreshMinutes` | ローカルサーバーの更新周期（分）。デプロイ版の周期はワークフローの cron |
| `scheduleTtlHours` | 試合日程キャッシュの寿命（時間）。日程はほぼ変わらないので毎回は取得しない |
| `maxPagesPerEvent` | 1 試合あたりの最大収集ページ数（1 ページ = 100 件） |
| `requestDelayMs` | リクエスト間隔。サイトへの負荷を減らすためリクエストは直列で送ります |

### 球場の所在地メモ

東京ドーム・神宮球場は `東京都`、横浜スタジアムは `神奈川県`、ZOZO マリンは `千葉県`、ベルーナドームは `埼玉県` です。
東京都内の試合だけを見たい場合は `regions` を `["東京都"]` にしてください。

## 画面

- **上部タイル** — 期間内の試合数、全体の最安値、試合別最安値の平均、出品件数の合計
- **日付別の試合カード** — 対戦カード・球場・時刻、最安値、中央値、出品件数、前回更新比の増減、最安値のスパークライン
- **詳細** — 最安値／中央値の推移グラフ（マウスオーバーで時点ごとの値を表示）と **最安値 15 件のリスト**（価格・枚数・座席・受取方法・元リンク）

価格はすべて **1 枚あたり（円）**、時刻は **日本時間（JST）** です。

### 資格制限のある座席

`高校生`・`シニア`・`女性限定` のような **資格制限付きの座席** は他の出品よりずっと安く出るため、最安値を歪めます。
そこでこうした出品は最安値／中央値の統計から **除外** し、リストには赤い「資格制限」バッジを付けて残しています。

## 動作の仕組み

1. チームごとの `/tickets/{team}/battle_cards` を 1 回ずつリクエストし、残りの試合日程を取得します。
   各試合には JSON-LD の `SportsEvent` が付いているため、日付・球場・都道府県を正確に取得できます。
2. 旅行期間 + 地域に該当する試合だけを選び、`/tickets/{team}/event/{id}` を **価格の昇順** でリクエストします。
   ソートを掛けているので、ページを一部しか読まなくても **最安値は常に正確** です。
3. 試合ごとの統計（min / p25 / median / max / 件数）を `data/history.json` に時系列で蓄積し、
   画面用データを `data/latest.json` に書き出します。

試合 ID はサイト全体で一意なので、同じ試合がホーム／アウェイ双方のチームページに出ても重複せず 1 つにまとまります。

## 自動更新 & デプロイ

`.github/workflows/refresh.yml` が **10 分ごと** に動いて価格を収集し、結果（`data/latest.json`,
`data/history.json`）をリポジトリにコミットしたうえで GitHub Pages にデプロイします。ローカルの Mac を起動しておく必要はありません。

- 履歴がリポジトリに蓄積されるので、価格推移はデプロイ版でもそのまま見られます
- デプロイ版は読み取り専用です — 「今すぐ更新」ボタンはローカルサーバーで開いたときだけ表示されます
- 手動実行: Actions タブ → *Refresh prices & publish* → Run workflow

## ファイル

```
config.json        設定
server.js          HTTP サーバー + 自動更新スケジューラ
refresh-once.js    1 回だけ収集する CLI
lib/http.js        リクエストの直列化・リトライ
lib/parse.js       JSON-LD / 出品リストのパーサ
lib/store.js       設定・履歴の保存（アトミック書き込み）
lib/refresh.js     収集パイプライン
public/            ダッシュボード（静的ファイル）
data/              収集結果 — history.json（時系列、コミットされる）, latest.json（実行のたびに再生成・Pages にのみ配信）
.github/workflows/ 10 分周期の収集 + Pages デプロイ
```

## 補足

- 個人利用の範囲としてリクエストは直列 + 0.7 秒間隔で送っています。`requestDelayMs` をこれ以上小さくしないでください。
- サイトの HTML 構造が変わった場合は `lib/parse.js` だけ直せば済みます。
- チケジャムは個人間のリセールなので、出品は随時消えます。実際に購入する前に元リンクで確認してください。

## 常時起動しておきたい場合（任意）

`~/Library/LaunchAgents/com.local.ticketjam.plist` を作れば、ログイン時に自動起動できます。

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

`node` のパスは `which node` で確認して置き換え、`launchctl load ~/Library/LaunchAgents/com.local.ticketjam.plist` で登録します。

---

## 👤 コントリビューションと開発環境

| 項目 | 内容 |
|---|---|
| **貢献比率** | **100%**（単独開発） |
| **コミット** | 19 / 19（本人 / 全人力コミット） |
| **参加人数** | 1 名 |
| **AI コーディングツール** | Claude Code |
| **自動化コミット** | 76 件（本人が構成した GitHub Actions による自動収集・更新 — 集計対象外） |

<sub>貢献比率はコミットの author メールアドレス基準で集計し、ボット・自動化コミットは除外しています。</sub>
