// ----------------------------------------------------------------------------
// Evergreen — domain types. One renovation "project" holds rooms, trades, a
// scope matrix (room × trade), building-cost lines (with markup + price
// history), contracts broken into funding phases, and an owner-only budget of
// financing sources. The whole DB is JSON-serialisable so the mock backend can
// round-trip it through localStorage and a Supabase backend can store it later.
// ----------------------------------------------------------------------------

// ---- People & access --------------------------------------------------------
export type Role = "full_admin" | "owner" | "builder" | "trade" | "viewer";

export const ROLE_LABEL: Record<Role, string> = {
  full_admin: "Full Admin",
  owner: "Owner",
  builder: "Builder / GC",
  trade: "Trade",
  viewer: "Viewer",
};

// Module keys used for access gating.
export type ModuleKey =
  | "dashboard"
  | "timing"
  | "artifacts"
  | "admin"
  | "materials"
  | "vendors"
  | "costs"
  | "budget"
  | "payments";

export type AccessLevel = "none" | "view" | "edit";

// A secondary contact attached to a user (alt person/number/email).
export interface Contact {
  id: string;
  label?: string; // e.g. "Office", "Foreman", "Spouse"
  name?: string;
  email?: string;
  phone?: string;
}

export interface User {
  id: string;
  name: string;
  email: string; // primary email
  phone?: string; // primary phone
  role: Role;
  /** Trade ids this user is responsible for (for trade accounts). */
  tradeIds?: string[];
  /** Who manages this trade's relationship — drives contact visibility. */
  managedBy?: "builder" | "owner";
  /** Additional people/numbers for this vendor. */
  secondaryContacts?: Contact[];
  /** Door / lockbox code the owner granted this user. */
  doorCode?: string;
  /** Per-module overrides; falls back to the role default when absent. */
  access?: Partial<Record<ModuleKey, AccessLevel>>;
}

// ---- Trades & rooms ---------------------------------------------------------
export type MacroCategory =
  | "Soft Costs"
  | "Site & Demo"
  | "Structure & Envelope"
  | "Mechanicals (MEP)"
  | "Interior Finishes"
  | "Exterior"
  | "Owner Items";

export interface Trade {
  id: string;
  name: string;
  category: MacroCategory;
  /** Who typically carries this trade's cost. */
  defaultOwner: "builder" | "owner";
}

export type RoomFloor = "Exterior" | "Basement" | "First Floor" | "Second Floor" | "Whole House";

export interface Room {
  id: string;
  name: string;
  floor: RoomFloor;
  /** True for rooms the user added (vs. the stock set). */
  custom?: boolean;
  /** Part of a new addition rather than existing footprint. */
  addition?: boolean;
}

// ---- Scope matrix (room × trade) -------------------------------------------
export type ScopeStatus = "in" | "out" | "existing" | "unset";

export const SCOPE_LABEL: Record<ScopeStatus, string> = {
  in: "In Scope",
  out: "Out of Scope",
  existing: "EX",
  unset: "—",
};

// A single checkable piece of a trade's work within a room. QC requires BOTH
// the owner and the builder to sign off.
export interface ScopeItem {
  id: string;
  label: string;
  included: boolean;
  done?: boolean;
  ownerSignedBy?: string;
  ownerSignedAt?: string;
  builderSignedBy?: string;
  builderSignedAt?: string;
}

export interface ScopeCell {
  roomId: string;
  tradeId: string;
  status: ScopeStatus;
  note?: string;
  items: ScopeItem[];
}

// Default checklist a trade brings to every room (the "trade scope template"
// you can apply to all rooms or copy to specific rooms).
export interface TradeScopeTemplate {
  tradeId: string;
  items: string[];
}

// ---- Building costs ---------------------------------------------------------
export type CostOwner = "builder" | "owner";
export type MarkupModel = "passthrough" | "blackbox";
// passthrough → markupPct applied on top of a transparent sub cost.
// blackbox    → quoted number already includes the builder's fee.

export interface PricePoint {
  label: string; // e.g. "Original Estimate", "Working ROM", "After Plan Review"
  date: string; // ISO or free text
  amount: number; // the sub/base cost at this point (pre-markup)
}

