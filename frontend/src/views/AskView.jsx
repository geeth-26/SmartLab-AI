import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, BookOpen, Boxes, Camera, ChevronRight, FileSearch, FileText,
  History, MessageSquarePlus, MessageSquareText, Trash2, UploadCloud, X,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { formatDateTime, timeAgo } from "../lib/format";
import { takePendingQuestion } from "../lib/pending";
import { navigate } from "../lib/router";
import Composer, { ATTACH_ACCEPT, checkAttachment, makeAttachment } from "../components/Composer";
import { AnswerMessage, ErrorMessage, ImageAnswer, SystemNote, UserMessage } from "../components/Answer";
import { ApprovalBadge, Drawer, EmptyState, Skeleton, SkeletonRows, useAsync } from "../components/ui";

const STARTERS = [
  "What does HPLC error E-104 mean and how do I fix it?",
  "How long should trypsin-EDTA incubate when passaging HEK293 cells?",
  "What should I do if a culture flask looks contaminated?",
  "How should reversed-phase columns be stored overnight?",
];

const newSessionId = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "").slice(0, 32);

/** Convert stored chat rows into UI messages. */
function fromHistory(rows) {
  return rows.map((r) => {
    if (r.role === "user") return { id: r.id, role: "user", text: r.content, attachment: r.meta?.attachment ?? null };
    if (r.meta?.kind === "image") return { id: r.id, role: "image", vision: r.meta.vision, message_id: r.id, feedback: r.feedback };
    return { id: r.id, role: "answer", message_id: r.id, answer: r.content, citations: r.citations, feedback: r.feedback, ...r.meta };
  });
}

function QuickAction({ icon: Icon, label, description, onClick, href }) {
  const body = (
    <>
      <Icon className="h-4 w-4 shrink-0 text-accent-strong" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block truncate text-xs text-muted">{description}</span>
      </span>
    </>
  );
  const cls = "flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-accent-soft/40";
  return href ? <a href={href} className={cls}>{body}</a> : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

function OverviewSection({ title, href, linkLabel, children }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {href && <a href={href} className="link flex items-center gap-0.5 text-xs">{linkLabel}<ChevronRight className="h-3.5 w-3.5" /></a>}
      </div>
      {children}
    </section>
  );
}

