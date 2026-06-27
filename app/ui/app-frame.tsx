"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { IS_MOCK } from "@/lib/data/config";
import { ROLE_LABEL, accessFor, type ModuleKey, type Role } from "@/lib/data/types";
import { Landing } from "./landing";
import {
  HomeIcon, GridIcon, CoinsIcon, WalletIcon, CalendarIcon, BoxIcon, UsersIcon, FolderIcon, LeafIcon, ChevronIcon, ReceiptIcon,
} from "./icons";

type NavItem = { href: string; label: string; mod: ModuleKey; Icon: (p: any) => React.ReactElement; phase2?: boolean };

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", mod: "dashboard", Icon: HomeIcon },
  { href: "/admin", label: "Administrative", mod: "admin", Icon: GridIcon },
  { href: "/costs", label: "Building Costs", mod: "costs", Icon: CoinsIcon },
  { href: "/payments", label: "Payment Tracker", mod: "payments", Icon: ReceiptIcon },
  { href: "/budget", label: "Budget", mod: "budget", Icon: WalletIcon },
  { href: "/timing", label: "Timing", mod: "timing", Icon: CalendarIcon },
  { href: "/materials", label: "Materials", mod: "materials", Icon: BoxIcon },
  { href: "/vendors", label: "Vendor Mgmt", mod: "vendors", Icon: UsersIcon },
  { href: "/artifacts", label: "Artifacts", mod: "artifacts", Icon: FolderIcon, phase2: true },
];

const ROLES: Role[] = ["full_admin", "owner", "builder", "trade", "viewer"];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const role = store.session.role;
  const user = store.currentUser;

  if (!store.session.authed) return <Landing />;

  const visible = NAV.filter((n) => accessFor(user, role, n.mod) !== "none");

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 230, flexShrink: 0, background: "var(--walnut)", color: "#e9e1d2",
          display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh",
          transform: navOpen ? "translateX(0)" : undefined,
        }}
        className="ever-sidebar"
      >
        <div style={{ padding: "18px 18px 14px", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ color: "var(--brass)" }}><LeafIcon width={22} height={22} /></span>
            <div>
              <div className="serif" style={{ fontSize: 18, fontWeight: 700, color: "#fdf8ee", lineHeight: 1 }}>Evergreen</div>
              <div style={{ fontSize: 10.5, color: "#b7ab97", letterSpacing: ".04em", marginTop: 2 }}>31810 EVERGREEN RD · EST. 1822</div>
            </div>
          </div>
        </div>
        <nav style={{ padding: 10, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {visible.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setNavOpen(false)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8,
                  fontSize: 13.5, fontWeight: 600,
                  background: active ? "rgba(176,138,62,.22)" : "transparent",
                  color: active ? "#fdf8ee" : "#c9bca6",
                  borderLeft: active ? "3px solid var(--brass)" : "3px solid transparent",
                }}
              >
                <n.Icon width={17} height={17} />
                <span style={{ flex: 1 }}>{n.label}</span>
                {n.phase2 && <span style={{ fontSize: 9, color: "#9a8e79", border: "1px solid #5a4d3c", borderRadius: 4, padding: "0 4px" }}>soon</span>}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", padding: 12, fontSize: 10.5, color: "#9a8e79", borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <button className="btn btn-sm" style={{ width: "100%", background: "transparent", color: "#cabda7", borderColor: "#5a4d3c" }} onClick={() => store.reset()}>
            Reset demo data
          </button>
          <div style={{ marginTop: 8 }}>{IS_MOCK ? "Mock mode · saved in this browser" : "Supabase · live"}</div>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            display: "flex", alignItems: "center", gap: 12, padding: "11px 22px",
            background: "var(--paper)", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, zIndex: 20,
          }}
        >
          <button className="btn btn-sm ever-burger" onClick={() => setNavOpen((v) => !v)} style={{ display: "none" }}>☰</button>
          <div style={{ flex: 1, fontSize: 13, color: "var(--muted)" }}>
            Renovation management — replacing the working spreadsheets
          </div>
          <PersonaSwitcher current={role} onPick={(r) => store.setRole(r)} onLogout={() => store.logout()} canViewAs={role === "full_admin"} name={store.session.displayName} />
        </header>
        <main style={{ padding: "22px 24px 64px", maxWidth: 1180, width: "100%", margin: "0 auto" }}>{children}</main>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .ever-sidebar { position: fixed; z-index: 40; transform: translateX(-100%); transition: transform .2s; }
          .ever-sidebar[style*="translateX(0)"] { transform: translateX(0) !important; }
          .ever-burger { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}

function PersonaSwitcher({ current, onPick, onLogout, canViewAs, name }: { current: Role; onPick: (r: Role) => void; onLogout: () => void; canViewAs: boolean; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button className="btn" onClick={() => setOpen((v) => !v)} style={{ gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: "var(--sage)" }} />
        <span style={{ textAlign: "left", lineHeight: 1.1 }}>
          <span style={{ display: "block", fontSize: 12.5 }}>{name}</span>
          <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)" }}>{ROLE_LABEL[current]}</span>
        </span>
        <ChevronIcon width={14} height={14} style={{ transform: "rotate(90deg)" }} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div className="card" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 31, width: 230, padding: 8 }}>
            {canViewAs && <>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted)", textTransform: "uppercase", padding: "4px 8px" }}>View as (admin)</div>
              {ROLES.map((r) => (
                <button key={r} onClick={() => { onPick(r); setOpen(false); }} className="btn btn-sm"
                  style={{ width: "100%", justifyContent: "flex-start", border: "none", background: r === current ? "var(--sage-tint)" : "transparent", marginTop: 2 }}>
                  {ROLE_LABEL[r]}
                </button>
              ))}
              <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0 6px" }} />
            </>}
            <button onClick={() => { onLogout(); setOpen(false); }} className="btn btn-sm" style={{ width: "100%", justifyContent: "flex-start", border: "none", background: "transparent", color: "var(--rust)" }}>
              ⎋ Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
