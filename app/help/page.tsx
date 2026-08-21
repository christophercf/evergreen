"use client";

import { useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, Pill, SectionTitle } from "../ui/bits";
import { ROLE_LABEL, FEEDBACK_KIND_LABEL, FEEDBACK_SEVERITY_LABEL, accessFor,
  type FeedbackKind, type FeedbackSeverity, type ModuleKey } from "@/lib/data/types";
import { HELP, HELP_RULES, SEAT_BLURB } from "@/lib/help/content";
import { briefText } from "@/lib/help/brief";

// ---------------------------------------------------------------------------
// Help, and the report form that belongs with it.
//
// Help is per seat: the steps someone actually takes, in the order the app
// makes them take them. The form sits underneath because the moment you need
// help is the moment you have something to say about the app.
// ---------------------------------------------------------------------------

const MUTED = "var(--muted)";

const AREA_MODULES: [ModuleKey, string][] = [
  ["dashboard", "Dashboard"], ["costs", "Budget Management"], ["bids", "Bid and Package Management"],
  ["payments", "Draw Management"], ["vendors", "Contracts"], ["budget", "Funding"],
  ["timing", "Schedule"], ["materials", "Materials"], ["updates", "Messages"],
  ["artifacts", "Artifacts"], ["admin", "Administrative"], ["help", "Help"],
];
const ACROSS = "Something across the whole app";

export default function HelpPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const seat = HELP[role];

  return (
    <>
      <PageHeader
        title="Help"
        subtitle={SEAT_BLURB[role]}
        right={<Pill color="var(--muted)">{ROLE_LABEL[role]} seat</Pill>}
      />

      <div style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch", margin: "16px 0 4px" }}>{seat.lead}</div>

      <SectionTitle>How the job runs from here</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {seat.flow.map((s) => {
          // A step that points at a module this seat cannot reach would be a
          // dead end, so it is shown without its link rather than hidden.
          const mod = MODULE_FOR_ROUTE[s.to];
          const reachable = !mod || accessFor(user, role, mod) !== "none";
          return (
            <div key={s.n} className="card" style={{ padding: "11px 13px", display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span className="serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--brass-2)", minWidth: 26, lineHeight: 1.2 }}>{s.n}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13.5, color: "var(--walnut)" }}>{s.t}</strong>
                  {reachable ? (
                    <Link href={s.to} style={{ fontSize: 11.5, color: "var(--sage-2)", fontWeight: 600 }}>Take me there →</Link>
                  ) : (
                    <span style={{ fontSize: 11, color: MUTED }}>not on your seat</span>
                  )}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: MUTED, marginTop: 3 }}>{s.w}</div>
              </div>
            </div>
          );
        })}
      </div>

      {seat.tips.length ? (
        <>
          <SectionTitle>Worth knowing</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 10 }}>
            {seat.tips.map((t) => (
              <div key={t.t} className="card" style={{ padding: "11px 13px" }}>
                <strong style={{ fontSize: 12.5, color: "var(--walnut)" }}>{t.t}</strong>
                <div style={{ fontSize: 12, lineHeight: 1.55, color: MUTED, marginTop: 3 }}>{t.w}</div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <SectionTitle>How this app behaves, everywhere</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {HELP_RULES.map((r) => (
          <div key={r.t} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.55 }}>
            <span style={{ color: "var(--sage)", fontWeight: 700 }}>·</span>
            <div><strong style={{ color: "var(--walnut)" }}>{r.t}.</strong> <span style={{ color: MUTED }}>{r.w}</span></div>
          </div>
        ))}
      </div>

      <FeedbackForm />
      <Brief />

      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 18 }}>
        {db.feedback?.length ? `${db.feedback.length} report${db.feedback.length === 1 ? "" : "s"} filed.` : "No reports filed yet."}
      </div>
    </>
  );
}

/** Which module a Help link lands in, so a step this seat cannot reach says so
 *  instead of offering a link to a refusal. */
const MODULE_FOR_ROUTE: Record<string, ModuleKey> = {
  "/": "dashboard", "/costs": "costs", "/bids": "bids", "/payments": "payments",
  "/vendors": "vendors", "/budget": "budget", "/timing": "timing", "/materials": "materials",
  "/updates": "updates", "/artifacts": "artifacts", "/admin": "admin", "/qa": "admin",
};

// ---------------------------------------------------------------------------

