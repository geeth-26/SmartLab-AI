import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { Dialog } from "../components/ui";

const AppContext = createContext(null);

const TOAST_ICON = {
  success: <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />,
  error: <XCircle className="h-4 w-4 text-critical" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />,
  info: <Info className="h-4 w-4 text-info" aria-hidden="true" />,
};

/**
 * App-wide state: toasts, a promise-based confirm dialog, server capabilities (health),
 * the evidence panel, and the (demo) current user. There is no authentication yet.
 */
export function AppProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [health, setHealth] = useState(null);
  const [healthError, setHealthError] = useState(null);
  const [evidence, setEvidence] = useState(null); // { citations: [...], active: n }
  const [confirmState, setConfirmState] = useState(null);
  const [currentUser] = useState({ id: 3, name: "Priya Raman", role: "Research Associate" });
  const toastId = useRef(0);

  const toast = useCallback((message, type = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === "error" ? 7000 : 4500);
  }, []);

  const refreshHealth = useCallback(() => {
    api.health().then((h) => { setHealth(h); setHealthError(null); }).catch(setHealthError);
  }, []);
  useEffect(() => { refreshHealth(); }, [refreshHealth]);

  /** Open the evidence panel on one citation, optionally with its sibling citations. */
  const openEvidence = useCallback((citation, siblings) => {
    const citations = siblings?.length ? siblings : [citation];
    const idx = citations.findIndex((c) => c === citation || (c.n != null && c.n === citation.n));
    setEvidence({ citations, active: Math.max(0, idx) });
  }, []);
  const closeEvidence = useCallback(() => setEvidence(null), []);

  /** confirm({title, message, confirmLabel, danger}) -> Promise<boolean> */
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);
  const settle = (value) => { confirmState?.resolve(value); setConfirmState(null); };

  const value = useMemo(() => ({
    toast, confirm, health, healthError, refreshHealth, evidence, openEvidence, closeEvidence, currentUser,
  }), [toast, confirm, health, healthError, refreshHealth, evidence, openEvidence, closeEvidence, currentUser]);

  return (
    <AppContext.Provider value={value}>
      {children}
      <Dialog open={!!confirmState} onClose={() => settle(false)} title={confirmState?.title ?? "Are you sure?"}
        footer={<>
          <button className="btn-secondary" onClick={() => settle(false)}>Cancel</button>
          <button data-autofocus className={confirmState?.danger ? "btn-danger" : "btn-primary"} onClick={() => settle(true)}>
            {confirmState?.confirmLabel ?? "Confirm"}
          </button>
        </>}>
        <p className="text-sm text-ink">{confirmState?.message}</p>
      </Dialog>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface p-3 text-sm shadow-pop">
            {TOAST_ICON[t.type]}
            <p className="flex-1">{t.message}</p>
            <button onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="Dismiss notification">
              <X className="h-4 w-4 text-muted" />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
