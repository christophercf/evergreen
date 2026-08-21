"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/lib/data/hooks";
import { IS_MOCK } from "@/lib/data/config";
import { ROLE_LABEL, accessFor, type ModuleKey, type Role } from "@/lib/data/types";
import { Landing } from "./landing";
import { MessageModal } from "./messenger";
import { Toaster } from "./toast";
import {
  HomeIcon, CoinsIcon, WalletIcon, CalendarIcon, BoxIcon, UsersIcon, FolderIcon, LeafIcon, ChevronIcon, ReceiptIcon, ChatIcon, GearIcon, ClipboardIcon, HelpIcon,
} from "./icons";

type Band = "job" | "reference";
// `short` is the phone's bottom-bar label. A tab strip gives each item about
// eight characters before it truncates, so any item whose full name is longer
// carries a one-word version of the same name — never a different word.
type NavItem = { href: string; label: string; short?: string; mod: ModuleKey; band: Band; Icon: (p: any) => React.ReactElement; phase2?: boolean };

// Labels follow one rule: a VENDOR is a company, a PACKAGE is a scope of work on
// this house, a CONTRACT is a vendor awarded a package. "Trade" is only ever a
// category on a vendor — never a container, never a nav item. That confusion is
// what made people invent duplicate trades ("Windows — Diverse") to hold a
// second vendor.
//
// The bands sort by frequency of use, not by domain: the job you are doing,
// then the things you look up. "Administrative" stays behind the header ⚙.
const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", mod: "dashboard", band: "job", Icon: HomeIcon },
  // The money in the order it is settled: the owner agrees a figure, the work
  // is bid against it, the draws pay it out, and funding is where it comes
  // from. Budget Management leads because a package is bid inside a line that
  // has already been agreed.
  { href: "/costs", label: "Budget Management", short: "Budget", mod: "costs", band: "job", Icon: CoinsIcon },
  { href: "/bids", label: "Bid and Package Management", short: "Packages", mod: "bids", band: "job", Icon: ClipboardIcon },
  // Draws are the GC's to manage; funding is the owner's own money. Two
  // audiences, so two modules, each absent for the side it does not belong to.
  { href: "/payments", label: "Draw Management", short: "Draws", mod: "payments", band: "job", Icon: ReceiptIcon },
  // The contract sits under the draws because that is the order the money runs
  // in: a contract is signed, and then it is drawn against.
  { href: "/vendors", label: "Contracts", mod: "vendors", band: "job", Icon: UsersIcon },
  { href: "/budget", label: "Funding", short: "Funding", mod: "budget", band: "job", Icon: WalletIcon },
  { href: "/timing", label: "Schedule", mod: "timing", band: "job", Icon: CalendarIcon },
  { href: "/materials", label: "Materials", mod: "materials", band: "job", Icon: BoxIcon },
  { href: "/updates", label: "Messages", mod: "updates", band: "job", Icon: ChatIcon },
  { href: "/artifacts", label: "Artifacts", mod: "artifacts", band: "reference", Icon: FolderIcon },
  // Help is last on purpose and reaches every seat: the person who most needs
  // it is the one who cannot work out where they are, and filing a report is
  // how they say so.
  { href: "/help", label: "Help", mod: "help", band: "reference", Icon: HelpIcon },
];

const BAND_LABEL: Record<Band, string> = { job: "The job", reference: "Reference" };

/** How many things happened here while you were somewhere else. Green because
 *  it is news, not a warning — nothing in this app makes you look at it. */
function NavCount({ n }: { n: number }) {
  return (
    <span aria-label={`${n} new`} style={{
      background: "var(--sage)", color: "#fff", borderRadius: 99,
      fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: "0 5px", flexShrink: 0,
    }}>{n > 99 ? "99+" : n}</span>
  );
}

/** What each role opens on, and the order they meet things in. A role's first
 *  item should be what that role actually does most — permission decides what is
 *  reachable, this decides what comes first. Anything not listed keeps its
 *  default order behind these. */
