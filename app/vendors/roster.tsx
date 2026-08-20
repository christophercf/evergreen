"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { vendorTrades, vendorCovers, VENDOR_DOC_LABEL, type ContactSheet, type VendorDoc } from "@/lib/data/types";
import { fmt, tradeName } from "@/lib/data/money";
import { PageHeader, Pill, StatCard, NumInput } from "../ui/bits";
import { AddVendor } from "../admin/add-vendor";

// ---------------------------------------------------------------------------
// Vendor Management — the roster.
//
// A vendor is a company, not a trade. The roster is the directory the whole
// project draws on: it decides who appears for a bid package, it carries the
// documents we hold on them, and it keeps the record of how they have priced
// and performed. Nothing here is scoped to one job.
// ---------------------------------------------------------------------------

const MUTED = "var(--muted)";
type Sort = "az" | "rating" | "used";
type View = "cards" | "table";

/** What a vendor has bid, and how it went — read off the packages themselves. */
function historyOf(db: ReturnType<typeof useStore>["db"], c: ContactSheet) {
  const rows = (db.bidPackages ?? []).flatMap((p) =>
    (p.bids ?? [])
      .filter((b) => b.contactId === c.id || b.vendorName === c.company)
      .map((b) => ({
        pkg: p.title,
        date: p.createdAt?.slice(0, 10) ?? "",
        amount: b.amount,
        outcome: p.awardedBidId === b.id ? "Won" : b.status === "declined" ? "Declined"
          : b.status === "received" ? "Bid in" : p.status === "awarded" ? "Not awarded" : "Bidding",
      })),
  );
  const decided = rows.filter((r) => r.outcome === "Won" || r.outcome === "Not awarded");
  return {
    rows: rows.sort((a, b) => b.date.localeCompare(a.date)),
    won: rows.filter((r) => r.outcome === "Won").length,
    winRate: decided.length ? Math.round((rows.filter((r) => r.outcome === "Won").length / decided.length) * 100) : null,
    last: rows[0],
  };
}

const expired = (d?: string) => !!d && d < new Date().toISOString().slice(0, 10);

function docState(c: ContactSheet): { label: string; bg: string; color: string } {
  const docs = c.docs ?? [];
  const dated = docs.filter((d) => d.expires || d.number);
  if (!dated.length) return { label: "Nothing on file", bg: "var(--cream-2)", color: "var(--walnut)" };
  if (docs.some((d) => expired(d.expires))) return { label: "Lapsed", bg: "var(--rust)", color: "#fff" };
  return { label: "On file", bg: "var(--sage)", color: "#fff" };
}

