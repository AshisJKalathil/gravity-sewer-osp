/* sim26.js - Sim 2.6, the presentation view with four additions.

   Four steps. 1 the network. 2 what growth (one spot, infill, greenfield) or rain alone does
   to water levels. 3 where sensors go, for growth, for risk, or both, and under which
   detection rule. 4 what a sensor plan costs, floats against level sensors.

   Data: Sim 2.5's published SWMM grid (GROWTH_RUNS, ../simulation25/data/growth.js) and the
   Sim 2.6 build (SIM26, data/sim26.js: the infill and greenfield runs, the risk score, the
   per-manhole rule and the cost inputs). Both index manholes in the same order. Nothing here
   re-solves the hydraulics: every depth is SWMM's, read from those files.

   Coverage is scored exactly as Sim 2.5 scores it: the share of growth scenarios (every site
   and size) that at least one chosen sensor notices, among those that some manhole notices,
   per weather case; "worst" is the lowest case, "average" the mean of the five. */
"use strict";
window.Sim26 = (function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const R = () => window.GROWTH_RUNS;
  const S = () => window.SIM26;
  const G = () => window.GROWTH_GEOM;
  const pct = v => Math.round(v * 100) + "%";
  const money = v => "$" + Math.round(v).toLocaleString();

  const WEATHER = [{ label: "Dry day", c: 0, ii: 0 }, { label: "Wet day", c: 1, ii: 0.11 }, { label: "Storm", c: 2, ii: 0.4 }];
  const KINDS = [
    { id: "one", label: "One spot", sizes: [10, 30, 80, 150] },
    { id: "infill", label: "Infill", sizes: [50, 150, 300] },
    { id: "greenfield", label: "Greenfield", sizes: [50, 150, 300] },
    { id: "rain", label: "Rain only", sizes: [] }
  ];
  const PLANS = [{ id: "growth", label: "Catch new growth" }, { id: "risk", label: "Watch risky spots" }, { id: "both", label: "Both" }];
  const RULES = [{ id: "fixed", label: "Fixed 25 mm rise" }, { id: "band", label: "Each manhole's normal band" }];

  const st = { step: 1, kind: 0, size: [3, 1, 1, 0], w: 1, site: null, plan: 0, rule: 0, k: 3,
               cost: null, budget: 40000 };
  const idxOfName = {};
  const nameOf = i => R().chambers[i];
  const mhOf = i => R().manholeIds[i];
  const W = () => WEATHER[st.w];
  const K = () => KINDS[st.kind];
  const size = () => K().sizes[st.size[st.kind]];

  /* ------------------------------------------------------- step 2: the scenario */
  function cell(rule) {
    return R().cells.find(c => c.case === W().c && c.add === size() && c.rule === rule);
  }
  function tipsOne(rule) {
    const c = cell(rule), row = c && st.site != null ? c.rows.find(r => r.site === st.site) : null;
    return row ? row.tip : [];
  }
  function run() {
    const g = S().growth;
    return g ? g.runs.find(r => r.ii === W().ii && r.kind === K().id && r.n === size()) : null;
  }
  /* What the current scenario does: rises (>= 25 mm, 10 to 25 mm), manholes full before the
     change, manholes overflowing before it and newly overflowing because of it. */
  function scenario() {
    const k = K().id, c = W().c, out = { t25: [], t10: [], was: R().baseSurcharged[c] || [],
      spillBefore: R().baseSpilled[c] || [], spillNew: [], site: null, label: "", rise: null };
    if (k === "one") {
      if (st.site == null) return out;
      const t25 = tipsOne("r25");
      out.t25 = t25;
      out.t10 = tipsOne("r10").filter(i => !t25.includes(i));
      const sp = R().spill && R().spill[c] ? (R().spill[c][String(size())] || []).find(x => x[0] === st.site) : null;
      out.spillNew = sp ? sp[1] : [];
      out.site = st.site;
    } else if (k === "rain") {
      const r = S().growth.rain[st.w];
      out.t25 = r.t25; out.t10 = r.t10; out.was = r.sur; out.spillBefore = r.spill; out.rise = r.rise;
    } else {
      const r = run();
      if (r) {
        out.t25 = r.t25; out.t10 = r.t10; out.spillNew = r.spill; out.rise = r.rise;
        out.maxRise = r.maxRise;
        if (k === "greenfield") out.site = S().growth.greenfieldIdx;
      }
    }
    return out;
  }

  /* ------------------------------------------------------- detection and coverage */
  /* For each detection rule and case: the scenarios some manhole notices ("live"), and for
     each manhole the live scenarios it notices. Built once. */
  const cover = {};
  function coverFor(rule) {
    if (cover[rule]) return cover[rule];
    const n = R().chambers.length;
    cover[rule] = S().det[rule].map(sets => {
      const live = [], by = Array.from({ length: n }, () => []);
      sets.forEach(t => { if (t.length) { const j = live.length; live.push(t); t.forEach(m => by[m].push(j)); } });
      return { L: live.length, by };
    });
    return cover[rule];
  }
  // Coverage of a set of {m, rule} picks: per case, the share of live scenarios noticed.
  // With pWork < 1 each scenario counts the chance that at least one noticing sensor works.
  function scoreMixed(picks, pWork) {
    const cases = S().det.level.length, res = [];
    for (let c = 0; c < cases; c++) {
      // Live means noticed by SOME manhole under the level rule, the yardstick for every mix.
      const base = coverFor(picks.ruleFor || "level")[c];
      const hits = new Uint8Array(base.L);
      picks.forEach(p => {
        const cv = coverFor(p.rule)[c];
        if (p.rule === (picks.ruleFor || "level")) cv.by[p.m].forEach(j => { hits[j]++; });
        else {
          // A float's live set is its own; map it onto the yardstick by scenario identity.
          const map = idMap(p.rule, picks.ruleFor || "level", c);
          cv.by[p.m].forEach(j => { const t = map[j]; if (t >= 0) hits[t]++; });
        }
      });
      let s = 0;
      for (let j = 0; j < base.L; j++) s += pWork == null ? (hits[j] ? 1 : 0) : 1 - Math.pow(1 - pWork, hits[j]);
      res.push(s / base.L);
    }
    return { worst: Math.min(...res), mean: res.reduce((a, b) => a + b, 0) / res.length, per: res };
  }
  const _maps = {};
  function idMap(from, to, c) {
    const key = from + ">" + to + c;
    if (_maps[key]) return _maps[key];
    const a = S().det[from][c], b = S().det[to][c], fromLive = [], toLive = new Int32Array(a.length).fill(-1);
    let jb = 0;
    b.forEach((t, j) => { if (t.length) toLive[j] = jb++; });
    a.forEach((t, j) => { if (t.length) fromLive.push(toLive[j]); });
    return (_maps[key] = fromLive);
  }
  const score = (ms, rule, pWork) => {
    const picks = ms.map(m => ({ m, rule }));
    picks.ruleFor = rule;
    return scoreMixed(picks, pWork);
  };

  /* Risk: severity x likelihood per manhole (sim26_build.py). A sensor watches its manhole
     and the nearest manhole one step up and down the pipes. */
  function riskShare(ms) {
    const r = S().risk, seen = new Set();
    ms.forEach(m => { seen.add(m); r.watch[m].forEach(x => seen.add(x)); });
    let s = 0;
    seen.forEach(m => { s += r.rpn[m]; });
    return s / r.rpn.reduce((a, b) => a + b, 0);
  }

  const _plans = {};
  function planOrder(plan, rule) {
    const key = plan + "|" + rule;
    if (_plans[key]) return _plans[key];
    const n = R().chambers.length, K10 = 10;
    if (plan === "growth") {
      _plans[key] = rule === "fixed" ? R().sensors.r25.worst.order.slice() : S().band.plan.order.slice();
      return _plans[key];
    }
    const det = rule === "fixed" ? "level" : "band";
    const chosen = [];
    for (let k = 0; k < K10; k++) {
      let best = -1, bestV = -1, bestT = -1;
      for (let m = 0; m < n; m++) {
        if (chosen.includes(m)) continue;
        const set = chosen.concat([m]);
        const rs = riskShare(set);
        let v, t;
        if (plan === "risk") { v = rs; t = 0; }
        else { const sc = score(set, det); v = 0.5 * sc.worst + 0.5 * rs; t = sc.mean; }
        if (v > bestV + 1e-12 || (Math.abs(v - bestV) <= 1e-12 && t > bestT)) { best = m; bestV = v; bestT = t; }
      }
      chosen.push(best);
    }
    return (_plans[key] = chosen);
  }

  // Straight-line distance between manholes, from the map coordinates (decimetres).
  const byName = {};
  function distM(a, b) {
    const p = byName[nameOf(a)], q = byName[nameOf(b)];
    return p && q ? Math.hypot(p.x - q.x, p.y - q.y) / 10 : NaN;
  }

  /* ------------------------------------------------------- step 4: cost */
  function costOf(type) {
    const c = st.cost, y = c.years;
    return c[type].buy + c[type].install + c[type].yearly * y;
  }
  /* Greedy by gain in average coverage per dollar, at most one sensor per manhole, until
     nothing adds coverage or the spend passes the chart's top. "types" picks the strategy. */
  function costCurve(types, rule) {
    const n = R().chambers.length, picks = [], steps = [{ cost: 0, worst: 0, mean: 0, picks: [] }];
    const used = new Set(), maxSpend = 160000;
    let spent = 0, cur = { worst: 0, mean: 0 };
    const lvl = rule === "fixed" ? "level" : "band";
    for (let it = 0; it < 40 && spent < maxSpend; it++) {
      let best = null;
      for (const type of types) {
        const cost = costOf(type), r = type === "float" ? "float" : lvl;
        for (let m = 0; m < n; m++) {
          if (used.has(m)) continue;
          const trial = picks.concat([{ m, rule: r, type }]);
          trial.ruleFor = lvl;
          const sc = scoreMixed(trial);
          const gain = (sc.mean - cur.mean) + 0.25 * (sc.worst - cur.worst);
          if (gain <= 1e-9) continue;
          const ratio = gain / cost;
          if (!best || ratio > best.ratio) best = { m, rule: r, type, cost, sc, ratio };
        }
      }
      if (!best) break;
      picks.push({ m: best.m, rule: best.rule, type: best.type });
      used.add(best.m);
      spent += best.cost;
      cur = best.sc;
      steps.push({ cost: spent, worst: cur.worst, mean: cur.mean, picks: picks.slice() });
    }
    return steps;
  }
  let _curves = null, _curveKey = "";
  function curves() {
    const key = JSON.stringify(st.cost) + st.rule;
    if (_curves && key === _curveKey) return _curves;
    const rule = RULES[st.rule].id;
    _curves = { level: costCurve(["level"], rule), float: costCurve(["float"], rule), mixed: costCurve(["level", "float"], rule) };
    _curveKey = key;
    return _curves;
  }
  const atBudget = (steps, b) => steps.filter(s => s.cost <= b).pop();

  /* ------------------------------------------------------------------ map */
  let lastSensors = [];
  function paintMap() {
    const state = {}, sc = st.step >= 2 ? scenario() : null;
    if (sc) {
      sc.was.forEach(i => { state[nameOf(i)] = "was"; });
      sc.t10.forEach(i => { state[nameOf(i)] = "rise"; });
      sc.t25.forEach(i => { state[nameOf(i)] = "tip"; });
    }
    let sensors = [];
    if (st.step === 3) sensors = currentSensors().map(nameOf);
    if (st.step === 4) sensors = budgetPicks().map(p => nameOf(p.m));
    lastSensors = sensors;
    const site = sc && sc.site != null ? nameOf(sc.site) : null;
    document.body.classList.toggle("nosite", !site);
    Growth3D.setScenario([]);
    Growth3D.paint(state, site, sensors, null);
    Growth3D.setSpills(sc ? sc.spillBefore.map(nameOf) : [], sc ? sc.spillNew.map(nameOf) : []);
    Growth3D.setPumpRates([]);
    Growth3D.showPumps(st.step === 1);
    const show = { site: !!site, tip: !!sc, rise: !!sc, was: !!sc && sc.was.length > 0,
      spill: !!sc && (sc.spillBefore.length + sc.spillNew.length) > 0, sensor: sensors.length > 0, mh: true };
    document.querySelectorAll("#key .row").forEach(r => { r.hidden = !show[r.dataset.k]; });
    const was = document.querySelector('#key .row[data-k="was"]');
    if (was) was.lastChild.textContent = K().id === "rain" ? "Full in this weather" : "Already full before the change";
  }

  /* ---------------------------------------------------------------- panel */
  function seg(id, labels, active) {
    return '<div class="seg" id="' + id + '">' + labels.map((l, i) =>
      '<button aria-pressed="' + (i === active) + '" data-i="' + i + '">' + esc(l) + "</button>").join("") + "</div>";
  }
  function wireSeg(id, fn) {
    document.querySelectorAll("#" + id + " button").forEach(b => { b.onclick = () => fn(+b.dataset.i); });
  }
  const big = (v, label, color) => '<div><div class="big s"' + (color ? ' style="color:' + color + '"' : "") + ">" + v + "</div><small>" + label + "</small></div>";

  function step1() {
    const g = G();
    return '<h2>Walkerville’s sewer, as published</h2>' +
      '<p>Every pipe and manhole comes from the council’s open data. <strong>EPA SWMM</strong> works out how deep the water runs in each one.</p>' +
      '<div class="bigRow">' + big(g.nChambers, "manholes, each a possible sensor spot") + big(g.nPipes, "pipes") +
      big((g.nHouses || g.baseDwellings).toLocaleString(), "homes connected today") + '</div>' +
      '<p>The gold lines are the two <strong>pump stations</strong> and their rising mains.</p>' +
      '<div class="note"><strong>A point-in-time test.</strong> New homes take three to four years to arrive, and the network may be upgraded meanwhile. ' +
      'Every result here assumes the network stays exactly as it is today.</div>' +
      '<button class="next" data-go="2">Next: growth and rain →</button>';
  }

  function step2() {
    const k = K(), sc = scenario(), c = W().c;
    const sizes = k.sizes.length ? '<div class="ctl"><label>New homes</label>' + seg("size", k.sizes.map(String), st.size[st.kind]) + '</div>' : "";
    let what = "";
    if (k.id === "one") what = st.site == null ? "Click a manhole to place the new homes."
      : "All the new homes connect at <strong>manhole " + esc(mhOf(st.site)) + "</strong>. Click another manhole to move them.";
    if (k.id === "infill") what = "The new homes are <strong>spread across one corner</strong> of Walkerville (157 pipes), a few on each street in proportion to its length, the way infill arrives.";
    if (k.id === "greenfield") what = "The new homes arrive as <strong>one new estate</strong>, connected at the head of the same corner (manhole " +
      esc(S().growth.corner.greenfield_manhole) + "). Walkerville has no empty land, so this tests the method, not a real plan.";
    if (k.id === "rain") what = "<strong>No new homes.</strong> How much higher the water runs than on a dry day, from rain getting into the pipes.";
    const stormNote = W().c === 2 && k.id !== "rain"
      ? '<div class="warn">In a storm the pipes are already full (amber), so new homes add little extra rise there. Watch the overflow count instead.</div>' : "";
    const nums = (k.id === "rain" && W().c === 0) ? '<p class="hint">Pick Wet day or Storm to see what rain does.</p>' :
      '<div class="bigRow four">' +
        big(sc.t25.length, k.id === "rain" ? "rise 25 mm or more" : "rise 25 mm or more", "var(--red)") +
        big(sc.t10.length, "rise 10 to 25 mm", "var(--violet)") +
        big(sc.was.length, k.id === "rain" ? "full in this weather" : "already full before", "var(--amber)") +
        big(sc.spillBefore.length + " + " + sc.spillNew.length, "overflowing: before + new", "var(--magenta)") +
      '</div>';
    return '<h2>What growth or rain does to the water</h2>' +
      '<div class="ctl"><label>Scenario</label>' + seg("kind", KINDS.map(x => x.label), st.kind) + '</div>' + sizes +
      '<div class="ctl"><label>Weather</label>' + seg("weather", WEATHER.map(x => x.label), st.w) + '</div>' +
      '<p>' + what + '</p>' + nums + stormNote +
      (sc.maxRise ? '<p class="hint">Largest rise anywhere: ' + sc.maxRise + ' mm.</p>' : "") +
      '<button class="next" data-go="3">Next: where to put sensors →</button>';
  }

  function currentSensors() { return planOrder(PLANS[st.plan].id, RULES[st.rule].id).slice(0, st.k); }

  // Which proposed sensor notices the current step-2 scenario, under the current rule.
  function noticedBy(ms) {
    const sc = scenario(), rule = RULES[st.rule].id, c = W().c;
    if (K().id === "one" && st.site == null) return null;
    let seen;
    if (rule === "fixed") seen = new Set(sc.t25);
    else if (K().id === "one") {
      const j = S().scenarios.findIndex(s => s[0] === st.site && s[1] === size());
      seen = new Set(j >= 0 ? S().det.band[c][j] : []);
    } else {
      const thr = S().band.thresholdMm[c];
      seen = new Set(Object.entries(sc.rise || {}).filter(([m, v]) => v >= thr[+m]).map(([m]) => +m));
    }
    return ms.findIndex(m => seen.has(m));
  }
  function describeScenario() {
    const k = K();
    if (k.id === "rain") return "rain alone, " + W().label.toLowerCase();
    return size() + " homes, " + k.label.toLowerCase() + ", " + W().label.toLowerCase();
  }

  function chart(vals, k) {
    const n = vals.length, Wd = 320, H = 110, bw = Wd / n;
    let s = '<svg class="chart" viewBox="0 0 ' + Wd + " " + (H + 20) + '">';
    vals.forEach((v, i) => {
      const h = Math.max(2, v * H);
      s += '<rect x="' + (i * bw + 3) + '" y="' + (H - h) + '" width="' + (bw - 6) + '" height="' + h + '" rx="3" fill="' +
        (i < k ? "#2ef56b" : "#22314d") + '"/><text x="' + (i * bw + bw / 2) + '" y="' + (H + 14) +
        '" text-anchor="middle" font-size="11" fill="#6f81a3">' + (i + 1) + "</text>";
    });
    return s + "</svg>";
  }

  function step3() {
    const plan = PLANS[st.plan].id, rule = RULES[st.rule].id, det = rule === "fixed" ? "level" : "band";
    const order = planOrder(plan, rule), ms = order.slice(0, st.k);
    const sc = score(ms, det), scF = score(ms, det, 1 - S().failRate), rs = riskShare(ms);
    const curve = order.map((_, i) => score(order.slice(0, i + 1), det).worst);
    const hit = noticedBy(ms);
    const verdict = hit == null ? "" : hit >= 0
      ? '<div class="verdict yes">This scenario (' + describeScenario() + ') <strong>is noticed</strong> by sensor ' + (hit + 1) + '.</div>'
      : '<div class="verdict no">This scenario (' + describeScenario() + ') <strong>is not noticed</strong> by these sensors.</div>';
    const list = ms.map((m, i) => {
      const others = ms.filter(x => x !== m), d = others.length ? Math.min(...others.map(x => distM(m, x))) : NaN;
      return '<li><span class="tag">' + (i + 1) + '</span>Manhole ' + esc(mhOf(m)) +
        (isFinite(d) ? ' <small>· nearest other sensor ' + Math.round(d) + ' m</small>' : "") + "</li>";
    }).join("");
    const ruleNote = rule === "band"
      ? '<div class="warn">Each manhole is judged against its own normal level plus 3 times its usual day-to-day wobble, assumed here to be 10% of its normal depth. Busy trunk pipes wobble more, so they need a bigger rise. Real level records would replace the 10%.</div>' : "";
    const planNote = { growth: "Chosen to notice the most new growth, wherever it lands.",
      risk: "Chosen to watch the manholes with the highest risk: many homes upstream and running more than 70% full.",
      both: "Half new growth, half risky spots." }[plan];
    return '<h2>Where to put the sensors</h2>' +
      '<div class="ctl"><label>Goal</label>' + seg("plan", PLANS.map(p => p.label), st.plan) + '</div>' +
      '<div class="ctl"><label>When does a sensor notice?</label>' + seg("rule", RULES.map(r => r.label), st.rule) + '</div>' +
      '<p class="hint">' + planNote + '</p>' + ruleNote +
      '<div class="ctl"><label>Number of sensors: <strong style="color:var(--ink)">' + st.k + '</strong></label>' +
        '<input type="range" id="k" min="1" max="10" value="' + st.k + '"></div>' +
      '<div class="bigRow four">' + big(pct(sc.worst), "growth noticed, worst weather", "var(--green)") +
        big(pct(sc.mean), "growth noticed, average") + big(pct(rs), "of risk watched") +
        big(pct(scF.mean), "average if 1 in 4 sensors is down") + '</div>' +
      '<p class="chartCap">Growth noticed in the worst weather, by number of sensors</p>' + chart(curve, st.k) +
      '<ol class="sensorList">' + list + '</ol>' + verdict +
      '<button class="next" data-go="4">Next: what it costs →</button>';
  }

  function budgetPicks() {
    const s = atBudget(curves().mixed, st.budget);
    return s ? s.picks : [];
  }
  function costChart(cv) {
    const Wd = 320, H = 150, maxC = 160000;
    const x = c => 30 + (c / maxC) * (Wd - 40), y = v => 10 + (1 - v) * (H - 30);
    let s = '<svg class="chart" viewBox="0 0 ' + Wd + " " + H + '">';
    [0, 0.25, 0.5, 0.75, 1].forEach(v => {
      s += '<line x1="30" x2="' + (Wd - 10) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#22314d"/>' +
        '<text x="26" y="' + (y(v) + 4) + '" text-anchor="end" font-size="10" fill="#6f81a3">' + v * 100 + "%</text>";
    });
    [0, 40000, 80000, 120000, 160000].forEach(c => {
      s += '<text x="' + x(c) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="10" fill="#6f81a3">$' + c / 1000 + "k</text>";
    });
    const line = (steps, col) => {
      let d = "";
      steps.forEach((p, i) => {
        const prev = steps[i - 1];
        if (i === 0) d += "M" + x(p.cost) + " " + y(p.mean);
        else d += " H" + x(p.cost) + " V" + y(p.mean);
        if (i === steps.length - 1) d += " H" + x(maxC);
      });
      return '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2"/>';
    };
    s += line(cv.float, "#ffd34d") + line(cv.level, "#38bdf8") + line(cv.mixed, "#2ef56b");
    s += '<line x1="' + x(st.budget) + '" x2="' + x(st.budget) + '" y1="8" y2="' + (H - 18) + '" stroke="#e7edf7" stroke-dasharray="3 3"/>';
    return s + "</svg>";
  }

  function step4() {
    const c = st.cost, cv = curves();
    const row = (t, lab) => '<span>' + lab + '</span>' +
      ["buy", "install", "yearly"].map(f => '').join("") +
      '<input data-t="' + t + '" data-f="buy" type="number" min="0" step="50" value="' + c[t].buy + '">' +
      '<input data-t="' + t + '" data-f="yearly" type="number" min="0" step="10" value="' + c[t].yearly + '">';
    const at = k => atBudget(cv[k], st.budget);
    const mix = at("mixed"), nF = mix.picks.filter(p => p.type === "float").length, nL = mix.picks.length - nF;
    const line = (k, lab, col) => { const s = at(k); return '<li><span class="tag" style="background:' + col + '"></span>' + lab + ": " +
      s.picks.length + " sensors, <strong>" + pct(s.mean) + "</strong> average, " + pct(s.worst) + " worst</li>"; };
    const list = mix.picks.map((p, i) => '<li><span class="tag' + (p.type === "float" ? " f" : "") + '">' + (i + 1) +
      '</span>Manhole ' + esc(mhOf(p.m)) + ' <small>· ' + (p.type === "float" ? "float switch" : "level sensor") + "</small></li>").join("");
    return '<h2>What a sensor plan costs</h2>' +
      '<p>A <strong>float switch</strong> only says "the water passed 150 mm". A <strong>level sensor</strong> reads the level all the time, so it can spot a 25 mm rise. Floats are cheaper but blind where the water is already high.</p>' +
      '<div class="warn"><strong>The prices are placeholders</strong>, not quotes. Change them to the utility’s real prices and the plan re-runs.</div>' +
      '<div class="costGrid"><b></b><b>Buy + install (AUD)</b><b>Per year (AUD)</b>' +
        '<span>Float switch</span><input data-t="float" data-f="cap" type="number" min="0" step="50" value="' + (c.float.buy + c.float.install) + '">' +
        '<input data-t="float" data-f="yearly" type="number" min="0" step="10" value="' + c.float.yearly + '">' +
        '<span>Level sensor</span><input data-t="level" data-f="cap" type="number" min="0" step="50" value="' + (c.level.buy + c.level.install) + '">' +
        '<input data-t="level" data-f="yearly" type="number" min="0" step="10" value="' + c.level.yearly + '">' +
      '</div>' +
      '<p class="hint">Over ' + c.years + ' years: float ' + money(costOf("float")) + ', level ' + money(costOf("level")) + ' each.</p>' +
      '<div class="ctl"><label>Budget over ' + c.years + ' years: <strong style="color:var(--ink)">' + money(st.budget) + '</strong></label>' +
        '<input type="range" id="budget" min="0" max="160000" step="2000" value="' + st.budget + '"></div>' +
      costChart(cv) +
      '<div class="legendLine"><span><i style="background:#2ef56b"></i>Best mix</span><span><i style="background:#38bdf8"></i>Level sensors only</span><span><i style="background:#ffd34d"></i>Floats only</span></div>' +
      '<p class="chartCap">Growth noticed (average of the weather cases) against 10-year spend</p>' +
      '<ul class="sensorList">' + line("mixed", "Best mix", "#2ef56b") + line("level", "Level only", "#38bdf8") + line("float", "Floats only", "#ffd34d") + '</ul>' +
      '<p>At this budget the best mix is <strong>' + nL + ' level sensor' + (nL === 1 ? "" : "s") + ' and ' + nF + ' float' + (nF === 1 ? "" : "s") + '</strong>, shown on the map:</p>' +
      '<ol class="sensorList">' + list + '</ol>';
  }

  function renderPanel() {
    const html = [step1, step2, step3, step4][st.step - 1]();
    $("#panel").innerHTML = html +
      '<p class="caveat">Built from public data and not yet checked against measured sewer levels. Treat the numbers as a guide to where to look first. ' +
      '<a class="inline" href="about.html">Every assumption is listed here.</a></p>';
    document.querySelectorAll("[data-go]").forEach(b => { b.onclick = () => go(+b.dataset.go); });
    wireSeg("kind", i => { st.kind = i; if (KINDS[i].id === "one" && st.site == null) st.site = busiest(); refresh(); });
    wireSeg("size", i => { st.size[st.kind] = i; refresh(); });
    wireSeg("weather", i => { st.w = i; refresh(); });
    wireSeg("plan", i => { st.plan = i; refresh(); });
    wireSeg("rule", i => { st.rule = i; refresh(); });
    const k = $("#k");
    if (k) k.oninput = () => { st.k = +k.value; refresh(); };
    const b = $("#budget");
    if (b) b.oninput = () => { st.budget = +b.value; refresh(); };
    document.querySelectorAll(".costGrid input").forEach(inp => {
      inp.onchange = () => {
        const v = Math.max(0, +inp.value || 0), t = inp.dataset.t;
        if (inp.dataset.f === "cap") { st.cost[t].buy = v; st.cost[t].install = 0; }
        else st.cost[t].yearly = v;
        refresh();
      };
    });
    document.querySelectorAll(".steps button").forEach(x => { x.setAttribute("aria-selected", String(+x.dataset.step === st.step)); });
  }
  function refresh() { renderPanel(); paintMap(); }
  function go(step) { st.step = step; refresh(); Growth3D.frame(null); }

  function busiest() {
    const c = R().cells.find(x => x.case === 1 && x.add === 150 && x.rule === "r25");
    let best = 0, n = -1;
    (c ? c.rows : []).forEach(r => { if (r.tip.length > n) { n = r.tip.length; best = r.site; } });
    return best;
  }

  function init() {
    R().chambers.forEach((c, i) => { idxOfName[c] = i; });
    G().nodes.forEach(nd => { byName[nd.name] = nd; });
    st.cost = JSON.parse(JSON.stringify(S().costs));
    st.site = busiest();
    document.querySelectorAll(".steps button").forEach(b => { b.onclick = () => go(+b.dataset.step); });
    Growth3D.build($("#stage"), nd => {
      if (!nd || !(nd.name in idxOfName)) return;
      st.site = idxOfName[nd.name];
      st.kind = 0;
      if (st.step === 1) st.step = 2;
      refresh();
    }, () => {}).then(() => { refresh(); Growth3D.frame(null); });
    window.addEventListener("resize", () => Growth3D.resize($("#stage")));
  }
  return { init, _debug: { score, planOrder, curves, riskShare, distM, st } };
})();
