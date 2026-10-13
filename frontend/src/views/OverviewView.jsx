import { useRef } from "react";
import { AlertTriangle, BookOpen, Boxes, Camera, ChevronRight, FileSearch, FileText, MessageSquareText, UploadCloud } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { setPendingQuestion } from "../lib/pending";
import { navigate } from "../lib/router";
import Composer, { ATTACH_ACCEPT, checkAttachment } from "../components/Composer";
import { ApprovalBadge, Page, Skeleton, useAsync } from "../components/ui";

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

function Section({ title, href, linkLabel, children }) {
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

export default function OverviewView() {
  const { toast, health } = useApp();
  const imageInput = useRef(null);
  const sessions = useAsync(() => api.sessions(5), []);
  const docs = useAsync(() => api.documents({ sort: "updated_at", order: "desc" }), []);
  const summary = useAsync(() => api.reagentSummary(), []);

  const ask = (question) => { setPendingQuestion(question); navigate("ask"); };
  const pickImage = (file) => {
    if (!file) return;
    const check = checkAttachment(file, health?.max_upload_mb ?? 25);
    if (check.error || check.kind !== "image") { toast(check.error ?? "Choose a PNG, JPEG or WebP image.", "error"); return; }
    setPendingQuestion("", file, { attachOnly: true });
    navigate("ask");
  };

  const allDocs = docs.data ?? [];
  const needsReview = allDocs.filter((d) => d.approval_status === "pending" || d.approval_status === "unreviewed");
  const reagentAlerts = summary.data ? [...summary.data.expired, ...summary.data.expiring_soon] : [];
  const firstRun = !docs.loading && allDocs.length === 0;

  return (
    <Page width="max-w-5xl">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold tracking-tight">What are you investigating today?</h1>
        <p className="mt-1 text-sm text-muted">Ask questions across your laboratory documents and discover the evidence behind every answer.</p>
      </div>

      <div className="mt-5">
        <Composer onSubmit={ask} busy={false} placeholder="Ask about a procedure, document, experiment, or reagent..." autoFocus />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <QuickAction icon={FileSearch} label="Search SOPs" description="Find passages in your documents" href="#/search" />
        <QuickAction icon={Camera} label="Analyze image" description="Ask about an equipment display or sample" onClick={() => imageInput.current?.click()} />
        <QuickAction icon={Boxes} label="Find reagent" description="Stock, location, expiry, storage" href="#/reagents" />
        <QuickAction icon={BookOpen} label="Explore literature" description="Search published research" href="#/literature" />
      </div>
      <input ref={imageInput} type="file" hidden accept={ATTACH_ACCEPT.replace(".pdf,", "")} onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ""; }} />

      {firstRun ? (
        <section className="card mt-8 flex flex-col items-center gap-2 px-6 py-10 text-center">
          <UploadCloud className="h-6 w-6 text-accent-strong" aria-hidden="true" />
          <h2 className="text-base font-semibold">Add your first document</h2>
          <p className="max-w-md text-sm text-muted">SmartLab answers from the SOPs, manuals and safety documents you upload. Text-based PDFs work best.</p>
          <a className="btn-primary mt-2" href="#/documents?upload=1">Upload a PDF</a>
        </section>
      ) : (
        <div className="mt-8 grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <Section title="Recent conversations" href="#/ask" linkLabel="Open Ask">
            {sessions.loading ? <div className="p-4"><Skeleton className="h-24" /></div> : !sessions.data?.length ? (
              <p className="px-4 py-6 text-sm text-muted">No conversations yet. Questions you ask will appear here.</p>
            ) : (
              <ul className="divide-y divide-line">
                {sessions.data.map((s) => (
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
          </Section>

          <Section title="Recently updated documents" href="#/documents" linkLabel="All documents">
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
          </Section>

          {(needsReview.length > 0 || reagentAlerts.length > 0) && (
            <Section title="Needs attention">
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
            </Section>
          )}
        </div>
      )}
    </Page>
  );
}
