#!/usr/bin/env node
// Diff the LIVE stream we recorded against the FINAL Fireflies transcript.
//
// Why this exists: Fireflies' realtime API (beta) can return a speaker's audio
// in the wrong language for a whole meeting while the batch pass transcribes
// them perfectly. Because the final transcript is clean, the fault is invisible
// to anyone reviewing afterwards — it went unnoticed from 2026-07-31 to
// 2026-08-07, two calls in a row. Reading the final transcript is not evidence
// that realtime worked; only this diff is.
//
//   node server/langcheck.mjs [record.md ...]
//
// With no arguments it checks every record in the transcripts dir. Exit 1 when
// any speaker came through garbled live but clean in the final — the signature
// of the realtime language fault. See docs/postmortem-2026-08-07-max.md.
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.LANGCHECK_DIR || "/opt/Thrivbe-AI/content/meetings/transcripts";
const ENV_FILE = process.env.SERVE_ENV_FILE || "/opt/Thrivbe-AI/.env";

// Scripts a wrong-language lock produces for an English call. Latin diacritics
// are NOT here on purpose: "café" is not a failure, "Майн Змі" is.
const FOREIGN = /[\p{sc=Cyrillic}\p{sc=Greek}\p{sc=Arabic}\p{sc=Hebrew}\p{sc=Han}\p{sc=Hangul}]/u;
const GARBLED_RATIO = 0.3;

function key() {
  // 1Password Phase 6: environment first (oprun), plaintext file fallback, never an op:// address.
  const fromEnv = process.env.FIREFLY_API_KEY;
  if (fromEnv && !fromEnv.startsWith("op://")) return fromEnv;
  const env = fs.readFileSync(ENV_FILE, "utf8");
  const m = env.match(/^FIREFLY_API_KEY=(.*)$/m);
  if (!m) throw new Error(`FIREFLY_API_KEY not in ${ENV_FILE}`);
  const value = m[1].trim().replace(/^["']|["']$/g, "").trim();
  if (value.startsWith("op://")) throw new Error(`FIREFLY_API_KEY in ${ENV_FILE} is a 1Password address; run: oprun --env-file ${ENV_FILE} -- node server/langcheck.mjs`);
  return value;
}

// Per-speaker: how many of their turns came out in a foreign script.
function tally(turns) {
  const per = new Map();
  for (const { speaker, text } of turns) {
    const k = nameKey(speaker);
    const s = per.get(k) ?? { name: speaker, turns: 0, words: 0, bad: 0 };
    s.turns++;
    s.words += text.split(/\s+/).filter(Boolean).length;
    if (FOREIGN.test(text)) s.bad++;
    per.set(k, s);
  }
  return per;
}

const garbled = s => s.turns >= 6 && s.bad / s.turns >= GARBLED_RATIO;

// Live and final disagree on punctuation for the same person ("Robin T. Sverd"
// vs "Robin T Sverd"), which otherwise reports a speaker as 0 words in the
// final and reads like data loss.
const nameKey = s => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Our own record format: "## Transcript" then "**Speaker:** text" blocks.
function readLive(file) {
  const body = fs.readFileSync(file, "utf8").split("## Transcript")[1]?.split("\n## ")[0] ?? "";
  return body.split("\n").reduce((acc, line) => {
    const m = /^\*\*(.+?):\*\*\s*(.*)$/.exec(line.trim());
    if (m) acc.push({ speaker: m[1], text: m[2] });
    return acc;
  }, []);
}

async function gql(query, token) {
  const r = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const d = await r.json();
  if (d.errors) throw new Error(d.errors[0]?.message || "Fireflies API error");
  return d.data;
}

async function finalFor(title, token) {
  // Match on title, then take the transcript closest to the record's own date —
  // recurring calls reuse the same title, so title alone picks the wrong one.
  const escaped = JSON.stringify(title);
  const d = await gql(`{ transcripts(title: ${escaped}, limit: 10) { id title dateString sentences { speaker_name text } } }`, token);
  return d.transcripts ?? [];
}

async function check(file, token) {
  const stem = path.basename(file, ".md").replace(/-live$/, "");
  const day = stem.slice(0, 10);
  const title = fs.readFileSync(file, "utf8").match(/^# (.+)$/m)?.[1]?.trim();
  if (!title) return { file, skipped: "no title heading" };

  const live = tally(readLive(file));
  const candidates = await finalFor(title, token);
  const match = candidates.find(t => (t.dateString || "").slice(0, 10) === day) ?? candidates[0];
  if (!match) return { file, skipped: `no Fireflies transcript titled ${JSON.stringify(title)}` };
  const fin = tally((match.sentences ?? []).map(s => ({ speaker: s.speaker_name, text: s.text || "" })));

  const rows = [...live].map(([k, l]) => {
    const f = fin.get(k) ?? { turns: 0, words: 0, bad: 0 };
    return { speaker: l.name, live: l, final: f, hidden: garbled(l) && !garbled(f) };
  });
  return { file, title, id: match.id, rows };
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(DIR).filter(f => f.endsWith(".md")).map(f => path.join(DIR, f));

const token = key();
let failed = 0;
for (const file of files) {
  const r = await check(file, token);
  console.log(`\n${path.basename(r.file)}`);
  if (r.skipped) { console.log(`  skipped — ${r.skipped}`); continue; }
  console.log(`  final transcript ${r.id}`);
  for (const { speaker, live, final, hidden } of r.rows) {
    const flag = hidden ? "  ← GARBLED LIVE, CLEAN IN FINAL" : "";
    console.log(`  ${speaker}: live ${live.words}w (${live.bad}/${live.turns} foreign) · final ${final.words}w (${final.bad}/${final.turns} foreign)${flag}`);
    if (hidden) failed++;
  }
}
console.log(failed ? `\n${failed} speaker(s) hit the realtime language fault.` : "\nNo hidden realtime language faults.");
process.exit(failed ? 1 : 0);
