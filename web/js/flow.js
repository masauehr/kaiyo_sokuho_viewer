// 流れ場（u/v格子）を粒子アニメーションで描くレイヤー
// 使い方: const f = FlowLayer(map); f.setData(data); f.show(true);
window.FlowLayer = (map) => {
  // 流速(m/s)の色。0→強いほど暖色
  const STOPS = [[0, "#5b8ec9"], [0.25, "#2a9d8f"], [0.5, "#e9c46a"], [1, "#f4802c"], [1.5, "#c1121f"]];
  const colorOf = (sp) => { let c = STOPS[0][1]; for (const [v, col] of STOPS) if (sp >= v) c = col; return c; };
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "absolute", left: 0, top: 0, zIndex: 450, pointerEvents: "none", opacity: 1 });
  map.getContainer().appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let data = null, on = false, raf = null, parts = [], paused = false;
  const N = () => Math.min(7000, Math.round((canvas.width * canvas.height) / 260));

  function resize() {
    const s = map.getSize();
    canvas.width = s.x; canvas.height = s.y;
  }

  // 緯度経度 → 格子の双一次補間。陸地・範囲外は null
  function uv(lat, lon) {
    if (!data) return null;
    const fx = (lon - data.lon0) / data.d, fy = (lat - data.lat0) / data.d;
    if (fx < 0 || fy < 0 || fx >= data.nx - 1 || fy >= data.ny - 1) return null;
    const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    let su = 0, sv = 0, sw = 0;
    for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
      const i = (y + dy) * data.nx + x + dx, u = data.u[i], v = data.v[i];
      if (u === null || v === null) continue; // 欠測は重みから除外
      su += u * w; sv += v * w; sw += w;
    }
    return sw < 0.5 ? null : [su / sw, sv / sw];
  }

  function spawn(p) {
    for (let k = 0; k < 8; k++) { // 陸地を避けて最大8回試す
      p.x = Math.random() * canvas.width; p.y = Math.random() * canvas.height;
      const ll = map.containerPointToLatLng([p.x, p.y]);
      if (uv(ll.lat, ll.lng)) break;
    }
    p.age = Math.floor(Math.random() * 70);
    p.max = 60 + Math.random() * 70;
  }

  function reset() {
    resize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parts = Array.from({ length: N() }, () => { const p = {}; spawn(p); return p; });
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (!on || !data || paused) return;
    // 軌跡を少しずつ消す
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,0.05)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1.8;
    const K = 4.5; // 1m/s あたりの1フレームの移動量(px)
    for (const p of parts) {
      const ll = map.containerPointToLatLng([p.x, p.y]), f = uv(ll.lat, ll.lng);
      if (!f || ++p.age > p.max) { spawn(p); continue; }
      const sp = Math.hypot(f[0], f[1]), nx = p.x + f[0] * K, ny = p.y - f[1] * K;
      ctx.strokeStyle = colorOf(sp);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
      p.x = nx; p.y = ny;
    }
  }

  // 地図の移動・拡大中は一時停止し、終わったら粒子を撒き直す
  map.on("movestart zoomstart", () => { paused = true; ctx.clearRect(0, 0, canvas.width, canvas.height); });
  map.on("moveend zoomend resize", () => { paused = false; if (on) reset(); });
  raf = requestAnimationFrame(frame);
  canvas.hidden = true;

  return {
    setData(d) { data = d; if (on) reset(); },
    show(v) { on = v; canvas.hidden = !v; if (v) reset(); else ctx.clearRect(0, 0, canvas.width, canvas.height); },
    // 地点の流速（m/s）と向き（流れていく方位）
    at(lat, lon) {
      const f = uv(lat, lon);
      if (!f) return null;
      const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
      const deg = ((Math.atan2(f[0], f[1]) * 180) / Math.PI + 360) % 360;
      return { ms: Math.hypot(f[0], f[1]), kt: Math.hypot(f[0], f[1]) * 1.9438, dir: dirs[Math.round(deg / 45) % 8] };
    },
    legend: STOPS,
  };
};
