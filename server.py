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
import urllib.error
import urllib.request
import zipfile
import zlib
import xml.etree.ElementTree as ET
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

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
# 海面水温（NOAA CoastWatch ERDDAP: 日次・0.05度の合成水温。0.15度に間引いて配信）
SST_BASE = "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDsstDaily"
SST_AREA = "[(15):3:(50)][(115):3:(160)]"
# 気象庁の画像タイル（波浪実況・予想図／海面水温／表層水温・海流）。
# 構成: {ルート}/{時刻一覧ファイル}、{ルート}/{基準}/none/{対象}/{深さ}/{種別}/{z}/{x}/{y}.png
JMA_TILESETS = {
    "wave": ("https://www.data.jma.go.jp/waveinf/data/wavemesh/tile/wavemesh/", "targetTimes.json"),
    "sst_anl": ("https://www.data.jma.go.jp/kaikyou/data/kaikyou/tile/sst_anl/", "targetTimes.json"),
    "sst_fct": ("https://www.data.jma.go.jp/kaikyou/data/kaikyou/tile/sst_fct/", "targetTimes_fct.json"),
    "subs_anl": ("https://www.data.jma.go.jp/kaikyou/data/kaikyou/tile/subs/", "targetTimes.json"),
    "subs_fct": ("https://www.data.jma.go.jp/kaikyou/data/kaikyou/tile/subs/", "targetTimes_fct.json"),
}
JMA_TILE_MAX = 1500  # メモリに保持するタイル数の上限（1枚30〜100KB。古いものから捨てる）
# 気象庁 MGDSST（全球日別海面水温 0.25度。前日の値まで公開。数値はgz圧縮テキスト）
JMA_SST_BASE = "https://www.data.jma.go.jp/gmd/goos/data/pub/JMA-product/mgd_sst_glb_D/"
# 水深（GEBCO WMS の GetFeatureInfo。海底地形は背景図として画面側でWMS表示）
GEBCO_WMS = "https://wms.gebco.net/mapserv"
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
    """ERDDAP から取得する（接続先は流れ場・水温のデータセット配下のみ）。"""
    if not url.startswith((FLOW_BASE, SST_BASE)):
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


_sst_last = {"t": 0, "v": None}


def sst_last_date():
    """水温データの最新日。1時間キャッシュ。"""
    if time.time() - _sst_last["t"] < 3600 and _sst_last["v"]:
        return _sst_last["v"]
    txt = fetch_flow_url(SST_BASE + ".csv?time[(last)]")
    d = re.search(r"(\d{4}-\d{2}-\d{2})T", txt).group(1)
    _sst_last.update(t=time.time(), v=d)
    return d


def fetch_jma(url, timeout=60):
    """気象庁(MGDSST)から取得する（接続先は JMA_SST_BASE 配下のみ）。"""
    if not url.startswith(JMA_SST_BASE):
        raise ValueError("許可されていないURLです")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


_jma_last = {"t": 0, "v": None}


def jma_last_date():
    """MGDSST の最新日（年ディレクトリの一覧から取得）。1時間キャッシュ。"""
    if time.time() - _jma_last["t"] < 3600 and _jma_last["v"]:
        return _jma_last["v"]
    year = time.gmtime().tm_year
    for y in (year, year - 1):  # 年初は前年の一覧から探す
        try:
            html = fetch_jma(f"{JMA_SST_BASE}{y}/").decode("utf-8", "replace")
        except Exception:
            continue
        days = re.findall(r"mgd_sst_glb_D(\d{8})\.txt\.gz", html)
        if days:
            d = max(days)
            d = f"{d[:4]}-{d[4:6]}-{d[6:]}"
            _jma_last.update(t=time.time(), v=d)
            return d
    raise RuntimeError("気象庁の海面水温の最新日が取得できません")


