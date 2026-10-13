import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Download, FileText, MessageSquareText, RefreshCw, Search, Trash2, UploadCloud } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { formatBytes, formatDate, formatDateTime, plural } from "../lib/format";
import { setPendingQuestion } from "../lib/pending";
import { navigate } from "../lib/router";
import {
  ApprovalBadge, Badge, Dialog, Drawer, DropZone, EmptyState, ErrorState, Field, Notice, Page, PageHeader, ProgressBar,
  SkeletonRows, Spinner, useAsync, useDebounced,
} from "../components/ui";

const STATUS_FILTERS = [
  { id: "", label: "All statuses" }, { id: "approved", label: "Approved" }, { id: "review", label: "Needs review" },
  { id: "pending", label: "Pending" }, { id: "unreviewed", label: "Unreviewed" }, { id: "outdated", label: "Outdated" },
];
const COLUMNS = [
  ["title", "Document"], ["category", "Category"], ["version", "Version"], ["approval_status", "Status"],
  ["owner", "Owner"], ["updated_at", "Updated"],
];
const EMPTY_META = { title: "", doc_code: "", version: "", category: "", owner: "", doc_type: "SOP" };

function MetadataFields({ value, onChange, categories, includeStatus }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Title" className="sm:col-span-2" hint={includeStatus ? undefined : "Leave blank to use the PDF's own title."}>
        {(id) => <input id={id} className="input" value={value.title} onChange={set("title")} maxLength={200} />}
      </Field>
      <Field label="Document code" hint="Shared by all versions, e.g. SOP-HPLC-004">
        {(id) => <input id={id} className="input" value={value.doc_code ?? ""} onChange={set("doc_code")} maxLength={120} />}
      </Field>
      <Field label="Version">{(id) => <input id={id} className="input" value={value.version ?? ""} onChange={set("version")} maxLength={40} placeholder="e.g. 2.1" />}</Field>
      <Field label="Category">
        {(id) => (
          <>
            <input id={id} className="input" list="doc-categories" value={value.category ?? ""} onChange={set("category")} placeholder="e.g. Safety, Instrument" />
            <datalist id="doc-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </>
        )}
      </Field>
      <Field label="Type">
        {(id) => (
          <select id={id} className="input" value={value.doc_type} onChange={set("doc_type")}>
            {["SOP", "Manual", "Safety data sheet", "Troubleshooting guide", "Policy", "Paper", "Other"].map((t) => <option key={t}>{t}</option>)}
          </select>
        )}
      </Field>
      <Field label="Owner">{(id) => <input id={id} className="input" value={value.owner ?? ""} onChange={set("owner")} maxLength={120} />}</Field>
      {includeStatus && (
        <Field label="Approval status" hint="Changes are recorded in the document history.">
          {(id) => (
            <select id={id} className="input" value={value.approval_status} onChange={set("approval_status")}>
              <option value="approved">Approved</option><option value="pending">Pending review</option>
              <option value="unreviewed">Unreviewed</option><option value="outdated">Outdated</option>
            </select>
          )}
        </Field>
      )}
    </div>
  );
}