export function VendorRoster() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const ro = !["full_admin", "builder", "owner"].includes(role);

  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState("all");
  const [sort, setSort] = useState<Sort>("az");
  const [view, setView] = useState<View>("table");

  const vendors = useMemo(() => db.contacts.filter((c) => c.party === "vendor"), [db.contacts]);

  // Only trades somebody actually covers — a filter listing 44 empty options is
  // a worse filter than none.
  const tradesUsed = useMemo(() => {
    const ids = new Set(vendors.flatMap((v) => vendorTrades(v)));
    return db.trades.filter((t) => ids.has(t.id));
  }, [vendors, db.trades]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = vendors.filter((v) => {
      if (trade !== "all" && !vendorCovers(v, trade)) return false;
      if (!needle) return true;
      const hay = [v.company, v.contactName, v.city, v.phone, v.email, ...vendorTrades(v).map((t) => tradeName(db, t))]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(needle);
    });
    return out.sort((a, b) => {
      if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0) || a.company.localeCompare(b.company);
      if (sort === "used") return (b.jobsWithUs ?? 0) - (a.jobsWithUs ?? 0) || a.company.localeCompare(b.company);
      return a.company.localeCompare(b.company);
    });
  }, [vendors, q, trade, sort, db]);

  const open = openId ? vendors.find((v) => v.id === openId) : undefined;

  if (adding) {
    return (
      <>
        <PageHeader title="Add a vendor" subtitle="They join the roster and appear for every trade you tick." />
        <AddVendor onDone={(id) => { setAdding(false); if (id) setOpenId(id); }} />
      </>
    );
  }
  if (open) return <VendorProfile c={open} ro={ro} onBack={() => setOpenId(null)} />;

  const lapsed = vendors.filter((v) => (v.docs ?? []).some((d) => expired(d.expires))).length;
  const covered = new Set(vendors.flatMap((v) => vendorTrades(v))).size;

  return (
    <>
      <PageHeader
        title="Vendor Management"
        subtitle="Every company we can call on. A vendor is a company, not a trade — one vendor covers as many trades as they actually work in, and that is what decides which packages they appear for."
        right={!ro ? <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>＋ Add a vendor</button> : undefined}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 14 }}>
        <StatCard label="Vendors" value={String(vendors.length)} sub={`${covered} trades covered`} />
        <StatCard label="Rated" value={String(vendors.filter((v) => v.rating).length)} sub="of the roster" />
        <StatCard label="Documents lapsed" value={String(lapsed)} accent={lapsed ? "var(--rust)" : "var(--ok)"} sub="dates as supplied" />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "16px 0 10px" }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, contact, city…"
          style={{ flex: 1, minWidth: 190, fontSize: 12.5 }} />
        <select className="input" value={trade} onChange={(e) => setTrade(e.target.value)} style={{ fontSize: 12.5 }}>
          <option value="all">All trades</option>
          {tradesUsed.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {([["az", "A–Z"], ["rating", "Rating"], ["used", "Most used"]] as const).map(([k, l]) => (
          <button key={k} className="btn btn-sm" onClick={() => setSort(k)}
            style={{ background: sort === k ? "var(--sage-tint)" : undefined, fontWeight: sort === k ? 700 : 400 }}>{l}</button>
        ))}
        <span style={{ width: 1, height: 18, background: "var(--line)" }} />
        {([["table", "☰"], ["cards", "⊞"]] as const).map(([k, l]) => (
          <button key={k} className="btn btn-sm" onClick={() => setView(k)}
            style={{ background: view === k ? "var(--sage-tint)" : undefined }}>{l}</button>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 8 }}>
        {list.length} of {vendors.length} vendors{trade !== "all" ? ` covering ${tradeName(db, trade)}` : ""}
      </div>

      {!list.length ? (
        <div className="card" style={{ padding: 18, fontSize: 12.5, color: MUTED }}>
          Nobody matches that. Clear the search, or add a vendor.
        </div>
      ) : view === "table" ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 880, fontSize: 12.5 }}>
            <thead>
              <tr>{["Company", "Trades", "Contact", "Rating", "Documents on file", "Last job"].map((h) => (
                <th key={h} style={{
                  textAlign: "left", padding: "7px 10px", whiteSpace: "nowrap", fontSize: 10,
                  letterSpacing: ".09em", textTransform: "uppercase", color: MUTED, borderBottom: "1px solid var(--line)",
                }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {list.map((v) => {
                const h = historyOf(db, v);
                const ds = docState(v);
                return (
                  <tr key={v.id} onClick={() => setOpenId(v.id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "9px 10px" }}>
                      <strong style={{ color: "var(--walnut)" }}>{v.company}</strong>
                      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
                        {[v.city, v.paymentTerms].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td style={{ padding: "9px 10px", maxWidth: 220 }}>
                      <span style={{ fontSize: 11.5 }}>{vendorTrades(v).map((t) => tradeName(db, t)).join(" · ") || <em style={{ color: "var(--rust)" }}>no trades set</em>}</span>
                    </td>
                    <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                      {v.contactName ?? "—"}
                      <div style={{ fontSize: 10.5, color: MUTED }}>{v.phone ?? ""}</div>
                    </td>
                    <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>
                      {v.rating ? `${v.rating} / 5` : <span style={{ color: MUTED }}>New</span>}
                      <div style={{ fontSize: 10.5, color: MUTED }}>{v.jobsWithUs ? `${v.jobsWithUs} jobs` : ""}</div>
                    </td>
                    <td style={{ padding: "9px 10px" }}><Pill color={ds.color} bg={ds.bg}>{ds.label}</Pill></td>
                    <td style={{ padding: "9px 10px", whiteSpace: "nowrap", color: h.last ? "var(--ink)" : MUTED }}>
                      {h.last ? h.last.pkg.slice(0, 26) : "Not on a package yet"}
                      {h.last?.date ? <div style={{ fontSize: 10.5, color: MUTED }}>{h.last.date}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {list.map((v) => {
            const h = historyOf(db, v);
            const ds = docState(v);
            return (
              <div key={v.id} className="card" onClick={() => setOpenId(v.id)}
                style={{ padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <strong className="serif" style={{ fontSize: 15.5, color: "var(--walnut)" }}>{v.company}</strong>
                  <span style={{ fontSize: 12, color: MUTED }}>{v.rating ? `${v.rating}/5` : "New"}</span>
                </div>
                <div style={{ fontSize: 11.5, color: MUTED }}>{vendorTrades(v).map((t) => tradeName(db, t)).join(" · ") || "no trades set"}</div>
                <div style={{ fontSize: 12 }}>{v.contactName}{v.phone ? ` · ${v.phone}` : ""}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                  <Pill color={ds.color} bg={ds.bg}>{ds.label}</Pill>
                  {h.won ? <Pill color="var(--walnut)" bg="var(--cream-2)">{h.won} won</Pill> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function VendorProfile({ c, ro, onBack }: { c: ContactSheet; ro: boolean; onBack: () => void }) {
  const store = useStore();
  const db = store.db;
  const h = historyOf(db, c);
  const docs: VendorDoc[] = c.docs ?? [];
  const covers = vendorTrades(c);
  const set = (patch: Partial<ContactSheet>) => store.updateContactSheet(c.id, patch);

  return (
    <>
      <button className="btn btn-sm" style={{ marginBottom: 10 }} onClick={onBack}>← Back to the roster</button>
      {!ro ? <DeleteVendor c={c} history={h.rows.length} onDone={onBack} /> : null}
      <PageHeader
        title={c.company}
        subtitle={covers.map((t) => tradeName(db, t)).join(" · ") || "No trades set — they will not appear for any bid package."}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 14 }}>
        <StatCard label="Rating" value={c.rating ? `${c.rating} / 5` : "New"} sub={c.jobsWithUs ? `${c.jobsWithUs} jobs with us` : "no jobs recorded"} />
        <StatCard label="Win rate" value={h.winRate === null ? "—" : `${h.winRate}%`} sub={`${h.won} won of ${h.rows.length} bid${h.rows.length === 1 ? "" : "s"}`} />
        <StatCard label="Payment terms" value={c.paymentTerms || "—"} sub={c.city || ""} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <Kick>Company &amp; contact</Kick>
          <Field k="Company" v={c.company} ro={ro} onCommit={(v) => v.trim() && set({ company: v.trim() })} />
          <Field k="Primary contact" v={c.contactName} ro={ro} onCommit={(v) => set({ contactName: v.trim() || undefined })} />
          <Field k="Phone" v={c.phone} ro={ro} onCommit={(v) => set({ phone: v.trim() || undefined })} />
          <Field k="Email" v={c.email} ro={ro} onCommit={(v) => set({ email: v.trim() || undefined })} />
          <Field k="City" v={c.city} ro={ro} onCommit={(v) => set({ city: v.trim() || undefined })} />
          <Field k="Address" v={c.address} ro={ro} onCommit={(v) => set({ address: v.trim() || undefined })} />
          <Field k="Payment terms" v={c.paymentTerms} ro={ro} placeholder="Net 30" onCommit={(v) => set({ paymentTerms: v.trim() || undefined })} />

          <Kick style={{ marginTop: 16 }}>Insurance &amp; licence on file</Kick>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, margin: "3px 0 6px" }}>
            Dates are stored as supplied. This roster records them; it does not judge them or block a bid.
          </div>
          {(["gl", "wc", "license"] as const).map((kind) => {
            const d = docs.find((x) => x.kind === kind);
            const lapsed = expired(d?.expires);
            return (
              <div key={kind} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12, flexWrap: "wrap" }}>
                <span style={{ minWidth: 140 }}>{VENDOR_DOC_LABEL[kind]}</span>
                {ro ? (
                  <span style={{ color: lapsed ? "var(--rust)" : d?.expires ? "var(--ink)" : MUTED, fontWeight: lapsed ? 700 : 400 }}>
                    {d?.number ? `${d.number} · ` : ""}{d?.expires ? `${lapsed ? "Lapsed " : "Expires "}${d.expires}` : "Not on file"}
                  </span>
                ) : (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {kind === "license" ? (
                      <input className="input" defaultValue={d?.number ?? ""} placeholder="Number"
                        onBlur={(e) => store.setVendorDoc(c.id, kind, { number: e.target.value.trim() || undefined })}
                        style={{ width: 110, fontSize: 12 }} />
                    ) : null}
                    <input className="input" type="date" defaultValue={d?.expires ?? ""}
                      onBlur={(e) => store.setVendorDoc(c.id, kind, { expires: e.target.value || undefined })}
                      style={{ fontSize: 12, borderColor: lapsed ? "var(--rust)" : undefined }} />
                  </span>
                )}
              </div>
            );
          })}
          {!ro ? (
            <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
              {([["we_hold", "We hold them"], ["ask_vendor", "Vendor sends them"]] as const).map(([k, label]) => (
                <button key={k} className="btn btn-sm" onClick={() => set({ docRoute: k })}
                  style={{
                    background: c.docRoute === k ? "var(--sage)" : undefined,
                    color: c.docRoute === k ? "#fff" : undefined, fontWeight: c.docRoute === k ? 700 : 400,
                  }}>{label}</button>
              ))}
            </div>
          ) : c.docRoute ? (
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 7 }}>
              {c.docRoute === "we_hold" ? "We hold the certificates." : "The vendor sends the certificates."}
            </div>
          ) : null}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <Kick>What they can work on</Kick>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, margin: "3px 0 6px" }}>
            This is the directory index — it decides which bid packages they appear for.
          </div>
          {ro ? (
            <div style={{ fontSize: 12 }}>{covers.map((t) => tradeName(db, t)).join(" · ") || "—"}</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", maxHeight: 190, overflowY: "auto" }}>
                {db.trades.map((t) => {
                  const on = covers.includes(t.id);
                  return (
                    <button key={t.id} className="btn btn-sm"
                      onClick={() => {
                        const next = on ? covers.filter((x) => x !== t.id) : [...covers, t.id];
                        set({ tradeIds: next, tradeId: next[0] });
                      }}
                      style={{
                        background: on ? "var(--sage)" : undefined, color: on ? "#fff" : undefined,
                        fontWeight: on ? 700 : 400, fontSize: 11.5,
                      }}>{t.name}</button>
                  );
                })}
              </div>
              {!covers.length ? (
                <div style={{ fontSize: 11.5, color: "var(--rust)", marginTop: 6 }}>
                  No trades set — they will not appear for any bid package.
                </div>
              ) : null}
            </>
          )}

          <Kick style={{ marginTop: 16 }}>Internal review</Kick>
          <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 5 }}>Never shared with the vendor.</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", gap: 3 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} disabled={ro} onClick={() => set({ rating: c.rating === n ? undefined : n })}
                  title={`${n} of 5`}
                  style={{
                    width: 22, height: 22, borderRadius: 5, cursor: ro ? "default" : "pointer",
                    border: `1px solid ${(c.rating ?? 0) >= n ? "var(--sage)" : "var(--line)"}`,
                    background: (c.rating ?? 0) >= n ? "var(--sage)" : "var(--paper)",
                    color: "#fff", fontSize: 11,
                  }}>{(c.rating ?? 0) >= n ? "★" : ""}</button>
              ))}
            </span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: MUTED }}>
              jobs with us
              {ro ? <strong style={{ color: "var(--ink)" }}>{c.jobsWithUs ?? 0}</strong>
                : <NumInput value={c.jobsWithUs ?? 0} onCommit={(v) => set({ jobsWithUs: v || undefined })} width={64} />}
            </label>
          </div>

          <Kick style={{ marginTop: 14 }}>Notes</Kick>
          {ro ? (
            <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>{c.internalNote || <em style={{ color: MUTED }}>Nothing recorded.</em>}</div>
          ) : (
            <textarea className="input" defaultValue={c.internalNote ?? ""}
              placeholder="How they actually work out — never shared"
              onBlur={(e) => set({ internalNote: e.target.value.trim() || undefined })}
              style={{ width: "100%", minHeight: 72, fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }} />
          )}

          <Kick style={{ marginTop: 16 }}>Who holds this relationship</Kick>
          <div style={{ fontSize: 12, lineHeight: 1.55, marginTop: 4 }}>
            {c.tradeId && db.trades.find((t) => t.id === c.tradeId)?.managedBy === "owner"
              ? "Owner-managed. The owner contracts and pays them direct, and the builder takes no fee on their work."
              : "Builder-managed. The GC carries the contract and the fee."}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, marginTop: 5 }}>
            Set on the budget line, so the money and the relationship cannot disagree.
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginTop: 16 }}>
        <Kick>Bid &amp; job history</Kick>
        {!h.rows.length ? (
          <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>Nothing yet — they have not been invited to a package.</div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 6 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 460, fontSize: 12.5 }}>
              <thead><tr>{["Package", "Date", "Bid", "Outcome"].map((x, i) => (
                <th key={x} style={{
                  textAlign: i === 2 ? "right" : "left", padding: "6px 10px", fontSize: 10, letterSpacing: ".08em",
                  textTransform: "uppercase", color: MUTED, borderBottom: "1px solid var(--line)",
                }}>{x}</th>
              ))}</tr></thead>
              <tbody>
                {h.rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "7px 10px" }}>{r.pkg}</td>
                    <td style={{ padding: "7px 10px", color: MUTED }}>{r.date || "—"}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {r.amount != null ? fmt(r.amount) : <span style={{ color: MUTED }}>not in yet</span>}
                    </td>
                    <td style={{ padding: "7px 10px" }}>
                      <Pill color={r.outcome === "Won" ? "#fff" : "var(--walnut)"} bg={r.outcome === "Won" ? "var(--sage)" : "var(--cream-2)"}>{r.outcome}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** One labelled field, editable in place unless read-only. */
