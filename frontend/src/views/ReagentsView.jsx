import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Boxes, FileSearch, Plus, Search, ShieldAlert, Sparkles, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { navigate } from "../lib/router";
import {
  Badge, Dialog, Drawer, EmptyState, ErrorState, Field, Notice, Page, PageHeader, SkeletonRows, Spinner, StatusBadge,
  useAsync, useDebounced,
} from "../components/ui";

const STATUS_FILTERS = [
  { id: "", label: "All" }, { id: "low_stock", label: "Low stock" }, { id: "expiring_soon", label: "Expires soon" },
  { id: "expired", label: "Expired" },
];
const FIELDS = [
  ["name", "Name", "text", true], ["category", "Category", "text"], ["cas_number", "CAS number", "text"],
  ["catalog_number", "Catalog number", "text"], ["lot_number", "Lot number", "text"], ["supplier", "Supplier", "text"],
  ["quantity", "Quantity", "number", true], ["unit", "Unit", "text", true], ["reorder_threshold", "Reorder at", "number"],
  ["location", "Storage location", "text"], ["storage_condition", "Recorded storage requirements", "text"],
  ["hazard_class", "Hazard classification (as recorded)", "text"], ["expiry_date", "Expiry date", "date"], ["notes", "Notes", "text"],
];
const blank = () => Object.fromEntries(FIELDS.map(([k]) => [k, k === "unit" ? "mL" : ""]));

function expiryText(r) {
  if (r.days_to_expiry == null) return "No expiry recorded";
  if (r.days_to_expiry < 0) return `Expired ${-r.days_to_expiry} days ago`;
  if (r.days_to_expiry === 0) return "Expires today";
  return `In ${r.days_to_expiry} days`;
}

function ReagentForm({ open, initial, onClose, onSaved, categories }) {
  const { toast } = useApp();
  const [form, setForm] = useState(blank());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setForm(initial ? { ...blank(), ...Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v ?? ""])) } : blank()); }, [open, initial]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    const payload = Object.fromEntries(FIELDS.map(([k]) => [k, form[k]]));
    try {
      const saved = initial ? await api.updateReagent(initial.id, payload) : await api.createReagent(payload);
      toast(initial ? "Reagent updated." : "Reagent added.", "success");
      onSaved(saved);
    } catch (err) { toast(err.message, "error"); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title={initial ? `Edit ${initial.name}` : "Add reagent"} size="max-w-2xl"
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button form="reagent-form" className="btn-primary" disabled={busy}>{busy && <Spinner />} Save</button></>}>
      <form id="reagent-form" onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label, type, required]) => (
          <Field key={k} label={`${label}${required ? " *" : ""}`} className={["name", "storage_condition", "hazard_class", "notes"].includes(k) ? "sm:col-span-2" : ""}>
            {(id) => (
              <>
                <input id={id} className="input" type={type} required={required} value={form[k]} step="any" min={type === "number" ? 0 : undefined}
                  list={k === "category" ? "reagent-categories" : undefined} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                {k === "category" && <datalist id="reagent-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>}
              </>
            )}
          </Field>
        ))}
        <p className="meta sm:col-span-2">Record storage and hazard information exactly as stated on the supplier's SDS. SmartLab does not fill these in.</p>
      </form>
    </Dialog>
  );
}

