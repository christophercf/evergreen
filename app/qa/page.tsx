"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill, SectionTitle, StatCard } from "../ui/bits";
import { runChecks, accessMatrix, type Finding, type Severity } from "@/lib/qa/checks";

// ---------------------------------------------------------------------------
// Diagnostics — the half of QA that can be decided from the data.
//
// The checks live in lib/qa/checks.ts and read the same functions the screens
// read, so this page cannot pass while a screen is wrong. What it cannot see —
// whether a workflow stalls, whether a button says it saved, whether it works
// on a phone — is in QA.md and needs a person or the QA agent.
// ---------------------------------------------------------------------------

const SEV: Record<Severity, { label: string; bg: string; fg: string }> = {
  fail: { label: "Fail", bg: "var(--rust)", fg: "#fff" },
  warn: { label: "Warn", bg: "var(--brass)", fg: "#fff" },
  info: { label: "Note", bg: "var(--cream-2)", fg: "var(--muted)" },
};

export default function QaPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const [showMatrix, setShowMatrix] = useState(false);
  const [showRan, setShowRan] = useState(false);

  const report = useMemo(() => runChecks(db), [db]);
  const matrix = useMemo(() => accessMatrix(db), [db]);

  // Diagnostics exposes every user's access and every contract sum in one
  // place. That is an administrator's view, not a project member's.
  if (role !== "full_admin") return <NoAccess module="Diagnostics" />;

  const byArea = report.findings.reduce<Record<string, Finding[]>>((acc, f) => {
    (acc[f.area] ??= []).push(f);
    return acc;
  }, {});
  const clean = report.findings.length === 0;

  return (
    <>
      <PageHeader
        title="Diagnostics"
        subtitle="Everything QA can decide from the data alone: whether trades, rooms, vendors and budget lines all resolve to one source, whether the money adds up, and whether every user reaches exactly the modules their role grants. The rest of the QA pass — workflow, buttons, mobile — is in QA.md."
        right={<Pill color="var(--muted)">{report.checksRun.length} checks</Pill>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 16 }}>
        <StatCard label="Failures" value={String(report.counts.fail)} accent={report.counts.fail ? "var(--rust)" : "var(--ok)"}
          sub={report.counts.fail ? "wrong on screen, not just in the data" : "nothing broken"} />
        <StatCard label="Warnings" value={String(report.counts.warn)} accent={report.counts.warn ? "var(--brass-2)" : undefined}
          sub="worth a look, not blocking" />
        <StatCard label="Notes" value={String(report.counts.info)} sub="context, no action implied" />
        <StatCard label="Checks run" value={String(report.checksRun.length)} sub={`as of ${report.ranAt.slice(0, 16).replace("T", " ")}`} />
      </div>

      {clean ? (
        <div className="card" style={{ padding: 20, marginTop: 16, fontSize: 13, color: "var(--ok)", fontWeight: 600 }}>
          ✓ All {report.checksRun.length} data checks pass. The workflow, button and mobile passes in QA.md still need running.
        </div>
      ) : (
        Object.entries(byArea).map(([area, list]) => (
          <div key={area} style={{ marginTop: 18 }}>
            <SectionTitle>{area} — {list.length}</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((f, i) => (
                <div key={i} className="card" style={{
                  padding: "9px 12px", display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5,
                  borderLeft: `3px solid ${SEV[f.severity].bg}`,
                }}>
                  <Pill color={SEV[f.severity].fg} bg={SEV[f.severity].bg}>{SEV[f.severity].label}</Pill>
                  <div style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>
                    {f.message}
                    {f.where ? <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{f.where}</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={() => setShowMatrix((v) => !v)}>
          {showMatrix ? "Hide" : "Show"} role × module matrix
        </button>
        <button className="btn btn-sm" onClick={() => setShowRan((v) => !v)}>
          {showRan ? "Hide" : "Show"} the {report.checksRun.length} checks
        </button>
        <button className="btn btn-sm" onClick={() => {
          // The QA agent reads this straight off the clipboard rather than
          // scraping the page.
          void navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
        }}>Copy report as JSON</button>
      </div>

      {showMatrix ? (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                {["User", "Role", ...Object.keys(matrix[0]?.access ?? {})].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((m) => (
                <tr key={m.user.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>{m.user.name}</td>
                  <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{m.role}</td>
                  {Object.entries(m.access).map(([k, v]) => (
                    <td key={k} style={{ padding: "6px 8px", color: v === "none" ? "var(--muted)" : v === "edit" ? "var(--ok)" : "var(--brass-2)" }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showRan ? (
        <ol style={{ marginTop: 12, paddingLeft: 20, fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
          {report.checksRun.map((c, i) => <li key={i}>{c}</li>)}
        </ol>
      ) : null}
    </>
  );
}
