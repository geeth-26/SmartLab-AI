import { useState } from "react";
import { Wrench } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { Badge, EmptyState, ErrorState, Page, PageHeader, SkeletonRows, Spinner, useAsync } from "../components/ui";

const EXAMPLES = ["HPLC shows E-104 and the pump stopped", "Centrifuge vibrates and stops", "Medium turned cloudy and yellow",
  "Cells won't detach after trypsin", "qPCR Ct values are late"];

function FixRow({ t, onSource }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {t.error_code && <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-xs font-semibold">{t.error_code}</code>}
        <p className="text-sm font-medium">{t.equipment}</p>
        <span className="text-sm text-muted">{t.symptom}</span>
        <span className="ml-auto">{t.verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Unverified</Badge>}</span>
      </div>
      <p className="mt-1.5 text-sm"><span className="text-muted">Possible cause: </span>{t.probable_cause}</p>
      <p className="mt-1 max-w-prose text-sm"><span className="text-muted">Fix: </span>{t.fix}</p>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
        {t.match_reasons?.length > 0 && <span>Matched on {t.match_reasons.join("; ")}</span>}
        {t.source_document ? <button className="link" onClick={() => onSource(t)}>Source: {t.source_document}, p. {t.source_page}</button> : <span>No source document recorded</span>}
      </div>
    </li>
  );
}

export default function TroubleshootingView() {
  const { openEvidence, toast } = useApp();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const all = useAsync(() => api.troubleshooting(), []);
  const docs = useAsync(() => api.documents(), []);

  const run = async (q) => {
    setQuery(q);
    if (!q.trim()) return;
    setBusy(true);
    try { setMatches((await api.matchTroubleshooting(q)).matches); } catch (err) { toast(err.message, "error"); } finally { setBusy(false); }
  };

  const openSource = (t) => {
    const doc = (docs.data ?? []).find((d) => d.title === t.source_document && d.approval_status === "approved")
      ?? (docs.data ?? []).find((d) => d.title === t.source_document);
    if (doc) openEvidence({ document_id: doc.id, document_title: doc.title, page: t.source_page, snippet: t.error_code || "",
      version: doc.version, approval_status: doc.approval_status, doc_type: doc.doc_type, category: doc.category });
    else toast("The source document is no longer in the document library.", "warning");
  };

  return (
    <Page width="max-w-4xl">
      <PageHeader title="Troubleshooting" description="Match an error code or symptom to recorded fixes. Only verified entries are suggested; new entries stay unverified until reviewed." />
      <form onSubmit={(e) => { e.preventDefault(); run(query); }} className="flex gap-2">
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Describe the problem"
          placeholder="Describe the symptom and include any code shown on the display" />
        <button className="btn-primary" disabled={busy || !query.trim()}>{busy && <Spinner />} Find fixes</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => run(e)}>{e}</button>)}</div>

      {matches && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Best matches</h2>
          {matches.length === 0
            ? <div className="card"><EmptyState icon={Wrench} title="No verified fix matches">Try other keywords, or ask SmartLab to search the instrument manuals.</EmptyState></div>
            : <ul className="card divide-y divide-line">{matches.map((t) => <FixRow key={t.id} t={t} onSource={openSource} />)}</ul>}
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">All recorded fixes <span className="font-normal text-muted">{all.data?.length ?? ""}</span></h2>
        {all.error ? <ErrorState error={all.error} onRetry={all.reload} /> : all.loading ? <SkeletonRows rows={4} className="h-20" /> :
          <ul className="card divide-y divide-line">{all.data.map((t) => <FixRow key={t.id} t={t} onSource={openSource} />)}</ul>}
      </section>
    </Page>
  );
}
