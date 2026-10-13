import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, X, ZoomIn, ZoomOut } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { ApprovalBadge, Badge, Skeleton } from "./ui";

/**
 * Source evidence for a citation: document metadata, the exact page, the cited excerpt,
 * and a rendered page image with the excerpt highlighted. Shows only metadata the
 * server actually returned - missing fields are omitted, never guessed.
 */
export default function EvidencePanel({ onClose }) {
  const { evidence } = useApp();
  const [active, setActive] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(130);
  const [imgState, setImgState] = useState("loading");
  const [pageCount, setPageCount] = useState(null);

  const citation = evidence?.citations[active];
  useEffect(() => { setActive(evidence?.active ?? 0); }, [evidence]);
  useEffect(() => { if (citation) setPage(citation.page || 1); }, [citation]);
  useEffect(() => { setImgState("loading"); }, [citation, page, zoom]);
  useEffect(() => {
    if (!citation) return;
    let alive = true;
    api.document(citation.document_id).then((d) => alive && setPageCount(d.page_count)).catch(() => alive && setPageCount(null));
    return () => { alive = false; };
  }, [citation?.document_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!citation) return null;
  const onCitedPage = page === citation.page;
  const src = api.pagePreviewUrl(citation.document_id, page, onCitedPage && citation.snippet ? [citation.snippet] : [], zoom);
  const total = evidence.citations.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <FileText className="h-4 w-4 text-accent-strong" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-semibold">Source evidence</h2>
        {total > 1 && (
          <div className="flex items-center gap-1 text-xs text-muted">
            <button className="btn-ghost btn-sm btn-icon h-7 w-7" disabled={active === 0} onClick={() => setActive((a) => a - 1)} aria-label="Previous source"><ChevronLeft className="h-4 w-4" /></button>
            <span className="tabular-nums">{active + 1} / {total}</span>
            <button className="btn-ghost btn-sm btn-icon h-7 w-7" disabled={active === total - 1} onClick={() => setActive((a) => a + 1)} aria-label="Next source"><ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
        <button className="btn-ghost btn-icon h-8 w-8" onClick={onClose} aria-label="Close source panel"><X className="h-4 w-4" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 px-4 py-4">
          <div>
            {citation.n != null && <p className="eyebrow mb-1">Source [{citation.n}]</p>}
            <p className="font-medium leading-snug">{citation.document_title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {citation.approval_status && <ApprovalBadge status={citation.approval_status} />}
              {citation.version && <Badge>v{citation.version}</Badge>}
              {citation.doc_type && <Badge>{citation.doc_type}</Badge>}
              {citation.category && <Badge>{citation.category}</Badge>}
              <Badge tone="accent">Page {citation.page}</Badge>
            </div>
            {citation.approval_status && citation.approval_status !== "approved" && (
              <p className="mt-2 text-xs text-warning-ink">This document is not an approved version. Check the current approved procedure before acting.</p>
            )}
          </div>
          {citation.snippet && (
            <figure>
              <figcaption className="eyebrow mb-1">Cited excerpt</figcaption>
              <blockquote className="rounded-lg border-l-2 border-accent bg-accent-soft/60 px-3 py-2 text-sm leading-6">{citation.snippet}</blockquote>
            </figure>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" onClick={() => navigate(`documents/${citation.document_id}?page=${citation.page}`)}>
              <ExternalLink className="h-3.5 w-3.5" /> Open in Documents
            </button>
            <a className="btn-secondary btn-sm" href={api.documentFileUrl(citation.document_id)} target="_blank" rel="noreferrer">
              <Download className="h-3.5 w-3.5" /> PDF
            </a>
          </div>
        </div>

        <div className="border-t border-line bg-canvas px-4 py-3">
          <div className="mb-2 flex items-center gap-1">
            <button className="btn-ghost btn-sm btn-icon h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-xs tabular-nums text-muted">Page {page}{pageCount ? ` of ${pageCount}` : ""}</span>
            <button className="btn-ghost btn-sm btn-icon h-7 w-7" disabled={pageCount != null && page >= pageCount} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            {!onCitedPage && <button className="link ml-2 text-xs" onClick={() => setPage(citation.page)}>Back to cited page</button>}
            <div className="flex-1" />
            <button className="btn-ghost btn-sm btn-icon h-7 w-7" onClick={() => setZoom((z) => Math.max(70, z - 20))} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></button>
            <button className="btn-ghost btn-sm btn-icon h-7 w-7" onClick={() => setZoom((z) => Math.min(250, z + 20))} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></button>
          </div>
          {imgState === "loading" && <Skeleton className="aspect-[1/1.41] w-full" />}
          {imgState === "error" && <p className="py-6 text-center text-sm text-critical">This page could not be rendered.</p>}
          <img key={src} src={src} alt={`Page ${page} of ${citation.document_title}${onCitedPage ? ", cited passage highlighted" : ""}`}
            onLoad={() => setImgState("ok")} onError={() => setImgState("error")}
            className={`mx-auto w-full rounded border border-line bg-white ${imgState === "ok" ? "" : "hidden"}`} />
          {onCitedPage && imgState === "ok" && <p className="mt-2 text-2xs text-muted">Highlighted text marks where the cited excerpt was found on this page.</p>}
        </div>
      </div>
    </div>
  );
}
