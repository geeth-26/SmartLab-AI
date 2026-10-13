"""Conversational lab knowledge (RAG Q&A), conversation history, answer feedback and raw vector search."""
from __future__ import annotations

import uuid

from flask import Blueprint, jsonify, request

from ..db import audit, dumps, execute, get_db, loads, query_all, query_one
from .common import ApiError, int_arg, json_body, rag, require

bp = Blueprint("chat", __name__, url_prefix="/api")

MAX_QUESTION_CHARS = 2000
META_KEYS = ("evidence_status", "confidence", "warnings", "mode", "missing_terms", "guardrails", "source_issues",
             "requires_verification", "service_notice")
FEEDBACK_RATINGS = {"helpful", "incorrect", "unsafe", "outdated"}


@bp.post("/chat")
def chat():
    data = json_body()
    require(data, "question")
    question = str(data["question"]).strip()
    if len(question) > MAX_QUESTION_CHARS:
        raise ApiError(f"Question exceeds {MAX_QUESTION_CHARS} characters.")
    session_id = str(data.get("session_id") or uuid.uuid4().hex)[:64]
    doc_ids = data.get("document_ids") or None
    if doc_ids is not None and (not isinstance(doc_ids, list) or not all(isinstance(i, int) for i in doc_ids)):
        raise ApiError("document_ids must be a list of integers.")

    result = rag().answer(get_db(), question, document_ids=doc_ids)
    execute("INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)", (session_id, question))
    meta = {k: result[k] for k in META_KEYS}
    msg_id = execute(
        "INSERT INTO chat_messages (session_id, role, content, citations_json, meta_json) VALUES (?, 'assistant', ?, ?, ?)",
        (session_id, result["answer"], dumps(result["citations"]), dumps(meta)),
    )
    return jsonify({"session_id": session_id, "message_id": msg_id, **result})


@bp.post("/chat/<session_id>/messages")
def record_message(session_id: str):
    """Persist a client-composed exchange (used for image questions answered by /api/vision)."""
    data = json_body()
    require(data, "question", "answer")
    sid = session_id[:64]
    execute("INSERT INTO chat_messages (session_id, role, content, meta_json) VALUES (?, 'user', ?, ?)",
            (sid, str(data["question"])[:MAX_QUESTION_CHARS], dumps({"attachment": data.get("attachment")})))
    msg_id = execute(
        "INSERT INTO chat_messages (session_id, role, content, citations_json, meta_json) VALUES (?, 'assistant', ?, ?, ?)",
        (sid, str(data["answer"])[:20000], dumps(data.get("citations") or []), dumps(data.get("meta") or {})))
    return jsonify({"session_id": sid, "message_id": msg_id}), 201


@bp.get("/chat/sessions")
def sessions():
    """Recent conversations, newest first, titled by their first question."""
    limit = int_arg("limit", 20, 1, 100)
    return jsonify(query_all(
        """
        SELECT session_id,
               (SELECT content FROM chat_messages f WHERE f.session_id = m.session_id AND f.role = 'user'
                 ORDER BY f.id LIMIT 1) AS title,
               COUNT(*) AS message_count, MIN(created_at) AS started_at, MAX(created_at) AS updated_at, MAX(id) AS last_id
          FROM chat_messages m GROUP BY session_id ORDER BY last_id DESC LIMIT ?
        """, (limit,)))


@bp.get("/chat/<session_id>")
def history(session_id: str):
    rows = query_all("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id", (session_id[:64],))
    feedback = {r["message_id"]: r for r in query_all(
        "SELECT * FROM answer_feedback WHERE message_id IN (SELECT id FROM chat_messages WHERE session_id = ?)",
        (session_id[:64],))}
    for r in rows:
        r["citations"] = loads(r.pop("citations_json"), [])
        r["meta"] = loads(r.pop("meta_json"), {})
        r["feedback"] = feedback.get(r["id"])
    return jsonify(rows)


