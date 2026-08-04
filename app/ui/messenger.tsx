"use client";

// ---------------------------------------------------------------------------
// Shared Messenger pieces:
//  • MsgButton — a 💬 launcher placed next to items (materials, cost lines,
//    timeline tasks, documents). Opens the compose modal pre-linked to the item.
//  • MessageModal — a mobile-friendly overlay hosting the Composer, rendered
//    once in the app frame and driven by a tiny module-level bus.
//  • Composer — the full field composer (photos, dictation, recipient chips),
//    used by the Messenger page AND the modal.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/data/hooks";
import { Pill } from "./bits";
import { canMessageUser, ROLE_LABEL, UPDATE_CONTEXT_ICON, type UpdateContext } from "@/lib/data/types";
import { storeFile } from "./upload";

// ---- compose bus ------------------------------------------------------------
let composeListener: ((ctx: UpdateContext) => void) | null = null;

/** Open the message composer pre-linked to an app item (from anywhere). */
export function launchMessage(ctx: UpdateContext) {
  composeListener?.(ctx);
}

// ---- email push ---------------------------------------------------------------
/** Recipient emails for a set of user ids, honoring each person's
 *  email-notification preference (Settings → My Preferences). */
export function emailsFor(users: { id: string; email?: string; emailOptOut?: boolean }[], ids: string[]): string[] {
  return ids
    .map((id) => users.find((u) => u.id === id))
    .filter((u): u is NonNullable<typeof u> => !!u && !u.emailOptOut && !!u.email)
    .map((u) => u.email!);
}

// Fire-and-forget; delivers when RESEND_API_KEY is configured on the server.
// `opts.replyUrl` becomes the email's "Reply in the app" button target;
// `opts.convKey` enables reply-by-email threading when an inbound domain is set.
export function pushEmail(emails: string[], subject: string, text: string, opts?: { replyUrl?: string; senderName?: string; photoCount?: number; convKey?: string }) {
  if (!emails.length) return;
  void fetch("/api/send-update-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: emails, subject, text, appUrl: typeof window !== "undefined" ? window.location.origin : undefined, ...opts }),
  }).catch(() => { /* in-app tracking still works */ });
}

/** The canonical conversation key: the sorted participant-id set. */
export function conversationKeyOf(participantIds: string[]): string {
  return [...new Set(participantIds)].sort().join("+");
}

/** Deep link that opens a specific Messenger conversation (same key for every
 *  participant — the sorted participant-id set). */
export function conversationUrl(participantIds: string[]): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://evergreen-rust-five.vercel.app";
  return `${origin}/updates?conv=${encodeURIComponent(conversationKeyOf(participantIds))}`;
}

// ---- dictation ----------------------------------------------------------------
// Web Speech API (Chrome/Android/desktop). iOS dictates via the keyboard mic.
export function useDictation(onText: (t: string) => void) {
  const recRef = useRef<{ stop: () => void } | null>(null);
  const [listening, setListening] = useState(false);
  const SR = typeof window !== "undefined" ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) : undefined;
  const supported = !!SR;
  const stop = () => { recRef.current?.stop(); setListening(false); };
  const start = () => {
    if (!SR) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new (SR as any)();
    rec.lang = "en-US"; rec.continuous = true; rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let s = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) s += e.results[i][0].transcript;
      if (s.trim()) onText(s.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec; rec.start(); setListening(true);
  };
  return { supported, listening, start, stop };
}

// ---- photo attachments --------------------------------------------------------
// Shared by every composer: hidden camera/library input + thumbnail strip.
export function usePhotoAttach() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading((n) => n + files.length);
    for (const f of Array.from(files)) {
      try {
        const { fileUrl } = await storeFile(f);
        setPhotos((p) => [...p, fileUrl]);
      } catch { /* skip failed file */ }
      setUploading((n) => n - 1);
    }
  };
  const clear = () => setPhotos([]);
  const input = (
    <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }}
      onChange={(e) => { void addFiles(e.target.files); e.currentTarget.value = ""; }} />
  );
  return { photos, uploading, input, clear, remove: (i: number) => setPhotos((p) => p.filter((_, x) => x !== i)), open: () => fileRef.current?.click() };
}

