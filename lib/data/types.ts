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
  /** Account status. active = can log in; invited = awaiting accept; pending = self-signup awaiting approval. */
  status?: "active" | "invited" | "pending";
  /** One-time token for an invite link. */
  inviteToken?: string;
  /** Adopted e-signature (data URL from the signature pad), saved to profile. */
  signature?: string;
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
  /** Who manages this trade's relationship. "owner" → shown as "Owner Managed". */
  managedBy?: "builder" | "owner";
  /** True for trades the owner/builder added beyond the stock set. */
  custom?: boolean;
}

// ---- Contacts & billing -----------------------------------------------------
// Billing details that flow onto invoices, contracts and draw remittance.
export interface BillingDetails {
  payableTo?: string;    // legal entity invoices are payable to
  email?: string;        // invoice / billing email
  phone?: string;
  address?: string;
  taxId?: string;        // EIN / tax id
  paymentTerms?: string; // "Net 30", "40% deposit, balance on completion"
  remittance?: string;   // ACH / check-to / account ref
}
// A person on a vendor's crew; appAccess flags who should be invited to the app.
export interface Worker {
  id: string;
  name: string;
  role?: string;         // "Foreman", "Lead electrician"
  email?: string;
  phone?: string;
  appAccess?: boolean;   // should be granted access to the app
}
// A managed contact sheet: the GC's own org, the owner's, or a vendor.
export interface ContactSheet {
  id: string;
  party: "builder" | "owner" | "vendor";
  tradeId?: string;      // for vendor sheets — the trade they cover
  company: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  billing?: BillingDetails;
  workers?: Worker[];
  /** Builder shared this contact with the whole team (otherwise builder/owner-only). */
  shareAll?: boolean;
  notes?: string;
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
  /** The agreed locked cost (pre-markup, Oasis cost). Set when a line is locked;
   *  from then on changes flow through change orders only. */
  lockedCost?: number;
  lockedAt?: string;
  lockedBy?: string;
  /** Post-baseline adjustments, tracked as contract exhibits. */
  changeOrders: ChangeOrder[];
  /** The line's own contract document. */
  contractSummary?: string;
  contractMode?: "direct" | "appendix"; // direct trade contract vs builder's-paper appendix
  termsAppended?: boolean;
  /** Funding phases for this line (grouped into draws on the Payments tab). */
  phases: LinePhase[];
  /** Dollars paid directly for this line, outside the draw schedule (e.g. owner-paid
   *  items). Counts toward "paid" without creating a draw. */
  directPaid?: number;
  directPaidDate?: string;
  directPaidNote?: string;
}

// ---- Vendor management ------------------------------------------------------
// A digital signature on a contract round.
export interface VendorSig {
  party: "builder" | "trade" | "owner";
  name: string;
  at: string;
  /** Adopted signature image (data URL), copied from the signer's profile. */
  signatureImg?: string;
}

// Per-trade vendor agreement, signed in two rounds:
//  round1 = scope + total cost; round2 = draw schedule + start/finish dates.
export interface VendorAgreement {
  tradeId: string;
  /** Vendor's requested draw parameters — advises the builder's draw plan. */
  drawRequest?: string;
  startDate?: string;
  finishDate?: string;
  round1: VendorSig[];
  round2: VendorSig[];
  /** A scope-drawing artifact appended visually to this trade's contract. */
  scopeDrawingId?: string;
}

// A client payment (draw) that allocates a portion of one or more budget lines.
// Each allocation is a % or flat $ of that line's current total. "Pushing" a
// draw creates the first round of trade contracts. Paid draws lock.
export interface DrawAllocation {
  lineId: string;
  mode: "pct" | "flat";
  value: number; // percent (0-100) or dollars
  /** Builder's clarification: which scope-item labels of this line are covered. */
  includedScope?: string[];
  /** Free-text note about what this allocation covers. */
  note?: string;
}
export interface Draw {
  id: string;
  name: string;
  allocations: DrawAllocation[];
  status: "planned" | "pushed" | "paid";
  pushedDate?: string;
  paidDate?: string;
  note?: string;
}

