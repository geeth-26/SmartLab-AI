/** @type {import('tailwindcss').Config} */
// Design tokens. Text/background pairs were checked for WCAG AA contrast:
// accent buttons use accent-strong (#0F766E, 5.5:1 with white); #0D9488 is used for
// focus rings, icons and active indicators only. Warning *text* uses warning-ink.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F7F9FC",
        surface: "#FFFFFF",
        subtle: "#EEF4F7",
        line: "#DCE5EC",
        ink: "#172033",
        muted: "#64748B",
        accent: { DEFAULT: "#0D9488", strong: "#0F766E", deeper: "#115E59", soft: "#E6F4F2" },
        nav: { DEFAULT: "#101B2D", 2: "#15243A", line: "#22324B", text: "#CBD5E1", dim: "#94A3B8" },
        success: { DEFAULT: "#15803D", soft: "#ECFDF3" },
        warning: { DEFAULT: "#D97706", ink: "#B45309", soft: "#FEF6E7" },
        critical: { DEFAULT: "#B91C1C", soft: "#FDECEC" },
        info: { DEFAULT: "#2563EB", soft: "#EEF4FF" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: { "2xs": ["0.6875rem", "1rem"] },
      maxWidth: { prose: "46rem" },
      boxShadow: { panel: "0 1px 2px rgba(16, 27, 45, 0.04)", pop: "0 8px 24px rgba(16, 27, 45, 0.12)" },
    },
  },
  plugins: [],
};
