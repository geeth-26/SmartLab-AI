import { useEffect, useState } from "react";
import {
  Activity, BookOpen, Boxes, ChevronsLeft, ChevronsRight, FileText, FlaskConical, FlaskRound,
  LineChart, Menu, MessageSquareText, Search, Settings, ShieldAlert, SlidersHorizontal, Users, Wrench, X,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { navigate } from "../lib/router";

export const NAV_GROUPS = [
  {
    label: null,
    items: [
      { id: "ask", label: "Ask SmartLab", icon: MessageSquareText },
      { id: "documents", label: "Documents", icon: FileText },
      { id: "reagents", label: "Reagents", icon: Boxes },
      { id: "literature", label: "Scientific literature", icon: BookOpen },
    ],
  },
  {
    label: "Lab operations",
    items: [
      { id: "troubleshooting", label: "Troubleshooting", icon: Wrench },
      { id: "experiments", label: "Experiments", icon: FlaskConical },
      { id: "data", label: "Data analysis", icon: LineChart },
    ],
  },
  {
    label: "Early features",
    hint: "Working prototypes with limited scope",
    items: [
      { id: "collaboration", label: "Collaboration", icon: Users },
      { id: "simulation", label: "Simulation", icon: SlidersHorizontal },
    ],
  },
];
export const FOOTER_NAV = [
  { id: "safety", label: "Safety resources", icon: ShieldAlert, distinguished: true },
  { id: "activity", label: "Recent activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
];
export const ALL_NAV = [
  ...NAV_GROUPS.flatMap((g) => g.items),
  ...FOOTER_NAV,
  { id: "search", label: "Search", icon: Search },
  { id: "overview", label: "Ask SmartLab", icon: MessageSquareText },
];

function NavItem({ item, active, collapsed, onNavigate }) {
  const Icon = item.icon;
  const isSafety = item.id === "safety" || item.distinguished;

  if (isSafety) {
    return (
      <a
        href={`#/${item.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={`group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm transition-all duration-150 border mb-1.5
          ${
            active
              ? "border-amber-500/70 bg-amber-500/25 font-semibold text-amber-200 shadow-sm shadow-amber-950/60"
              : "border-amber-500/35 bg-amber-950/30 text-amber-300 hover:border-amber-400/60 hover:bg-amber-900/40 hover:text-amber-100"
          }`}
      >
        {active && (
          <span
            className="absolute left-0 top-1.5 h-6 w-0.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
            aria-hidden="true"
          />
        )}
        <Icon
          className={`h-4 w-4 shrink-0 transition-transform group-hover:scale-110 ${
            active ? "text-amber-300" : "text-amber-400 group-hover:text-amber-200"
          }`}
          aria-hidden="true"
        />
        {!collapsed && (
          <div className="flex min-w-0 flex-1 items-center justify-between">
            <span className="truncate font-medium">{item.label}</span>
            <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
              ALERT
            </span>
          </div>
        )}
      </a>
    );
  }

  return (
    <a href={`#/${item.id}`} onClick={onNavigate} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}
      className={`group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors
        ${active ? "bg-nav-2 font-medium text-white" : "text-nav-text hover:bg-nav-2/70 hover:text-white"}`}>
      {active && <span className="absolute left-0 top-1.5 h-6 w-0.5 rounded-full bg-accent" aria-hidden="true" />}
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-teal-300" : "text-nav-dim group-hover:text-nav-text"}`} aria-hidden="true" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </a>
  );
}

function SidebarContent({ current, collapsed, onNavigate, onToggle, mobile }) {
  return (
    <div className="flex h-full flex-col bg-nav">
      <div className={`flex h-14 shrink-0 items-center gap-2.5 border-b border-nav-line ${collapsed ? "justify-center px-2" : "px-4"}`}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-strong text-white">
          <FlaskRound className="h-4 w-4" aria-hidden="true" />
        </div>
        {!collapsed && <p className="flex-1 text-sm font-semibold text-white">SmartLab AI</p>}
        {mobile && <button className="btn-icon btn text-nav-text hover:bg-nav-2" onClick={onNavigate} aria-label="Close navigation"><X className="h-4 w-4" /></button>}
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2 py-3" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? "main"}>
            {group.label && !collapsed && (
              <p className="mb-1 px-2.5 text-2xs font-semibold uppercase tracking-wider text-nav-dim" title={group.hint}>{group.label}</p>
            )}
            {group.label && collapsed && <div className="mx-2 mb-2 border-t border-nav-line" />}
            <div className="space-y-0.5">
              {group.items.map((item) => <NavItem key={item.id} item={item} active={current === item.id} collapsed={collapsed} onNavigate={onNavigate} />)}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-nav-line px-2 py-2">
        {FOOTER_NAV.map((item) => <NavItem key={item.id} item={item} active={current === item.id} collapsed={collapsed} onNavigate={onNavigate} />)}
        {!mobile && (
          <button onClick={onToggle} className="flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm text-nav-dim hover:bg-nav-2/70 hover:text-white"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /><span>Collapse</span></>}
          </button>
        )}
      </div>
    </div>
  );
}

function GlobalSearch({ className = "" }) {
  const [q, setQ] = useState("");
  return (
    <form role="search" className={`relative ${className}`} onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`search?q=${encodeURIComponent(q.trim())}`); }}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden="true" />
      <input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents, reagents and fixes"
        placeholder="Search documents, reagents, error codes" />
    </form>
  );
}

export default function AppShell({ current, title, children, aside }) {
  const { healthError } = useApp();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("smartlab-nav-collapsed") === "1"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { try { localStorage.setItem("smartlab-nav-collapsed", collapsed ? "1" : "0"); } catch { /* ignore */ } }, [collapsed]);
  useEffect(() => { setMobileOpen(false); }, [current]);
  useEffect(() => { document.title = title ? `${title} · SmartLab AI` : "SmartLab AI"; }, [title]);

  return (
    <div className="flex h-full overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[70] focus:rounded focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <aside className={`hidden shrink-0 transition-[width] duration-150 lg:block ${collapsed ? "w-16" : "w-60"}`}>
        <SidebarContent current={current} collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-nav/50 lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-72 max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
            <SidebarContent current={current} mobile onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
          <button className="btn-ghost btn-icon -ml-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
          <p className="truncate text-sm font-semibold">{title}</p>
          <div className="flex-1" />
          {current !== "search" && <GlobalSearch className="hidden w-80 md:block" />}
          {current !== "search" && (
            <a href="#/search" className="btn-ghost btn-icon md:hidden" aria-label="Search"><Search className="h-4 w-4" /></a>
          )}
        </header>
        {healthError && (
          <div role="alert" className="border-b border-critical/30 bg-critical-soft px-4 py-2 text-sm text-critical sm:px-6">
            The SmartLab server is not responding. Data shown may be incomplete and actions will fail until it is back.
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          <main id="main" className="min-w-0 flex-1 overflow-y-auto">{children}</main>
          {aside}
        </div>
      </div>
    </div>
  );
}
