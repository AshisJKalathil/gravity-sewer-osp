# Simulation 2.6

Four additions beside Simulation 2.5, in new files only. Sim 2.5's model, results and pages
are read and never changed.

| Addition | Needs SWMM? | Where |
|---|---|---|
| Infill and greenfield growth, rain only | Yes, 21 runs (about 2 min) | `sim26_scenarios.py` → `../results/sim26/scenarios.json` |
| Risk = severity × likelihood (Kimbrough 2019) | No | `sim26_build.py` |
| Per-manhole normal-band alarm (Rosin et al. 2022) | No, reads the saved Sim 2.5 grid | `sim26_build.py` |
| Float vs level sensor cost | No; the optimiser runs in the page | `../../simulation26/sim26.js` |

```
~/.venvs/sewer/bin/python simulation_src/sim26/sim26_scenarios.py   # checks one published run first
~/.venvs/sewer/bin/python simulation_src/sim26/sim26_build.py       # checks the scoring, writes the page data
```

Every assumption, every check and the changes from Sim 2.5 are on `simulation26/about.html`.
