import { useEffect, useState } from "react";
import { Boxes, FileText, Search, Wrench } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { ApprovalBadge, Badge, EmptyState, ErrorState, Page, PageHeader, SkeletonRows, StatusBadge } from "../components/ui";

/** One query across document passages, reagent records and the troubleshooting database. */
export default function SearchView({ route }) {
  const { openEvidence } = useApp();
  const initial = route.query.q ?? "";
  const [q, setQ] = useState(initial);
  const [state, setState] = useState({ loading: false, data: null, error: null });

  const run = async (query) => {
    if (query.trim().length < 2) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try { setState({ loading: false, data: await api.unifiedSearch(query.trim()), error: null }); } catch (error) { setState({ loading: false, data: null, error }); }
  };
  useEffect(() => { setQ(initial); if (initial) run(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => { e.preventDefault(); if (q.trim().length >= 2) navigate(`search?q=${encodeURIComponent(q.trim())}`); };
  const r = state.data;

  return (
    <Page width="max-w-5xl">
      <PageHeader title="Search" description="Searches document passages, reagent records and troubleshooting entries at the same time." />
      <form role="search" onSubmit={submit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden="true" />
          <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search"
            placeholder="Reagent name, procedure, error code (e.g. IMB-01)" />
        </div>
        <button className="btn-primary" disabled={q.trim().length < 2}>Search</button>
      </form>

      <div className="mt-6">
        {state.loading && <SkeletonRows rows={6} />}
        {state.error && <ErrorState error={state.error} onRetry={() => run(initial)} />}
        {!state.loading && !r && !state.error && <EmptyState icon={Search} title="Search your lab's records">Results are grouped by source so you can see where each match comes from.</EmptyState>}
        {!state.loading && r && (
          r.counts.documents + r.counts.reagents + r.counts.troubleshooting === 0 ? (
            <div className="card"><EmptyState icon={Search} title={`No matches for "${r.query}"`}>Try a shorter query, a synonym, or the exact error code shown on the instrument.</EmptyState></div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <section>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-muted" /> Document passages <span className="font-normal text-muted">{r.counts.documents}</span></h2>
                {r.documents.length === 0 ? <p className="card px-4 py-6 text-sm text-muted">No document passage is relevant enough.</p> : (
                  <ol className="card divide-y divide-line">
                    {r.documents.map((d, i) => (
                      <li key={d.chunk_id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button className="text-left text-sm font-medium hover:text-accent-strong hover:underline"
                            onClick={() => openEvidence({ ...d, n: i + 1 }, r.documents.map((x, j) => ({ ...x, n: j + 1 })))}>
                            {d.document_title}
                          </button>
                          <span className="meta">· page {d.page}</span>
                          {d.version && <Badge>v{d.version}</Badge>}
                          <ApprovalBadge status={d.approval_status} />
                        </div>
                        <p className="mt-1 max-w-prose text-sm leading-6 text-ink">{d.snippet}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <div className="space-y-5">
                <section>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Boxes className="h-4 w-4 text-muted" /> Reagents <span className="font-normal text-muted">{r.counts.reagents}</span></h2>
                  {r.inventory_answer && <p className="mb-2 rounded-lg border border-line bg-surface p-3 text-sm">{r.inventory_answer}</p>}
                  {r.reagents.length === 0 ? <p className="text-sm text-muted">No matching reagent records.</p> : (
                    <ul className="card divide-y divide-line">
                      {r.reagents.map((x) => (
                        <li key={x.id} className="px-3 py-2.5 text-sm">
                          <div className="flex items-start justify-between gap-2"><a className="font-medium hover:text-accent-strong" href="#/reagents">{x.name}</a><StatusBadge status={x.status} /></div>
                          <p className="meta">{x.quantity} {x.unit} · {x.location}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Wrench className="h-4 w-4 text-muted" /> Troubleshooting <span className="font-normal text-muted">{r.counts.troubleshooting}</span></h2>
                  {r.troubleshooting.length === 0 ? <p className="text-sm text-muted">No matching entries.</p> : (
                    <ul className="card divide-y divide-line">
                      {r.troubleshooting.map((t) => (
                        <li key={t.id} className="px-3 py-2.5 text-sm">
                          <p className="font-medium">{t.error_code && <code className="mr-1 font-mono text-xs">{t.error_code}</code>}{t.symptom}</p>
                          <p className="mt-0.5 text-muted">{t.fix}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          )
        )}
      </div>
    </Page>
  );
}
