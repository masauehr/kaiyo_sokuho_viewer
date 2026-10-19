// 海面水温（緯度経度格子）を色付き画像と等温線（℃ラベル付き）にして地図に重ねるレイヤー
// 使い方: const s = SstLayer(map); s.setData(data); s.show(true);
window.SstLayer = (map) => {
  // 水温(℃)の色。0℃=濃青 → 33℃=濃赤
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
  map.createPane("sst").style.zIndex = 250;      // 背景地図(200)の上、流線(400)の下
  map.createPane("sstline").style.zIndex = 260;
  map.createPane("sstlabel").style.zIndex = 430; // 流線の上に℃ラベル
  map.getPane("sstlabel").style.pointerEvents = "none";
  const lineRenderer = L.canvas({ pane: "sstline", padding: 0.3 });
  const lineGroup = L.layerGroup(), labelGroup = L.layerGroup();
  let data = null, overlay = null, on = false, opacity = 0.7, contour = true, chains = [];
  let STEP = 2; // 等温線の間隔(℃)。1 または 2

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

  // メルカトル図法で縦横比が合うように色付き画像を作る
  function buildImage() {
    if (overlay) { map.removeLayer(overlay); overlay = null; }
    if (!data) return;
    const latMin = data.lat0, latMax = data.lat0 + (data.ny - 1) * data.dlat;
    const lonMin = data.lon0, lonMax = data.lon0 + (data.nx - 1) * data.dlon;
    const my = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const W = 1200, H = Math.round((W * (my(latMax) - my(latMin))) / (((lonMax - lonMin) * Math.PI) / 180));
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H);
    for (let j = 0; j < H; j++) {
      const yy = my(latMax) - ((my(latMax) - my(latMin)) * j) / (H - 1); // 上端=北
      const lat = (2 * Math.atan(Math.exp(yy)) - Math.PI / 2) * (180 / Math.PI);
      for (let i = 0; i < W; i++) {
        const t = at(lat, lonMin + ((lonMax - lonMin) * i) / (W - 1));
        if (t === null) continue;
        const c = color(t), o = (j * W + i) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    overlay = L.imageOverlay(cv.toDataURL("image/png"), [[latMin, lonMin], [latMax, lonMax]], { pane: "sst", opacity, interactive: false });
    if (on) overlay.addTo(map);
  }

  // マーチングスクエア法で STEP(1か2)℃ごとの等温線を作り、線分をつないで折れ線にする
  function buildChains() {
    chains = [];
    if (!data) return;
    const { nx, ny, v, lat0, lon0, dlat, dlon } = data;
    const val = (i, j) => v[j * nx + i];
    // 辺ID → 座標。辺は水平 h(i,j)=(i,j)-(i+1,j)、垂直 v(i,j)=(i,j)-(i,j+1)
    const TABLE = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[3, 2]], 9: [[0, 2]], 11: [[1, 2]], 12: [[3, 1]], 13: [[0, 1]], 14: [[3, 0]] };
    const levels = new Map(); // level → { pts: Map(id→[lat,lon]), adj: Map(id→[id]) }
    const lv = (L0) => { if (!levels.has(L0)) levels.set(L0, { pts: new Map(), adj: new Map() }); return levels.get(L0); };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = val(i, j), b = val(i + 1, j), c = val(i + 1, j + 1), d = val(i, j + 1);
      if (a === null || b === null || c === null || d === null) continue;
      const lo = Math.min(a, b, c, d) / 100, hi = Math.max(a, b, c, d) / 100;
      for (let L0 = Math.ceil(lo / STEP) * STEP; L0 <= hi; L0 += STEP) {
        const T = L0 * 100;
        if (T <= Math.min(a, b, c, d)) continue; // 全角が等温線以上なら交差なし
        const cs = (a >= T ? 1 : 0) | (b >= T ? 2 : 0) | (c >= T ? 4 : 0) | (d >= T ? 8 : 0);
        let segs = TABLE[cs];
        if (cs === 5 || cs === 10) { // 鞍点は中心値で向きを決める
          const hiCenter = (a + b + c + d) / 4 >= T;
          segs = cs === 5 ? (hiCenter ? [[0, 1], [3, 2]] : [[3, 0], [1, 2]]) : (hiCenter ? [[3, 0], [1, 2]] : [[0, 1], [3, 2]]);
        }
        if (!segs) continue;
        const e = {
          0: [`h${i},${j}`, () => [lat0 + j * dlat, lon0 + (i + (T - a) / (b - a)) * dlon]],
          1: [`v${i + 1},${j}`, () => [lat0 + (j + (T - b) / (c - b)) * dlat, lon0 + (i + 1) * dlon]],
          2: [`h${i},${j + 1}`, () => [lat0 + (j + 1) * dlat, lon0 + (i + (T - d) / (c - d)) * dlon]],
          3: [`v${i},${j}`, () => [lat0 + (j + (T - a) / (d - a)) * dlat, lon0 + i * dlon]],
        };
        const o = lv(L0);
        for (const [p, q] of segs) {
          const [ip, fp] = e[p], [iq, fq] = e[q];
          if (!o.pts.has(ip)) o.pts.set(ip, fp());
          if (!o.pts.has(iq)) o.pts.set(iq, fq());
          for (const [x, y] of [[ip, iq], [iq, ip]]) { if (!o.adj.has(x)) o.adj.set(x, []); o.adj.get(x).push(y); }
        }
      }
    }
    for (const [L0, { pts, adj }] of levels) {
      const seen = new Set();
      const walk = (start) => { // 端点（隣が1つ）または閉曲線の任意点から順にたどる
        const line = [start]; seen.add(start);
        let cur = start;
        for (;;) {
          const nxt = (adj.get(cur) || []).find((n) => !seen.has(n));
          if (!nxt) break;
          line.push(nxt); seen.add(nxt); cur = nxt;
        }
        return line;
      };
      const ends = [...adj.keys()].filter((k) => adj.get(k).length === 1);
      for (const k of [...ends, ...adj.keys()]) {
        if (seen.has(k)) continue;
        const ids = walk(k);
        if (ids.length >= 4) chains.push({ level: L0, pts: ids.map((id) => pts.get(id)) });
      }
    }
  }

  function drawLines() {
    lineGroup.clearLayers();
    if (!on || !contour) return;
    for (const c of chains) {
      L.polyline(c.pts, { renderer: lineRenderer, color: "#2b2b2b", weight: 1, opacity: 0.65, interactive: false }).addTo(lineGroup);
    }
  }

  // ラベルは表示範囲・拡大率に合わせて付け直す（線上を一定の画面距離ごとに配置）
  function drawLabels() {
    labelGroup.clearLayers();
    if (!on || !contour || !chains.length) return;
    const size = map.getSize(), placed = [];
    const near = (x, y) => placed.some((p) => (p[0] - x) ** 2 + (p[1] - y) ** 2 < 70 * 70);
    for (const c of chains) {
      const px = c.pts.map((p) => map.latLngToContainerPoint(p));
      let total = 0;
      for (let i = 1; i < px.length; i++) total += px[i].distanceTo(px[i - 1]);
      if (total < 140) continue; // 短い等温線にはラベルを付けない
      let acc = 40; // 最初のラベルまでの距離
      for (let i = 1; i < px.length; i++) {
        acc -= px[i].distanceTo(px[i - 1]);
        if (acc > 0) continue;
        acc = 320;
        const p = px[i];
        if (p.x < 20 || p.y < 20 || p.x > size.x - 20 || p.y > size.y - 20 || near(p.x, p.y)) continue;
        let ang = (Math.atan2(px[Math.min(i + 2, px.length - 1)].y - px[Math.max(i - 2, 0)].y,
          px[Math.min(i + 2, px.length - 1)].x - px[Math.max(i - 2, 0)].x) * 180) / Math.PI;
        if (ang > 90) ang -= 180; else if (ang < -90) ang += 180; // 文字が逆さにならないように
        placed.push([p.x, p.y]);
        L.marker(c.pts[i], {
          pane: "sstlabel", interactive: false, keyboard: false,
          icon: L.divIcon({ className: "sst-label", iconSize: [0, 0], html: `<span style="transform:translate(-50%,-50%) rotate(${ang.toFixed(0)}deg)">${c.level}℃</span>` }),
        }).addTo(labelGroup);
      }
    }
  }

  const refresh = () => { drawLines(); drawLabels(); };
  lineGroup.addTo(map); labelGroup.addTo(map);
  map.on("moveend zoomend", drawLabels);

  return {
    setData(d) { data = d; buildImage(); buildChains(); refresh(); },
    show(v) { on = v; if (overlay) { v ? overlay.addTo(map) : map.removeLayer(overlay); } refresh(); },
    setOpacity(o) { opacity = o; if (overlay) overlay.setOpacity(o); },
    setContour(c) { contour = c; refresh(); },
    setStep(n) { STEP = n; buildChains(); refresh(); },
    at,
    legend: STOPS.filter((s) => [0, 8, 14, 18, 21, 25, 28, 31].includes(s[0])).map(([t, c]) => [t, `rgb(${c.join(",")})`]),
  };
};
