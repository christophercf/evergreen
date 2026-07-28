"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill } from "../ui/bits";
import { accessFor, canMessageUser, ROLE_LABEL, type SiteUpdate, type UpdateContext, type User } from "@/lib/data/types";
import { ContextChip, emailsFor, PhotoStrip, pushEmail, useDictation, usePhotoAttach } from "../ui/messenger";
import { tradeName } from "@/lib/data/money";

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
type Msg = { id: string; authorId: string; authorName: string; at: string; body?: string; title?: string; photos?: string[]; context?: UpdateContext };
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
  const [showNew, setShowNew] = useState(false);
  const [newTo, setNewTo] = useState<Set<string>>(new Set());
  const [pendingOthers, setPendingOthers] = useState<string[] | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [readMap, setReadMap] = useState<Record<string, string>>({});
  useEffect(() => setReadMap(loadRead()), []);

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
        { id: u.id, authorId: u.authorId, authorName: u.authorName, at: u.at, body: u.body, title: u.title, photos: u.photos, context: u.context },
        ...u.replies.map((r) => ({ id: r.id, authorId: r.authorId, authorName: r.authorName, at: r.at, body: r.body })),
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

  if (access === "none") return <NoAccess module="Messenger" />;

  // ---- filters ----
  const tradesUsed = db.trades.filter((t) => db.users.some((u) => u.tradeIds?.includes(t.id)));
  const people = db.users.filter((u) => u.id !== meId);
  const filtered = convs
    .filter((c) => {
      if (q.trim() && !c.otherIds.some((id) => nameOf(id).toLowerCase().includes(q.trim().toLowerCase()))) return false;
      if (personF !== "all" && !c.otherIds.includes(personF)) return false;
      if (tradeF !== "all" && !c.otherIds.some((id) => userOf(id)?.tradeIds?.includes(tradeF))) return false;
      return true;
    })
    .sort((a, b) => sortAZ
      ? nameOf(a.otherIds[0] ?? "").localeCompare(nameOf(b.otherIds[0] ?? ""))
      : b.lastAt.localeCompare(a.lastAt));

  const allowed = db.users.filter((u) => canMessageUser(user, role, u, db.trades));

  const startNew = () => {
    const ids = [...newTo];
    if (!ids.length) return;
    const key = convKeyOf([meId, ...ids]);
    setPendingOthers(ids);
    setSel(key);
    setShowNew(false);
    setNewTo(new Set());
  };

  return (
    <>
      <PageHeader title="Messenger" subtitle="Chat with the people on your project — photos, voice-to-text, and messages linked to materials, costs, tasks & documents." />

      <div className="msgr card" data-pane={sel ? "chat" : "list"} style={{ marginTop: 14, padding: 0, display: "grid", gridTemplateColumns: "330px 1fr", overflow: "hidden", height: "calc(100dvh - 235px)", minHeight: 420 }}>
        {/* ---------------- list pane ---------------- */}
        <div data-role="list" style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <div style={{ padding: 10, borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search people…" style={{ flex: 1, fontSize: 12.5, padding: "6px 9px", borderRadius: 99 }} />
              <button className="btn btn-sm btn-primary" title="New conversation" onClick={() => { setShowNew((v) => !v); setSel(null); }}>＋ New</button>
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
            </div>
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {showNew ? (
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Start a conversation with</div>
                {allowed.map((u) => {
                  const on = newTo.has(u.id);
                  return (
                    <button key={u.id} onClick={() => setNewTo((s) => { const n = new Set(s); on ? n.delete(u.id) : n.add(u.id); return n; })}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 10, border: on ? "2px solid var(--sage)" : "1px solid var(--line)", background: on ? "var(--sage-tint)" : "var(--paper)", cursor: "pointer", textAlign: "left" }}>
                      <Avatar u={u} size={34} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{u.name}</span>
                        <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{u.role === "trade" && u.tradeIds?.length ? tradeName(db, u.tradeIds[0]) : ROLE_LABEL[u.role]}</span>
                      </span>
                      {on && <span style={{ color: "var(--sage-2)", fontWeight: 700 }}>✓</span>}
                    </button>
                  );
                })}
                {!allowed.length && <div style={{ fontSize: 12, color: "var(--muted)" }}>No one available for your role yet.</div>}
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-primary btn-sm" disabled={!newTo.size} onClick={startNew}>Start chat{newTo.size > 1 ? ` (${newTo.size})` : ""}</button>
                  <button className="btn btn-sm" onClick={() => { setShowNew(false); setNewTo(new Set()); }}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                {filtered.map((c) => {
                  const others = c.otherIds.map(userOf);
                  const unread = unreadOf(c);
                  const active = sel === c.key;
                  return (
                    <button key={c.key} onClick={() => { setPendingOthers(null); setSel(c.key); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", border: "none", borderBottom: "1px solid var(--line)", background: active ? "var(--sage-tint)" : "transparent", cursor: "pointer", textAlign: "left" }}>
                      <Avatar u={others[0]} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--walnut)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.otherIds.map(nameOf).join(", ")}</span>
                          <span style={{ fontSize: 10.5, color: unread ? "var(--sage-2)" : "var(--muted)", flexShrink: 0, fontWeight: unread ? 700 : 400 }}>{c.lastAt ? timeShort(c.lastAt) : ""}</span>
                        </span>
                        <span style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
                          <span style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.preview}</span>
                          {unread > 0 && <span style={{ background: "var(--sage)", color: "#fff", borderRadius: 99, fontSize: 10.5, fontWeight: 700, minWidth: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px", flexShrink: 0 }}>{unread}</span>}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {!filtered.length && <div style={{ padding: 20, textAlign: "center", fontSize: 12.5, color: "var(--muted)" }}>No conversations{q || tradeF !== "all" || personF !== "all" ? " match the filter" : " yet — start one with ＋ New"}.</div>}
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
          .msgr { display: block !important; height: calc(100dvh - 250px) !important; }
          .msgr [data-role="list"], .msgr [data-role="chat"] { height: 100%; border-right: none !important; }
          .msgr[data-pane="chat"] [data-role="list"] { display: none !important; }
          .msgr[data-pane="list"] [data-role="chat"] { display: none !important; }
        }
        @media (min-width: 861px) {
          .msgr-back { display: none !important; }
        }
      `}</style>
    </>
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

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [conv.msgs.length]);

  const send = () => {
    const text = body.trim();
    const photos = att.photos;
    if ((!text && !photos.length) || att.uploading > 0) return;
    mic.stop();
    const latest = conv.items[0] ? conv.items.reduce((a, b) => (a.at > b.at ? a : b)) : null;
    if (photos.length || !latest) {
      // photos (or a brand-new thread) need a full update
      store.postUpdate({ title: derivedTitle(text || "📷 Photo"), body: text, photos, toUserIds: conv.otherIds });
    } else {
      store.replyToUpdate(latest.id, text);
    }
    const emails = emailsFor(db.users, conv.otherIds);
    pushEmail(emails, `💬 ${db.project.name} — message from ${name}`, `${name}:\n\n${text || "(photo)"}${photos.length ? `\n\n📷 ${photos.length} photo${photos.length === 1 ? "" : "s"} — view in the app.` : ""}`);
    setBody(""); att.clear();
  };

  let lastDay = "";
  return (
    <>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--line)", background: "var(--paper)" }}>
        <button className="btn btn-sm msgr-back" onClick={onBack}>←</button>
        <Avatar u={others[0]} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--walnut)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.otherIds.map((id) => userOf(id)?.name ?? "—").join(", ")}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {others.map((u) => u ? (u.role === "trade" && u.tradeIds?.length ? tradeName(db, u.tradeIds[0]) : ROLE_LABEL[u.role]) : "—").join(" · ")}
          </div>
        </div>
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
              <div style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%", background: mine ? "#dde8d2" : "var(--paper)", border: "1px solid var(--line)", borderRadius: mine ? "12px 12px 3px 12px" : "12px 12px 12px 3px", padding: "7px 10px", boxShadow: "0 1px 1px rgba(44,36,28,.06)" }}>
                {group && !mine && <div style={{ fontSize: 10.5, fontWeight: 700, color: avaColor(m.authorId), marginBottom: 2 }}>{m.authorName}</div>}
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
                <div style={{ fontSize: 9.5, color: "var(--muted)", textAlign: "right", marginTop: 3 }}>{timeBubble(m.at)}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* composer */}
      <div style={{ borderTop: "1px solid var(--line)", background: "var(--paper)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        <PhotoStrip photos={att.photos} uploading={att.uploading} onRemove={att.remove} size={48} />
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
