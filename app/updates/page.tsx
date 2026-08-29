"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill } from "../ui/bits";
import { accessFor, canMessageUser, ROLE_LABEL, type MsgQuote, type SiteUpdate, type UpdateContext, type User } from "@/lib/data/types";
import { ContextChip, conversationKeyOf, conversationUrl, emailsFor, PhotoStrip, pushEmail, useDictation, usePhotoAttach } from "../ui/messenger";
import { useBackLayer } from "../ui/use-back-layer";
import { tradeName, materialDates, macroOrder } from "@/lib/data/money";

// ---------------------------------------------------------------------------
// Messenger — WhatsApp-style: a conversation list (per participant set, with
// search + trade/person filters) and a bubble chat view with the composer
// pinned to the bottom. Built on the same SiteUpdate data: updates and their
// replies flatten into one chronological thread per conversation.
// ---------------------------------------------------------------------------

const READ_KEY = "evergreen.msgr.read.v1";
const loadRead = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(READ_KEY) ?? "{}"); } catch { return {}; }
};

const timeShort = (s: string) => {
  const d = new Date(s);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const days = (today.getTime() - d.getTime()) / 86400000;
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
};
const timeBubble = (s: string) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayLabel = (s: string) => {
  const d = new Date(s);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// Deterministic avatar color per user.
const AVA_COLORS = ["#6b7f5b", "#b08a3e", "#4a7a8c", "#8a5a44", "#5b6b7f", "#7f5b6b"];
const avaColor = (id: string) => AVA_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA_COLORS.length];
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function Avatar({ u, size = 38 }: { u?: User; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 99, flexShrink: 0, background: u ? avaColor(u.id) : "var(--line)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.36, fontWeight: 700 }}>
      {u ? initials(u.name) : "?"}
    </span>
  );
}

// One flattened chat message (an update, or one of its replies).
type Msg = { id: string; authorId: string; authorName: string; at: string; body?: string; title?: string; photos?: string[]; context?: UpdateContext; quote?: MsgQuote; reactions?: Record<string, string> };

// WhatsApp's default reaction set.
const REACT_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
type Conv = { key: string; otherIds: string[]; items: SiteUpdate[]; msgs: Msg[]; lastAt: string; preview: string };

const convKeyOf = (ids: string[]) => [...new Set(ids)].sort().join("+");

// A chat send whose title was auto-derived from the body shouldn't repeat it.
const derivedTitle = (body: string) => (body.trim().split("\n")[0] ?? "").slice(0, 60) || "📷 Photo";
const showTitle = (m: Msg) => !!m.title && !(m.body ?? "").trim().startsWith(m.title.trim());