// ---- Artifacts (document library) -------------------------------------------
export type ArtifactKind = "drawing" | "survey" | "permit" | "design" | "photo" | "contract" | "other";

export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  drawing: "Architectural Drawings", survey: "Survey", permit: "Permits", design: "Design", photo: "Photos", contract: "Contracts", other: "Other",
};

// One stored revision of an artifact. The file may be an inline data URL (small
// compressed image), a direct URL, or a Google Drive link.
export interface ArtifactVersion {
  id: string;
  label: string;        // "v1", "v2 — after plan review"
  uploadedAt: string;
  uploadedBy: string;
  fileUrl?: string;     // data URL or direct file/image URL
  driveUrl?: string;    // Google Drive (or other cloud) link
  fileName?: string;
  note?: string;
}

// A markup pin placed on an architectural drawing (percent coordinates).
export type PinKind = "comment" | "photo" | "change";
export interface DrawingPin {
  id: string;
  x: number;            // 0..100 (% of image width)
  y: number;            // 0..100 (% of image height)
  kind: PinKind;
  text?: string;
  photo?: string;       // data URL of an appended photo detail
  by: string;
  at: string;
  tradeId?: string;
  resolved?: boolean;
}

// A room region mapped onto a drawing, so a vendor's scope can be shaded.
export interface RoomZone {
  roomId: string;
  x: number; y: number; w: number; h: number; // percent rect
}

export interface Artifact {
  id: string;
  name: string;
  kind: ArtifactKind;
  url?: string; // legacy single link (kept for back-compat; new uploads use versions)
  source?: string; // who produced it
  date?: string;
  version?: string; // legacy single version label
  notes?: string;
  /** Roles allowed to view. Empty/undefined = whole team. */
  audience?: Role[];
  /** Restrict to specific trades (in addition to roles). Empty = all trades. */
  tradeIds?: string[];
  /** Full revision history; the last entry is current. */
  versions?: ArtifactVersion[];
  /** Notify the team whenever a new version is uploaded. */
  watch?: boolean;
  /** Archived documents are hidden from the main library but kept on record. */
  archived?: boolean;
  /** AI-generated plain-language summary of the document. */
  summary?: string;
  // --- Permit extras ---
  /** Whether this permit has been issued or is still pending. */
  permitStatus?: "pending" | "issued";
  /** The general construction permit that covers the whole project (no one-offs). */
  isGeneralPermit?: boolean;
  /** Trades whose work this permit gates (can't start until issued). */
  gatesTradeIds?: string[];
  // --- Architectural-drawing extras ---
  pins?: DrawingPin[];
  scribble?: string;        // data URL of a freehand annotation overlay
  zones?: RoomZone[];       // room regions mapped onto the drawing
  // --- Photo extras ---
  lineId?: string;          // cost line this photo documents
  roomId?: string;          // room this photo documents
  linkedDrawingId?: string; // drawing this photo is tagged to
}

// ---- Materials --------------------------------------------------------------
export type MaterialStatus = "needed" | "ordered" | "purchased" | "delivered";
export type Purchaser = "owner" | "trade" | "builder";

export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = {
  needed: "Needed", ordered: "Ordered", purchased: "Purchased", delivered: "Delivered",
};

export interface Material {
  id: string;
  item: string;
  category?: string; // e.g. "Lighting" (from the material catalog)
  roomId?: string;
  roomLabel?: string; // original/free-text room when not mapped to a room id
  tradeId?: string;
  desc?: string;
  specLink?: string;
  qty?: number; // required volume
  status: MaterialStatus;
  location?: string; // where it's stored
  notes?: string;
  purchaser: Purchaser; // who buys it
  dueDate?: string; // critical-path selection due date
  critical?: boolean; // critical-path item tied to the timing grid
  linkedScheduleId?: string; // schedule task this gates
  imageUrl?: string; // product image (pulled from the spec URL)
  specs?: string; // product specs/notes pulled from the URL
  designerApproved?: boolean; // designer sign-off
  approvalRequested?: boolean; // approval requested from the designer
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
  /** Original (first) dates — kept to overlay the original plan vs final. */
  origStart?: string;
  origEnd?: string;
  /** Optional link to a contract funding phase (gate / % release). */
  contractId?: string;
  phaseId?: string;
}

