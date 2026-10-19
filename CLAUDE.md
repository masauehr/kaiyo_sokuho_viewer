# CLAUDE.md — kaiyo_sokuho_viewer

海上保安庁「海洋速報」の海流GISを表示するWebアプリ。共通ルールは `~/projects/CLAUDE.md` に従う。

## 技術
- サーバー: Python標準ライブラリのみ（`server.py`、127.0.0.1:8780）。実行は `/opt/homebrew/bin/python3`。
- フロント: Vanilla JS + Leaflet（cdnjs）。背景は地理院タイル（CARTOはAPIキー必須化のため使わない）。
- インデント: JS/HTML/CSS=2、Python=4。コメントは日本語。

## 注意
- Render公開用に `render.yaml` あり（HOST/PORT/CACHE_DIR を環境変数で切替）。無料プランはスリープ・ディスク揮発のためキャッシュは再生成前提。
- 海保サイトへはサーバー経由のみ（BASE配下に限定）。`curl`/`wget` は使わず、確認は Python `urllib`。
- 号一覧のHTMLは未発行分が `<!-- -->` 内。必ずコメント除去してから解析。
- `data/cache/` はgit除外。号のGeoJSONは不変なので再取得しない。
- 表示には出典と「概位・航行には公式を確認」の注記を残す。
- 機能追加時は PLAN.md のチェックと pc_docs のマニュアル（`kaiyo-sokuho-viewer.md`、プロジェクト内コピーも）を更新。
