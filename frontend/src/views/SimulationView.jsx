import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Info, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { chartTheme } from "../lib/chartTheme";
import { Badge, PageHeader, Skeleton, Tabs, useAsync } from "../components/ui";

const fmt = (v) => (typeof v === "number" ? (Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-2) ? v.toExponential(2) : +v.toFixed(3)) : v ?? "-");

export default function SimulationView() {
  const { theme, toast } = useApp();
  const t = chartTheme(theme);
  const catalog = useAsync(() => api.simulations(), []);
  const [model, setModel] = useState("enzyme_kinetics");
  const [params, setParams] = useState({});
  const [result, setResult] = useState(null);
  const timer = useRef(null);

  const spec = catalog.data?.find((m) => m.id === model);
  const defaults = useMemo(() => Object.fromEntries((spec?.params ?? []).map((p) => [p.key, p.default])), [spec]);

  useEffect(() => { setParams(defaults); }, [defaults]);

  // Debounced re-simulation as sliders move.
  useEffect(() => {
    if (!spec || !Object.keys(params).length) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.runSimulation(model, params).then(setResult).catch((err) => toast(err.message, "error"));
    }, 150);
    return () => clearTimeout(timer.current);
  }, [model, params, spec, toast]);

  // Merge series into recharts rows keyed by x.
  const rows = useMemo(() => {
    if (!result) return [];
    const byX = new Map();
    result.series.forEach((s) => s.points.forEach((p) => {
      const row = byX.get(p.x) ?? { x: p.x };
      row[s.name] = p.y;
      byX.set(p.x, row);
    }));
    return [...byX.values()].sort((a, b) => a.x - b.x);
  }, [result]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader title="Lab Experiment Simulation (LXS)"
        subtitle="Move the parameters to see how a protocol change shifts the expected outcome before you run it at the bench." />
      {catalog.loading ? <Skeleton className="h-10 w-96" /> : (
        <Tabs tabs={catalog.data.map((m) => ({ id: m.id, label: m.name }))} value={model} onChange={(id) => { setResult(null); setModel(id); }} />
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="panel space-y-4 p-5">
          <div className="flex items-center justify-between">
            <p className="section-title">Parameters</p>
            <button className="btn-ghost py-1 text-xs" onClick={() => setParams(defaults)}><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
          </div>
          {spec?.params.map((p) => {
            const logScale = p.max / Math.max(p.min, 1e-9) > 1e4;
            const toSlider = (v) => (logScale ? Math.log10(v) : v);
            const fromSlider = (v) => (logScale ? +(10 ** v).toPrecision(3) : +v);
            return (
              <div key={p.key}>
                <div className="flex items-baseline justify-between">
                  <label htmlFor={p.key} className="text-xs font-medium">{p.label}</label>
                  <span className="font-mono text-xs tabular-nums text-teal-500">{fmt(params[p.key])} {p.unit}</span>
                </div>
                <input id={p.key} type="range" className="w-full accent-teal-500"
                  min={toSlider(p.min)} max={toSlider(p.max)} step={logScale ? 0.01 : p.step}
                  value={toSlider(params[p.key] ?? p.default)}
                  onChange={(e) => setParams((s) => ({ ...s, [p.key]: Math.min(p.max, Math.max(p.min, fromSlider(e.target.value))) }))} />
              </div>
            );
          })}
        </div>

        <div className="space-y-4">
          <div className="panel p-5">
            {!result ? <Skeleton className="h-80" /> : (
              <>
                <p className="section-title mb-1">{result.name}</p>
                <p className="mb-3 text-xs text-slate-500">{result.y_label} vs {result.x_label}</p>
                <div className="h-80">
                  <ResponsiveContainer>
                    <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
                      <CartesianGrid stroke={t.grid} vertical={false} />
                      <XAxis dataKey="x" type="number" scale={result.x_scale === "log" ? "log" : "auto"} domain={["auto", "auto"]}
                        stroke={t.axis} fontSize={11} tickLine={false} tickFormatter={fmt}
                        label={{ value: result.x_label, position: "insideBottom", offset: -8, fill: t.axis, fontSize: 11 }} />
                      <YAxis stroke={t.axis} fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmt} />
                      <Tooltip {...t.tooltip} labelFormatter={(v) => `${result.x_label}: ${fmt(v)}`} formatter={(v, n) => [fmt(v), n]}
                        cursor={{ stroke: t.axis, strokeDasharray: "3 3" }} />
                      {result.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                      {result.series.map((s, i) => (
                        <Line key={s.name} dataKey={s.name} stroke={t.series[i]} strokeWidth={2} dot={false} isAnimationActive={false}
                          strokeDasharray={s.name === "Threshold" || s.name === "No inhibitor" ? "5 4" : undefined} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
          {result && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="panel p-5">
                <p className="section-title mb-3">Predicted metrics</p>
                <dl className="grid grid-cols-2 gap-3">
                  {Object.entries(result.metrics).map(([k, v]) => (
                    <div key={k} className="panel-muted p-2.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{k.replace(/_/g, " ")}</dt>
                      <dd className="text-base font-semibold tabular-nums">{fmt(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="panel space-y-3 p-5 text-sm">
                <p className="section-title">Model assumptions</p>
                <ul className="list-disc space-y-1 pl-5 text-xs">{result.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                {result.warnings.map((w) => <p key={w} className="flex gap-1.5 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</p>)}
                <Badge tone="amber"><Info className="h-3 w-3" /> {result.disclaimer}</Badge>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
