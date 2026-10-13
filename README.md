# SmartLab AI

**Multimodal Laboratory Knowledge & Operations Assistant** for pharma and biotech labs.

SmartLab AI answers questions from your SOPs and manuals with page-level citations. It analyses photos of equipment displays and samples, and links them to the matching SOP pages. It also runs the day-to-day lab workspace: reagent inventory, troubleshooting, experiment planning with expert review, datasets, collaboration, literature search and protocol simulation.

It runs **fully offline** out of the box. Set `ANTHROPIC_API_KEY` to upgrade answer synthesis, image description and literature summaries to Claude (`claude-opus-5-5`).

---

## Features

| Area | What it does | Where |
|---|---|---|
| **RAG knowledge chat** | Q&A over uploaded PDFs; Markdown + LaTeX answers | `backend/app/rag/engine.py`, `ChatView.jsx` |
| **Page-level citations** | Every grounded answer cites `document, page`. Citations are checked against the stored chunks, invented source ids are dropped, and an answer with no valid citation is never shown as grounded | `renumber_citations`, `verify_citations` |
| **Uncertainty handling** | A similarity threshold decides what counts as evidence. Answers are labelled `grounded` / `partial` / `insufficient` and list missing terms. "INSUFFICIENT_EVIDENCE" from the LLM is respected | `RAGEngine.answer` |
| **Image-to-document RAG** | A photo becomes an observational description plus verbatim display text, which drives SOP retrieval and verified-fix matching | `backend/app/vision/analyzer.py`, `VisionView.jsx` |
| **Vision guardrails** | The prompt forbids identifying chemicals, organisms, contaminants or medical conditions, and the output is sanitised (redacted and flagged). Queries asking for identification, medical dosing or interlock bypass are flagged | `backend/app/guardrails.py` |
| **Unified search** | One query searches SOP text, the reagent inventory and the troubleshooting database | `/api/search/unified`, `SearchView.jsx` |
| **Reagents** | Stock, expiry, storage and hazard data; low-stock/expiry status; consume and restock (never below zero); plain-English questions such as "where is trypsin stored?" | `services/inventory.py`, `ReagentsView.jsx` |
| **Troubleshooting** | Error code + keyword matching to verified, SOP-referenced fixes. New entries stay unverified until reviewed | `services/troubleshooting.py` |
| **Experiments** | Markdown/LaTeX protocol editor with live preview, reorderable checklist with progress, variable log | `api/experiments.py`, `ExperimentsView.jsx` |
| **Expert review** | Checkpoints (protocol, safety, data...) with approve / request changes. Notes are required to reject, and experiment status rolls up automatically | `/api/experiments/<id>/reviews` |
| **Data & analysis** | Datasets with server-side sort, filter and range filters, per-column statistics, CSV import, bar and scatter charts | `api/data.py`, `DataView.jsx` |
| **Collaboration** | Projects, threaded comments, drag-and-drop file sharing, live activity feed (5 s polling) | `api/collaboration.py`, `CollaborationView.jsx` |
| **Literature** | Europe PMC search → grounded summaries → cross-reference to internal SOPs (offline sample corpus fallback) | `services/literature.py` |
| **Simulation (LXS)** | Michaelis-Menten (+ inhibitor), qPCR amplification/Ct, temperature-dependent growth, 4PL dose-response, all with live sliders | `services/simulation.py`, `SimulationView.jsx` |
| **Document governance** | Category, document code, version, owner and approval status (approved / pending / outdated / unreviewed). Uploads start Unreviewed. When several versions of a document match, the approved one is used and the conflict is reported. Unapproved cited sources make the answer *partial* and ask for verification | `rag/engine.py: resolve_versions`, `api/documents.py` |
| **Expert review of answers** | Rate answers; *incorrect / unsafe / outdated* reports (with a required note) enter a review queue that a reviewer resolves | `/api/messages/<id>/feedback`, `/api/feedback` |
| **Audit trail** | Approval changes, uploads, re-indexing, deletions, inventory changes, settings edits and review resolutions | `audit_log` table, `/api/activity` |
| **Safety resources** | Safety-category documents with version and review date, a passage search limited to safety documents, recorded hazard classes, and emergency contacts entered by the institution (never invented) | `api/safety.py`, `SafetyView.jsx` |
| **Lab tour & profiles** | Floor-plan hotspots with step-by-step equipment training linked to SOPs; researcher progress and review queues | `api/profiles.py`, `LabTourView.jsx` |