function ReagentDrawer({ id, onClose, onChanged, onEdit }) {
  const { toast, confirm } = useApp();
  const r = useAsync(() => api.reagent(id), [id]);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const adjust = async (sign) => {
    const value = Number(amount);
    if (!value || value <= 0) { toast("Enter an amount greater than zero.", "warning"); return; }
    setBusy(true);
    try {
      const updated = await api.adjustReagent(id, sign * value);
      r.setData(updated);
      setAmount("");
      toast(`${updated.name}: ${updated.quantity} ${updated.unit} now recorded.`, updated.low_stock ? "warning" : "success");
      onChanged();
    } catch (err) { toast(err.message, "error"); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await confirm({ title: "Delete reagent record?", message: `The record for "${r.data.name}" will be permanently deleted.`, confirmLabel: "Delete", danger: true }))) return;
    try { await api.deleteReagent(id); toast("Reagent deleted.", "success"); onChanged(); onClose(); } catch (err) { toast(err.message, "error"); }
  };

  const d = r.data;
  return (
    <Drawer open onClose={onClose} title={d?.name ?? "Reagent"} subtitle={d && <div className="flex items-center gap-1.5"><StatusBadge status={d.status} />{d.category && <Badge>{d.category}</Badge>}</div>}
      footer={d && <><button className="btn-ghost mr-auto text-critical hover:bg-critical-soft hover:text-critical" onClick={remove}>Delete</button><button className="btn-secondary" onClick={() => onEdit(d)}>Edit record</button></>}>
      {r.loading && !d ? <SkeletonRows rows={6} /> : r.error ? <ErrorState error={r.error} onRetry={r.reload} /> : d && (
        <div className="space-y-6">
          <section>
            <h3 className="eyebrow mb-2">Stock</h3>
            <p className="text-2xl font-semibold tabular-nums">{d.quantity} <span className="text-base font-normal text-muted">{d.unit}</span></p>
            <p className="meta">Reorder at {d.reorder_threshold} {d.unit}{d.low_stock ? " · at or below reorder level" : ""}</p>
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); adjust(-1); }}>
              <Field label={`Amount (${d.unit})`}>{(fid) => <input id={fid} className="input w-28" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
              <button type="submit" className="btn-secondary" disabled={busy}>Record use</button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => adjust(1)}>Record restock</button>
            </form>
            <p className="field-hint">Stock cannot go below zero. Every change is logged in Recent activity.</p>
          </section>
          <section>
            <h3 className="eyebrow mb-2">Storage and expiry</h3>
            <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Location</dt><dd>{d.location || "Not recorded"}</dd>
              <dt className="text-muted">Storage requirements</dt><dd>{d.storage_condition || "Not recorded"}</dd>
              <dt className="text-muted">Expiry</dt>
              <dd>{d.expiry_date ? formatDate(d.expiry_date) : "Not recorded"} <span className={d.status === "expired" ? "text-critical" : d.status === "expiring_soon" ? "text-warning-ink" : "text-muted"}>({expiryText(d)})</span></dd>
            </dl>
            {d.status === "expired" && <Notice tone="critical" title="Expired" className="mt-3">Do not use for experiments. Follow your lab's disposal procedure for expired reagents.</Notice>}
          </section>
          <section>
            <h3 className="eyebrow mb-2">Identification</h3>
            <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">CAS number</dt><dd className="font-mono text-xs">{d.cas_number || "-"}</dd>
              <dt className="text-muted">Catalog number</dt><dd className="font-mono text-xs">{d.catalog_number || "-"}</dd>
              <dt className="text-muted">Lot</dt><dd className="font-mono text-xs">{d.lot_number || "-"}</dd>
              <dt className="text-muted">Supplier</dt><dd>{d.supplier || "-"}</dd>
            </dl>
          </section>
          <section>
            <h3 className="eyebrow mb-2">Safety</h3>
            {d.hazard_class
              ? <p className="flex items-start gap-2 text-sm"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" /><span><span className="text-muted">Recorded hazard classification: </span>{d.hazard_class}</span></p>
              : <p className="text-sm text-muted">No hazard classification recorded. Check the supplier's safety data sheet.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-secondary btn-sm" onClick={() => navigate(`search?q=${encodeURIComponent(d.name.split(",")[0])}`)}><FileSearch className="h-3.5 w-3.5" /> Find in documents</button>
              <a className="btn-secondary btn-sm" href="#/safety"><ShieldAlert className="h-3.5 w-3.5" /> Safety resources</a>
            </div>
          </section>
          {d.notes && <section><h3 className="eyebrow mb-2">Notes</h3><p className="text-sm">{d.notes}</p></section>}
        </div>
      )}
    </Drawer>
  );
}

