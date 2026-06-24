import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone config so v2 runs in isolation from the old app:
//   npx vite --config v2/vite.config.ts        (dev, port 5273)
//   npx vite build --config v2/vite.config.ts  (build)
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5273 },
});