### Interface

A light-first interface built around the evidence workflow (design tokens in `frontend/tailwind.config.js`, contrast-checked to WCAG AA).

- **Shell:** a dark navigation sidebar (collapsible on desktop, a drawer on mobile) with the core pages first: Overview, Ask SmartLab, Documents, Reagents, Scientific literature and Safety resources. Below them are *Lab operations* and *Early features* (collaboration, simulation, training), labelled as limited-scope prototypes, then Recent activity and Settings. The top bar has global search. Routes are hash URLs (`#/documents/12?page=3`), so deep links and the back button work.
- **Overview:** a question composer, four quick actions, and only real data: recent conversations, recently updated documents, and documents or reagents needing attention. It shows a first-run state when the library is empty.
- **Ask SmartLab:** a central conversation column with saved history.
  - **Composer:** Enter sends. You can attach one image (answered by the vision pipeline) or one PDF (uploaded with progress, indexed, then queried on its own).
  - **Answer states:** each answer shows one of *supported* / *partially supported* / *no evidence*, plus notices when versions conflict, the cited source is unapproved, verification is needed, or the AI service is down.
  - **Answer actions:** expandable source excerpts, copy, and "Report a problem", which sends the answer to the expert review queue.
- **Evidence panel:** opens only when you click a citation. It is docked at ≥1280 px and a drawer otherwise. It shows the document's type, version, approval status and page, the cited excerpt, and the rendered page with the excerpt highlighted.
- **Documents:** a sortable, filterable table (category, approval status, search) with an upload dialog that shows real progress and indexing status. The detail drawer lets you edit metadata and approval (logged), see other versions, browse pages and extracted text, re-index, and delete.
- **Reagents, Literature, Safety, Activity, Settings:** described in the feature table above. Demo data is labelled as such on every page that shows it.


---

## Architecture

```
smartlab-ai/
├── backend/                      Flask REST API (Python 3.10+)
│   ├── app/
│   │   ├── __init__.py           App factory: config, CORS, RAG engine, seeding, error handlers
│   │   ├── config.py             Env-driven Config / TestConfig
│   │   ├── db.py                 SQLite schema + helpers (Postgres-compatible SQL)
│   │   ├── security.py           Upload validation pipeline
│   │   ├── guardrails.py         Query screening + vision output sanitiser
│   │   ├── seed.py               Demo SOP PDFs (generated with PyMuPDF) + demo records
│   │   ├── rag/
│   │   │   ├── pdf_extractor.py  PyMuPDF page text, header/footer removal, page-bounded chunks, highlighted page render
│   │   │   ├── embeddings.py     Sentence-Transformers or hashing embedder (auto-fallback)
│   │   │   ├── vector_store.py   FAISS IndexIDMap(FlatIP) or NumPy store, persisted
│   │   │   └── engine.py         Ingest / retrieve / answer / citation validation
│   │   ├── vision/analyzer.py    Claude vision (structured JSON) or heuristics → guardrails → SOP retrieval
│   │   ├── services/             llm.py, inventory.py, troubleshooting.py, literature.py, simulation.py
│   │   └── api/                  One blueprint per area (documents, chat, reagents, vision, ...)
│   ├── tests/                    pytest suite (208 tests, offline and deterministic)
│   ├── requirements.txt          Core dependencies
│   ├── requirements-ml.txt       Optional: sentence-transformers + faiss-cpu
│   └── run.py                    Dev server entry point
└── frontend/                     React 18 + Vite + Tailwind + Recharts + react-markdown/KaTeX
    └── src/
        ├── App.jsx               Shell: sidebar · workspace · citation panel
        ├── context/AppContext.jsx Toasts, theme, document library, citation state
        ├── components/           ui.jsx (Dropzone, Markdown w/ citation chips, Skeleton...), Sidebar, CitationPanel, CommentThread
        ├── views/                One view per module
        └── lib/                  api.js (REST client), chartTheme.js (validated chart palette)
```

