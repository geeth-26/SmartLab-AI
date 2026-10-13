import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Paperclip, SendHorizontal, X } from "lucide-react";
import { formatBytes } from "../lib/format";
import { ProgressBar, Spinner } from "./ui";

export const ATTACH_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp";
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

/** Classify and validate a file before it is attached. Returns {kind} or {error}. */
export function checkAttachment(file, maxMB = 25) {
  const name = file.name.toLowerCase();
  const kind = name.endsWith(".pdf") ? "pdf" : IMAGE_RE.test(name) ? "image" : null;
  if (!kind) return { error: `"${file.name}" is not supported. Attach a PDF or a PNG, JPEG or WebP image.` };
  if (file.size > maxMB * 1024 * 1024) return { error: `"${file.name}" is larger than the ${maxMB} MB upload limit.` };
  if (file.size === 0) return { error: `"${file.name}" is empty.` };
  return { kind };
}

export function makeAttachment(file) {
  const { kind } = checkAttachment(file);
  return { file, kind, name: file.name, size: file.size, previewUrl: kind === "image" ? URL.createObjectURL(file) : null };
}

function AttachmentChip({ attachment, status, onRemove }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-canvas p-2 pr-2.5">
      {attachment.previewUrl
        ? <img src={attachment.previewUrl} alt="" className="h-10 w-10 rounded object-cover" />
        : <div className="flex h-10 w-10 items-center justify-center rounded bg-subtle"><FileText className="h-5 w-5 text-muted" aria-hidden="true" /></div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{attachment.name}</p>
        {status?.phase === "uploading" ? (
          <div className="mt-1 flex items-center gap-2"><ProgressBar value={status.progress} label="Upload progress" /><span className="meta tabular-nums">{Math.round(status.progress * 100)}%</span></div>
        ) : status?.phase === "processing" ? (
          <p className="meta flex items-center gap-1.5"><Spinner className="h-3 w-3" /> {attachment.kind === "pdf" ? "Extracting pages and indexing..." : "Analysing image..."}</p>
        ) : (
          <p className="meta">{attachment.kind === "pdf" ? "PDF · will be added to Documents as Unreviewed" : "Image"} · {formatBytes(attachment.size)}</p>
        )}
      </div>
      {onRemove && !status && (
        <button type="button" className="btn-ghost btn-icon h-8 w-8" onClick={onRemove} aria-label={`Remove ${attachment.name}`}><X className="h-4 w-4" /></button>
      )}
    </div>
  );
}

/**
 * Question composer: multiline text, Enter to send (Shift+Enter for a new line), one optional
 * attachment (image for visual questions, PDF to add to the knowledge base first).
 */
export default function Composer({
  onSubmit, busy, attachment, onAttach, onRemoveAttachment, uploadStatus, placeholder, autoFocus, footer, maxMB = 25,
  initialText = "",
}) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

  const pick = (file) => {
    if (!file) return;
    const check = checkAttachment(file, maxMB);
    if (check.error) return setError(check.error);
    setError(null);
    onAttach(file);
  };

  const submit = () => {
    const q = text.trim();
    if (busy || (!q && !attachment)) return;
    if (attachment?.kind === "image" && !q) {
      setError("Add a question about the image, for example \"What does this error display mean?\"");
      return;
    }
    setError(null);
    onSubmit(q);
    setText("");
  };

  return (
    <div>
      <form className="rounded-xl border border-line bg-surface shadow-panel focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (onAttach) pick(e.dataTransfer.files?.[0]); }}>
        {attachment && (
          <div className="px-3 pt-3">
            <AttachmentChip attachment={attachment} status={uploadStatus} onRemove={onRemoveAttachment} />
          </div>
        )}
        <label htmlFor="composer-input" className="sr-only">Your question</label>
        <textarea id="composer-input" ref={ref} rows={1} value={text} maxLength={2000} disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          placeholder={placeholder ?? "Ask about a procedure, document, experiment, or reagent..."}
          className="block max-h-[200px] min-h-[3rem] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-[0.9375rem] leading-6 placeholder:text-slate-400 focus:outline-none disabled:opacity-60" />
        <div className="flex items-center gap-2 px-2 pb-2">
          {onAttach && (
            <>
              <button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy || !!attachment}
                title="Attach an image or a PDF">
                <Paperclip className="h-4 w-4" /> <span className="hidden sm:inline">Attach</span>
              </button>
              <input ref={fileRef} type="file" hidden accept={ATTACH_ACCEPT} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
              <span className="hidden text-2xs text-muted sm:inline">
                <ImageIcon className="mr-1 inline h-3 w-3" aria-hidden="true" />Image or PDF, up to {maxMB} MB
              </span>
            </>
          )}
          <div className="flex-1" />
          <span className="hidden text-2xs text-muted md:inline">Enter to send · Shift+Enter for new line</span>
          <button type="submit" className="btn-primary btn-sm" disabled={busy || (!text.trim() && !attachment)} aria-label="Send question">
            {busy ? <Spinner className="h-4 w-4" /> : <SendHorizontal className="h-4 w-4" />}<span className="hidden sm:inline">Ask</span>
          </button>
        </div>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-critical">{error}</p>}
      {footer}
    </div>
  );
}
