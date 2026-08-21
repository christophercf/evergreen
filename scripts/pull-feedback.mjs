// ----------------------------------------------------------------------------
// Pull every report filed in the app into FEEDBACK.md — the tracker Chris and
// Claude work from.
//
// READ-ONLY against live. It never writes to Supabase; the only thing it
// changes is the markdown file.
//
// Triage lines already in FEEDBACK.md are preserved and re-attached by id, so
// re-running this never loses a decision. New reports arrive at the top of the
// Open table; anything closed in the app moves to Closed.
//
//   node scripts/pull-feedback.mjs            → refresh FEEDBACK.md from live
//   node scripts/pull-feedback.mjs --file x   → read a local db snapshot instead
// ----------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

const OUT = "FEEDBACK.md";
const KIND = { bug: "Bug", feature: "Feature", wording: "Wording", question: "Question" };
const SEV = { blocking: "Blocking", annoying: "Annoying", cosmetic: "Cosmetic" };

function envFrom(file) {
  if (!fs.existsSync(file)) return {};
  const t = fs.readFileSync(file, "utf8");
  const g = (k) => t.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim();
  return { url: g("NEXT_PUBLIC_SUPABASE_URL"), key: g("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
}

async function loadDb() {
  const fileArg = process.argv.indexOf("--file");
  if (fileArg > -1) return JSON.parse(fs.readFileSync(process.argv[fileArg + 1], "utf8"));

  // .env.local.bak exists mid-QA while .env.local is switched to mock.
  const env = [".env.local", ".env.local.bak"].map(envFrom).find((e) => e.url && e.key);
  if (!env) throw new Error("No Supabase URL/key found in .env.local — pass --file <snapshot.json> instead.");
  const r = await fetch(`${env.url}/rest/v1/project_state?id=eq.evergreen&select=db,updated_at`, {
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}` },
  });
  if (!r.ok) throw new Error(`Supabase said ${r.status}: ${await r.text()}`);
  const [row] = await r.json();
  if (!row) throw new Error("No project_state row for id=evergreen.");
  console.log(`Live state as of ${row.updated_at}`);
  return row.db;
}

/** Triage lines already written against each id, so a re-pull keeps them. */
function existingTriage() {
  if (!fs.existsSync(OUT)) return new Map();
  const text = fs.readFileSync(OUT, "utf8");
  const out = new Map();
  // Each item block starts with "### <id> · ..." and may carry a Triage line.
  const blocks = text.split(/\n(?=### )/);
  for (const b of blocks) {
    const id = b.match(/^### (\S+)/)?.[1];
    if (!id) continue;
    const triage = b.match(/^\*\*Triage:\*\*(.*)$/m)?.[1]?.trim();
    // The placeholder is not a decision, so it is not worth preserving or
    // counting — otherwise every untouched item reports as triaged.
    if (triage && triage !== "_not yet triaged_") out.set(id, triage);
  }
  return out;
}

const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
const short = (s, n = 70) => (esc(s).length > n ? `${esc(s).slice(0, n - 1)}…` : esc(s));

function render(items, triage, stamp) {
  const open = items.filter((f) => !f.done);
  const closed = items.filter((f) => f.done);
  const bugs = open.filter((f) => f.kind === "bug");
  const blocking = bugs.filter((f) => f.severity === "blocking");

  const L = [];
  L.push("# Evergreen — feedback tracker");
  L.push("");
  L.push("Every report filed from inside the app, pulled straight from live. Regenerate with");
  L.push("`node scripts/pull-feedback.mjs` — it is read-only against the database and preserves");
  L.push("every **Triage:** line already written here, so decisions survive a refresh.");
  L.push("");
  L.push(`_Last pulled: ${stamp}_`);
  L.push("");
  L.push(`**${open.length} open** · ${bugs.length} bug${bugs.length === 1 ? "" : "s"}` +
    `${blocking.length ? ` (${blocking.length} blocking)` : ""} · ${closed.length} closed`);
  L.push("");
  L.push("## How to work this list");
  L.push("");
  L.push("1. Read the Open table. Blocking bugs first, then bugs, then everything else.");
  L.push("2. For each one you act on, write a **Triage:** line under its entry — what you decided");
  L.push("   and why. Free text; it is preserved across pulls.");
  L.push("3. Close it in the app (Help → the report → Close) when it ships. The next pull moves it");
  L.push("   to Closed, with its triage line intact.");
  L.push("4. The seat is load-bearing: a report from the owner seat is about what the owner can");
  L.push("   see, not what the builder can.");
  L.push("");

  const table = (rows) => {
    if (!rows.length) return ["_None._", ""];
    const out = ["| Id | Kind | Area | What | Seat | Filed |", "|---|---|---|---|---|---|"];
    for (const f of rows) {
      out.push(`| \`${f.id}\` | ${KIND[f.kind] ?? f.kind}${f.severity ? ` · ${SEV[f.severity] ?? f.severity}` : ""} ` +
        `| ${esc(f.area)} | ${short(f.what)} | ${esc(f.seat)} | ${String(f.at).slice(0, 10)} |`);
    }
    out.push("");
    return out;
  };

  L.push("## Open");
  L.push("");
  L.push(...table(open));
  L.push("## Closed");
  L.push("");
  L.push(...table(closed));

  L.push("---");
  L.push("");
  L.push("## The reports in full");
  L.push("");
  for (const f of [...open, ...closed]) {
    L.push(`### ${f.id} · ${KIND[f.kind] ?? f.kind}${f.severity ? ` · ${SEV[f.severity] ?? f.severity}` : ""} · ${esc(f.area)}${f.done ? " · CLOSED" : ""}`);
    L.push("");
    L.push(`${f.kind === "bug" ? "**What happened:** " : "**What is wanted:** "}${String(f.what ?? "").trim()}`);
    if (f.steps) L.push(`**Steps:** ${String(f.steps).trim()}`);
    if (f.expected) L.push(`**Expected instead:** ${String(f.expected).trim()}`);
    L.push(`**Filed as:** ${esc(f.seat)}, ${f.device} · ${esc(f.rom)} · ${esc(f.pkg)} · ${esc(f.screen)} · ${String(f.at).slice(0, 16).replace("T", " ")}`);
    L.push(`**Triage:** ${triage.get(f.id) ?? "_not yet triaged_"}`);
    L.push("");
  }
  if (!items.length) {
    L.push("_Nothing has been filed yet. Reports come from Help → File a bug or ask for a feature._");
    L.push("");
  }
  return L.join("\n");
}

const db = await loadDb();
const items = [...(db.feedback ?? [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
const triage = existingTriage();
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
fs.writeFileSync(path.resolve(OUT), render(items, triage, stamp));
console.log(`${OUT}: ${items.length} report(s), ${items.filter((f) => !f.done).length} open, ${triage.size} triage note(s) preserved.`);