export default function ReagentsView({ route }) {
  const { toast } = useApp();
  const [status, setStatus] = useState(route.query.status ?? "");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "name", order: "asc" });
  const [openId, setOpenId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const search = useDebounced(q);

  const list = useAsync(() => api.reagents({ status, category, search, sort: sort.key, order: sort.order }), [status, category, search, sort]);
  const categories = useAsync(() => api.reagentCategories(), []);
  const settings = useAsync(() => api.settings(), []);

  const ask = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    try { setAnswer(await api.reagentQuery(question)); } catch (err) { toast(err.message, "error"); } finally { setAsking(false); }
  };

  const toggleSort = (key) => setSort((s) => ({ key, order: s.key === key && s.order === "asc" ? "desc" : "asc" }));
  const SortHead = ({ k, children, className = "" }) => (
    <th className={className} aria-sort={sort.key === k ? (sort.order === "asc" ? "ascending" : "descending") : "none"}>
      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(k)}>
        {children}{sort.key === k && (sort.order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );
  const rows = list.data ?? [];
  const filtered = Boolean(status || category || search);

  return (
    <Page width="max-w-7xl">
      <PageHeader title="Reagents" description="Recorded stock, storage location, expiry and storage requirements."
        actions={<button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="h-4 w-4" /> Add reagent</button>} />
      {settings.data?.demo_data.records && (
        <Notice tone="info" title="Demo records" className="mb-4">These inventory records are synthetic sample data. Quantities, lots and locations do not describe a real lab.</Notice>
      )}

      <form onSubmit={ask} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Sparkles className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden="true" />
          <input className="input pl-8" value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Ask the inventory"
            placeholder='Ask the inventory, e.g. "How much ethanol is left?" or "What expires this month?"' />
        </div>
        <button className="btn-secondary" disabled={asking || !question.trim()}>{asking && <Spinner />} Ask</button>
      </form>
      {answer && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-line bg-surface p-3 text-sm">
          <div className="flex-1">
            <p>{answer.answer}</p>
            {answer.results.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {answer.results.slice(0, 8).map((r) => <button key={r.id} className="chip" onClick={() => setOpenId(r.id)}>{r.name}</button>)}
              </div>
            )}
            <p className="meta mt-2">Answered from inventory records only.</p>
          </div>
          <button onClick={() => setAnswer(null)} aria-label="Dismiss answer"><X className="h-4 w-4 text-muted" /></button>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden="true" />
            <input className="input pl-8" placeholder="Name, CAS, catalog, lot" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter reagents" />
          </div>
          <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>{categories.data?.map((c) => <option key={c}>{c}</option>)}
          </select>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
            {STATUS_FILTERS.map((f) => (
              <button key={f.id} onClick={() => setStatus(f.id)} aria-pressed={status === f.id} className={`chip ${status === f.id ? "chip-active" : ""}`}>{f.label}</button>
            ))}
          </div>
          <span className="ml-auto text-xs text-muted">{rows.length} record(s)</span>
        </div>
        {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <div className="p-4"><SkeletonRows rows={6} /></div> : rows.length === 0 ? (
          <EmptyState icon={Boxes} title={filtered ? "No reagents match these filters" : "No reagent records yet"}
            action={filtered ? <button className="btn-secondary btn-sm" onClick={() => { setQ(""); setCategory(""); setStatus(""); }}>Clear filters</button> : null} />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="table">
                <thead>
                  <tr>
                    <SortHead k="name">Reagent</SortHead><SortHead k="category">Category</SortHead>
                    <SortHead k="quantity" className="text-right">Quantity</SortHead><SortHead k="location">Location</SortHead>
                    <SortHead k="expiry_date">Expiry</SortHead><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="row-link" onClick={() => setOpenId(r.id)}>
                      <td>
                        <button className="text-left font-medium hover:text-accent-strong" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>{r.name}</button>
                        <p className="meta">{[r.cas_number && `CAS ${r.cas_number}`, r.hazard_class && "Hazard recorded"].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td>{r.category ?? <span className="text-muted">-</span>}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{r.quantity} {r.unit}</td>
                      <td className="max-w-[14rem] text-muted">{r.location}</td>
                      <td className="whitespace-nowrap">
                        {r.expiry_date ? formatDate(r.expiry_date) : <span className="text-muted">-</span>}
                        {r.days_to_expiry != null && r.days_to_expiry <= 30 && <p className={`text-xs ${r.days_to_expiry < 0 ? "text-critical" : "text-warning-ink"}`}>{expiryText(r)}</p>}
                      </td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <button className="w-full px-4 py-3 text-left" onClick={() => setOpenId(r.id)}>
                    <div className="flex items-start justify-between gap-2"><p className="font-medium">{r.name}</p><StatusBadge status={r.status} /></div>
                    <p className="meta mt-0.5">{r.quantity} {r.unit} · {r.location} · {expiryText(r)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {openId && <ReagentDrawer key={openId} id={openId} onClose={() => setOpenId(null)} onChanged={list.reload}
        onEdit={(r) => { setOpenId(null); setEditing(r); setFormOpen(true); }} />}
      <ReagentForm open={formOpen} initial={editing} categories={categories.data ?? []} onClose={() => setFormOpen(false)}
        onSaved={(saved) => { setFormOpen(false); list.reload(); categories.reload(); setOpenId(null); setTimeout(() => setOpenId(saved.id), 0); }} />
    </Page>
  );
}
