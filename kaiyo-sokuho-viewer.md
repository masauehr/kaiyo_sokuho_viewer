# kaiyo_sokuho_viewer（海洋速報 海流図ビューア）

2026-10-19 新規作成。海上保安庁 海洋情報部の「海洋速報」海流GIS（shape/KML）を取得し、黒潮・対馬暖流・津軽暖流・宗谷暖流の流線を地図表示するWebアプリ。

- 公開版: https://kaiyo-sokuho-viewer.onrender.com/（Render無料プラン。スリープ復帰に30〜60秒かかる場合あり）
- 場所: `~/projects/kaiyo_sokuho_viewer/`（プロジェクト内にも本マニュアルのコピーあり）
- 出典: https://www1.kaiho.mlit.go.jp/KANKYO/KAIYO/qboc/kurosio-num.html
- 流線は概位（1〜2マイル誤差）。航行には公式の海洋速報を確認する。

## 使い方
```bash
cd ~/projects/kaiyo_sokuho_viewer
/opt/homebrew/bin/python3 server.py     # http://127.0.0.1:8780/
/opt/homebrew/bin/python3 -m unittest discover -s tests   # テスト
```
標準ライブラリのみ。サーバーは ①静的配信 ②海保サイトのプロキシ（CORS回避） ③KML＋DBF→GeoJSON変換（`data/cache/` に号ごと永続キャッシュ）。

## 機能（v0.1）
号選択・再生（先読み）・海流別表示切替・過去号の重ね描き（1〜120号前）・東経125〜143度の黒潮通過緯度・地図クリックで最寄り黒潮までの距離/方位・公式PNG表示・背景地図切替（地理院）・GeoJSON保存。**流れ場（2026-10-19追加）**: NOAA CoastWatch ERDDAP（`noaacwBLENDEDNRTcurrentsDaily`、表層地衡流・日次・0.25度・約2日遅れ・キー不要）を `/api/flow[/YYYY-MM-DD]` で領域（北緯15〜50・東経115〜160）切り出し・JSON化・キャッシュし、`web/js/flow.js` が粒子アニメで描画。号の解析日に合わせ、未公開日は最新日。海保の観測解析とは別データで、沿岸・小渦は表せず流軸とずれうる（出典: NOAA CoastWatch / AVISO+）。追加機能の計画は `PLAN.md`（黒潮大蛇行判定・流軸時系列・水温重畳・強流観測点・月次アーカイブ等）。

## Render へのデプロイ（PC不要で公開）

`render.yaml`（Blueprint）を同梱しています。標準ライブラリのみなのでビルドは不要です。

1. https://dashboard.render.com/ → **New → Blueprint** → GitHub の `masauehr/kaiyo_sokuho_viewer` を選択
2. `render.yaml` が読み込まれ、Web Service（free）が作成される → **Apply**
3. 発行された `https://kaiyo-sokuho-viewer-xxxx.onrender.com/` を開く

| 環境変数 | 既定 | 内容 |
|---|---|---|
| `HOST` | 127.0.0.1 | Renderでは `0.0.0.0`（render.yaml設定済み） |
| `PORT` | 8780 | Renderが自動設定 |
| `CACHE_DIR` | data/cache | Renderでは `/tmp/kaiyo_cache`（再起動で消える） |
| `CACHE_MAX_FILES` | 80 | 保持する号数（超えると古い順に削除） |

運用上の注意:
- 無料プランは**15分アクセスが無いとスリープ**し、復帰に約30〜60秒かかる。起動時に最新号を先読みする。
- キャッシュは再起動で消えるため、号は初回アクセス時に海保から再取得する（同時アクセスは排他制御で1回だけ取得）。
- 認証なしの公開アプリ。海保の公開データのみで個人情報は扱わない。
- `/healthz` がヘルスチェック用。JSONはgzip圧縮、号データは `Cache-Control: max-age=86400`。

## 設計判断・落とし穴
- 流れ場の候補調査（2026-10-19）: HYCOM（expt_93.0）は2024-09-05で更新終了、JCOPEはAPI無し（メディア配布）、Copernicusは要アカウントのため、NOAA CoastWatch ERDDAPを採用。
- ブラウザから海保サイトは直接取得不可（CORSヘッダなし）→ローカルプロキシ必須。
- 号一覧HTMLは未発行分が `<!-- -->` に入っている→コメント除去してから解析。
- 1/23（第14号）のリンクが前号と同じzip→重複idは先勝ち。
- 2015〜2025年は月次zip（9〜17MB、複数号のKML入り）。未対応（PLAN Phase2 #7）。
- 線の向きは保証されないため流向矢印は未実装。
- 背景地図は地理院タイル（CARTO無料タイルはAPIキー必須化したため不使用）。
