# kaiyo_sokuho_viewer（海洋速報 海流図ビューア）マニュアル

2026-10-19 新規作成・同日 v0.2 まで拡張。海上保安庁 海洋情報部の「海洋速報」海流GIS（shape/KML）から黒潮・対馬暖流・津軽暖流・宗谷暖流の流線を地図表示し、**海保以外の公開データ**（流れ場・海面水温・海底地形）を重ねて見比べられるWebアプリ。

| 項目 | 内容 |
|---|---|
| 公開版 | https://kaiyo-sokuho-viewer.onrender.com/（Render無料プラン。スリープ復帰に30〜60秒） |
| GitHub | https://github.com/masauehr/kaiyo_sokuho_viewer（public） |
| 場所 | `~/projects/kaiyo_sokuho_viewer/`（本マニュアルのコピーを同フォルダにも置く） |
| 技術 | Python標準ライブラリのサーバー ＋ Vanilla JS ＋ Leaflet（cdnjs） |
| 注意 | 流線は概位（1〜2マイル誤差）。**航行・安全の判断には公式の海洋速報を確認する** |

## 1. 使い方

```bash
cd ~/projects/kaiyo_sokuho_viewer
/opt/homebrew/bin/python3 server.py        # → http://127.0.0.1:8780/
/opt/homebrew/bin/python3 -m unittest discover -s tests   # テスト
```

### 画面の操作（左パネル）
| セクション | 操作 |
|---|---|
| 号の選択 | プルダウン／スライダー／◀▶／最新号。▶再生で順送り（速度3段階、次号を先読み） |
| 表示する海流 | 黒潮（赤）・対馬（橙）・津軽（青）・宗谷（緑）の表示切替 |
| 比較（重ね描き） | 1・5・20・60・120号前の流線を灰色破線で重ねる（蛇行・接岸の変化比較） |
| 海面水温 | 出典（気象庁MGDSST／NOAA）切替・日付（海流図と同じ日／最新日）・濃さ・等温線（2℃／1℃ごとを選択、℃ラベル付き） |
| 流れ場（参考） | NOAA表層地衡流の粒子アニメ。色は流速（0〜1.5m/s〜） |
| 流軸の通過緯度 | 東経125〜143度（2度刻み）で黒潮が通る緯度（表示中の号から計算） |
| 地図の操作 | 背景地図切替／公式海流図(PNG)を別枠表示／GeoJSON保存／全体表示 |
| 地図クリック | 最寄りの黒潮までの距離（海里・km）と方位、**水温・流れ（ノット・向き）・水深** |

背景地図: 地理院（淡色・標準・写真・白地図）、**GEBCO海底地形**（水深の色分け）、**Esri海洋図**（水深の陰影・海溝名）。
流れ場は、表示中の号の**解析対象日**（号の発行日の前日）のデータを自動で選ぶ（未公開日は最新日になり、パネルに注記）。
海面水温は日付を選べる: **「海流図と同じ日（号の発行日。プルダウンに出る日付）」**（既定）または**「最新日」**。海流図は約3日遅れ、気象庁MGDSSTは1日遅れなので、海流図の前日（解析対象日）に合わせる必要はなく、同じ日付の水温を重ねる。

**気象庁の海面水温実況図と比較するとき**（2026-10-19確認）: 実況図は前日分（最新日）を表示するため、日付を「最新日」にして比べる。日付が違うと等温線は動く（10/15と10/18のMGDSSTで日本近海の格子の平均絶対差0.29℃、0.5℃超が15%）。線の平滑化・間隔・内湾欠測の扱いの差は未検証。

## 2. データソース一覧

| 用途 | 提供元 | 取得方法 | 鮮度・分解能 | 出典表記 |
|---|---|---|---|---|
| 海流の流線（主） | 海上保安庁 海洋情報部 | `kurosio-num.html` の号別zip（shape/KML）をサーバーでGeoJSON化 | 毎営業日・流軸のみ | 海上保安庁 海洋速報 |
| 海面水温（既定） | 気象庁 MGDSST | `.../gmd/goos/data/pub/JMA-product/mgd_sst_glb_D/YYYY/mgd_sst_glb_DYYYYMMDD.txt.gz` | 日別・0.25度・前日分 | 気象庁 |
| 海面水温（切替） | NOAA CoastWatch ERDDAP `noaacwBLENDEDsstDaily` | griddap CSV（0.15度に間引き） | 日別・約2〜4日遅れ | NOAA CoastWatch |
| 流れ場（参考） | NOAA CoastWatch ERDDAP `noaacwBLENDEDNRTcurrentsDaily` | griddap CSV | 日別・0.25度・約2日遅れ。地衡流のみ | NOAA CoastWatch / AVISO+ |
| 海底地形（背景） | GEBCO WMS `GEBCO_LATEST_2` | Leaflet WMS | 15秒格子 | GEBCO Compilation Group（航行・安全用途不可） |
| 海洋図（背景） | Esri World_Ocean_Base/Reference | タイル | - | Esri ほか |
| 水深（地点） | GEBCO GetFeatureInfo | `/api/depth` が中継 | - | GEBCO |

詳細（URL規則・ファイル形式・落とし穴）は `docs/data_sources.md`。

