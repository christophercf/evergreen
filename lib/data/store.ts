// ----------------------------------------------------------------------------
// Evergreen store — the single client-side state the React app subscribes to.
// Delegates load/persist/sync to a Backend (mock or supabase) and exposes typed
// mutations. Every mutation clones the DB, applies, persists, and bumps the
// version so useSyncExternalStore re-renders.
// ----------------------------------------------------------------------------

import type {
  AccessLevel, AppNotification, Artifact, ArtifactVersion, ChangeOrder, Contact, ContactSheet, Contract, CostLine, DB, Draw,
  BudgetLineState, CostOwner, DrawingPin, FundingSource, LinePhase, MacroCategory, MarkupModel, Material, ModuleKey, PricePoint, ProductOption, Role, Room, RoomZone, ScheduleItem,
  BidOrigin, BidPackage, BidReqKey, BidRoute, DocRoute, FeedbackItem, FeedbackKind, FeedbackSeverity, FieldItem, MaterialsBasis, MsgQuote, PricingBasis, ScopeMaterial, VendorDoc, VendorDocKind, ScheduleStatus, ScopeDoc, ScopeStatus, Session, Trade, TradeRating, UpdateContext, User, VendorBid, Worker,
} from "./types";
import { BID_REQ_DEFAULT, FEEDBACK_KIND_LABEL, ROLE_LABEL } from "./types";
import { buildDB } from "./seed";
import { contractFromAward, lineDrawable } from "./contract";
import { uncoveredScopeFor } from "./drawscope";
import { lineTotal, lineCurrent, phaseAmount, romEnvelope, romCanLock, tradeUsage, categoryUsage, MACRO_ORDER, MACRO_COLOR } from "./money";
import { type Backend, makeBackend, defaultSession } from "./backend";
import { IS_SUPABASE } from "./config";
import { authEnabled, authOnChange, authSignOut, isRecoveryUrl, authUpdatePassword, authCurrentEmail } from "./auth";

type Listener = () => void;