### RAG pipeline

1. **Validate** the upload: extension allow-list, magic bytes, size, PDF parse, no encryption, page limit, and no JavaScript/launch/embedded-file content.
2. **Extract** each page with PyMuPDF (`get_text(sort=True)`). Running headers and footers are removed, then the text is split into sentences and headings.
3. **Chunk** by greedy sentence packing (default 700 chars, 120 overlap). Chunks **never cross a page**, which is what makes page-exact citations possible.
4. **Embed** with `all-MiniLM-L6-v2` (if `sentence-transformers` is installed) or the deterministic hashing embedder. Vectors are normalised and stored in FAISS (or NumPy), keyed by the SQLite chunk id.
5. **Retrieve** the top-k chunks by cosine similarity, with a light lexical re-rank so exact error codes and part numbers count.
6. **Gate** on evidence. Chunks below the threshold are not evidence (hashing ≈ 0.12, MiniLM ≈ 0.30). If nothing passes, the reply says so and makes no claims.
7. **Answer.** Claude answers only from numbered `[S#]` sources, or the offline path extracts the best-matching sentences. Markers are renumbered and checked; unknown ids are dropped.
8. **Return** the answer with citations (`document_title`, `page`, verbatim `snippet`, `score`), `evidence_status`, `confidence`, warnings and the guardrail report.

---

## Setup

### Prerequisites
- Python **3.10+** (tested on 3.14)
- Node.js **18+** (tested on 24)

### 1. Backend

```bash
cd smartlab-ai/backend
python -m venv .venv
# Windows:  .venv\Scripts\activate      macOS/Linux:  source .venv/bin/activate
pip install -r requirements.txt
# Optional - dense embeddings + FAISS (downloads a ~90 MB model on first run):
pip install -r requirements-ml.txt

python run.py           # → http://127.0.0.1:5000  (GET /api/health)
```

On first start the database is created in `backend/instance/` and seeded with four demo SOP PDFs, 12 reagents, verified fixes, projects, experiments, datasets and equipment. Seeding only runs against an empty database. Delete `backend/instance/` to reset.

### 2. Frontend

```bash
cd smartlab-ai/frontend
npm install
npm run dev             # → http://localhost:5173  (proxies /api to :5000)
```

Production build: `npm run build` writes to `frontend/dist/`. Serve that folder behind the same origin as the API, or set `VITE_API_BASE` at build time and add the origin to `SMARTLAB_CORS_ORIGINS`.

