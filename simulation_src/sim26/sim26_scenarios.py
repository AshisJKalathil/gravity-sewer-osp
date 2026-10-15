"""sim26_scenarios.py - Sim 2.6: infill and greenfield growth, solved in EPA SWMM.

Simulation 2.5 adds new dwellings at ONE manhole at a time. Real growth does not arrive that
way. This script runs two area-based growth shapes on the same model, with the same cases,
and saves them beside (never over) the Sim 2.5 results:

  infill      N new dwellings spread over one corner of the council area (the 71-manhole
              segment above node 583, Sim 2.5's original study area), shared between its
              pipes in proportion to pipe length, so a long street gets more new homes than a
              short one. Each pipe's share enters at its upstream node, exactly as Sim 2.5
              loads existing homes (L6).
  greenfield  the same N dwellings arriving as one new estate, connected at the head of the
              same corner: the manhole furthest upstream of node 583 along the pipes.

Weather: Dry, Design wet and Severe (I&I 0.0, 0.11 and 0.40 L/s per 100 m), the three
weather cases of config.js case set "five". Sizes: 50, 150 and 300 dwellings.

Nothing in Sim 2.5 is changed. The model, the cases, the loads and the solver are Sim 2.5's
own (sim25.Sim25Model and sim25_grid._whole_task, imported, not copied). Before the new runs
the script repeats one published Sim 2.5 run and stops if it does not match.

    ~/.venvs/sewer/bin/python simulation_src/sim26/sim26_scenarios.py          # about 10 min
    ~/.venvs/sewer/bin/python simulation_src/sim26/sim26_scenarios.py --check  # the check only

Output: simulation_src/results/sim26/scenarios.json
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
if SRC not in sys.path:
    sys.path.insert(0, SRC)
os.chdir(SRC)

import sim25                       # noqa: E402
import sim25_grid                  # noqa: E402
from sim25 import Case, Sim25Model  # noqa: E402

OUT_DIR = os.path.join(SRC, "results", "sim26")
RUN_DIR = os.path.join(OUT_DIR, "tmp")
WEATHER = [(0.0, "Dry"), (0.11, "Design wet"), (0.40, "Severe")]
SIZES = [50, 150, 300]
ALARM_MM = sim25.DETECT_DEPTH_M * 1000.0
# The published run repeated before anything new is trusted: Design wet, +150 at one manhole.
CHECK = {"ii": 0.11, "site": 4449860, "dwellings": 150,
         "summary": os.path.join(SRC, "results", "sim25", "grid_whole",
                                 "ii0.11_flat_uniform_b1_sfree", "summary.json")}


def corner():
    """The infill shares and the greenfield node for the corner above SEGMENT_OUTLET."""
    net = sim25.network()
    seg = net.upstream_pipes(sim25.SEGMENT_OUTLET)
    w = {}
    for i in seg:
        p = net.pipes[i]
        w[p.up] = w.get(p.up, 0.0) + p.length
    tot = sum(w.values())
    share = {nid: v / tot for nid, v in w.items()}

    # Flow distance from each node down to the outlet; the greenfield estate connects at the
    # chamber with the longest one, the head of the corner.
    def dist(nid):
        d, v, seen = 0.0, nid, set()
        while v != sim25.SEGMENT_OUTLET and net.nodes[v].outs and v not in seen:
            seen.add(v)
            p = net.pipes[net.nodes[v].outs[0]]
            d, v = d + p.length, p.down
        return d
    heads = [nid for nid in share if net.nodes[nid].is_chamber]
    head = max(heads, key=dist)
    return share, head, net.nodes[head].manhole_id, len(seg)


def summarise(probe, base, st):
    """Per manhole: rise in mm (>= 1 mm), and which manholes are newly over the alarm,
    newly surcharged and newly spilling, in Sim 2.5's own terms."""
    mh = {c: probe.nodes[c].manhole_id for c in probe.candidates}
    rise = {}
    for c in probe.candidates:
        r = round((st[c]["depth"] - base[c]["depth"]) * 1000, 2)
        if r >= 1.0:
            rise[str(mh[c])] = r
    return {
        "rise_mm": rise,
        "alarm": sorted(mh[c] for c in probe.candidates if sim25_grid.detected(st, base, c, "alarm")),
        "surcharge": sorted(mh[c] for c in probe.candidates if sim25_grid.detected(st, base, c, "surcharge")),
        "spilled": sorted(mh[c] for c in probe.candidates if st[c]["spilled"] and not base[c]["spilled"]),
    }


