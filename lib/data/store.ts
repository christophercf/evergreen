// ----------------------------------------------------------------------------
// Evergreen store — the single client-side state the React app subscribes to.
// Delegates load/persist/sync to a Backend (mock or supabase) and exposes typed
// mutations. Every mutation clones the DB, applies, persists, and bumps the
// version so useSyncExternalStore re-renders.
// ----------------------------------------------------------------------------

import type {
  AccessLevel, AppNotification, Artifact, ChangeOrder, Contact, Contract, CostLine, DB, Draw, FundingSource,
  LinePhase, Material, ModuleKey, PricePoint, Role, Room, ScheduleItem, ScheduleStatus, ScopeStatus,
  Session, User,
} from "./types";
import { buildDB } from "./seed";
import { lineTotal, lineCurrent, phaseAmount } from "./money";
import { type Backend, makeBackend, defaultSession } from "./backend";
import { authEnabled, authOnChange, authSignOut } from "./auth";

type Listener = () => void;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
let uid = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${uid++}`;

class Store {
  db: DB = buildDB();
  session: Session = defaultSession();
  version = 0;
  /** Set when a verified user signs in but their email isn't on the project. */
  authNoAccess: string | null = null;

  private backend: Backend | null = null;
  private listeners = new Set<Listener>();
  private started = false;
  // Global undo: snapshot of db (JSON) before each mutation.
  private undoStack: string[] = [];

  get mode(): "mock" | "supabase" {
    return this.backend?.mode ?? "mock";
  }

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.backend = makeBackend();
    const pDB = this.backend.loadDB().then((db) => { this.db = db; });
    const pS = this.backend.loadSession().then((s) => { this.session = s; });
    void Promise.all([pDB, pS]).then(() => {
      if (authEnabled()) {
        // Real auth: the Supabase session is the source of truth. Don't trust a
        // persisted app session; bind/unbind as auth state changes.
        this.session = { ...this.session, authed: false };
        authOnChange((email) => { if (email) this.bindAuthEmail(email); else this.unbindAuth(); });
      } else if (typeof window !== "undefined") {
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

  private mutate(fn: (db: DB) => void) {
    this.undoStack.push(JSON.stringify(this.db));
    if (this.undoStack.length > 40) this.undoStack.shift();
    const next = clone(this.db);
    fn(next);
    this.db = next;
    void this.backend?.persistDB(next);
    this.emit();
  }

  // ---- Global undo (all tabs) ----
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  undo() {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.db = JSON.parse(prev) as DB;
    void this.backend?.persistDB(this.db);
    this.emit();
  }

  // ---- Session ----
  get currentUser(): User | undefined {
    return this.db.users.find((u) => u.id === this.session.userId);
  }

  setRole(role: Role) {
    // "View as" (admin impersonation / demo). Jumps to a representative user.
    const u = this.db.users.find((x) => x.role === role) ?? this.currentUser;
    this.session = { ...this.session, role, userId: u?.id ?? this.session.userId, displayName: u?.name ?? this.session.displayName };
    void this.backend?.persistSession(this.session);
    this.emit();
  }

  setUser(userId: string) {
    const u = this.db.users.find((x) => x.id === userId);
    if (!u) return;
    this.session = { ...this.session, role: u.role, userId: u.id, displayName: u.name };
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
    void this.backend?.persistSession(this.session);
    void authSignOut();
    this.emit();
  }

  /** Is this email on the project (invited or active)? Gates invite-only signup. */
  isKnownEmail(email: string): boolean {
    const e = email.trim().toLowerCase();
    return this.db.users.some((u) => u.email.trim().toLowerCase() === e);
  }
  /** Bind a verified Supabase session to its app user (role/permissions). */
  bindAuthEmail(email: string): boolean {
    const u = this.db.users.find((x) => x.email.trim().toLowerCase() === email.trim().toLowerCase());
    if (!u) { this.session = { ...this.session, authed: false }; this.authNoAccess = email; this.emit(); return false; }
    if (u.status === "invited") this.mutate((db) => { const x = db.users.find((y) => y.id === u.id); if (x) { x.status = "active"; x.inviteToken = undefined; } });
    const fresh = this.db.users.find((x) => x.id === u.id)!;
    this.session = { role: fresh.role, userId: fresh.id, displayName: fresh.name, authed: true };
    this.authNoAccess = null;
    void this.backend?.persistSession(this.session);
    this.emit();
    return true;
  }
  unbindAuth() {
    this.session = { ...this.session, authed: false };
    this.emit();
  }

  /** Invite a user; returns the invite token for a shareable link. */
  inviteUser(u: { name: string; email: string; role: Role; tradeIds?: string[]; managedBy?: "builder" | "owner" }): string {
    const token = `inv-${Math.random().toString(36).slice(2, 10)}`;
    this.mutate((db) => { db.users.push({ id: newId("u"), name: u.name.trim(), email: u.email.trim(), role: u.role, tradeIds: u.tradeIds, managedBy: u.managedBy, status: "invited", inviteToken: token }); });
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
  setUserAccess(userId: string, mod: ModuleKey, level: AccessLevel) {
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
    this.mutate((db) => {
      const u = db.users.find((x) => x.id === userId);
      if (u) Object.assign(u, patch);
    });
  }
  addUser(u: Omit<User, "id">) {
    this.mutate((db) => {
      db.users.push({ id: newId("u"), ...u });
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
  addChangeOrder(lineId: string, co: Omit<ChangeOrder, "id" | "exhibit">) {
    this.mutate((db) => {
      const l = db.costLines.find((x) => x.id === lineId);
      if (!l) return;
      const exhibit = `Exhibit ${String.fromCharCode(65 + l.changeOrders.length)}`;
      l.changeOrders.push({ id: newId("co"), exhibit, ...co });
    });
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
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === id);
      if (!d) return;
      d.status = status;
      d.paidDate = status === "paid" ? new Date().toISOString().slice(0, 10) : d.paidDate;
    });
  }
  /** Drop a budget line into a draw (default 0% allocation). Skips paid draws. */
  addAllocation(drawId: string, lineId: string, mode: "pct" | "flat" = "pct", value = 0) {
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      if (!d || d.status === "paid") return;
      if (!d.allocations.some((a) => a.lineId === lineId)) d.allocations.push({ lineId, mode, value });
    });
  }
  setAllocation(drawId: string, lineId: string, patch: Partial<{ mode: "pct" | "flat"; value: number }>) {
    this.mutate((db) => {
      const a = db.draws.find((x) => x.id === drawId)?.allocations.find((y) => y.lineId === lineId);
      if (a) Object.assign(a, patch);
    });
  }
  removeAllocation(drawId: string, lineId: string) {
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      if (d && d.status !== "paid") d.allocations = d.allocations.filter((a) => a.lineId !== lineId);
    });
  }
  /** Push a draw → create the first round of trade contracts for its lines. */
  pushDraw(drawId: string, byName: string): { trades: number } {
    let trades = 0;
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      if (!d) return;
      d.status = "pushed";
      d.pushedDate = new Date().toISOString().slice(0, 10);
      const tradeIds = [...new Set(d.allocations.map((a) => db.costLines.find((l) => l.id === a.lineId)?.tradeId).filter(Boolean) as string[])];
      trades = tradeIds.length;
      for (const tradeId of tradeIds) {
        const a = this.ensureAgreement(db, tradeId);
        if (!a.round1.some((s) => s.party === "builder")) a.round1.push({ party: "builder", name: byName, at: new Date().toISOString() });
        const tradeUser = db.users.find((u) => u.tradeIds?.includes(tradeId));
        this.notify(db, { toUserId: tradeUser?.id, toRole: tradeUser ? undefined : "trade", kind: "info", message: `📄 Contract issued for "${d.name}". Please review & sign Round 1 (scope & cost) in Vendor Management.`, });
      }
    });
    return { trades };
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
  /** Designer signs off (or revokes) on a material selection. */
  setMaterialApproved(id: string, approved: boolean, by: string) {
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === id);
      if (!m) return;
      m.designerApproved = approved;
      m.approvalRequested = false;
      if (approved) this.notify(db, { toRole: "builder", kind: "info", message: `✓ ${by} approved "${m.item}".` });
    });
  }
  requestMaterialApproval(id: string, by: string) {
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === id);
      if (!m) return;
      m.approvalRequested = true;
      const designer = db.users.find((u) => u.role === "viewer");
      this.notify(db, { toUserId: designer?.id, toRole: designer ? undefined : "viewer", kind: "info", message: `🎨 ${by} requests designer approval for "${m.item}".` });
    });
  }
  /** Anyone (trade/designer/builder) can request details/specs for an item. */
  requestMaterialDetails(id: string, by: string) {
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === id);
      if (!m) return;
      this.notify(db, { toRole: "builder", kind: "info", message: `❓ ${by} requested details for "${m.item}".` });
    });
  }
  /** Stub: "pull" image + specs from the product URL (real fetch comes later). */
  fetchMaterialFromUrl(id: string) {
    this.mutate((db) => {
      const m = db.materials.find((x) => x.id === id);
      if (!m || !m.specLink) return;
      let host = "store";
      try { host = new URL(m.specLink).hostname.replace("www.", ""); } catch { /* ignore */ }
      m.imageUrl = `https://placehold.co/320x220/efe8d6/3a2f25?text=${encodeURIComponent(m.item.slice(0, 20))}`;
      m.specs = m.specs || `Fetched from ${host} (stub). Wire a live fetch/AI to pull real title, image, dimensions, finish, and price.`;
    });
  }
  toggleMaterialCritical(id: string) {
    this.mutate((db) => { const m = db.materials.find((x) => x.id === id); if (m) m.critical = !m.critical; });
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
  signVendorRound(tradeId: string, round: 1 | 2, party: "builder" | "trade" | "owner", name: string) {
    this.mutate((db) => {
      const a = this.ensureAgreement(db, tradeId);
      const arr = round === 1 ? a.round1 : a.round2;
      const i = arr.findIndex((s) => s.party === party);
      if (i >= 0) arr.splice(i, 1);
      else arr.push({ party, name, at: new Date().toISOString() });
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

  addScheduleItem(item: Omit<ScheduleItem, "id">) {
    this.mutate((db) => {
      db.schedule.push({ id: newId("sch"), ...item });
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
