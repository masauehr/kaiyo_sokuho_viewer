// 海洋速報 海流図ビューア
(() => {
  const REGIONS = [
    { key: "k", name: "黒潮", color: "#d62728" },
    { key: "ts", name: "対馬暖流", color: "#e8710a" },
    { key: "tg", name: "津軽暖流", color: "#1f6fd1" },
    { key: "so", name: "宗谷暖流", color: "#1b9e5a" },
  ];
  const GEBCO_ATTR = "海底地形: <a href='https://www.gebco.net/'>GEBCO Compilation Group (2024) GEBCO 2024 Grid</a>（航行・安全用途には使用不可）";
  const BASEMAPS = {
    pale: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", "淡色地図"],
    std: ["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", "標準地図"],
    photo: ["https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", "写真"],
    blank: ["https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png", "白地図"],
  };
  // 海底地形の背景図（水深が色や陰影で分かる）
  const makeBasemap = {
    gebco: () => L.tileLayer.wms("https://wms.gebco.net/mapserv?", {
      layers: "GEBCO_LATEST_2", format: "image/png", version: "1.3.0", maxZoom: 12, attribution: GEBCO_ATTR }),
    ocean: () => L.layerGroup([
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 10, attribution: "海洋図: Esri, GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org ほか" }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 10, pane: "shadowPane" }),
    ]),
  };
  const $ = (id) => document.getElementById(id);
  const geoCache = new Map();
  const visible = Object.fromEntries(REGIONS.map((r) => [r.key, true]));
  let issues = [], idx = 0, timer = null, tile = null;
  let curLayer = null, ghostLayer = null, clickLayer = null, curGeo = null, token = 0;

  const map = L.map("map", { zoomControl: true }).setView([32, 137], 5);
  const flow = FlowLayer(map);
  const flowCache = new Map();
  const sst = SstLayer(map), sstCache = new Map();
  const sstSrc = () => $("sstSrc").value;
  const toast = (msg, ms = 3500) => {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
  };

  function setBasemap(k) {
    if (tile) map.removeLayer(tile);
    tile = makeBasemap[k] ? makeBasemap[k]() : L.tileLayer(BASEMAPS[k][0], {
      maxZoom: k === "blank" ? 14 : 18,
      attribution: `<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル（${BASEMAPS[k][1]}）</a>`,
    });
    tile.addTo(map);
    if (tile.bringToBack) tile.bringToBack();
    if (map.attributionControl && !map._kaihoAttr) {
      map._kaihoAttr = true;
      map.attributionControl.addAttribution('海流: <a href="https://www1.kaiho.mlit.go.jp/KANKYO/KAIYO/qboc/kurosio-num.html">海上保安庁 海洋速報</a>');
    }
  }

  async function loadGeo(issue) {
    if (geoCache.has(issue.id)) return geoCache.get(issue.id);
    const res = await fetch(`/api/gis/${issue.year}/${String(issue.no).padStart(3, "0")}`);
    if (!res.ok) throw new Error(`取得に失敗しました (${issue.label})`);
    const g = await res.json();
    geoCache.set(issue.id, g);
    return g;
  }

  const filtered = (g) => ({ ...g, features: g.features.filter((f) => visible[f.properties.region]) });
  const colorOf = (k) => REGIONS.find((r) => r.key === k).color;

  // 黒潮の流線が各経度を横切る緯度を求める
  function axisLats(g, lon) {
    const out = [];
    for (const f of g.features) {
      if (f.properties.region !== "k") continue;
      const c = f.geometry.coordinates;
      for (let i = 1; i < c.length; i++) {
        const [x1, y1] = c[i - 1], [x2, y2] = c[i];
        if ((x1 - lon) * (x2 - lon) <= 0 && x1 !== x2) out.push(y1 + ((lon - x1) / (x2 - x1)) * (y2 - y1));
      }
    }
    return out.sort((a, b) => a - b);
  }

  function renderAxis(g) {
    const rows = [];
    for (let lon = 125; lon <= 143; lon += 2) {
      const v = axisLats(g, lon);
      rows.push(`<tr><td>${lon}°E</td><td>${v.length ? v.map((x) => x.toFixed(2) + "°N").join(" / ") : "－"}</td></tr>`);
    }
    $("axisTable").innerHTML = `<table><tr><th>経度</th><th>通過緯度</th></tr>${rows.join("")}</table>`;
  }

  function drawGeo(g, ghost) {
    return L.geoJSON(filtered(g), {
      style: (f) => ghost
        ? { color: "#777", weight: 2, opacity: 0.6, dashArray: "6 6" }
        : { color: colorOf(f.properties.region), weight: 3, opacity: 0.95 },
      interactive: false,
    }).addTo(map);
  }

  async function show(i) {
    idx = Math.max(0, Math.min(issues.length - 1, i));
    const issue = issues[idx], my = ++token;
    $("slider").value = idx; $("issueSelect").value = idx;
    try {
      const g = await loadGeo(issue);
      if (my !== token) return; // 追い越された読み込みは破棄
      curGeo = g;
      if (curLayer) map.removeLayer(curLayer);
      if (ghostLayer) { map.removeLayer(ghostLayer); ghostLayer = null; }
      if ($("ghostOn").checked) {
        const gi = issues[idx - Number($("ghostBack").value)];
        if (gi) {
          const gg = await loadGeo(gi);
          if (my !== token) return;
          ghostLayer = drawGeo(gg, true);
        }
      }
      curLayer = drawGeo(g, false);
      const m = g.meta || {};
      $("meta").textContent = `${m.issueNo || issue.label}　発行 ${m.issueDate || ""}　解析対象 ${m.analysisDate || ""}`;
      renderAxis(g);
      if ($("imgOn").checked) setImage();
      loadFlow(g);
      loadSst(g);
    } catch (e) { toast(e.message); stop(); }
  }

  // 和暦併記の日付（例: R8(2026)/10/15）→ YYYY-MM-DD。key は meta のキー（analysisDate / issueDate）
  function metaDate(g, key) {
    const m = (g.meta && g.meta[key] || "").match(/\((\d{4})\)\/(\d+)\/(\d+)/);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
  }
  const analysisDate = (g) => metaDate(g, "analysisDate"); // 解析対象日（海流図データの基準日。発行日の前日）

  // 表示中の号の解析対象日に合わせて流れ場を読み込む（最新日より後なら最新日になる）
  async function loadFlow(g) {
    if (!$("flowOn").checked) return;
    const date = analysisDate(g), my = token;
    try {
      let d = flowCache.get(date);
      if (!d) {
        const res = await fetch(`/api/flow${date ? "/" + date : ""}`);
        if (!res.ok) throw new Error("流れ場の取得に失敗しました");
        d = await res.json();
        flowCache.set(date, d);
      }
      if (my !== token) return;
      flow.setData(d);
      $("flowMeta").textContent = `流れ場の日付: ${d.date}${date && d.date !== date ? "（この号の解析日のデータは未公開のため最新日）" : ""}`;
    } catch (e) { toast(e.message); }
  }

  // 表示中の号の解析対象日に合わせて海面水温を読み込む（未公開日なら最新日）
  async function loadSst(g) {
    if (!$("sstOn").checked) return;
    // 「最新日」は日付を指定せず、サーバーが公開済みの最新日を返す
    const date = $("sstDate").value === "latest" ? "" : analysisDate(g), my = token;
    try {
      const key = `${sstSrc()}:${date}`;
      let d = sstCache.get(key);
      if (!d) {
        const res = await fetch(`/api/sst${date ? "/" + date : ""}?src=${sstSrc()}`);
        if (!res.ok) throw new Error("海面水温の取得に失敗しました");
        d = await res.json();
        sstCache.set(key, d);
      }
      if (my !== token) return;
      sst.setData(d);
      $("sstMeta").textContent = `${d.source}　日付: ${d.date}${date && d.date !== date ? "（この号の解析日のデータは未公開のため最新日）" : ""}`;
    } catch (e) { toast(e.message); }
  }

  function setImage() {
    const i = issues[idx];
    $("officialImg").src = `/api/image/${i.year}/${String(i.no).padStart(3, "0")}`;
  }

  function stop() { clearInterval(timer); timer = null; $("play").textContent = "▶ 再生"; }
  function play() {
    if (timer) return stop();
    $("play").textContent = "■ 停止";
    if (idx >= issues.length - 1) idx = Math.max(0, issues.length - 30);
    const step = async () => {
      if (idx >= issues.length - 1) return stop();
      await show(idx + 1);
      if (idx + 1 < issues.length) loadGeo(issues[idx + 1]).catch(() => {}); // 次号を先読み
    };
    step();
    timer = setInterval(step, Number($("speed").value));
  }

  // クリック地点から最寄りの黒潮までの距離(海里)と方位
  function nearestKuroshio(lat0, lon0) {
    const kx = Math.cos((lat0 * Math.PI) / 180), best = { d: Infinity };
    for (const f of curGeo.features) {
      if (f.properties.region !== "k") continue;
      const c = f.geometry.coordinates;
      for (let i = 1; i < c.length; i++) {
        const ax = (c[i - 1][0] - lon0) * kx, ay = c[i - 1][1] - lat0;
        const bx = (c[i][0] - lon0) * kx, by = c[i][1] - lat0;
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
        const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
        if (d < best.d) Object.assign(best, { d, px, py });
      }
    }
    if (!isFinite(best.d)) return null;
    const nm = best.d * 60; // 緯度1度 = 60海里
    const deg = ((Math.atan2(best.px, best.py) * 180) / Math.PI + 360) % 360;
    const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
    return { nm, dir: dirs[Math.round(deg / 45) % 8], lat: lat0 + best.py, lon: lon0 + best.px / kx };
  }

  map.on("click", (e) => {
    if (!curGeo) return;
    if (clickLayer) map.removeLayer(clickLayer);
    const r = nearestKuroshio(e.latlng.lat, e.latlng.lng);
    if (!r) return toast("この号には黒潮の流線がありません");
    clickLayer = L.layerGroup([
      L.circleMarker(e.latlng, { radius: 5, color: "#000", fillOpacity: 1 }),
      L.polyline([e.latlng, [r.lat, r.lon]], { color: "#000", weight: 1.5, dashArray: "4 4" }),
    ]).addTo(map);
    const f = $("flowOn").checked ? flow.at(e.latlng.lat, e.latlng.lng) : null;
    const t = $("sstOn").checked ? sst.at(e.latlng.lat, e.latlng.lng) : null;
    const msg = `最寄りの黒潮まで 約${r.nm.toFixed(0)}海里（約${(r.nm * 1.852).toFixed(0)}km）・${r.dir}方向` +
      (f ? `／流れ(モデル) ${f.kt.toFixed(1)}ノット・${f.dir}向き` : "") + (t !== null ? `／水温 ${t.toFixed(1)}℃` : "");
    toast(msg, 8000);
    // 水深は外部(GEBCO)への問い合わせのため、取得できたら追記して再表示する
    fetch(`/api/depth?lat=${e.latlng.lat.toFixed(4)}&lon=${e.latlng.lng.toFixed(4)}`).then((x) => x.json()).then((d) => {
      if (typeof d.elevation !== "number") return;
      toast(msg + (d.elevation < 0 ? `／水深 約${-d.elevation}m` : `／陸地（標高 約${d.elevation}m）`), 8000);
    }).catch(() => {});
  });

  function initUi() {
    $("regions").innerHTML = REGIONS.map((r) =>
      `<label class="reg"><input type="checkbox" data-k="${r.key}" checked><span class="sw" style="background:${r.color}"></span>${r.name}</label>`).join("");
    $("regions").addEventListener("change", (e) => { visible[e.target.dataset.k] = e.target.checked; show(idx); });
    $("issueSelect").innerHTML = issues.map((s, i) => `<option value="${i}">${s.year}年 ${s.label}</option>`).join("");
    $("slider").max = issues.length - 1;
    $("issueSelect").onchange = (e) => { stop(); show(Number(e.target.value)); };
    $("slider").oninput = (e) => { stop(); show(Number(e.target.value)); };
    $("prev").onclick = () => { stop(); show(idx - 1); };
    $("next").onclick = () => { stop(); show(idx + 1); };
    $("latest").onclick = () => { stop(); show(issues.length - 1); };
    $("play").onclick = play;
    $("speed").onchange = () => { if (timer) { stop(); play(); } };
    $("ghostOn").onchange = $("ghostBack").onchange = () => show(idx);
    $("basemap").onchange = (e) => setBasemap(e.target.value);
    $("imgOn").onchange = (e) => { $("imgBox").hidden = !e.target.checked; if (e.target.checked) setImage(); };
    $("flowLegend").innerHTML = flow.legend.map(([v, c]) => `<span><i style="background:${c}"></i>${v}m/s〜</span>`).join("");
    $("flowOn").onchange = (e) => { flow.show(e.target.checked); if (e.target.checked && curGeo) loadFlow(curGeo); };
    $("sstLegend").innerHTML = sst.legend.map(([v, c]) => `<span><i style="background:${c}"></i>${v}℃</span>`).join("");
    $("sstOn").onchange = (e) => { sst.show(e.target.checked); if (e.target.checked && curGeo) loadSst(curGeo); };
    $("sstSrc").onchange = $("sstDate").onchange = () => { if (curGeo) loadSst(curGeo); };
    $("sstOpacity").oninput = (e) => sst.setOpacity(Number(e.target.value));
    $("sstContour").onchange = (e) => sst.setContour(e.target.checked);
    $("sstStep").onchange = (e) => sst.setStep(Number(e.target.value));
    $("fit").onclick = () => map.setView([32, 137], 5);
    $("dlGeo").onclick = () => {
      if (!curGeo) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(curGeo)], { type: "application/geo+json" }));
      a.download = `kaiyo_sokuho_${curGeo.id}.geojson`;
      a.click(); URL.revokeObjectURL(a.href);
    };
  }

  (async () => {
    setBasemap("pale");
    try {
      const res = await fetch("/api/issues");
      if (!res.ok) throw new Error("号数一覧の取得に失敗しました");
      issues = (await res.json()).issues;
      if (!issues.length) throw new Error("号数がありません");
      initUi();
      await show(issues.length - 1);
    } catch (e) { toast(e.message, 10000); }
  })();
})();
