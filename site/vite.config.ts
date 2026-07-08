import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3399,
    strictPort: true,
    host: true,
  },
  preview: {
    port: 3399,
    strictPort: true,
  },
});
