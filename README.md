# 海洋速報 海流図ビューア（kaiyo_sokuho_viewer）

詳しくは [kaiyo-sokuho-viewer.md](kaiyo-sokuho-viewer.md) を参照。

海上保安庁 海洋情報部の「海洋速報」の**海流GIS情報**（shape/KML）を取得し、黒潮・対馬暖流・津軽暖流・宗谷暖流の流線を地図上に表示するWebアプリです。

- 公開版: https://kaiyo-sokuho-viewer.onrender.com/（Render無料プラン。スリープ復帰に30〜60秒かかる場合あり）
- 出典: [海上保安庁 海洋情報部 海洋速報](https://www1.kaiho.mlit.go.jp/KANKYO/KAIYO/qboc/) ／ [流軸数値・GIS情報](https://www1.kaiho.mlit.go.jp/KANKYO/KAIYO/qboc/kurosio-num.html)
- 流れ場は NOAA CoastWatch / AVISO+ の表層地衡流（海保とは別データ・約25km格子）。
- 流線は概位で、1〜2マイルの誤差を含みます。**航行の安全確保には公式の海洋速報を確認してください。**

## 起動

```bash
cd ~/projects/kaiyo_sokuho_viewer
/opt/homebrew/bin/python3 server.py
# → http://127.0.0.1:8780/ をブラウザで開く
```

標準ライブラリのみ（追加インストール不要）。ブラウザからは海保サイトをCORSで直接取得できないため、
`server.py` がプロキシ兼 KML/DBF→GeoJSON 変換を行い、`data/cache/` に号ごとにキャッシュします。

## 現在の機能（v0.1）

| 機能 | 内容 |
|---|---|
| 号の選択 | プルダウン／スライダー／前後ボタン／最新号（2026年の号ごと） |
| 再生 | 号を順に切り替えてアニメーション（3段階の速度、次号を先読み） |
| 海流の表示切替 | 黒潮・対馬暖流・津軽暖流・宗谷暖流を色分け |
| 重ね描き比較 | 1・5・20・60・120号前の流線を灰色破線で重ねる（蛇行・接岸の変化比較） |
| 流軸の通過緯度 | 東経125〜143度（2度刻み）で黒潮が通る緯度を表示中の号から計算 |
| 最寄り黒潮までの距離 | 地図クリックで距離（海里・km）と方位を表示 |
| 公式海流図の表示 | 公式PNG（海流図）を別枠で表示 |
| 背景地図 | 地理院タイル（淡色・標準・写真・白地図） |
| 流れ場（参考） | NOAA CoastWatch の表層地衡流（日次・0.25度）を粒子アニメーションで表示。号の解析日に合わせ、色は流速。クリックで地点の流速（ノット・向き）も表示 |
| GeoJSON保存 | 表示中の号をGeoJSONで保存 |

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

## 構成

```
kaiyo_sokuho_viewer/
├── server.py        # 静的配信 + 海保プロキシ + KML/DBF→GeoJSON変換
├── web/             # フロント（Vanilla JS + Leaflet）
├── data/cache/      # 取得済み号のGeoJSON/PNG（git除外）
├── docs/            # データ仕様・機能計画
└── tests/           # 変換処理のテスト
```

ドキュメント: [PLAN.md](PLAN.md)（機能計画・ロードマップ）／[docs/data_sources.md](docs/data_sources.md)（データ仕様）／[CLAUDE.md](CLAUDE.md)