### 3. Enable Claude (optional)

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
python run.py
```

The health badge in the top bar switches from **Offline mode** to the model name. Requests use `claude-opus-5-5` with adaptive thinking and `effort: medium`. They also enable server-side refusal fallback (`fallbacks: "default"`). Vision responses use a strict JSON schema. Any API failure falls back to the offline path instead of erroring.

### 4. Run the tests

```bash
cd smartlab-ai/backend
python -m pytest            # 208 tests, ~30 s, no network or API key needed
```

| Test file | Covers |
|---|---|
| `test_vector_search.py` | Embedder determinism, NumPy + FAISS stores (add/search/filter/persist/replace), page-preserving extraction, footer removal, chunking, retrieval of the right page, index rebuild |
| `test_citations.py` | Every grounded answer carries valid page citations; facts cited from the exact page; hallucinated `[S#]` dropped; uncited LLM output rejected; tampering detected; highlighted page preview |
| `test_uncertainty.py` | Off-topic → `insufficient` with no invented values; empty index; partial evidence flagged; LLM `INSUFFICIENT_EVIDENCE` respected; query guardrails (identification, medical, interlock bypass) |
| `test_vision_guardrails.py` | Identification claims detected and redacted, observations preserved, display text kept verbatim, end-to-end LLM redaction, error display → SOP page + verified fix, heuristic offline mode |
| `test_reagents.py` | Status/expiry logic, filters, SQL-injection-safe sorting, natural-language queries, stock never negative, payload validation, CRUD API |
| `test_file_validation.py` | Path traversal, spoofed extensions, oversized/empty/corrupt/encrypted/JavaScript PDFs, page limit, truncated images, decompression bomb, UTF-8 text |
| `test_troubleshooting_search.py` | Error-code extraction and ranking, symptom matching, unverified entries hidden, unified search |
| `test_experiments_reviews.py` | Checklist progress, reorder, variable log, review roll-up (approve / changes requested), profiles |
| `test_data_collaboration.py` | Dataset sort/filter/stats, CSV import, threaded comments, shared files (forced download), activity feed |
| `test_simulation_literature.py` | Model correctness (½Vmax at Km, ΔCt per 10-fold, cardinal temperature, 4PL midpoint), validation, Europe PMC parsing, offline fallback |
| `test_governance.py` | Document filters/sort/metadata/approval audit, version listing, re-index, conversation history, answer feedback → review queue → resolve, safety endpoints, settings, reagent audit, literature year filter/sort/sample labelling, schema migration of an old database |
| `test_documents_api.py` | Upload → query → delete cycle, duplicate detection, text-less PDF, equipment tour, Claude client request shape / refusal / JSON |

---

## Configuration

All settings are environment variables (see `backend/app/config.py` and `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | - | Enables Claude features |
| `SMARTLAB_LLM_MODEL` | `claude-opus-5-5` | Model id |
| `SMARTLAB_LLM_EFFORT` | `medium` | `low` … `max` |
| `SMARTLAB_EMBEDDINGS` | `auto` | `auto` / `sentence-transformers` / `hashing` |
| `SMARTLAB_VECTOR_STORE` | `auto` | `auto` / `faiss` / `numpy` |
| `SMARTLAB_MIN_EVIDENCE_SCORE` | per embedder | Evidence threshold override |
| `SMARTLAB_CHUNK_SIZE` / `_OVERLAP` | `700` / `120` | Chunking |
| `SMARTLAB_MAX_UPLOAD_MB` | `25` | Upload limit |
| `SMARTLAB_LITERATURE_ONLINE` | `true` | Use Europe PMC (false = offline sample corpus) |
| `SMARTLAB_DATA_DIR` | `backend/instance` | DB, uploads, index |
| `SMARTLAB_CORS_ORIGINS` | `http://localhost:5173,...` | Allowed browser origins |
| `SMARTLAB_SEED_DEMO` | `true` | Seed demo data into an empty DB |

**Production:** serve with a WSGI server (`waitress-serve --port=5000 --call app:create_app` on Windows, or `gunicorn "app:create_app()"`). Set `SMARTLAB_SECRET_KEY` and put the API behind authentication: the demo has no login, and the "current user" is fixed in `AppContext.jsx`. For multi-user scale, move to PostgreSQL. The SQL is portable apart from `AUTOINCREMENT`.

## Upgrading an existing database

New columns (document metadata, reagent category) are added automatically on start-up. Existing documents become *Unreviewed* in category *General*; set their status in Documents. To reload the demo data instead, stop the server and delete `backend/instance/`.

## Known limitations
- No user accounts, roles or permissions yet: anyone who can reach the server can approve documents and edit records. Run it only on a trusted network.
- Conflict detection covers *versions of the same document* (shared document code). Contradictions between different documents are not detected.
- Scanned (image-only) PDFs are rejected with a clear message; run OCR first.
- Offline image analysis is heuristic (colours, brightness, indicator lights). Reading text off a display needs the Claude vision path, or the user can type the code into the note.
- Collaboration updates use 5 s polling, not WebSockets.
- Authentication and authorisation are out of scope for this build.
