import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { ArrowDownUp, BarChart3, Database, Filter, Trash2 } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../lib/api";
import { chartTheme } from "../lib/chartTheme";
import { Dropzone, EmptyState, PageHeader, Skeleton, SkeletonRows, useAsync } from "../components/ui";

function StatTile({ name, s }) {
  return (
    <div className="panel-muted p-3">
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{name}</p>
      {s.type === "numeric" ? (
        <>
          <p className="mt-1 text-lg font-semibold tabular-nums">{s.mean}</p>
          <p className="text-[11px] tabular-nums text-slate-500">mean · SD {s.std} · {s.min}–{s.max} · n={s.count}</p>
        </>
      ) : (
        <>
          <p className="mt-1 text-lg font-semibold tabular-nums">{s.distinct}</p>
          <p className="text-[11px] text-slate-500">distinct values · n={s.count}</p>
        </>
      )}
    </div>
  );
}

export default function DataView() {
  const { theme, toast } = useApp();
  const t = chartTheme(theme);
  const list = useAsync(() => api.datasets(), []);
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState({ key: "", order: "asc" });
  const [filter, setFilter] = useState({ column: "", value: "" });
  const [x, setX] = useState("");
  const [y, setY] = useState("");

  useEffect(() => { if (!selected && list.data?.length) setSelected(list.data[0].id); }, [list.data, selected]);

  const ds = useAsync(() => (selected
    ? api.dataset(selected, { sort: sort.key, order: sort.order, filter: filter.column && filter.value ? `${filter.column}:${filter.value}` : undefined })
    : Promise.resolve(null)), [selected, sort, filter]);

  const data = ds.data;
  const numericCols = useMemo(() => (data ? data.columns.filter((c) => data.stats[c]?.type === "numeric") : []), [data]);

  useEffect(() => {
    if (!data) return;
    const cat = data.columns.find((c) => data.stats[c]?.type === "categorical");
    if (!data.columns.includes(x)) setX(cat ?? numericCols[0] ?? "");
    if (!numericCols.includes(y)) setY(numericCols[numericCols.length > 1 ? numericCols.length - 2 : 0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const xIsNumeric = numericCols.includes(x);
  const chartData = useMemo(() => {
    if (!data || !x || !y) return [];
    if (xIsNumeric) return data.rows.map((r) => ({ x: r[x], y: r[y] })).filter((p) => typeof p.x === "number" && typeof p.y === "number");
    const groups = {};
    data.rows.forEach((r) => { if (typeof r[y] === "number") (groups[r[x]] ??= []).push(r[y]); });
    return Object.entries(groups).map(([k, v]) => ({ x: k, y: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3), n: v.length }));
  }, [data, x, y, xIsNumeric]);

  const onUpload = async ([file]) => {
    try {
      const created = await api.uploadDataset(file);
      toast(`Imported ${created.rows.length} rows into "${created.name}".`, "success");
      await list.reload();
      setSelected(created.id);
    } catch (err) { toast(err.message, "error"); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete dataset "${data.name}"?`)) return;
    try { await api.deleteDataset(data.id); setSelected(null); list.reload(); } catch (err) { toast(err.message, "error"); }
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <PageHeader title="Data management & analysis" subtitle="Centralised datasets with sortable grids, filters, statistics and charts." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="space-y-3">
          {list.loading ? <SkeletonRows rows={3} /> : list.data?.map((d) => (
            <button key={d.id} onClick={() => { setSelected(d.id); setFilter({ column: "", value: "" }); setSort({ key: "", order: "asc" }); }}
              className={`panel w-full p-3 text-left ${selected === d.id ? "ring-2 ring-teal-500/60" : "hover:border-teal-500/40"}`}>
              <p className="text-sm font-medium">{d.name}</p>
              <p className="text-xs text-slate-500">{d.row_count} rows · {d.columns.length} columns</p>
            </button>
          ))}
          <Dropzone compact accept=".csv" onFiles={onUpload} label="Import CSV" hint="Header row required" />
        </div>

        {!data ? (ds.loading ? <Skeleton className="h-96" /> : <div className="panel"><EmptyState icon={Database} title="No dataset selected" /></div>) : (
          <div className="space-y-4">
            <div className="panel p-5">
              <div className="flex items-start justify-between gap-2">
                <div><h2 className="font-semibold">{data.name}</h2><p className="text-sm text-slate-500">{data.description}</p></div>
                <button className="btn-ghost p-2 text-rose-500" onClick={remove} aria-label="Delete dataset"><Trash2 className="h-4 w-4" /></button>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {data.columns.map((c) => <StatTile key={c} name={c} s={data.stats[c]} />)}
              </div>
            </div>

            <div className="panel p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="section-title mr-auto flex items-center gap-2"><BarChart3 className="h-4 w-4 text-sky-500" />
                  {xIsNumeric ? `${y} vs ${x}` : `Mean ${y} by ${x}`}</p>
                <label className="text-xs text-slate-500">X</label>
                <select className="input w-auto py-1 text-xs" value={x} onChange={(e) => setX(e.target.value)}>{data.columns.map((c) => <option key={c}>{c}</option>)}</select>
                <label className="text-xs text-slate-500">Y</label>
                <select className="input w-auto py-1 text-xs" value={y} onChange={(e) => setY(e.target.value)}>{numericCols.map((c) => <option key={c}>{c}</option>)}</select>
              </div>
              {chartData.length === 0 ? <EmptyState icon={BarChart3} title="Nothing to plot">Choose a numeric Y column.</EmptyState> : (
                <div className="h-72">
                  <ResponsiveContainer>
                    {xIsNumeric ? (
                      <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                        <CartesianGrid stroke={t.grid} vertical={false} />
                        <XAxis type="number" dataKey="x" name={x} stroke={t.axis} fontSize={11} tickLine={false} />
                        <YAxis type="number" dataKey="y" name={y} stroke={t.axis} fontSize={11} tickLine={false} axisLine={false} />
                        <ZAxis range={[80, 80]} />
                        <Tooltip {...t.tooltip} cursor={{ stroke: t.axis, strokeDasharray: "3 3" }} />
                        <Scatter data={chartData} fill={t.series[0]} stroke={t.surface} strokeWidth={2} />
                      </ScatterChart>
                    ) : (
                      <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barCategoryGap="30%">
                        <CartesianGrid stroke={t.grid} vertical={false} />
                        <XAxis dataKey="x" stroke={t.axis} fontSize={11} tickLine={false} />
                        <YAxis stroke={t.axis} fontSize={11} tickLine={false} axisLine={false} />
                        <Tooltip {...t.tooltip} cursor={{ fill: t.grid, opacity: 0.5 }}
                          formatter={(v, _n, p) => [`${v} (n=${p.payload.n})`, `mean ${y}`]} />
                        <Bar dataKey="y" fill={t.series[0]} radius={[4, 4, 0, 0]} maxBarSize={56} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="panel overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
                <Filter className="h-4 w-4 text-slate-400" />
                <select className="input w-auto py-1 text-xs" value={filter.column} onChange={(e) => setFilter({ ...filter, column: e.target.value })}>
                  <option value="">Filter column...</option>{data.columns.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input className="input w-48 py-1 text-xs" placeholder="contains..." value={filter.value}
                  onChange={(e) => setFilter({ ...filter, value: e.target.value })} disabled={!filter.column} />
                <span className="ml-auto text-xs text-slate-500">{data.total_rows} row(s)</span>
              </div>
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>{data.columns.map((c) => (
                      <th key={c} className="table-head">
                        <button className="inline-flex items-center gap-1" onClick={() => setSort((s) => ({ key: c, order: s.key === c && s.order === "asc" ? "desc" : "asc" }))}>
                          {c}<ArrowDownUp className={`h-3 w-3 ${sort.key === c ? "text-teal-500" : ""}`} />
                        </button>
                      </th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.rows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {data.columns.map((c) => <td key={c} className={`table-cell ${typeof r[c] === "number" ? "tabular-nums" : ""}`}>{String(r[c] ?? "")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
