import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, FileText, GraduationCap, MapPin, ShieldAlert, UserCircle2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { Badge, PageHeader, SkeletonRows, Tabs, useAsync } from "../components/ui";

function TrainingProgress({ steps, storageKey }) {
  const [done, setDone] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(done)); } catch { /* storage unavailable */ }
  }, [done, storageKey]);
  const toggle = (i) => setDone((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]));
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => (
        <li key={s}>
          <button onClick={() => toggle(i)} className="panel-muted flex w-full items-center gap-3 p-3 text-left text-sm">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold
              ${done.includes(i) ? "bg-teal-500 text-slate-950" : "bg-slate-200 text-slate-600"}`}>
              {done.includes(i) ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </span>
            <span className={done.includes(i) ? "text-slate-400 line-through" : ""}>{s}</span>
          </button>
        </li>
      ))}
      <p className="pt-1 text-xs text-slate-500">{done.length}/{steps.length} steps completed</p>
    </ol>
  );
}

function Tour() {
  const { openCitation } = useApp();
  const equipment = useAsync(() => api.equipment(), []);
  const [selected, setSelected] = useState(null);
  const detail = useAsync(() => (selected ? api.equipmentItem(selected) : Promise.resolve(null)), [selected]);

  useEffect(() => { if (!selected && equipment.data?.length) setSelected(equipment.data[0].id); }, [equipment.data, selected]);
  if (equipment.loading) return <SkeletonRows rows={5} />;
  const item = detail.data;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="panel relative aspect-[16/10] overflow-hidden p-0">
        {/* Schematic floor plan of the lab; equipment hotspots are positioned in % coordinates. */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <rect x="3" y="5" width="60" height="50" rx="1.5" className="fill-slate-100 stroke-slate-300" strokeWidth="0.4" />
          <rect x="35" y="58" width="60" height="37" rx="1.5" className="fill-slate-100 stroke-slate-300" strokeWidth="0.4" />
          <rect x="3" y="70" width="28" height="25" rx="1.5" className="fill-slate-100 stroke-slate-300" strokeWidth="0.4" />
          <text x="5" y="10" className="fill-slate-400" fontSize="2.6">Lab 2.14 - Analytical</text>
          <text x="37" y="63" className="fill-slate-400" fontSize="2.6">Tissue culture suite</text>
          <text x="5" y="75" className="fill-slate-400" fontSize="2.6">Corridor</text>
        </svg>
        {equipment.data.map((e) => (
          <button key={e.id} onClick={() => setSelected(e.id)} style={{ left: `${e.tour_x}%`, top: `${e.tour_y}%` }}
            className={`group absolute -translate-x-1/2 -translate-y-1/2 rounded-full p-2 transition
              ${selected === e.id ? "bg-teal-500 text-slate-950 ring-4 ring-teal-500/30" : "bg-sky-500/90 text-white hover:scale-110"}`}
            aria-label={e.name}>
            <MapPin className="h-4 w-4" />
            <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[11px] text-white opacity-0 transition group-hover:opacity-100">{e.name}</span>
          </button>
        ))}
      </div>
      <div className="panel p-5">
        {!item ? <SkeletonRows rows={5} /> : (
          <>
            <Badge tone="blue">{item.category}</Badge>
            <h2 className="mt-2 text-base font-semibold">{item.name}</h2>
            <p className="text-xs text-slate-500">{item.location}</p>
            <p className="mt-2 text-sm">{item.description}</p>
            <div className="mt-3 flex gap-2 rounded-lg bg-rose-500/10 p-3 text-xs text-rose-700">
              <ShieldAlert className="h-4 w-4 shrink-0" />{item.safety_notes}
            </div>
            <p className="label mt-4">Training walkthrough</p>
            <TrainingProgress steps={item.training_steps} storageKey={`smartlab-training-${item.id}`} />
            {item.sop_documents?.map((d) => (
              <button key={d.id} className="chip mt-3" onClick={() => openCitation({ document_id: d.id, document_title: d.title, page: 1, snippet: "" })}>
                <FileText className="h-3 w-3 text-sky-500" /> Open {d.title} <ChevronRight className="h-3 w-3" />
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Profiles() {
  const profiles = useAsync(() => api.profiles(), []);
  const [selected, setSelected] = useState(null);
  const detail = useAsync(() => (selected ? api.profile(selected) : Promise.resolve(null)), [selected]);
  if (profiles.loading) return <SkeletonRows rows={4} />;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {profiles.data.map((p) => (
          <button key={p.id} onClick={() => setSelected(p.id)} className={`panel p-4 text-left ${selected === p.id ? "ring-2 ring-teal-500/60" : ""}`}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-slate-950" style={{ background: p.avatar_color }}>
                {p.name.split(" ").map((x) => x[0]).slice(-2).join("")}
              </div>
              <div><p className="text-sm font-semibold">{p.name}</p><p className="text-xs text-slate-500">{p.title}</p></div>
            </div>
            <p className="mt-2 text-xs text-slate-500">{p.expertise}</p>
            <div className="mt-3 flex gap-2 text-[11px]">
              <Badge tone="blue">{p.experiment_count} experiments</Badge>
              {p.avg_progress !== null && <Badge tone="emerald">{p.avg_progress}% avg progress</Badge>}
              {p.pending_reviews > 0 && <Badge tone="amber">{p.pending_reviews} reviews pending</Badge>}
            </div>
          </button>
        ))}
      </div>
      <div className="panel p-5">
        {!detail.data ? <p className="text-sm text-slate-500"><UserCircle2 className="mr-1 inline h-4 w-4" />Select a profile to see research progress and review queue.</p> : (
          <>
            <h2 className="font-semibold">{detail.data.name}</h2>
            <p className="label mt-4">Experiments</p>
            {detail.data.experiments.length === 0 ? <p className="text-sm text-slate-500">None</p> : detail.data.experiments.map((e) => (
              <div key={e.id} className="mb-2">
                <div className="flex justify-between text-sm"><span>{e.title}</span><span className="tabular-nums text-slate-500">{e.progress}%</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-200"><div className="h-full rounded-full bg-teal-500" style={{ width: `${e.progress}%` }} /></div>
              </div>
            ))}
            <p className="label mt-4">Review queue</p>
            {detail.data.review_queue.length === 0 ? <p className="text-sm text-slate-500">Nothing pending</p> : detail.data.review_queue.map((r) => (
              <p key={r.id} className="text-sm">{r.checkpoint} - <span className="text-slate-500">{r.experiment_title}</span></p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default function LabTourView() {
  const [tab, setTab] = useState("tour");
  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader title="Virtual lab tour & profiles" subtitle="Interactive equipment training guides and researcher progress tracking." />
      <Tabs tabs={[{ id: "tour", label: "Virtual lab tour" }, { id: "profiles", label: "Researcher profiles" }]} value={tab} onChange={setTab} />
      {tab === "tour" ? <Tour /> : <Profiles />}
    </div>
  );
}