/** "ok" is a save landing; "error" is a save that did not. */
export type ToastTone = "ok" | "error";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
let uid = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${uid++}`;

/** Notifications written before they carried a module still land somewhere
 *  sensible: a schedule notification is about the schedule. */
const MODULE_OF_KIND: Partial<Record<AppNotification["kind"], ModuleKey>> = {
  schedule_pushed: "timing",
  schedule_confirmed: "timing",
  schedule_declined: "timing",
};

class Store {
  db: DB = buildDB();
  session: Session = defaultSession();
  version = 0;
  /** Set when a verified user signs in but their email isn't on the project. */
  authNoAccess: string | null = null;
  /** True while a password-recovery link is being handled — show the reset screen. */
  recoveryPending = false;
  /** True until Supabase has answered whether a session exists. "Not signed in
   *  YET" and "signed out" are different states: a refresh mid-session must
   *  show a quiet splash while the session restores, never a flash of the
   *  login screen at someone who never signed out. (Config flag, not
   *  authEnabled(): this runs at module load and must not build a client.) */
  authResolving = IS_SUPABASE;

  private backend: Backend | null = null;
  private listeners = new Set<Listener>();
  private started = false;
  // Global undo: snapshot of db (JSON) before each mutation.
  private undoStack: string[] = [];

  get mode(): "mock" | "supabase" {
    return this.backend?.mode ?? "mock";
  }

  /** False until the first load from the backend has landed. Mock returns
   *  almost instantly; Supabase over a site connection does not, and a blank
   *  card must not be mistaken for an empty project. */
  loading = true;

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.backend = makeBackend();
    const pDB = this.backend.loadDB().then((db) => { this.db = db; this.loading = false; });
    const pS = this.backend.loadSession().then((s) => { this.session = s; });
    void Promise.all([pDB, pS]).then(() => {
      if (authEnabled()) {
        // Real auth: the Supabase session is the source of truth. Don't trust a
        // persisted app session; bind/unbind as auth state changes.
        this.session = { ...this.session, authed: false };
        this.recoveryPending = isRecoveryUrl();
        // A recovery link should land on the reset screen, not the splash.
        if (this.recoveryPending) this.authResolving = false;
        // Safety valve: if the auth client never answers (broken storage, a
        // wedged tab), fall back to the login screen rather than a splash
        // that outstays its welcome. INITIAL_SESSION reads local storage, so
        // in practice this resolves in milliseconds.
        setTimeout(() => { if (this.authResolving) { this.authResolving = false; this.emit(); } }, 8000);
        authOnChange((email, event) => {
          // Password reset: land on the "set a new password" screen instead of
          // binding straight into the app (or bouncing to login).
          if (event === "PASSWORD_RECOVERY") { this.recoveryPending = true; this.authResolving = false; this.emit(); return; }
          if (this.recoveryPending) {
            // Stay on the reset screen until the new password is saved (USER_UPDATED).
            if (event === "USER_UPDATED" && email) { this.recoveryPending = false; void this.reloadThenBind(email); }
            return;
          }
          if (email) void this.reloadThenBind(email); else this.unbindAuth();
        });
      } else if (typeof window !== "undefined") {
        // No auth client (mock, or keys missing) — nothing will ever resolve,
        // so the splash must not wait for it.
        this.authResolving = false;
        // Mock mode: accept an invite link directly (no password).
        const tok = new URLSearchParams(window.location.search).get("invite");
        if (tok && this.acceptInvite(tok)) {
          const url = new URL(window.location.href);
          url.searchParams.delete("invite");
          window.history.replaceState({}, "", url.toString());
        }
      }
      this.emit();
    });
    this.backend.onRemoteDB((db) => {
      this.db = db;
      this.emit();
    });
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // Visible confirmation that a save landed. The UI registers one handler (the
  // <Toaster/>); the store just announces "something saved" on a short debounce
  // so a burst of edits collapses into one toast. Label lets a send read
  // "Message sent" instead of the generic "Saved".
  private toastHandler: ((text: string, tone?: ToastTone) => void) | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastLabel = "Saved";
  setToastHandler(cb: ((text: string, tone?: ToastTone) => void) | null) { this.toastHandler = cb; }
  private announceSave(label: string) {
    if (!this.toastHandler) return; // nothing registered yet (pre-mount / SSR)
    this.toastLabel = label;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      this.toastHandler?.(this.toastLabel);
      this.toastLabel = "Saved";
    }, 350);
  }

  /** A write that never landed. The change is still on screen and still in
   *  memory, but it is not on the server — so this cancels the pending "Saved"
   *  rather than letting it contradict the truth. */
  private announceSaveFailed(err: unknown) {
    if (this.toastTimer) { clearTimeout(this.toastTimer); this.toastTimer = null; }
    this.toastLabel = "Saved";
    this.saveError = err instanceof Error ? err.message : String(err);
    this.toastHandler?.("Not saved — you're offline or the server refused. Keep this tab open and try again.", "error");
    this.emit();
  }

  /** Message from the last failed write, or null. Cleared by the next success. */
  saveError: string | null = null;

  private mutate(fn: (db: DB) => void, saveLabel = "Saved") {
    this.undoStack.push(JSON.stringify(this.db));
    if (this.undoStack.length > 40) this.undoStack.shift();
    const next = clone(this.db);
    fn(next);
    this.db = next;
    // persistDB may be sync (mock) or async (Supabase); either can fail, and a
    // failure must reach the person who just typed something. Writes chain in
    // order — a burst of edits cannot land out of sequence.
    const run = async () => {
      await this.backend?.persistDB(next);
      if (this.saveError) { this.saveError = null; this.emit(); }
    };
    this.lastWrite = this.lastWrite.catch(() => undefined).then(run);
    this.lastWrite.catch((e: unknown) => this.announceSaveFailed(e));
    this.announceSave(saveLabel);
    this.emit();
  }

  /** A write that is bookkeeping, not authorship: no undo entry, no toast, and
   *  never a whole-document overwrite. The mutation is re-applied to a FRESH
   *  copy of the stored row (fetch → apply → write), so opening a chat cannot
   *  clobber a message somebody else sent seconds ago. A failure stays quiet
   *  and rolls the local change back — the UI never claims a receipt or a
   *  reaction that did not land, and nobody gets a "Not saved" scare for an
   *  action they never took. */
  private mutateQuiet(fn: (db: DB) => void) {
    const prev = this.db;
    const next = clone(prev);
    fn(next);
    this.db = next;
    this.emit();
    const run = async () => {
      if (this.backend?.patchDB) await this.backend.patchDB(fn);
      else if (this.backend) await this.backend.persistDB(next);
    };
    // Chained behind whatever write is in flight, so order is preserved.
    this.lastWrite = this.lastWrite.catch(() => undefined).then(run);
    this.lastWrite.catch(() => {
      // Roll back only if nothing else has moved local state since.
      if (this.db === next) { this.db = prev; this.emit(); }
    });
  }

  private lastWrite: Promise<unknown> = Promise.resolve();
  /** Wait for the most recent write to reach the backend. Needed before a
   *  server route reads the project — e.g. inviting someone, where /api/invite
   *  checks they're on the project before it will email them. */
  async flush(): Promise<void> { try { await this.lastWrite; } catch { /* the store surfaces write errors itself */ } }

  // ---- Global undo (all tabs) ----
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  undo() {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    const restored = JSON.parse(prev) as DB;
    // Bookkeeping survives an undo: read receipts, pins and subjects were
    // never part of the action being reverted, so the snapshot must not drag
    // them backwards. (Reactions live inside messages and do get caught by a
    // snapshot restore — accepted; a reaction is one tap to redo.)
    restored.convMeta = this.db.convMeta;
    // Published field updates survive too: they are immutable, numbered, and
    // already emailed — a snapshot that predates one must not delete it (the
    // emailed links would die and the number would be reissued). Their
    // Messages chips ride along for the same reason.
    if (this.db.fieldUpdates?.length) {
      restored.fieldUpdates = this.db.fieldUpdates;
      const have = new Set((restored.updates ?? []).map((m) => m.id));
      const chips = (this.db.updates ?? []).filter((m) => m.context?.kind === "field" && !have.has(m.id));
      if (chips.length) restored.updates = [...chips, ...restored.updates];
    }
    this.db = restored;
    // An undo that doesn't reach the server is as silent a loss as a save that
    // doesn't, and it looks worse: the change appears to come back on screen.
    const run = async () => {
      await this.backend?.persistDB(this.db);
      if (this.saveError) { this.saveError = null; this.emit(); }
    };
    this.lastWrite = this.lastWrite.catch(() => undefined).then(run);
    this.lastWrite.catch((e: unknown) => this.announceSaveFailed(e));
    this.emit();
  }

  // ---- Session ----
  get currentUser(): User | undefined {
    // Synthetic QA personas ("view as a role no one holds yet") aren't in
    // db.users — build a stand-in so all role/trade logic behaves naturally.
    if (this.session.userId.startsWith("persona:")) {
      const [, role, trades] = this.session.userId.split(":");
      return {
        id: this.session.userId,
        name: this.session.displayName,
        email: "qa-persona@example.invalid",
        role: role as Role,
        tradeIds: trades ? trades.split(",") : undefined,
        status: "active",
      };
    }
    return this.db.users.find((u) => u.id === this.session.userId);
  }

  // ---- "View as" (QA impersonation for full admins) -------------------------
  /** The admin's REAL session, parked while viewing as another persona. Memory
   *  only — the persisted session stays the admin's, so a refresh always lands
   *  back on Full Admin. */
  viewAsBase: Session | null = null;
  get isViewingAs(): boolean { return this.viewAsBase !== null; }

  private startViewAs(u: User | undefined) {
    if (!u) return;
    if (!this.viewAsBase) {
      if (this.session.role !== "full_admin") return; // only full admins may impersonate
      this.viewAsBase = { ...this.session };
    }
    this.session = { ...this.session, role: u.role, userId: u.id, displayName: u.name };
    void this.backend?.persistSession(this.viewAsBase); // persist the ADMIN session
    this.emit();
  }
  /** View the app exactly as a specific person (their role + per-user access). */
  viewAsUser(userId: string) {
    this.startViewAs(this.db.users.find((x) => x.id === userId));
  }
  /** View the app as a ROLE that may not be assigned to anyone yet — QA a
   *  persona before inviting a person into it. tradeIds lets the generic
   *  "trade"/"architect" personas exercise trade-scoped views. */
  viewAsPersona(role: Role, displayName: string, tradeIds?: string[]) {
    if (!this.viewAsBase) {
      if (this.session.role !== "full_admin") return; // only full admins may impersonate
      this.viewAsBase = { ...this.session };
    }
    const userId = `persona:${role}:${(tradeIds ?? []).join(",")}`;
    this.session = { ...this.session, role, userId, displayName };
    void this.backend?.persistSession(this.viewAsBase); // persist the ADMIN session
    this.emit();
  }
  /** Return to the real Full Admin session. */
  endViewAs() {
    if (!this.viewAsBase) return;
    this.session = this.viewAsBase;
    this.viewAsBase = null;
    void this.backend?.persistSession(this.session);
    this.emit();
  }
  // ---- Auth (app-level; graduates to Supabase Auth later) ----
  private enter(u: User) {
    this.session = { role: u.role, userId: u.id, displayName: u.name, authed: true };
    void this.backend?.persistSession(this.session);
    this.emit();
  }
  /** Log in by email — must match a non-invited account. */
  login(email: string): { ok: boolean; error?: string } {
    const u = this.db.users.find((x) => x.email.trim().toLowerCase() === email.trim().toLowerCase());
    if (!u) return { ok: false, error: "No account with that email. Ask an admin to invite you, or request access." };
    if (u.disabled) return { ok: false, error: "This account's access has been suspended. Ask the project admin to restore it." };
    if (u.status === "invited") return { ok: false, error: "You have a pending invite — use your invite link to finish setting up." };
    this.enter(u);
    return { ok: true };
  }
  /** Demo / impersonation sign-in straight to a known user. */
  loginAs(userId: string) {
    const u = this.db.users.find((x) => x.id === userId);
    if (u) this.enter(u);
  }
  /** Self-signup → creates a pending viewer and signs them in. */
  signup(name: string, email: string): { ok: boolean; error?: string } {
    if (!name.trim() || !email.trim()) return { ok: false, error: "Name and email required." };
    if (this.db.users.some((x) => x.email.trim().toLowerCase() === email.trim().toLowerCase())) return { ok: false, error: "That email already has an account — log in instead." };
    const u: User = { id: newId("u"), name: name.trim(), email: email.trim(), role: "viewer", status: "pending" };
    this.mutate((db) => { db.users.push(u); });
    this.enter(u);
    return { ok: true };
  }
  logout() {
    this.session = { ...this.session, authed: false };
    this.authNoAccess = null;
    this.viewAsBase = null;
    void this.backend?.persistSession(this.session);
    void authSignOut();
    this.emit();
  }

  /** Read the project again now that a session exists, THEN bind.
   *
   *  The first load happens before anyone has signed in. While the table allows
   *  anonymous reads that is harmless, but it must not be the only read: the
   *  moment the database requires a JWT, an unauthenticated first load returns
   *  nothing and binding against an empty roster would lock everyone out of
   *  their own project. */
  private async reloadThenBind(email: string) {
    try {
      const fresh = await this.backend?.loadDB();
      if (fresh) this.db = fresh;
    } catch { /* keep whatever we already have and let the bind decide */ }
    this.loading = false;
    this.bindAuthEmail(email);
  }

  /** Is this email on the project (invited or active)? Gates invite-only signup. */
  isKnownEmail(email: string): boolean {
    const e = email.trim().toLowerCase();
    return this.db.users.some((u) => u.email.trim().toLowerCase() === e);
  }
  /** Bind a verified Supabase session to its app user (role/permissions). */
  bindAuthEmail(email: string): boolean {
    // Whatever the outcome, auth has answered — the splash stands down.
    this.authResolving = false;
    const u = this.db.users.find((x) => x.email.trim().toLowerCase() === email.trim().toLowerCase());
    if (!u) { this.session = { ...this.session, authed: false }; this.authNoAccess = email; this.emit(); return false; }
    // Suspended accounts keep their history but can't get in.
    if (u.disabled) { this.session = { ...this.session, authed: false }; this.authNoAccess = email; this.emit(); return false; }
    if (u.status === "invited") this.mutate((db) => { const x = db.users.find((y) => y.id === u.id); if (x) { x.status = "active"; x.inviteToken = undefined; } });
    const fresh = this.db.users.find((x) => x.id === u.id)!;
    this.session = { role: fresh.role, userId: fresh.id, displayName: fresh.name, authed: true };
    this.authNoAccess = null;
    this.viewAsBase = null; // fresh identity — drop any QA impersonation
    void this.backend?.persistSession(this.session);
    this.emit();
    return true;
  }
  unbindAuth() {
    // A definitive "no session" — the login screen is now the honest answer.
    this.authResolving = false;
    this.session = { ...this.session, authed: false };
    this.emit();
  }

  /** Finish a password reset: set the new password on the recovery session, then
   *  bind into the app. Called from the "set a new password" screen. */
  async completePasswordReset(password: string): Promise<{ ok: boolean; error?: string }> {
    const r = await authUpdatePassword(password);
    if (!r.ok) return r;
    this.recoveryPending = false;
    // strip the recovery hash/query so a refresh doesn't re-trigger the flow
    if (typeof window !== "undefined") { try { window.history.replaceState(null, "", window.location.pathname); } catch { /* ignore */ } }
    const email = await authCurrentEmail();
    if (email) this.bindAuthEmail(email); else this.emit();
    return { ok: true };
  }

  /** Invite a user; returns the invite token for a shareable link. */
  inviteUser(u: { name: string; email: string; role: Role; tradeIds?: string[]; managedBy?: "builder" | "owner" }): string {
    const token = `inv-${Math.random().toString(36).slice(2, 10)}`;
    // Non-admins can only invite trades (never invite someone in as a higher role).
    const role: Role = this.canManageAccess ? u.role : "trade";
    const managedBy = role === "trade" ? (u.managedBy ?? "builder") : undefined;
    this.mutate((db) => { db.users.push({ id: newId("u"), name: u.name.trim(), email: u.email.trim(), role, tradeIds: u.tradeIds, managedBy, status: "invited", inviteToken: token }); });
    return token;
  }
  /** Accept an invite (from the link) → activates the account and signs in. */
  acceptInvite(token: string): boolean {
    const u = this.db.users.find((x) => x.inviteToken === token);
    if (!u) return false;
    this.mutate((db) => { const x = db.users.find((y) => y.id === u.id); if (x) { x.status = "active"; x.inviteToken = undefined; } });
    const fresh = this.db.users.find((x) => x.id === u.id);
    if (fresh) this.enter(fresh);
    return true;
  }
  approveUser(userId: string) {
    if (this.session.role !== "full_admin") return;
    this.mutate((db) => { const u = db.users.find((x) => x.id === userId); if (u) u.status = "active"; });
  }

  async reset() {
    const db = (await this.backend?.reset()) ?? buildDB();
    this.db = db;
    this.emit();
  }

  // ---- Rooms ----
  roomNameExists(name: string): boolean {
    const n = name.trim().toLowerCase();
    return this.db.rooms.some((r) => r.name.trim().toLowerCase() === n);
  }
  /** Add a room (shared across Admin + Building Costs). No duplicate names. */
  addRoom(name: string, floor: Room["floor"]): boolean {
    if (!name.trim() || this.roomNameExists(name)) return false;
    this.mutate((db) => {
      db.rooms.push({ id: newId("room"), name: name.trim(), floor, custom: true });
    });
    return true;
  }
  renameRoom(id: string, name: string) {
    this.mutate((db) => {
      const r = db.rooms.find((x) => x.id === id);
      if (r) r.name = name;
    });
  }
  removeRoom(id: string) {
    this.mutate((db) => {
      db.rooms = db.rooms.filter((r) => r.id !== id);
      db.scope = db.scope.filter((c) => c.roomId !== id);
      db.costLines.forEach((l) => (l.roomIds = l.roomIds.filter((r) => r !== id)));
    });
  }

  // ---- Scope matrix ----
  scopeClipboard: { status: ScopeStatus; items: { label: string; included: boolean }[] } | null = null;

  private ensureCell(db: DB, roomId: string, tradeId: string) {
    let cell = db.scope.find((c) => c.roomId === roomId && c.tradeId === tradeId);
    if (!cell) {
      const tpl = db.scopeTemplates.find((t) => t.tradeId === tradeId);
      cell = {
        roomId,
        tradeId,
        status: "unset",
        items: (tpl?.items ?? []).map((label, i) => ({ id: `si-${tradeId}-${roomId}-${i}`, label, included: false })),
      };
      db.scope.push(cell);
    }
    return cell;
  }

  setScopeStatus(roomId: string, tradeId: string, status: ScopeStatus) {
    this.mutate((db) => {
      const apply = (rid: string) => {
        const cell = this.ensureCell(db, rid, tradeId);
        cell.status = status;
        cell.items.forEach((it) => (it.included = status === "in"));
      };
      apply(roomId);
      // Selecting "Whole House" cascades to every other room for this trade.
      if (roomId === "whole-house") db.rooms.forEach((r) => { if (r.id !== "whole-house") apply(r.id); });
    });
  }

  // Copy / paste a cell's status + items.
  copyScopeCell(roomId: string, tradeId: string) {
    const cell = this.db.scope.find((c) => c.roomId === roomId && c.tradeId === tradeId);
    this.scopeClipboard = cell
      ? { status: cell.status, items: cell.items.map((i) => ({ label: i.label, included: i.included })) }
      : { status: "unset", items: [] };
    this.emit();
  }
  pasteScopeCell(roomId: string, tradeId: string) {
    if (!this.scopeClipboard) return;
    const clip = this.scopeClipboard;
    this.mutate((db) => {
      const cell = this.ensureCell(db, roomId, tradeId);
      cell.status = clip.status;
      cell.items = clip.items.map((it, i) => ({ id: `si-${tradeId}-${roomId}-${i}`, label: it.label, included: it.included }));
    });
  }

  toggleScopeItem(roomId: string, tradeId: string, itemId: string) {
    this.mutate((db) => {
      const cell = this.ensureCell(db, roomId, tradeId);
      const it = cell.items.find((x) => x.id === itemId);
      if (it) it.included = !it.included;
    });
  }

  addScopeItem(roomId: string, tradeId: string, label: string) {
    this.mutate((db) => {
      const cell = this.ensureCell(db, roomId, tradeId);
      cell.items.push({ id: newId("si"), label, included: cell.status === "in" });
    });
  }

  /** Toggle a scope item (by label) across a cluster of rooms at once. */
  setScopeItemForRooms(roomIds: string[], tradeId: string, label: string, included: boolean) {
    this.mutate((db) => {
      roomIds.forEach((rid) => {
        const cell = this.ensureCell(db, rid, tradeId);
        const it = cell.items.find((x) => x.label === label);
        if (it) it.included = included;
        else cell.items.push({ id: `si-${tradeId}-${rid}-${cell.items.length}`, label, included });
      });
    });
  }
  /** Add a new scope item (by label) to a cluster of rooms. */
  addScopeItemForRooms(roomIds: string[], tradeId: string, label: string) {
    this.mutate((db) => {
      roomIds.forEach((rid) => {
        const cell = this.ensureCell(db, rid, tradeId);
        if (!cell.items.some((x) => x.label === label)) cell.items.push({ id: `si-${tradeId}-${rid}-${cell.items.length}`, label, included: cell.status === "in" });
      });
    });
  }

  signoffScopeItem(roomId: string, tradeId: string, itemId: string, party: "owner" | "builder", name: string) {
    this.mutate((db) => {
      const cell = this.ensureCell(db, roomId, tradeId);
      const it = cell.items.find((x) => x.id === itemId);
      if (!it) return;
      const now = new Date().toISOString();
      if (party === "owner") {
        it.ownerSignedBy = it.ownerSignedBy ? undefined : name;
        it.ownerSignedAt = it.ownerSignedBy ? now : undefined;
      } else {
        it.builderSignedBy = it.builderSignedBy ? undefined : name;
        it.builderSignedAt = it.builderSignedBy ? now : undefined;
      }
      it.done = !!it.ownerSignedBy && !!it.builderSignedBy;
    });
  }

  /** Apply a trade's status to every room. */
  applyScopeToAll(tradeId: string, status: ScopeStatus) {
    this.mutate((db) => {
      db.rooms.forEach((r) => {
        const cell = this.ensureCell(db, r.id, tradeId);
        cell.status = status;
        cell.items.forEach((it) => (it.included = status === "in"));
      });
    });
  }

  /** Copy a (room, trade) cell to a set of target rooms. */
  copyScopeToRooms(fromRoomId: string, tradeId: string, toRoomIds: string[]) {
    this.mutate((db) => {
      const src = this.ensureCell(db, fromRoomId, tradeId);
      toRoomIds.forEach((roomId) => {
        const cell = this.ensureCell(db, roomId, tradeId);
        cell.status = src.status;
        cell.items = src.items.map((it) => ({ ...it, id: `si-${tradeId}-${roomId}-${it.label}`, ownerSignedBy: undefined, ownerSignedAt: undefined, builderSignedBy: undefined, builderSignedAt: undefined, done: false }));
      });
    });
  }

  // ---- Users & access ----
  /** Only a Full Admin may change access rights (roles, module permissions, managedBy). */
  private get canManageAccess(): boolean {
    return this.session.role === "full_admin";
  }
  /** Suspend / restore someone's access without deleting them or their history. */
  setUserDisabled(userId: string, disabled: boolean) {
    if (!this.canManageAccess) return;
    if (userId === this.session.userId) return; // never lock yourself out
    this.mutate((db) => { const u = db.users.find((x) => x.id === userId); if (u) u.disabled = disabled || undefined; });
  }
  setUserAccess(userId: string, mod: ModuleKey, level: AccessLevel) {
    if (!this.canManageAccess) return;
    this.mutate((db) => {
      const u = db.users.find((x) => x.id === userId);
      if (!u) return;
      u.access = { ...(u.access ?? {}), [mod]: level };
    });
  }
  setDoorCode(userId: string, code: string) {
    this.mutate((db) => {
      const u = db.users.find((x) => x.id === userId);
      if (u) u.doorCode = code;
    });
  }
  updateUser(userId: string, patch: Partial<User>) {
    // Non-admins can edit profile fields but never role/permissions/management.
    const safe = { ...patch };
    if (!this.canManageAccess) { delete safe.role; delete safe.access; delete safe.managedBy; }
    if (!Object.keys(safe).length) return;
    this.mutate((db) => {
      const u = db.users.find((x) => x.id === userId);
      if (u) Object.assign(u, safe);
    });
  }
  addUser(u: Omit<User, "id">) {
    // Non-admins can only create trade accounts (no privilege escalation via add/invite).
    const clamped = this.canManageAccess ? u : { ...u, role: "trade" as const, managedBy: (u.managedBy ?? "builder") as "builder" | "owner" };
    this.mutate((db) => {
      db.users.push({ id: newId("u"), ...clamped });
    });
  }
  removeUser(userId: string) {
    this.mutate((db) => {
      db.users = db.users.filter((u) => u.id !== userId);
      // Unassign from any schedule tasks they owned.
      db.schedule.forEach((s) => { if (s.assignedUserId === userId) s.assignedUserId = undefined; });
    });
  }
  addContact(userId: string, c: Omit<Contact, "id">) {
    this.mutate((db) => {
      const u = db.users.find((x) => x.id === userId);
      if (u) u.secondaryContacts = [...(u.secondaryContacts ?? []), { id: newId("c"), ...c }];
    });
  }
  updateContact(userId: string, contactId: string, patch: Partial<Contact>) {
    this.mutate((db) => {
      const c = db.users.find((x) => x.id === userId)?.secondaryContacts?.find((x) => x.id === contactId);
      if (c) Object.assign(c, patch);
    });
  }
  removeContact(userId: string, contactId: string) {
    this.mutate((db) => {
      const u = db.users.find((x) => x.id === userId);
      if (u?.secondaryContacts) u.secondaryContacts = u.secondaryContacts.filter((c) => c.id !== contactId);
    });
  }

  // ---- Building costs ----
  updateCostLine(id: string, patch: Partial<CostLine>) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === id);
      if (l) Object.assign(l, patch);
    });
  }
  addPricePoint(id: string, point: PricePoint) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === id);
      if (l) l.history.push(point);
    });
  }
  /** Lock a line's cost (builder / full admin only). Sets the agreed cost, marks it
   *  contracted, and pushes it to the trade's vendor contract. After this, changes
   *  must flow through change orders. `baseCost` is the pre-markup (Oasis) cost. */
  lockLineCost(id: string, baseCost: number) {
    if (!["builder", "full_admin"].includes(this.session.role)) return;
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === id);
      if (!l || baseCost <= 0) return;
      const factor = l.markupModel === "passthrough" ? 1 + l.markupPct / 100 : 1;
      l.lockedCost = baseCost;
      l.baseline = baseCost * factor;
      l.locked = true;
      l.lockedAt = new Date().toISOString().slice(0, 10);
      l.lockedBy = this.session.displayName;
      if (l.status === "estimate" || l.status === "allowance") l.status = "contracted";
      l.contractSummary = `Locked at ${new Date().toISOString().slice(0, 10)} — $${Math.round(baseCost * factor).toLocaleString()} (incl. markup). Pushed to ${l.tradeId ? (db.trades.find((t) => t.id === l.tradeId)?.name ?? "trade") : "vendor"} contract. Changes via change order.`;
      const tradeUser = l.tradeId ? db.users.find((u) => u.tradeIds?.includes(l.tradeId!)) : undefined;
      this.notify(db, { toUserId: tradeUser?.id, toRole: tradeUser ? undefined : "builder", kind: "info", module: "vendors", message: `🔒 "${l.name}" cost locked & added to the vendor contract.` });
    });
  }
  /** Reopen a locked line (full admin only) — for corrections before a CO is needed. */
  unlockLineCost(id: string) {
    if (this.session.role !== "full_admin") return;
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === id);
      if (!l) return;
      l.locked = false; l.lockedCost = undefined; l.lockedAt = undefined; l.lockedBy = undefined; l.baseline = undefined;
      if (l.status === "contracted" && (l.allowanceLow != null)) l.status = "allowance";
    });
  }
  /** Record a direct (outside-draw) payment on a line. */
  setLineDirectPaid(id: string, amount: number, note?: string) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === id);
      if (!l) return;
      l.directPaid = Math.max(0, amount);
      l.directPaidDate = amount > 0 ? new Date().toISOString().slice(0, 10) : undefined;
      if (note !== undefined) l.directPaidNote = note || undefined;
    });
  }
  toggleRoomOnLine(id: string, roomId: string) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === id);
      if (!l) return;
      l.roomIds = l.roomIds.includes(roomId) ? l.roomIds.filter((r) => r !== roomId) : [...l.roomIds, roomId];
    });
  }
  addCostLine(l: Omit<CostLine, "id" | "changeOrders" | "phases"> & Partial<Pick<CostLine, "changeOrders" | "phases">>) {
    this.mutate((db) => {
      db.costLines.push({ id: newId("cl"), changeOrders: [], phases: [], ...l });
    });
  }
  removeCostLine(id: string) {
    this.mutate((db) => {
      db.costLines = db.costLines.filter((l) => l.id !== id);
    });
  }

  // ---- Baseline lock ----
  /** Lock every line's current total as its baseline (original budget). */
  lockBaseline() {
    this.mutate((db) => {
      db.costLines.forEach((l) => {
        l.baseline = lineTotal(l);
        l.locked = true;
        if (!l.contractSummary) l.contractSummary = l.desc;
        if (l.termsAppended === undefined) l.termsAppended = true;
      });
    });
  }
  unlockLine(id: string) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === id);
      if (l) { l.locked = false; }
    });
  }

  // ---- Per-line contract doc ----
  setLineContract(id: string, patch: Pick<Partial<CostLine>, "contractSummary" | "contractMode" | "termsAppended">) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === id);
      if (l) Object.assign(l, patch);
    });
  }

  // ---- Change orders (contract exhibits) ----
  /** Returns the new change order's id so the caller can carry it straight
   *  onto the contract without hunting for it again. */
  addChangeOrder(lineId: string, co: Omit<ChangeOrder, "id" | "exhibit">): string | undefined {
    let out: string | undefined;
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      if (!l) return;
      // Lettered from the highest letter already used, not from the count:
      // deleting Exhibit B and adding another would otherwise hand out a second
      // Exhibit B, and two exhibits with one name is a contract dispute.
      const used = l.changeOrders.map((c) => c.exhibit.match(/Exhibit ([A-Z])/)?.[1] ?? "@")
        .reduce((a, c) => (c > a ? c : a), "@");
      const next = String.fromCharCode(Math.max(used.charCodeAt(0) + 1, 65));
      const exhibit = `Exhibit ${next > "Z" ? `${l.changeOrders.length + 1}` : next}`;
      out = newId("co");
      l.changeOrders.push({ id: out, exhibit, ...co });
    });
    return out;
  }
  updateChangeOrder(lineId: string, coId: string, patch: Partial<ChangeOrder>) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      const co = l?.changeOrders.find((c) => c.id === coId);
      if (co) Object.assign(co, patch);
    });
  }
  removeChangeOrder(lineId: string, coId: string) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      if (l) l.changeOrders = l.changeOrders.filter((c) => c.id !== coId);
    });
  }

  // ---- Line phases (capped at the line's current total) ----
  private phasesOther(line: CostLine, exceptId?: string): number {
    return line.phases.filter((p) => p.id !== exceptId).reduce((a, p) => a + phaseAmount(line, p), 0);
  }
  addLinePhase(lineId: string, phase: Omit<LinePhase, "id">) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      if (!l) return;
      const p: LinePhase = { id: newId("ph"), ...phase };
      // Clamp so the sum of phases never exceeds the line's current total.
      const cap = lineCurrent(l) - this.phasesOther(l);
      if (phaseAmount(l, p) > cap) p.value = p.mode === "pct" ? Math.max(0, (cap / lineCurrent(l)) * 100) : Math.max(0, cap);
      l.phases.push(p);
    });
  }
  updateLinePhase(lineId: string, phaseId: string, patch: Partial<LinePhase>) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      const p = l?.phases.find((x) => x.id === phaseId);
      if (!l || !p) return;
      Object.assign(p, patch);
      // Enforce: sum of phases never exceeds the line's current total.
      const cap = lineCurrent(l) - this.phasesOther(l, phaseId);
      if (phaseAmount(l, p) > cap) {
        p.value = p.mode === "pct" ? Math.max(0, (cap / lineCurrent(l)) * 100) : Math.max(0, cap);
      }
    });
  }
  removeLinePhase(lineId: string, phaseId: string) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      if (l) l.phases = l.phases.filter((p) => p.id !== phaseId);
    });
  }

  // ---- Draws (Payment Tracker — budget allocations) ----
  addDraw(name: string) {
    this.mutate((db) => { db.draws.push({ id: newId("draw"), name, allocations: [], status: "planned" }); });
  }
  renameDraw(id: string, name: string) {
    this.mutate((db) => { const d = db.draws.find((x) => x.id === id); if (d) d.name = name; });
  }
  removeDraw(id: string) {
    this.mutate((db) => { db.draws = db.draws.filter((d) => d.id !== id); });
  }
  setDrawStatus(id: string, status: Draw["status"]) {
    // Draw Management is the builder's module (the owner's role has no access
    // to it at all — decision 03). So these three states are the builder
    // RECORDING where the draw stands with the client, not the client
    // operating a gate in here. Recording an approval is not granting one.
    if (!["full_admin", "owner", "builder"].includes(this.session.role)) return;
    const today = new Date().toISOString().slice(0, 10);
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === id);
      if (!d) return;
      if (d.status === "paid" && status !== "paid") return; // paid is final
      d.status = status;
      if (status === "pushed") {
        d.approvedBy = this.session.displayName; // who recorded it
        d.approvedDate = today;
        d.pushedDate = d.pushedDate ?? today;
        this.notify(db, { toRole: "builder", kind: "info", module: "payments", message: `✓ "${d.name}" is client-approved — ready to be paid.` });
      }
      if (status === "paid") d.paidDate = d.paidDate ?? today;
      if (status === "planned") { d.approvedBy = undefined; d.approvedDate = undefined; }
    }, status === "pushed" ? "Approved draw" : status === "paid" ? "Marked draw paid" : "Draw back to saved");
  }

  /** Drop a budget line into a draw (default 0% allocation). Skips paid draws. */
  addAllocation(drawId: string, lineId: string, mode: "pct" | "flat" = "pct", value = 0) {
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      if (!d || d.status === "paid") return;
      // A line opens up when its contract is signed — the same gate the drag
      // handle uses, so the two cannot disagree.
      const line = db.costLines.find((l) => l.id === lineId);
      if (!line || !lineDrawable(db, line)) return;
      if (d.allocations.some((a) => a.lineId === lineId)) return;
      // What this draw finishes starts as whatever the package priced and no
      // other draw has claimed. The GC adjusts it; they do not build it.
      d.allocations.push({ lineId, mode, value, includedScope: uncoveredScopeFor(db, line, drawId) });
    }, "Added to the draw");
  }

  /** One open draw means there is nothing to choose between, so a tap on the
   *  line is the whole gesture. Undo is in the toast, as with any mutation. */
  addAllocationToFirstOpenDraw(lineId: string) {
    const open = this.db.draws.find((d) => d.status !== "paid");
    if (open) this.addAllocation(open.id, lineId);
  }
  setAllocation(drawId: string, lineId: string, patch: Partial<{ mode: "pct" | "flat"; value: number; note: string }>) {
    this.mutate((db) => {
      const a = db.draws.find((x) => x.id === drawId)?.allocations.find((y) => y.lineId === lineId);
      if (a) Object.assign(a, patch);
    });
  }
  /** Tick which scope-item labels of a line are covered by this draw allocation. */
  toggleAllocationScope(drawId: string, lineId: string, label: string, on: boolean) {
    this.mutate((db) => {
      const a = db.draws.find((x) => x.id === drawId)?.allocations.find((y) => y.lineId === lineId);
      if (!a) return;
      const set = new Set(a.includedScope ?? []);
      if (on) set.add(label); else set.delete(label);
      a.includedScope = [...set];
    });
  }
  setDrawNote(drawId: string, note: string) {
    this.mutate((db) => { const d = db.draws.find((x) => x.id === drawId); if (d) d.note = note; });
  }
  removeAllocation(drawId: string, lineId: string) {
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      if (d && d.status !== "paid") d.allocations = d.allocations.filter((a) => a.lineId !== lineId);
    });
  }
  /** Push a draw → create the first round of trade contracts for its lines. */

  // ---- Schedule: add new timeline items (owner / builder / full admin) ----
  addScheduleItem(item: { label: string; kind: ScheduleItem["kind"]; tradeId?: string; start: string; end: string; deps?: string[]; materialDeps?: string[]; budgetKey?: string; budgetNote?: string }) {
    if (!["full_admin", "owner", "builder"].includes(this.session.role)) return;
    if (!item.label.trim() || !item.start || !item.end) return;
    this.mutate((db) => {
      const tradeId = item.kind === "milestone" ? undefined : item.tradeId || undefined;
      const tradeUser = tradeId ? db.users.find((u) => u.tradeIds?.includes(tradeId)) : undefined;
      db.schedule.push({
        id: newId("sch"),
        label: item.label.trim(),
        kind: item.kind,
        tradeId,
        start: item.start,
        end: item.end,
        status: "not_started",
        origStart: item.start,
        origEnd: item.end,
        deps: item.deps?.length ? item.deps : undefined,
        materialDeps: item.materialDeps?.length ? item.materialDeps : undefined,
        // Work is spend against a line that was agreed, so the task names it.
        budgetKey: item.budgetKey || undefined,
        budgetNote: item.budgetNote?.trim() || undefined,
        assignedUserId: tradeUser?.id,
        // A trade on the hook must confirm the proposed dates, same as edits.
        confirm: tradeUser ? "pending" : "confirmed",
        ...(tradeUser ? {} : { confirmedStart: item.start, confirmedEnd: item.end }),
      });
      if (tradeUser) this.notify(db, { toUserId: tradeUser.id, kind: "info", module: "timing", message: `📅 New task "${item.label.trim()}" proposed ${item.start} → ${item.end}. Please confirm in Timing.` });
    });
  }

  /** Move a Gantt row up/down in the display order (builder/full admin). */
  moveScheduleItem(id: string, dir: -1 | 1) {
    if (!["builder", "full_admin"].includes(this.session.role)) return;
    this.mutate((db) => {
      const i = db.schedule.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= db.schedule.length) return;
      [db.schedule[i], db.schedule[j]] = [db.schedule[j], db.schedule[i]];
    });
  }

  // ---- Materials ----
  addMaterial(mat: Omit<Material, "id">) {
    this.mutate((db) => { db.materials.push({ id: newId("mat"), ...mat }); });
  }
  updateMaterial(id: string, patch: Partial<Material>) {
    this.mutate((db) => { const m = db.materials.find((x) => x.id === id); if (m) Object.assign(m, patch); });
  }
  removeMaterial(id: string) {
    this.mutate((db) => { db.materials = db.materials.filter((m) => m.id !== id); });
  }
  bulkAssignPurchaser(ids: string[], purchaser: Material["purchaser"]) {
    this.mutate((db) => { db.materials.forEach((m) => { if (ids.includes(m.id)) m.purchaser = purchaser; }); });
  }
  bulkSetMaterialStatus(ids: string[], status: Material["status"]) {
    this.mutate((db) => { db.materials.forEach((m) => { if (ids.includes(m.id)) m.status = status; }); });
  }
  /** Tie one timing item to many materials at once (single undo step). */
  bulkSetMaterialTie(ids: string[], linkedScheduleId?: string) {
    this.mutate((db) => { db.materials.forEach((m) => { if (ids.includes(m.id)) m.linkedScheduleId = linkedScheduleId; }); });
  }
  /** The owner signs off (or revokes) a material selection. The designer
   *  signature was retired — the designer works from drawings, not the
   *  materials list, so a second signature nobody could give left 74 of 77
   *  materials waiting on a gate that could never close. */
  setMaterialApproved(id: string, approved: boolean, by: string) {
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === id);
      if (!m) return;
      m.ownerApproved = approved;
      if (approved) m.approvalRequested = false;
      if (approved) this.notify(db, { toRole: "builder", kind: "info", module: "materials", message: `✓ ${by} approved "${m.item}".` });
    });
  }
  requestMaterialApproval(id: string, by: string) {
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === id);
      if (!m) return;
      m.approvalRequested = true;
      this.notify(db, { toRole: "owner", kind: "info", module: "materials", message: `🏠 ${by} requests owner approval for "${m.item}".` });
    });
  }
  // ---- Product options (alternates) ----
  /** Owner/builder add up to 3 alternate products for the owner + designer to compare. */
  addMaterialOption(matId: string, opt: { label: string; url?: string; price?: number; note?: string }, by: string) {
    if (!["full_admin", "owner", "builder"].includes(this.session.role)) return;
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === matId);
      if (!m || !opt.label.trim()) return;
      m.options = m.options ?? [];
      if (m.options.length >= 3) return; // 2-3 alternates max
      m.options.push({ id: newId("opt"), label: opt.label.trim(), url: opt.url?.trim() || undefined, price: opt.price, note: opt.note?.trim() || undefined, addedBy: by });
    });
  }
  updateMaterialOption(matId: string, optId: string, patch: Partial<ProductOption>) {
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === matId);
      const o = m?.options?.find((x) => x.id === optId);
      // An approved option's price is the locked cost — revoke approval to change it.
      if (!m || !o || m.approvedOptionId === optId) return;
      Object.assign(o, patch);
    });
  }
  removeMaterialOption(matId: string, optId: string) {
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === matId);
      if (!m?.options) return;
      if (m.approvedOptionId === optId) m.approvedOptionId = undefined; // removing the winner unlocks the cost
      m.options = m.options.filter((o) => o.id !== optId);
    });
  }
  /** Approve exactly ONE option per item (owner/designer/admin); approving locks
   *  its price in as the item's cost and points the spec link at the winner.
   *  Calling it on the already-approved option revokes the approval. */
  approveMaterialOption(matId: string, optId: string, by: string) {
    if (!["full_admin", "owner", "viewer"].includes(this.session.role)) return;
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === matId);
      const o = m?.options?.find((x) => x.id === optId);
      if (!m || !o) return;
      if (m.approvedOptionId === optId) {
        // revoke
        m.approvedOptionId = undefined;
        o.approved = false; o.approvedBy = undefined; o.approvedAt = undefined;
        return;
      }
      m.options!.forEach((x) => { x.approved = false; x.approvedBy = undefined; x.approvedAt = undefined; });
      o.approved = true; o.approvedBy = by; o.approvedAt = new Date().toISOString();
      m.approvedOptionId = optId;
      if (o.url) m.specLink = o.url; // downstream (spec column, previews) follows the winner
      if (m.status === "needed") m.status = "identified";
      this.notify(db, { toRole: "builder", kind: "info", message: `🛍 ${by} approved product "${o.label}" for "${m.item}"${o.price != null ? ` — cost locked at $${o.price.toLocaleString()}` : ""}.` });
    });
  }
  /** Anyone (trade/designer/builder) can request details/specs for an item. */
  requestMaterialDetails(id: string, by: string) {
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === id);
      if (!m) return;
      this.notify(db, { toRole: "builder", kind: "info", module: "materials", message: `❓ ${by} requested details for "${m.item}".` });
    });
  }

  // ---- Scope Support (pre-budget bidding) ----
  private get canManageBids(): boolean {
    return ["full_admin", "builder"].includes(this.session.role);
  }
  addBidPackage(p: {
    title: string; tradeId: string; tradeIds?: string[]; roomIds: string[]; scopeDetails: string; scopeItems?: string[];
    origin?: BidOrigin; status?: BidPackage["status"]; materialsBasis?: MaterialsBasis;
    requirements?: BidReqKey[]; targetBudget?: number; sourceDoc?: ScopeDoc; pricingBasis?: PricingBasis;
  }): string {
    const id = newId("pkg");
    if (!this.canManageBids || !p.title.trim()) return id;
    this.mutate((db) => {
      db.bidPackages.unshift({
        id, title: p.title.trim(), tradeId: p.tradeId,
        tradeIds: p.tradeIds?.length ? [...new Set(p.tradeIds)] : undefined,
        roomIds: p.roomIds,
        scopeDetails: p.scopeDetails, scopeItems: p.scopeItems?.filter((s) => s.trim()),
        origin: p.origin, status: p.status ?? "draft",
        materialsBasis: p.materialsBasis, requirements: p.requirements ?? BID_REQ_DEFAULT,
        // Default the basis rather than leaving it blank: the setup screen shows
        // "Lump sum" pre-selected, and an unwritten default reads as "Not stated"
        // in the comparison, which is worse than wrong — it's silently missing.
        pricingBasis: p.pricingBasis ?? "lump",
        targetBudget: p.targetBudget, sourceDoc: p.sourceDoc,
        createdAt: new Date().toISOString(), bids: [],
      });
    });
    return id;
  }
  /** Invite several vendor contacts onto a package at once (template send-out). */
  addBidsForContacts(packageId: string, contactIds: string[], route: BidRoute = "app") {
    if (!this.canManageBids) return;
    this.mutate((db) => {
      const p = db.bidPackages.find((x) => x.id === packageId);
      if (!p) return;
      for (const cid of contactIds) {
        const c = db.contacts.find((x) => x.id === cid);
        if (!c || p.bids.some((b) => b.contactId === cid)) continue;
        p.bids.push({ id: newId("bid"), vendorName: c.company, contactId: cid, route, at: new Date().toISOString(), status: "requested" });
      }
    });
  }
  /** The materials schedule on a bid request. Each line names who buys it, so
   *  "materials included" can never quietly mean something different to two
   *  vendors pricing the same package. */
  addScopeMaterial(packageId: string, m: { item: string; qty?: string; unit?: string; suppliedBy?: "vendor" | "owner" }) {
    if (!this.canManageBids || !m.item.trim()) return;
    this.mutate((db) => {
      const p = db.bidPackages.find((x) => x.id === packageId);
      if (!p) return;
      p.materialsList = [...(p.materialsList ?? []), {
        id: newId("mat"), item: m.item.trim(), qty: m.qty?.trim() || undefined,
        unit: m.unit?.trim() || undefined, suppliedBy: m.suppliedBy ?? "vendor",
      }];
    });
  }
  updateScopeMaterial(packageId: string, id: string, patch: Partial<ScopeMaterial>) {
    if (!this.canManageBids) return;
    this.mutate((db) => {
      const m = db.bidPackages.find((x) => x.id === packageId)?.materialsList?.find((x) => x.id === id);
      if (m) Object.assign(m, patch);
    });
  }
  removeScopeMaterial(packageId: string, id: string) {
    if (!this.canManageBids) return;
    this.mutate((db) => {
      const p = db.bidPackages.find((x) => x.id === packageId);
      if (p?.materialsList) p.materialsList = p.materialsList.filter((m) => m.id !== id);
    });
  }

  /** Shortlist is a working set on the way to an award — many, then one. */
  toggleBidShortlist(packageId: string, bidId: string) {
    if (!this.canManageBids) return;
    this.mutate((db) => {
      const b = db.bidPackages.find((x) => x.id === packageId)?.bids.find((x) => x.id === bidId);
      if (b) b.shortlisted = !b.shortlisted;
    });
  }
  /** Draft → out to vendors. */
  issueBidPackage(id: string) {
    if (!this.canManageBids) return;
    this.mutate((db) => { const p = db.bidPackages.find((x) => x.id === id); if (p && p.status === "draft") p.status = "collecting"; });
  }
  setBidScopeItems(id: string, scopeItems: string[]) {
    if (!this.canManageBids) return;
    this.mutate((db) => { const p = db.bidPackages.find((x) => x.id === id); if (p) p.scopeItems = scopeItems.filter((s) => s.trim()); });
  }
  updateBidPackage(id: string, patch: Partial<BidPackage>) {
    if (!this.canManageBids) return;
    this.mutate((db) => { const p = db.bidPackages.find((x) => x.id === id); if (p) Object.assign(p, patch); });
  }
  addBid(packageId: string, bid: { vendorName: string; contactId?: string; status?: VendorBid["status"] }) {
    if (!this.canManageBids || !bid.vendorName.trim()) return;
    this.mutate((db) => {
      const p = db.bidPackages.find((x) => x.id === packageId);
      if (!p) return;
      p.bids.push({ id: newId("bid"), vendorName: bid.vendorName.trim(), contactId: bid.contactId, at: new Date().toISOString(), status: bid.status ?? "requested" });
    });
  }
  updateBid(packageId: string, bidId: string, patch: Partial<VendorBid>) {
    if (!this.canManageBids) return;
    this.mutate((db) => {
      const b = db.bidPackages.find((x) => x.id === packageId)?.bids.find((x) => x.id === bidId);
      if (b) Object.assign(b, patch);
    });
  }
  removeBid(packageId: string, bidId: string) {
    if (!this.canManageBids) return;
    this.mutate((db) => {
      const p = db.bidPackages.find((x) => x.id === packageId);
      if (p) p.bids = p.bids.filter((b) => b.id !== bidId);
    });
  }
  addBidAttachment(packageId: string, bidId: string, att: { name: string; url: string }) {
    if (!this.canManageBids) return;
    this.mutate((db) => {
      const b = db.bidPackages.find((x) => x.id === packageId)?.bids.find((x) => x.id === bidId);
      if (b) b.attachments = [...(b.attachments ?? []), att];
    });
  }
  /** Award a bid: promote it into Project Budget — an existing ROM line for the
   *  trade gets the awarded price and locks (ROM → BUDGET), or a new contracted
   *  line is created. Returns the line id. */
  awardBid(packageId: string, bidId: string): string | undefined {
    if (!this.canManageBids) return undefined;
    let outLineId: string | undefined;
    this.mutate((db) => {
      const p = db.bidPackages.find((x) => x.id === packageId);
      const b = p?.bids.find((x) => x.id === bidId);
      if (!p || !b || b.amount == null) return;
      const today = new Date().toISOString().slice(0, 10);
      // Prefer the package's chosen line, else an unlocked ROM line for the trade.
      let line = p.lineId ? db.costLines.find((l) => l.id === p.lineId) : undefined;
      if (!line) line = db.costLines.find((l) => l.tradeId === p.tradeId && !l.locked);
      if (!line) {
        const trade = db.trades.find((t) => t.id === p.tradeId);
        line = {
          id: newId("cl"), name: p.title, tradeId: p.tradeId, category: trade?.category ?? "Soft Costs",
          owner: trade?.managedBy === "owner" ? "owner" : "builder", roomIds: p.roomIds,
          markupModel: "passthrough", markupPct: db.project.builderMarkupPct ?? 20,
          history: [], status: "estimate", changeOrders: [], phases: [],
          contractSummary: p.scopeDetails || undefined, contractMode: "appendix",
        };
        db.costLines.push(line);
      }
      // ROM → BUDGET: awarded price becomes the locked agreed cost.
      line.history.push({ label: `Awarded bid — ${b.vendorName}`, date: today, amount: b.amount });
      line.status = "contracted";
      line.locked = true;
      line.lockedCost = b.amount;
      line.lockedAt = today;
      line.lockedBy = this.session.displayName;
      line.baseline = b.amount * (line.markupModel === "passthrough" ? 1 + line.markupPct / 100 : 1);
      if (!line.desc) line.desc = (p.overview || p.scopeDetails).slice(0, 200) || undefined;
      // The five fields travel with the money. Without them the budget line knows
      // the price but not what was promised for it, and every later argument
      // about scope creep starts from scratch.
      line.awardedBid = {
        packageId: p.id, vendorName: b.vendorName,
        materialsCost: b.materialsCost, laborCost: b.laborCost,
        workingDays: b.workingDays, crewSize: b.crewSize,
        pricingBasis: b.pricingBasis ?? p.pricingBasis, at: today,
      };
      p.bids.forEach((x) => { if (x.status === "awarded") x.status = "received"; });
      b.status = "awarded";
      p.awardedBidId = b.id;
      p.status = "awarded";
      p.lineId = line.id;
      outLineId = line.id;
      this.notify(db, { toRole: "owner", kind: "info", module: "bids", message: `🏆 Bid awarded: "${p.title}" → ${b.vendorName} at $${b.amount.toLocaleString()} (now in Project Budget).` });
    });
    return outLineId;
  }

  // ---- The draw as a document ------------------------------------------------
  // A draw is a request for money. Sending it as a document the client signs
  // makes the approval a thing that exists, rather than a status somebody set.

  /** Freeze this draw into a document addressed to one client. */
  issueDrawRequest(drawId: string, toUserId: string, body: string, total: number): boolean {
    if (!["full_admin", "builder"].includes(this.session.role)) return false;
    let ok = false;
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      const to = db.users.find((u) => u.id === toUserId);
      if (!d || !to || d.status === "paid") return;
      if (!d.allocations.length) return; // nothing to ask for
      d.request = {
        body, total,
        issuedAt: new Date().toISOString(),
        issuedBy: this.session.displayName,
        toUserId: to.id, toName: to.name, toEmail: to.email,
      };
      this.notify(db, {
        toUserId: to.id, kind: "info", module: "vendors",
        message: `\u{1F4C4} Draw request "${d.name}" is ready for your signature in Contracts.`,
      });
      ok = true;
    }, "Issued the draw for signature");
    return ok;
  }

  /** Withdraw an unsigned request — the GC needs the draw editable again. */
  withdrawDrawRequest(drawId: string) {
    if (!["full_admin", "builder"].includes(this.session.role)) return;
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      if (!d?.request || d.request.signedBy) return; // a signed document stands
      d.request = undefined;
    }, "Withdrew the draw request");
  }

  markDrawRequestEmailed(drawId: string) {
    this.mutateQuiet((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      if (d?.request) d.request.emailedAt = new Date().toISOString();
    });
  }

  /** The client signs. The signature IS the approval — there is no second
   *  button that says the same thing, so the two can never disagree. */
  signDrawRequest(drawId: string, signatureImg?: string): boolean {
    const role = this.session.role;
    let ok = false;
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      if (!d?.request || d.request.signedBy) return;
      // Only the person it was addressed to. A full admin who is also the owner
      // signs as themselves, not on anyone's behalf.
      if (d.request.toUserId !== this.session.userId && role !== "full_admin") return;
      const today = new Date().toISOString().slice(0, 10);
      d.request.signedBy = this.session.displayName;
      d.request.signedAt = new Date().toISOString();
      d.request.signatureImg = signatureImg;
      d.status = "pushed";
      d.approvedBy = this.session.displayName;
      d.approvedDate = today;
      d.pushedDate = d.pushedDate ?? today;
      this.notify(db, {
        toRole: "builder", kind: "info", module: "payments",
        message: `\u2713 ${this.session.displayName} signed the draw request for "${d.name}" \u2014 ready to be paid.`,
      });
      ok = true;
    }, "Signed the draw request");
    return ok;
  }

  // ---- Feedback, filed from inside the app -----------------------------------
  // A report is only worth acting on if you know where the person was standing.
  // Nobody types that part: the seat, the device, the phase of the job and the
  // screen are attached for them.

  /** Files a report, or refuses with the reason. The refusals are the point —
   *  a one-word bug with no expectation is a guess handed to whoever fixes it. */
  fileFeedback(input: {
    kind: FeedbackKind; area: string; severity?: FeedbackSeverity;
    what: string; steps?: string; expected?: string;
    device: "phone" | "desktop"; screen: string; pkg?: string;
  }): { ok: true } | { ok: false; reason: string } {
    const what = input.what.trim();
    if (!what) return { ok: false, reason: "Nothing filed — write the one line first: what happened, or what you want." };
    if (input.kind === "bug" && !input.expected?.trim()) {
      return { ok: false, reason: "Nothing filed — a bug needs what you expected instead, or whoever fixes it is guessing." };
    }
    const db0 = this.db;
    const item: FeedbackItem = {
      id: newId("fb"),
      kind: input.kind,
      area: input.area,
      severity: input.kind === "bug" ? (input.severity ?? "annoying") : undefined,
      what,
      steps: input.steps?.trim() || undefined,
      expected: input.expected?.trim() || undefined,
      seat: `${this.session.displayName} (${ROLE_LABEL[this.session.role]})`,
      role: this.session.role,
      device: input.device,
      rom: db0.romLocked ? "ROM locked" : "ROM drafting",
      pkg: input.pkg || "no package open",
      screen: input.screen,
      filedBy: this.session.userId,
      at: new Date().toISOString(),
    };
    this.mutate((db) => {
      (db.feedback ??= []).unshift(item);
      this.notify(db, {
        toRole: "full_admin", kind: "info", module: "help",
        message: `\u{1F41B} ${FEEDBACK_KIND_LABEL[item.kind]} filed by ${this.session.displayName}: ${what.slice(0, 80)}`,
      });
    }, "Filed a report");
    return { ok: true };
  }

  removeFeedback(id: string) {
    this.mutate((db) => { db.feedback = (db.feedback ?? []).filter((x) => x.id !== id); }, "Removed a report");
  }

  /** Closing one takes it out of the brief without taking it off the record. */
  setFeedbackDone(id: string, done: boolean) {
    this.mutate((db) => {
      const x = (db.feedback ?? []).find((y) => y.id === id);
      if (x) {
        x.done = done;
        // Reopening un-archives: an archived report is one that was handled,
        // and reopening says it was not.
        if (!done) x.archivedAt = undefined;
      }
    }, done ? "Closed a report" : "Reopened a report");
  }

  /** Copying the brief IS the hand-off to Claude Code, so the copied reports
   *  archive themselves — the list empties as it is consumed and nothing is
   *  pasted twice. Only the admin does this, because only the admin sees the
   *  collection at all. */
  archiveFeedback(ids: string[]) {
    if (this.session.role !== "full_admin" || !ids.length) return;
    const at = new Date().toISOString();
    this.mutate((db) => {
      for (const x of db.feedback ?? []) {
        if (ids.includes(x.id)) { x.done = true; x.archivedAt = at; }
      }
    }, `Archived ${ids.length} report${ids.length === 1 ? "" : "s"}`);
  }

  // ---- What has changed since I last looked ----------------------------------

  /** Unread notifications addressed to me, per module. Read state is per user:
   *  a notification sent to a ROLE reaches several people, and one of them
   *  opening it must not clear it for the rest. */
  unseenByModule(): Partial<Record<ModuleKey, number>> {
    const me = this.session.userId;
    const role = this.session.role;
    const out: Partial<Record<ModuleKey, number>> = {};
    for (const n of this.db.notifications) {
      const mine = (n.toUserId && n.toUserId === me) || (n.toRole && n.toRole === role);
      if (!mine) continue;
      if (n.readBy?.includes(me)) continue;
      // Anything written before readBy existed falls back to the shared flag.
      if (!n.readBy && n.read) continue;
      const mod = n.module ?? MODULE_OF_KIND[n.kind];
      if (!mod) continue;
      out[mod] = (out[mod] ?? 0) + 1;
    }
    return out;
  }

  /** Messages I have not read, counted the same way the conversation list
   *  counts them, so the nav and the list can never disagree. */
  unreadMessages(): number {
    const me = this.session.userId;
    if (!me) return 0;
    const reads = new Map((this.db.convMeta ?? []).map((m) => [m.key, m.reads?.[me] ?? ""]));
    const byConv = new Map<string, string[]>();
    for (const u of this.db.updates) {
      const key = [...new Set([u.authorId, ...u.toUserIds])].sort().join("+");
      if (!key.includes(me)) continue;
      if (u.authorId === me) continue;
      byConv.set(key, [...(byConv.get(key) ?? []), u.at]);
      for (const r of u.replies ?? []) {
        if (r.authorId !== me) byConv.set(key, [...(byConv.get(key) ?? []), r.at]);
      }
    }
    let n = 0;
    for (const [key, ats] of byConv) {
      const since = reads.get(key) ?? "";
      n += ats.filter((at) => at > since).length;
    }
    return n;
  }

  /** Opening a module clears its count — for me, and for nobody else. */
  markModuleSeen(mod: ModuleKey) {
    const me = this.session.userId;
    const role = this.session.role;
    if (!me) return;
    const has = this.db.notifications.some((n) => {
      const mine = (n.toUserId && n.toUserId === me) || (n.toRole && n.toRole === role);
      return mine && !n.readBy?.includes(me) && !(n.readBy === undefined && n.read) && (n.module ?? MODULE_OF_KIND[n.kind]) === mod;
    });
    if (!has) return; // nothing to write, so nothing is written
    // Bookkeeping: no undo entry, no toast, and a fetch-fresh write so it cannot
    // clobber someone else's message that landed in between.
    this.mutateQuiet((db) => {
      for (const n of db.notifications) {
        const mine = (n.toUserId && n.toUserId === me) || (n.toRole && n.toRole === role);
        if (!mine) continue;
        if ((n.module ?? MODULE_OF_KIND[n.kind]) !== mod) continue;
        n.readBy = [...new Set([...(n.readBy ?? []), me])];
      }
    });
  }

  // ---- Contracts ------------------------------------------------------------
  // An award is a decision; a contract is the document that decision becomes.
  // Issuing freezes what was awarded so the signed paper cannot drift as the
  // budget line moves, and signing is what opens the line to be drawn against.

  /** Issue the contract for an awarded package. One per trade in the bundle,
   *  each between the vendor and whoever contracts with them. */
  issueContract(packageId: string, counterparty?: "builder" | "owner"): number {
    if (!this.canManageBids) return 0;
    let issued = 0;
    this.mutate((db) => {
      const p = db.bidPackages.find((x) => x.id === packageId);
      const b = p?.bids.find((x) => x.id === p.awardedBidId);
      if (!p || !b) return;
      const tradeIds = [...new Set([p.tradeId, ...(p.tradeIds ?? [])])].filter(Boolean);
      for (const tradeId of tradeIds) {
        const trade = db.trades.find((t) => t.id === tradeId);
        const party = counterparty ?? (trade?.managedBy === "owner" ? "owner" : "builder");
        // Who the vendor contracts with and who manages the trade are the same
        // fact. Storing it twice is how the two end up disagreeing, so the
        // contract's counterparty sets the trade's manager rather than shadowing it.
        if (trade) trade.managedBy = party;
        const ag = this.ensureAgreement(db, tradeId);
        // A new document means new signatures. Carrying the old ones over would
        // put someone on record as having signed something they never read.
        ag.round1 = [];
        ag.contract = contractFromAward(db, p, b, tradeId, party, this.session.displayName);
        issued++;
        const tradeUser = db.users.find((u) => u.tradeIds?.includes(tradeId));
        this.notify(db, {
          toUserId: tradeUser?.id, toRole: tradeUser ? undefined : "trade", kind: "info", module: "vendors",
          message: `📄 Contract issued for ${db.trades.find((t) => t.id === tradeId)?.name ?? "your trade"} — review & sign in Vendor Management.`,
        });
      }
      this.notify(db, { toRole: "owner", kind: "info", module: "vendors", message: `📄 "${p.title}" contract issued to ${b.vendorName}.` });
    }, "Issued contract");
    return issued;
  }

  /** Push an approved change order onto the live contract as an amendment. Both
   *  parties sign again: the sum they agreed to has changed. */
  reviseContract(lineId: string, changeOrderId: string): boolean {
    if (!["full_admin", "owner", "builder"].includes(this.session.role)) return false;
    let ok = false;
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      const co = l?.changeOrders.find((c) => c.id === changeOrderId);
      if (!l || !co) return;
      const ag = db.vendorAgreements.find((a) => a.tradeId === l.tradeId);
      if (!ag?.contract) return;
      const delta = co.kind === "savings" ? -Math.abs(co.amount) : Math.abs(co.amount);
      const revisions = ag.contract.revisions ?? (ag.contract.revisions = []);
      if (revisions.some((r) => r.changeOrderId === co.id)) return; // already on the contract
      const newAmount = revisions.reduce((a, r) => a + r.delta, ag.contract.amount) + delta;
      revisions.push({
        id: newId("rev"), at: new Date().toISOString().slice(0, 10), by: this.session.displayName,
        changeOrderId: co.id, exhibit: co.exhibit, title: co.title, delta, newAmount,
      });
      co.status = "approved";
      // lockedCost is deliberately NOT touched. The budget line already carries
      // approved change orders in their own column, so writing the revised sum
      // back would count this money twice. Contracted + change orders IS the
      // revised contract sum — the same arithmetic contractAmount() does.
      ag.round1 = [];
      const tradeUser = db.users.find((u) => u.tradeIds?.includes(l.tradeId));
      this.notify(db, {
        toUserId: tradeUser?.id, toRole: tradeUser ? undefined : "trade", kind: "info", module: "vendors",
        message: `📄 Revised contract issued (${co.exhibit}: ${co.title}) — please re-sign in Vendor Management.`,
      });
      ok = true;
    }, "Revised contract");
    return ok;
  }

  /** Send draws that already carry this line back for fresh client approval.
   *  A paid draw is never touched — that money has gone. Returns what was
   *  reopened, and the paid draws that could not be. */
  reopenDrawsForLine(lineId: string): { reopened: string[]; paid: string[] } {
    const out = { reopened: [] as string[], paid: [] as string[] };
    if (!["full_admin", "owner", "builder"].includes(this.session.role)) return out;
    this.mutate((db) => {
      for (const d of db.draws) {
        if (!d.allocations.some((a) => a.lineId === lineId)) continue;
        if (d.status === "paid") { out.paid.push(d.name); continue; }
        if (d.status !== "pushed") continue;
        d.status = "planned";
        d.approvedBy = undefined;
        d.approvedDate = undefined;
        out.reopened.push(d.name);
      }
      if (out.reopened.length) {
        this.notify(db, { toRole: "builder", kind: "info", module: "payments", message: `↺ ${out.reopened.join(", ")} reopened — the contract changed, so it needs the client's approval again.` });
      }
    }, "Reopened draw for approval");
    return out;
  }

  // ---- The ROM ---------------------------------------------------------------
  // The owner commits; the builder locks. Neither does the other's job — the
  // owner's power over money is agreeing the figure, and the lock is the
  // builder's declaration that every figure has been agreed.

  /** Only the owner agrees a figure. Nobody agrees one on their behalf. */
  private get canCommitRom(): boolean {
    return ["full_admin", "owner"].includes(this.session.role);
  }
  /** Owners never lock — see the design's canLockRom. */
  private get canLockRom(): boolean {
    return ["full_admin", "builder"].includes(this.session.role);
  }

  /** Agree (or withdraw agreement on) one ROM row. Committing a range agrees
   *  its ceiling, and the envelope is SNAPSHOT at that moment: what the owner
   *  agreed cannot later drift because somebody edited an allowance. */
  commitRomLine(tradeId: string, markupModel: MarkupModel, committed: boolean) {
    if (!this.canCommitRom) return;
    this.mutate((db) => {
      if (db.romLocked) return; // a locked ROM does not move
      db.rom = db.rom ?? [];
      let r = db.rom.find((x) => x.tradeId === tradeId && x.markupModel === markupModel);
      if (!r) {
        r = { id: newId("rom"), tradeId, markupModel, committed: false };
        db.rom.push(r);
      }
      r.committed = committed;
      if (committed) {
        r.committedOn = new Date().toISOString().slice(0, 10);
        r.committedBy = this.session.displayName;
        if (r.agreedLow == null || r.agreedHigh == null) {
          const lines = db.costLines.filter((l) => l.tradeId === tradeId && l.markupModel === markupModel);
          const env = lines.reduce((a, l) => {
            const e = romEnvelope(l);
            return { low: a.low + e.low, high: a.high + e.high };
          }, { low: 0, high: 0 });
          r.agreedLow = env.low;
          r.agreedHigh = env.high;
        }
      } else {
        // Withdrawing agreement releases the snapshot too, so re-committing
        // agrees whatever the figure actually is thenrather than a stale one.
        r.committedOn = undefined;
        r.committedBy = undefined;
        r.agreedLow = undefined;
        r.agreedHigh = undefined;
      }
    }, committed ? "Line committed" : "Agreement withdrawn");
  }

  /** Add a budget line. Before the ROM is locked it joins as a draft the owner
   *  still has to agree. Once locked the ROM does not re-open, so the line goes
   *  in already contracted and the owner is asked to approve it instead — the
   *  work is real either way, and pretending otherwise just hides it. */
  addBudgetLine(p: { tradeId: string; amount: number; note?: string; category?: MacroCategory; roomIds?: string[]; manager?: CostOwner; outsideRom?: boolean }) {
    if (!["full_admin", "builder", "owner"].includes(this.session.role)) return;
    if (!p.tradeId || !(p.amount > 0)) return;
    this.mutate((db) => {
      const trade = db.trades.find((t) => t.id === p.tradeId);
      const owner: CostOwner = p.manager ?? (trade?.managedBy === "owner" ? "owner" : "builder");
      const locked = !!db.romLocked;
      // Outside the ROM once the ROM is settled — either locked outright, or
      // this trade's line already agreed by the owner. New work after that
      // point is a deviation from the baseline, not a bigger baseline.
      const romRow = (db.rom ?? []).find((r) => r.tradeId === p.tradeId);
      const outsideRom = p.outsideRom ?? (locked || !!romRow?.committed);
      const today = new Date().toISOString().slice(0, 10);
      const markupModel: MarkupModel = "passthrough";
      const line: CostLine = {
        id: newId("cl"), name: trade?.name ?? "New line", tradeId: p.tradeId,
        category: p.category ?? trade?.category ?? "Soft Costs",
        owner, roomIds: p.roomIds ?? [], markupModel,
        markupPct: owner === "owner" ? 0 : (db.project.builderMarkupPct ?? 20),
        history: [{ label: outsideRom ? "Added after the ROM" : "Added to the ROM", date: today, amount: p.amount }],
        outsideRom: outsideRom || undefined,
        status: outsideRom ? "contracted" : "estimate",
        changeOrders: [], phases: [],
        desc: p.note?.trim() || undefined,
        // A line added after the lock is contracted from the start.
        locked: outsideRom, lockedCost: outsideRom ? p.amount : undefined,
        lockedAt: outsideRom ? today : undefined,
        lockedBy: outsideRom ? this.session.displayName : undefined,
        baseline: outsideRom ? p.amount * (owner === "owner" ? 1 : 1 + (db.project.builderMarkupPct ?? 20) / 100) : undefined,
      };
      db.costLines.push(line);

      db.rom = db.rom ?? [];
      if (!db.rom.find((r) => r.tradeId === p.tradeId && r.markupModel === markupModel)) {
        db.rom.push({ id: newId("rom"), tradeId: p.tradeId, markupModel, committed: false, note: p.note?.trim() || undefined });
      }

      if (outsideRom) {
        this.notify(db, {
          toRole: "owner", kind: "info",
          message: `Approval needed: "${line.name}" was added after the ROM, contracted at $${p.amount.toLocaleString()}. It sits outside the agreed baseline.`,
        });
      }
    }, this.db.romLocked ? "Added — sent for approval" : "Line added to the ROM");
  }

  /** The assumption behind a figure — the sentence that explains it. */
  setRomNote(tradeId: string, markupModel: MarkupModel, note: string) {
    if (!this.canLockRom) return; // the builder writes the assumption
    this.mutate((db) => {
      if (db.romLocked) return;
      db.rom = db.rom ?? [];
      let r = db.rom.find((x) => x.tradeId === tradeId && x.markupModel === markupModel);
      if (!r) { r = { id: newId("rom"), tradeId, markupModel, committed: false }; db.rom.push(r); }
      r.note = note.trim() || undefined;
    });
  }

  /** Who manages this budget line. The manager is the one who fills in what it
   *  is contracted at, raises its change orders and records what has been paid —
   *  so this is the switch that decides who does all of that. An owner-managed
   *  line carries no builder fee. */
  setBudgetLineManager(tradeId: string, markupModel: MarkupModel, manager: CostOwner) {
    if (!["full_admin", "owner", "builder"].includes(this.session.role)) return;
    this.mutate((db) => {
      const lines = db.costLines.filter((l) => l.tradeId === tradeId && l.markupModel === markupModel);
      for (const l of lines) {
        l.owner = manager;
        // The fee follows the manager: the builder does not take a fee on work
        // the owner contracts and pays direct.
        l.markupPct = manager === "owner" ? 0 : (db.project.builderMarkupPct ?? 20);
      }
    }, manager === "owner" ? "Now owner managed" : "Now GC managed");
  }

  /** Move a line in or out of the agreed ROM baseline. Wrongly inside, the
   *  baseline grows to cover work nobody agreed; wrongly outside, real ROM
   *  scope reads as a deviation. Either way it is one switch. */
  setLineOutsideRom(lineId: string, outside: boolean) {
    if (!["full_admin", "owner", "builder"].includes(this.session.role)) return;
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      if (l) l.outsideRom = outside || undefined;
    }, outside ? "Outside the ROM" : "Part of the ROM");
  }

  /** Rename a budget line — which is to say, rename the trade. Everything that
   *  shows this name reads it from the one trade record, so the schedule, the
   *  materials list, the vendor roster and every package follow immediately.
   *  There is no second copy to drift. */
  setBudgetLineName(tradeId: string, name: string) {
    if (!["full_admin", "owner", "builder"].includes(this.session.role)) return;
    const next = name.trim();
    if (!next) return; // a nameless trade would be worse than the old name
    this.mutate((db) => {
      const t = db.trades.find((x) => x.id === tradeId);
      if (!t || t.name === next) return;
      // Capture the old name BEFORE overwriting it — the cost lines are matched
      // against what they used to say.
      const was = t.name;
      t.name = next;
      // Cost lines carry their own name, but the ones that were only ever named
      // after the trade should follow it rather than fossilise the old label.
      for (const l of db.costLines) if (l.tradeId === tradeId && l.name === was) l.name = next;
    }, "Renamed everywhere");
  }

  /** Kill a budget line, put it on hold, or bring it back. A killed line is kept
   *  rather than deleted — the figure stops counting, but the record of it
   *  having existed does not disappear. */
  setBudgetLineState(tradeId: string, markupModel: MarkupModel, state: BudgetLineState) {
    if (!["full_admin", "owner", "builder"].includes(this.session.role)) return;
    this.mutate((db) => {
      db.rom = db.rom ?? [];
      let r = db.rom.find((x) => x.tradeId === tradeId && x.markupModel === markupModel);
      if (!r) { r = { id: newId("rom"), tradeId, markupModel, committed: false }; db.rom.push(r); }
      r.state = state === "active" ? undefined : state;
    }, state === "removed" ? "Line removed" : state === "hold" ? "Line on hold" : "Line restored");
  }

  /** Set what a line is contracted at — the pre-fee figure agreed with whoever
   *  is doing the work. Only the line's manager may set it, which is the point
   *  of setBudgetLineManager. */
  setLineContracted(lineId: string, baseCost: number) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      if (!l) return;
      const role = this.session.role;
      const mayEdit = role === "full_admin"
        || (role === "builder" && l.owner === "builder")
        || (role === "owner" && l.owner === "owner");
      if (!mayEdit) return;
      const today = new Date().toISOString().slice(0, 10);
      if (baseCost > 0) {
        const factor = l.markupModel === "passthrough" ? 1 + l.markupPct / 100 : 1;
        l.lockedCost = baseCost;
        l.baseline = baseCost * factor;
        l.locked = true;
        l.lockedAt = today;
        l.lockedBy = this.session.displayName;
        if (l.status === "estimate" || l.status === "allowance") l.status = "contracted";
      } else {
        // Clearing the figure takes the line back out of contract.
        l.locked = false; l.lockedCost = undefined; l.baseline = undefined;
        l.lockedAt = undefined; l.lockedBy = undefined;
        if (l.status === "contracted") l.status = "estimate";
      }
    }, "Contract figure saved");
  }

  /** Throw the lock. Requires every row committed, and it is the one action
   *  here that does not undo itself — see unlockRom. */
  lockRom() {
    if (!this.canLockRom || !romCanLock(this.db)) return;
    this.mutate((db) => {
      db.romLocked = true;
      db.romLockedAt = new Date().toISOString().slice(0, 10);
      db.romLockedBy = this.session.displayName;
      this.notify(db, {
        toRole: "owner", kind: "info",
        message: `🔒 The ROM is locked by ${this.session.displayName}. The budget is now negotiated inside the packages.`,
      });
    }, "ROM locked");
  }

  /** Full admin only, and deliberately awkward: the ROM is meant to be final. */
  unlockRom() {
    if (this.session.role !== "full_admin") return;
    this.mutate((db) => {
      db.romLocked = false;
      db.romLockedAt = undefined;
      db.romLockedBy = undefined;
    }, "ROM unlocked");
  }

  /** Toggle my reaction on a message — an update head or any reply. Tapping the
   *  same emoji again removes it. Quiet: a reaction is an acknowledgement, not
   *  authorship. */
  reactToMessage(msgId: string, emoji: string) {
    const me = this.session.userId;
    this.mutateQuiet((db) => {
      for (const u of db.updates) {
        const target = u.id === msgId ? u : u.replies.find((r) => r.id === msgId);
        if (!target) continue;
        target.reactions = target.reactions ?? {};
        if (target.reactions[me] === emoji) delete target.reactions[me];
        else target.reactions[me] = emoji;
        return;
      }
    });
  }

  /** Record that I have read a conversation up to `upTo` — powers the ✓✓
   *  ticks. Skipped when nothing is new, so opening a chat does not write the
   *  database for no reason. */
  markConversationRead(key: string, upTo: string) {
    const me = this.session.userId;
    if (!upTo || !key.split("+").includes(me)) return;
    // A QA impersonation must not fake the real person's receipts, and a
    // background tab has not "read" anything.
    if (this.viewAsBase) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const cur = this.db.convMeta?.find((m) => m.key === key)?.reads?.[me];
    if (cur && cur >= upTo) return;
    this.mutateQuiet((db) => {
      db.convMeta = db.convMeta ?? [];
      let m = db.convMeta.find((x) => x.key === key);
      if (!m) { m = { key }; db.convMeta.push(m); }
      m.reads = { ...m.reads, [me]: upTo };
    });
  }

  /** Pin is per-user: my pin does not rearrange anyone else's list. */
  togglePinConversation(key: string) {
    const me = this.session.userId;
    const on = this.db.convMeta?.find((m) => m.key === key)?.pinnedBy?.includes(me);
    this.mutate((db) => {
      db.convMeta = db.convMeta ?? [];
      let m = db.convMeta.find((x) => x.key === key);
      if (!m) { m = { key }; db.convMeta.push(m); }
      const set = new Set(m.pinnedBy ?? []);
      if (set.has(me)) set.delete(me); else set.add(me);
      m.pinnedBy = [...set];
    }, on ? "Unpinned" : "📌 Pinned");
  }

  /** Archive is per-user too — out of sight, never deleted. */
  toggleArchiveConversation(key: string) {
    const me = this.session.userId;
    const on = this.db.convMeta?.find((m) => m.key === key)?.archivedBy?.includes(me);
    this.mutate((db) => {
      db.convMeta = db.convMeta ?? [];
      let m = db.convMeta.find((x) => x.key === key);
      if (!m) { m = { key }; db.convMeta.push(m); }
      const set = new Set(m.archivedBy ?? []);
      if (set.has(me)) set.delete(me); else set.add(me);
      m.archivedBy = [...set];
    }, on ? "Restored" : "🗂 Archived");
  }

  /** Name a conversation — the WhatsApp group subject. Any participant can set
   *  or change it; clearing it falls back to the participant names. */
  setConversationSubject(key: string, subject: string) {
    const me = this.session.userId;
    if (this.session.role !== "full_admin" && !key.split("+").includes(me)) return;
    this.mutate((db) => {
      db.convMeta = db.convMeta ?? [];
      let m = db.convMeta.find((x) => x.key === key);
      if (!m) { m = { key }; db.convMeta.push(m); }
      m.subject = subject.trim() || undefined;
    }, subject.trim() ? "Subject saved" : "Subject removed");
  }

  /** Delete a package. Refused once it is awarded — the award created a
   *  contract and a budget line, and deleting the paperwork behind real money
   *  would leave that money with nothing explaining it. */
  removeBidPackage(id: string): boolean {
    if (!this.canManageBids) return false;
    const p = this.db.bidPackages?.find((x) => x.id === id);
    if (!p || p.awardedBidId) return false;
    let ok = false;
    this.mutate((db) => {
      const before = db.bidPackages.length;
      db.bidPackages = db.bidPackages.filter((x) => x.id !== id);
      ok = db.bidPackages.length < before;
    }, "Package deleted");
    return ok;
  }

  /** Builder's star rating for a trade (one row per rater per trade). */
  setTradeRating(tradeId: string, patch: Partial<Pick<TradeRating, "speed" | "clean" | "budget" | "mistakeFree" | "note">>) {
    if (!["full_admin", "builder", "owner"].includes(this.session.role)) return;
    this.mutate((db) => {
      db.tradeRatings = db.tradeRatings ?? [];
      let r = db.tradeRatings.find((x) => x.tradeId === tradeId && x.raterId === this.session.userId);
      if (!r) {
        r = { tradeId, raterId: this.session.userId, raterName: this.session.displayName, at: new Date().toISOString() };
        db.tradeRatings.push(r);
      }
      Object.assign(r, patch, { at: new Date().toISOString(), raterName: this.session.displayName });
    });
  }

  // ---- Site updates (message board) ----
  /** Post a field update to specific recipients. Returns the new update's id. */
  postUpdate(u: { title: string; body?: string; photos?: string[]; toUserIds: string[]; context?: UpdateContext; quote?: MsgQuote }): string {
    const id = newId("upd");
    this.mutate((db) => {
      const me = db.users.find((x) => x.id === this.session.userId);
      db.updates.unshift({
        id, title: u.title.trim(), body: u.body?.trim() || undefined,
        photos: u.photos?.length ? u.photos : undefined,
        authorId: me?.id ?? this.session.userId, authorName: this.session.displayName,
        at: new Date().toISOString(), toUserIds: u.toUserIds, replies: [],
        context: u.context, quote: u.quote,
      });
      for (const uid of u.toUserIds) {
        this.notify(db, { toUserId: uid, kind: "info", module: "updates", message: `💬 New message from ${this.session.displayName}: "${u.title.trim()}"${u.context ? ` (re: ${u.context.label})` : ""}` });
      }
    }, u.toUserIds.length > 1 ? `Message sent to ${u.toUserIds.length} people` : "Message sent");
    return id;
  }
  /** In-line reply on an update — allowed for the author and any recipient. */
  replyToUpdate(updateId: string, body: string, quote?: MsgQuote): void {
    this.mutate((db) => {
      const up = db.updates.find((x) => x.id === updateId);
      if (!up || !body.trim()) return;
      const meId = this.session.userId;
      const involved = up.authorId === meId || up.toUserIds.includes(meId) || this.session.role === "full_admin";
      if (!involved) return;
      up.replies.push({ id: newId("rep"), authorId: meId, authorName: this.session.displayName, at: new Date().toISOString(), body: body.trim(), quote });
      // Ping everyone on the thread except the person replying.
      const others = new Set([up.authorId, ...up.toUserIds].filter((x) => x !== meId));
      for (const uid of others) {
        this.notify(db, { toUserId: uid, kind: "info", module: "updates", message: `↩ ${this.session.displayName} replied on "${up.title}"` });
      }
    }, "Reply sent");
  }

  // ---- Field Updates ----
  /** Publish a field update: ONE immutable report, a tagged Messages chip to
   *  each audience, and (pushed by the caller AFTER this resolves) the same
   *  report by email. The client side — owner + designer — shares one thread
   *  and reads the whole report; each vendor gets their OWN thread, and their
   *  copy of the report shows only their items. There is deliberately no
   *  edit or delete: corrections go in the next update.
   *
   *  This does NOT go through mutate(): a published report is not undoable
   *  (the emails are already promised), and the write goes through patchDB —
   *  read-modify-write against the server's current row — so the sequential
   *  number is minted against what is actually published, not this device's
   *  possibly-stale copy, and publishing never carries a stale snapshot of
   *  everything else. Resolves with what the email push needs only once the
   *  write has LANDED; null = refused or the save failed (already announced). */
  async publishFieldUpdate(input: {
    title: string;
    items: Omit<FieldItem, "id">[];
    sendTo: { owner: boolean; designer: boolean; vendors: boolean };
  }): Promise<{
    id: string; no: number; title: string; dateLabel: string; sentToLine: string;
    teamEmails: string[];
    vendorRecipients: { userId: string; email?: string; tradeIds: string[] }[];
  } | null> {
    const role = this.session.role;
    if (role !== "builder" && role !== "full_admin") return null;
    if (!input.items.length) return null;
    if (!input.sendTo.owner && !input.sendTo.designer && !input.sendTo.vendors) return null;

    const db = this.db;
    const id = newId("fu");
    const now = new Date();
    // The publisher's own calendar day, everywhere — an evening publish must
    // not read as tomorrow's date in the masthead (toISOString is UTC).
    const dateIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const dateLabel = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const title = input.title.trim() || `Field update — ${dateLabel}`;

    const live = (u: User) => u.status !== "invited" && u.status !== "pending" && !u.disabled;
    const owners = input.sendTo.owner ? db.users.filter((u) => u.role === "owner" && live(u)) : [];
    const designers = input.sendTo.designer ? db.users.filter((u) => u.role === "viewer" && live(u)) : [];
    // Awarded vendors only — a trade with a contract standing behind it — and
    // only those with at least one item in THIS update. A vendor with nothing
    // in the report receives nothing at all.
    const awardedTradeIds = new Set(db.vendorAgreements.filter((a) => a.contract).map((a) => a.tradeId));
    const itemTradeIds = new Set(input.items.map((i) => i.tradeId).filter((t): t is string => !!t));
    const vendors = input.sendTo.vendors
      ? db.users.filter((u) => u.role === "trade" && live(u) &&
          (u.tradeIds ?? []).some((t) => awardedTradeIds.has(t) && itemTradeIds.has(t)))
      : [];
    if (!owners.length && !designers.length && !vendors.length) return null;
    const vendorItemCount = (u: User) => input.items.filter((i) => i.tradeId && (u.tradeIds ?? []).includes(i.tradeId)).length;

    const toNames = [
      owners.length ? owners.map((u) => u.name.split(" ")[0]).join(" and ") : "",
      designers.length ? "the designer" : "",
      vendors.length ? (vendors.length === 1 ? vendors[0].name : `${vendors.length} awarded vendors`) : "",
    ].filter(Boolean);
    const sentToLine = toNames.length <= 1 ? (toNames[0] ?? "") : `${toNames.slice(0, -1).join(", ")} and ${toNames[toNames.length - 1]}`;

    const reds = input.items.filter((i) => i.rag === "red").length;
    const asks = input.items.filter((i) => i.ask).length;
    // Ids are minted ONCE, outside apply: apply runs twice (optimistic local,
    // then against the server's fresh copy) and both copies must agree on
    // every id the outside world might hold. Items are deep-copied so the
    // published report can never alias the composer's state.
    const items: FieldItem[] = input.items.map((i) => ({ ...i, photos: [...i.photos], id: newId("fi") }));
    const teamMsgId = newId("upd");
    const vendorMsgIds = new Map(vendors.map((v) => [v.id, newId("upd")]));
    // The sequential number is computed INSIDE apply, per copy: the server
    // application sees what is actually published and mints the real number
    // (captured below for the return + emails). The optimistic local copy may
    // briefly show a lower number; realtime replaces it with the truth.
    let finalNo = 0;
    const apply = (dbx: DB) => {
      dbx.fieldUpdates = dbx.fieldUpdates ?? [];
      if (dbx.fieldUpdates.some((u) => u.id === id)) { finalNo = dbx.fieldUpdates.find((u) => u.id === id)!.no; return; }
      const no = Math.max(0, ...dbx.fieldUpdates.map((u) => u.no)) + 1;
      finalNo = no;
      const noLabel = String(no).padStart(2, "0");
      const ctx: UpdateContext = { kind: "field", refId: id, label: `Field update No ${noLabel} — ${dateLabel}`, href: `/field-updates?view=${id}` };
      dbx.fieldUpdates.unshift({
        id, no, dateIso, title,
        by: this.session.displayName, byId: this.session.userId,
        items: clone(items),
        sentTo: { owner: owners.length > 0, designer: designers.length > 0, vendors: vendors.length > 0 },
        sentToLine, publishedAt: now.toISOString(),
      });
      const post = (msgId: string, toIds: string[], body: string) => {
        if (!toIds.length) return;
        dbx.updates.unshift({
          id: msgId, title: `Field update No ${noLabel} — ${title}`, body,
          authorId: this.session.userId, authorName: this.session.displayName,
          at: now.toISOString(), toUserIds: toIds, replies: [], context: ctx,
        });
        for (const uid2 of toIds) {
          this.notify(dbx, { toUserId: uid2, kind: "info", module: "updates", message: `📋 Field update No ${noLabel} from ${this.session.displayName}: "${title}"` });
        }
      };
      post(
        teamMsgId,
        [...owners, ...designers].map((u) => u.id),
        `Field update No ${noLabel} is out: ${items.length} ${items.length === 1 ? "item" : "items"}` +
          (reds ? `, ${reds} flagged red` : "") + (asks ? `, ${asks} waiting on your decision` : "") +
          ". Open it for the photos and the detail. Also sent by email.",
      );
      for (const v of vendors) {
        const n = vendorItemCount(v);
        post(vendorMsgIds.get(v.id)!, [v.id], `Your work is in field update No ${String(no).padStart(2, "0")}: ${n} ${n === 1 ? "item" : "items"} on your trade. Open it for the photos and the detail. Also sent by email.`);
      }
    };

    // Optimistic local apply (no undo snapshot — see above), then the real
    // write, chained behind whatever is already in flight so writes cannot
    // land out of order. The caller gets a result only if the write LANDS.
    const prevDb = this.db;
    const next = clone(this.db);
    apply(next);
    this.db = next;
    this.emit();
    const run = async () => {
      if (this.backend?.patchDB) await this.backend.patchDB(apply);
      else await this.backend?.persistDB(next);
      if (this.saveError) { this.saveError = null; this.emit(); }
    };
    this.lastWrite = this.lastWrite.catch(() => undefined).then(run);
    try {
      await this.lastWrite;
    } catch (e) {
      // Roll the optimistic copy back (if nothing else has moved since):
      // a report that never reached the server must not linger locally, or a
      // later unrelated save would publish it WITHOUT its emails.
      if (this.db === next) { this.db = prevDb; this.emit(); }
      this.announceSaveFailed(e);
      return null;
    }
    this.announceSave(`Published to ${sentToLine} — in Messages and by email.${asks ? ` ${asks} ${asks === 1 ? "ask is" : "asks are"} waiting on the owner.` : ""}`);
    return {
      id, no: finalNo, title, dateLabel, sentToLine,
      teamEmails: [...owners, ...designers].filter((u) => !u.emailOptOut && !!u.email).map((u) => u.email),
      vendorRecipients: vendors.map((u) => ({ userId: u.id, email: u.emailOptOut ? undefined : u.email, tradeIds: u.tradeIds ?? [] })),
    };
  }

  // ---- Receipts inbox ----
  /** The owner (or admin) confirms a forwarded receipt: the reviewed values
   *  are final, the original files into Artifacts against the chosen line,
   *  and — only if applied as a direct payment — the line's Paid moves. The
   *  suggestion itself never touched the money. */
  confirmReceipt(id: string, final: {
    lineId: string;
    appliedAs: "direct" | "draw";
    drawId?: string;
    vendor: string;
    date?: string;
    amount: number;
    summary?: string;
  }): boolean {
    const role = this.session.role;
    if (role !== "owner" && role !== "full_admin") return false;
    if (!final.lineId || !(final.amount > 0)) return false;
    const line = this.db.costLines.find((l) => l.id === final.lineId);
    if (!line) return false;
    const rec = (this.db.receipts ?? []).find((r) => r.id === id);
    if (!rec || rec.status !== "pending") return false;
    const artId = newId("art");
    this.mutate((db) => {
      const r = (db.receipts ?? []).find((x) => x.id === id);
      const l = db.costLines.find((x) => x.id === final.lineId);
      if (!r || r.status !== "pending" || !l) return;
      r.status = "confirmed";
      r.vendor = final.vendor; r.date = final.date; r.amount = final.amount; r.summary = final.summary;
      r.confirmedBy = this.session.displayName;
      r.confirmedAt = new Date().toISOString();
      r.confirmedLineId = final.lineId;
      r.appliedAs = final.appliedAs;
      r.appliedDrawId = final.appliedAs === "draw" ? final.drawId : undefined;
      // File the evidence where the money lives.
      r.artifactId = artId;
      db.artifacts.unshift({
        id: artId,
        name: `Receipt — ${final.vendor}${final.date ? ` · ${final.date}` : ""} · $${final.amount.toLocaleString()}`,
        kind: "other",
        source: `forwarded by ${r.fromEmail}`,
        date: final.date,
        notes: final.summary,
        lineId: final.lineId,
        versions: r.fileUrl ? [{ id: newId("av"), label: "v1", uploadedAt: new Date().toISOString(), uploadedBy: this.session.displayName, fileUrl: r.fileUrl, fileName: r.fileName }] : undefined,
      });
      if (final.appliedAs === "direct") {
        l.directPaid = (l.directPaid ?? 0) + final.amount;
        l.directPaidDate = final.date ?? new Date().toISOString().slice(0, 10);
        l.directPaidNote = [l.directPaidNote, `${final.vendor} $${final.amount.toLocaleString()}${final.date ? ` (${final.date})` : ""}`].filter(Boolean).join("; ").slice(0, 500);
      } else if (final.drawId) {
        const d = db.draws.find((x) => x.id === final.drawId);
        if (d) d.note = [d.note, `Receipt: ${final.vendor} $${final.amount.toLocaleString()}${final.date ? ` (${final.date})` : ""}`].filter(Boolean).join("\n").slice(0, 1000);
      }
    }, final.appliedAs === "direct"
      ? `Receipt confirmed — $${final.amount.toLocaleString()} added to ${line.name}'s paid.`
      : `Receipt confirmed and filed against the draw.`);
    return true;
  }

  /** Not project money (or not worth tracking) — keep the record, move on. */
  dismissReceipt(id: string) {
    const role = this.session.role;
    if (role !== "owner" && role !== "full_admin") return;
    this.mutate((db) => {
      const r = (db.receipts ?? []).find((x) => x.id === id);
      if (!r || r.status !== "pending") return;
      r.status = "dismissed";
      r.dismissedBy = this.session.displayName;
      r.dismissedAt = new Date().toISOString();
    }, "Receipt dismissed.");
  }

  // ---- Vendor agreements ----
  private ensureAgreement(db: DB, tradeId: string) {
    let a = db.vendorAgreements.find((x) => x.tradeId === tradeId);
    if (!a) { a = { tradeId, round1: [], round2: [] }; db.vendorAgreements.push(a); }
    return a;
  }
  setVendorDrawRequest(tradeId: string, text: string) {
    this.mutate((db) => { this.ensureAgreement(db, tradeId).drawRequest = text; });
  }
  setVendorDates(tradeId: string, startDate: string, finishDate: string) {
    this.mutate((db) => { const a = this.ensureAgreement(db, tradeId); a.startDate = startDate; a.finishDate = finishDate; });
  }
  /** Toggle a digital signature for a party on a contract round. */
  signVendorRound(tradeId: string, round: 1 | 2, party: "builder" | "trade" | "owner", name: string, signatureImg?: string) {
    this.mutate((db) => {
      const a = this.ensureAgreement(db, tradeId);
      const arr = round === 1 ? a.round1 : a.round2;
      const i = arr.findIndex((s) => s.party === party);
      if (i >= 0) arr.splice(i, 1);
      else arr.push({ party, name, at: new Date().toISOString(), signatureImg });
    });
  }

  // ---- Signatures (adopted, saved to profile) ----
  setUserSignature(userId: string, signature: string | undefined) {
    this.mutate((db) => { const u = db.users.find((x) => x.id === userId); if (u) u.signature = signature; });
  }

  // ---- Terms & Conditions builder (builder / owner / full_admin only) ----
  private get canEditTerms(): boolean {
    return ["full_admin", "owner", "builder"].includes(this.session.role);
  }
  setTermsField(patch: Partial<{ preamble: string; bindingLanguage: string }>) {
    if (!this.canEditTerms) return;
    this.mutate((db) => { Object.assign(db.terms, patch); });
  }
  toggleStandardClause(clauseId: string, on: boolean) {
    if (!this.canEditTerms) return;
    this.mutate((db) => {
      const set = new Set(db.terms.enabledClauseIds);
      if (on) set.add(clauseId); else set.delete(clauseId);
      db.terms.enabledClauseIds = [...set];
    });
  }
  addCustomClause(c: { cluster: string; title: string; body: string }, tradeId?: string) {
    if (!this.canEditTerms) return;
    this.mutate((db) => {
      const clause = { id: newId("clause"), cluster: c.cluster || "Custom", title: c.title, body: c.body };
      if (tradeId) {
        const ov = (db.terms.perTrade[tradeId] ??= {});
        ov.customClauses = [...(ov.customClauses ?? []), clause];
      } else {
        db.terms.customClauses.push(clause);
        db.terms.enabledClauseIds = [...db.terms.enabledClauseIds, clause.id];
      }
    });
  }
  removeCustomClause(clauseId: string, tradeId?: string) {
    if (!this.canEditTerms) return;
    this.mutate((db) => {
      if (tradeId) {
        const ov = db.terms.perTrade[tradeId];
        if (ov?.customClauses) ov.customClauses = ov.customClauses.filter((c) => c.id !== clauseId);
      } else {
        db.terms.customClauses = db.terms.customClauses.filter((c) => c.id !== clauseId);
        db.terms.enabledClauseIds = db.terms.enabledClauseIds.filter((id) => id !== clauseId);
      }
    });
  }
  /** Per-trade clause state: "default" (inherit), "include" (force on), "exclude" (force off). */
  setTradeClause(tradeId: string, clauseId: string, mode: "default" | "include" | "exclude") {
    if (!this.canEditTerms) return;
    this.mutate((db) => {
      const ov = (db.terms.perTrade[tradeId] ??= {});
      ov.disabledClauseIds = (ov.disabledClauseIds ?? []).filter((id) => id !== clauseId);
      ov.extraClauseIds = (ov.extraClauseIds ?? []).filter((id) => id !== clauseId);
      if (mode === "exclude") ov.disabledClauseIds.push(clauseId);
      if (mode === "include") ov.extraClauseIds.push(clauseId);
    });
  }
  setTradeTermsNote(tradeId: string, note: string) {
    if (!this.canEditTerms) return;
    this.mutate((db) => { const ov = (db.terms.perTrade[tradeId] ??= {}); ov.note = note; });
  }

  // ---- Artifacts (document library + drawing markup) ----
  addArtifact(a: Omit<Artifact, "id">): string {
    const id = newId("art");
    this.mutate((db) => { db.artifacts.unshift({ id, ...a }); });
    return id;
  }
  removeArtifact(id: string) {
    this.mutate((db) => { db.artifacts = db.artifacts.filter((x) => x.id !== id); });
  }
  updateArtifact(id: string, patch: Partial<Artifact>) {
    this.mutate((db) => { const a = db.artifacts.find((x) => x.id === id); if (a) Object.assign(a, patch); });
  }
  toggleArtifactWatch(id: string) {
    this.mutate((db) => { const a = db.artifacts.find((x) => x.id === id); if (a) a.watch = !a.watch; });
  }
  setArtifactArchived(id: string, archived: boolean) {
    this.mutate((db) => { const a = db.artifacts.find((x) => x.id === id); if (a) a.archived = archived; });
  }
  setArtifactSummary(id: string, summary: string) {
    this.mutate((db) => { const a = db.artifacts.find((x) => x.id === id); if (a) a.summary = summary; });
  }
  setPermitStatus(id: string, status: "pending" | "issued") {
    this.mutate((db) => {
      const a = db.artifacts.find((x) => x.id === id);
      if (!a) return;
      a.permitStatus = status;
      if (status === "issued" && (a.gatesTradeIds?.length || a.isGeneralPermit)) {
        const who = a.gatesTradeIds?.length ? a.gatesTradeIds.map((t) => this.db.trades.find((x) => x.id === t)?.name).filter(Boolean).join(", ") : "all trades";
        this.notify(db, { toRole: "builder", kind: "info", module: "artifacts", message: `✅ "${a.name}" issued — work cleared to start for ${who}.` });
      }
    });
  }

  // ---- Contacts & billing (builder / owner / full_admin) ----
  private get canManageContacts(): boolean {
    return ["full_admin", "builder", "owner"].includes(this.session.role);
  }
  addContactSheet(c: Omit<ContactSheet, "id">): string {
    const id = newId("contact");
    if (this.canManageContacts) this.mutate((db) => { db.contacts.push({ id, ...c }); });
    return id;
  }
  /** Add a vendor to the roster as a complete record. The first trade doubles as
   *  the engagement trade so existing contract/cost/schedule views still resolve,
   *  while `tradeIds` carries everything they can actually work on. */
  addVendor(v: {
    company: string; contactName: string; tradeIds: string[];
    city?: string; phone?: string; email?: string; paymentTerms?: string;
    docs?: VendorDoc[]; docRoute?: DocRoute; notes?: string;
  }): string {
    const id = newId("contact");
    if (!this.canManageContacts || !v.company.trim() || !v.tradeIds.length) return id;
    this.mutate((db) => {
      db.contacts.push({
        id, party: "vendor",
        tradeId: v.tradeIds[0], tradeIds: [...v.tradeIds],
        company: v.company.trim(), contactName: v.contactName.trim() || undefined,
        city: v.city?.trim() || undefined, phone: v.phone?.trim() || undefined,
        email: v.email?.trim() || undefined, paymentTerms: v.paymentTerms?.trim() || undefined,
        // Only keep documents someone actually told us something about.
        docs: (v.docs ?? []).filter((d) => d.expires || d.number || d.url),
        docRoute: v.docRoute, notes: v.notes?.trim() || undefined,
      });
    });
    return id;
  }
  updateContactSheet(id: string, patch: Partial<ContactSheet>) {
    if (!this.canManageContacts) return;
    this.mutate((db) => { const c = db.contacts.find((x) => x.id === id); if (c) Object.assign(c, patch); });
  }
  /** Insurance and license, recorded as supplied — no status is derived. */
  setVendorDoc(id: string, kind: VendorDocKind, patch: Partial<VendorDoc>) {
    if (!this.canManageContacts) return;
    this.mutate((db) => {
      const c = db.contacts.find((x) => x.id === id);
      if (!c) return;
      const docs = c.docs ?? [];
      const existing = docs.find((d) => d.kind === kind);
      if (existing) Object.assign(existing, patch);
      else docs.push({ kind, ...patch });
      c.docs = docs;
    });
  }
  updateBilling(id: string, patch: Partial<NonNullable<ContactSheet["billing"]>>) {
    if (!this.canManageContacts) return;
    this.mutate((db) => { const c = db.contacts.find((x) => x.id === id); if (c) c.billing = { ...c.billing, ...patch }; });
  }
  removeContactSheet(id: string) {
    if (!this.canManageContacts) return;
    this.mutate((db) => { db.contacts = db.contacts.filter((c) => c.id !== id); });
  }
  toggleContactShare(id: string) {
    if (!this.canManageContacts) return;
    this.mutate((db) => { const c = db.contacts.find((x) => x.id === id); if (c) c.shareAll = !c.shareAll; });
  }
  addWorker(sheetId: string, w: Omit<Worker, "id">) {
    if (!this.canManageContacts) return;
    this.mutate((db) => { const c = db.contacts.find((x) => x.id === sheetId); if (c) c.workers = [...(c.workers ?? []), { id: newId("wkr"), ...w }]; });
  }
  updateWorker(sheetId: string, workerId: string, patch: Partial<Worker>) {
    if (!this.canManageContacts) return;
    this.mutate((db) => { const w = db.contacts.find((x) => x.id === sheetId)?.workers?.find((y) => y.id === workerId); if (w) Object.assign(w, patch); });
  }
  removeWorker(sheetId: string, workerId: string) {
    if (!this.canManageContacts) return;
    this.mutate((db) => { const c = db.contacts.find((x) => x.id === sheetId); if (c?.workers) c.workers = c.workers.filter((w) => w.id !== workerId); });
  }
  /** Add a trade (owner can add their own — flagged Owner Managed). */
  addTrade(t: { name: string; category: Trade["category"]; managedBy?: "builder" | "owner" }): string {
    const id = newId("trade");
    if (this.canManageContacts && t.name.trim()) {
      this.mutate((db) => {
        const managedBy = t.managedBy ?? "builder";
        db.trades.push({ id, name: t.name.trim(), category: t.category, defaultOwner: managedBy, managedBy, custom: true });
      });
    }
    return id;
  }
  // ---- Macro categories ------------------------------------------------------
  /** Seed the editable list from the built-in set the first time one is touched,
   *  so an untouched project keeps reading the defaults. */
  private ensureCategories(db: DB) {
    if (!db.categories?.length) {
      db.categories = MACRO_ORDER.map((name) => ({ name, color: MACRO_COLOR[name] ?? "var(--muted)" }));
    }
    return db.categories;
  }

  addCategory(name: string, color: string): boolean {
    if (!this.canManageContacts) return false;
    const next = name.trim();
    if (!next) return false;
    let ok = false;
    this.mutate((db) => {
      const cats = this.ensureCategories(db);
      if (cats.some((c) => c.name.toLowerCase() === next.toLowerCase())) return;
      cats.push({ name: next, color });
      ok = true;
    }, "Category added");
    return ok;
  }

  updateCategory(name: string, patch: { name?: string; color?: string }) {
    if (!this.canManageContacts) return;
    this.mutate((db) => {
      const cats = this.ensureCategories(db);
      const c = cats.find((x) => x.name === name);
      if (!c) return;
      if (patch.color) c.color = patch.color;
      const renamed = patch.name?.trim();
      if (renamed && renamed !== name) {
        if (cats.some((x) => x.name.toLowerCase() === renamed.toLowerCase())) return;
        c.name = renamed;
        // Everything files itself by the category's NAME, so a rename has to
        // carry those references with it or they point at nothing.
        for (const t of db.trades) if (t.category === name) t.category = renamed;
        for (const l of db.costLines) if (l.category === name) l.category = renamed;
      }
    }, "Category saved");
  }

  /** Refused while any trade or budget line is still filed under it. */
  removeCategory(name: string): boolean {
    if (!this.canManageContacts) return false;
    if (categoryUsage(this.db, name).total > 0) return false;
    let ok = false;
    this.mutate((db) => {
      const cats = this.ensureCategories(db);
      const before = cats.length;
      db.categories = cats.filter((c) => c.name !== name);
      ok = db.categories.length < before;
    }, "Category removed");
    return ok;
  }

  /** Remove a trade the project does not use. Refused while anything still
   *  points at it: the alternative is cascading the delete through budget
   *  lines, schedule bars and materials, which is a far bigger action than the
   *  one being asked for. */
  removeTrade(id: string): boolean {
    if (!this.canManageContacts) return false;
    if (tradeUsage(this.db, id).total > 0) return false;
    let done = false;
    this.mutate((db) => {
      const before = db.trades.length;
      db.trades = db.trades.filter((t) => t.id !== id);
      db.scope = (db.scope ?? []).filter((c) => c.tradeId !== id);
      db.scopeTemplates = (db.scopeTemplates ?? []).filter((t) => t.tradeId !== id);
      db.rom = (db.rom ?? []).filter((r) => r.tradeId !== id);
      done = db.trades.length < before;
    }, "Trade removed");
    return done;
  }

  updateTrade(id: string, patch: Partial<Trade>) {
    if (!this.canManageContacts) return;
    this.mutate((db) => {
      const t = db.trades.find((x) => x.id === id);
      if (!t) return;
      const wasCategory = t.category;
      Object.assign(t, patch);
      // Moving a trade to another category carries its budget lines with it.
      // A cost line stores its own category, so without this the trade and its
      // own money would sit under two different headings — the drift this app
      // spends its time avoiding. Lines deliberately filed elsewhere keep their
      // own category, because they never matched the trade's to begin with.
      if (patch.category && patch.category !== wasCategory) {
        for (const l of db.costLines) {
          if (l.tradeId === id && l.category === wasCategory) l.category = patch.category;
        }
      }
    });
  }
  /** Set a trade owner/builder-managed and keep its trade users' managedBy in sync. */
  setTradeManaged(tradeId: string, managedBy: "builder" | "owner") {
    if (!this.canManageContacts) return;
    this.mutate((db) => {
      const t = db.trades.find((x) => x.id === tradeId);
      if (t) t.managedBy = managedBy;
      db.users.filter((u) => u.role === "trade" && u.tradeIds?.includes(tradeId)).forEach((u) => { u.managedBy = managedBy; });
    });
  }
  /** Add a new version; if the artifact is watched, notify the team + its trades. */
  addArtifactVersion(id: string, v: Omit<ArtifactVersion, "id" | "uploadedAt" | "uploadedBy">, by: string) {
    this.mutate((db) => {
      const a = db.artifacts.find((x) => x.id === id);
      if (!a) return;
      a.versions = [...(a.versions ?? []), { id: newId("ver"), uploadedAt: new Date().toISOString(), uploadedBy: by, ...v }];
      if (a.watch) {
        const msg = `📄 "${a.name}" updated to ${v.label} by ${by}. Review in Artifacts.`;
        this.notify(db, { toRole: "owner", kind: "info", message: msg });
        if (db.users.some((u) => u.role === "builder")) this.notify(db, { toRole: "builder", kind: "info", message: msg });
        for (const tid of a.tradeIds ?? []) {
          const u = db.users.find((x) => x.tradeIds?.includes(tid));
          if (u) this.notify(db, { toUserId: u.id, kind: "info", message: msg });
        }
      }
    });
  }
  addDrawingPin(id: string, pin: Omit<DrawingPin, "id" | "at">) {
    this.mutate((db) => {
      const a = db.artifacts.find((x) => x.id === id);
      if (!a) return;
      a.pins = [...(a.pins ?? []), { id: newId("pin"), at: new Date().toISOString(), ...pin }];
      if (pin.kind === "change") this.notify(db, { toRole: "builder", kind: "info", module: "artifacts", message: `📌 Change request pinned on "${a.name}" by ${pin.by}.` });
    });
  }
  updateDrawingPin(artId: string, pinId: string, patch: Partial<DrawingPin>) {
    this.mutate((db) => { const p = db.artifacts.find((x) => x.id === artId)?.pins?.find((y) => y.id === pinId); if (p) Object.assign(p, patch); });
  }
  removeDrawingPin(artId: string, pinId: string) {
    this.mutate((db) => { const a = db.artifacts.find((x) => x.id === artId); if (a?.pins) a.pins = a.pins.filter((p) => p.id !== pinId); });
  }
  setDrawingScribble(id: string, dataUrl: string | undefined) {
    this.mutate((db) => { const a = db.artifacts.find((x) => x.id === id); if (a) a.scribble = dataUrl; });
  }
  setRoomZone(id: string, zone: RoomZone) {
    this.mutate((db) => {
      const a = db.artifacts.find((x) => x.id === id);
      if (!a) return;
      a.zones = [...(a.zones ?? []).filter((z) => z.roomId !== zone.roomId), zone];
    });
  }
  removeRoomZone(id: string, roomId: string) {
    this.mutate((db) => { const a = db.artifacts.find((x) => x.id === id); if (a?.zones) a.zones = a.zones.filter((z) => z.roomId !== roomId); });
  }
  setScopeDrawing(tradeId: string, artifactId: string | undefined) {
    this.mutate((db) => { const ag = this.ensureAgreement(db, tradeId); ag.scopeDrawingId = artifactId; });
  }
  /** Attach a photo to a cost line as a project photo artifact. */
  addLinePhoto(opts: { lineId: string; roomId?: string; dataUrl: string; name: string; linkedDrawingId?: string; by: string }) {
    this.mutate((db) => {
      const line = db.costLines.find((l) => l.id === opts.lineId);
      db.artifacts.unshift({
        id: newId("art"), name: opts.name, kind: "photo", source: opts.by, date: new Date().toISOString().slice(0, 10),
        lineId: opts.lineId, roomId: opts.roomId, linkedDrawingId: opts.linkedDrawingId, tradeIds: line?.tradeId ? [line.tradeId] : undefined,
        versions: [{ id: newId("ver"), label: "v1", uploadedAt: new Date().toISOString(), uploadedBy: opts.by, fileUrl: opts.dataUrl, fileName: opts.name }],
      });
    });
  }

  // ---- Budget ----
  updateFunding(id: string, patch: Partial<FundingSource>) {
    this.mutate((db) => {
      const f = db.funding.find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    });
  }
  addFunding(f: Omit<FundingSource, "id">) {
    this.mutate((db) => {
      db.funding.push({ id: newId("f"), ...f });
    });
  }
  removeFunding(id: string) {
    this.mutate((db) => {
      db.funding = db.funding.filter((f) => f.id !== id);
    });
  }
  setBuffer(pct: number) {
    this.mutate((db) => {
      db.project.bufferPct = pct;
    });
  }
  /** Set the builder's markup once — applied to every builder-managed pass-through line. */
  setBuilderMarkup(pct: number) {
    this.mutate((db) => {
      db.project.builderMarkupPct = pct;
      db.costLines.forEach((l) => { if (l.owner === "builder" && l.markupModel === "passthrough") l.markupPct = pct; });
    });
  }
  /** Set the draw order: liquidityRank = position in the given id list. */
  setFundingRanks(orderedIds: string[]) {
    this.mutate((db) => {
      orderedIds.forEach((id, i) => { const f = db.funding.find((x) => x.id === id); if (f) f.liquidityRank = i + 1; });
    });
  }

  // ---- Schedule (Gantt) ----
  setScheduleStatus(id: string, status: ScheduleStatus) {
    this.mutate((db) => {
      const s = db.schedule.find((x) => x.id === id);
      if (s) s.status = status;
    });
  }

  /** Direct dependents of a schedule item (tasks listing it as a dependency). */
  dependentsOf(id: string): ScheduleItem[] {
    return this.db.schedule.filter((s) => (s.deps ?? []).includes(id));
  }

  /**
   * Builder moves a task's dates. If a trade is assigned, the change goes
   * "pending" and the trade is notified to confirm; otherwise it auto-confirms
   * so the owner sees it immediately.
   */
  pushSchedule(id: string, start: string, end: string) {
    this.mutate((db) => {
      const s = db.schedule.find((x) => x.id === id);
      if (!s) return;
      const movedLater = end > (s.confirmedEnd ?? s.end) || start > (s.confirmedStart ?? s.start);
      s.start = start;
      s.end = end;
      if (s.assignedUserId) {
        s.confirm = "pending";
        this.notify(db, {
          toUserId: s.assignedUserId,
          kind: "schedule_pushed",
          message: `${this.session.displayName} ${movedLater ? "pushed back" : "rescheduled"} "${s.label}" to ${start} → ${end}. Please confirm.`,
          scheduleItemId: s.id,
        });
      } else {
        s.confirm = "confirmed";
        s.confirmedStart = start;
        s.confirmedEnd = end;
      }
    });
  }

  /** Edit-mode date change: set dates only (no notify/confirm). Batched until publish. */
  editSchedule(id: string, start: string, end: string) {
    this.mutate((db) => {
      const s = db.schedule.find((x) => x.id === id);
      if (s) { s.start = start; s.end = end; }
    });
  }

  /**
   * Publish a batch of edit-mode timing changes with a required reason:
   * records a revision, flags impacted tasks for trade re-confirmation, notifies
   * each impacted trade, and emails a summary to the client (stub notification).
   */
  publishScheduleEdits(
    changes: { itemId: string; label: string; fromStart: string; fromEnd: string; toStart: string; toEnd: string }[],
    reason: string,
    by: string,
  ) {
    if (!changes.length) return;
    this.mutate((db) => {
      const notifiedTradeIds: string[] = [];
      for (const c of changes) {
        const s = db.schedule.find((x) => x.id === c.itemId);
        if (!s) continue;
        if (s.assignedUserId) {
          s.confirm = "pending";
          this.notify(db, {
            toUserId: s.assignedUserId,
            kind: "schedule_pushed",
            message: `${by} changed "${s.label}" to ${c.toStart} → ${c.toEnd}. Reason: ${reason}. Please confirm.`,
            scheduleItemId: s.id,
          });
          if (s.tradeId) notifiedTradeIds.push(s.tradeId);
        } else {
          s.confirm = "confirmed";
          s.confirmedStart = s.start;
          s.confirmedEnd = s.end;
        }
      }
      // Email summary to the client (owner) — stubbed as an in-app notification.
      this.notify(db, {
        toRole: "owner",
        kind: "info",
        message: `📧 Schedule update emailed: ${changes.length} task(s) re-timed by ${by}. Reason: ${reason}.`,
      });
      db.scheduleRevisions.unshift({
        id: newId("rev"), at: new Date().toISOString(), by, reason, changes,
        notifiedTradeIds: [...new Set(notifiedTradeIds)], emailedClient: true,
      });
    });
  }

  /** Trade confirms or declines a proposed date change. */
  respondSchedule(id: string, accept: boolean, name: string) {
    this.mutate((db) => {
      const s = db.schedule.find((x) => x.id === id);
      if (!s) return;
      const now = new Date().toISOString();
      if (accept) {
        s.confirm = "confirmed";
        s.confirmedStart = s.start;
        s.confirmedEnd = s.end;
        s.confirmedAt = now;
        s.confirmedBy = name;
        this.notify(db, { toRole: "builder", kind: "schedule_confirmed", message: `${name} confirmed new dates for "${s.label}" (${s.start} → ${s.end}).`, scheduleItemId: s.id });
      } else {
        s.confirm = "declined";
        this.notify(db, { toRole: "builder", kind: "schedule_declined", message: `${name} declined the date change for "${s.label}". Please coordinate.`, scheduleItemId: s.id });
      }
    });
  }

  removeScheduleItem(id: string) {
    this.mutate((db) => {
      db.schedule = db.schedule.filter((s) => s.id !== id);
      db.schedule.forEach((s) => { if (s.deps) s.deps = s.deps.filter((d) => d !== id); });
    });
  }
  setScheduleDeps(id: string, deps: string[]) {
    this.mutate((db) => {
      const s = db.schedule.find((x) => x.id === id);
      if (s) s.deps = deps;
    });
  }
  setScheduleMaterialDeps(id: string, materialDeps: string[]) {
    this.mutate((db) => {
      const s = db.schedule.find((x) => x.id === id);
      if (s) s.materialDeps = materialDeps;
    });
  }

  // ---- Notifications ----
  private notify(db: DB, n: Omit<AppNotification, "id" | "createdAt" | "read">) {
    db.notifications.unshift({ id: newId("ntf"), createdAt: new Date().toISOString(), read: false, ...n });
  }
  notificationsFor(user: User | undefined, role: Role): AppNotification[] {
    return this.db.notifications.filter((n) => (n.toUserId && n.toUserId === user?.id) || (n.toRole && n.toRole === role));
  }
  markNotificationRead(id: string) {
    this.mutate((db) => {
      const n = db.notifications.find((x) => x.id === id);
      if (n) n.read = true;
    });
  }
  clearNotifications(user: User | undefined, role: Role) {
    this.mutate((db) => {
      db.notifications.forEach((n) => {
        if ((n.toUserId && n.toUserId === user?.id) || (n.toRole && n.toRole === role)) n.read = true;
      });
    });
  }
}

export const store = new Store();
