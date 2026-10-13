// Chart colours. Categorical slots are assigned in fixed order (never cycled) and were
// validated for colour-vision-deficiency separation against each theme's surface
// (white / slate-900). Light-mode slots 3-4 sit below 3:1 contrast, so every chart
// also ships a legend, tooltips and a table view.
export const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500"],
};

export function chartTheme(theme) {
  const dark = theme === "dark";
  return {
    series: SERIES[dark ? "dark" : "light"],
    grid: dark ? "#1e293b" : "#e2e8f0",
    axis: dark ? "#94a3b8" : "#64748b",
    surface: dark ? "#0f172a" : "#ffffff",
    tooltip: {
      contentStyle: {
        background: dark ? "#0f172a" : "#ffffff",
        border: `1px solid ${dark ? "#334155" : "#cbd5e1"}`,
        borderRadius: 8,
        fontSize: 12,
        color: dark ? "#f1f5f9" : "#0f172a",
      },
      labelStyle: { color: dark ? "#cbd5e1" : "#475569" },
      itemStyle: { color: dark ? "#f1f5f9" : "#0f172a" },
    },
  };
}
