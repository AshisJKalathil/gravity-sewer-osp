"""sim26_build.py - build the Sim 2.6 page data from saved results. No SWMM run is needed.

Reads, never writes, the Sim 2.5 grid (results/sim25/grid_whole/*/summary.json) and the
Sim 2.5 page data (simulation25/data/growth.js, for the manhole order the map uses), plus
the new Sim 2.6 runs (results/sim26/scenarios.json, from sim26_scenarios.py). Writes
simulation26/data/sim26.js, and prints the checks it relies on.

What it adds, each declared in simulation26/about.html:
  1. Inputs for the cost-weighted float vs level placement (the optimiser runs in the page,
     so the costs can be changed live): which growth scenarios each manhole would notice
     with a float switch (the fixed 150 mm alarm) or a level sensor (a 25 mm rise).
  2. Infill and greenfield growth, and rain with no growth, per weather case.
  3. A risk score per manhole, severity x likelihood (Kimbrough 2019, FMEA risk priority).
  4. A per-manhole "normal band" detection rule (Rosin et al. 2022): noticed when the rise
     is at least N standard deviations of that manhole's own normal level.

    ~/.venvs/sewer/bin/python simulation_src/sim26/sim26_build.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
ROOT = os.path.dirname(SRC)
if SRC not in sys.path:
    sys.path.insert(0, SRC)
os.chdir(SRC)

import sim25                       # noqa: E402
from sim25 import Case, Sim25Model  # noqa: E402

GRID = os.path.join(SRC, "results", "sim25", "grid_whole")
SCEN = os.path.join(SRC, "results", "sim26", "scenarios.json")
PAGE_DATA = os.path.join(ROOT, "simulation25", "data", "growth.js")
OUT = os.path.join(ROOT, "simulation26", "data", "sim26.js")

# ---- declared settings (every one is listed in about.html) ----
RISE_MM = 25.0          # level sensor: noticed at a 25 mm rise (Sim 2.5's main rule)
BAND_N = 3.0            # Rosin 2022: limit = normal + N x sigma; N = 3 in dry weather
BAND_CV = 0.10          # sigma assumed = 10% of the manhole's normal peak depth (no records yet)
BAND_FLOOR_MM = 5.0     # never below 5 mm, the smallest change a level sensor resolves well
FULL_DD = 0.7           # Kimbrough 2019: share of time at or above 0.7 d/D marks risk
COSTS = {               # AUD over 10 years; ASSUMED, to be replaced with the utility's prices
    "float": {"buy": 400, "install": 500, "yearly": 150,
              "note": "Binary switch. Hofer et al. (2018) list simple in-sewer switch detectors at "
                      "about EUR 200 before data transmission; the rest is assumed."},
    "level": {"buy": 2500, "install": 800, "yearly": 400,
              "note": "Ultrasonic or radar level sensor with telemetry. No price was found in the "
                      "papers read; every figure is assumed."},
    "years": 10,
}
FAIL_RATE = 0.24        # Do et al. (2023): 24% of Stonyfell sensors failed or needed work in year 1


def js_object(path, var):
    t = open(path, encoding="utf-8").read()
    return json.loads(t[t.index("{"):t.rindex("}") + 1])


def main():
    page = js_object(PAGE_DATA, "GROWTH_RUNS")
    mids = [int(m) for m in page["manholeIds"]]
    idx = {m: i for i, m in enumerate(mids)}
    n = len(mids)
    tags = [c["tag"] for c in page["cases"]]
    labels = [c["label"] for c in page["cases"]]
    sums = [json.load(open(os.path.join(GRID, t, "summary.json"), encoding="utf-8")) for t in tags]

    # ------------------------------------------------ 1. float (alarm) vs level (25 mm rise)
    # Per case: the list of growth scenarios (site, size) and, for each, which manholes would
    # notice it with each sensor type. Coverage is scored as Sim 2.5 scores it: over the
    # scenarios that SOME manhole notices, pooled across every growth size.
    det = {"float": [], "level": [], "band": []}
    thresholds = []
    for s in sums:
        base = {int(k): v * 1000 for k, v in s["baseline_depth_m"].items()}
        thr = {m: max(BAND_FLOOR_MM, BAND_N * BAND_CV * base.get(m, 0.0)) for m in mids}
        thresholds.append([round(thr[m], 1) for m in mids])
        fl, lv, bd = [], [], []
        for r in s["rows"]:
            rise = {int(k): v for k, v in r["rise_mm"].items()}
            fl.append(sorted(idx[m] for m in r["alarm"]))
            lv.append(sorted(idx[m] for m, v in rise.items() if v >= RISE_MM))
            bd.append(sorted(idx[m] for m, v in rise.items() if v >= thr[m]))
        det["float"].append(fl)
        det["level"].append(lv)
        det["band"].append(bd)
    rows_key = [[idx[r["site"]], r["dwellings"]] for r in sums[0]["rows"]]
    for s in sums[1:]:
        assert [[idx[r["site"]], r["dwellings"]] for r in s["rows"]] == rows_key, "row order differs"

    def coverage(sets, chosen):
        out = []
        for case in sets:
            live = [t for t in case if t]
            out.append(sum(1 for t in live if chosen & set(t)) / len(live))
        return out

    # Check: Sim 2.5's published level-sensor order must score what Sim 2.5 published.
    order = page["sensors"]["r25"]["worst"]["order"]
    pub = page["sensors"]["r25"]["worst"]["worst"]
    mine = [round(min(coverage(det["level"], set(order[:k]))), 4) for k in range(1, len(order) + 1)]
    assert mine == pub, f"coverage does not reproduce Sim 2.5: {mine} vs {pub}"
    print("check 1: Sim 2.5's 25 mm sensor order scores exactly as published:", mine[:6], "...")
    a_order = page["sensors"]["alarm"]["worst"]["order"]
    a_pub = page["sensors"]["alarm"]["worst"]["worst"]
    a_mine = [round(min(coverage(det["float"], set(a_order[:k]))), 4) for k in range(1, len(a_order) + 1)]
    assert a_mine == a_pub, f"alarm coverage does not reproduce Sim 2.5: {a_mine} vs {a_pub}"
    print("check 2: Sim 2.5's alarm sensor order scores exactly as published:", a_mine[:6], "...")

    # Normal-band rule: greedy worst case, for the comparison quoted on the about page.
    def greedy(sets, k=10):
        chosen, order_, worst, mean = set(), [], [], []
        for _ in range(k):
            best = max((m for m in range(n) if m not in chosen),
                       key=lambda m: (min(c := coverage(sets, chosen | {m})), sum(c) / len(c)))
            chosen.add(best)
            order_.append(best)
            c = coverage(sets, chosen)
            worst.append(round(min(c), 4))
            mean.append(round(sum(c) / len(c), 4))
        return {"order": order_, "worst": worst, "mean": mean}
    band_plan = greedy(det["band"])
    band_on_fixed = [round(min(coverage(det["band"], set(order[:k]))), 4) for k in range(1, 11)]
    print("normal band, its own greedy, worst case 1..10:", band_plan["worst"])
    print("normal band, scoring the fixed-25 mm sensors:  ", band_on_fixed)

    # ------------------------------------------------ 3. risk: severity x likelihood
    m = Sim25Model(Case(ii=0.11), whole=True)
    net = m.net
    nid_of = {m.nodes[c].manhole_id: m.chambers[c] for c in m.chambers}
    dia = {}
    for mh, nid in nid_of.items():
        outs = net.nodes[nid].outs
        dia[mh] = min(net.pipes[p].dia for p in outs) if outs else max(net.pipes[p].dia for p in net.nodes[nid].ins)
    homes_up = {mh: net.dwellings_upstream(nid) for mh, nid in nid_of.items()}
    dd = []          # per case, per manhole: peak depth / pipe diameter before growth
    for s in sums:
        base = {int(k): v for k, v in s["baseline_depth_m"].items()}
        dd.append([round(base.get(mh, 0.0) / dia[mh], 3) for mh in mids])
    like = [sum(1 for c in range(len(sums)) if dd[c][i] >= FULL_DD) / len(sums) for i in range(n)]
    order_h = sorted(range(n), key=lambda i: homes_up[mids[i]])
    rank = {i: r for r, i in enumerate(order_h)}
    sev = [round(1 + 9 * rank[i] / (n - 1), 2) for i in range(n)]
    occ = [round(1 + 9 * like[i], 2) for i in range(n)]
    rpn = [round(sev[i] * occ[i], 1) for i in range(n)]

    # A sensor watches its own manhole and the nearest manhole one step up or down the pipes.
    chamber_nids = set(nid_of.values())
    mh_of_nid = {v: k for k, v in nid_of.items()}

    def neighbours(nid):
        found = set()
        for direction in ("up", "down"):
            stack, seen = [nid], {nid}
            while stack:
                v = stack.pop()
                links = net.nodes[v].ins if direction == "up" else net.nodes[v].outs
                for p in links:
                    w = net.pipes[p].up if direction == "up" else net.pipes[p].down
                    if w in seen:
                        continue
                    seen.add(w)
                    if w in chamber_nids:
                        found.add(w)
                    elif w in net.nodes:
                        stack.append(w)
        return found
    watch = [sorted(idx[mh_of_nid[w]] for w in neighbours(nid_of[mh]) if mh_of_nid[w] in idx)
             for mh in mids]

    # ------------------------------------------------ 2. infill / greenfield / rain only
    scen = None
    if os.path.exists(SCEN):
        sc = json.load(open(SCEN, encoding="utf-8"))
        base_by_ii = {b["ii"]: b for b in sc["baseline"]}

        def ix(lst):
            return sorted(idx[int(x)] for x in lst if int(x) in idx)
        runs = []
        for r in sc["runs"]:
            rise = {int(k): v for k, v in r["rise_mm"].items()}
            runs.append({"ii": r["ii"], "kind": r["kind"], "n": r["dwellings"],
                         "lps": r["added_lps"],
                         "t25": sorted(idx[mh] for mh, v in rise.items() if v >= 25 and mh in idx),
                         "t10": sorted(idx[mh] for mh, v in rise.items() if 10 <= v < 25 and mh in idx),
                         "alarm": ix(r["alarm"]), "sur": ix(r["surcharge"]), "spill": ix(r["spilled"]),
                         "maxRise": round(max(rise.values()), 1) if rise else 0.0,
                         "rise": {str(idx[mh]): round(v, 1) for mh, v in rise.items() if mh in idx}})
        dry = base_by_ii[0.0]["depth_mm"]
        rain = []
        for b in sc["baseline"]:
            rr = {int(k): v - dry.get(k, 0.0) for k, v in b["depth_mm"].items()}
            rain.append({"ii": b["ii"], "label": b["label"],
                         "t25": sorted(idx[mh] for mh, v in rr.items() if v >= 25 and mh in idx),
                         "t10": sorted(idx[mh] for mh, v in rr.items() if 10 <= v < 25 and mh in idx),
                         "sur": ix(b["surcharged"]), "spill": ix(b["spilled"]), "alarm": ix(b["alarm"]),
                         "rise": {str(idx[mh]): round(v, 1) for mh, v in rr.items() if v >= 1 and mh in idx}})
        corner_nodes = set(net.upstream_pipes(sim25.SEGMENT_OUTLET))
        corner_nids = {net.pipes[i].up for i in corner_nodes} | {sim25.SEGMENT_OUTLET}
        corner = sorted(idx[mh] for mh, nid in nid_of.items() if nid in corner_nids and mh in idx)
        scen = {"check": sc["check"], "corner": sc["corner"], "cornerIdx": corner,
                "greenfieldIdx": idx.get(int(sc["corner"]["greenfield_manhole"])),
                "sizes": sc["sizes"], "runs": runs, "rain": rain}
        print("check 3: the re-run of a published Sim 2.5 run differed by",
              sc["check"]["largest_difference_mm"], "mm")
    else:
        print("note: results/sim26/scenarios.json not found yet; infill and greenfield left out")

    def packed(lists):
        return lists     # plain lists; the page reads them directly

    out = {
        "version": "Sim 2.6",
        "cases": [{"label": l, "tag": t} for l, t in zip(labels, tags)],
        "scenarios": [[i, s] for i, s in rows_key],
        "det": {k: [packed(v) for v in det[k]] for k in ("float", "level", "band")},
        "band": {"n": BAND_N, "cv": BAND_CV, "floorMm": BAND_FLOOR_MM, "thresholdMm": thresholds,
                 "plan": band_plan, "fixedSensorsOnBand": band_on_fixed},
        "risk": {"sev": sev, "occ": occ, "rpn": rpn, "dd": dd, "homesUp": [homes_up[mh] for mh in mids],
                 "pipeDiaMm": [round(dia[mh] * 1000) for mh in mids], "watch": watch, "fullDD": FULL_DD},
        "costs": COSTS, "failRate": FAIL_RATE, "riseMm": RISE_MM,
        "checks": {"levelOrderWorst": mine, "alarmOrderWorst": a_mine},
        "growth": scen,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    body = json.dumps(out, separators=(",", ":"))
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("// Generated by simulation_src/sim26/sim26_build.py - do not edit by hand.\n")
        f.write("window.SIM26 = " + body + ";\n")
    print(f"wrote {os.path.relpath(OUT, ROOT)} ({len(body) / 1e6:.2f} MB)")
    top = sorted(range(n), key=lambda i: -rpn[i])[:8]
    print("highest risk manholes:", [(mids[i], rpn[i], homes_up[mids[i]], [dd[c][i] for c in range(len(sums))]) for i in top])


if __name__ == "__main__":
    main()
