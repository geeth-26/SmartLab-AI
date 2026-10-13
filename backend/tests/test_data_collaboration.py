"""Data management (grids, filters, stats, CSV) and collaboration (threads, files, activity)."""
import io


def _titre_dataset_id(client):
    return next(d["id"] for d in client.get("/api/datasets").get_json() if d["name"] == "Titre by PEI ratio")


def test_dataset_sort_filter_and_stats(client):
    ds_id = _titre_dataset_id(client)
    body = client.get(f"/api/datasets/{ds_id}?sort=titre_mg_l&order=desc").get_json()
    titres = [r["titre_mg_l"] for r in body["rows"]]
    assert titres == sorted(titres, reverse=True) and body["total_rows"] == 12
    stats = body["stats"]["titre_mg_l"]
    assert stats["type"] == "numeric" and stats["max"] == 88.1 and stats["min"] == 39.8
    assert body["stats"]["ratio"]["type"] == "categorical" and body["stats"]["ratio"]["distinct"] == 4

    filtered = client.get(f"/api/datasets/{ds_id}?filter=ratio:1:3").get_json()
    assert filtered["total_rows"] == 3 and all(r["ratio"] == "1:3" for r in filtered["rows"])
    ranged = client.get(f"/api/datasets/{ds_id}?min=viability_pct:85&max=titre_mg_l:70").get_json()
    assert all(r["viability_pct"] >= 85 and r["titre_mg_l"] <= 70 for r in ranged["rows"])


def test_dataset_query_validation(client):
    ds_id = _titre_dataset_id(client)
    assert client.get(f"/api/datasets/{ds_id}?sort=nope").status_code == 400
    assert client.get(f"/api/datasets/{ds_id}?filter=nope:x").status_code == 400
    assert client.get(f"/api/datasets/{ds_id}?min=titre_mg_l:abc").status_code == 400


def test_csv_import_coerces_numbers(client):
    csv_bytes = b"sample,od600,label\nA,0.12,ctrl\nB,0.45,treated\n"
    resp = client.post("/api/datasets", data={"file": (io.BytesIO(csv_bytes), "growth.csv"), "name": "Growth"},
                       content_type="multipart/form-data")
    assert resp.status_code == 201
    ds = resp.get_json()
    assert ds["columns"] == ["sample", "od600", "label"] and ds["rows"][1]["od600"] == 0.45


def test_json_dataset_create_append_delete(client):
    ds = client.post("/api/datasets", json={"name": "Kinetics", "columns": ["t", "v"],
                                            "rows": [{"t": 0, "v": 0.0}]}).get_json()
    ds = client.post(f"/api/datasets/{ds['id']}/rows", json={"rows": [{"t": 1, "v": 2.5}]}).get_json()
    assert len(ds["rows"]) == 2
    assert client.post("/api/datasets", json={"name": "Bad", "columns": ["a", "a"]}).status_code == 422
    assert client.delete(f"/api/datasets/{ds['id']}").status_code == 204


def test_threaded_comments(client):
    thread = client.get("/api/comments/experiment/1").get_json()
    root = thread[0]
    assert root["body"].startswith("Can we add") and root["replies"][0]["author_name"] == "Priya Raman"
    reply = client.post("/api/comments/experiment/1", json={"body": "Agreed", "parent_id": root["id"], "author_id": 1})
    assert reply.status_code == 201
    thread = client.get("/api/comments/experiment/1").get_json()
    assert len(thread[0]["replies"]) == 2
    # A parent from another thread is rejected.
    assert client.post("/api/comments/experiment/2", json={"body": "x", "parent_id": root["id"]}).status_code == 422
    assert client.get("/api/comments/unknown/1").status_code == 404


def test_shared_file_upload_and_download(client):
    resp = client.post("/api/projects/1/files", data={"file": (io.BytesIO(b"a,b\n1,2\n"), "results.csv"),
                                                      "uploaded_by": "2"}, content_type="multipart/form-data")
    assert resp.status_code == 201
    f = resp.get_json()
    files = client.get("/api/projects/1/files").get_json()
    assert files[0]["original_name"] == "results.csv" and files[0]["uploader_name"] == "Jordan Lee"
    dl = client.get(f"/api/files/{f['id']}")
    assert dl.status_code == 200 and dl.data == b"a,b\n1,2\n"
    assert "attachment" in dl.headers["Content-Disposition"]
    bad = client.post("/api/projects/1/files", data={"file": (io.BytesIO(b"<script>"), "x.html")},
                      content_type="multipart/form-data")
    assert bad.status_code == 415
    assert client.post("/api/projects/999/files", data={"file": (io.BytesIO(b"a"), "a.txt")},
                       content_type="multipart/form-data").status_code == 404


def test_activity_feed(client):
    client.post("/api/comments/project/1", json={"body": "Kick-off notes uploaded", "author_id": 1})
    items = client.get("/api/activity").get_json()
    kinds = {i["kind"] for i in items}
    assert {"comment", "document", "review"} <= kinds
    assert client.get("/api/activity?since=2999-01-01").get_json() == []


def test_projects(client):
    assert client.post("/api/projects", json={"name": "Stability study"}).status_code == 201
    projects = client.get("/api/projects").get_json()
    assert projects[0]["experiment_count"] == 1 and len(projects) == 3
