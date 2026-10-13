import { useState } from "react";
import { CornerDownRight, MessageSquare, Send } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { SkeletonRows, useAsync } from "./ui";

function Comment({ c, onReply, depth = 0 }) {
  return (
    <div className={depth ? "ml-6 border-l border-slate-200 pl-3" : ""}>
      <div className="flex gap-2 py-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-slate-950"
          style={{ background: c.avatar_color || "#64748b" }}>
          {(c.author_name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("")}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs"><span className="font-semibold">{c.author_name || "Unknown"}</span>
            <span className="ml-2 text-slate-500">{c.created_at}</span></p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.body}</p>
          <button className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-teal-500" onClick={() => onReply(c)}>
            <CornerDownRight className="h-3 w-3" /> Reply
          </button>
        </div>
      </div>
      {c.replies?.map((r) => <Comment key={r.id} c={r} onReply={onReply} depth={depth + 1} />)}
    </div>
  );
}

/** Threaded discussion attached to any entity (experiment, project, document, dataset). */
export default function CommentThread({ entityType, entityId }) {
  const { currentUser, toast } = useApp();
  const thread = useAsync(() => api.comments(entityType, entityId), [entityType, entityId]);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    try {
      await api.addComment(entityType, entityId, { body, parent_id: replyTo?.id, author_id: currentUser.id });
      setBody("");
      setReplyTo(null);
      thread.reload();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return (
    <div>
      <p className="section-title mb-2 flex items-center gap-2"><MessageSquare className="h-4 w-4 text-sky-500" /> Discussion</p>
      {thread.loading ? <SkeletonRows rows={2} /> : thread.data?.length
        ? <div className="divide-y divide-slate-100">{thread.data.map((c) => <Comment key={c.id} c={c} onReply={setReplyTo} />)}</div>
        : <p className="py-2 text-sm text-slate-500">No comments yet.</p>}
      <form onSubmit={submit} className="mt-3">
        {replyTo && (
          <p className="mb-1 text-xs text-slate-500">Replying to {replyTo.author_name}
            <button type="button" className="ml-2 text-rose-500" onClick={() => setReplyTo(null)}>cancel</button></p>
        )}
        <div className="flex gap-2">
          <input className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder={`Comment as ${currentUser.name}...`} />
          <button className="btn-primary" aria-label="Post comment"><Send className="h-4 w-4" /></button>
        </div>
      </form>
    </div>
  );
}