def check(pool):
    case = Case(ii=CHECK["ii"])
    probe = Sim25Model(case, whole=True)
    t0 = time.time()
    base, grow = pool.map(sim25_grid._whole_task, [
        (case, None, None, os.path.join(RUN_DIR, "chk0")),
        (case, None, {CHECK["site"]: CHECK["dwellings"]}, os.path.join(RUN_DIR, "chk1"))])
    mine = summarise(probe, base[3], grow[3])["rise_mm"]
    with open(CHECK["summary"], encoding="utf-8") as f:
        pub = next(r for r in json.load(f)["rows"]
                   if r["site"] == CHECK["site"] and r["dwellings"] == CHECK["dwellings"])["rise_mm"]
    keys = set(mine) | set(pub)
    worst = max(abs(mine.get(k, 0.0) - pub.get(k, 0.0)) for k in keys)
    same = set(k for k, v in mine.items() if v >= 25) == set(k for k, v in pub.items() if v >= 25)
    print(f"check: Design wet +{CHECK['dwellings']} at MH{CHECK['site']}: {len(mine)} manholes rise "
          f"(published {len(pub)}), largest difference {worst:.2f} mm, 25 mm set identical: {same} "
          f"({time.time() - t0:.0f} s)", flush=True)
    if worst > 0.5 or not same:
        raise SystemExit("The re-run does not reproduce the published Sim 2.5 result; stopping.")
    return worst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="only repeat the published run")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    os.makedirs(RUN_DIR, exist_ok=True)
    with ProcessPoolExecutor(a.workers) as pool:
        worst = check(pool)
        if a.check:
            return
        share, head_nid, head_mh, n_pipes = corner()
        tasks, keys = [], []
        for ii, label in WEATHER:
            case = Case(ii=ii)
            tasks.append((case, None, None, os.path.join(RUN_DIR, f"b_{ii}")))
            keys.append((ii, "base", 0))
            for n in SIZES:
                tasks.append((case, {k: v * n for k, v in share.items()}, None,
                              os.path.join(RUN_DIR, f"i_{ii}_{n}")))
                keys.append((ii, "infill", n))
                tasks.append((case, {head_nid: n}, None, os.path.join(RUN_DIR, f"g_{ii}_{n}")))
                keys.append((ii, "greenfield", n))
        t0 = time.time()
        res = list(pool.map(sim25_grid._whole_task, tasks))
        print(f"{len(tasks)} SWMM runs in {time.time() - t0:.0f} s", flush=True)

    out = {"version": "sim26", "made": time.strftime("%Y-%m-%d"),
           "check": {"published_run": f"Design wet +{CHECK['dwellings']} at MH{CHECK['site']}",
                     "largest_difference_mm": round(worst, 3)},
           "corner": {"outlet_node": sim25.SEGMENT_OUTLET, "pipes": n_pipes,
                      "infill_nodes": len(share), "greenfield_manhole": head_mh},
           "sizes": SIZES, "weather": [{"ii": ii, "label": lb} for ii, lb in WEATHER],
           "alarm_mm": ALARM_MM, "runs": []}
    by = dict(zip(keys, res))
    for ii, label in WEATHER:
        case = Case(ii=ii)
        probe = Sim25Model(case, whole=True)
        base = by[(ii, "base", 0)][3]
        mh = {c: probe.nodes[c].manhole_id for c in probe.candidates}
        out.setdefault("baseline", []).append({
            "ii": ii, "label": label,
            "depth_mm": {str(mh[c]): round(base[c]["depth"] * 1000, 1) for c in probe.candidates},
            "alarm": sorted(mh[c] for c in probe.candidates if base[c]["alarm"]),
            "surcharged": sorted(mh[c] for c in probe.candidates if base[c]["surcharged"]),
            "spilled": sorted(mh[c] for c in probe.candidates if base[c]["spilled"])})
        for kind in ("infill", "greenfield"):
            for n in SIZES:
                head, glps, err, st = by[(ii, kind, n)]
                row = {"ii": ii, "kind": kind, "dwellings": n, "added_lps": round(glps, 3),
                       "routing_error_pct": round(err, 3)}
                row.update(summarise(probe, base, st))
                out["runs"].append(row)
    path = os.path.join(OUT_DIR, "scenarios.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
    print("wrote", os.path.relpath(path, SRC))


if __name__ == "__main__":
    main()