@bp.delete("/chat/<session_id>")
def delete_session(session_id: str):
    if not query_one("SELECT 1 AS x FROM chat_messages WHERE session_id = ?", (session_id[:64],)):
        raise ApiError("Conversation not found.", 404)
    execute("DELETE FROM chat_messages WHERE session_id = ?", (session_id[:64],))
    return "", 204


# ---------------------------------------------------------------------- feedback
@bp.post("/messages/<int:message_id>/feedback")
def give_feedback(message_id: int):
    """Rate an answer. 'incorrect', 'unsafe' and 'outdated' ratings enter the expert review queue."""
    msg = query_one("SELECT * FROM chat_messages WHERE id = ? AND role = 'assistant'", (message_id,))
    if msg is None:
        raise ApiError("Answer not found.", 404)
    data = json_body()
    rating = data.get("rating")
    if rating not in FEEDBACK_RATINGS:
        raise ApiError(f"rating must be one of: {', '.join(sorted(FEEDBACK_RATINGS))}.", 422)
    comment = str(data.get("comment") or "").strip()[:2000] or None
    if rating != "helpful" and not comment:
        raise ApiError("Please describe what is wrong so a reviewer can check it.", 422)
    db = get_db()
    db.execute("DELETE FROM answer_feedback WHERE message_id = ? AND status = 'open'", (message_id,))
    status = "closed" if rating == "helpful" else "open"
    cur = db.execute("INSERT INTO answer_feedback (message_id, rating, comment, status) VALUES (?, ?, ?, ?)",
                     (message_id, rating, comment, status))
    if status == "open":
        audit(db, "flag", "answer", message_id, f"Answer flagged as {rating}: {comment}")
    db.commit()
    return jsonify(query_one("SELECT * FROM answer_feedback WHERE id = ?", (cur.lastrowid,))), 201


@bp.get("/feedback")
def feedback_queue():
    status = request.args.get("status", "open")
    rows = query_all(
        """
        SELECT f.*, a.content AS answer, a.session_id, a.citations_json,
               (SELECT q.content FROM chat_messages q WHERE q.session_id = a.session_id AND q.role = 'user'
                  AND q.id < a.id ORDER BY q.id DESC LIMIT 1) AS question
          FROM answer_feedback f JOIN chat_messages a ON a.id = f.message_id
         WHERE f.rating != 'helpful' AND (? = 'all' OR f.status = ?)
         ORDER BY f.id DESC
        """, (status, status))
    for r in rows:
        r["citations"] = loads(r.pop("citations_json"), [])
    return jsonify(rows)


@bp.post("/feedback/<int:feedback_id>/resolve")
def resolve_feedback(feedback_id: int):
    item = query_one("SELECT * FROM answer_feedback WHERE id = ?", (feedback_id,))
    if item is None:
        raise ApiError("Feedback item not found.", 404)
    if item["status"] != "open":
        raise ApiError("This item has already been resolved.", 409)
    data = json_body()
    resolution = str(data.get("resolution") or "").strip()
    if not resolution:
        raise ApiError("A resolution note is required.", 422)
    db = get_db()
    db.execute("UPDATE answer_feedback SET status = 'resolved', resolution = ?, resolved_at = datetime('now') WHERE id = ?",
               (resolution[:2000], feedback_id))
    audit(db, "resolve", "answer", item["message_id"], f"Review resolved: {resolution[:200]}", data.get("actor"))
    db.commit()
    return jsonify(query_one("SELECT * FROM answer_feedback WHERE id = ?", (feedback_id,)))


@bp.post("/search/vector")
def vector_search():
    data = json_body()
    require(data, "query")
    k = data.get("k", 5)
    if not isinstance(k, int) or not 1 <= k <= 50:
        raise ApiError("k must be an integer between 1 and 50.")
    engine = rag()
    hits = engine.retrieve(get_db(), str(data["query"]), k=k)
    return jsonify({"query": data["query"], "min_score": engine.min_score,
                    "results": [h.to_dict() | {"is_evidence": h.score >= engine.min_score} for h in hits]})
