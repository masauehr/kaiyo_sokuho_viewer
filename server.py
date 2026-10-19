"""海洋速報 海流図ビューア用ローカルサーバー（標準ライブラリのみ）。

役割:
  1. web/ の静的配信
  2. 海上保安庁サイトのプロキシ（ブラウザからは CORS で直接取得できないため）
  3. 海流GIS(zip: KML + DBF) → GeoJSON への変換とディスクキャッシュ
"""
import io
import json
import re
import struct
import sys
import time
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE = "https://www1.kaiho.mlit.go.jp/KANKYO/KAIYO/qboc/"
ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
CACHE = ROOT / "data" / "cache"
HOST, PORT = "127.0.0.1", 8780
UA = {"User-Agent": "kaiyo_sokuho_viewer/0.1 (personal use)"}

# zip内フォルダ名 → 海流名
REGIONS = {"k": "黒潮", "ts": "対馬暖流", "tg": "津軽暖流", "so": "宗谷暖流"}

_issues_cache = {"t": 0, "v": None}


def fetch(url, timeout=40):
    """海保サイトから取得する（接続先は BASE 配下のみ）。"""
    if not url.startswith(BASE):
        raise ValueError("許可されていないURLです")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def list_issues():
    """GIS情報ページから号ごとのzipリンクを抽出する（コメントアウト済みの未発行分は除外）。"""
    if time.time() - _issues_cache["t"] < 600 and _issues_cache["v"]:
        return _issues_cache["v"]
    html = fetch(BASE + "kurosio-num.html").decode("utf-8", "replace")
    live = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    issues = []
    for year, no, label in re.findall(
        r'href="(20\d\d)/shape/qboc20\d\d(\d{3})\.zip"[^>]*>\s*([^<]*?)\s*<', live
    ):
        m = re.match(r"(\d+)/(\d+)", label)
        issues.append({
            "id": f"{year}{no}", "year": int(year), "no": int(no),
            "month": int(m.group(1)) if m else None,
            "day": int(m.group(2)) if m else None,
            "label": label,
        })
    issues.sort(key=lambda x: (x["year"], x["no"]))
    # 1/23(第14号)のようにリンク先が前号と同じzipを指す誤記があるため、重複idは先勝ちで統合
    uniq = {}
    for i in issues:
        uniq.setdefault(i["id"], i)
    result = {"issues": list(uniq.values()), "fetchedAt": int(time.time())}
    _issues_cache.update(t=time.time(), v=result)
    return result


def read_dbf(data):
    """DBFを読み、レコードを辞書のリストで返す（文字コードは Shift-JIS）。"""
    n = struct.unpack("<I", data[4:8])[0]
    hl, rl = struct.unpack("<HH", data[8:12])
    fields, o = [], 32
    while data[o] != 0x0D:
        fields.append((data[o:o + 11].split(b"\0")[0].decode("cp932"), data[o + 16]))
        o += 32
    rows = []
    for r in range(n):
        rec, p = data[hl + r * rl:hl + (r + 1) * rl], 1
        row = {}
        for name, ln in fields:
            row[name] = rec[p:p + ln].decode("cp932", "replace").strip()
            p += ln
        rows.append(row)
    return rows


def kml_lines(kml_bytes):
    """KMLのLineStringを [[lon,lat],...] のリストで返す。"""
    root = ET.fromstring(kml_bytes.lstrip(b"\xef\xbb\xbf"))
    out = []
    for el in root.iter("{http://www.opengis.net/kml/2.2}coordinates"):
        pts = []
        for tok in (el.text or "").split():
            v = tok.split(",")
            pts.append([round(float(v[0]), 4), round(float(v[1]), 4)])
        if len(pts) >= 2:
            out.append(pts)
    return out


def zip_to_geojson(data, key):
    z = zipfile.ZipFile(io.BytesIO(data))
    names = {n.replace("\\", "/"): n for n in z.namelist()}
    feats, meta = [], {}
    for folder, label in REGIONS.items():
        kml = next((o for n, o in names.items() if re.search(rf"/{folder}/[^/]+\.kml$", "/" + n)), None)
        if not kml:
            continue
        dbf = next((o for n, o in names.items() if re.search(rf"/{folder}/[^/]+\.dbf$", "/" + n)), None)
        rows = read_dbf(z.read(dbf)) if dbf else []
        if rows and not meta:
            meta = {"analysisDate": rows[0].get("解析対象日"),
                    "issueDate": rows[0].get("速報発行日"),
                    "issueNo": rows[0].get("速報号数")}
        for i, pts in enumerate(kml_lines(z.read(kml))):
            feats.append({"type": "Feature",
                          "properties": {"region": folder, "name": label, "idx": i},
                          "geometry": {"type": "LineString", "coordinates": pts}})
    return {"type": "FeatureCollection", "id": key, "meta": meta, "features": feats}


def get_gis(year, no):
    key = f"{year}{no}"
    path = CACHE / f"{key}.geojson"
    if path.exists():
        return path.read_bytes()
    raw = fetch(f"{BASE}{year}/shape/qboc{key}.zip")
    body = json.dumps(zip_to_geojson(raw, key), ensure_ascii=False, separators=(",", ":")).encode()
    path.write_bytes(body)
    return body


def get_image(year, no):
    path = CACHE / f"{year}{no}cu0.png"
    if not path.exists():
        path.write_bytes(fetch(f"{BASE}{year}/qboc{year}{no}cu0.png"))
    return path.read_bytes()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def _send(self, body, ctype, status=200):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urlparse(self.path).path
        try:
            if p == "/api/issues":
                return self._send(json.dumps(list_issues(), ensure_ascii=False).encode(), "application/json; charset=utf-8")
            m = re.fullmatch(r"/api/gis/(20\d\d)/(\d{3})", p)
            if m:
                return self._send(get_gis(*m.groups()), "application/json; charset=utf-8")
            m = re.fullmatch(r"/api/image/(20\d\d)/(\d{3})", p)
            if m:
                return self._send(get_image(*m.groups()), "image/png")
        except Exception as e:  # 取得失敗は 502 で返す
            return self._send(json.dumps({"error": str(e)}, ensure_ascii=False).encode(), "application/json; charset=utf-8", 502)
        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"http://{HOST}:{PORT}/ で起動しました (Ctrl+C で終了)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
