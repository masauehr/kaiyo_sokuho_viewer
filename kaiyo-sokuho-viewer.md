# kaiyo_sokuho_viewer（海洋速報 海流図ビューア）

2026-10-19 新規作成。海上保安庁 海洋情報部の「海洋速報」海流GIS（shape/KML）を取得し、黒潮・対馬暖流・津軽暖流・宗谷暖流の流線を地図表示するWebアプリ。

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
号選択・再生（先読み）・海流別表示切替・過去号の重ね描き（1〜120号前）・東経125〜143度の黒潮通過緯度・地図クリックで最寄り黒潮までの距離/方位・公式PNG表示・背景地図切替（地理院）・GeoJSON保存。追加機能の計画は `PLAN.md`（黒潮大蛇行判定・流軸時系列・水温重畳・強流観測点・月次アーカイブ等）。

## 設計判断・落とし穴
- ブラウザから海保サイトは直接取得不可（CORSヘッダなし）→ローカルプロキシ必須。
- 号一覧HTMLは未発行分が `<!-- -->` に入っている→コメント除去してから解析。
- 1/23（第14号）のリンクが前号と同じzip→重複idは先勝ち。
- 2015〜2025年は月次zip（9〜17MB、複数号のKML入り）。未対応（PLAN Phase2 #7）。
- 線の向きは保証されないため流向矢印は未実装。
- 背景地図は地理院タイル（CARTO無料タイルはAPIキー必須化したため不使用）。
