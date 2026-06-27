// ----------------------------------------------------------------------------
// Evergreen — domain types. One renovation "project" holds rooms, trades, a
// scope matrix (room × trade), building-cost lines (with markup + price
// history), contracts broken into funding phases, and an owner-only budget of
// financing sources. The whole DB is JSON-serialisable so the mock backend can
// round-trip it through localStorage and a Supabase backend can store it later.
// ----------------------------------------------------------------------------

// ---- People & access --------------------------------------------------------
export type Role = "owner" | "builder" | "trade" | "viewer";

export const ROLE_LABEL: Record<Role, string> = {
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
  | "budget";

export type AccessLevel = "none" | "view" | "edit";

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  /** Trade ids this user is responsible for (for trade accounts). */
  tradeIds?: string[];
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
  existing: "Use Existing",
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

// One Gantt bar. `tradeId` pairs the task to Building Costs so its cost and QC
// progress are derived live from the cost lines + scope items rather than
// duplicated here. Milestones/procurement may have no trade.
export interface ScheduleItem {
  id: string;
  label: string; // real task name from the schedule
  tradeId?: string;
  kind: ScheduleKind;
  start: string; // ISO yyyy-mm-dd
  end: string; // ISO yyyy-mm-dd
  durationLabel?: string;
  status: ScheduleStatus;
  /** Optional link to a contract funding phase (gate / % release). */
  contractId?: string;
  phaseId?: string;
}

// ---- Contracts & funding phases --------------------------------------------
export interface ContractPhase {
  id: string;
  name: string; // "Phase 1 — Mobilization"
  pct: number; // % of contract total released at this phase
  gate: string; // what must be complete to release the next round
  released: boolean;
}

export interface Contract {
  id: string;
  name: string; // builder / vendor name
  tradeIds: string[];
  terms: string;
  /** Anti-lien / change-order / good-faith policy acceptance. */
  termsAccepted: boolean;
  phases: ContractPhase[];
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
  owner: {
    dashboard: "edit", timing: "edit", artifacts: "edit", admin: "edit",
    materials: "edit", vendors: "edit", costs: "edit", budget: "edit",
  },
  builder: {
    dashboard: "edit", timing: "edit", artifacts: "edit", admin: "edit",
    materials: "edit", vendors: "edit", costs: "edit", budget: "none",
  },
  trade: {
    dashboard: "view", timing: "edit", artifacts: "view", admin: "none",
    materials: "edit", vendors: "view", costs: "none", budget: "none",
  },
  viewer: {
    dashboard: "view", timing: "view", artifacts: "view", admin: "none",
    materials: "view", vendors: "view", costs: "none", budget: "none",
  },
};

export function accessFor(user: User | undefined, role: Role, mod: ModuleKey): AccessLevel {
  return user?.access?.[mod] ?? ROLE_ACCESS[role][mod];
}
