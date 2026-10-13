"""Experiment planning workspace and expert review checkpoints."""


def _create(client, **kw):
    payload = {"title": "Buffer screen", "objective": "Find best pH", "steps": ["Prepare buffers", "Run assay"], **kw}
    resp = client.post("/api/experiments", json=payload)
    assert resp.status_code == 201
    return resp.get_json()


def test_create_experiment_with_checklist(client):
    exp = _create(client)
    assert [s["text"] for s in exp["steps"]] == ["Prepare buffers", "Run assay"]
    assert exp["progress"] == 0 and exp["status"] == "draft"


def test_checklist_progress_tracking(client):
    exp = _create(client)
    sid = exp["steps"][0]["id"]
    exp = client.patch(f"/api/experiments/{exp['id']}/steps/{sid}", json={"done": True}).get_json()
    assert exp["progress"] == 50
    exp = client.post(f"/api/experiments/{exp['id']}/steps", json={"text": "Analyse"}).get_json()
    assert exp["progress"] == 33 and exp["steps"][-1]["position"] == 3


def test_reorder_steps_requires_full_permutation(client):
    exp = _create(client)
    ids = [s["id"] for s in exp["steps"]]
    reordered = client.put(f"/api/experiments/{exp['id']}/steps/order", json={"step_ids": ids[::-1]}).get_json()
    assert [s["id"] for s in reordered["steps"]] == ids[::-1]
    assert client.put(f"/api/experiments/{exp['id']}/steps/order", json={"step_ids": ids[:1]}).status_code == 422


def test_variable_log(client):
    exp = _create(client)
    exp = client.post(f"/api/experiments/{exp['id']}/variables",
                      json={"name": "pH", "value": "7.4", "kind": "independent"}).get_json()
    assert exp["variables"][0]["name"] == "pH"
    assert client.post(f"/api/experiments/{exp['id']}/variables",
                       json={"name": "pH", "value": "7", "kind": "weird"}).status_code == 422


def test_protocol_and_status_update(client):
    exp = _create(client)
    upd = client.patch(f"/api/experiments/{exp['id']}", json={"protocol_markdown": "## Steps\n$E=mc^2$",
                                                               "status": "in_progress"}).get_json()
    assert upd["status"] == "in_progress" and "$E=mc^2$" in upd["protocol_markdown"]
    assert client.patch(f"/api/experiments/{exp['id']}", json={"status": "bogus"}).status_code == 422


def test_review_workflow_approves_when_all_checkpoints_pass(client):
    exp = _create(client)
    eid = exp["id"]
    exp = client.post(f"/api/experiments/{eid}/reviews", json={"checkpoint": "Protocol approval", "reviewer_id": 1}).get_json()
    exp = client.post(f"/api/experiments/{eid}/reviews", json={"checkpoint": "Safety review", "reviewer_id": 4}).get_json()
    assert exp["status"] == "in_review"
    r1, r2 = exp["reviews"]
    exp = client.post(f"/api/experiments/{eid}/reviews/{r1['id']}/decision", json={"decision": "approved"}).get_json()
    assert exp["status"] == "in_review"
    exp = client.post(f"/api/experiments/{eid}/reviews/{r2['id']}/decision", json={"decision": "approved"}).get_json()
    assert exp["status"] == "approved"
    # A decided checkpoint cannot be decided twice.
    assert client.post(f"/api/experiments/{eid}/reviews/{r2['id']}/decision",
                       json={"decision": "rejected", "notes": "x"}).status_code == 409


def test_changes_requested_requires_notes(client):
    exp = _create(client)
    exp = client.post(f"/api/experiments/{exp['id']}/reviews", json={"checkpoint": "Data review"}).get_json()
    rid = exp["reviews"][0]["id"]
    url = f"/api/experiments/{exp['id']}/reviews/{rid}/decision"
    assert client.post(url, json={"decision": "changes_requested"}).status_code == 422
    assert client.post(url, json={"decision": "maybe"}).status_code == 422
    exp = client.post(url, json={"decision": "changes_requested", "notes": "Add controls"}).get_json()
    assert exp["status"] == "changes_requested" and exp["reviews"][0]["notes"] == "Add controls"


def test_profiles_track_progress_and_review_queue(client):
    profiles = client.get("/api/profiles").get_json()
    priya = next(p for p in profiles if p["name"] == "Priya Raman")
    assert priya["experiment_count"] == 1 and priya["avg_progress"] == 60
    qa = client.get("/api/profiles/4").get_json()
    assert qa["review_queue"][0]["checkpoint"] == "Safety review"


def test_missing_experiment_returns_404(client):
    assert client.get("/api/experiments/9999").status_code == 404
    assert client.post("/api/experiments", json={}).status_code == 400
