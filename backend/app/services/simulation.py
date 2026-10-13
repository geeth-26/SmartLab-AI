"""Lab Experiment Simulation (LXS).

Closed-form / numerically integrated models that let scientists explore how
protocol parameters change expected outcomes before running a bench experiment.
Each model validates its parameters against physical ranges, returns a curve
for plotting plus derived metrics, and lists the model's assumptions so the
output is never mistaken for a real measurement.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np


class SimulationError(ValueError):
    pass


@dataclass(frozen=True)
class Param:
    key: str
    label: str
    unit: str
    default: float
    min: float
    max: float
    step: float


def _r(x: float, n: int = 4) -> float:
    return float(round(x, n))


# ----------------------------------------------------------------------- models
def enzyme_kinetics(p: dict[str, float]) -> dict[str, Any]:
    """Michaelis-Menten with competitive inhibition: v = Vmax[S] / (Km(1+[I]/Ki) + [S])."""
    vmax, km, inhibitor, ki, s_max = p["vmax"], p["km"], p["inhibitor"], p["ki"], p["substrate_max"]
    km_app = km * (1 + inhibitor / ki)
    s = np.linspace(0, s_max, 60)
    v = vmax * s / (km_app + s)
    v0 = vmax * s / (km + s)
    return {
        "x_label": "[S] (µM)", "y_label": "v (µM/min)",
        "series": [
            {"name": "With inhibitor", "points": [{"x": _r(a), "y": _r(b)} for a, b in zip(s, v)]},
            {"name": "No inhibitor", "points": [{"x": _r(a), "y": _r(b)} for a, b in zip(s, v0)]},
        ],
        "metrics": {
            "apparent_km": _r(km_app), "v_at_smax": _r(v[-1]),
            "fraction_of_vmax_at_smax": _r(v[-1] / vmax),
            "inhibition_at_km_percent": _r(100 * (1 - (km / (km_app + km)) / 0.5)),
        },
        "assumptions": ["Steady-state kinetics", "Competitive, reversible inhibition", "No substrate inhibition"],
    }


def pcr_amplification(p: dict[str, float]) -> dict[str, Any]:
    """Logistic-limited qPCR amplification; Ct where signal crosses the threshold."""
    n0, eff, cycles, plateau, threshold = p["initial_copies"], p["efficiency"], int(p["cycles"]), p["plateau"], p["threshold"]
    copies = [n0]
    for _ in range(cycles):
        n = copies[-1]
        copies.append(n + n * eff * (1 - n / plateau))  # efficiency decays as reagents deplete
    copies_arr = np.array(copies)
    signal = copies_arr / plateau * 100  # relative fluorescence (% of plateau)
    ct = None
    for c in range(1, len(signal)):
        if signal[c - 1] < threshold <= signal[c]:
            ct = c - 1 + (threshold - signal[c - 1]) / (signal[c] - signal[c - 1])
            break
    return {
        "x_label": "Cycle", "y_label": "Fluorescence (% plateau)",
        "series": [
            {"name": "Amplification", "points": [{"x": i, "y": _r(y)} for i, y in enumerate(signal)]},
            {"name": "Threshold", "points": [{"x": 0, "y": threshold}, {"x": cycles, "y": threshold}]},
        ],
        "metrics": {"ct": _r(ct, 2) if ct is not None else None,
                    "final_copies": float(f"{copies_arr[-1]:.4g}"),
                    "doubling_efficiency_percent": _r(eff * 100, 1)},
        "warnings": [] if ct is not None else ["Signal never crossed the threshold - no Ct (increase cycles or template)."],
        "assumptions": ["Logistic plateau from reagent depletion", "Constant per-cycle efficiency in exponential phase"],
    }


def bacterial_growth(p: dict[str, float]) -> dict[str, Any]:
    """Zwietering-modified Gompertz growth with a cardinal temperature model for µmax."""
    od0, k, mu_opt, lag, temp, hours = p["od0"], p["carrying_capacity"], p["mu_max"], p["lag"], p["temperature"], p["hours"]
    t_min, t_opt, t_max = 5.0, 37.0, 45.0
    if temp <= t_min or temp >= t_max:
        mu = 0.0
    else:  # Rosso cardinal temperature model
        num = (temp - t_max) * (temp - t_min) ** 2
        den = (t_opt - t_min) * ((t_opt - t_min) * (temp - t_opt) - (t_opt - t_max) * (t_opt + t_min - 2 * temp))
        mu = max(0.0, mu_opt * num / den)
    a = math.log(k / od0)
    t = np.linspace(0, hours, 80)
    if mu == 0:
        y = np.full_like(t, od0)
    else:
        y = od0 * np.exp(a * np.exp(-np.exp(mu * math.e / a * (lag - t) + 1)))
    doubling = math.log(2) / mu if mu > 0 else None
    return {
        "x_label": "Time (h)", "y_label": "OD600",
        "series": [{"name": "OD600", "points": [{"x": _r(a_), "y": _r(b_)} for a_, b_ in zip(t, y)]}],
        "metrics": {"effective_mu_max": _r(mu), "doubling_time_h": _r(doubling, 3) if doubling else None,
                    "final_od": _r(y[-1]), "temperature_factor": _r(mu / mu_opt if mu_opt else 0)},
        "warnings": ["Temperature is outside the growth range - no growth predicted."] if mu == 0 else [],
        "assumptions": ["Mesophile cardinal temperatures 5/37/45 °C", "Nutrient-limited plateau", "Batch culture"],
    }


def dose_response(p: dict[str, float]) -> dict[str, Any]:
    """Four-parameter logistic (Hill) dose-response curve."""
    bottom, top, ec50, hill = p["bottom"], p["top"], p["ec50"], p["hill"]
    doses = np.logspace(math.log10(ec50) - 3, math.log10(ec50) + 3, 60)
    resp = bottom + (top - bottom) / (1 + (ec50 / doses) ** hill)
    ec10 = ec50 * (10 / 90) ** (1 / hill)
    ec90 = ec50 * (90 / 10) ** (1 / hill)
    return {
        "x_label": "Concentration (nM, log)", "y_label": "Response (%)", "x_scale": "log",
        "series": [{"name": "Response", "points": [{"x": float(f"{d:.4g}"), "y": _r(r_)} for d, r_ in zip(doses, resp)]}],
        "metrics": {"ec50": ec50, "ec10": float(f"{ec10:.4g}"), "ec90": float(f"{ec90:.4g}"),
                    "dynamic_range": _r(top - bottom), "ec90_ec10_ratio": float(f"{ec90 / ec10:.4g}")},
        "assumptions": ["Symmetric sigmoid (4PL)", "Single binding site", "Equilibrium conditions"],
    }


MODELS: dict[str, dict[str, Any]] = {
    "enzyme_kinetics": {
        "name": "Enzyme kinetics (Michaelis-Menten)", "fn": enzyme_kinetics,
        "params": [Param("vmax", "Vmax", "µM/min", 100, 1, 1000, 1), Param("km", "Km", "µM", 50, 0.1, 1000, 0.1),
                   Param("inhibitor", "[Inhibitor]", "µM", 0, 0, 500, 1), Param("ki", "Ki", "µM", 20, 0.1, 500, 0.1),
                   Param("substrate_max", "Max [S]", "µM", 500, 10, 5000, 10)],
    },
    "pcr_amplification": {
        "name": "qPCR amplification", "fn": pcr_amplification,
        "params": [Param("initial_copies", "Initial template", "copies", 1000, 1, 1e8, 1),
                   Param("efficiency", "Efficiency", "fraction", 0.95, 0.5, 1.0, 0.01),
                   Param("cycles", "Cycles", "", 40, 10, 60, 1), Param("plateau", "Plateau", "copies", 1e12, 1e9, 1e14, 1e9),
                   Param("threshold", "Threshold", "% plateau", 2, 0.1, 50, 0.1)],
    },
    "bacterial_growth": {
        "name": "Bacterial growth curve", "fn": bacterial_growth,
        "params": [Param("od0", "Initial OD600", "", 0.05, 0.001, 1, 0.001),
                   Param("carrying_capacity", "Max OD600", "", 2.0, 0.1, 10, 0.1),
                   Param("mu_max", "µmax at 37 °C", "1/h", 1.2, 0.05, 3, 0.05),
                   Param("lag", "Lag time", "h", 1.5, 0, 12, 0.1),
                   Param("temperature", "Temperature", "°C", 37, 0, 50, 0.5), Param("hours", "Duration", "h", 16, 1, 72, 1)],
    },
    "dose_response": {
        "name": "Dose-response (4PL)", "fn": dose_response,
        "params": [Param("bottom", "Bottom", "%", 0, -20, 50, 1), Param("top", "Top", "%", 100, 50, 150, 1),
                   Param("ec50", "EC50", "nM", 10, 0.01, 10000, 0.01), Param("hill", "Hill slope", "", 1, 0.2, 5, 0.1)],
    },
}


def catalog() -> list[dict[str, Any]]:
    return [
        {"id": key, "name": m["name"], "params": [p.__dict__ for p in m["params"]]}
        for key, m in MODELS.items()
    ]


def run(model_id: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    model = MODELS.get(model_id)
    if model is None:
        raise SimulationError(f"Unknown model '{model_id}'. Available: {', '.join(MODELS)}.")
    params = params or {}
    unknown = set(params) - {p.key for p in model["params"]}
    if unknown:
        raise SimulationError(f"Unknown parameter(s): {', '.join(sorted(unknown))}.")
    values: dict[str, float] = {}
    for p in model["params"]:
        raw = params.get(p.key, p.default)
        try:
            v = float(raw)
        except (TypeError, ValueError) as exc:
            raise SimulationError(f"Parameter '{p.key}' must be numeric.") from exc
        if not math.isfinite(v) or not p.min <= v <= p.max:
            raise SimulationError(f"Parameter '{p.key}' must be between {p.min:g} and {p.max:g} {p.unit}".strip() + ".")
        values[p.key] = v
    fn: Callable[[dict[str, float]], dict[str, Any]] = model["fn"]
    result = fn(values)
    result.setdefault("warnings", [])
    result.update({"model": model_id, "name": model["name"], "params": values,
                   "disclaimer": "Simulated output from an idealised model - not experimental data."})
    return result
