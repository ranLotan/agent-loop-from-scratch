import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // fail if taken, instead of moving to another port
    // The browser only talks to Vite, so no CORS is needed. The Host header stays
    // localhost:5173, which the API's Host check allows.
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