def get_sst_jma(date):
    """気象庁 MGDSST を日本近海に切り出す。v は水温(℃)×100 の整数（南→北、西→東）。"""
    last = jma_last_date()
    if not date or date > last:
        date = last
    path = CACHE / f"sst_jma_{date}.json"
    with _lock:
        if path.exists():
            return path.read_bytes()
        ymd = date.replace("-", "")
        raw = gzip.decompress(fetch_jma(f"{JMA_SST_BASE}{ymd[:4]}/mgd_sst_glb_D{ymd}.txt.gz", timeout=90))
        lines = raw.decode("ascii", "replace").split("\n")[1:]  # 1行目はヘッダ（年月日）
        # 行は北→南（89.875N〜）、列は西→東（0.125E〜）。北緯15〜50・東経115〜160 を切り出す
        i0, i1, j0, j1 = 160, 300, 460, 640
        rows = []
        for i in range(i1 - 1, i0 - 1, -1):  # 南→北の順に並べ替える
            ln = lines[i]
            for j in range(j0, j1):
                tok = ln[3 * j:3 * j + 3].strip()
                rows.append(None if tok in ("888", "999", "") else int(tok) * 10)
        out = {"date": date, "lat0": round(89.875 - 0.25 * (i1 - 1), 3), "lon0": 0.125 + 0.25 * j0,
               "dlat": 0.25, "dlon": 0.25, "ny": i1 - i0, "nx": j1 - j0, "v": rows,
               "source": "気象庁 MGDSST（全球日別海面水温）"}
        body = json.dumps(out, separators=(",", ":")).encode()
        path.write_bytes(body)
        prune_cache()
    return body


_jtile_times = {}  # データセット名 → {"t": 取得時刻, "v": 一覧}
_jtile_cache = {}  # キー → bytes（挿入順で古いものから捨てる）


def get_jma_tile_times(ds):
    """気象庁タイルの時刻一覧 [{basetime, validtime}]（UTC, 14桁）。10分キャッシュ。"""
    if ds not in JMA_TILESETS:
        raise ValueError("不明なデータセットです")
    c = _jtile_times.get(ds)
    if c and time.time() - c["t"] < 600:
        return c["v"]
    root, tfile = JMA_TILESETS[ds]
    try:
        req = urllib.request.Request(root + tfile, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            v = json.loads(r.read())
        _jtile_times[ds] = {"t": time.time(), "v": v}
    except Exception:
        if not c:
            raise
        return c["v"]
    return v


def get_jma_tile(ds, base, valid, depth, kind, z, x, y):
    """気象庁のタイルPNG。時刻は一覧にあるものだけ許可し、メモリに保持して気象庁への負荷を抑える。"""
    if not any(t["basetime"] == base and t["validtime"] == valid for t in get_jma_tile_times(ds)):
        raise ValueError("その時刻の図はありません")
    key = (ds, base, valid, depth, kind, z, x, y)
    hit = _jtile_cache.get(key)
    if hit is not None:
        return hit
    url = f"{JMA_TILESETS[ds][0]}{base}/none/{valid}/{depth}/{kind}/{z}/{x}/{y}.png"
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):  # 範囲外タイルは透明扱い
            body = b""
        else:
            raise
    _jtile_cache[key] = body
    while len(_jtile_cache) > JMA_TILE_MAX:
        _jtile_cache.pop(next(iter(_jtile_cache)))
    return body


def get_sst(date, src="jma"):
    """海面水温を JSON(bytes) で返す。src は "jma"（気象庁・既定）か "noaa"。"""
    if src == "jma":
        return get_sst_jma(date)
    return get_sst_noaa(date)


def get_sst_noaa(date):
    """NOAA の海面水温（最新日より後なら最新日）。

    v は水温(℃)を100倍した整数の配列（行優先・南→北、西→東）。海氷・陸・欠測は null。
    """
    last = sst_last_date()
    if not date or date > last:
        date = last
    path = CACHE / f"sst_noaa_{date}.json"
    with _lock:
        if path.exists():
            return path.read_bytes()
        url = f"{SST_BASE}.csv?analysed_sst[({date}T12:00:00Z)]{SST_AREA}"
        rows = fetch_flow_url(url, timeout=120).strip().split("\n")[2:]
        lats, lons, v = [], [], []
        for ln in rows:
            c = ln.split(",")
            lat, lon = float(c[1]), float(c[2])
            if not lats or lat != lats[-1]:
                lats.append(lat)
            if len(lats) == 1:
                lons.append(lon)
            try:
                v.append(round((float(c[3]) - 273.15) * 100))
            except ValueError:  # NaN
                v.append(None)
        out = {"date": date, "lat0": lats[0], "lon0": lons[0],
               "dlat": round(lats[1] - lats[0], 4), "dlon": round(lons[1] - lons[0], 4),
               "ny": len(lats), "nx": len(lons), "v": v,
               "source": "NOAA CoastWatch 海面水温 (Geo-polar Blended, 日次)"}
        body = json.dumps(out, separators=(",", ":")).encode()
        path.write_bytes(body)
        prune_cache()
    return body


