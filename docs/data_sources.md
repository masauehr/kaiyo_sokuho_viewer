# データソース仕様（2026-10-19 調査）

基準URL: `https://www1.kaiho.mlit.go.jp/KANKYO/KAIYO/qboc/`

## 海流GIS（本アプリの主データ）
| 項目 | 内容 |
|---|---|
| 一覧ページ | `kurosio-num.html`（号・月ごとのzipリンク一覧） |
| 2026年（号ごと） | `2026/shape/qboc2026NNN.zip`（NNNは3桁ゼロ埋め、400〜800KB） |
| 2015〜2025年（月ごと） | `YYYY/shape/qboc{YYYY}{Jan..Dec}.zip`（9〜17MB。月内の全号のKMLを含む。**未対応**） |
| 形式 | shapefile + kml。zip内は `qboc2026191/{k,tg,ts,so}/`（黒潮・津軽・対馬・宗谷） |
| 座標系 | WGS84（EPSG:4326）、LineString |
| 属性(DBF/Shift-JIS) | 解析対象日・速報発行日・速報号数・海流の種別・URL |
| 注意 | 流線は2015年の海流図に基づく概位（1〜2マイル誤差）。渦は含まない。津軽・宗谷は季節により無い |
| 更新 | 海洋速報の発行に合わせ土日祝日・年末年始を除く毎日 |

### 落とし穴
- **未発行の号のリンクが HTML コメント `<!-- -->` で書かれている**。コメントを除去してから解析する。
- 2026年の「1/23（第14号）」のリンク先が `qboc2026013.zip`（前号と同じ）。重複idは先勝ちで統合。
- 号数は「その年の発行通し番号」であり、日付や通算日ではない。
- KMLに属性はなく、メタ情報はDBFにある（`server.py` が結合）。
- 線の向き（流れの方向）は保証されない。矢印はデータの頂点順に依存しない。

## 関連ページ（追加機能の候補）
| ページ | URL | 更新 | 備考 |
|---|---|---|---|
| 海洋速報（海流図） | `2026cal/cu0/qboc2026NNNcu0.html`、画像 `2026/qboc2026NNNcu0.png`／`.pdf` | 毎日 | 画像のみ（地理参照なし） |
| 海洋速報（水温） | `2026cal/tp0/qboc2026NNNtp0.html` | 毎日 | |
| 海流推測図 | `2026cal/ocf/ocf202641.html` | 毎週金曜 | 予測。号の付番は別 |
| 表面水温図 | `temp_color/temp_color.html` | 毎日 | |
| 表面水温偏差図 | `anomaly/anomaly.html` | 毎日 | |
| 強流観測情報 | `hisp/hisp.html` | 毎日 | 2ノット以上の観測点 |
| 水温海流合成図 | `tc/tc.html` | 毎日 | |
| 黒潮ファイブ | `5current/5current.html` | 毎日 | 5号分の黒潮流軸合成 |
| 急潮情報 | `kyutyou.html` | 随時 | 黒潮接近状況 |
| 流軸数値(Excel) | `kuroshio_axis.xlsx`（2004〜）、`kuroshio_axis_longitude.xlsx`（2006〜、東経125〜143度） | | 時系列グラフ向け |
| 用語・凡例 | `exp/yougo.html`、`setumei2.html` | | |

利用条件は [リンク・著作権等](http://www1.kaiho.mlit.go.jp/copyright.html) を確認すること。
