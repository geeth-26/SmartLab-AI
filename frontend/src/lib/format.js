// Display formatting helpers. Server timestamps are SQLite UTC strings ("YYYY-MM-DD HH:MM:SS").

export function parseServerDate(value) {
  if (!value) return null;
  const iso = /\dT\d|Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
  const d = parseServerDate(value);
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-";
}

export function formatDateTime(value) {
  const d = parseServerDate(value);
  return d ? d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
}

export function timeAgo(value) {
  const d = parseServerDate(value);
  if (!d) return "-";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return formatDate(value);
}

export function formatBytes(n) {
  if (n == null) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Strip the server's inline notice blockquotes and sources footer; the UI renders those from structured fields. */
export function answerBody(markdown) {
  const withoutFooter = String(markdown ?? "").split(/\n-{3,}\n\*\*Sources\*\*/)[0];
  return withoutFooter
    .split("\n\n")
    .filter((block) => !/^> \*\*(Safety notice|Limited evidence):\*\*/.test(block.trim()))
    .join("\n\n")
    .trim();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** "1 page", "3 pages" */
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
