// 海面水温（緯度経度格子）を色付き画像にして地図に重ねるレイヤー
// 使い方: const s = SstLayer(map); s.setData(data); s.show(true);
window.SstLayer = (map) => {
  // 水温(℃)の色。0℃=濃青 → 32℃=濃赤
  const STOPS = [[0, [49, 54, 149]], [8, [69, 117, 180]], [14, [116, 173, 209]], [18, [171, 217, 233]],
    [21, [254, 224, 144]], [25, [253, 174, 97]], [28, [244, 109, 67]], [31, [215, 48, 39]], [33, [165, 0, 38]]];
  const color = (t) => {
    if (t <= STOPS[0][0]) return STOPS[0][1];
    for (let i = 1; i < STOPS.length; i++) {
      if (t <= STOPS[i][0]) {
        const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], f = (t - t0) / (t1 - t0);
        return c0.map((x, k) => x + (c1[k] - x) * f);
      }
    }
    return STOPS[STOPS.length - 1][1];
  };
  map.createPane("sst").style.zIndex = 250; // 背景地図(200)の上、流線(400)の下
  let data = null, overlay = null, on = false, opacity = 0.7, contour = true;

  // 格子の双一次補間（欠測は重みから除外）。水温(℃)または null
  function at(lat, lon) {
    if (!data) return null;
    const fx = (lon - data.lon0) / data.dlon, fy = (lat - data.lat0) / data.dlat;
    if (fx < 0 || fy < 0 || fx >= data.nx - 1 || fy >= data.ny - 1) return null;
    const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    let s = 0, w = 0;
    for (const [dx, dy, ww] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const v = data.v[(y + dy) * data.nx + x + dx];
      if (v === null) continue;
      s += (v / 100) * ww; w += ww;
    }
    return w < 0.5 ? null : s / w;
  }

  // メルカトル図法で縦横比が合うように画像を作る
  function build() {
    if (overlay) { map.removeLayer(overlay); overlay = null; }
    if (!data) return;
    const latMin = data.lat0, latMax = data.lat0 + (data.ny - 1) * data.dlat;
    const lonMin = data.lon0, lonMax = data.lon0 + (data.nx - 1) * data.dlon;
    const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const W = 1200, H = Math.round((W * (my(latMax) - my(latMin))) / (((lonMax - lonMin) * Math.PI) / 180));
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H);
    const T = new Float32Array(W * H).fill(NaN);
    for (let j = 0; j < H; j++) {
      // 画像の上端=北。メルカトルyから緯度へ逆変換
      const yy = my(latMax) - ((my(latMax) - my(latMin)) * j) / (H - 1);
      const lat = (2 * Math.atan(Math.exp(yy)) - Math.PI / 2) * (180 / Math.PI);
      for (let i = 0; i < W; i++) {
        const t = at(lat, lonMin + ((lonMax - lonMin) * i) / (W - 1));
        if (t === null) continue;
        T[j * W + i] = t;
        const c = color(t), o = (j * W + i) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    if (contour) { // 2℃ごとの等温線（隣の画素と帯が変わる場所を暗く塗る）
      const band = (t) => Math.floor(t / 2);
      for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
        const t = T[j * W + i];
        if (Number.isNaN(t)) continue;
        const r = T[j * W + i + 1], d = T[(j + 1) * W + i];
        if ((!Number.isNaN(r) && band(r) !== band(t)) || (!Number.isNaN(d) && band(d) !== band(t))) {
          const o = (j * W + i) * 4;
          img.data[o] *= 0.45; img.data[o + 1] *= 0.45; img.data[o + 2] *= 0.45;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    overlay = L.imageOverlay(cv.toDataURL("image/png"), [[latMin, lonMin], [latMax, lonMax]], { pane: "sst", opacity, interactive: false });
    if (on) overlay.addTo(map);
  }

  return {
    setData(d) { data = d; build(); },
    show(v) { on = v; if (overlay) { v ? overlay.addTo(map) : map.removeLayer(overlay); } },
    setOpacity(o) { opacity = o; if (overlay) overlay.setOpacity(o); },
    setContour(c) { contour = c; build(); },
    at,
    legend: STOPS.filter((s) => [0, 8, 14, 18, 21, 25, 28, 31].includes(s[0])).map(([t, c]) => [t, `rgb(${c.join(",")})`]),
  };
};