### 海保GISの要点
- 号ごとzip（2026年）: `2026/shape/qboc2026NNN.zip`（NNNは3桁、400〜800KB）。中身は `k`（黒潮）・`tg`・`ts`・`so` フォルダのshp/kml/dbf。DBF（Shift-JIS）に解析対象日・発行日・号数。
- 2015〜2025年は月次zip（9〜17MB）。**未対応**。
- 渦は含まれない。津軽・宗谷は季節により無い。

### 気象庁 MGDSST の形式
1行目ヘッダ（年月日）＋720行（北→南）×1440値（西→東、0.125E〜）。各値3桁・0.1℃単位。`888`=海氷、`999`=陸。最新日は年ディレクトリの一覧から取得。

## 3. サーバー（server.py）のAPI

| パス | 内容 |
|---|---|
| `/api/issues` | 号一覧（未発行分は除外）。10分キャッシュ、海保不調時は前回分を返す |
| `/api/gis/{年}/{号3桁}` | 号のGeoJSON（属性結合済み）。ディスクに永続キャッシュ |
| `/api/image/{年}/{号3桁}` | 公式海流図PNGの中継 |
| `/api/flow[/YYYY-MM-DD]` | 流れ場（北緯15〜50・東経115〜160の u/v 格子）。範囲外の日付は最新日 |
| `/api/sst[/YYYY-MM-DD]?src=jma\|noaa` | 海面水温（℃×100の整数格子、欠測はnull） |
| `/api/depth?lat=&lon=` | 地点の標高/水深(m)。海は負 |
| `/healthz` | ヘルスチェック |

共通: JSONはgzip、接続先は許可リスト（海保・ERDDAP・気象庁・GEBCOのみ）、入力不正は400、取得失敗は502、同時アクセスは排他制御で外部取得を1回に集約。

## 4. 構成

```
kaiyo_sokuho_viewer/
├── server.py          # 静的配信 + 外部データ中継 + 変換（KML/DBF/CSV/MGDSST→JSON）
├── render.yaml        # Render Blueprint
├── web/
│   ├── index.html / css/style.css
│   └── js/app.js      # 画面制御・号の切替・クリック情報
│       js/flow.js     # 流れ場の粒子アニメ（canvas）
│       js/sst.js      # 水温の色付き画像・等温線（マーチングスクエア）・℃ラベル
├── data/cache/        # 取得済みデータ（git除外）
├── docs/data_sources.md / PLAN.md / CLAUDE.md / README.md
└── tests/test_convert.py
```

## 5. Render へのデプロイ（PC不要で公開）
1. https://dashboard.render.com/ → **New → Blueprint** → `masauehr/kaiyo_sokuho_viewer`
2. Blueprint Name `kaiyo-sokuho-viewer`／Branch `main`／Blueprint Path `render.yaml` → **Apply**
3. 発行URLを開く。`main` へ push すると自動再デプロイ

| 環境変数 | 既定 | 内容 |
|---|---|---|
| `HOST` | 127.0.0.1 | Renderでは `0.0.0.0` |
| `PORT` | 8780 | Renderが設定 |
| `CACHE_DIR` | data/cache | Renderでは `/tmp/kaiyo_cache`（再起動で消える） |
| `CACHE_MAX_FILES` | 80 | 保持ファイル数（超過は古い順に削除） |

無料プランは15分無アクセスでスリープ。起動時に最新号を先読みする。認証なしの公開アプリ（公開データのみ・個人情報なし）。

## 6. 設計判断・落とし穴
- **ブラウザから海保サイトは直接取得不可**（CORSヘッダなし）→サーバー中継が必須。GitHub Pages等の静的ホスティングでは動かない。
- 号一覧HTMLは**未発行分が `<!-- -->` 内**にある → コメント除去してから解析。
- 1/23（第14号）のリンクが前号と同じzip → 重複idは先勝ち（一覧は1件少ない）。
- 線の向き（流向）がデータで保証されないため、海保流線の矢印は未実装。
- 背景は地理院タイル（CARTO無料タイルはAPIキー必須化で不使用）。
- **流れ場の候補調査（2026-10-19）**: HYCOM expt_93.0 は2024-09-05で更新終了／JCOPE はAPI無し（メディア配布）／Copernicus は要アカウント → NOAA CoastWatch ERDDAP を採用。
- 流れ場は**地衡流のみ**（風の吹送流なし）・約25km格子。沿岸や小渦は不正確で、海保の流軸とずれうる。画面とREADMEで「別データ」と明記。
- GEBCO の GetFeatureInfo は範囲が狭いと空返し → 0.2度四方・100pxで中心を問い合わせる。
- 水温NOAAの時刻は12:00Z、単位はケルビン（℃へ変換）。
- 等温線: 画素の縁取りではなく、格子からマーチングスクエア法で作った折れ線。ラベルは画面距離320pxごと・短い線は無印・近接70px以内は間引き。

## 7. 今後（PLAN.md）
黒潮大蛇行の判定指標／流軸の時系列グラフ（2004年〜のExcel）／水温の平年差／強流観測点／急潮情報／海流推測図（毎週金曜）／月次アーカイブ（2015〜2025）／地点ウォッチ／共有URL／動画出力。