const ROLE_ORDER: Partial<Record<Role, string[]>> = {
  // The owner opens the app to approve one thing, then look at money.
  owner: ["/", "/costs", "/bids", "/budget", "/materials", "/timing", "/updates"],
  // The builder runs the job from the money out: the agreed figure first, then
  // the packages bid against it.
  builder: ["/", "/costs", "/bids", "/payments", "/timing", "/materials", "/updates"],
  // A vendor's world is their own contract, their dates and their materials.
  trade: ["/vendors", "/timing", "/materials", "/updates"],
  // The designer works from the drawings and the programme, not materials.
  viewer: ["/artifacts", "/timing", "/updates"],
};

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

  // The mock build is the public demo, and its pages prerender to static HTML.
  // Gating on auth would bake the login screen into that HTML, leaving a
  // fetch-only reader (no JS) stuck at the door with every module behind it.
  // So mock renders the app straight away; the live Supabase build still gates.
  if (!IS_MOCK && !store.session.authed) return <Landing />;

  // Absent, never greyed out: a role should not see a control it cannot use.
  const permitted = NAV.filter((n) => accessFor(user, role, n.mod) !== "none");

  // What has happened since this user last looked, per module. Messages counts
  // unread messages the same way the conversation list counts them; everything
  // else counts notifications addressed to this user that they have not opened.
  // Read state is per user, so clearing my count never clears anyone else's.
  const unseen = store.unseenByModule();
  const badge = (mod: ModuleKey): number =>
    mod === "updates" ? store.unreadMessages() : (unseen[mod] ?? 0);
  // Role-shaped order — what this role does most comes first.
  const order = ROLE_ORDER[role];
  const rank = (n: NavItem) => {
    const i = order?.indexOf(n.href) ?? -1;
    return i === -1 ? 500 + NAV.indexOf(n) : i;
  };
  const visible = order ? [...permitted].sort((a, b) => rank(a) - rank(b)) : permitted;
  // If a role's order names an item, it IS their job — whatever its default
  // band. Otherwise a vendor's own contract sits under "Reference", which is the
  // one screen they actually came for.
  const bandOf = (n: NavItem): Band => (order?.includes(n.href) ? "job" : n.band);
  // Band headings only earn their space once there is enough nav to organise.
  const showBands = visible.length > 3;
  const bands: { band: Band; items: NavItem[] }[] = (["job", "reference"] as Band[])
    .map((band) => ({ band, items: visible.filter((n) => bandOf(n) === band) }))
    .filter((g) => g.items.length > 0);

  // Bottom tab bar (mobile): the first four this role can use, in their order.
  const bottomNav = visible.slice(0, 4);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Toaster />
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
          {bands.map(({ band, items }) => (
            <div key={band} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {showBands && (
                <div style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: ".13em", textTransform: "uppercase",
                  color: "#8f7f68", padding: "10px 11px 4px",
                }}>{BAND_LABEL[band]}</div>
              )}
              {items.map((n) => {
            const href = n.href;
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            // A vendor sees their own contract, not a management console.
            const label = n.mod === "vendors" && role === "trade" ? "Your contract" : n.label;
            const count = badge(n.mod);
            return (
              <Link
                key={n.href}
                href={href}
                onClick={() => { setNavOpen(false); store.markModuleSeen(n.mod); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 8,
                  fontSize: 13.5, fontWeight: 600,
                  background: active ? "rgba(176,138,62,.22)" : "transparent",
                  color: active ? "#fdf8ee" : "#c9bca6",
                  borderLeft: active ? "3px solid var(--brass)" : "3px solid transparent",
                }}
              >
                <n.Icon width={17} height={17} />
                <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
                {count > 0 && <NavCount n={count} />}
                {n.phase2 && <span style={{ fontSize: 9, color: "#9a8e79", border: "1px solid #5a4d3c", borderRadius: 4, padding: "0 4px" }}>soon</span>}
              </Link>
            );
              })}
            </div>
          ))}
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
        {bottomNav.map(({ href, label, short, mod, Icon }) => {
          const count = badge(mod);
          return (
            <Link key={href} href={href} className={pathname === href ? "active" : undefined}
              onClick={() => { setNavOpen(false); store.markModuleSeen(mod); }}
              aria-label={count ? `${label} — ${count} new` : label}
              style={{ position: "relative" }}>
              <Icon width={19} height={19} />
              {short ?? label}
              {count > 0 && (
                <span style={{
                  position: "absolute", top: 2, right: "50%", marginRight: -18,
                  background: "var(--sage)", color: "#fff", borderRadius: 99, fontSize: 9.5, fontWeight: 700,
                  minWidth: 15, height: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                }}>{count > 99 ? "99+" : count}</span>
              )}
            </Link>
          );
        })}
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
          /* Sides and top only. The bottom belongs to globals.css, which
             clears the fixed tab bar and the phone's safe area — a shorthand
             here would silently win and put controls under the bar. */
          .ever-main { padding-top: 16px !important; padding-left: 14px !important; padding-right: 14px !important; }
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
