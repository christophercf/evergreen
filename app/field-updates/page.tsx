"use client";

// ---------------------------------------------------------------------------
// Field Updates — the GC's site reporter.
//
// A phone-first composer builds a client-facing report item by item: type or
// dictate what happened, attach photos, tie it to a budget line (or call it ad
// hoc by name), flag it Green / Yellow / Red, and call out anything that needs
// the owner's decision. Publish sends ONE formatted report — through Messages
// AND by email — and pins it to the Schedule where both parties can click in.
//
// Compose seats: builder + full admin. Everyone else reads the published
// report through its Messages chip, its Schedule pin, or the email; they never
// see the composer. Vendor copies carry only their own items.
//
// An update is immutable once sent — corrections go in the next update.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { PageHeader, NoAccess, Pill } from "../ui/bits";
import { ActionBar } from "../ui/action-bar";
import { useDictation, usePhotoAttach, PhotoStrip } from "../ui/messenger";
import {
  accessFor, canReadFieldUpdate, fieldItemsFor, RAG_LABEL,
  type FieldItem, type FieldUpdate, type Rag, type User,
} from "@/lib/data/types";

// The report's own tints — the prototype's earth palette, which the app's
// variables already share. Yellow/red tints aren't global vars, so they live
// here with the one module that reads them.
const RAGC: Record<Rag, { fg: string; bg: string; border: string }> = {
  red: { fg: "#8a4029", bg: "#f0e2d8", border: "var(--rust)" },
  yellow: { fg: "#7a5d1f", bg: "#f5ecd7", border: "#c2a14a" },
  green: { fg: "#33452a", bg: "var(--sage-tint)", border: "var(--sage)" },
};

type DraftItem = Omit<FieldItem, "id">;

const noLabel = (n: number) => String(n).padStart(2, "0");
const dateLabelOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const oneLine = (t: string) => (t.length > 64 ? `${t.slice(0, 64).replace(/\s+\S*$/, "")}…` : t);
const live = (u: User) => u.status !== "invited" && u.status !== "pending" && !u.disabled;

export default function FieldUpdatesPage() {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const access = accessFor(user, role, "field");

  // Deep link from a Messages chip or a Schedule pin: ?view=<id> opens that
  // report. Read once on mount (the timing page's own pattern).
  const [viewId, setViewId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("view");
    if (id) setViewId(id);
  }, []);
  const open = (id: string) => {
    setViewId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("view", id);
    window.history.replaceState({}, "", url.toString());
  };
  const close = () => {
    setViewId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.replaceState({}, "", url.toString());
  };

  if (access === "none") return <NoAccess module="Field Updates" />;

  const updates = db.fieldUpdates ?? [];
  const viewing = viewId ? updates.find((u) => u.id === viewId) : undefined;

  if (viewId && !viewing && !store.loading) {
    // A chip for an update that isn't here (wrong project, or a stale link).
    return (
      <>
        <PageHeader title="Field Updates" />
        <div className="card" style={{ padding: 20, marginTop: 16, maxWidth: 520 }}>
          <strong style={{ fontSize: 14, color: "var(--walnut)" }}>That update isn&rsquo;t here.</strong>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 5, lineHeight: 1.55 }}>
            The link may be old, or the update was published on a different project.
          </div>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={close}>← Back to Field Updates</button>
        </div>
      </>
    );
  }

  if (viewing) {
    const readable = canReadFieldUpdate(viewing, role, user);
    if (!readable) return <NoAccess module="this field update" />;
    return <ReportView u={viewing} onBack={close} />;
  }

  const canCompose = access === "edit" && (role === "builder" || role === "full_admin");
  return canCompose ? <Composer onOpen={open} /> : <ReaderList onOpen={open} />;
}

