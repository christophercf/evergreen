// ----------------------------------------------------------------------------
// Evergreen store — the single client-side state the React app subscribes to.
// Delegates load/persist/sync to a Backend (mock or supabase) and exposes typed
// mutations. Every mutation clones the DB, applies, persists, and bumps the
// version so useSyncExternalStore re-renders.
// ----------------------------------------------------------------------------

import type {
  AccessLevel, AppNotification, ChangeOrder, Contact, Contract, CostLine, DB, Draw, FundingSource,
  LinePhase, ModuleKey, PricePoint, Role, Room, ScheduleItem, ScheduleStatus, ScopeStatus,
  Session, User,
} from "./types";
import { buildDB } from "./seed";
import { lineTotal, lineCurrent, phaseAmount } from "./money";
import { type Backend, makeBackend, defaultSession } from "./backend";

type Listener = () => void;

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
let uid = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${uid++}`;

class Store {
  db: DB = buildDB();
  session: Session = defaultSession();
  version = 0;

  private backend: Backend | null = null;
  private listeners = new Set<Listener>();
  private started = false;

  get mode(): "mock" | "supabase" {
    return this.backend?.mode ?? "mock";
  }

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.backend = makeBackend();
    void this.backend.loadDB().then((db) => {
      this.db = db;
      this.emit();
    });
    void this.backend.loadSession().then((s) => {
      this.session = s;
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
    const next = clone(this.db);
    fn(next);
    this.db = next;
    void this.backend?.persistDB(next);
    this.emit();
  }

  // ---- Session ----
  get currentUser(): User | undefined {
    return this.db.users.find((u) => u.id === this.session.userId);
  }

  setRole(role: Role) {
    // Jump to a representative user of that role for a believable persona.
    const u = this.db.users.find((x) => x.role === role) ?? this.currentUser;
    this.session = { role, userId: u?.id ?? this.session.userId, displayName: u?.name ?? this.session.displayName };
    void this.backend?.persistSession(this.session);
    this.emit();
  }

  setUser(userId: string) {
    const u = this.db.users.find((x) => x.id === userId);
    if (!u) return;
    this.session = { role: u.role, userId: u.id, displayName: u.name };
    void this.backend?.persistSession(this.session);
    this.emit();
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
  // Lightweight undo for the scope matrix: snapshot db.scope before each change.
  private scopeHistory: string[] = [];
  scopeClipboard: { status: ScopeStatus; items: { label: string; included: boolean }[] } | null = null;

  private recordScope() {
    this.scopeHistory.push(JSON.stringify(this.db.scope));
    if (this.scopeHistory.length > 40) this.scopeHistory.shift();
  }
  get canUndoScope(): boolean {
    return this.scopeHistory.length > 0;
  }
  undoScope() {
    const prev = this.scopeHistory.pop();
    if (!prev) return;
    this.mutate((db) => { db.scope = JSON.parse(prev); });
  }

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
    this.recordScope();
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
    this.recordScope();
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
    this.recordScope();
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
    this.recordScope();
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
    this.recordScope();
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
      // Drop any draw references to the removed phase.
      db.draws.forEach((d) => { d.phaseRefs = d.phaseRefs.filter((r) => !(r.lineId === lineId && r.phaseId === phaseId)); });
    });
  }

  // ---- Draws (Payment Tracker) ----
  addDraw(name: string) {
    this.mutate((db) => { db.draws.push({ id: newId("draw"), name, phaseRefs: [], status: "planned" }); });
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
      d.paidDate = status === "paid" ? new Date().toISOString().slice(0, 10) : undefined;
    });
  }
  togglePhaseInDraw(drawId: string, lineId: string, phaseId: string) {
    this.mutate((db) => {
      const d = db.draws.find((x) => x.id === drawId);
      if (!d || d.status === "paid") return; // paid draws are locked
      const i = d.phaseRefs.findIndex((r) => r.lineId === lineId && r.phaseId === phaseId);
      if (i >= 0) d.phaseRefs.splice(i, 1);
      else {
        // a phase can only belong to one draw
        db.draws.forEach((o) => { o.phaseRefs = o.phaseRefs.filter((r) => !(r.lineId === lineId && r.phaseId === phaseId)); });
        d.phaseRefs.push({ lineId, phaseId });
      }
    });
  }
  /** Phases already committed to a PAID draw (locked, can't be re-drawn). */
  phaseInPaidDraw(lineId: string, phaseId: string): boolean {
    return this.db.draws.some((d) => d.status === "paid" && d.phaseRefs.some((r) => r.lineId === lineId && r.phaseId === phaseId));
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