export function PhotoStrip({ photos, uploading, onRemove, size = 54 }: { photos: string[]; uploading: number; onRemove: (i: number) => void; size?: number }) {
  if (!photos.length && !uploading) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {photos.map((p, i) => (
        <span key={i} style={{ position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p} alt="" style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", display: "block" }} />
          <button onClick={() => onRemove(i)} title="Remove photo"
            style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 99, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--rust)", fontSize: 10, lineHeight: 1, cursor: "pointer" }}>✕</button>
        </span>
      ))}
      {uploading > 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>uploading {uploading}…</span>}
    </div>
  );
}

// ---- the 💬 launcher ---------------------------------------------------------
export function MsgButton({ kind, refId, label, href, small }: { kind: UpdateContext["kind"]; refId: string; label: string; href: string; small?: boolean }) {
  return (
    <button
      className="btn btn-sm"
      title={`Message about "${label}"`}
      onClick={(e) => { e.stopPropagation(); launchMessage({ kind, refId, label, href }); }}
      style={small ? { padding: "1px 6px", fontSize: 12 } : undefined}
    >
      💬
    </button>
  );
}

/** The context chip shown on a message: what it's about + jump link. */
export function ContextChip({ ctx }: { ctx: UpdateContext }) {
  return (
    <a href={ctx.href} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "var(--sage-2)", background: "var(--sage-tint)", border: "1px solid var(--line)", borderRadius: 99, padding: "2px 9px", textDecoration: "none" }}>
      {UPDATE_CONTEXT_ICON[ctx.kind]} {ctx.label} <span style={{ opacity: .7 }}>→</span>
    </a>
  );
}

// ---- the modal host (rendered once, in the app frame) -------------------------
export function MessageModal() {
  const [ctx, setCtx] = useState<UpdateContext | null>(null);
  useEffect(() => {
    composeListener = (c) => setCtx(c);
    return () => { composeListener = null; };
  }, []);
  if (!ctx) return null;
  return (
    <div onClick={() => setCtx(null)} style={{ position: "fixed", inset: 0, background: "rgba(28,22,16,.5)", zIndex: 70, display: "flex", alignItems: "flex-end", justifyContent: "center" }} className="ever-msg-overlay">
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, maxHeight: "92vh", overflowY: "auto", background: "var(--cream)", borderRadius: "14px 14px 0 0", boxShadow: "0 -8px 40px rgba(0,0,0,.25)", padding: "14px 14px 18px" }} className="ever-msg-sheet">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <strong className="serif" style={{ fontSize: 16, color: "var(--walnut)" }}>New message</strong>
          <ContextChip ctx={ctx} />
          <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setCtx(null)}>✕</button>
        </div>
        <Composer context={ctx} onPosted={() => setCtx(null)} />
        <style>{`
          @media (min-width: 700px) {
            .ever-msg-overlay { align-items: center !important; }
            .ever-msg-sheet { border-radius: 14px !important; }
          }
        `}</style>
      </div>
    </div>
  );
}

