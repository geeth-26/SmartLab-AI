"""SmartLab AI - Flask application factory."""
from __future__ import annotations

import logging

from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from .config import Config
from .db import close_db, connect, init_schema
from .rag.embeddings import get_embedder
from .rag.engine import RAGEngine
from .rag.vector_store import get_vector_store
from .security import FileValidationError
from .services.llm import ClaudeClient

__version__ = "1.0.0"


def create_app(config_object: type[Config] | Config = Config, **overrides) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)
    app.config.update(overrides)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    for key in ("DATA_DIR", "UPLOAD_DIR", "INDEX_DIR"):
        app.config[key].mkdir(parents=True, exist_ok=True)
    (app.config["UPLOAD_DIR"] / "shared").mkdir(exist_ok=True)

    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    llm = ClaudeClient(app.config["LLM_MODEL"], app.config["LLM_EFFORT"], app.config["LLM_ENABLED"])
    embedder = get_embedder(app.config["EMBEDDING_BACKEND"], app.config["EMBEDDING_MODEL"])
    store = get_vector_store(app.config["VECTOR_BACKEND"], embedder.dim, app.config["INDEX_DIR"])
    rag = RAGEngine(
        embedder, store, llm,
        chunk_size=app.config["CHUNK_SIZE"], chunk_overlap=app.config["CHUNK_OVERLAP"],
        top_k=app.config["TOP_K"], min_score=app.config.get("MIN_EVIDENCE_SCORE"),
    )
    app.extensions["smartlab"] = {"rag": rag, "llm": llm}

    conn = connect(app.config["DATABASE_PATH"])
    try:
        init_schema(conn)
        rag.ensure_index(conn)
        if app.config["SEED_DEMO_DATA"]:
            from .seed import seed_documents, seed_records

            seed_records(conn)
            seed_documents(conn, rag, app.config["UPLOAD_DIR"], app.config["MAX_CONTENT_LENGTH"])
    finally:
        conn.close()

    app.teardown_appcontext(close_db)
    _register_blueprints(app)
    _register_error_handlers(app)

    @app.get("/api/health")
    def health():
        return jsonify({
            "status": "ok",
            "version": __version__,
            "embeddings": embedder.name,
            "vector_store": store.backend,
            "indexed_chunks": len(store),
            "llm": {"enabled": llm.available, "model": llm.model if llm.available else None},
            "min_evidence_score": rag.min_score,
            "literature_online": app.config["LITERATURE_ONLINE"],
            "max_upload_mb": app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024),
        })

    return app


def _register_blueprints(app: Flask) -> None:
    from .api import (chat, collaboration, data, documents, experiments, literature, profiles, reagents,
                      safety, search, simulation, troubleshooting, vision)

    for module in (chat, collaboration, data, documents, experiments, literature, profiles, reagents,
                   safety, search, simulation, troubleshooting, vision):
        app.register_blueprint(module.bp)


def _register_error_handlers(app: Flask) -> None:
    from .api.common import ApiError

    @app.errorhandler(ApiError)
    def handle_api_error(err: ApiError):
        return jsonify({"error": err.message, **err.extra}), err.status

    @app.errorhandler(FileValidationError)
    def handle_file_error(err: FileValidationError):
        return jsonify({"error": err.message}), err.status

    @app.errorhandler(HTTPException)
    def handle_http(err: HTTPException):
        message = "Uploaded file is too large." if err.code == 413 else err.description
        return jsonify({"error": message}), err.code

    @app.errorhandler(Exception)
    def handle_unexpected(err: Exception):
        app.logger.exception("Unhandled error: %s", err)
        return jsonify({"error": "Internal server error."}), 500
