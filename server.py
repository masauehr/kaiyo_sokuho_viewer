"""海洋速報 海流図ビューア用ローカルサーバー（標準ライブラリのみ）。

役割:
  1. web/ の静的配信
  2. 海上保安庁サイトのプロキシ（ブラウザからは CORS で直接取得できないため）
  3. 海流GIS(zip: KML + DBF) → GeoJSON への変換とディスクキャッシュ
"""
import gzip
import io
import json
import os
import re
import struct
import sys
import threading
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
# Render等のクラウド実行時は環境変数で上書きする（HOST=0.0.0.0、PORTはRenderが設定）
CACHE = Path(os.environ.get("CACHE_DIR", ROOT / "data" / "cache"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8780"))
# 取得済みの号を保持する上限（無料プランのディスク・メモリ節約。古い順に削除）
CACHE_MAX_FILES = int(os.environ.get("CACHE_MAX_FILES", "80"))
# 流れ場（NOAA CoastWatch ERDDAP: 海面高度から求めた表層地衡流 0.25度・日次）
FLOW_BASE = "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily"
FLOW_AREA = "[(15):(50)][(115):(160)]"  # 緯度・経度の切り出し範囲（日本近海）
UA = {"User-Agent": "kaiyo_sokuho_viewer/0.1 (personal use)"}

# zip内フォルダ名 → 海流名
REGIONS = {"k": "黒潮", "ts": "対馬暖流", "tg": "津軽暖流", "so": "宗谷暖流"}

_issues_cache = {"t": 0, "v": None}
_lock = threading.Lock()  # 同じ号への同時アクセスで海保へ重複リクエストしないための排他


def fetch(url, timeout=40):
    """海保サイトから取得する（接続先は BASE 配下のみ）。"""
    if not url.startswith(BASE):
        raise ValueError("許可されていないURLです")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_flow_url(url, timeout=60):
    """ERDDAP から取得する（接続先は FLOW_BASE 配下のみ）。"""
    if not url.startswith(FLOW_BASE):
        raise ValueError("許可されていないURLです")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


_flow_last = {"t": 0, "v": None}


def flow_last_date():
    """流れ場データの最新日（YYYY-MM-DD）。1時間キャッシュ。"""
    if time.time() - _flow_last["t"] < 3600 and _flow_last["v"]:
        return _flow_last["v"]
    txt = fetch_flow_url(FLOW_BASE + ".csv?time[(last)]")
    d = re.search(r"(\d{4}-\d{2}-\d{2})T", txt).group(1)
    _flow_last.update(t=time.time(), v=d)
    return d


def get_flow(date):
    """指定日（最新日より後なら最新日）の流れ場を JSON(bytes) で返す。

    u/v は行優先（南→北、西→東）の配列で、陸地・欠測は null。
    """
    last = flow_last_date()
    if not date or date > last:
        date = last
    path = CACHE / f"flow_{date}.json"
    with _lock:
        if path.exists():
            return path.read_bytes()
        t = f"(\"{date}T00:00:00Z\")".replace('"', "")
        url = (f"{FLOW_BASE}.csv?u_current[{t}]{FLOW_AREA},v_current[{t}]{FLOW_AREA}")
        rows = fetch_flow_url(url, timeout=90).strip().split("\n")[2:]
        lats, lons, u, v = [], [], [], []
        for ln in rows:
            c = ln.split(",")
            lat, lon = float(c[1]), float(c[2])
            if not lats or lat != lats[-1]:
                lats.append(lat)
            if len(lats) == 1:
                lons.append(lon)
            u.append(None if c[3] in ("NaN", "") else round(float(c[3]), 3))
            v.append(None if c[4] in ("NaN", "") else round(float(c[4]), 3))
        out = {"date": date, "lat0": lats[0], "lon0": lons[0], "d": 0.25,
               "ny": len(lats), "nx": len(lons), "u": u, "v": v,
               "source": "NOAA CoastWatch / AVISO+ 表層地衡流（日次・0.25度）"}
        body = json.dumps(out, separators=(",", ":")).encode()
        path.write_bytes(body)
        prune_cache()
    return body


def list_issues():
    """GIS情報ページから号ごとのzipリンクを抽出する（コメントアウト済みの未発行分は除外）。"""
    if time.time() - _issues_cache["t"] < 600 and _issues_cache["v"]:
        return _issues_cache["v"]
    try:
        html = fetch(BASE + "kurosio-num.html").decode("utf-8", "replace")
    except Exception:
        if _issues_cache["v"]:  # 海保が一時的に不調でも前回の一覧で動かす
            return _issues_cache["v"]
        raise
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
    with _lock:
        if path.exists():
            return path.read_bytes()
        raw = fetch(f"{BASE}{year}/shape/qboc{key}.zip")
        body = json.dumps(zip_to_geojson(raw, key), ensure_ascii=False, separators=(",", ":")).encode()
        path.write_bytes(body)
        prune_cache()
    return body


def prune_cache():
    """キャッシュが上限を超えたら古いファイルから削除する。"""
    files = sorted(CACHE.glob("*.*"), key=lambda f: f.stat().st_mtime)
    for f in files[:max(0, len(files) - CACHE_MAX_FILES)]:
        f.unlink(missing_ok=True)


def warm_up():
    """起動直後に最新号を先に取得しておく（初回アクセスを速くする）。"""
    try:
        last = list_issues()["issues"][-1]
        get_gis(str(last["year"]), f"{last['no']:03d}")
    except Exception as e:
        sys.stderr.write(f"ウォームアップ失敗: {e}\n")


def get_image(year, no):
    path = CACHE / f"{year}{no}cu0.png"
    with _lock:
        if not path.exists():
            path.write_bytes(fetch(f"{BASE}{year}/qboc{year}{no}cu0.png"))
            prune_cache()
    return path.read_bytes()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def _send(self, body, ctype, status=200, max_age=0):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        # JSONは圧縮して転送量を減らす（1号 0.5〜1.5MB）
        if ctype.startswith("application/json") and len(body) > 1024 and "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(body, 6)
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        if max_age:
            self.send_header("Cache-Control", f"public, max-age={max_age}")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urlparse(self.path).path
        try:
            if p == "/healthz":
                return self._send(b"ok", "text/plain")
            if p == "/api/issues":
                return self._send(json.dumps(list_issues(), ensure_ascii=False).encode(), "application/json; charset=utf-8", max_age=300)
            m = re.fullmatch(r"/api/flow(?:/(\d{4}-\d{2}-\d{2}))?", p)
            if m:
                return self._send(get_flow(m.group(1)), "application/json; charset=utf-8", max_age=3600)
            m = re.fullmatch(r"/api/gis/(20\d\d)/(\d{3})", p)
            if m:
                return self._send(get_gis(*m.groups()), "application/json; charset=utf-8", max_age=86400)
            m = re.fullmatch(r"/api/image/(20\d\d)/(\d{3})", p)
            if m:
                return self._send(get_image(*m.groups()), "image/png", max_age=86400)
        except Exception as e:  # 取得失敗は 502 で返す
            return self._send(json.dumps({"error": str(e)}, ensure_ascii=False).encode(), "application/json; charset=utf-8", 502)
        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    CACHE.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=warm_up, daemon=True).start()
    print(f"http://{HOST}:{PORT}/ で起動しました (Ctrl+C で終了)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