function FeedbackForm() {
  const store = useStore();
  const role = store.session.role;
  const [kind, setKind] = useState<FeedbackKind>("bug");
  // Defaults to where they are, not to whatever happens to be first in the list
  // — an unpicked area should be true, not a guess at "Dashboard".
  const [area, setArea] = useState("Help");
  const [sev, setSev] = useState<FeedbackSeverity>("annoying");
  const [what, setWhat] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // The area list is the seat's own nav: you cannot file against a screen you
  // have never been able to open.
  const areas = AREA_MODULES
    .filter(([m]) => accessFor(store.currentUser, role, m) !== "none")
    .map(([, label]) => label)
    .concat([ACROSS]);

  const submit = () => {
    const r = store.fileFeedback({
      kind, area: area || "Help", severity: sev, what, steps, expected,
      device: typeof window !== "undefined" && window.innerWidth < 768 ? "phone" : "desktop",
      screen: "Help",
      pkg: "no package open",
    });
    if (r.ok) {
      setWhat(""); setSteps(""); setExpected("");
      setMsg({ ok: true, text: "Filed. The seat, screen and job state you were on went with it." });
    } else {
      setMsg({ ok: false, text: r.reason });
    }
  };

  return (
    <>
      <SectionTitle>File a bug or ask for a feature</SectionTitle>
      <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
          Write it here, from the seat and screen where you hit it. Your seat, your device, whether the
          ROM is locked and which screen you were on are attached automatically — that context is what
          makes a report fixable.
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(FEEDBACK_KIND_LABEL) as FeedbackKind[]).map((k) => (
            <button key={k} className={`btn btn-sm ${kind === k ? "btn-primary" : ""}`} onClick={() => setKind(k)}>
              {FEEDBACK_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 11.5, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
            Where
            <select value={area} onChange={(e) => setArea(e.target.value)} style={{ fontSize: 12.5 }}>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          {kind === "bug" ? (
            <label style={{ fontSize: 11.5, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
              How bad
              <select value={sev} onChange={(e) => setSev(e.target.value as FeedbackSeverity)} style={{ fontSize: 12.5 }}>
                {(Object.keys(FEEDBACK_SEVERITY_LABEL) as FeedbackSeverity[]).map((sv) => (
                  <option key={sv} value={sv}>{FEEDBACK_SEVERITY_LABEL[sv]}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <label style={{ fontSize: 11.5, color: MUTED }}>
          {kind === "bug" ? "What happened" : "What you want"}
          <textarea value={what} onChange={(e) => setWhat(e.target.value)} style={{ width: "100%", minHeight: 54, fontSize: 12.5, marginTop: 3 }}
            placeholder={kind === "bug" ? "One line: what the app did." : "One line: what you want it to do."} />
        </label>

        <label style={{ fontSize: 11.5, color: MUTED }}>
          Steps (optional)
          <textarea value={steps} onChange={(e) => setSteps(e.target.value)} style={{ width: "100%", minHeight: 40, fontSize: 12.5, marginTop: 3 }}
            placeholder="What you clicked, in order." />
        </label>

        {kind === "bug" ? (
          <label style={{ fontSize: 11.5, color: MUTED }}>
            What you expected instead
            <textarea value={expected} onChange={(e) => setExpected(e.target.value)} style={{ width: "100%", minHeight: 40, fontSize: 12.5, marginTop: 3 }}
              placeholder="Without this, whoever fixes it is guessing." />
          </label>
        ) : null}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={submit}>File it</button>
          {msg ? (
            <span role={msg.ok ? undefined : "alert"} style={{ fontSize: 12, fontWeight: 600, color: msg.ok ? "var(--ok)" : "var(--rust)" }}>
              {msg.text}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function Brief() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const all = db.feedback ?? [];
  // Everyone sees their own; the admin sees the lot, because the brief is how
  // the whole list reaches whoever is fixing it.
  const mine = role === "full_admin" ? all : all.filter((f) => f.filedBy === store.session.userId);
  const live = mine.filter((f) => !f.done);
  if (!mine.length) return null;

  const text = briefText(live);
  const copy = () => {
    if (!live.length) { setCopied("Nothing to copy — every report is closed."); return; }
    navigator.clipboard?.writeText(text).then(
      () => setCopied("Brief copied. Paste it straight into Claude."),
      () => { setOpen(true); setCopied("Copy was blocked here — the brief is open below, select it and copy."); },
    );
  };

  return (
    <>
      <SectionTitle right={
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setOpen((v) => !v)}>{open ? "Hide the brief" : "Show the brief"}</button>
          <button className="btn btn-sm btn-primary" onClick={copy}>Copy the brief for Claude</button>
        </div>
      }>
        {role === "full_admin" ? "Reports filed" : "Your reports"} — {live.length} open{mine.length - live.length ? `, ${mine.length - live.length} closed` : ""}
      </SectionTitle>

      {copied ? <div style={{ fontSize: 12, color: "var(--ok)", fontWeight: 600, marginBottom: 8 }}>{copied}</div> : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {mine.map((f) => (
          <div key={f.id} className="card" style={{ padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start", opacity: f.done ? 0.55 : 1 }}>
            <Pill color="#fff" bg={f.kind === "bug" ? "var(--rust)" : f.kind === "feature" ? "var(--sage)" : "var(--brass)"}>
              {FEEDBACK_KIND_LABEL[f.kind]}{f.severity ? ` · ${FEEDBACK_SEVERITY_LABEL[f.severity]}` : ""}
            </Pill>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.area}</div>
              <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.5, marginTop: 2 }}>{f.what}</div>
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>
                {f.seat}, {f.device} · {f.rom} · {f.pkg} · {f.screen} · {f.at.slice(0, 16).replace("T", " ")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {role === "full_admin" ? (
                <button className="btn btn-sm" onClick={() => store.setFeedbackDone(f.id, !f.done)}>{f.done ? "Reopen" : "Close"}</button>
              ) : null}
              <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeFeedback(f.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {open ? (
        <pre style={{
          marginTop: 10, maxHeight: 340, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
          fontSize: 11, lineHeight: 1.5, background: "var(--paper)", border: "1px solid var(--line)",
          borderRadius: 8, padding: 12, fontFamily: "var(--font-sans)",
        }}>{text}</pre>
      ) : null}
    </>
  );
}
