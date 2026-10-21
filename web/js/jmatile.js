// 気象庁の画像タイル（波浪図・水温図・海流図）を、時刻スライダー・再生付きで地図に重ねるビューア
// 使い方: JmaTileViewer(map, { prefix: "jw", pane: "jwave", zIndex: 258, elements, onLabel, toast })
//   画面側のid: {prefix}El / Prev / Next / Slider / Play / Now / Opacity / Legend / Meta（{prefix}On のチェックは任意。無ければ常に表示）
//   elements: { 要素キー: { ds, depth, ids[], minZoom, maxZoom, hour(時刻まで表示するか), legend, unit } }
window.JmaTileViewer = (map, o) => {
  const p = o.prefix, $ = (s) => document.getElementById(p + s);
  const WEEK = "日月火水木金土";
  // 14桁UTC(yyyyMMddHHmmss) → 日本時間の表示（hour=true なら時まで）
  const fmt = (t, hour) => {
    const d = new Date(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10)) + 9 * 3600e3);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]})` + (hour ? ` ${String(d.getUTCHours()).padStart(2, "0")}時` : "");
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timesCache = {}; // データセット → 時刻一覧
  const frames = new Map(); // 「要素/基準/対象」→ タイルレイヤーの配列（全コマを透明で重ね、表示は不透明度の切り替えだけ）
  let times = null, curDs = null, idx = 0, playing = false, token = 0;
  map.createPane(o.pane).style.zIndex = o.zIndex;
  const el = () => o.elements[$("El").value];
  const isOn = () => !$("On") || $("On").checked; // 表示のオン/オフのチェックは任意（メインの図は常に表示）

  // 「現在」= 解析値（基準時刻=対象時刻）のうち最新。なければ先頭（予想のみの一覧）
  const nowIdx = () => Math.max(0, times.reduce((m, t, k) => (t.basetime === t.validtime ? k : m), 0));

  function frameLayers(t) {
    const e = el(), key = `${$("El").value}/${t.basetime}/${t.validtime}`;
    if (!frames.has(key)) {
      frames.set(key, e.ids.map((id) => L.tileLayer(
        `/api/jmatile/${e.ds}/${t.basetime}/${t.validtime}/${e.depth}/${id}/{z}/{x}/{y}.png`,
        { pane: o.pane, minZoom: e.minZoom, maxZoom: 12, maxNativeZoom: e.maxZoom, opacity: 0, keepBuffer: 1 }).addTo(map)));
    }
    return frames.get(key);
  }

  function clear() {
    for (const ls of frames.values()) ls.forEach((l) => map.removeLayer(l));
    frames.clear();
  }

  // タイルの読み込み完了を待つ（15秒で打ち切り）
  const loaded = (ls) => Promise.all(ls.map((l) => new Promise((res) => {
    if (!l._loading) return res();
    const h = setTimeout(res, 15000);
    l.once("load", () => { clearTimeout(h); res(); });
  })));

  function renderLegend() {
    const e = el();
    $("Legend").innerHTML = e.legend.map(([img, v]) => `<span><img src="${img}" alt="">${v}</span>`).join("") +
      (e.unit ? `<span class="unit">単位: ${e.unit}</span>` : "");
  }

  // 時刻一覧は要素のデータセットごとに取得する（要素が変わって別データセットになったら取り直す）
  async function ensureTimes() {
    const ds = el().ds;
    if (times && curDs === ds) return;
    if (!timesCache[ds]) {
      const r = await fetch(`/api/jmatile/times/${ds}`);
      if (!r.ok) throw new Error("気象庁の図の時刻一覧の取得に失敗しました");
      timesCache[ds] = (await r.json()).sort((a, b) => a.validtime.localeCompare(b.validtime));
    }
    times = timesCache[ds]; curDs = ds;
    $("Slider").max = times.length - 1;
    idx = nowIdx();
  }

  async function show(i) {
    if (!isOn()) return;
    const my = ++token;
    try {
      await ensureTimes();
      if (i !== undefined) idx = Math.max(0, Math.min(times.length - 1, i));
      $("Slider").value = idx;
      const t = times[idx], e = el(), cur = frameLayers(t);
      await loaded(cur); // 読み込み済みなら即座に切り替わる（前のコマは読み込み完了まで残す）
      if (my !== token) return;
      const op = Number($("Opacity").value);
      for (const ls of frames.values()) ls.forEach((l) => l.setOpacity(ls === cur ? op : 0));
      const fc = t.basetime !== t.validtime;
      const kind = fc ? `予想（${fmt(t.basetime, e.hour)}の解析に基づく）` : "実況（解析）";
      $("Meta").textContent = `${fmt(t.validtime, e.hour)}　${kind}　気象庁`;
      o.onLabel(p, { big: fmt(t.validtime, e.hour), kind: fc ? "予想" : "実況", name: $("El").selectedOptions[0].textContent });
    } catch (err) { o.toast(err.message); }
  }

  function stop() { playing = false; $("Play").textContent = "▶ 再生"; }

  async function play() {
    if (playing) return stop();
    if (!isOn()) return;
    try { await ensureTimes(); } catch (err) { return o.toast(err.message); }
    playing = true; $("Play").textContent = "■ 停止";
    let i = idx >= times.length - 1 ? 0 : idx; // 最後のコマなら先頭から
    // 開始コマと先の数コマを先読みしてから再生する（コマ数が多い予想でも通信しすぎない）
    const AHEAD = 4;
    const pre = times.slice(i, i + AHEAD + 1);
    let n = 0;
    $("Meta").textContent = `読み込み中… 0/${pre.length}`;
    await Promise.all(pre.map((t) => loaded(frameLayers(t)).then(() => { $("Meta").textContent = `読み込み中… ${++n}/${pre.length}`; })));
    while (playing) {
      await show(i);
      if (!playing || i >= times.length - 1) break;
      i++;
      times.slice(i + 1, i + 1 + AHEAD).forEach(frameLayers); // 先のコマの読み込みを始めておく
      await sleep(700);
    }
    stop();
  }

  if ($("On")) {
    $("On").onchange = (e) => {
      if (e.target.checked) { renderLegend(); show(); } else { stop(); token++; clear(); o.onLabel(p, null); }
    };
  }
  $("El").onchange = () => { stop(); clear(); times = null; renderLegend(); show(); };
  $("Slider").oninput = (e) => { stop(); show(Number(e.target.value)); };
  $("Prev").onclick = () => { stop(); show(idx - 1); };
  $("Next").onclick = () => { stop(); show(idx + 1); };
  $("Now").onclick = () => { stop(); if (times) show(nowIdx()); };
  $("Play").onclick = play;
  $("Opacity").oninput = () => { if (times) show(idx); };

  renderLegend();
  return { show, isOn };
};
