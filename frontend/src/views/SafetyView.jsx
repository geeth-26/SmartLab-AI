import { useState } from "react";
import { FileText, Phone, Search, ShieldAlert } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { ApprovalBadge, EmptyState, ErrorState, Notice, Page, PageHeader, SkeletonRows, Spinner, useAsync } from "../components/ui";

export default function SafetyView() {
  const { openEvidence } = useApp();
  const data = useAsync(() => api.safety(), []);
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const search = async (e) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    setSearchError(null);
    try { setResults(await api.safetySearch(q.trim())); } catch (err) { setSearchError(err); } finally { setSearching(false); }
  };

  const s = data.data;
  return (
    <Page width="max-w-5xl">
      <PageHeader title="Safety resources" description="Approved safety documents, recorded hazard information and your institution's emergency contacts." />
      <Notice tone="critical" title="In an emergency, do not rely on this page" className="mb-5">
        Use the eyewash or safety shower, evacuate if needed, and call your institution's emergency number.
        {s?.disclaimer && <span className="block text-muted">{s.disclaimer}</span>}
      </Notice>

      {data.error ? <div className="card"><ErrorState error={data.error} onRetry={data.reload} /></div> : data.loading ? <SkeletonRows rows={6} /> : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
            <section className="card-pad">
              <h2 className="text-sm font-semibold">Search safety documents</h2>
              <p className="meta mb-3">Returns passages from documents in the Safety category only, with their page. Nothing is generated.</p>
              <form onSubmit={search} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden="true" />
                  <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search safety documents" placeholder="e.g. eye exposure, spill under 500 mL, unlabelled container" />
                </div>
                <button className="btn-primary" disabled={searching || q.trim().length < 2}>{searching && <Spinner />} Search</button>
              </form>
              {searchError && <p role="alert" className="mt-3 text-sm text-critical">{searchError.message}</p>}
              {results && (
                results.results.length === 0 ? (
                  <p className="mt-4 text-sm text-muted">No passage in the {results.searched_documents} safety document(s) matches this search. Check the relevant safety data sheet or contact your safety office.</p>
                ) : (
                  <ol className="mt-4 divide-y divide-line rounded-lg border border-line">
                    {results.results.map((r, i) => (
                      <li key={r.chunk_id} className="px-3 py-2.5">
                        <button className="text-left text-sm font-medium hover:text-accent-strong hover:underline"
                          onClick={() => openEvidence({ ...r, n: i + 1 }, results.results.map((x, j) => ({ ...x, n: j + 1 })))}>
                          {r.document_title} <span className="font-normal text-muted">· page {r.page}</span>
                        </button>
                        <p className="mt-1 text-sm leading-6">{r.snippet}</p>
                      </li>
                    ))}
                  </ol>
                )
              )}
            </section>

            <section className="card">
              <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Safety documents</h2>
              {s.documents.length === 0 ? (
                <EmptyState icon={FileText} title="No safety documents" action={<a className="btn-secondary btn-sm" href="#/documents?upload=1">Upload a document</a>}>
                  Upload your safety procedures and set their category to "Safety".
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {s.documents.map((d) => (
                    <li key={d.id}>
                      <a href={`#/documents/${d.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-canvas">
                        <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{d.title}</span>
                          <span className="block text-xs text-muted">{d.version ? `Version ${d.version}` : "No version recorded"} · Reviewed {d.reviewed_at ? formatDate(d.reviewed_at) : "date not recorded"}</span>
                        </span>
                        <ApprovalBadge status={d.approval_status} />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Reagents with a recorded hazard classification</h2>
              {s.hazardous_reagents.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No hazard classifications are recorded in the inventory.</p> : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th>Reagent</th><th>Recorded hazard</th><th>Storage (as recorded)</th></tr></thead>
                    <tbody>
                      {s.hazardous_reagents.map((r) => (
                        <tr key={r.id}><td className="font-medium">{r.name}{r.cas_number && <p className="meta">CAS {r.cas_number}</p>}</td><td>{r.hazard_class}</td><td className="text-muted">{r.storage_condition}{r.location && ` · ${r.location}`}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="meta px-4 py-2">From inventory records. Always consult the supplier's safety data sheet for handling and first aid.</p>
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-5">
            <section className="card-pad">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Phone className="h-4 w-4 text-muted" aria-hidden="true" /> Emergency contacts</h2>
              {s.emergency_contacts
                ? <p className="whitespace-pre-line text-sm leading-6">{s.emergency_contacts}</p>
                : <p className="text-sm text-muted">Not configured. SmartLab does not provide emergency numbers. <a className="link" href="#/settings">Add your institution's contacts in Settings.</a></p>}
            </section>
            <section className="card-pad">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="h-4 w-4 text-muted" aria-hidden="true" /> Safety office</h2>
              {s.safety_office ? <p className="whitespace-pre-line text-sm leading-6">{s.safety_office}</p> : <p className="text-sm text-muted">Not configured. <a className="link" href="#/settings">Add it in Settings.</a></p>}
            </section>
          </aside>
        </div>
      )}
    </Page>
  );
}
