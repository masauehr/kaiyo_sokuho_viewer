"""KML/DBF→GeoJSON変換と号一覧解析の単体テスト（ネットワーク不使用）。
実行: /opt/homebrew/bin/python3 -m unittest discover -s tests
"""
import io
import struct
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

KML = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString>
<coordinates>140.0,30.0,0 141.0,31.0,0</coordinates></LineString></Placemark></Document></kml>"""


def make_dbf(rows):
    """テスト用の最小DBF（文字フィールド1つ、Shift-JIS）を作る。"""
    ln = 20
    head = bytearray(32)
    head[0] = 3
    struct.pack_into("<IHH", head, 4, len(rows), 32 + 32 + 1, 1 + ln)
    fld = bytearray(32)
    fld[0:10] = "解析対象日".encode("cp932")
    fld[11] = ord("C")
    fld[16] = ln
    body = b"".join(b" " + r.encode("cp932").ljust(ln) for r in rows)
    return bytes(head) + bytes(fld) + b"\x0d" + body


class ConvertTest(unittest.TestCase):
    def test_zip_to_geojson(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("q/k/q_k.kml", KML)
            z.writestr("q/k/q_k_Line.dbf", make_dbf(["R8(2026)/10/15"]))
        g = server.zip_to_geojson(buf.getvalue(), "2026999")
        self.assertEqual(len(g["features"]), 1)
        self.assertEqual(g["features"][0]["properties"]["name"], "黒潮")
        self.assertEqual(g["meta"]["analysisDate"], "R8(2026)/10/15")
        self.assertEqual(g["features"][0]["geometry"]["coordinates"][0], [140.0, 30.0])


if __name__ == "__main__":
    unittest.main()
