"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { IS_MOCK } from "@/lib/data/config";
import { ROLE_LABEL, accessFor, type ModuleKey, type Role } from "@/lib/data/types";
import { Landing } from "./landing";
import { MessageModal } from "./messenger";
import {
  HomeIcon, CoinsIcon, WalletIcon, CalendarIcon, BoxIcon, UsersIcon, FolderIcon, LeafIcon, ChevronIcon, ReceiptIcon, ChatIcon, GearIcon, ClipboardIcon,
} from "./icons";

type NavItem = { href: string; label: string; mod: ModuleKey; Icon: (p: any) => React.ReactElement; phase2?: boolean };

// "Administrative" lives behind the header ⚙ gear now, not in the main nav.
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", mod: "dashboard", Icon: HomeIcon },
  { href: "/updates", label: "Messenger", mod: "updates", Icon: ChatIcon },
  // Bidding comes BEFORE the budget: scopes → competing bids → award → Project Budget.
  { href: "/bids", label: "Bid Management", mod: "bids", Icon: ClipboardIcon },
  { href: "/costs", label: "Project Budget", mod: "costs", Icon: CoinsIcon },
  { href: "/payments", label: "Payment & Draw Mgmt", mod: "payments", Icon: ReceiptIcon },
  { href: "/budget", label: "Owners Funding Mgmt", mod: "budget", Icon: WalletIcon },
  { href: "/timing", label: "Timing", mod: "timing", Icon: CalendarIcon },
  { href: "/materials", label: "Materials", mod: "materials", Icon: BoxIcon },
  { href: "/vendors", label: "Vendor Mgmt", mod: "vendors", Icon: UsersIcon },
  { href: "/artifacts", label: "Artifacts", mod: "artifacts", Icon: FolderIcon },
];

const ROLES: Role[] = ["full_admin", "owner", "builder", "trade", "viewer"];

// Generic QA personas — view a ROLE before anyone holds it.
const PERSONAS: { label: string; role: Role; tradeIds?: string[] }[] = [
  { label: "Owner", role: "owner" },
  { label: "Builder / GC", role: "builder" },
  { label: "Architect", role: "trade", tradeIds: ["architect"] },
  { label: "Trade (unassigned)", role: "trade" },
  { label: "Designer / Viewer", role: "viewer" },
];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const role = store.session.role;
  const user = store.currentUser;

  if (!store.session.authed) return <Landing />;

  const visible = NAV.filter((n) => accessFor(user, role, n.mod) !== "none");
  // Bottom tab bar (mobile): the four most-used tabs the role can see; the rest via ☰.
  const BOTTOM = ["/", "/updates", "/costs", "/materials"];
  const bottomNav = visible.filter((n) => BOTTOM.includes(n.href)).slice(0, 4);

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
              <div className="serif" style={{ fontSize: 18, fontWeight: 700, color: "#fdf8ee", lineHeight: 1 }}>Evergreen <span style={{ color: "var(--brass)" }}>AI</span></div>
              <div style={{ fontSize: 10, color: "#b7ab97", letterSpacing: ".03em", marginTop: 2 }}>AI-ASSISTED RENOVATION PM</div>
            </div>
          </div>
        </div>
        <nav style={{ padding: 10, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          {visible.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            // Vendors see their single contract, not a management console.
            const label = n.mod === "vendors" && role === "trade" ? "Current Contract" : n.label;
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
                <span style={{ flex: 1 }}>{label}</span>
                {n.phase2 && <span style={{ fontSize: 9, color: "#9a8e79", border: "1px solid #5a4d3c", borderRadius: 4, padding: "0 4px" }}>soon</span>}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", padding: 12, fontSize: 10.5, color: "#9a8e79", borderTop: "1px solid rgba(255,255,255,.08)" }}>
          {IS_MOCK ? "Mock mode · saved in this browser" : "Supabase · live"}
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
          <div style={{ flex: 1, fontSize: 13, color: "var(--muted)" }} className="ever-tagline">
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)" }}>Project</span> · <strong style={{ color: "var(--walnut)" }}>{store.db.project.name}</strong> <span style={{ color: "var(--muted)" }}>· {store.db.project.built}</span>
          </div>
          {role !== "viewer" && (
            <button className="btn btn-sm" disabled={!store.canUndo} onClick={() => store.undo()} title="Undo last change">↶<span className="m-hide-i"> Undo</span></button>
          )}
          <SettingsMenu />
          <PersonaSwitcher />
        </header>
        {/* QA impersonation banner — always visible while viewing as someone else */}
        {store.isViewingAs && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 22px", background: "#f0e6cd", borderBottom: "1px solid var(--line)", fontSize: 12.5, color: "var(--brass-2)", position: "sticky", top: 0, zIndex: 19 }}>
            <span>👁 <strong>Viewing as {store.session.displayName}</strong> ({ROLE_LABEL[role]}) — you see exactly what they see.</span>
            <button className="btn btn-sm" style={{ marginLeft: "auto", flexShrink: 0 }} onClick={() => store.endViewAs()}>← Back to Full Admin</button>
          </div>
        )}
        <main className="ever-main" style={{ padding: "22px 24px 64px", maxWidth: 1180, width: "100%", margin: "0 auto" }}>{children}</main>
      </div>

      {/* Contextual "message about this item" composer — opened from 💬 buttons anywhere. */}
      <MessageModal />

      {/* Bottom tab bar — thumb-reach nav on phones; ☰ opens the full drawer. */}
      <nav className="ever-bottomnav">
        {bottomNav.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={pathname === href ? "active" : undefined} onClick={() => setNavOpen(false)}>
            <Icon width={19} height={19} />
            {href === "/" ? "Home" : href === "/costs" ? "Budget" : label}
          </Link>
        ))}
        <button onClick={() => setNavOpen(true)} aria-label="All tabs">
          <span style={{ fontSize: 17, lineHeight: "19px" }}>☰</span>
          More
        </button>
      </nav>

      <style>{`
        @media (max-width: 860px) {
          .ever-sidebar { position: fixed !important; left: 0; top: 0; height: 100vh !important; z-index: 40; transform: translateX(-100%); transition: transform .2s; box-shadow: 0 0 0 200vmax rgba(0,0,0,0); }
          .ever-sidebar[style*="translateX(0)"] { transform: translateX(0) !important; box-shadow: 0 0 0 200vmax rgba(28,22,16,.45); }
          .ever-burger { display: inline-flex !important; }
          .ever-main { padding: 16px 14px 64px !important; }
        }
      `}</style>
    </div>
  );
}

