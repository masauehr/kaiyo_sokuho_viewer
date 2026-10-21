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

## 流れ場（海保以外・参考）
| 項目 | 内容 |
|---|---|
| データ | NOAA CoastWatch ERDDAP `noaacwBLENDEDNRTcurrentsDaily`（表層地衡流 u_current/v_current、全球0.25度、日次） |
| URL | `https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily` |
| 取得 | `.csv?u_current[(日付T00:00:00Z)][(15):(50)][(115):(160)],v_current[...]`。キー不要。最新は約2日前 |
| 範囲外の日付 | 最新日にクランプ |
| 注意 | 地衡流のみ（風による吹送流なし）。沿岸・小渦は不正確。ライセンスは自由利用・再配布可だが無保証。出典: NOAA CoastWatch / AVISO+ |
| 不採用 | HYCOM expt_93.0（2024-09-05終了）／JCOPE（API無し・非営利メディア配布）／Copernicus（要アカウント） |

## 海面水温・海底地形（海保以外・参考）
| 項目 | 内容 |
|---|---|
| 【2026-10-21削除・参考】水温 気象庁 MGDSST | `https://www.data.jma.go.jp/gmd/goos/data/pub/JMA-product/mgd_sst_glb_D/YYYY/mgd_sst_glb_DYYYYMMDD.txt.gz`。全球0.25度・日別・前日の値まで公開。ヘッダ1行＋720行(北→南)×1440値(西→東、0.125E〜)×3桁、0.1℃単位、888=海氷、999=陸。年ディレクトリの一覧で最新日を取得。Readme: `.../mgd_sst_glb_D/Readme_mgd_sst_glb_D` |
| 【2026-10-21削除・参考】水温 NOAA | NOAA CoastWatch ERDDAP `noaacwBLENDEDsstDaily`（analysed_sst、ケルビン、0.05度日次）。`[(15):3:(50)][(115):3:(160)]` で0.15度に間引き。最新は2〜4日前の値、時刻は12:00Z |
| 海底地形（背景） | GEBCO WMS `https://wms.gebco.net/mapserv`、レイヤー `GEBCO_LATEST_2`。注意書き「航行・安全用途には使用不可」。出典: GEBCO Compilation Group |
| 海洋図（背景） | Esri `World_Ocean_Base` ＋ `World_Ocean_Reference` タイル。出典表記必須 |
| 水深の点取得 | GEBCO WMS GetFeatureInfo（`value_list` が標高m、海は負）。0.2度四方・100pxで中央を問い合わせる（狭いと空返し） |

## 波高（海保以外・参考。2026-10-21 調査）
| 項目 | 内容 |
|---|---|
| 【2026-10-21削除・参考】Open-Meteo Marine | `https://marine-api.open-meteo.com/v1/marine?latitude=..,..&longitude=..,..&hourly=wave_height&past_days=3&forecast_days=5&timezone=UTC`。複数地点はカンマ区切り（100地点ずつ）。JSONは地点ごとのリスト。非商用は無料・キー不要。出典: Open-Meteo（DWD等の波浪モデル） |
| 呼び出し制限 | 無料枠は1分600・1時間5000・1日10000呼び出し相当で、地点数に比例して消費。1度格子（1,476地点）は429になったため2度格子（約400地点）、429は65秒待って再試行、6時間キャッシュ |
| 気象庁 波浪実況・予想図（タイル） | 設定 `https://www.data.jma.go.jp/waveinf/tile/jp/table/umimesh.properties.xml`、時刻一覧 `https://www.data.jma.go.jp/waveinf/data/wavemesh/tile/wavemesh/targetTimes.json`（`basetime`/`validtime` はUTC14桁）、タイル `.../wavemesh/{basetime}/none/{validtime}/surf/{wavh\|windsea\|swell}/{z}/{x}/{y}.png`（z=3〜7、XYZ、PNG）。6時間ごと・過去の解析〜約2日先。凡例: 0/1/2/3/4/6/9m〜 |
| 気象庁 沿岸波浪実況・予想図（53海域） | `https://www.data.jma.go.jp/waveinf/tile/jp/index_guid.html`。海域ごとの最大波高・周期、過去72時間〜未来72時間を3時間ごと、1日4回更新、時系列CSVあり。**未対応**（CSVのURL規則は未調査） |
| 気象庁 波浪GPV | 気象業務支援センター配信（有償）のため公開サーバーでは使えない |
| 旧「外洋/沿岸波浪図」画像 | `www.data.jma.go.jp/gmd/kaiyou/db/wave/comment/chart/image/{ocean/s_awpn,ocean/s_fwpn,coast/s_awjp,coast/s_fwjp}.png`。外洋は最終更新が2019年のため不採用 |
| NOAA WW3（保留） | ERDDAP `https://upwell.pfeg.noaa.gov/erddap/griddap/NWW3_Global_Best`（変数 `Thgt`、0.5度・1時間、過去〜約5日先、経度は0〜360表記）。時刻・取得の動作は確認済みだが、2026-10-20〜21にサーバーへ接続できず不採用。復旧すれば0.5度版へ戻せる。`ww3_global` は取得が404になった |

## 気象庁の水温・海流図（画像タイル。2026-10-21 調査）
| 項目 | 内容 |
|---|---|
| 公式ページ | `https://www.data.jma.go.jp/kaikyou/kaikyou/tile/jp/index_sstanl.html`（海面水温実況）・`index_sstfct.html`（予想）・`index_subsanl.html`（表層水温・海流実況）・`index_subsfct.html`（予想）。設定は `table/{sst_anl,sst_fct,subs_anl,subs_fct}.xml` |
| データルート | `https://www.data.jma.go.jp/kaikyou/data/kaikyou/tile/{sst_anl,sst_fct,subs}/`。時刻一覧は実況 `targetTimes.json`・予想 `targetTimes_fct.json`（`basetime`/`validtime`はUTC14桁。実況5日・予想30日。日ごと） |
| タイル | `{ルート}/{基準}/none/{対象}/{深さ}/{種別}/{z}/{x}/{y}.png`（z=4〜9）。海面水温 `surf/sst`・平年差 `surf/sstanom`、水温 `{50,100,200,400}/temp`、海流 `50/curs`（流速）＋`50/curd`（流向）の2枚重ね |
| 要素 | 実況: 海面水温・平年差・50/100/200/400m深水温・50m深海流／予想: 海面水温・100m深水温・50m深海流（約30日先） |
| 凡例 | 公式の `https://www.data.jma.go.jp/kaikyou/kaikyou/tile/jp/images/rect_*.svg`（水温 wtmp、平年差 anom、流速 cur）。単位は水温・平年差が℃、流速がkt |
| 海氷 | `kaikyou/seaice/tile/jp/index_anl.html`・`index_fct.html`。**5/29で発表終了・次回12/1**のため未対応 |
| 備考 | 公式の app.bundle.js はgzipで配信される（展開してURL組み立てを確認）。波浪図（`waveinf/data/wavemesh/...`）も同じ形式で、深さは常に `surf`、種別は wavh/wind/windsea/swell/roughwv/curwv |