export default function UpdatesPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const meId = store.session.userId;
  const access = accessFor(user, role, "updates");
  const isAdmin = role === "full_admin";

  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tradeF, setTradeF] = useState("all");
  const [personF, setPersonF] = useState("all");
  const [sortAZ, setSortAZ] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showDigest, setShowDigest] = useState(false);
  const [newTo, setNewTo] = useState<Set<string>>(new Set());
  const [newSubject, setNewSubject] = useState("");
  const [groupMode, setGroupMode] = useState(false);
  const [pq, setPq] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [pendingOthers, setPendingOthers] = useState<string[] | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [readMap, setReadMap] = useState<Record<string, string>>({});
  useEffect(() => setReadMap(loadRead()), []);

  // On a phone an open conversation owns the whole screen, and a tapped photo
  // owns it again on top — so the phone's back button peels them off in order
  // (photo → chat → list) instead of jumping out of Messages entirely.
  useBackLayer(!!sel, () => { setSel(null); setPendingOthers(null); });
  useBackLayer(!!lightbox, () => setLightbox(null));

  // Deep link from email "Reply in the app" buttons: /updates?conv=<key>
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("conv");
    if (!key) return;
    setPendingOthers(key.split("+").filter((id) => id !== store.session.userId));
    setSel(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOf = (id: string) => db.users.find((x) => x.id === id)?.name ?? "—";
  const userOf = (id: string) => db.users.find((x) => x.id === id);

  // ---- conversations from the update log ----
  const convs = useMemo<Conv[]>(() => {
    const visible = db.updates.filter((u) => isAdmin || u.authorId === meId || u.toUserIds.includes(meId));
    const map = new Map<string, SiteUpdate[]>();
    for (const u of visible) {
      const key = convKeyOf([u.authorId, ...u.toUserIds]);
      map.set(key, [...(map.get(key) ?? []), u]);
    }
    const out: Conv[] = [];
    for (const [key, items] of map) {
      const participantIds = key.split("+");
      const otherIds = participantIds.filter((id) => id !== meId);
      const msgs: Msg[] = items.flatMap((u) => [
        { id: u.id, authorId: u.authorId, authorName: u.authorName, at: u.at, body: u.body, title: u.title, photos: u.photos, context: u.context, quote: u.quote, reactions: u.reactions },
        ...u.replies.map((r) => ({ id: r.id, authorId: r.authorId, authorName: r.authorName, at: r.at, body: r.body, quote: r.quote, reactions: r.reactions })),
      ]).sort((a, b) => a.at.localeCompare(b.at));
      const last = msgs[msgs.length - 1];
      out.push({
        key, otherIds: otherIds.length ? otherIds : participantIds, items, msgs,
        lastAt: last?.at ?? "",
        preview: last ? `${last.authorId === meId ? "You: " : ""}${(last.body || last.title || "").slice(0, 64)}${last.photos?.length ? " 📷" : ""}` : "",
      });
    }
    return out;
  }, [db.updates, meId, isAdmin]);

  // The selected conversation — possibly a brand-new (empty) one.
  const selConv: Conv | null = useMemo(() => {
    if (!sel) return null;
    const found = convs.find((c) => c.key === sel);
    if (found) return found;
    if (pendingOthers) return { key: sel, otherIds: pendingOthers, items: [], msgs: [], lastAt: "", preview: "" };
    return null;
  }, [sel, convs, pendingOthers]);

  // read tracking
  const unreadOf = (c: Conv) => c.msgs.filter((m) => m.authorId !== meId && m.at > (readMap[c.key] ?? "")).length;
  useEffect(() => {
    if (!selConv || !selConv.lastAt) return;
    if ((readMap[selConv.key] ?? "") < selConv.lastAt) {
      const next = { ...readMap, [selConv.key]: selConv.lastAt };
      setReadMap(next);
      try { localStorage.setItem(READ_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selConv?.key, selConv?.lastAt]);

  if (access === "none") return <NoAccess module="Messages" />;

  // ---- filters ----
  const tradesUsed = db.trades.filter((t) => db.users.some((u) => u.tradeIds?.includes(t.id)));
  const people = db.users.filter((u) => u.id !== meId);
  const metaOf = (key: string) => db.convMeta?.find((m) => m.key === key);
  const isPinned = (c: Conv) => !!metaOf(c.key)?.pinnedBy?.includes(meId);
  const isArchived = (c: Conv) => !!metaOf(c.key)?.archivedBy?.includes(meId);

  const matching = convs.filter((c) => {
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      // WhatsApp searches what was said, not just who said it.
      const subject = metaOf(c.key)?.subject ?? "";
      const hit = c.otherIds.some((id) => nameOf(id).toLowerCase().includes(needle))
        || subject.toLowerCase().includes(needle)
        || c.msgs.some((mm) => (mm.body ?? "").toLowerCase().includes(needle));
      if (!hit) return false;
    }
    if (personF !== "all" && !c.otherIds.includes(personF)) return false;
    if (tradeF !== "all" && !c.otherIds.some((id) => userOf(id)?.tradeIds?.includes(tradeF))) return false;
    return true;
  });
  const archivedConvs = matching.filter(isArchived).sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const filtered = matching
    .filter((c) => !isArchived(c))
    .sort((a, b) => {
      // Pinned float, like WhatsApp; inside each band the chosen sort applies.
      const pin = Number(isPinned(b)) - Number(isPinned(a));
      if (pin) return pin;
      return sortAZ
        ? (metaOf(a.key)?.subject ?? nameOf(a.otherIds[0] ?? "")).localeCompare(metaOf(b.key)?.subject ?? nameOf(b.otherIds[0] ?? ""))
        : b.lastAt.localeCompare(a.lastAt);
    });

  const allowed = db.users.filter((u) => canMessageUser(user, role, u, db.trades));

  // Which Budget Management category a conversation nests under: the category of
  // its trade participants' trade; conversations with only owners/builders/
  // designers land in "Project Team".
  const convCategory = (c: Conv): string => {
    for (const id of c.otherIds) {
      const u = userOf(id);
      const t = u?.tradeIds?.[0] ? db.trades.find((x) => x.id === u.tradeIds![0]) : undefined;
      if (t) return t.category;
    }
    return "Project Team";
  };

  const renderConv = (c: Conv) => {
    const others = c.otherIds.map(userOf);
    const unread = unreadOf(c);
    const active = sel === c.key;
    return (
      <button key={c.key} onClick={() => { setPendingOthers(null); setSel(c.key); }}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", border: "none", borderBottom: "1px solid var(--line)", background: active ? "var(--sage-tint)" : "transparent", cursor: "pointer", textAlign: "left" }}>
        <Avatar u={others[0]} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--walnut)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isPinned(c) ? "📌 " : ""}{metaOf(c.key)?.subject ?? c.otherIds.map(nameOf).join(", ")}</span>
            <span style={{ fontSize: 10.5, color: unread ? "var(--sage-2)" : "var(--muted)", flexShrink: 0, fontWeight: unread ? 700 : 400 }}>{c.lastAt ? timeShort(c.lastAt) : ""}</span>
          </span>
          <span style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.preview}</span>
            {unread > 0 && <span style={{ background: "var(--sage)", color: "#fff", borderRadius: 99, fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0 }}>{unread}</span>}
          </span>
        </span>
      </button>
    );
  };

  const openConv = (ids: string[], subject?: string) => {
    if (!ids.length) return;
    const key = convKeyOf([meId, ...ids]);
    // "New group" with the same people as an existing thread lands in that
    // thread — its subject is shared history and must not be silently renamed.
    const existing = db.convMeta?.find((m) => m.key === key)?.subject;
    if (subject?.trim() && !existing) store.setConversationSubject(key, subject);
    setPendingOthers(ids);
    setSel(key);
    setShowNew(false); setGroupMode(false); setNewTo(new Set()); setNewSubject(""); setPq("");
  };

  return (
    <>
      <PageHeader title="Messages" subtitle="Chat with the people on your project — photos, voice-to-text, and messages linked to materials, costs, tasks & documents." />

      <div className="msgr card" data-pane={sel ? "chat" : "list"} style={{ marginTop: 14, padding: 0, display: "grid", gridTemplateColumns: "330px 1fr", overflow: "hidden", height: "calc(100dvh - 235px)", minHeight: 420 }}>
        {/* ---------------- list pane ---------------- */}
        <div data-role="list" style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search people…" style={{ flex: 1, fontSize: 12.5, padding: "6px 9px", borderRadius: 99 }} />
              {(role === "builder" || role === "full_admin") && (
                <button className="btn btn-sm" title="Create a progress update (ad-hoc / weekly / monthly digest)" onClick={() => { setShowDigest((v) => !v); setShowNew(false); setSel(null); }}
                  style={showDigest ? { background: "var(--brass)", color: "#fff", borderColor: "var(--brass)" } : undefined}>📋</button>
              )}
              <button className="btn btn-sm btn-primary" title="New conversation" onClick={() => { setShowNew((v) => !v); setShowDigest(false); setSel(null); }}>＋ New</button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <select value={tradeF} onChange={(e) => { setTradeF(e.target.value); setPersonF("all"); }} style={{ flex: 1, fontSize: 11.5, minWidth: 0 }}>
                <option value="all">All trades</option>
                {tradesUsed.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={personF} onChange={(e) => { setPersonF(e.target.value); setTradeF("all"); }} style={{ flex: 1, fontSize: 11.5, minWidth: 0 }}>
                <option value="all">All people</option>
                {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button className="btn btn-sm" title={sortAZ ? "Sorted A–Z — switch to recent" : "Sorted by recent — switch to A–Z"} onClick={() => setSortAZ((v) => !v)}>{sortAZ ? "AZ" : "🕑"}</button>
              <button className="btn btn-sm" title={grouped ? "Grouped by cost category — switch to flat list" : "Flat list — group by Budget Management category"} onClick={() => setGrouped((v) => !v)}
                style={grouped ? { background: "var(--sage)", color: "#fff", borderColor: "var(--sage)" } : undefined}>🗂</button>
            </div>
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {showDigest ? (
              <DigestBuilder allowed={allowed} onDone={() => setShowDigest(false)} />
            ) : showNew ? (
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>
                    {groupMode ? "New group" : "New chat"}
                  </div>
                  <button className="btn btn-sm" onClick={() => { setGroupMode((v) => !v); setNewTo(new Set()); }}>
                    {groupMode ? "← Single chat" : "👥 New group"}
                  </button>
                </div>
                <input className="input" autoFocus value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Search people…" style={{ fontSize: 12.5 }} />
                {groupMode && (
                  <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Group subject</span>
                    <input className="input" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="e.g. Kitchen cabinets" style={{ fontSize: 12.5 }} />
                  </label>
                )}
                {allowed.filter((u) => !pq.trim() || u.name.toLowerCase().includes(pq.trim().toLowerCase())).map((u) => {
                  const on = newTo.has(u.id);
                  return (
                    <button key={u.id}
                      onClick={() => {
                        // WhatsApp's reflex: tap a person and you are in the chat.
                        if (!groupMode) { openConv([u.id]); return; }
                        setNewTo((sset) => { const n = new Set(sset); on ? n.delete(u.id) : n.add(u.id); return n; });
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 10, border: on ? "2px solid var(--sage)" : "1px solid var(--line)", background: on ? "var(--sage-tint)" : "var(--paper)", cursor: "pointer", textAlign: "left" }}>
                      <Avatar u={u} size={34} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{u.name}</span>
                        <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{u.role === "trade" && u.tradeIds?.length ? tradeName(db, u.tradeIds[0]) : ROLE_LABEL[u.role]}</span>
                      </span>
                      {groupMode && on && <span style={{ color: "var(--sage-2)", fontWeight: 700 }}>✓</span>}
                    </button>
                  );
                })}
                {!allowed.length && <div style={{ fontSize: 12, color: "var(--muted)" }}>No one available for your role yet.</div>}
                <div style={{ display: "flex", gap: 6 }}>
                  {groupMode && (
                    <button className="btn btn-primary btn-sm" disabled={newTo.size < 2} onClick={() => openConv([...newTo], newSubject)}>
                      Create group{newTo.size ? ` (${newTo.size})` : ""}
                    </button>
                  )}
                  <button className="btn btn-sm" onClick={() => { setShowNew(false); setGroupMode(false); setNewTo(new Set()); setPq(""); }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {grouped
                  ? [...macroOrder(db), "Project Team"].map((cat) => {
                      const inCat = filtered.filter((c) => convCategory(c) === cat);
                      if (!inCat.length) return null;
                      return (
                        <div key={cat}>
                          <div style={{ padding: "7px 12px 3px", fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--brass-2)", background: "var(--cream)", borderBottom: "1px solid var(--line)" }}>{cat}</div>
                          {inCat.map(renderConv)}
                        </div>
                      );
                    })
                  : filtered.map(renderConv)}
                {archivedConvs.length > 0 && (
                  <>
                    <button onClick={() => setShowArchived((v) => !v)}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 12px", border: "none", borderBottom: "1px solid var(--line)", background: "var(--cream)", cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                      🗂 Archived ({archivedConvs.length})
                      {/* An archived chat can still receive a message — the badge is
                          how it stays findable, same as WhatsApp's Archived row. */}
                      {archivedConvs.reduce((a, c) => a + unreadOf(c), 0) > 0 && (
                        <span style={{ background: "var(--sage)", color: "#fff", borderRadius: 99, fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                          {archivedConvs.reduce((a, c) => a + unreadOf(c), 0)}
                        </span>
                      )}
                      <span style={{ marginLeft: "auto" }}>{showArchived ? "▾" : "▸"}</span>
                    </button>
                    {showArchived && archivedConvs.map(renderConv)}
                  </>
                )}
                {!filtered.length && !archivedConvs.length && <div style={{ padding: 20, textAlign: "center", fontSize: 12.5, color: "var(--muted)" }}>No conversations{q || tradeF !== "all" || personF !== "all" ? " match the filter" : " yet — start one with ＋ New"}.</div>}
              </>
            )}
          </div>
        </div>

        {/* ---------------- chat pane ---------------- */}
        <div data-role="chat" style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "var(--cream)" }}>
          {selConv ? (
            <ChatPane key={selConv.key} conv={selConv} meId={meId} onBack={() => { setSel(null); setPendingOthers(null); }} onPhoto={setLightbox} />
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "var(--muted)" }}>
              <span style={{ fontSize: 40 }}>💬</span>
              <span style={{ fontSize: 13 }}>Pick a conversation, or start a new one.</span>
            </div>
          )}
        </div>
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(28,22,16,.85)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 18, cursor: "zoom-out" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" style={{ maxWidth: "96%", maxHeight: "92%", borderRadius: 10, boxShadow: "0 12px 60px rgba(0,0,0,.5)" }} />
        </div>
      )}

      <style>{`
        @media (max-width: 860px) {
          .msgr { display: block !important; height: calc(100dvh - 250px) !important; min-height: 0 !important; }
          .msgr [data-role="list"], .msgr [data-role="chat"] { height: 100%; border-right: none !important; }
          .msgr[data-pane="chat"] [data-role="list"] { display: none !important; }
          .msgr[data-pane="list"] [data-role="chat"] { display: none !important; }

          /* An open conversation owns the screen: no page header above it, no
             tab bar below it, and no arithmetic against either. 100dvh follows
             the keyboard, so the composer stays visible while typing. */
          .msgr[data-pane="chat"] {
            position: fixed !important; inset: 0 !important; z-index: 45 !important;
            height: 100dvh !important; margin: 0 !important; border-radius: 0 !important;
            padding-bottom: env(safe-area-inset-bottom) !important;
          }
          body:has(.msgr[data-pane="chat"]) .ever-bottomnav { display: none !important; }
        }
        @media (min-width: 861px) {
          .msgr-back { display: none !important; }
        }
      `}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Builder progress updates: ad-hoc / weekly / monthly. Rolls up everything
// that happened in the period (timing changes, QC sign-offs, approved change
// orders, draws) + the materials needed over the next few weeks, then lets the
// builder add context and send it as a Messenger update + email.
function DigestBuilder({ allowed, onDone }: { allowed: User[]; onDone: () => void }) {
  const store = useStore();
  const db = store.db;
  const meId = store.session.userId;
  const name = store.session.displayName;
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };

  const [period, setPeriod] = useState<"weekly" | "monthly" | "adhoc">("weekly");
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(iso(today));
  const [context, setContext] = useState("");
  const [body, setBody] = useState<string | null>(null); // null = not generated yet
  const [recips, setRecips] = useState<Set<string>>(new Set(allowed.filter((u) => u.role === "owner").map((u) => u.id)));
  const [sent, setSent] = useState(false);

  const range: [string, string] = period === "weekly" ? [daysAgo(7), iso(today)] : period === "monthly" ? [daysAgo(30), iso(today)] : [from, to];
  const inRange = (d?: string) => !!d && d.slice(0, 10) >= range[0] && d.slice(0, 10) <= range[1];
  const fmtR = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const generate = () => {
    const lines: string[] = [];

    // Timing changes published in the period
    const revs = db.scheduleRevisions.filter((r) => inRange(r.at));
    if (revs.length) {
      lines.push("📅 SCHEDULE");
      for (const r of revs) for (const c of r.changes) lines.push(`• ${c.label}: ${fmtR(c.fromStart)}–${fmtR(c.fromEnd)} → ${fmtR(c.toStart)}–${fmtR(c.toEnd)} (${r.reason})`);
      lines.push("");
    }
    // Tasks finished in the period aren't timestamped — completed status shown live
    const done = db.schedule.filter((s) => s.status === "done");
    if (done.length) { lines.push(`✅ COMPLETE TO DATE: ${done.map((s) => s.label).join(", ")}`); lines.push(""); }

    // QC sign-offs in the period
    let qcCount = 0;
    const qcByTrade = new Map<string, number>();
    for (const cell of db.scope) for (const it of cell.items) {
      if (inRange(it.ownerSignedAt) || inRange(it.builderSignedAt)) { qcCount++; qcByTrade.set(cell.tradeId, (qcByTrade.get(cell.tradeId) ?? 0) + 1); }
    }
    if (qcCount) {
      lines.push(`🔍 QC SIGN-OFFS: ${qcCount} item${qcCount === 1 ? "" : "s"} — ${[...qcByTrade].map(([t, n]) => `${tradeName(db, t)} (${n})`).join(", ")}`);
      lines.push("");
    }

    // Change orders approved in the period
    const cos = db.costLines.flatMap((l) => (l.changeOrders ?? []).filter((c) => c.status === "approved" && inRange(c.date)).map((c) => ({ l, c })));
    if (cos.length) {
      lines.push("🧾 CHANGE ORDERS APPROVED");
      for (const { l, c } of cos) lines.push(`• ${l.name} — ${c.title} (${c.exhibit})`);
      lines.push("");
    }

    // Draws paid / pushed in the period
    const draws = db.draws.filter((d) => inRange(d.paidDate) || inRange(d.pushedDate));
    if (draws.length) {
      lines.push("💵 DRAWS");
      for (const d of draws) lines.push(`• ${d.name} — ${inRange(d.paidDate) ? "paid" : "issued"}`);
      lines.push("");
    }

    // Upcoming materials (next 3 weeks) — always prompted for inclusion
    const horizon = new Date(today); horizon.setDate(horizon.getDate() + 21);
    const upcoming = db.materials
      .filter((m) => m.status === "needed" || m.status === "identified")
      .map((m) => { const d = materialDates(db, m); return { m, due: d.onHandBy ?? d.identifyBy }; })
      .filter((x) => x.due && x.due <= iso(horizon))
      .sort((a, b) => a.due!.localeCompare(b.due!));
    if (upcoming.length) {
      lines.push("📦 MATERIALS NEEDED — NEXT 3 WEEKS");
      for (const { m, due } of upcoming.slice(0, 15)) lines.push(`• ${m.item}${m.roomLabel ? ` (${m.roomLabel})` : ""} — on hand by ${fmtR(due!)}`);
      if (upcoming.length > 15) lines.push(`…and ${upcoming.length - 15} more in Materials`);
      lines.push("");
    }

    if (!lines.length) lines.push("(No logged activity in this period — add your update below.)");
    setBody(lines.join("\n").trim());
  };

  const title = `${period === "weekly" ? "Weekly" : period === "monthly" ? "Monthly" : "Progress"} Update — ${fmtR(range[0])}–${fmtR(range[1])}`;
  const send = () => {
    const toIds = [...recips];
    const full = `${context.trim() ? `${context.trim()}\n\n` : ""}${body ?? ""}`;
    store.postUpdate({ title, body: full, toUserIds: toIds });
    pushEmail(emailsFor(db.users, toIds), `🏗 ${db.project.name} — ${title}`, full,
      { replyUrl: conversationUrl([meId, ...toIds]), convKey: conversationKeyOf([meId, ...toIds]), senderName: name });
    setSent(true);
    setTimeout(onDone, 1400);
  };

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>📋 Create progress update</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["weekly", "monthly", "adhoc"] as const).map((p) => (
          <button key={p} className="btn btn-sm" onClick={() => { setPeriod(p); setBody(null); }}
            style={period === p ? { background: "var(--sage)", color: "#fff", borderColor: "var(--sage)" } : undefined}>
            {p === "weekly" ? "Weekly (7d)" : p === "monthly" ? "Monthly (30d)" : "Ad-hoc"}
          </button>
        ))}
      </div>
      {period === "adhoc" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setBody(null); }} /> →
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setBody(null); }} />
        </div>
      )}
      {body === null ? (
        <button className="btn btn-primary btn-sm" onClick={generate}>⚙ Roll up {fmtR(range[0])}–{fmtR(range[1])}</button>
      ) : (
        <>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>Your context (goes on top)
            <textarea value={context} onChange={(e) => setContext(e.target.value)} placeholder="How the week went, decisions needed, heads-ups…" style={{ minHeight: 56, fontSize: 12.5 }} />
          </label>
          <label style={{ fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3 }}>Auto-rolled-up progress (editable)
            <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 170, fontSize: 12, fontFamily: "inherit" }} />
          </label>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>Send to</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {allowed.map((u) => {
                const on = recips.has(u.id);
                return (
                  <button key={u.id} className="btn btn-sm" onClick={() => setRecips((s) => { const n = new Set(s); on ? n.delete(u.id) : n.add(u.id); return n; })}
                    style={{ background: on ? "var(--sage)" : undefined, color: on ? "#fff" : undefined, borderColor: on ? "var(--sage)" : undefined }}>
                    {on ? "✓ " : ""}{u.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary btn-sm" disabled={!recips.size || sent} onClick={send}>{sent ? "✓ Sent" : "Send update"}</button>
            <button className="btn btn-sm" onClick={onDone}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function ChatPane({ conv, meId, onBack, onPhoto }: { conv: Conv; meId: string; onBack: () => void; onPhoto: (p: string) => void }) {
  const store = useStore();
  const db = store.db;
  const name = store.session.displayName;
  const [body, setBody] = useState("");
  const att = usePhotoAttach();
  const endRef = useRef<HTMLDivElement>(null);
  const mic = useDictation((t) => setBody((b) => (b ? `${b} ${t}` : t)));
  const userOf = (id: string) => db.users.find((x) => x.id === id);
  const others = conv.otherIds.map(userOf);
  const group = conv.otherIds.length > 1;
  const meta = db.convMeta?.find((m) => m.key === conv.key);
  const subject = meta?.subject;
  const pinned = !!meta?.pinnedBy?.includes(meId);
  const archived = !!meta?.archivedBy?.includes(meId);
  const [editingSubject, setEditingSubject] = useState(false);
  const [quoting, setQuoting] = useState<MsgQuote | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [reactFor, setReactFor] = useState<string | null>(null);

  // Opening (or catching up on) a chat marks it read — the other side's ✓✓
  // turns. Quiet write, skipped when nothing is new.
  useEffect(() => {
    if (conv.lastAt) store.markConversationRead(conv.key, conv.lastAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.key, conv.lastAt]);
  // A message is "read" once every other participant has read past it.
  const readByAll = (at: string) => conv.otherIds.every((id) => (meta?.reads?.[id] ?? "") >= at);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [conv.msgs.length]);

  const send = () => {
    const text = body.trim();
    const photos = att.photos;
    if ((!text && !photos.length) || att.uploading > 0) return;
    mic.stop();
    const latest = conv.items[0] ? conv.items.reduce((a, b) => (a.at > b.at ? a : b)) : null;
    if (photos.length || !latest) {
      // photos (or a brand-new thread) need a full update
      store.postUpdate({ title: derivedTitle(text || "📷 Photo"), body: text, photos, toUserIds: conv.otherIds, quote: quoting ?? undefined });
    } else {
      store.replyToUpdate(latest.id, text, quoting ?? undefined);
    }
    const emails = emailsFor(db.users, conv.otherIds);
    pushEmail(emails, `💬 ${db.project.name} — ${subject ?? `message from ${name}`}`, text || "(photo)",
      { replyUrl: conversationUrl([store.session.userId, ...conv.otherIds]), convKey: conversationKeyOf([store.session.userId, ...conv.otherIds]), senderName: name, photoCount: photos.length || undefined });
    setBody(""); att.clear(); setQuoting(null);
  };

  let lastDay = "";
  return (
    <>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--paper)" }}>
        <button className="btn btn-sm msgr-back" onClick={onBack}>←</button>
        <Avatar u={others[0]} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {editingSubject ? (
            <input className="input" autoFocus defaultValue={subject ?? ""}
              placeholder="Subject — e.g. Kitchen cabinets"
              onBlur={(e) => { store.setConversationSubject(conv.key, e.target.value); setEditingSubject(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingSubject(false); }}
              style={{ fontSize: 13, fontWeight: 700, width: "100%", maxWidth: 340 }} />
          ) : (
            <div onClick={() => setEditingSubject(true)} title="Set the subject" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--walnut)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>
              {subject ?? conv.otherIds.map((id) => userOf(id)?.name ?? "—").join(", ")}
              <span style={{ fontSize: 10.5, color: "var(--muted)", marginLeft: 6, fontWeight: 400 }}>✎</span>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {subject
              ? conv.otherIds.map((id) => userOf(id)?.name ?? "—").join(", ")
              : others.map((u) => u ? (u.role === "trade" && u.tradeIds?.length ? tradeName(db, u.tradeIds[0]) : ROLE_LABEL[u.role]) : "—").join(" · ")}
          </div>
        </div>
        <button className="btn btn-sm" title={pinned ? "Unpin" : "Pin to top"}
          onClick={() => store.togglePinConversation(conv.key)}
          style={pinned ? { background: "var(--sage-tint)" } : { opacity: 0.65 }}>📌</button>
        <button className="btn btn-sm" title={archived ? "Restore from archive" : "Archive"}
          onClick={() => { store.toggleArchiveConversation(conv.key); if (!archived) onBack(); }}
          style={{ opacity: archived ? 1 : 0.65 }}>🗂</button>
      </div>

      {/* messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 6px", display: "flex", flexDirection: "column", gap: 6 }}>
        {conv.msgs.length === 0 && <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--muted)", marginTop: 20 }}>Say hello 👋 — messages are tracked here and emailed to recipients.</div>}
        {conv.msgs.map((m) => {
          const mine = m.authorId === meId;
          const day = dayLabel(m.at);
          const divider = day !== lastDay; lastDay = day;
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column" }}>
              {divider && <div style={{ alignSelf: "center", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 99, padding: "2px 10px", margin: "8px 0" }}>{day}</div>}
              {/* Hover is the desktop grammar; long-press is the phone's. Both
                  open the same row, so nothing is discoverable on one device
                  and invisible on the other. */}
              <div onMouseEnter={() => setHoverId(m.id)} onMouseLeave={() => { setHoverId(null); setReactFor(null); }}
                onClick={() => setHoverId((h) => (h === m.id ? null : m.id))}
                onContextMenu={(e) => { e.preventDefault(); setHoverId(m.id); }}
                style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%", display: "flex", alignItems: "flex-end", gap: 5, flexDirection: mine ? "row-reverse" : "row" }}>
              <div style={{ minWidth: 0, background: mine ? "#dde8d2" : "var(--paper)", border: "1px solid var(--line)", borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px", padding: "7px 10px", boxShadow: "0 1px 1px rgba(44,36,28,.06)" }}>
                {/* Name the author in groups — and in a 1:1 whenever a third
                    voice (a full admin) speaks, so their words are never
                    mistaken for the other person's. */}
                {!mine && (group || !conv.otherIds.includes(m.authorId)) && <div style={{ fontSize: 10.5, fontWeight: 700, color: avaColor(m.authorId), marginBottom: 2 }}>{m.authorName}</div>}
                {m.quote && (
                  <div style={{ borderLeft: "3px solid var(--sage)", background: "rgba(44,36,28,.05)", borderRadius: 6, padding: "4px 8px", marginBottom: 5, fontSize: 11.5, maxWidth: 320 }}>
                    <div style={{ fontWeight: 700, color: "var(--sage-2)" }}>{m.quote.authorName}</div>
                    <div style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.quote.text}</div>
                  </div>
                )}
                {m.context && <div style={{ marginBottom: 5 }}><ContextChip ctx={m.context} /></div>}
                {showTitle(m) && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--walnut)", marginBottom: 2 }}>{m.title}</div>}
                {!!m.photos?.length && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: m.body ? 5 : 0 }}>
                    {m.photos.map((p, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={p} alt="" onClick={() => onPhoto(p)} style={{ width: m.photos!.length === 1 ? 200 : 92, height: m.photos!.length === 1 ? undefined : 92, maxWidth: "100%", objectFit: "cover", borderRadius: 8, cursor: "zoom-in", display: "block" }} />
                    ))}
                  </div>
                )}
                {m.body && <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>}
                {m.reactions && Object.keys(m.reactions).length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                    {Object.entries(Object.values(m.reactions).reduce<Record<string, number>>((a, e) => { a[e] = (a[e] ?? 0) + 1; return a; }, {})).map(([e, n]) => (
                      <span key={e} title={Object.entries(m.reactions!).filter(([, em]) => em === e).map(([uid]) => db.users.find((x) => x.id === uid)?.name ?? "someone").join(", ")}
                        style={{ fontSize: 11.5, background: "var(--cream)", border: "1px solid var(--line)", borderRadius: 99, padding: "1px 7px" }}>{e}{n > 1 ? ` ${n}` : ""}</span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 9.5, color: "var(--muted)", textAlign: "right", marginTop: 3 }}>
                  {timeBubble(m.at)}
                  {mine && <span title={readByAll(m.at) ? "Read by everyone" : "Sent"} style={{ marginLeft: 4, fontWeight: 700, letterSpacing: "-2px", color: readByAll(m.at) ? "var(--sage-2)" : "var(--muted)" }}>✓✓</span>}
                </div>
              </div>
              {hoverId === m.id && (
                <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", gap: 2, position: "relative", flexShrink: 0 }}>
                  <button className="btn btn-sm" title="Reply to this message"
                    onClick={() => setQuoting({ id: m.id, authorName: m.authorName, text: (m.body || m.title || "📷 Photo").slice(0, 140) })}
                    style={{ padding: "1px 7px", fontSize: 12 }}>↩</button>
                  <button className="btn btn-sm" title="React"
                    onClick={() => setReactFor(reactFor === m.id ? null : m.id)}
                    style={{ padding: "1px 7px", fontSize: 12 }}>🙂</button>
                  {reactFor === m.id && (
                    <span style={{ position: "absolute", bottom: "115%", right: 0, display: "inline-flex", gap: 2, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 99, padding: "3px 6px", boxShadow: "0 4px 14px rgba(44,36,28,.18)", zIndex: 5 }}>
                      {REACT_EMOJI.map((e) => (
                        <button key={e} onClick={() => { store.reactToMessage(m.id, e); setReactFor(null); }}
                          style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 15, padding: "0 2px" }}>{e}</button>
                      ))}
                    </span>
                  )}
                </span>
              )}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* composer */}
      <div style={{ borderTop: "1px solid var(--line)", background: "var(--paper)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        <PhotoStrip photos={att.photos} uploading={att.uploading} onRemove={att.remove} size={48} />
        {quoting && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderLeft: "3px solid var(--sage)", background: "var(--cream)", borderRadius: 6, padding: "4px 8px" }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: 11.5 }}>
              <div style={{ fontWeight: 700, color: "var(--sage-2)" }}>↩ Replying to {quoting.authorName}</div>
              <div style={{ color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{quoting.text}</div>
            </div>
            <button className="btn btn-sm" onClick={() => setQuoting(null)}>✕</button>
          </div>
        )}
        {mic.listening && <div style={{ fontSize: 11, color: "var(--rust)", fontWeight: 600 }}>● Listening — tap ■ to stop.</div>}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          {att.input}
          <button className="btn btn-sm" title="Add photos" onClick={att.open} style={{ height: 36 }}>📷</button>
          {mic.supported && (
            <button className="btn btn-sm" title={mic.listening ? "Stop dictation" : "Dictate"} onClick={() => (mic.listening ? mic.stop() : mic.start())}
              style={{ height: 36, ...(mic.listening ? { background: "var(--rust)", color: "#fff", borderColor: "var(--rust)" } : {}) }}>
              {mic.listening ? "■" : "🎤"}
            </button>
          )}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} placeholder="Message…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            style={{ flex: 1, resize: "none", fontSize: 13.5, minHeight: 36, maxHeight: 110, padding: "8px 11px", borderRadius: 18 }} />
          <button className="btn btn-primary" disabled={(!body.trim() && !att.photos.length) || att.uploading > 0} onClick={send} title="Send" style={{ height: 36, borderRadius: 18 }}>➤</button>
        </div>
      </div>
    </>
  );
}
