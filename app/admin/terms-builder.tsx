"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { Pill } from "../ui/bits";
import { clauseCatalog, clusters, renderTerms } from "@/lib/data/terms";
import type { TermClause } from "@/lib/data/types";

const Lbl = ({ children }: { children: React.ReactNode }) =>
  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", margin: "2px 0" }}>{children}</div>;

export default function TermsBuilder({ tradeId, ro }: { tradeId: string; ro: boolean }) {
  const store = useStore();
  const db = store.db;
  const cfg = db.terms;
  const trade = db.trades.find((t) => t.id === tradeId);
  const canEdit = !ro && ["full_admin", "owner", "builder"].includes(store.session.role);

  const catalog = clauseCatalog(db);
  const enabled = new Set(cfg.enabledClauseIds);
  const ov = cfg.perTrade[tradeId] ?? {};
  const excluded = new Set(ov.disabledClauseIds ?? []);
  const extra = new Set(ov.extraClauseIds ?? []);
  const appliesToTrade = (c: TermClause) => (enabled.has(c.id) && !excluded.has(c.id)) || extra.has(c.id);

  const [tab, setTab] = useState<"standard" | "trade">("standard");

  return (
    <div className="card" style={{ padding: 16, marginTop: 18, borderTop: "3px solid var(--brass)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 className="serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--walnut)" }}>Contract Terms &amp; Conditions</h3>
        {!canEdit && <Pill color="var(--muted)">View only — builder / full admin can edit</Pill>}
        <div style={{ marginLeft: "auto", display: "inline-flex", gap: 6, background: "var(--cream-2)", padding: 4, borderRadius: 9 }}>
          {([["standard", "Standard (all contracts)"], ["trade", trade ? `Unique to ${trade.name}` : "Per trade"]] as const).map(([v, lbl]) => (
            <button key={v} onClick={() => setTab(v)} className="btn btn-sm" style={tab === v ? { background: "var(--walnut)", color: "#fff" } : { background: "transparent", border: "none" }}>{lbl}</button>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Tick the clusters of terms to apply to every contract, adjust per trade, or add your own. These map straight to Vendor Management &amp; the trade-packet PDF. <em>Suggested language — not legal advice.</em></p>

      {tab === "standard" ? (
        <div style={{ marginTop: 12 }}>
          <Lbl>Contract preamble</Lbl>
          <textarea value={cfg.preamble} disabled={!canEdit} onChange={(e) => store.setTermsField({ preamble: e.target.value })} style={{ width: "100%", minHeight: 56, fontSize: 12.5, resize: "vertical" }} />

          <Lbl>Standard clauses — tick to include</Lbl>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {clusters(db).map((cl) => (
              <div key={cl} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--sage-2)", marginBottom: 4 }}>{cl}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {catalog.filter((c) => c.cluster === cl).map((c) => (
                    <label key={c.id} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "flex-start" }}>
                      <input type="checkbox" checked={enabled.has(c.id)} disabled={!canEdit} onChange={(e) => store.toggleStandardClause(c.id, e.target.checked)} style={{ marginTop: 2 }} />
                      <span><strong>{c.title}</strong><br /><span style={{ color: "var(--muted)", fontSize: 11.5 }}>{c.body}</span></span>
                      {cfg.customClauses.some((x) => x.id === c.id) && canEdit && <button className="btn btn-sm" style={{ color: "var(--rust)", marginLeft: "auto" }} onClick={() => store.removeCustomClause(c.id)}>✕</button>}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {canEdit && <AddClause onAdd={(c) => store.addCustomClause(c)} />}

          <Lbl>Binding / e-signature language (shown above signatures)</Lbl>
          <textarea value={cfg.bindingLanguage} disabled={!canEdit} onChange={(e) => store.setTermsField({ bindingLanguage: e.target.value })} style={{ width: "100%", minHeight: 70, fontSize: 12.5, resize: "vertical" }} />
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 12.5, color: "var(--muted)" }}>Adjust which terms apply to <strong>{trade?.name}</strong>. Unchecking a standard clause removes it for this trade only; checking an extra one adds it.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {clusters(db).map((cl) => (
              <div key={cl} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--sage-2)", marginBottom: 4 }}>{cl}</div>
                {catalog.filter((c) => c.cluster === cl).map((c) => {
                  const on = appliesToTrade(c);
                  const isStd = enabled.has(c.id);
                  return (
                    <label key={c.id} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "center" }}>
                      <input type="checkbox" checked={on} disabled={!canEdit} onChange={(e) => {
                        const want = e.target.checked;
                        if (isStd) store.setTradeClause(tradeId, c.id, want ? "default" : "exclude");
                        else store.setTradeClause(tradeId, c.id, want ? "include" : "default");
                      }} />
                      <span>{c.title}</span>
                      {!isStd && on && <Pill bg="var(--sage-tint)">added for trade</Pill>}
                      {isStd && !on && <Pill bg="#f3d9cf" color="var(--rust)">removed</Pill>}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
          <Lbl>Trade-specific addendum</Lbl>
          <textarea value={ov.note ?? ""} disabled={!canEdit} placeholder={`Anything unique to ${trade?.name} (e.g. deposit %, milestone billing, special exclusions)…`}
            onChange={(e) => store.setTradeTermsNote(tradeId, e.target.value)} style={{ width: "100%", minHeight: 52, fontSize: 12.5, resize: "vertical" }} />
          {(ov.customClauses ?? []).map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 8, fontSize: 12, marginTop: 4 }}>
              <span style={{ flex: 1 }}><strong>{c.title}</strong> — <span style={{ color: "var(--muted)" }}>{c.body}</span></span>
              {canEdit && <button className="btn btn-sm" style={{ color: "var(--rust)" }} onClick={() => store.removeCustomClause(c.id, tradeId)}>✕</button>}
            </div>
          ))}
          {canEdit && <AddClause onAdd={(c) => store.addCustomClause(c, tradeId)} forTrade />}
        </div>
      )}

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>Preview {trade ? `${trade.name} ` : ""}contract terms</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12, color: "var(--ink)", marginTop: 6, background: "var(--paper)", padding: 10, borderRadius: 8 }}>{renderTerms(db, tradeId)}</pre>
      </details>
    </div>
  );
}

function AddClause({ onAdd, forTrade }: { onAdd: (c: { cluster: string; title: string; body: string }) => void; forTrade?: boolean }) {
  const [open, setOpen] = useState(false);
  const [cluster, setCluster] = useState(forTrade ? "Custom" : "Custom");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  if (!open) return <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>＋ Add {forTrade ? "trade-specific" : "custom"} clause</button>;
  return (
    <div style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 10, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input placeholder="Cluster (e.g. General)" value={cluster} onChange={(e) => setCluster(e.target.value)} style={{ width: 160, fontSize: 12.5 }} />
        <input placeholder="Clause title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, fontSize: 12.5 }} />
      </div>
      <textarea placeholder="Clause text…" value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 50, fontSize: 12.5, resize: "vertical" }} />
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-sm btn-primary" disabled={!title.trim() || !body.trim()} onClick={() => { onAdd({ cluster: cluster.trim() || "Custom", title: title.trim(), body: body.trim() }); setTitle(""); setBody(""); setOpen(false); }}>Add clause</button>
        <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