function HistoryDrawer({ open, onClose, current }) {
  const { toast, confirm } = useApp();
  const sessions = useAsync(() => (open ? api.sessions(50) : Promise.resolve(null)), [open]);
  const remove = async (s) => {
    if (!(await confirm({ title: "Delete conversation?", message: `"${s.title}" and its answers will be permanently deleted. Feedback already sent for review is also removed.`, confirmLabel: "Delete", danger: true }))) return;
    try {
      await api.deleteSession(s.session_id);
      sessions.reload();
      if (s.session_id === current) navigate("ask");
    } catch (err) { toast(err.message, "error"); }
  };
  return (
    <Drawer open={open} onClose={onClose} title="Conversations" width="sm:w-[24rem]">
      {sessions.loading ? <SkeletonRows rows={5} /> : !sessions.data?.length ? (
        <EmptyState icon={History} title="No conversations yet">Questions you ask are saved here.</EmptyState>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {sessions.data.map((s) => (
            <li key={s.session_id} className={`group flex items-start gap-2 rounded-lg px-2 py-2 ${s.session_id === current ? "bg-accent-soft" : "hover:bg-canvas"}`}>
              <a href={`#/ask/${s.session_id}`} onClick={onClose} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.title || "Untitled"}</p>
                <p className="meta" title={formatDateTime(s.updated_at)}>{timeAgo(s.updated_at)} · {Math.ceil(s.message_count / 2)} question(s)</p>
              </a>
              <button className="btn-ghost btn-icon h-8 w-8 opacity-0 focus:opacity-100 group-hover:opacity-100" onClick={() => remove(s)} aria-label={`Delete conversation ${s.title}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export default function AskView({ route }) {
  const { toast, health } = useApp();
  const routeSession = route.path[1] ?? null;
  const [sessionId, setSessionId] = useState(routeSession);
  const [messages, setMessages] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [scope, setScope] = useState(null); // {id, title} - restrict answers to one document
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef(null);
  const ownSession = useRef(null); // session created in this view; don't reload it from the server
  const imageInputRef = useRef(null);

  const empty = !loadingHistory && messages.length === 0;

  // Overview data (fetched for landing view)
  const recentSessions = useAsync(() => (empty ? api.sessions(5) : Promise.resolve(null)), [empty]);
  const docs = useAsync(() => (empty ? api.documents({ sort: "updated_at", order: "desc" }) : Promise.resolve(null)), [empty]);
  const summary = useAsync(() => (empty ? api.reagentSummary() : Promise.resolve(null)), [empty]);

  // Load a conversation when navigating to #/ask/<id>; reset for #/ask.
  const prevRoute = useRef(routeSession);
  useEffect(() => {
    const changed = prevRoute.current !== routeSession;
    prevRoute.current = routeSession;
    setSessionId(routeSession);
    if (!routeSession) {
      if (changed) { setMessages([]); setScope(null); }
      return;
    }
    if (routeSession === ownSession.current) return;
    setScope(null);
    let alive = true;
    setLoadingHistory(true);
    api.session(routeSession)
      .then((rows) => alive && setMessages(fromHistory(rows)))
      .catch((err) => { if (alive) { toast(err.message, "error"); setMessages([]); } })
      .finally(() => alive && setLoadingHistory(false));
    return () => { alive = false; };
  }, [routeSession, toast]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  const ensureSession = () => {
    if (sessionId) return sessionId;
    const id = newSessionId();
    ownSession.current = id;
    setSessionId(id);
    navigate(`ask/${id}`, { replace: true });
    return id;
  };

  const push = (m) => setMessages((all) => [...all, { id: `${Date.now()}-${Math.random()}`, ...m }]);

  const run = useCallback(async ({ question, att, docScope }) => {
    setBusy(true);
    const sid = ensureSession();
    let targetScope = docScope;
    try {
      if (att?.kind === "pdf") {
        setUploadStatus({ phase: "uploading", progress: 0 });
        let doc;
        try {
          doc = await api.uploadDocument(att.file, {}, {
            onProgress: (p) => setUploadStatus(p >= 1 ? { phase: "processing" } : { phase: "uploading", progress: p }),
          });
          push({ role: "system", text: `Added "${doc.title}" to Documents (${doc.page_count} pages indexed, status: Unreviewed).` });
        } catch (err) {
          if (err.status !== 409 || !err.data?.document) throw err;
          doc = err.data.document;
          push({ role: "system", text: `"${doc.title}" is already in Documents; using the existing copy.` });
        }
        targetScope = { id: doc.id, title: doc.title };
        setScope(targetScope);
        if (!question) return;
      }
      if (att?.kind === "image") {
        setUploadStatus({ phase: "uploading", progress: 0 });
        const vision = await api.analyzeImage(att.file, question, {
          onProgress: (p) => setUploadStatus(p >= 1 ? { phase: "processing" } : { phase: "uploading", progress: p }),
        });
        const saved = await api.recordExchange(sid, {
          question, answer: vision.analysis.visual_description, citations: vision.sop_matches,
          attachment: { name: att.name, kind: "image" }, meta: { kind: "image", vision },
        }).catch(() => null);
        push({ role: "image", vision, message_id: saved?.message_id });
        return;
      }
      const res = await api.chat(question, sid, targetScope ? [targetScope.id] : undefined);
      push({ role: "answer", ...res });
    } catch (err) {
      push({ role: "error", error: err.message, retry: { question, att, docScope: targetScope } });
    } finally {
      setBusy(false);
      setUploadStatus(null);
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (question) => {
    const att = attachment;
    push({ role: "user", text: question, attachment: att ? { name: att.name, kind: att.kind, previewUrl: att.previewUrl } : null });
    setAttachment(null);
    run({ question, att, docScope: scope });
  };

  const retry = (msg) => {
    setMessages((all) => all.filter((m) => m !== msg));
    run(msg.retry);
  };

  const pickImage = (file) => {
    if (!file) return;
    const check = checkAttachment(file, health?.max_upload_mb ?? 25);
    if (check.error || check.kind !== "image") {
      toast(check.error ?? "Choose a PNG, JPEG or WebP image.", "error");
      return;
    }
    setAttachment(makeAttachment(file));
  };

  // Question handed over from any view or external trigger
  useEffect(() => {
    const pending = takePendingQuestion();
    if (!pending) return;
    if (pending.scope) { ownSession.current = null; setScope(pending.scope); }
    if (pending.attachOnly && pending.file) { setAttachment(makeAttachment(pending.file)); return; }
    if (pending.question || pending.file) {
      const att = pending.file ? makeAttachment(pending.file) : null;
      push({ role: "user", text: pending.question, attachment: att ? { name: att.name, kind: att.kind, previewUrl: att.previewUrl } : null });
      run({ question: pending.question, att, docScope: null });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => { ownSession.current = null; setScope(null); navigate("ask"); };
  const lastQuestion = (idx) => [...messages.slice(0, idx)].reverse().find((m) => m.role === "user")?.text;

  const allDocs = docs?.data ?? [];
  const needsReview = allDocs.filter((d) => d.approval_status === "pending" || d.approval_status === "unreviewed");
  const reagentAlerts = summary?.data ? [...summary.data.expired, ...summary.data.expiring_soon] : [];
  const firstRun = !docs?.loading && allDocs.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 sm:px-6">
        <button className="btn-ghost btn-sm" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" /> History</button>
        <button className="btn-ghost btn-sm" onClick={startNew} disabled={empty && !sessionId}><MessageSquarePlus className="h-4 w-4" /> New conversation</button>
        <div className="flex-1" />
        {health && !health.llm.enabled && (
          <span className="hidden text-xs text-muted sm:inline" title="Set ANTHROPIC_API_KEY on the server to enable generated answers and image reading">
            Offline mode: answers quote your documents directly
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto w-full px-4 py-6 sm:px-6 ${empty ? "max-w-4xl" : "max-w-3xl space-y-6"}`}>
          {loadingHistory && <div className="space-y-4"><Skeleton className="ml-auto h-10 w-2/3" /><Skeleton className="h-32 w-full" /></div>}

          {empty && (
            <div className="space-y-6 pt-1">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">What are you investigating today?</h1>
                <p className="mt-1 text-sm text-muted">
                  Ask questions across your laboratory documents and discover the evidence behind every answer.
                </p>
              </div>

              {/* Quick Actions */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <QuickAction icon={FileSearch} label="Search SOPs" description="Find passages in your documents" href="#/search" />
                <QuickAction icon={Camera} label="Analyze image" description="Ask about an equipment display or sample" onClick={() => imageInputRef.current?.click()} />
                <QuickAction icon={Boxes} label="Find reagent" description="Stock, location, expiry, storage" href="#/reagents" />
                <QuickAction icon={BookOpen} label="Explore literature" description="Search published research" href="#/literature" />
              </div>
              <input ref={imageInputRef} type="file" hidden accept={ATTACH_ACCEPT.replace(".pdf,", "")} onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ""; }} />

              {/* Suggested Questions */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Suggested questions</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {STARTERS.map((q) => (
                    <button key={q} onClick={() => submit(q)} disabled={busy}
                      className="rounded-lg border border-line bg-surface px-3 py-2.5 text-left text-sm transition-colors hover:border-accent hover:bg-accent-soft/40">
                      {q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Overview Details */}
              {firstRun ? (
                <section className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <UploadCloud className="h-6 w-6 text-accent-strong" aria-hidden="true" />
                  <h2 className="text-base font-semibold">Add your first document</h2>
                  <p className="max-w-md text-sm text-muted">SmartLab answers from the SOPs, manuals and safety documents you upload. Text-based PDFs work best.</p>
                  <a className="btn-primary mt-2" href="#/documents?upload=1">Upload a PDF</a>
                </section>
              ) : (
                <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
                  {(needsReview.length > 0 || reagentAlerts.length > 0) && (
                    <div className="lg:col-span-2">
                      <OverviewSection title="Needs attention">
                        <ul className="divide-y divide-line text-sm">
                          {needsReview.length > 0 && (
                            <li>
                              <a href="#/documents?status=review" className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                                <span className="flex-1">{needsReview.length} document(s) awaiting review or approval</span>
                                <ChevronRight className="h-4 w-4 text-muted" />
                              </a>
                            </li>
                          )}
                          {reagentAlerts.length > 0 && (
                            <li>
                              <a href="#/reagents?status=expired" className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                                <span className="flex-1">{summary.data.expired.length} reagent(s) expired, {summary.data.expiring_soon.length} expiring within 30 days</span>
                                <ChevronRight className="h-4 w-4 text-muted" />
                              </a>
                            </li>
                          )}
                        </ul>
                      </OverviewSection>
                    </div>
                  )}

                  <OverviewSection title="Recent conversations" href="#/ask" linkLabel="All history">
                    {recentSessions.loading ? <div className="p-4"><Skeleton className="h-24" /></div> : !recentSessions.data?.length ? (
                      <p className="px-4 py-6 text-sm text-muted">No conversations yet. Questions you ask will appear here.</p>
                    ) : (
                      <ul className="divide-y divide-line">
                        {recentSessions.data.slice(0, 5).map((s) => (
                          <li key={s.session_id}>
                            <a href={`#/ask/${s.session_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                              <MessageSquareText className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate text-sm">{s.title || "Untitled"}</span>
                              <span className="shrink-0 text-xs text-muted">{timeAgo(s.updated_at)}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </OverviewSection>

                  <OverviewSection title="Recently updated documents" href="#/documents" linkLabel="All documents">
                    {docs.loading ? <div className="p-4"><Skeleton className="h-24" /></div> : (
                      <ul className="divide-y divide-line">
                        {allDocs.slice(0, 5).map((d) => (
                          <li key={d.id}>
                            <a href={`#/documents/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                              <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">{d.title}</span>
                                <span className="block text-xs text-muted">{d.version ? `v${d.version} · ` : ""}{d.category}</span>
                              </span>
                              <ApprovalBadge status={d.approval_status} />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </OverviewSection>
                </div>
              )}
            </div>
          )}

          {messages.map((m, i) => {
            if (m.role === "user") return <UserMessage key={m.id} text={m.text} attachment={m.attachment} />;
            if (m.role === "answer") return <AnswerMessage key={m.id} msg={m} question={lastQuestion(i)} />;
            if (m.role === "image") return <ImageAnswer key={m.id} msg={m} />;
            if (m.role === "system") return <SystemNote key={m.id}>{m.text}</SystemNote>;
            if (m.role === "error") return <ErrorMessage key={m.id} msg={m} onRetry={() => retry(m)} />;
            return null;
          })}

          {busy && !uploadStatus && (
            <div className="space-y-2" role="status" aria-label="Searching documents">
              <p className="text-xs text-muted">Searching your documents...</p>
              <Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-10/12" /><Skeleton className="h-4 w-7/12" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-line bg-canvas px-4 pb-4 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {scope && (
            <div className="mb-2 flex items-center gap-2 text-xs">
              <FileText className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
              <span className="text-muted">Answering from</span>
              <span className="truncate font-medium">{scope.title}</span>
              <button className="btn-ghost h-6 px-1.5 text-xs" onClick={() => setScope(null)} aria-label="Search all documents again"><X className="h-3.5 w-3.5" /> All documents</button>
            </div>
          )}
          <Composer busy={busy} autoFocus attachment={attachment} uploadStatus={uploadStatus}
            onAttach={(f) => setAttachment(makeAttachment(f))} onRemoveAttachment={() => setAttachment(null)}
            maxMB={health?.max_upload_mb ?? 25}
            placeholder={attachment?.kind === "image" ? "What would you like to know about this image?" : "Ask about a procedure, document, experiment, or reagent..."}
            onSubmit={submit} />
          <p className="mt-2 text-center text-2xs text-muted">
            SmartLab can be wrong. Check the cited pages before acting, and follow your institution's procedures for safety-critical work.
          </p>
        </div>
      </div>
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} current={sessionId} />
    </div>
  );
}