// A change order or found-saving, tracked as a numbered exhibit on the line's
// contract. `amount` is always positive; `kind` decides whether it adds or saves.
export interface ChangeOrder {
  id: string;
  exhibit: string; // "Exhibit A", "Exhibit B", …
  kind: "change" | "savings";
  title: string;
  desc?: string;
  amount: number; // positive dollars
  date: string;
  status: "proposed" | "approved";
}

// A portion of a line's budget the builder can group into a draw. Either a % of
// the line's current total or a hard dollar number.
export interface LinePhase {
  id: string;
  name: string;
  mode: "pct" | "amount";
  value: number; // percent (0-100) or dollars
}

export interface CostLine {
  id: string;
  name: string;
  tradeId: string;
  category: MacroCategory;
  owner: CostOwner;
  /** Rooms this line covers (tick boxes). Empty = whole project. */
  roomIds: string[];
  desc?: string;
  markupModel: MarkupModel;
  markupPct: number; // e.g. 20 for 20%
  /** Ordered low→high price evolution; last point is "current". */
  history: PricePoint[];
  /** For allowance-style lines not yet contracted. */
  allowanceLow?: number;
  allowanceHigh?: number;
  status: "estimate" | "allowance" | "contracted" | "complete";
  contractId?: string;
  /** Locked baseline (original budget). Set when the baseline is locked. */
  baseline?: number;
  locked?: boolean;
  /** Post-baseline adjustments, tracked as contract exhibits. */
  changeOrders: ChangeOrder[];
  /** The line's own contract document. */
  contractSummary?: string;
  contractMode?: "direct" | "appendix"; // direct trade contract vs builder's-paper appendix
  termsAppended?: boolean;
  /** Funding phases for this line (grouped into draws on the Payments tab). */
  phases: LinePhase[];
}

// A client payment that bundles one or more line phases. Once paid, those
// amounts lock (lines can still grow via change orders → new phases/draws).
export interface Draw {
  id: string;
  name: string;
  phaseRefs: { lineId: string; phaseId: string }[];
  status: "planned" | "invoiced" | "paid";
  paidDate?: string;
  note?: string;
}

// ---- Schedule (Gantt) -------------------------------------------------------
export type ScheduleStatus = "not_started" | "in_progress" | "blocked" | "done";

export const SCHEDULE_LABEL: Record<ScheduleStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

// What kind of bar this is — drives styling and whether it carries cost.
export type ScheduleKind = "work" | "procurement" | "milestone";

// Trade confirmation state for a date change. Builder edits dates → goes
// "pending" until the assigned trade confirms; only confirmed dates surface to
// the owner.
export type ConfirmState = "confirmed" | "pending" | "declined";

// One Gantt bar. `tradeId` pairs the task to Building Costs so its cost and QC
// progress are derived live from the cost lines + scope items rather than
// duplicated here. Milestones/procurement may have no trade.
export interface ScheduleItem {
  id: string;
  label: string; // real task name from the schedule
  tradeId?: string;
  kind: ScheduleKind;
  start: string; // ISO yyyy-mm-dd — builder's working dates
  end: string; // ISO yyyy-mm-dd
  durationLabel?: string;
  status: ScheduleStatus;
  /** Critical-path predecessors: other schedule item ids this depends on. */
  deps?: string[];
  /** Trade person responsible (for confirmation + notifications). */
  assignedUserId?: string;
  /** Dates the trade has confirmed — what the owner sees. */
  confirmedStart?: string;
  confirmedEnd?: string;
  confirm: ConfirmState;
  confirmedAt?: string;
  confirmedBy?: string;
  /** Optional link to a contract funding phase (gate / % release). */
  contractId?: string;
  phaseId?: string;
}

// In-app notification (email later). Targeted at a user or a whole role.
export interface AppNotification {
  id: string;
  toUserId?: string;
  toRole?: Role;
  kind: "schedule_pushed" | "schedule_confirmed" | "schedule_declined" | "info";
  message: string;
  scheduleItemId?: string;
  createdAt: string;
  read: boolean;
}