// ---------------------------------------------------------------------------
// The reader's landing: the published updates this seat can open. The owner and
// designer read everything sent to them; a vendor sees only updates carrying
// their items.
// ---------------------------------------------------------------------------
function ReaderList({ onOpen }: { onOpen: (id: string) => void }) {
  const store = useStore();
  const role = store.session.role;
  const user = store.currentUser;
  const mine = (store.db.fieldUpdates ?? []).filter((u) => canReadFieldUpdate(u, role, user));
  return (
    <>
      <PageHeader
        title="Field Updates"
        subtitle="The site reports the builder has published. Each one also reached you in Messages and by email."
      />
      {mine.length === 0 ? (
        <div className="card" style={{ padding: 20, marginTop: 16, maxWidth: 520 }}>
          <strong style={{ fontSize: 14, color: "var(--walnut)" }}>Nothing published yet.</strong>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 5, lineHeight: 1.55 }}>
            When the builder publishes a field update it lands here, in your Messages, and in your email.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16, maxWidth: 620 }}>
          {mine.map((u) => <SentCard key={u.id} u={u} onOpen={() => onOpen(u.id)} forRole={role} forUser={user} />)}
        </div>
      )}
    </>
  );
}

function SentCard({ u, onOpen, forRole, forUser }: { u: FieldUpdate; onOpen: () => void; forRole: ReturnType<typeof useStore>["session"]["role"]; forUser: User | undefined }) {
  const items = fieldItemsFor(u, forRole, forUser);
  const reds = items.filter((i) => i.rag === "red").length;
  const asks = items.filter((i) => i.ask).length;
  const meta = `${items.length} ${items.length === 1 ? "item" : "items"}${reds ? ` · ${reds} red` : ""}${asks ? ` · ${asks} ${asks === 1 ? "ask" : "asks"}` : ""}`;
  return (
    <button onClick={onOpen} className="card tap-row" style={{ padding: "12px 14px", textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, font: "inherit" }}>
      <span style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className="serif" style={{ fontSize: 14, fontWeight: 700, color: "var(--walnut)" }}>No {noLabel(u.no)}</span>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{dateLabelOf(u.dateIso)}</span>
      </span>
      <span style={{ fontSize: 13, color: "var(--ink)" }}>{u.title}</span>
      <span style={{ fontSize: 11.5, color: "var(--brass-2)", fontWeight: 600 }}>{meta} · open →</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The composer. One column, phone-first, 44px+ targets. The GC builds the
// update as a stack of condensed lines, one item at a time.
// ---------------------------------------------------------------------------
function Composer({ onOpen }: { onOpen: (id: string) => void }) {
  const store = useStore();
  const db = store.db;

  const [items, setItems] = useState<DraftItem[]>([]);
  const [composing, setComposing] = useState(true);
  const [openItem, setOpenItem] = useState(-1);
  const [title, setTitle] = useState("");
  const [ack, setAck] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState({ owner: true, designer: false, vendors: false });
  const [pubMsg, setPubMsg] = useState<string | null>(null);

  const say = (t: string) => { setAck(t); setTimeout(() => setAck((cur) => (cur === t ? null : cur)), 4000); };

  // ---- item entry state ----
  const [text, setText] = useState("");
  const [lineSel, setLineSel] = useState("");   // costLine id, or "__adhoc"
  const [adhoc, setAdhoc] = useState("");
  const [rag, setRag] = useState<Rag>("green");
  const [needsClient, setNeedsClient] = useState(false);
  const [ask, setAsk] = useState("");
  const [dictated, setDictated] = useState(false);
  const att = usePhotoAttach();
  const mic = useDictation((t) => { setText((b) => (b ? `${b} ${t}` : t)); setDictated(true); });
  // Speech support is a browser fact the server cannot know — rendering the
  // Dictate button straight from it breaks hydration. Show it after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const showMic = mounted && mic.supported;

  const lineOpts = db.costLines.map((l) => ({ id: l.id, label: l.name, tradeId: l.tradeId }));
  const isAdhoc = lineSel === "__adhoc";
  const lineOk = isAdhoc ? !!adhoc.trim() : !!lineSel;
  const askOk = !needsClient || !!ask.trim();
  const canSave = !!text.trim() && lineOk && askOk && att.uploading === 0;
  const saveWhy = !text.trim() ? "Nothing added — write or dictate the update first."
    : !lineOk ? (isAdhoc ? "Name the ad hoc item — that name is its budget label." : "Pick the budget line this is about, or mark it ad hoc.")
    : !askOk ? "Nothing added — say what you need from the owner, or turn the ask off."
    : att.uploading > 0 ? "Photos are still uploading."
    : "";

  const resetEntry = () => {
    setText(""); setLineSel(""); setAdhoc(""); setRag("green");
    setNeedsClient(false); setAsk(""); setDictated(false); att.clear();
    mic.stop();
  };

  const saveItem = () => {
    if (!canSave) return;
    const line = isAdhoc ? adhoc.trim() : (lineOpts.find((l) => l.id === lineSel)?.label ?? "General");
    const item: DraftItem = {
      text: text.trim(), line,
      lineId: isAdhoc ? undefined : lineSel,
      tradeId: isAdhoc ? undefined : lineOpts.find((l) => l.id === lineSel)?.tradeId,
      adhoc: isAdhoc, rag,
      ask: needsClient ? ask.trim() : "",
      photos: att.photos,
    };
    setItems((xs) => [...xs, item]);
    resetEntry();
    setComposing(false);
    setOpenItem(-1);
    say(item.rag === "red" ? "Saved and flagged red — it will lead the update."
      : item.ask ? "Saved with an ask — the owner will see it called out."
      : "Saved to the update.");
  };

  // ---- recipients ----
  const owners = db.users.filter((u) => u.role === "owner" && live(u));
  const designers = db.users.filter((u) => u.role === "viewer" && live(u));
  const awardedTradeIds = new Set(db.vendorAgreements.filter((a) => a.contract).map((a) => a.tradeId));
  const draftTradeIds = new Set(items.map((i) => i.tradeId).filter((t): t is string => !!t));
  const vendorTargets = db.users.filter((u) => u.role === "trade" && live(u) &&
    (u.tradeIds ?? []).some((t) => awardedTradeIds.has(t) && draftTradeIds.has(t)));

  const ownerNames = owners.map((u) => u.name.split(" ")[0]).join(" and ");
  const recipients: { k: "owner" | "designer" | "vendors"; label: string; note: string; n: number }[] = [
    { k: "owner", label: owners.length ? `${ownerNames} — owner` : "Owner", note: owners.length ? "Messages + email" : "no owner seat on the project", n: owners.length },
    { k: "designer", label: "Designer", note: designers.length ? "read-only seat" : "no designer seat on the project", n: designers.length },
    { k: "vendors", label: "Awarded vendors", note: vendorTargets.length ? `their items only · ${vendorTargets.length} match${vendorTargets.length === 1 ? "es" : ""} this update` : "no awarded vendor has items in this update", n: vendorTargets.length },
  ];
  const anyRecipient = (sendTo.owner && owners.length > 0) || (sendTo.designer && designers.length > 0) || (sendTo.vendors && vendorTargets.length > 0);

  const redN = items.filter((i) => i.rag === "red").length;
  const askN = items.filter((i) => i.ask).length;
  const canPublish = items.length > 0 && anyRecipient;
  const publishWhy = !items.length ? "Nothing to publish — add at least one item first."
    : !anyRecipient ? "Pick at least one recipient before it goes out."
    : "";

  const publish = () => {
    if (!canPublish) return;
    const res = store.publishFieldUpdate({
      title,
      items,
      sendTo: {
        owner: sendTo.owner && owners.length > 0,
        designer: sendTo.designer && designers.length > 0,
        vendors: sendTo.vendors && vendorTargets.length > 0,
      },
    });
    if (!res) return;
    // The email push — the same report, laid out for the inbox. Data URLs
    // (mock-mode photos) are dropped from the mail; a count line stands in.
    const origin = typeof window !== "undefined" ? window.location.origin : "https://evergreen-rust-five.vercel.app";
    const viewUrl = `${origin}/field-updates?view=${res.id}`;
    const mailItems = (list: DraftItem[]) => list.map((i) => ({
      text: i.text, line: i.line, rag: i.rag, ask: i.ask || undefined,
      photos: i.photos.filter((p) => /^https?:\/\//i.test(p)),
      photoCount: i.photos.length,
    }));
    const send = (to: string[], list: DraftItem[]) => {
      if (!to.length || !list.length) return;
      void fetch("/api/field-update-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to, projectName: db.project.name, no: res.no, title: res.title,
          dateLabel: res.dateLabel, by: store.session.displayName, viewUrl,
          ownerFirst: owners[0]?.name.split(" ")[0], items: mailItems(list),
        }),
      }).catch(() => { /* the in-app copy still stands */ });
    };
    send(res.teamEmails, items);
    for (const v of res.vendorRecipients) {
      if (v.email) send([v.email], items.filter((i) => i.tradeId && v.tradeIds.includes(i.tradeId)));
    }
    setItems([]); setTitle(""); setComposing(true); setOpenItem(-1); resetEntry();
    setPubMsg(`Published to ${res.sentToLine} — in Messages and by email.`);
    setTimeout(() => setPubMsg(null), 6000);
  };

  const sent = db.fieldUpdates ?? [];
  const showEntry = composing || items.length === 0;

  return (
    <div style={{ maxWidth: 560 }}>
      <PageHeader
        title="Field Updates"
        subtitle="Build the update item by item from the site — type or dictate, attach photos, flag each item Green, Yellow or Red, and call out anything that needs the owner's decision. Publish sends one formatted report to Messages and email, and pins it to the Schedule."
      />

      {pubMsg && (
        <div className="card" style={{ padding: "10px 13px", marginTop: 14, borderLeft: "3px solid var(--sage)", fontSize: 13, color: "var(--sage-2)", fontWeight: 600 }}>
          ✓ {pubMsg}
        </div>
      )}

      {/* -------- the draft: condensed items -------- */}
      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--brass-2)" }}>In this update</div>
          {items.map((i, ix) => {
            const c = RAGC[i.rag];
            const isOpen = openItem === ix;
            return (
              <div key={ix} className="card" style={{ padding: 0, borderLeft: `4px solid ${c.border}`, overflow: "hidden" }}>
                <button onClick={() => setOpenItem(isOpen ? -1 : ix)} className="tap-row"
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "transparent", border: 0, padding: "11px 13px", cursor: "pointer", font: "inherit" }}>
                  <span style={{ color: "var(--brass-2)", fontSize: 12, flexShrink: 0 }}>{isOpen ? "▾" : "▸"}</span>
                  <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", background: c.bg, color: c.fg, borderRadius: 3, padding: "1px 6px" }}>{RAG_LABEL[i.rag]}</span>
                      <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{i.line}</span>
                      {i.ask && <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", background: RAGC.yellow.bg, color: RAGC.yellow.fg, borderRadius: 3, padding: "1px 6px" }}>Ask</span>}
                      {i.photos.length > 0 && <span style={{ fontSize: 11, color: "var(--muted)" }}>{i.photos.length === 1 ? "1 photo" : `${i.photos.length} photos`}</span>}
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.4, color: "var(--ink)" }}>{oneLine(i.text)}</span>
                  </span>
                </button>
                {isOpen && (
                  <div style={{ padding: "0 13px 12px 35px", display: "flex", flexDirection: "column", gap: 7 }}>
                    <span style={{ fontSize: 13, lineHeight: 1.5 }}>{i.text}</span>
                    {i.ask && <span style={{ fontSize: 12.5, lineHeight: 1.5, color: RAGC.yellow.fg, background: RAGC.yellow.bg, borderRadius: 6, padding: "6px 9px" }}>{ownerNames || "Owner"}: {i.ask}</span>}
                    {i.photos.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {i.photos.map((p, k) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={k} src={p} alt="Site photo" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                        ))}
                      </div>
                    )}
                    <button className="btn btn-sm" style={{ alignSelf: "flex-start", color: "var(--rust)" }}
                      onClick={() => { setItems((xs) => xs.filter((_, j) => j !== ix)); setOpenItem(-1); say("Item removed from the draft."); }}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {ack && <div style={{ fontSize: 12.5, color: "var(--sage-2)", fontWeight: 600, marginTop: 8 }}>✓ {ack}</div>}

      {/* -------- the item entry form -------- */}
      {showEntry ? (
        <div className="card" style={{ padding: 15, marginTop: 14, display: "flex", flexDirection: "column", gap: 13 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--brass-2)" }}>What happened</span>
            <div style={{ position: "relative" }}>
              <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={!mounted || mic.supported ? "Type it, or tap Dictate and talk" : "Type it — your keyboard's mic button dictates right into this box"}
                style={{ width: "100%", fontSize: 14, lineHeight: 1.5, padding: "10px 11px", resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {showMic && (
                <button className="btn tap" onClick={() => (mic.listening ? mic.stop() : mic.start())}
                  style={{ minHeight: 44, ...(mic.listening ? { background: "var(--rust)", color: "#fff", borderColor: "var(--rust)" } : null) }}>
                  {mic.listening ? "● Listening…" : "🎤 Dictate"}
                </button>
              )}
              {att.input}
              <button className="btn tap" style={{ minHeight: 44 }} onClick={att.open}>📷 Photo</button>
            </div>
            {mic.listening && <div style={{ fontSize: 11.5, color: "var(--rust)", fontWeight: 600 }}>● Listening — speak normally, tap again to stop.</div>}
            {dictated && !mic.listening && <div style={{ fontSize: 11.5, color: "var(--brass-2)" }}>Read it before you add it — dictation gets trade names wrong.</div>}
            <PhotoStrip photos={att.photos} uploading={att.uploading} onRemove={att.remove} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--brass-2)" }}>Budget line</span>
            <select value={lineSel} onChange={(e) => setLineSel(e.target.value)} className="tap" style={{ fontSize: 14, padding: "8px 10px" }}>
              <option value="">Pick the budget line…</option>
              {lineOpts.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              <option value="__adhoc">Ad hoc — not in the budget</option>
            </select>
            {isAdhoc && (
              <input value={adhoc} onChange={(e) => setAdhoc(e.target.value)} placeholder="Name it — e.g. Neighbour relations"
                style={{ fontSize: 14, padding: "9px 11px", border: "1px solid #c2a14a", background: RAGC.yellow.bg, borderRadius: 6 }} className="tap" />
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--brass-2)" }}>Status</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {(["green", "yellow", "red"] as Rag[]).map((k) => {
                const on = rag === k;
                const c = RAGC[k];
                return (
                  <button key={k} className="tap" onClick={() => setRag(k)}
                    style={{ font: "inherit", fontSize: 13.5, minHeight: 44, borderRadius: 6, cursor: "pointer", background: on ? c.bg : "transparent", color: on ? c.fg : "var(--muted)", border: `1.5px solid ${on ? c.border : "var(--line)"}`, fontWeight: on ? 700 : 500 }}>
                    {RAG_LABEL[k]}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Red = schedule or money at risk · yellow = watch · green = progress.</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button className="tap" onClick={() => setNeedsClient((v) => !v)}
              style={{ font: "inherit", fontSize: 13, textAlign: "left", minHeight: 44, padding: "10px 13px", borderRadius: 6, cursor: "pointer", background: needsClient ? "#f0e6cd" : "transparent", color: needsClient ? "var(--brass-2)" : "var(--muted)", border: `1px solid ${needsClient ? "var(--brass)" : "var(--line)"}`, fontWeight: 600 }}>
              {needsClient ? "✓ " : ""}Needs owner&rsquo;s decision
            </button>
            {needsClient && (
              <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="What exactly do you need from the owner, and by when"
                style={{ fontSize: 14, padding: "9px 11px", border: "1px solid #c2a14a", borderRadius: 6 }} className="tap" />
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary tap" disabled={!canSave} onClick={saveItem} style={{ flex: 1, minHeight: 48 }}>Save item</button>
            {items.length > 0 && (
              <button className="btn tap" style={{ minHeight: 48 }} onClick={() => { resetEntry(); setComposing(false); }}>Cancel</button>
            )}
          </div>
          {!canSave && saveWhy && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{saveWhy}</div>}
        </div>
      ) : (
        <button className="tap-row" onClick={() => { setComposing(true); setOpenItem(-1); }}
          style={{ font: "inherit", fontSize: 13.5, minHeight: 48, width: "100%", marginTop: 12, borderRadius: 8, cursor: "pointer", background: "transparent", color: "var(--sage-2)", border: "1.5px dashed var(--line)", fontWeight: 600 }}>
          ＋ New item
        </button>
      )}

      {/* -------- headline + recipients + publish -------- */}
      {items.length > 0 && (
        <>
          <div className="card" style={{ padding: "13px 15px", marginTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--brass-2)" }}>Update headline — optional</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Week 34 — crown poured, brick shortfall"
              style={{ fontSize: 14, padding: "9px 11px" }} className="tap" />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Left blank it goes out as &ldquo;Field update — {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}&rdquo;.</span>
          </div>

          <div className="card" style={{ padding: "13px 15px", marginTop: 12, display: "flex", flexDirection: "column", gap: 9 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--brass-2)" }}>Send to</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {recipients.map((r) => {
                const on = sendTo[r.k] && r.n > 0;
                const dead = r.n === 0;
                return (
                  <button key={r.k} className="tap-row" disabled={dead}
                    onClick={() => setSendTo((s) => ({ ...s, [r.k]: !s[r.k] }))}
                    style={{ font: "inherit", textAlign: "left", minHeight: 44, padding: "9px 12px", borderRadius: 6, cursor: dead ? "default" : "pointer", display: "flex", alignItems: "center", gap: 10, background: on ? "var(--sage-tint)" : "transparent", border: `1px solid ${on ? "var(--sage)" : "var(--line)"}`, color: dead ? "var(--muted)" : on ? "var(--sage-2)" : "var(--muted)", opacity: dead ? 0.62 : 1 }}>
                    <span style={{ width: 18, height: 18, borderRadius: 3, border: `1.5px solid ${on ? "var(--sage)" : "var(--line)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, background: "var(--paper)", color: "var(--sage-2)" }}>{on ? "✓" : ""}</span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.label}</span>
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>{r.note}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <ActionBar
        show={items.length > 0}
        summary={
          <span>
            <strong style={{ color: "var(--ink)" }}>{items.length} {items.length === 1 ? "item" : "items"}</strong>
            {redN ? <span style={{ color: "var(--rust)", fontWeight: 700 }}> · {redN} red</span> : null}
            {askN ? <span style={{ color: "var(--brass-2)", fontWeight: 700 }}> · {askN} {askN === 1 ? "ask" : "asks"}</span> : null}
            {!canPublish && publishWhy ? <span style={{ display: "block", marginTop: 2 }}>{publishWhy}</span> : null}
          </span>
        }
        primary={{ label: "Publish & send", disabled: !canPublish, onClick: publish, title: canPublish ? undefined : publishWhy }}
      />

      {/* -------- what has gone out -------- */}
      {sent.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 22 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--brass-2)" }}>Sent</div>
          {sent.map((u) => <SentCard key={u.id} u={u} onOpen={() => onOpen(u.id)} forRole={store.session.role} forUser={store.currentUser} />)}
          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
            A sent update never changes — corrections go in the next one.
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The published report — a formatted document, not a chat bubble. Decisions
// first, red second, progress last (yellow before green). The email preview
// shows the same report in inbox chrome. Vendors see only their own items.
// ---------------------------------------------------------------------------
function ReportView({ u, onBack }: { u: FieldUpdate; onBack: () => void }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const user = store.currentUser;
  const [asEmail, setAsEmail] = useState(false);

  const items = fieldItemsFor(u, role, user);
  const filtered = items.length < u.items.length;
  const asks = items.filter((i) => i.ask);
  const reds = items.filter((i) => i.rag === "red");
  const rest = items.filter((i) => i.rag !== "red").sort((a, b) => (a.rag === "yellow" ? 0 : 1) - (b.rag === "yellow" ? 0 : 1));
  const yelN = items.filter((i) => i.rag === "yellow").length;
  const grnN = items.filter((i) => i.rag === "green").length;

  const owners = db.users.filter((x) => x.role === "owner" && live(x));
  const ownerFirst = owners[0]?.name.split(" ")[0] ?? "the owner";
  const askHeading = role === "owner" ? "Needs your decision" : `Needs ${ownerFirst}'s decision`;
  const dateLabel = dateLabelOf(u.dateIso);
  const chip = (label: string, c: { fg: string; bg: string; border: string }) => (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", background: c.bg, color: c.fg, border: `1px solid ${c.border}`, borderRadius: 3, padding: "4px 9px" }}>{label}</span>
  );

  const photos = (list: string[]) => list.length > 0 && (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      {list.map((p, k) => (
        <a key={k} href={p} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p} alt="Site photo" style={{ width: 86, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", display: "block" }} />
        </a>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={onBack}>‹ Back</button>
        <button className="btn btn-sm" onClick={() => setAsEmail((v) => !v)}>{asEmail ? "‹ Back to the app view" : "Preview the email"}</button>
      </div>

      <div style={{ background: asEmail ? "#e8e4da" : "transparent", border: asEmail ? "1px solid var(--line)" : "none", borderRadius: 8, padding: asEmail ? 14 : 0 }}>
        {asEmail && (
          <div className="card" style={{ padding: "13px 16px", borderRadius: "8px 8px 0 0", display: "flex", flexDirection: "column", gap: 4, marginBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}><strong>Evergreen AI</strong> — updates</span>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{dateLabel}</span>
            </div>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>To: {role === "owner" ? "you" : u.sentToLine}</span>
            <span className="serif" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--walnut)" }}>Field update No {noLabel(u.no)} — {u.title}</span>
            <span style={{ fontSize: 11, color: "var(--muted)", borderTop: "1px solid var(--cream-2)", paddingTop: 6, marginTop: 2, lineHeight: 1.5 }}>
              This is the same report, laid out for the inbox — one column, no app chrome, a plain link back into Evergreen at the bottom.
            </span>
          </div>
        )}

        <div className="card" style={{ padding: 0, overflow: "hidden", borderRadius: asEmail ? 0 : undefined }}>
          {/* masthead */}
          <div style={{ background: "var(--walnut)", color: "var(--cream)", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#c9bfa8" }}>
              Evergreen AI · {db.project.name} · Field update No {noLabel(u.no)}
            </span>
            <span className="serif" style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.15 }}>{u.title}</span>
            <span style={{ fontSize: 12, color: "#c9bfa8" }}>{dateLabel} · {u.by}, General Contractor</span>
          </div>

          {/* summary strip */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "13px 20px", borderBottom: "1px solid var(--line)", background: "var(--cream)" }}>
            {reds.length > 0 && chip(`${reds.length} Red`, RAGC.red)}
            {yelN > 0 && chip(`${yelN} Yellow`, RAGC.yellow)}
            {grnN > 0 && chip(`${grnN} Green`, RAGC.green)}
            {asks.length > 0 && chip(`${asks.length} for ${ownerFirst}`, { fg: "#f0e6cd", bg: "var(--walnut)", border: "var(--walnut)" })}
            {filtered && <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>your items only</span>}
          </div>

          {/* asks — first, unmissable */}
          {asks.length > 0 && (
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", background: RAGC.yellow.bg, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: RAGC.yellow.fg }}>{askHeading}</span>
              {asks.map((i) => (
                <div key={i.id} style={{ background: "var(--paper)", border: "1px solid #c2a14a", borderRadius: 6, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 5 }}>
                  <span className="serif" style={{ fontSize: 15, lineHeight: 1.45, color: "var(--walnut)", fontWeight: 700 }}>{i.ask}</span>
                  <span style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>{i.line} — {i.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* red — second */}
          {reds.length > 0 && (
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: RAGC.red.fg }}>Flagged red</span>
              {reds.map((i) => (
                <div key={i.id} style={{ border: "1px solid var(--rust)", borderLeft: "5px solid var(--rust)", borderRadius: 6, background: RAGC.red.bg, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11.5, color: RAGC.red.fg, letterSpacing: ".06em", textTransform: "uppercase", fontWeight: 700 }}>{i.line}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.5 }}>{i.text}</span>
                  {photos(i.photos)}
                </div>
              ))}
            </div>
          )}

          {/* progress — yellow before green */}
          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {rest.length > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--brass-2)" }}>Progress</span>}
            {rest.map((i) => {
              const c = RAGC[i.rag];
              return (
                <div key={i.id} style={{ borderBottom: "1px solid var(--cream-2)", paddingBottom: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", background: c.bg, color: c.fg, borderRadius: 3, padding: "2px 7px" }}>{RAG_LABEL[i.rag]}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{i.line}</span>
                  </div>
                  <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>{i.text}</span>
                  {photos(i.photos)}
                </div>
              );
            })}
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {role === "owner" ? "Sent to you in Messages and by email" : `Sent to ${u.sentToLine} — in Messages and by email`}
            </span>
          </div>
        </div>

        {asEmail && (
          <div className="card" style={{ padding: "12px 16px", borderRadius: "0 0 8px 8px", display: "flex", flexDirection: "column", gap: 3, marginTop: 0 }}>
            <span style={{ fontSize: 12, color: "var(--sage-2)", textDecoration: "underline", fontWeight: 600 }}>Open this update in Evergreen</span>
            <span style={{ fontSize: 10.5, lineHeight: 1.5, color: "var(--muted)" }}>
              Evergreen AI · {db.project.name} · You receive these because you are on this project. Reply to {u.by} in Messages.
            </span>
          </div>
        )}
      </div>

      {(role === "builder" || role === "full_admin") && (
        <div style={{ marginTop: 12 }}>
          <Pill color="var(--muted)">Immutable — corrections go in the next update</Pill>
        </div>
      )}
    </div>
  );
}
