// ----------------------------------------------------------------------------
// Evergreen store — the single client-side state the React app subscribes to.
// Delegates load/persist/sync to a Backend (mock or supabase) and exposes typed
// mutations. Every mutation clones the DB, applies, persists, and bumps the
// version so useSyncExternalStore re-renders.
// ----------------------------------------------------------------------------

import type {
  AccessLevel, Contract, CostLine, DB, FundingSource, ModuleKey, PricePoint,
  Role, Room, ScheduleItem, ScheduleStatus, ScopeStatus, Session, User,
} from "./types";
import { buildDB } from "./seed";
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
  addRoom(name: string, floor: Room["floor"]) {
    this.mutate((db) => {
      db.rooms.push({ id: newId("room"), name, floor, custom: true });
    });
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
      const cell = this.ensureCell(db, roomId, tradeId);
      cell.status = status;
      cell.items.forEach((it) => (it.included = status === "in"));
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

  signoffScopeItem(roomId: string, tradeId: string, itemId: string, party: "owner" | "builder", name: string) {
    this.mutate((db) => {
      const cell = this.ensureCell(db, roomId, tradeId);
      const it = cell.items.find((x) => x.id === itemId);
      if (!it) return;
      const now = new Date().toISOString().slice(0, 10);
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
  addCostLine(l: Omit<CostLine, "id">) {
    this.mutate((db) => {
      db.costLines.push({ id: newId("cl"), ...l });
    });
  }
  removeCostLine(id: string) {
    this.mutate((db) => {
      db.costLines = db.costLines.filter((l) => l.id !== id);
    });
  }

  // ---- Contracts ----
  togglePhaseReleased(contractId: string, phaseId: string) {
    this.mutate((db) => {
      const c = db.contracts.find((x) => x.id === contractId);
      const p = c?.phases.find((x) => x.id === phaseId);
      if (p) p.released = !p.released;
    });
  }
  setTermsAccepted(contractId: string, accepted: boolean) {
    this.mutate((db) => {
      const c = db.contracts.find((x) => x.id === contractId);
      if (c) c.termsAccepted = accepted;
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
  setScheduleDates(id: string, start: string, end: string) {
    this.mutate((db) => {
      const s = db.schedule.find((x) => x.id === id);
      if (s) { s.start = start; s.end = end; }
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
    });
  }
}

export const store = new Store();
