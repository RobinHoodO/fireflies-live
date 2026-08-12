#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMeetingStore, retentionPolicyFromEnv } from "./meeting-store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const envFile = process.env.SERVE_ENV_FILE || "/opt/Thrivbe-AI/.env";
const fileEnv = {};
try {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) fileEnv[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
} catch { /* process environment remains authoritative */ }

const env = { ...fileEnv, ...process.env };
const recordsDir = env.BRIDGE_FILE_DIR || path.resolve(here, "../../../content/meetings/transcripts");
const store = createMeetingStore({ recordsDir, retentionPolicy: retentionPolicyFromEnv(env) });
const result = await store.runLifecycle({ apply });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!apply) process.stdout.write("Dry run only. Re-run with --apply after reviewing the listed basenames.\n");