// A published batch of timing changes, with a reason + timestamp, for the audit
// trail and the owner email summary.
export interface ScheduleRevision {
  id: string;
  at: string;
  by: string;
  reason: string;
  changes: { itemId: string; label: string; fromStart: string; fromEnd: string; toStart: string; toEnd: string }[];
  notifiedTradeIds: string[];
  emailedClient: boolean;
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

// ---- Terms & Conditions builder --------------------------------------------
// A single selectable clause. Catalog clauses ship with the app; builders can
// also author their own. Clusters group related clauses for tick-box selection.
export interface TermClause {
  id: string;
  cluster: string;
  title: string;
  body: string;
}
// Per-trade deviations from the standard set.
export interface TradeTermsOverride {
  disabledClauseIds?: string[]; // standard clauses removed for this trade
  extraClauseIds?: string[];    // catalog clauses added only for this trade
  customClauses?: TermClause[]; // clauses unique to this trade
  note?: string;                // trade-specific addendum text
}
// The builder's standard T&Cs + per-trade overrides, applied to every contract.
export interface TermsConfig {
  preamble: string;             // editable contract preamble
  bindingLanguage: string;      // "intent to be legally bound" / e-sign language
  enabledClauseIds: string[];   // standard clauses applied to every contract
  customClauses: TermClause[];  // builder-authored standard clauses
  perTrade: Record<string, TradeTermsOverride>;
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
  /** Whether this source is your own cash or borrowed money that must be repaid. */
  fundType: "cash" | "debt";
  /** For debt: amount already paid back (balance owed = drawn − repaid). */
  repaid?: number;
  note?: string;
}

// ---- Project & DB -----------------------------------------------------------
export interface Project {
  id: string;
  name: string;
  address: string;
  built?: string;
  bufferPct: number; // contingency buffer applied over building costs
  /** Builder's markup %, applied across all builder-managed pass-through lines. */
  builderMarkupPct: number;
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
  contacts: ContactSheet[];
  terms: TermsConfig;
  funding: FundingSource[];
  schedule: ScheduleItem[];
  notifications: AppNotification[];
  scheduleRevisions: ScheduleRevision[];
  draws: Draw[];
  vendorAgreements: VendorAgreement[];
  materials: Material[];
  artifacts: Artifact[];
}

// ---- Session ----------------------------------------------------------------
export interface Session {
  role: Role;
  userId: string;
  displayName: string;
  /** Whether the device has signed in (gates the app vs the landing page). */
  authed: boolean;
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
// Can this user view an artifact, given its audience + trade restrictions?
export function canSeeArtifact(role: Role, user: User | undefined, a: Artifact): boolean {
  // Full Admin always sees everything (and assigns who else can).
  if (role === "full_admin") return true;
  // Every other role honors the per-document audience set by the Full Admin.
  const audienceOk = !a.audience || a.audience.length === 0 || a.audience.includes(role);
  if (!audienceOk) return false;
  if (role === "trade" && a.tradeIds && a.tradeIds.length) {
    return (user?.tradeIds ?? []).some((t) => a.tradeIds!.includes(t));
  }
  return true;
}

export function isOwnerManaged(t: Trade | undefined): boolean {
  return t?.managedBy === "owner";
}

export function canSeeContacts(viewerRole: Role, target: User): boolean {
  if (viewerRole === "full_admin" || viewerRole === "builder") return true;
  if (viewerRole === "owner") return target.role !== "trade" || target.managedBy === "owner";
  return false;
}
