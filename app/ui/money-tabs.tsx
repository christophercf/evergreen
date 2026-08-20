"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/data/hooks";
import { accessFor, type FundingSource, type ModuleKey } from "@/lib/data/types";
import { totals, linePaid, fmt } from "@/lib/data/money";

// ---------------------------------------------------------------------------
// Money is one object seen at three moments. Committed (what we promised to
// spend) · Paid (what has actually left) · Funded (where it comes from).
//
// They stay three routes — the code behind them is large and works — but they
// present as one module, because no real question a user asks lives inside just
// one of them. "Can I pay the mason's invoice?" needs all three.
// ---------------------------------------------------------------------------

type Tab = { href: string; label: string; hint: string; mod: ModuleKey };

const TABS: Tab[] = [
  { href: "/costs", label: "Committed", hint: "What we have promised to spend", mod: "costs" },
  { href: "/payments", label: "Paid", hint: "What has actually left", mod: "payments" },
  { href: "/budget", label: "Funded", hint: "Where the money comes from", mod: "budget" },
];

/** Untapped capacity of a source. Money already drawn is gone — it cannot fund
 *  anything again — so it never counts towards what is still available. */
const remainOf = (f: FundingSource) => Math.max(0, f.amount - f.drawn);

export function MoneyTabs() {
  const store = useStore();
  const db = store.db;
  const pathname = usePathname();
  const role = store.session.role;
  const user = store.currentUser;

  const tabs = TABS.filter((t) => accessFor(user, role, t.mod) !== "none");
  if (tabs.length < 2) return null; // one tab is not a tab bar

  // The figure nobody could see in one place: committed − paid, and whether
  // there is funding left for the rest. The old coverage check compared funding
  // against the WHOLE project cost, which double-counts everything already paid.
  const committed = totals(db.costLines).grand;
  const paid = db.costLines.reduce((a, l) => a + linePaid(db, l), 0);
  const remaining = Math.max(0, committed - paid);
  const canSeeFunding = accessFor(user, role, "budget") !== "none";
  const available = (db.funding ?? []).reduce((a, f) => a + remainOf(f), 0);
  const shortfall = remaining - available;

  return (
    <div style={{ marginTop: 14, marginBottom: 4 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
        {tabs.map((t) => {
          const on = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              title={t.hint}
              style={{
                padding: "8px 14px", fontSize: 13.5, fontWeight: 700, textDecoration: "none",
                color: on ? "var(--walnut)" : "var(--muted)",
                borderBottom: `2px solid ${on ? "var(--sage)" : "transparent"}`,
                marginBottom: -1,
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* One line that reads the same on all three tabs. */}
      <div style={{
        display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline",
        padding: "9px 2px 0", fontSize: 12, color: "var(--muted)",
      }}>
        <Figure label="Committed" value={fmt(committed)} />
        <Figure label="Paid" value={fmt(paid)} />
        <Figure label="Remaining" value={fmt(remaining)} strong />
        {canSeeFunding && (
          <>
            <Figure label="Funding left" value={fmt(available)} />
            <span style={{
              fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 99,
              color: shortfall > 0 ? "var(--rust)" : "var(--ok)",
              border: `1px solid ${shortfall > 0 ? "var(--rust)" : "var(--ok)"}`,
            }}>
              {shortfall > 0 ? `⚠ ${fmt(shortfall)} short` : "✓ Covered"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
      <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".07em" }}>{label}</span>
      <strong style={{ fontSize: strong ? 14 : 13, color: strong ? "var(--walnut)" : "var(--ink)" }}>{value}</strong>
    </span>
  );
}
