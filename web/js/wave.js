// 有義波高（緯度経度格子）を色付き画像にして地図に重ねるレイヤー
// 使い方: const w = WaveLayer(map); w.setData(data); w.show(true);
window.WaveLayer = (map) => {
  // 波高(m)の色。0m=薄青 → 10m=紫
  const STOPS = [[0, [224, 243, 248]], [1, [171, 217, 233]], [2, [116, 173, 209]], [3, [255, 255, 153]],
    [4, [253, 174, 97]], [6, [215, 48, 39]], [8, [165, 0, 38]], [10, [103, 0, 140]]];
  const color = (h) => {
    if (h <= STOPS[0][0]) return STOPS[0][1];
    for (let i = 1; i < STOPS.length; i++) {
      if (h <= STOPS[i][0]) {
        const [h0, c0] = STOPS[i - 1], [h1, c1] = STOPS[i], f = (h - h0) / (h1 - h0);
        return c0.map((x, k) => x + (c1[k] - x) * f);
      }
    }
    return STOPS[STOPS.length - 1][1];
  };
  map.createPane("wave").style.zIndex = 255; // 水温(250)の上、流線(400)の下
  let data = null, overlay = null, on = false, opacity = 0.7;

  // 格子の双一次補間（欠測は重みから除外）。波高(m)または null
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

  // メルカトル図法で縦横比が合うように色付き画像を作る
  function buildImage() {
    if (overlay) { map.removeLayer(overlay); overlay = null; }
    if (!data) return;
    const latMin = data.lat0, latMax = data.lat0 + (data.ny - 1) * data.dlat;
    const lonMin = data.lon0, lonMax = data.lon0 + (data.nx - 1) * data.dlon;
    const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const W = 1000, H = Math.round((W * (my(latMax) - my(latMin))) / (((lonMax - lonMin) * Math.PI) / 180));
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H);
    for (let j = 0; j < H; j++) {
      const yy = my(latMax) - ((my(latMax) - my(latMin)) * j) / (H - 1); // 上端=北
      const lat = (2 * Math.atan(Math.exp(yy)) - Math.PI / 2) * (180 / Math.PI);
      for (let i = 0; i < W; i++) {
        const h = at(lat, lonMin + ((lonMax - lonMin) * i) / (W - 1));
        if (h === null) continue;
        const c = color(h), o = (j * W + i) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    overlay = L.imageOverlay(cv.toDataURL("image/png"), [[latMin, lonMin], [latMax, lonMax]], { pane: "wave", opacity, interactive: false });
    if (on) overlay.addTo(map);
  }

  return {
    setData(d) { data = d; buildImage(); },
    show(v) { on = v; if (overlay) { v ? overlay.addTo(map) : map.removeLayer(overlay); } },
    setOpacity(o) { opacity = o; if (overlay) overlay.setOpacity(o); },
    at,
    legend: [0, 1, 2, 3, 4, 6, 8, 10].map((h) => [h, `rgb(${STOPS.find((s) => s[0] === h)[1].join(",")})`]),
  };
};