function UploadDialog({ open, onClose, onUploaded, categories, maxMB }) {
  const { toast } = useApp();
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState(EMPTY_META);
  const [state, setState] = useState(null); // {phase, progress} | {phase:"error", message}

  useEffect(() => { if (open) { setFile(null); setMeta(EMPTY_META); setState(null); } }, [open]);
  const working = state?.phase === "uploading" || state?.phase === "processing";

  const start = async () => {
    setState({ phase: "uploading", progress: 0 });
    try {
      const doc = await api.uploadDocument(file, meta, {
        onProgress: (p) => setState(p >= 1 ? { phase: "processing" } : { phase: "uploading", progress: p }),
      });
      toast(`"${doc.title}" indexed: ${plural(doc.page_count, "page")}, ${plural(doc.chunk_count, "passage")}. Marked Unreviewed until approved.`, "success");
      onUploaded(doc);
    } catch (err) {
      setState({ phase: "error", message: err.message, existing: err.status === 409 ? err.data?.document : null });
    }
  };

  return (
    <Dialog open={open} onClose={() => !working && onClose()} title="Upload document" size="max-w-xl"
      description="Text-based PDFs only. Scanned PDFs need OCR before upload."
      footer={<>
        <button className="btn-secondary" onClick={onClose} disabled={working}>Cancel</button>
        <button className="btn-primary" disabled={!file || working} onClick={start}>
          {working && <Spinner />}{state?.phase === "error" ? "Retry upload" : "Upload and index"}
        </button>
      </>}>
      <div className="space-y-4">
        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-3">
            <FileText className="h-5 w-5 text-muted" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="meta">{formatBytes(file.size)}</p>
            </div>
            {!working && <button className="btn-ghost btn-sm" onClick={() => { setFile(null); setState(null); }}>Change</button>}
          </div>
        ) : (
          <DropZone accept=".pdf" maxMB={maxMB} onFiles={([f]) => setFile(f)} label="Drop a PDF here or choose a file" hint={`PDF up to ${maxMB} MB`} />
        )}
        {state?.phase === "uploading" && <div className="space-y-1"><ProgressBar value={state.progress} label="Upload progress" /><p className="meta">Uploading {Math.round(state.progress * 100)}%</p></div>}
        {state?.phase === "processing" && <p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Validating, extracting pages and indexing passages...</p>}
        {state?.phase === "error" && (
          <Notice tone="critical" title="Upload failed"
            action={state.existing && <button className="btn-secondary btn-sm" onClick={() => { onClose(); navigate(`documents/${state.existing.id}`); }}>Open existing document</button>}>
            {state.message}
          </Notice>
        )}
        <MetadataFields value={meta} onChange={setMeta} categories={categories} />
        <p className="meta">New documents start as <strong>Unreviewed</strong>. Answers that cite them are flagged until they are approved.</p>
      </div>
    </Dialog>
  );
}