// ⚙ Settings: personal preferences for everyone; project administration for
// roles that have it. Replaces the old "Administrative" sidebar entry.
function SettingsMenu() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const role = store.session.role;
  const user = store.currentUser;
  const canAdmin = accessFor(user, role, "admin") !== "none";
  return (
    <div style={{ position: "relative" }}>
      <button className="btn btn-sm" title="Settings" onClick={() => setOpen((v) => !v)} style={{ padding: "5px 8px" }}>
        <GearIcon width={16} height={16} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div className="card" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 31, width: 230, padding: 6 }}>
            <Link href="/settings" onClick={() => setOpen(false)} className="btn btn-sm" style={{ width: "100%", justifyContent: "flex-start", border: "none", background: "transparent" }}>
              👤 My Preferences
            </Link>
            {canAdmin && (
              <Link href="/admin" onClick={() => setOpen(false)} className="btn btn-sm" style={{ width: "100%", justifyContent: "flex-start", border: "none", background: "transparent" }}>
                🛠 Administrative
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PersonaSwitcher() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const current = store.session.role;
  const name = store.session.displayName;
  // The switcher keys off the REAL identity, so an admin mid-impersonation can
  // always jump to another persona or back — no logging out.
  const canViewAs = current === "full_admin" || store.isViewingAs;
  // Include invited/pending people too — QA often means previewing what someone
  // will see BEFORE they've accepted their invite.
  const people = store.db.users;
  const groups = ROLES.map((r) => ({ r, users: people.filter((u) => u.role === r) })).filter((g) => g.users.length);
  return (
    <div style={{ position: "relative" }}>
      <button className="btn" onClick={() => setOpen((v) => !v)} style={{ gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: store.isViewingAs ? "var(--brass)" : "var(--sage)" }} />
        <span style={{ textAlign: "left", lineHeight: 1.1 }}>
          <span style={{ display: "block", fontSize: 12.5 }}>{name}</span>
          <span style={{ display: "block", fontSize: 10.5, color: "var(--muted)" }}>{store.isViewingAs ? `viewing as ${ROLE_LABEL[current]}` : ROLE_LABEL[current]}</span>
        </span>
        <ChevronIcon width={14} height={14} style={{ transform: "rotate(90deg)" }} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setOpen(false)} />
          <div className="card" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 31, width: 262, padding: 8, maxHeight: "70vh", overflowY: "auto" }}>
            {canViewAs && <>
              {store.isViewingAs && (
                <button onClick={() => { store.endViewAs(); setOpen(false); }} className="btn btn-sm btn-primary" style={{ width: "100%", justifyContent: "flex-start", marginBottom: 6 }}>
                  ← Back to Full Admin
                </button>
              )}
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted)", textTransform: "uppercase", padding: "4px 8px" }}>View as persona (QA — no account needed)</div>
              {PERSONAS.map((p) => (
                <button key={p.label} onClick={() => { store.viewAsPersona(p.role, `Persona — ${p.label}`, p.tradeIds); setOpen(false); }} className="btn btn-sm"
                  style={{ width: "100%", justifyContent: "flex-start", border: "none", background: store.session.userId === `persona:${p.role}:${(p.tradeIds ?? []).join(",")}` ? "var(--sage-tint)" : "transparent", marginTop: 1 }}>
                  <span style={{ opacity: .7, marginRight: 6 }}>◇</span>{p.label}
                </button>
              ))}
              <div style={{ borderTop: "1px solid var(--line)", margin: "6px 0" }} />
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: "var(--muted)", textTransform: "uppercase", padding: "4px 8px" }}>View as person (QA)</div>
              {groups.map(({ r, users }) => (
                <div key={r}>
                  <div style={{ fontSize: 10, color: "var(--muted)", padding: "5px 8px 1px", fontWeight: 700 }}>{ROLE_LABEL[r]}</div>
                  {users.map((u) => (
                    <button key={u.id} onClick={() => { store.viewAsUser(u.id); setOpen(false); }} className="btn btn-sm"
                      style={{ width: "100%", justifyContent: "flex-start", border: "none", background: u.id === store.session.userId ? "var(--sage-tint)" : "transparent", marginTop: 1, gap: 6 }}>
                      {u.name}
                      {u.status && u.status !== "active" && <span style={{ fontSize: 9.5, color: "var(--brass-2)", border: "1px solid var(--brass)", borderRadius: 4, padding: "0 4px" }}>{u.status}</span>}
                    </button>
                  ))}
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0 6px" }} />
            </>}
            <button onClick={() => { store.logout(); setOpen(false); }} className="btn btn-sm" style={{ width: "100%", justifyContent: "flex-start", border: "none", background: "transparent", color: "var(--rust)" }}>
              ⎋ Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