def get_depth(lat, lon):
    """地点の水深(m)を GEBCO の GetFeatureInfo から取得する。陸地は標高が正になる。"""
    d = 0.1  # 範囲が狭すぎると結果が返らないため 0.2度四方の中心点を問い合わせる
    q = (f"SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=GEBCO_LATEST_2&QUERY_LAYERS=GEBCO_LATEST_2"
         f"&STYLES=&SRS=EPSG:4326&BBOX={lon - d},{lat - d},{lon + d},{lat + d}&WIDTH=100&HEIGHT=100&X=50&Y=50"
         "&INFO_FORMAT=text/plain")
    req = urllib.request.Request(f"{GEBCO_WMS}?{q}", headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        txt = r.read().decode("utf-8", "replace")
    m = re.search(r"value_list = '(-?\d+)'", txt)
    return {"elevation": int(m.group(1)) if m else None}


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


def _transparent_png():
    """1x1 の透明PNG（範囲外タイルの代わり）。"""
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c))
    raw = zlib.compress(b"\x00\x00\x00\x00\x00")
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


TRANSPARENT_PNG = _transparent_png()


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
            m = re.fullmatch(r"/api/sst(?:/(\d{4}-\d{2}-\d{2}))?", p)
            if m:
                src = parse_qs(urlparse(self.path).query).get("src", ["jma"])[0]
                if src not in ("jma", "noaa"):
                    raise ValueError("src は jma か noaa です")
                return self._send(get_sst(m.group(1), src), "application/json; charset=utf-8", max_age=3600)
            m = re.fullmatch(r"/api/jmatile/times/(wave|sst_anl|sst_fct|subs_anl|subs_fct)", p)
            if m:
                return self._send(json.dumps(get_jma_tile_times(m.group(1))).encode(), "application/json; charset=utf-8", max_age=300)
            m = re.fullmatch(r"/api/jmatile/(wave|sst_anl|sst_fct|subs_anl|subs_fct)/(\d{14})/(\d{14})/(surf|50|100|200|400)"
                             r"/(wavh|wind|windsea|swell|roughwv|curwv|sst|sstanom|temp|curs|curd)/([3-9])/(\d{1,3})/(\d{1,3})\.png", p)
            if m:
                body = get_jma_tile(*m.groups())
                if not body:  # 範囲外は 1x1 の透明PNG
                    body = TRANSPARENT_PNG
                return self._send(body, "image/png", max_age=1800)
            if p == "/api/depth":
                q = parse_qs(urlparse(self.path).query)
                lat, lon = float(q["lat"][0]), float(q["lon"][0])
                if not (-90 <= lat <= 90 and -180 <= lon <= 360):
                    raise ValueError("緯度経度が範囲外です")
                return self._send(json.dumps(get_depth(lat, ((lon + 180) % 360) - 180)).encode(), "application/json; charset=utf-8", max_age=86400)
            m = re.fullmatch(r"/api/gis/(20\d\d)/(\d{3})", p)
            if m:
                return self._send(get_gis(*m.groups()), "application/json; charset=utf-8", max_age=86400)
            m = re.fullmatch(r"/api/image/(20\d\d)/(\d{3})", p)
            if m:
                return self._send(get_image(*m.groups()), "image/png", max_age=86400)
        except (ValueError, KeyError) as e:  # 入力不正は 400
            return self._send(json.dumps({"error": str(e)}, ensure_ascii=False).encode(), "application/json; charset=utf-8", 400)
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
