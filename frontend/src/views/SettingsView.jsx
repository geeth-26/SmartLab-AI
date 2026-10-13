import { useEffect, useState } from "react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { Badge, ErrorState, Field, Notice, Page, PageHeader, SkeletonRows, Spinner, useAsync } from "../components/ui";

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-line py-3 last:border-0 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <dt className="text-sm text-muted">{label}</dt><dd className="text-sm">{children}</dd>
    </div>
  );
}

export default function SettingsView() {
  const { toast } = useApp();
  const settings = useAsync(() => api.settings(), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (settings.data) setForm(settings.data.editable); }, [settings.data]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { settings.setData(await api.updateSettings(form)); toast("Settings saved.", "success"); } catch (err) { toast(err.message, "error"); } finally { setSaving(false); }
  };

  if (settings.error) return <Page><ErrorState error={settings.error} onRetry={settings.reload} /></Page>;
  if (settings.loading || !form) return <Page width="max-w-3xl"><SkeletonRows rows={8} /></Page>;
  const s = settings.data;
  const dirty = Object.keys(form).some((k) => form[k] !== s.editable[k]);

  return (
    <Page width="max-w-3xl">
      <PageHeader title="Settings" description="Workspace information, AI service status and how retrieval is configured." />
      <div className="space-y-5">
        <form onSubmit={save} className="card-pad space-y-4">
          <h2 className="text-sm font-semibold">Institution</h2>
          <Field label="Institution or lab name">{(id) => <input id={id} className="input" maxLength={120} value={form.institution_name} onChange={(e) => setForm({ ...form, institution_name: e.target.value })} />}</Field>
          <Field label="Emergency contacts" hint="Shown on the Safety resources page exactly as entered. Check the numbers with your safety office.">
            {(id) => <textarea id={id} className="input" rows={4} maxLength={2000} value={form.emergency_contacts} onChange={(e) => setForm({ ...form, emergency_contacts: e.target.value })}
              placeholder={"Emergency: ...\nCampus security: ...\nPoison information: ..."} />}
          </Field>
          <Field label="Safety office">{(id) => <textarea id={id} className="input" rows={2} maxLength={500} value={form.safety_office} onChange={(e) => setForm({ ...form, safety_office: e.target.value })} placeholder="Name, location, phone, email" />}</Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={!dirty || saving} onClick={() => setForm(s.editable)}>Discard</button>
            <button className="btn-primary" disabled={!dirty || saving}>{saving && <Spinner />} Save</button>
          </div>
        </form>

        <section className="card-pad">
          <h2 className="mb-1 text-sm font-semibold">AI service</h2>
          <dl>
            <Row label="Status">{s.ai.enabled ? <Badge tone="success">Connected</Badge> : <Badge>Not configured</Badge>}</Row>
            {s.ai.enabled && <Row label="Provider and model">{s.ai.provider} · <code className="font-mono text-xs">{s.ai.model}</code></Row>}
            <Row label="Data sharing">{s.ai.disclosure}</Row>
          </dl>
          {!s.ai.enabled && <p className="meta mt-2">An administrator can enable generated answers and image reading by setting <code className="font-mono">ANTHROPIC_API_KEY</code> on the server.</p>}
        </section>

        <section className="card-pad">
          <h2 className="mb-1 text-sm font-semibold">Retrieval</h2>
          <dl>
            <Row label="Embeddings">{s.retrieval.embeddings === "hashing" ? "Keyword-based (hashing)" : s.retrieval.embeddings}</Row>
            <Row label="Vector index">{s.retrieval.vector_store} · {s.retrieval.indexed_chunks} passages indexed</Row>
            <Row label="Evidence threshold">Passages below a similarity of {s.retrieval.min_evidence_score} are not used as evidence</Row>
            <Row label="Passage size">{s.retrieval.chunk_size} characters · top {s.retrieval.top_k} passages per question</Row>
          </dl>
          <p className="meta mt-2">These are configured on the server (see the README).</p>
        </section>

        {(s.demo_data.documents || s.demo_data.records) && (
          <Notice tone="info" title="This workspace contains demo data">
            Sample SOPs and inventory records were loaded for demonstration. Delete them from Documents and Reagents, or reset the
            server's data directory, before using real laboratory content.
          </Notice>
        )}
        <Notice tone="warning" title="Not yet implemented">
          User accounts, roles and permissions. Every visitor can currently view and change all records, so run SmartLab only on a trusted network.
        </Notice>
      </div>
    </Page>
  );
}
