import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies /api to the Flask backend, so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 800 },
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.SMARTLAB_API ?? "http://127.0.0.1:5000", changeOrigin: true } },
  },
});