// ---- Contracts (master terms templates) ------------------------------------
// A vendor's master terms (anti-lien, change-order, good-faith policy). These
// are auto-appended to each cost line's own contract document.
export interface Contract {
  id: string;
  name: string; // builder / vendor name
  tradeIds: string[];
  terms: string;
  termsAccepted: boolean;
}

// ---- Owner budget (financing) ----------------------------------------------
export interface FundingSource {
  id: string;
  name: string;
  amount: number; // total available
  drawn: number; // already pulled
  /** Annualised cost of access (e.g. 0.07 = 7% APR). 0 for free cash. */
  rate: number;
  /** Lump cost-to-access if modelled as a flat figure. */
  costToAccess?: number;
  timeframe?: string;
  /** Lower = tap first (cash before HELOC). Drives the advisory ordering. */
  liquidityRank: number;
  note?: string;
}

// ---- Project & DB -----------------------------------------------------------
export interface Project {
  id: string;
  name: string;
  address: string;
  built?: string;
  bufferPct: number; // contingency buffer applied over building costs
}

export interface DB {
  project: Project;
  users: User[];
  trades: Trade[];
  rooms: Room[];
  scopeTemplates: TradeScopeTemplate[];
  scope: ScopeCell[];
  costLines: CostLine[];
  contracts: Contract[];
  funding: FundingSource[];
  schedule: ScheduleItem[];
  notifications: AppNotification[];
  draws: Draw[];
}

// ---- Session ----------------------------------------------------------------
export interface Session {
  role: Role;
  userId: string;
  displayName: string;
}

// Default per-role module access. Owner sees all; builder sees all but budget;
// trade sees scope/timing/materials/vendors (view); viewer is read-only-light.
export const ROLE_ACCESS: Record<Role, Record<ModuleKey, AccessLevel>> = {
  full_admin: {
    dashboard: "edit", timing: "edit", artifacts: "edit", admin: "edit",
    materials: "edit", vendors: "edit", costs: "edit", budget: "edit", payments: "edit",
  },
  owner: {
    dashboard: "edit", timing: "edit", artifacts: "edit", admin: "edit",
    materials: "edit", vendors: "edit", costs: "edit", budget: "edit", payments: "edit",
  },
  builder: {
    dashboard: "edit", timing: "edit", artifacts: "edit", admin: "edit",
    materials: "edit", vendors: "edit", costs: "edit", budget: "none", payments: "edit",
  },
  trade: {
    dashboard: "view", timing: "edit", artifacts: "view", admin: "none",
    materials: "edit", vendors: "view", costs: "none", budget: "none", payments: "none",
  },
  viewer: {
    dashboard: "view", timing: "view", artifacts: "view", admin: "none",
    materials: "view", vendors: "view", costs: "none", budget: "none", payments: "none",
  },
};

export function accessFor(user: User | undefined, role: Role, mod: ModuleKey): AccessLevel {
  return user?.access?.[mod] ?? ROLE_ACCESS[role][mod];
}

// Can the viewer remove the target user?
//  • full_admin removes anyone (except themselves)
//  • owner removes the builder and owner-managed trades
//  • builder removes trades (any trade)
export function canRemoveUser(viewerRole: Role, viewer: User | undefined, target: User): boolean {
  if (viewer && target.id === viewer.id) return false;
  if (viewerRole === "full_admin") return true;
  if (viewerRole === "owner") return target.role === "builder" || (target.role === "trade" && target.managedBy === "owner");
  if (viewerRole === "builder") return target.role === "trade";
  return false;
}

// Can the viewer see this user's contact numbers/emails?
//  • full_admin + builder see all trade contacts
//  • owner sees only owner-managed trade contacts (not builder-managed)
//  • non-trade users' contacts are visible to admins
export function canSeeContacts(viewerRole: Role, target: User): boolean {
  if (viewerRole === "full_admin" || viewerRole === "builder") return true;
  if (viewerRole === "owner") return target.role !== "trade" || target.managedBy === "owner";
  return false;
}
