import type { FeedbackItem } from "../data/types";
import { FEEDBACK_KIND_LABEL, FEEDBACK_SEVERITY_LABEL } from "../data/types";

// ----------------------------------------------------------------------------
// The brief: every open report as one markdown document, to be pasted straight
// into Claude Code. This is how iteration on this app is meant to run, so the
// format is fixed and the context travels with each item.
// ----------------------------------------------------------------------------

export function briefText(items: FeedbackItem[]): string {
  if (!items.length) return "";
  const head = [
    "# Evergreen — change requests from the app",
    "",
    `${items.length} ${items.length === 1 ? "item" : "items"}, newest first. Each was filed from inside the running`,
    "app, so it carries the seat, screen and job state it was filed from. Treat the seat as",
    "load-bearing: a report from the owner seat is about what the owner can see, not what the",
    "builder can.",
    "",
    "Repo: christophercf/evergreen · live: https://evergreen-rust-five.vercel.app",
    "",
  ].join("\n");

  const body = items.map((f, i) => {
    const tag = f.severity ? `${FEEDBACK_KIND_LABEL[f.kind]} · ${FEEDBACK_SEVERITY_LABEL[f.severity]}` : FEEDBACK_KIND_LABEL[f.kind];
    const L = ["---", "", `## ${i + 1}. [${tag}] ${f.area}`, ""];
    L.push(`${f.kind === "bug" ? "**What happened:** " : "**What is wanted:** "}${f.what}`);
    if (f.steps) L.push(`**Steps:** ${f.steps}`);
    if (f.expected) L.push(`**Expected instead:** ${f.expected}`);
    L.push(`**Filed as:** ${f.seat}, ${f.device} · ${f.rom} · ${f.pkg} · ${f.screen} · ${f.at.slice(0, 16).replace("T", " ")}`);
    L.push("");
    return L.join("\n");
  }).join("\n");

  return `${head}\n${body}`;
}
