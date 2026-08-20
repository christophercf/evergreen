"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { vendorTrades, vendorCovers, VENDOR_DOC_LABEL, type ContactSheet, type VendorDoc } from "@/lib/data/types";
import { fmt, tradeName } from "@/lib/data/money";
import { PageHeader, Pill, StatCard } from "../ui/bits";
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

  return (
    <>
      <button className="btn btn-sm" style={{ marginBottom: 10 }} onClick={onBack}>← Back to the roster</button>
      <PageHeader
        title={c.company}
        subtitle={vendorTrades(c).map((t) => tradeName(db, t)).join(" · ") || "No trades set — they will not appear for any bid package."}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 14 }}>
        <StatCard label="Rating" value={c.rating ? `${c.rating} / 5` : "New"} sub={c.jobsWithUs ? `${c.jobsWithUs} jobs with us` : "no jobs recorded"} />
        <StatCard label="Win rate" value={h.winRate === null ? "—" : `${h.winRate}%`} sub={`${h.won} won of ${h.rows.length} bid${h.rows.length === 1 ? "" : "s"}`} />
        <StatCard label="Payment terms" value={c.paymentTerms || "—"} sub={c.city || ""} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 18 }}>
        <div className="card" style={{ padding: 16 }}>
          <Kick>Contact</Kick>
          <Row k="Primary" v={c.contactName} />
          <Row k="Phone" v={c.phone} />
          <Row k="Email" v={c.email} />
          <Row k="Office" v={[c.address, c.city].filter(Boolean).join(", ")} />

          <Kick style={{ marginTop: 16 }}>Insurance &amp; licence on file</Kick>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, margin: "3px 0 6px" }}>
            Dates are stored as supplied. This roster records them; it does not judge them or block a bid.
          </div>
          {(["gl", "wc", "license"] as const).map((kind) => {
            const d = docs.find((x) => x.kind === kind);
            const lapsed = expired(d?.expires);
            return (
              <div key={kind} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
                <span>{VENDOR_DOC_LABEL[kind]}{d?.number ? ` · ${d.number}` : ""}</span>
                <span style={{ color: lapsed ? "var(--rust)" : d?.expires ? "var(--ink)" : MUTED, fontWeight: lapsed ? 700 : 400 }}>
                  {d?.expires ? `${lapsed ? "Lapsed " : "Expires "}${d.expires}` : "Not on file"}
                </span>
              </div>
            );
          })}
          {c.docRoute ? (
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 7 }}>
              {c.docRoute === "we_hold" ? "We hold the certificates." : "The vendor sends the certificates."}
            </div>
          ) : null}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <Kick>Who holds this relationship</Kick>
          <div style={{ fontSize: 12, lineHeight: 1.55, marginTop: 4 }}>
            {c.tradeId && db.trades.find((t) => t.id === c.tradeId)?.managedBy === "owner"
              ? "Owner-managed. The owner contracts and pays them direct, and the builder takes no fee on their work."
              : "Builder-managed. The GC carries the contract and the fee."}
          </div>
          <div style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.5, marginTop: 6 }}>
            They see their own contract, dates and materials. They never see another vendor&rsquo;s costs.
          </div>

          <Kick style={{ marginTop: 16 }}>Internal notes</Kick>
          <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 4 }}>Never shared with the vendor.</div>
          {ro ? (
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>{c.internalNote || <em style={{ color: MUTED }}>Nothing recorded.</em>}</div>
          ) : (
            <textarea className="input" defaultValue={c.internalNote ?? ""}
              placeholder="How they actually work out — never shared"
              onBlur={(e) => store.updateContactSheet(c.id, { internalNote: e.target.value })}
              style={{ width: "100%", minHeight: 78, fontSize: 12.5, lineHeight: 1.5 }} />
          )}
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