function Field({ k, v, ro, placeholder, onCommit }: {
  k: string; v?: string; ro: boolean; placeholder?: string; onCommit: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
      <span style={{ color: MUTED, minWidth: 110 }}>{k}</span>
      {ro
        ? <span style={{ textAlign: "right" }}>{v || "—"}</span>
        : <input className="input" defaultValue={v ?? ""} placeholder={placeholder}
            onBlur={(e) => onCommit(e.target.value)}
            style={{ flex: 1, maxWidth: 230, fontSize: 12, textAlign: "right" }} />}
    </div>
  );
}


/** Removing a vendor. A company with bid history or an assigned contract is
 *  worth pausing over — deleting it does not delete the bids, it just detaches
 *  the name from them, so the confirm says exactly that instead of a generic
 *  "are you sure". */
function DeleteVendor({ c, history, onDone }: { c: ContactSheet; history: number; onDone: () => void }) {
  const store = useStore();
  const db = store.db;
  const [arm, setArm] = useState(false);

  const engaged = !!c.tradeId && (db.vendorAgreements ?? []).some((a) => a.tradeId === c.tradeId);
  const consequence = [
    history ? `${history} bid${history === 1 ? "" : "s"} on record` : "",
    engaged ? "a contract on this project" : "",
  ].filter(Boolean).join(" and ");

  if (!arm) {
    return (
      <button className="btn btn-sm" style={{ marginBottom: 10, marginLeft: 8, color: "var(--rust)" }}
        onClick={() => setArm(true)}>Remove from the roster</button>
    );
  }
  return (
    <div className="card" style={{ padding: 13, marginBottom: 12, borderLeft: "3px solid var(--rust)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12.5, lineHeight: 1.55, maxWidth: "68ch" }}>
        <strong>Remove {c.company} from the roster?</strong>{" "}
        {consequence
          ? `They have ${consequence}. Removing them does not delete any of that — the bids and the money stay exactly as they are, and the vendor's name stays on them. What goes is the roster record: their contact details, documents and notes, and they stop appearing for any bid package.`
          : "They have no bids and no contract on this project, so nothing else is affected."}
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        <button className="btn btn-sm" onClick={() => setArm(false)}>Keep them</button>
        <button className="btn btn-sm" style={{ background: "var(--rust)", color: "#fff", fontWeight: 700 }}
          onClick={() => { store.removeContactSheet(c.id); onDone(); }}>Remove {c.company}</button>
      </div>
    </div>
  );
}

function Kick({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: MUTED, ...style }}>{children}</div>;
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
      <span style={{ color: MUTED }}>{k}</span>
      <span style={{ textAlign: "right" }}>{v || "—"}</span>
    </div>
  );
}
