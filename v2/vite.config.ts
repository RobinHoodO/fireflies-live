import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "node:crypto";
import { createAppApi } from "../server/app-api.mjs";

// Per-session secret shared only between the same-origin server API and bridge.
const bridgeToken = randomUUID();

// Same-origin API: provider credentials and the broad bridge token never enter
// browser JavaScript. The client receives only capability booleans and results.
function firefliesKeyPlugin() {
  return {
    name: "fireflies-key",
    configureServer(server: any) {
      const api = createAppApi({
        envFile: path.resolve("/Users/robinsverd/Thrivbe-AI/.env"),
        bridgeToken,
        recordsDir: process.env.BRIDGE_FILE_DIR || path.resolve(__dirname, "../../../content/meetings/transcripts"),
        requireAuth: process.env.FIREFLIES_APP_AUTH_REQUIRED === "1",
        secureCookie: process.env.FIREFLIES_APP_COOKIE_SECURE === "1",
      });
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!String(req.url || "").startsWith("/api/")) { next(); return; }
        const host = String(req.headers.host || "");
        const sfs = req.headers["sec-fetch-site"];
        const loopbackHost = host === "localhost:5173" || host === "127.0.0.1:5173";
        const sameOrigin = sfs === "same-origin" || sfs === "none";
        if (!loopbackHost || !sameOrigin) { res.statusCode = 403; res.end("forbidden"); return; }
        api(req, res);
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
  },
});