// ---- the composer --------------------------------------------------------------
export function Composer({ context, onPosted }: { context?: UpdateContext; onPosted?: () => void }) {
  const store = useStore();
  const db = store.db;
  const role = store.session.role;
  const me = store.currentUser;
  const name = store.session.displayName;

  const [title, setTitle] = useState(context ? context.label : "");
  const [body, setBody] = useState("");
  const [to, setTo] = useState<Set<string>>(new Set());
  const [posted, setPosted] = useState(false);
  const att = usePhotoAttach();
  const mic = useDictation((t) => setBody((b) => (b ? `${b} ${t}` : t)));

  // Who this sender is allowed to message (owner→own trades+architect+designer+builder;
  // builder→anyone; trade→builder (+owner when owner-managed); designer→owner+builder).
  const allowed = db.users.filter((u) => canMessageUser(me, role, u, db.trades));

  const ready = !!title.trim() && to.size > 0 && att.uploading === 0;
  const post = () => {
    if (!ready) return;
    mic.stop();
    const toIds = [...to];
    const photos = att.photos;
    store.postUpdate({ title, body, photos, toUserIds: toIds, context });
    const emails = emailsFor(db.users, toIds);
    const ctxLine = context ? `\nAbout: ${context.label} — open it here: ${typeof window !== "undefined" ? window.location.origin : ""}${context.href}\n` : "";
    pushEmail(emails, `🏠 ${db.project.name} — ${title.trim()}`,
      `${body.trim() ? `${body.trim()}\n` : ""}${ctxLine}`,
      { replyUrl: conversationUrl([store.session.userId, ...toIds]), convKey: conversationKeyOf([store.session.userId, ...toIds]), senderName: name, photoCount: photos.length || undefined });
    setTitle(context ? context.label : ""); setBody(""); att.clear(); setTo(new Set());
    setPosted(true); setTimeout(() => setPosted(false), 3500);
    onPosted?.();
  };

  return (
    <div className="card" style={{ padding: 14, maxWidth: 760, borderLeft: "3px solid var(--sage)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Update title — e.g. Foundation"
          style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-serif)", padding: "8px 10px" }} />
        <div style={{ position: "relative" }}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={mic.supported ? "What's happening on site… (type, or tap 🎤 to dictate)" : "What's happening on site… (tip: your keyboard's mic button dictates right into this box)"}
            style={{ width: "100%", minHeight: 74, fontSize: 13.5, resize: "vertical", padding: "8px 10px", paddingRight: mic.supported ? 46 : 10 }} />
          {mic.supported && (
            <button onClick={() => (mic.listening ? mic.stop() : mic.start())}
              title={mic.listening ? "Stop dictation" : "Dictate with your voice"}
              style={{ position: "absolute", right: 8, top: 8, width: 32, height: 32, borderRadius: 99, border: "1px solid var(--line)", background: mic.listening ? "var(--rust)" : "var(--paper)", color: mic.listening ? "#fff" : "var(--ink)", cursor: "pointer", fontSize: 15 }}>
              {mic.listening ? "■" : "🎤"}
            </button>
          )}
        </div>
        {mic.listening && <div style={{ fontSize: 11.5, color: "var(--rust)", fontWeight: 600 }}>● Listening — speak your update, tap ■ to stop.</div>}

        {/* photos */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {att.input}
          <button className="btn btn-sm" onClick={att.open}>📷 Add photos</button>
          <PhotoStrip photos={att.photos} uploading={att.uploading} onRemove={att.remove} />
        </div>

        {/* recipients */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>Send to</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {allowed.map((u) => {
              const on = to.has(u.id);
              return (
                <button key={u.id} onClick={() => setTo((s) => { const n = new Set(s); on ? n.delete(u.id) : n.add(u.id); return n; })}
                  className="btn btn-sm" style={{ background: on ? "var(--sage)" : undefined, color: on ? "#fff" : undefined, borderColor: on ? "var(--sage)" : undefined }}>
                  {on ? "✓ " : ""}{u.name} <span style={{ opacity: .75, fontSize: 10.5 }}>· {ROLE_LABEL[u.role]}</span>
                </button>
              );
            })}
            {!allowed.length && <span style={{ fontSize: 12, color: "var(--muted)" }}>No recipients available for your role yet.</span>}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn btn-primary" disabled={!ready} onClick={post}>{context ? "Send message" : "Post update"}</button>
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Tracked in Messenger + emailed to recipients.</span>
          {posted && <Pill color="#fff" bg="var(--ok)">✓ Sent & notified</Pill>}
        </div>
      </div>
    </div>
  );
}
