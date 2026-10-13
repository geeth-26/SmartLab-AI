import { useState } from "react";
import { BookOpen, Check, ChevronDown, Copy, ExternalLink, FileText, Search } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { copyText, formatDate, formatDateTime } from "../lib/format";
import { Badge, EmptyState, ErrorState, Notice, Page, PageHeader, Skeleton, Spinner } from "../components/ui";

function citationText(p) {
  return [p.authors, p.year && `(${p.year})`, p.title && `${p.title.replace(/\.$/, "")}.`, p.journal && `${p.journal}.`, p.doi && `https://doi.org/${p.doi}`]
    .filter(Boolean).join(" ");
}

function Paper({ p, onSource }) {
  const [showAbstract, setShowAbstract] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <li className="py-4">
      <div className="flex items-start gap-2">
        <h3 className="flex-1 font-medium leading-snug">
          {p.url ? <a href={p.url} target="_blank" rel="noreferrer noopener" className="hover:text-accent-strong hover:underline">{p.title}</a> : p.title}
        </h3>
        {p.is_sample && <Badge tone="warning">Sample record</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted">
        {[p.authors, p.journal, p.publication_date ? `Published ${formatDate(p.publication_date)}` : p.year && `Published ${p.year}`].filter(Boolean).join(" · ")}
        {p.is_open_access && " · Open access"}
      </p>
      {p.summary ? (
        <div className="mt-2 max-w-prose">
          <p className="text-sm leading-6">{p.summary}</p>
          <p className="meta mt-1">{p.summary_mode === "llm" ? "Summary generated from the abstract only" : "Key sentences quoted from the abstract"}. Full text was not read.</p>
        </div>
      ) : <p className="mt-2 text-sm text-muted">No abstract available from the source, so no summary was produced.</p>}
      {p.related_documents.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Related in your documents:</span>
          {p.related_documents.map((d) => (
            <button key={`${d.document_id}-${d.page}`} className="chip h-7" onClick={() => onSource(d)}>
              <FileText className="h-3 w-3" aria-hidden="true" />{d.document_title}, p. {d.page}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {p.abstract && (
          <button className="btn-ghost btn-sm" aria-expanded={showAbstract} onClick={() => setShowAbstract((s) => !s)}>
            Abstract <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAbstract ? "rotate-180" : ""}`} />
          </button>
        )}
        {!p.is_sample && (
          <button className="btn-ghost btn-sm" onClick={async () => { setCopied(await copyText(citationText(p))); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} Copy citation
          </button>
        )}
        {p.doi && <a className="btn-ghost btn-sm" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer noopener"><ExternalLink className="h-3.5 w-3.5" /> DOI {p.doi}</a>}
      </div>
      {showAbstract && <p className="mt-2 max-w-prose rounded-lg bg-canvas p-3 text-sm leading-6">{p.abstract}</p>}
    </li>
  );
}

export default function LiteratureView() {
  const { openEvidence } = useApp();
  const [q, setQ] = useState("");
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [sort, setSort] = useState("relevance");
  const [state, setState] = useState({ loading: false, data: null, error: null });

  const run = async (e) => {
    e?.preventDefault();
    if (q.trim().length < 3) return;
    setState({ loading: true, data: state.data, error: null });
    try {
      setState({ loading: false, data: await api.literature(q.trim(), { limit: 10, from_year: fromYear, to_year: toYear, sort }), error: null });
    } catch (error) { setState({ loading: false, data: null, error }); }
  };

  const r = state.data;
  const year = new Date().getFullYear();
  return (
    <Page width="max-w-4xl">
      <PageHeader title="Scientific literature" description="Search Europe PMC. Summaries are limited to what each abstract states; consensus across papers is not inferred." />
      <form onSubmit={run} className="card-pad space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden="true" />
            <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Literature search"
              placeholder="Keywords or a research question, e.g. trypsin stability after freeze-thaw" />
          </div>
          <button className="btn-primary" disabled={state.loading || q.trim().length < 3}>{state.loading && <Spinner />} Search</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2"><span className="text-muted">From</span>
            <input className="input h-8 w-24" type="number" min="1800" max={year} value={fromYear} onChange={(e) => setFromYear(e.target.value)} placeholder="Year" /></label>
          <label className="flex items-center gap-2"><span className="text-muted">To</span>
            <input className="input h-8 w-24" type="number" min="1800" max={year} value={toYear} onChange={(e) => setToYear(e.target.value)} placeholder="Year" /></label>
          <label className="flex items-center gap-2"><span className="text-muted">Sort</span>
            <select className="input h-8 w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="relevance">Relevance</option><option value="date">Newest first</option>
            </select></label>
        </div>
      </form>

      <div className="mt-5">
        {state.loading && <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>}
        {state.error && <div className="card"><ErrorState error={state.error} onRetry={run} title="Search failed" /></div>}
        {!state.loading && !state.error && !r && (
          <EmptyState icon={BookOpen} title="Search published research">Results show title, authors, publication date and a link to the source. Abstract-only summaries are labelled as such.</EmptyState>
        )}
        {!state.loading && r && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <Badge tone={r.source === "europe-pmc" ? "info" : "warning"}>{r.source === "europe-pmc" ? "Europe PMC" : "Offline sample data"}</Badge>
              <span>{r.papers.length} result(s)</span><span>· Retrieved {formatDateTime(r.retrieved_at)}</span>
            </div>
            {r.warnings.map((w) => <Notice key={w} tone="warning" className="mb-2">{w}</Notice>)}
            {r.papers.length === 0 ? <div className="card"><EmptyState icon={Search} title="No papers found">Try broader keywords or remove the year filter.</EmptyState></div> : (
              <ul className="card divide-y divide-line px-4 sm:px-5">
                {r.papers.map((p) => <Paper key={p.id} p={p} onSource={(d) => openEvidence({ ...d, snippet: "" })} />)}
              </ul>
            )}
          </>
        )}
      </div>
    </Page>
  );
}
