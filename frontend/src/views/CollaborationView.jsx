import { useEffect, useRef, useState } from "react";
import { Activity, Download, FileText, FolderKanban, MessageSquare, Plus, Upload, Users } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import CommentThread from "../components/CommentThread";
import { Dropzone, EmptyState, PageHeader, SkeletonRows, useAsync } from "../components/ui";

const KIND_ICON = { comment: MessageSquare, file: Upload, document: FileText, review: Activity };
const POLL_MS = 5000;

function ActivityFeed() {
  const [items, setItems] = useState([]);
  const latest = useRef(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const fresh = await api.activity(latest.current ?? undefined);
        if (!alive || !fresh.length) return;
        latest.current = fresh[0].at;
        setItems((old) => {
          const seen = new Set(old.map((i) => `${i.kind}-${i.id}-${i.at}`));
          return [...fresh.filter((i) => !seen.has(`${i.kind}-${i.id}-${i.at}`)), ...old].slice(0, 40);
        });
      } catch { /* transient network errors are retried on the next tick */ }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="panel p-4">
      <p className="section-title mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-teal-500" /> Live activity
        <span className="relative ml-1 flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-teal-500" /></span>
      </p>
      {items.length === 0 ? <p className="text-sm text-slate-500">No activity yet.</p> : (
        <ul className="space-y-2">
          {items.map((i) => {
            const Icon = KIND_ICON[i.kind] ?? Activity;
            return (
              <li key={`${i.kind}-${i.id}-${i.at}`} className="flex gap-2 text-xs">
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <div className="min-w-0"><p className="truncate"><span className="font-medium">{i.actor || "System"}</span> · {i.summary}</p>
                  <p className="text-[11px] text-slate-500">{i.at} · {i.ref}</p></div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function CollaborationView() {
  const { toast, currentUser } = useApp();
  const projects = useAsync(() => api.projects(), []);
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState("");
  const files = useAsync(() => (selected ? api.projectFiles(selected) : Promise.resolve([])), [selected]);

  useEffect(() => { if (!selected && projects.data?.length) setSelected(projects.data[0].id); }, [projects.data, selected]);
  const project = projects.data?.find((p) => p.id === selected);

  const uploadFiles = async (list) => {
    for (const file of list) {
      try {
        await api.uploadProjectFile(selected, file, currentUser.id);
        toast(`Shared ${file.name}.`, "success");
      } catch (err) { toast(`${file.name}: ${err.message}`, "error"); }
    }
    files.reload();
    projects.reload();
  };

  const create = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const p = await api.createProject({ name: newName, owner_id: currentUser.id });
      setNewName("");
      await projects.reload();
      setSelected(p.id);
    } catch (err) { toast(err.message, "error"); }
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader title="Collaboration" subtitle="Project workspaces, shared files and threaded discussions." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
        <div className="space-y-2">
          {projects.loading ? <SkeletonRows rows={3} /> : projects.data?.map((p) => (
            <button key={p.id} onClick={() => setSelected(p.id)}
              className={`panel w-full p-3 text-left ${selected === p.id ? "ring-2 ring-teal-500/60" : "hover:border-teal-500/40"}`}>
              <p className="flex items-center gap-2 text-sm font-medium"><FolderKanban className="h-4 w-4 text-sky-500" />{p.name}</p>
              <p className="mt-1 text-xs text-slate-500">{p.experiment_count} experiments · {p.file_count} files</p>
            </button>
          ))}
          <form onSubmit={create} className="flex gap-2">
            <input className="input" placeholder="New project" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn-secondary" aria-label="Create project"><Plus className="h-4 w-4" /></button>
          </form>
        </div>

        {project ? (
          <div className="space-y-4">
            <div className="panel p-5">
              <h2 className="font-semibold">{project.name}</h2>
              <p className="text-sm text-slate-500">{project.description}</p>
              <p className="mt-1 text-xs text-slate-500">Owner: {project.owner_name || "-"}</p>
            </div>
            <div className="panel p-5">
              <p className="section-title mb-3">Shared files</p>
              <Dropzone accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.txt,.json" multiple onFiles={uploadFiles}
                label="Drop files to share with the project" hint="PDF, images, CSV, TXT, JSON · validated server-side" />
              {files.loading ? <div className="mt-3"><SkeletonRows rows={2} /></div> : files.data?.length ? (
                <ul className="mt-3 divide-y divide-slate-200">
                  {files.data.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                      <FileText className="h-4 w-4 text-sky-500" />
                      <div className="min-w-0 flex-1"><p className="truncate font-medium">{f.original_name}</p>
                        <p className="text-xs text-slate-500">{(f.size_bytes / 1024).toFixed(1)} KB · {f.uploader_name || "-"} · {f.uploaded_at}</p></div>
                      <a className="btn-ghost p-2" href={api.fileUrl(f.id)} aria-label={`Download ${f.original_name}`}><Download className="h-4 w-4" /></a>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-sm text-slate-500">No files shared yet.</p>}
            </div>
            <div className="panel p-5"><CommentThread entityType="project" entityId={project.id} /></div>
          </div>
        ) : <div className="panel"><EmptyState icon={FolderKanban} title="Select a project" /></div>}

        <ActivityFeed />
      </div>
    </div>
  );
}
