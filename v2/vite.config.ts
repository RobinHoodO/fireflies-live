import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "node:crypto";

// Per-session secret shared between the bridge and the frontend (via /api/fireflies-key).
const bridgeToken = randomUUID();

// Inject the Fireflies + OpenRouter keys (read from the operator's local .env) and
// the per-session bridge token. Same endpoint the original app used.
function firefliesKeyPlugin() {
  return {
    name: "fireflies-key",
    configureServer(server: any) {
      server.middlewares.use("/api/fireflies-key", (req: any, res: any) => {
        // Same-origin gate: only the app's own fetch may read the keys. Blocks
        // cross-origin browser reads and DNS-rebinding (non-loopback Host).
        const host = String(req.headers.host || "");
        const sfs = req.headers["sec-fetch-site"];
        const loopbackHost = host === "localhost:5173" || host === "127.0.0.1:5173";
        const crossOrigin = sfs && sfs !== "same-origin" && sfs !== "none";
        if (!loopbackHost || crossOrigin) { res.statusCode = 403; res.end("forbidden"); return; }
        try {
          const env = fs.readFileSync(path.resolve("/Users/robinsverd/Thrivbe-AI/.env"), "utf-8");
          const ffMatch = env.match(/FIREFLY_API_KEY=(.+)/);
          const orMatch = env.match(/OPENROUTER_API=(.+)/);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ffKey: ffMatch ? ffMatch[1].trim() : "", orKey: orMatch ? orMatch[1].trim() : "", bridgeToken }));
        } catch {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ffKey: "", orKey: "", bridgeToken }));
        }
      });
    },
  };
}

// Boot the localhost-only command bridge alongside the dev server; killed on exit.
function bridgePlugin() {
  return {
    name: "fireflies-bridge",
    configureServer() {
      const child = spawn("node", [path.resolve(__dirname, "../server/bridge.mjs")], { stdio: "inherit", env: { ...process.env, BRIDGE_TOKEN: bridgeToken } });
      const kill = () => { try { child.kill(); } catch {} };
      process.on("exit", kill); process.on("SIGINT", () => { kill(); process.exit(); }); process.on("SIGTERM", () => { kill(); process.exit(); });
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), firefliesKeyPlugin(), bridgePlugin()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/bridge": { target: "http://127.0.0.1:8787", changeOrigin: true, rewrite: (p) => p.replace(/^\/bridge/, "") },
    },
  },
});
