/* present.js - the presentation view of Simulation 2.5.

   Three steps, one idea each: here is the network; add homes and see whose water rises;
   here is where a few sensors would notice it. Every number is read from the published
   SWMM grid (data/growth.js), exactly as index.html reads it, and drawn with the same map
   (growth_3d.js). Nothing is recomputed and no setting is offered that the full model does
   not already have; this page only chooses fewer of them and says them in plain words.

   Fixed choices, so the room sees one story rather than a control panel:
     detection   a rise of 25 mm over the manhole's own normal level (rule r25), with
                 10 to 25 mm shown faintly so the reach of the change is visible
     sensors     the set chosen once across all cases for the best WORST case
     weather     three of the published cases, renamed: Dry, Wet day (Design wet), Storm (Severe)
     growth      10, 30, 80 or 150 homes at one manhole (the 700 stress size is left out) */
"use strict";
window.Present = (function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const R = () => window.GROWTH_RUNS;
  const G = () => window.GROWTH_GEOM;

  const WEATHER = [
    { label: "Dry day", ii: 0 },
    { label: "Wet day", ii: 1 },
    { label: "Storm", ii: 2 }
  ];
  const SIZES = [10, 30, 80, 150];
  const RULE = "r25", FAINT = "r10";

  const st = { step: 1, w: 1, size: 3, site: null, k: 3 };
  const idxOfName = {};

  const nameOf = i => R().chambers[i];
  const mhOf = i => R().manholeIds[i];
  const caseIdx = () => WEATHER[st.w].ii;

  function cellFor(rule) {
    return R().cells.find(c => c.case === caseIdx() && c.add === SIZES[st.size] && c.rule === rule);
  }
  function tipsAt(rule, site) {
    const c = cellFor(rule);
    const row = c && site != null ? c.rows.find(r => r.site === site) : null;
    return row ? row.tip : [];
  }
  // Manholes that growth at `site` newly makes spill, in the current case and size.
  function newSpills(site) {
    const sp = R().spill && R().spill[caseIdx()];
    const hit = sp && site != null ? (sp[String(SIZES[st.size])] || []).find(x => x[0] === site) : null;
    return hit ? hit[1] : [];
  }
  const sensorPlan = () => R().sensors[RULE].worst;            // { order, worst, mean }
  const sensorIdx = () => sensorPlan().order.slice(0, st.k);

  /* ------------------------------------------------------------------ map */
  function paintMap() {
    const state = {};
    let sensors = [];
    if (st.step >= 2 && st.site != null) {
      tipsAt(FAINT, st.site).forEach(i => { state[nameOf(i)] = "rise"; });
      tipsAt(RULE, st.site).forEach(i => { state[nameOf(i)] = "tip"; });
    }
    if (st.step === 3) sensors = sensorIdx().map(nameOf);
    const site = st.step >= 2 && st.site != null ? nameOf(st.site) : null;
    Growth3D.setScenario([]);
    Growth3D.paint(state, site, sensors, null);
    Growth3D.setSpills([], st.step >= 2 ? newSpills(st.site).map(nameOf) : []);
    Growth3D.setPumpRates([]);
    const show = {
      site: st.step >= 2 && st.site != null,
      tip: st.step >= 2, rise: st.step >= 2,
      spill: st.step >= 2 && newSpills(st.site).length > 0,
      sensor: st.step === 3, mh: true
    };
    document.querySelectorAll("#key .row").forEach(r => { r.hidden = !show[r.dataset.k]; });
  }

  /* ---------------------------------------------------------------- panel */
  function seg(id, labels, active) {
    return '<div class="seg" id="' + id + '">' + labels.map((l, i) =>
      '<button aria-pressed="' + (i === active) + '" data-i="' + i + '">' + esc(l) + "</button>").join("") + "</div>";
  }
  function wireSeg(id, fn) {
    document.querySelectorAll("#" + id + " button").forEach(b => { b.onclick = () => fn(+b.dataset.i); });
  }
  const pct = v => Math.round(v * 100) + "%";

  function step1() {
    const g = G();
    return '<h2>This is Walkerville’s sewer, as published</h2>' +
      '<p>Every pipe and manhole here comes from the council’s open data. The program ' +
      '<strong>EPA SWMM</strong> works out how deep the water runs in each one.</p>' +
      '<div class="bigRow">' +
        '<div><div class="big">' + g.nChambers + '</div><small>manholes, each a possible sensor spot</small></div>' +
        '<div><div class="big">' + g.nPipes + '</div><small>pipes</small></div>' +
        '<div><div class="big">' + (g.nHouses || g.baseDwellings).toLocaleString() + '</div><small>homes connected today</small></div>' +
      '</div>' +
      '<p><strong>The question:</strong> new homes add sewage to pipes that already exist. ' +
      'If we can only afford a few sensors, which manholes would notice the extra load?</p>' +
      '<p class="hint">Height is exaggerated so the slope of the land shows. Water flows downhill to the outlet.</p>' +
      '<button class="next" data-go="2">Next: add new homes →</button>';
  }

  function step2() {
    const tips = tipsAt(RULE, st.site), faint = tipsAt(FAINT, st.site).filter(i => !tips.includes(i));
    const spills = newSpills(st.site);
    const where = st.site == null ? "Click any manhole on the map"
      : "New homes connect at <strong>manhole " + esc(mhOf(st.site)) + "</strong>";
    return '<h2>Add new homes and watch the water rise</h2>' +
      '<p>' + where + '. Red manholes are where a sensor would clearly notice the change.</p>' +
      '<div class="ctl"><label>How many new homes</label>' + seg("size", SIZES.map(String), st.size) + '</div>' +
      '<div class="ctl"><label>Weather</label>' + seg("weather", WEATHER.map(w => w.label), st.w) + '</div>' +
      (st.site == null ? '<p class="hint">Click a manhole on the map to choose where the homes connect.</p>' :
      '<div class="bigRow">' +
        '<div><div class="big" style="color:var(--red)">' + tips.length + '</div><small>manholes rise 25 mm or more</small></div>' +
        '<div><div class="big" style="color:var(--violet)">' + faint.length + '</div><small>more rise 10 to 25 mm</small></div>' +
      '</div>' +
      (spills.length ? '<p><strong style="color:var(--magenta)">' + spills.length + ' manhole' + (spills.length > 1 ? "s" : "") +
        ' newly overflow</strong> in this storm because of these homes.</p>' : '') +
      '<p class="hint">The change is biggest close to the new homes and fades downstream, where the big pipes ' +
      'already carry a lot. That is why a sensor on the main trunk sees little.</p>') +
      '<button class="next" data-go="3">Next: where to put sensors →</button>';
  }

  function chart() {
    const P = sensorPlan(), n = P.worst.length, W = 320, H = 130, bw = W / n;
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + (H + 22) + '" role="img" aria-label="Growth noticed by number of sensors">';
    P.worst.forEach((v, i) => {
      const h = Math.max(2, v * H), on = i < st.k;
      s += '<rect x="' + (i * bw + 3) + '" y="' + (H - h) + '" width="' + (bw - 6) + '" height="' + h +
        '" rx="3" fill="' + (on ? "#2ef56b" : "#22314d") + '"/>' +
        '<text x="' + (i * bw + bw / 2) + '" y="' + (H + 15) + '" text-anchor="middle" font-size="11" fill="#6f81a3">' + (i + 1) + '</text>';
    });
    return s + '</svg>';
  }

  function step3() {
    const P = sensorPlan(), k = st.k, idx = sensorIdx();
    let verdict = "";
    if (st.site != null) {
      const tips = tipsAt(RULE, st.site);
      const hit = idx.findIndex(i => tips.includes(i));
      const when = ' (' + SIZES[st.size] + ' homes, ' + WEATHER[st.w].label.toLowerCase() + ')';
      verdict = hit >= 0
        ? '<div class="verdict yes">The homes at manhole ' + esc(mhOf(st.site)) + ' <strong>would be noticed</strong> by sensor ' + (hit + 1) + when + '.</div>'
        : '<div class="verdict no">The homes at manhole ' + esc(mhOf(st.site)) + ' <strong>would not be noticed</strong> by these ' + k + ' sensor' + (k > 1 ? "s" : "") + when + '.</div>';
    }
    return '<h2>A few sensors, in the right places</h2>' +
      '<p>The model tried new homes at <strong>every one of the ' + R().chambers.length + ' manholes</strong>, at four sizes, ' +
      'in every weather case, then picked the manholes that notice the most of it.</p>' +
      '<div class="ctl"><label>Number of sensors: <strong style="color:var(--ink)">' + k + '</strong></label>' +
        '<input type="range" id="k" min="1" max="' + P.order.length + '" value="' + k + '"></div>' +
      '<div class="bigRow">' +
        '<div><div class="big" style="color:var(--green)">' + pct(P.worst[k - 1]) + '</div><small>of new growth noticed, in the worst weather case</small></div>' +
        '<div><div class="big">' + pct(P.mean[k - 1]) + '</div><small>on average across weather cases</small></div>' +
      '</div>' +
      '<p class="chartCap">Growth noticed in the worst weather, by number of sensors</p>' + chart() +
      '<ol class="sensorList">' + idx.map((i, n) => '<li><span class="tag">' + (n + 1) + '</span>Manhole ' + esc(mhOf(i)) + '</li>').join("") + '</ol>' +
      verdict +
      '<p class="hint">Each extra sensor adds less than the one before. Click any manhole to test whether ' +
      'homes there would be noticed. "Noticed" means the water at a sensor rises 25 mm or more.</p>';
  }

  function renderPanel() {
    const html = st.step === 1 ? step1() : st.step === 2 ? step2() : step3();
    $("#panel").innerHTML = html +
      '<p class="caveat">A model built from public data. It has not yet been checked against measured sewer levels, ' +
      'so treat the numbers as a guide to where to look, not a measurement.</p>';
    document.querySelectorAll("[data-go]").forEach(b => { b.onclick = () => go(+b.dataset.go); });
    wireSeg("size", i => { st.size = i; refresh(); });
    wireSeg("weather", i => { st.w = i; refresh(); });
    const k = $("#k");
    if (k) k.oninput = () => { st.k = +k.value; refresh(); };
    document.querySelectorAll(".steps button").forEach(b => {
      b.setAttribute("aria-selected", String(+b.dataset.step === st.step));
    });
  }

  function refresh() { renderPanel(); paintMap(); }
  function go(step) {
    st.step = step;
    if (step >= 2 && st.site == null) st.site = busiestSite();
    refresh();
    Growth3D.frame(null);
  }

  /* The opening site for step 2: the manhole whose growth is seen most widely on a wet day
     at the largest size, so the first thing the room sees is a clear example. */
  function busiestSite() {
    const c = R().cells.find(x => x.case === 1 && x.add === SIZES[3] && x.rule === RULE);
    let best = 0, n = -1;
    (c ? c.rows : []).forEach(r => { if (r.tip.length > n) { n = r.tip.length; best = r.site; } });
    return best;
  }

  function init() {
    R().chambers.forEach((c, i) => { idxOfName[c] = i; });
    document.querySelectorAll(".steps button").forEach(b => { b.onclick = () => go(+b.dataset.step); });
    Growth3D.build($("#stage"), nd => {
      // Clicking a manhole chooses where the homes go; it moves step 1 on to step 2.
      if (!nd || !(nd.name in idxOfName)) return;
      st.site = idxOfName[nd.name];
      if (st.step === 1) st.step = 2;
      refresh();
    }, () => {}).then(() => {
      refresh();
      Growth3D.frame(null);
    });
    window.addEventListener("resize", () => Growth3D.resize($("#stage")));
  }

  return { init };
})();
