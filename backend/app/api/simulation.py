"""Lab Experiment Simulation (LXS) endpoints."""
from __future__ import annotations

from flask import Blueprint, jsonify

from ..services import simulation
from .common import ApiError, json_body

bp = Blueprint("simulation", __name__, url_prefix="/api/simulations")


@bp.get("")
def catalog():
    return jsonify(simulation.catalog())


@bp.post("/<model_id>")
def run(model_id: str):
    data = json_body()
    params = data.get("params", {})
    if not isinstance(params, dict):
        raise ApiError("params must be an object.")
    try:
        return jsonify(simulation.run(model_id, params))
    except simulation.SimulationError as exc:
        raise ApiError(str(exc), 404 if exc.args[0].startswith("Unknown model") else 422) from exc