function DocumentDrawer({ id, page, onClose, onChanged, categories }) {
  const { toast, confirm, openEvidence } = useApp();
  const doc = useAsync(() => api.document(id), [id]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [selectedPage, setSelectedPage] = useState(page ?? null);
  const pageText = useAsync(() => (selectedPage ? api.pageText(id, selectedPage) : Promise.resolve(null)), [id, selectedPage]);

  useEffect(() => {
    if (doc.data) setForm({ ...EMPTY_META, ...Object.fromEntries(Object.entries(doc.data).map(([k, v]) => [k, v ?? ""])) });
  }, [doc.data]);

  const d = doc.data;
  const dirty = d && form && ["title", "doc_code", "version", "category", "owner", "doc_type", "approval_status"].some((k) => (d[k] ?? "") !== form[k]);

  const save = async () => {
    if (form.approval_status !== d.approval_status && form.approval_status === "approved" &&
      !(await confirm({ title: "Approve this document?", message: `"${form.title}" will be treated as a current approved source in answers. This change is recorded in the document history.`, confirmLabel: "Approve" }))) return;
    setSaving(true);
    try {
      const payload = Object.fromEntries(["title", "doc_code", "version", "category", "owner", "doc_type", "approval_status"].map((k) => [k, form[k]]));
      await api.updateDocument(id, payload);
      toast("Document details saved.", "success");
      doc.reload();
      onChanged();
    } catch (err) { toast(err.message, "error"); } finally { setSaving(false); }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const r = await api.reindexDocument(id);
      toast(`Re-indexed: ${r.chunk_count} passages from ${r.page_count} pages.`, "success");
      doc.reload();
      onChanged();
    } catch (err) { toast(err.message, "error"); } finally { setReindexing(false); }
  };

  const remove = async () => {
    if (!(await confirm({ title: "Remove document?", message: `"${d.title}" will be deleted and no longer used for answers. Existing conversations keep their text but its citations will no longer open.`, confirmLabel: "Remove", danger: true }))) return;
    try {
      await api.deleteDocument(id);
      toast("Document removed.", "success");
      onChanged();
      onClose();
    } catch (err) { toast(err.message, "error"); }
  };

  return (
    <Drawer open onClose={onClose} width="sm:w-[34rem]" title={d?.title ?? "Document"}
      subtitle={d && <div className="flex flex-wrap items-center gap-1.5"><ApprovalBadge status={d.approval_status} />{d.version && <Badge>v{d.version}</Badge>}<Badge>{d.doc_type}</Badge></div>}
      footer={d && form && <>
        <button className="btn-ghost mr-auto text-critical hover:bg-critical-soft hover:text-critical" onClick={remove}><Trash2 className="h-4 w-4" /> Remove</button>
        <button className="btn-secondary" onClick={() => setForm({ ...EMPTY_META, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? ""])) })} disabled={!dirty || saving}>Discard</button>
        <button className="btn-primary" onClick={save} disabled={!dirty || saving}>{saving && <Spinner />} Save changes</button>
      </>}>
      {doc.loading && !d ? <SkeletonRows rows={6} /> : doc.error ? <ErrorState error={doc.error} onRetry={doc.reload} /> : d && form && (
        <div className="space-y-6">
          {d.approval_status === "outdated" && <Notice tone="warning" title="Outdated version">This copy is kept for reference. Answers prefer the approved version when one exists.</Notice>}
          {d.other_versions.length > 0 && (
            <section>
              <h3 className="eyebrow mb-2">Other versions of {d.doc_code}</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {d.other_versions.map((v) => (
                  <li key={v.id}>
                    <a href={`#/documents/${v.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-canvas">
                      <span className="flex-1">Version {v.version ?? "unversioned"}</span><ApprovalBadge status={v.approval_status} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="eyebrow mb-2">Details</h3>
            <MetadataFields value={form} onChange={setForm} categories={categories} includeStatus />
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">File</dt><dd className="truncate">{d.original_name} ({formatBytes(d.size_bytes)})</dd>
              <dt className="text-muted">Uploaded</dt><dd>{formatDateTime(d.uploaded_at)}</dd>
              <dt className="text-muted">Last reviewed</dt><dd>{d.reviewed_at ? formatDateTime(d.reviewed_at) : "Not recorded"}</dd>
              <dt className="text-muted">Indexed</dt><dd>{plural(d.page_count, "page")} · {plural(d.chunk_count, "passage")}</dd>
            </dl>
          </section>
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="eyebrow">Pages</h3>
              <div className="flex gap-1">
                <button className="btn-ghost btn-sm" onClick={() => { setPendingQuestion("", null, { scope: { id, title: d.title } }); navigate("ask"); }}
                  title="Ask questions answered only from this document"><MessageSquareText className="h-3.5 w-3.5" /> Ask this document</button>
                <button className="btn-ghost btn-sm" onClick={reindex} disabled={reindexing}>{reindexing ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} Re-index</button>
                <a className="btn-ghost btn-sm" href={api.documentFileUrl(id)} target="_blank" rel="noreferrer"><Download className="h-3.5 w-3.5" /> PDF</a>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {d.pages.map((p) => (
                <button key={p.page} onClick={() => setSelectedPage(p.page)} aria-pressed={selectedPage === p.page}
                  className={`h-8 min-w-[2rem] rounded-md border px-2 text-xs tabular-nums ${selectedPage === p.page ? "border-accent bg-accent-soft text-accent-strong" : "border-line hover:border-accent"}`}>
                  {p.page}
                </button>
              ))}
            </div>
            {selectedPage && (
              <div className="mt-3 rounded-lg border border-line">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <p className="text-xs font-medium">Extracted text · page {selectedPage}</p>
                  <button className="link text-xs" onClick={() => openEvidence({ document_id: id, document_title: d.title, page: selectedPage, snippet: "",
                    version: d.version, approval_status: d.approval_status, doc_type: d.doc_type, category: d.category })}>View page</button>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto px-3 py-2 text-sm leading-6">
                  {pageText.loading ? <SkeletonRows rows={3} className="h-4" /> : pageText.data?.chunks.map((c) => <p key={c.id} className="whitespace-pre-line">{c.text}</p>)}
                </div>
              </div>
            )}
          </section>
          {d.history.length > 0 && (
            <section>
              <h3 className="eyebrow mb-2">History</h3>
              <ol className="space-y-1.5 text-xs">
                {d.history.map((h, i) => (
                  <li key={i} className="flex gap-2"><span className="w-32 shrink-0 text-muted">{formatDateTime(h.created_at)}</span><span>{h.summary}{h.actor && <span className="text-muted"> · {h.actor}</span>}</span></li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

export default function DocumentsView({ route }) {
  const { health } = useApp();
  const openId = route.path[1] ? Number(route.path[1]) : null;
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState(route.query.status ?? "");
  const [sort, setSort] = useState({ key: "updated_at", order: "desc" });
  const [uploadOpen, setUploadOpen] = useState(route.query.upload === "1");
  const search = useDebounced(q);

  const facets = useAsync(() => api.documentFacets(), []);
  const settings = useAsync(() => api.settings(), []);
  const list = useAsync(() => api.documents({
    q: search, category, status: status === "review" ? "" : status, sort: sort.key, order: sort.order,
  }), [search, category, status, sort]);

  useEffect(() => { if (route.query.status !== undefined) setStatus(route.query.status); }, [route.query.status]);

  const rows = useMemo(() => {
    const all = list.data ?? [];
    return status === "review" ? all.filter((d) => d.approval_status === "pending" || d.approval_status === "unreviewed") : all;
  }, [list.data, status]);
  const filtered = Boolean(search || category || status);
  const toggleSort = (key) => setSort((s) => ({ key, order: s.key === key && s.order === "asc" ? "desc" : "asc" }));
  const reload = () => { list.reload(); facets.reload(); };

  return (
    <Page width="max-w-7xl">
      <PageHeader title="Documents" description="SOPs, manuals and safety documents that answers are drawn from. Only approved versions are treated as current."
        actions={<button className="btn-primary" onClick={() => setUploadOpen(true)}><UploadCloud className="h-4 w-4" /> Upload</button>} />
      {settings.data?.demo_data.documents && (
        <Notice tone="info" title="Demo documents" className="mb-4">The sample SOPs were generated for demonstration and are not real laboratory procedures. Remove them before using SmartLab with real documents.</Notice>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden="true" />
            <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, code, owner or file name" aria-label="Filter documents" />
          </div>
          <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>{facets.data?.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Approval status">
            {STATUS_FILTERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          {filtered && <button className="btn-ghost btn-sm" onClick={() => { setQ(""); setCategory(""); setStatus(""); }}>Clear filters</button>}
          <span className="ml-auto text-xs text-muted">{plural(rows.length, "document")}</span>
        </div>

        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <div className="p-4"><SkeletonRows rows={5} /></div> : rows.length === 0 ? (
          filtered ? <EmptyState icon={Search} title="No documents match these filters" action={<button className="btn-secondary btn-sm" onClick={() => { setQ(""); setCategory(""); setStatus(""); }}>Clear filters</button>} />
            : <EmptyState icon={FileText} title="No documents yet" action={<button className="btn-primary" onClick={() => setUploadOpen(true)}>Upload a PDF</button>}>Upload SOPs, manuals and safety documents to start asking questions.</EmptyState>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="table">
                <thead>
                  <tr>
                    {COLUMNS.map(([key, label]) => (
                      <th key={key} aria-sort={sort.key === key ? (sort.order === "asc" ? "ascending" : "descending") : "none"}>
                        <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(key)}>
                          {label}{sort.key === key && (sort.order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                        </button>
                      </th>
                    ))}
                    <th className="text-right">Pages</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className="row-link" onClick={() => navigate(`documents/${d.id}`)}>
                      <td className="max-w-[22rem]">
                        <a href={`#/documents/${d.id}`} className="font-medium hover:text-accent-strong" onClick={(e) => e.stopPropagation()}>{d.title}</a>
                        <p className="meta">{[d.doc_code, d.doc_type].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td>{d.category}</td>
                      <td className="tabular-nums">{d.version ?? <span className="text-muted">-</span>}</td>
                      <td><ApprovalBadge status={d.approval_status} /></td>
                      <td>{d.owner ?? <span className="text-muted">-</span>}</td>
                      <td className="whitespace-nowrap text-muted">{formatDate(d.updated_at ?? d.uploaded_at)}</td>
                      <td className="text-right tabular-nums">{d.page_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile list */}
            <ul className="divide-y divide-line md:hidden">
              {rows.map((d) => (
                <li key={d.id}>
                  <a href={`#/documents/${d.id}`} className="block px-4 py-3">
                    <p className="font-medium">{d.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <ApprovalBadge status={d.approval_status} />{d.version && <span>v{d.version}</span>}<span>· {d.category}</span><span>· {formatDate(d.updated_at ?? d.uploaded_at)}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <UploadDialog open={uploadOpen} onClose={() => { setUploadOpen(false); if (route.query.upload) navigate("documents", { replace: true }); }}
        categories={facets.data?.categories ?? []} maxMB={health?.max_upload_mb ?? 25}
        onUploaded={(doc) => { setUploadOpen(false); reload(); navigate(`documents/${doc.id}`); }} />
      {openId && <DocumentDrawer key={openId} id={openId} page={route.query.page ? Number(route.query.page) : null}
        categories={facets.data?.categories ?? []} onChanged={reload} onClose={() => navigate("documents")} />}
    </Page>
  );
}
