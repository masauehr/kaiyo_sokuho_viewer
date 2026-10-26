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

  // 表示方法（パソコン用／スマホ用）と日時表示の大きさ。選択はこの端末(localStorage)に保存する
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても動作は続ける */ } },
  };
  const looksLikePhone = () => matchMedia("(max-width: 720px)").matches || matchMedia("(pointer: coarse) and (max-width: 900px)").matches;
  let layout = store.get("kaiyo_layout") || (looksLikePhone() ? "mobile" : "pc");
  let timeStyle = store.get("kaiyo_timestyle"); // 未選択ならモードに合わせる（スマホ=小、パソコン=大）
  let tab = "chart", sheetOpen = true; // 起動時は常に既定の波浪図から（前回のタブは引き継がない）
  let sheetSize = store.get("kaiyo_sheet") || "s"; // スマホ用メニューの高さ（地図を広く見るため既定は小）
  const SHEET_VH = { s: 26, m: 36, l: 50 };
  // スマホ用: プルダウンを選択ボタンに置き換える（元の select は残し、ボタンから値を変えて change を発火する）。
  // optgroup のある select は「分類ボタン＋項目ボタン」の2段にする
  const segs = [];
  function makeSeg(sel, always) {
    const box = document.createElement("div");
    box.className = "seg";
    sel.classList.add("segd");
    if (always) { sel.classList.add("all"); box.classList.add("all"); } // パソコン用でもボタンで選べる
    sel.after(box);
    const pick = (v) => { sel.value = v; sel.dispatchEvent(new Event("change")); render(); };
    const btn = (parent, text, on, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = text; b.classList.toggle("on", on); b.onclick = fn;
      parent.appendChild(b);
    };
    function render() {
      box.textContent = "";
      const groups = [...sel.querySelectorAll("optgroup")];
      const cur = sel.options[sel.selectedIndex];
      if (!groups.length) {
        [...sel.options].forEach((o) => btn(box, o.textContent, o === cur, () => pick(o.value)));
        return;
      }
      const g = cur ? cur.parentElement : groups[0];
      if (sel.id === "jwEl") $("jwTitle").textContent = g.label; // 見出しは選択中の分類名
      const top = document.createElement("div"), sub = document.createElement("div");
      top.className = sub.className = "segrow";
      // 分類名は「波浪（実況・約2日先まで）」のような長い表記から括弧の前だけを使う
      groups.forEach((gr) => btn(top, gr.label.replace(/（.*$/, ""), gr === g, () => pick(gr.querySelector("option").value)));
      [...g.querySelectorAll("option")].forEach((o) => btn(sub, o.textContent, o === cur, () => pick(o.value)));
      box.append(top, sub);
    }
    segs.push(render);
    render();
  }
  makeSeg($("jwEl"), true);
  ["speed", "ghostBack", "basemap", "layoutMode", "sheetSize", "timeStyle"].forEach((id) => makeSeg($(id)));
  function applyLayout() {
    const mobile = layout === "mobile", ts = timeStyle || (mobile ? "compact" : "large");
    document.body.classList.toggle("mobile", mobile);
    document.body.classList.toggle("compact-time", ts === "compact");
    document.body.classList.toggle("sheet-closed", mobile && !sheetOpen);
    document.body.dataset.tab = tab;
    $("timeBox").classList.toggle("compact", ts === "compact");
    $("layoutMode").value = layout; $("timeStyle").value = ts; $("sheetSize").value = sheetSize;
    document.documentElement.style.setProperty("--sheet-max", `${SHEET_VH[sheetSize]}vh`);
    segs.forEach((r) => r()); // 値がコードで変わった場合もボタンの選択表示を合わせる
    $("layoutBtn").textContent = mobile ? "パソコン用表示" : "スマホ用表示";
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", sheetOpen && b.dataset.t === tab));
    // 下のメニューの高さ分だけ地図の出典表示を持ち上げる
    document.documentElement.style.setProperty("--sheet-h", mobile ? `${$("panel").offsetHeight}px` : "0px");
    setTimeout(() => map.invalidateSize(), 0);
  }
  const setLayout = (m) => { layout = m; store.set("kaiyo_layout", m); applyLayout(); };
  $("layoutMode").onchange = (e) => setLayout(e.target.value);
  $("layoutBtn").onclick = () => setLayout(layout === "mobile" ? "pc" : "mobile");
  $("sheetSize").onchange = (e) => { sheetSize = e.target.value; store.set("kaiyo_sheet", sheetSize); applyLayout(); };
  $("timeStyle").onchange = (e) => { timeStyle = e.target.value; store.set("kaiyo_timestyle", timeStyle); applyLayout(); };
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.onclick = () => { // 開いているタブをもう一度押すとメニューを閉じて地図を広く見られる
      const prev = tab, next = b.dataset.t;
      if (prev === next && sheetOpen) sheetOpen = false;
      else {
        tab = next; sheetOpen = true;
        $("panelBody").scrollTop = 0; // 前のタブのスクロール位置を引き継がない（内容が隠れて同じに見えるのを防ぐ）
      }
      applyLayout();
    };
  });
  if (window.ResizeObserver) new ResizeObserver(() => applyLayout()).observe($("panel"));
  applyLayout();
  // 気象庁の画像タイル（メインの図。常に表示）: 波浪図（既定）・海面水温・表層水温・海流の図を1つのビューアで切り替える
  const JW = "https://www.data.jma.go.jp/waveinf/tile/jp/images/rect_", JK = "https://www.data.jma.go.jp/kaikyou/kaikyou/tile/jp/images/rect_";
  const lg = (base, rows) => rows.map(([n, v]) => [`${base}${n}.svg`, v]);
  const TEMP = lg(JK, [["wtmp30G", "30"], ["wtmp25G", "25"], ["wtmp20G", "20"], ["wtmp15G", "15"], ["wtmp10G", "10"], ["wtmp05G", "5"]]);
  const ANOM = lg(JK, [["anomP4G", "+4"], ["anomP3G", "+3"], ["anomP2G", "+2"], ["anomP1G", "+1"], ["anom00G", "0"], ["anomM1G", "-1"], ["anomM2G", "-2"], ["anomM3G", "-3"], ["anomM4G", "-4"]]);
  const CUR = lg(JK, [["cur3p0G", "3.0"], ["cur2p5G", "2.5"], ["cur2p0G", "2.0"], ["cur1p5G", "1.5"], ["cur1p0G", "1.0"], ["cur0p5G", "0.5"]]);
  const wave = (id, legend, unit) => ({ ds: "wave", depth: "surf", ids: [id], minZoom: 3, maxZoom: 7, hour: true, legend, unit });
  const kai = (ds, depth, ids, legend, unit) => ({ ds, depth, ids, minZoom: 4, maxZoom: 9, hour: false, legend, unit });
  const timeLines = {}; // 画面に出ている図の表示日時（地図上の大きな表示）
  const onLabel = (key, v) => {
    if (v) timeLines[key] = v; else delete timeLines[key];
    const box = $("timeBox"), keys = Object.keys(timeLines);
    box.hidden = !keys.length;
    box.innerHTML = keys.map((k) => {
      const t = timeLines[k];
      return `<div class="line"><div class="big">${t.big}</div><div class="sub"><span class="tag${t.kind === "予想" ? " fc" : ""}">${t.kind}</span>${t.name}</div></div>`;
    }).join("");
  };
  const jw = JmaTileViewer(map, {
    prefix: "jw", pane: "jwave", zIndex: 258, onLabel, toast: (m) => toast(m),
    elements: {
      wavh: wave("wavh", lg(JW, [["wave06G", "9"], ["wave05G", "6"], ["wave04G", "4"], ["wave03G", "3"], ["wave02G", "2"], ["wave01G", "1"], ["wave00G", "0"]]), "m"),
      wind: wave("wind", [], ""),
      windsea: wave("windsea", [], ""),
      swell: wave("swell", lg(JW, [["wvp01G", "6秒"], ["wvp02G", ""], ["wvp03G", ""], ["wvp04G", ""], ["wvp05G", ""], ["wvp06G", ""], ["wvp07G", ""], ["wvp08G", ""], ["wvp09G", ""], ["wvp10G", ""], ["wvp11G", "16秒"]]), "色は周期"),
      roughwv: wave("roughwv", lg(JW, [["rough", "多方向から波が来る海域"]]), ""),
      curwv: wave("curwv", lg(JW, [["202_000_000", "流れで波が険しくなる海域"]]), ""),
      sst: kai("sst_anl", "surf", ["sst"], TEMP, "℃"),
      sstanom: kai("sst_anl", "surf", ["sstanom"], ANOM, "℃"),
      sstf: kai("sst_fct", "surf", ["sst"], TEMP, "℃"),
      t50: kai("subs_anl", "50", ["temp"], TEMP, "℃"),
      t100: kai("subs_anl", "100", ["temp"], TEMP, "℃"),
      t200: kai("subs_anl", "200", ["temp"], TEMP, "℃"),
      t400: kai("subs_anl", "400", ["temp"], TEMP, "℃"),
      t100f: kai("subs_fct", "100", ["temp"], TEMP, "℃"),
      cur: kai("subs_anl", "50", ["curs", "curd"], CUR, "kt"),
      curf: kai("subs_fct", "50", ["curs", "curd"], CUR, "kt"),
    },
  });
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
      map.attributionControl.addAttribution('波浪図・水温: <a href="https://www.data.jma.go.jp/waveinf/tile/jp/index.html">気象庁</a>／海流: <a href="https://www1.kaiho.mlit.go.jp/KANKYO/KAIYO/qboc/kurosio-num.html">海上保安庁 海洋速報</a>');
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
      curLayer = null;
      const cur = $("currentOn").checked; // 海流は既定で非表示（データは水温の日付連動・クリック時の計算用に読み込んでおく）
      if (cur && $("ghostOn").checked) {
        const gi = issues[idx - Number($("ghostBack").value)];
        if (gi) {
          const gg = await loadGeo(gi);
          if (my !== token) return;
          ghostLayer = drawGeo(gg, true);
        }
      }
      if (cur) curLayer = drawGeo(g, false);
      const m = g.meta || {};
      $("meta").textContent = `${m.issueNo || issue.label}　発行 ${m.issueDate || ""}　解析対象 ${m.analysisDate || ""}`;
      renderAxis(g);
      if ($("imgOn").checked) setImage();
    } catch (e) { toast(e.message); stop(); }
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
    if (clickLayer) map.removeLayer(clickLayer);
    const showCur = $("currentOn").checked && curGeo; // 海流を表示しているときだけ最寄り黒潮までの距離を出す
    const r = showCur ? nearestKuroshio(e.latlng.lat, e.latlng.lng) : null;
    if (showCur && !r) return toast("この号には黒潮の流線がありません");
    clickLayer = L.layerGroup([
      L.circleMarker(e.latlng, { radius: 5, color: "#000", fillOpacity: 1 }),
      ...(r ? [L.polyline([e.latlng, [r.lat, r.lon]], { color: "#000", weight: 1.5, dashArray: "4 4" })] : []),
    ]).addTo(map);
    const msg = [
      r ? `最寄りの黒潮まで 約${r.nm.toFixed(0)}海里（約${(r.nm * 1.852).toFixed(0)}km）・${r.dir}方向` : `北緯${e.latlng.lat.toFixed(2)}度 東経${e.latlng.lng.toFixed(2)}度`,
    ].filter(Boolean).join("／");
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
    // 海保の海流は気象庁の「表層水温・海流・海氷」の図にだけ重ねる
    const inCurGroup = () => $("jwEl").options[$("jwEl").selectedIndex].parentElement.dataset.cur === "1";
    $("jwEl").addEventListener("change", () => { // 別の分類の図に替えたら海保の海流は外す
      if ($("currentOn").checked && !inCurGroup()) { $("currentOn").checked = false; $("currentOn").onchange({ target: $("currentOn") }); }
    });
    $("currentOn").onchange = (e) => {
      if (e.target.checked && !inCurGroup()) { // 重ね先が無いので、海流の図に切り替える
        $("jwEl").value = "cur"; $("jwEl").dispatchEvent(new Event("change")); applyLayout();
      }
      $("currentBody").hidden = !e.target.checked;
      if (!e.target.checked) stop();
      show(idx);
    };
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
      jw.show(); // 既定の表示は気象庁の波浪図
      await show(issues.length - 1);
    } catch (e) { toast(e.message, 10000); }
  })();
})();
