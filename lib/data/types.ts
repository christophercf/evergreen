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
  | "payments"
  | "updates"
  | "bids";

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
  /** Personal preference: opt OUT of email pushes (Messenger etc.). Default = emails on. */
  emailOptOut?: boolean;
  /** Access suspended: they keep their history and messages, but can't sign in.
   *  Reversible — unlike removing the user, which deletes the account. */
  disabled?: boolean;
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
// ---- Vendor documents -------------------------------------------------------
// Insurance and license are recorded exactly as supplied. Deliberately there is
// NO compliance status: nothing computes "expiring" or "expired", nothing warns,
// and an out-of-date document never blocks a vendor from being invited to bid.
// The builder reads the dates and judges them. Inventing a traffic light here
// would be a liability dressed up as a feature.
export type VendorDocKind = "gl" | "wc" | "license";
export const VENDOR_DOC_LABEL: Record<VendorDocKind, string> = {
  gl: "General liability",
  wc: "Workers' compensation",
  license: "License",
};
export interface VendorDoc {
  kind: VendorDocKind;
  /** Policy or license number, as written on the certificate. */
  number?: string;
  /** Carrier and limits for insurance; the registration description for a license. */
  detail?: string;
  /** ISO date, as supplied. Blank means nobody has told us yet — not "expired". */
  expires?: string;
  /** The uploaded certificate, when we hold it. */
  url?: string;
  name?: string;
}
/** Who is responsible for producing the certificates. */
export type DocRoute = "we_hold" | "ask_vendor";
export const DOC_ROUTE_LABEL: Record<DocRoute, string> = {
  we_hold: "We hold them",
  ask_vendor: "Ask the vendor",
};
export const DOC_ROUTE_HINT: Record<DocRoute, string> = {
  we_hold: "You upload the COI and license",
  ask_vendor: "They're asked to send them over",
};

export interface ContactSheet {
  id: string;
  party: "builder" | "owner" | "vendor";
  /** The trade this vendor is *engaged* for on this project — drives their
   *  contract, cost lines and schedule. One engagement, one trade. */
  tradeId?: string;
  /** Everything this vendor can work on. This is the directory index: it decides
   *  which bid packages they show up for, and a vendor legitimately covers
   *  several. Falls back to `tradeId` for records created before it existed. */
  tradeIds?: string[];
  company: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  paymentTerms?: string;
  docs?: VendorDoc[];
  docRoute?: DocRoute;
  /** How this company has performed for us, 1–5. Owned by the vendor record and
   *  shown read-only inside a bid comparison — you rate the company, not the
   *  trade, so two masons can score differently. */
  rating?: number;
  /** Internal, never shared with the vendor or the other party. */
  internalNote?: string;
  /** Jobs completed with us — context for the rating. */
  jobsWithUs?: number;
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
  /** What the winning bid actually promised, carried across at award. The budget
   *  line, the schedule and any later change order then argue from the same
   *  numbers instead of only the total. */
  awardedBid?: {
    packageId: string;
    vendorName: string;
    materialsCost?: number;
    laborCost?: number;
    workingDays?: number;
    crewSize?: number;
    pricingBasis?: PricingBasis;
    at: string;
  };
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
export type MaterialStatus = "needed" | "identified" | "ordered" | "purchased" | "delivered";
export type Purchaser = "owner" | "trade" | "builder";

export const MATERIAL_STATUS_LABEL: Record<MaterialStatus, string> = {
  needed: "Needed", identified: "Identified", ordered: "Ordered", purchased: "Purchased", delivered: "Delivered",
};

// An alternate product candidate for a material — owner/builder add 2-3 of
// these; owner + designer compare and approve exactly ONE per item.
export interface ProductOption {
  id: string;
  label: string;        // product / vendor name
  url?: string;         // product page (drives the preview image)
  price?: number;       // quoted price for the line (qty included)
  note?: string;
  addedBy?: string;
  approved?: boolean;   // at most one option per material
  approvedBy?: string;
  approvedAt?: string;
}

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
  /** How the critical-path date(s) are set: a fixed "hard" date, or "trade" —
   *  derived live from the linked trade's Gantt (identify-by = trade start,
   *  on-hand-by = the trade's Finish phase). Defaults to "hard". */
  dueMode?: "hard" | "trade";
  /** When (within the trade's window) the material must be physically on-hand:
   *  "start" = before the trade begins (default); "finish" = only by the last
   *  week the trade is working (e.g. finish fixtures). Identify-by is always the
   *  trade start regardless. */
  needBy?: "start" | "finish";
  dueDate?: string; // hard-mode critical-path selection due date
  critical?: boolean; // critical-path item tied to the timing grid
  linkedScheduleId?: string; // schedule task this gates
  imageUrl?: string; // product image (pulled from the spec URL)
  specs?: string; // product specs/notes pulled from the URL
  designerApproved?: boolean; // designer sign-off
  ownerApproved?: boolean; // owner sign-off (independent of the designer)
  approvalRequested?: boolean; // approval requested from the approvers
  /** Alternate product candidates (2-3) added by owner/builder for review. */
  options?: ProductOption[];
  /** Planning budget for this item, set before a product is chosen. */
  budget?: number;
  /** The single approved option. While set, its price is the item's LOCKED cost
   *  (the budget is "solidified"); revoke the approval to change it. */
  approvedOptionId?: string;
}

/** The committed cost of a material: the approved option's price (else its
 *  budget if the approval carried no price). Undefined until an option is approved. */
export function materialLockedCost(m: Material): number | undefined {
  if (!m.approvedOptionId) return undefined;
  const opt = m.options?.find((o) => o.id === m.approvedOptionId);
  return opt?.price ?? m.budget;
}

// ---- Scope Support (pre-budget bidding) -------------------------------------
// A bid package: one scope of work sent to multiple vendors for competing bids.
// The winning bid is promoted into a Project Budget (ROM) line item.
/** How a bid package's scope was authored. All three paths harmonize into the
 *  same `scopeItems` list so competing bids stay line-for-line comparable. */
export type BidOrigin = "trade_template" | "builder_scope" | "vendor_import";

export const BID_ORIGIN_LABEL: Record<BidOrigin, string> = {
  trade_template: "Send trade default template",
  builder_scope: "Builder writes scope for trade to complete",
  vendor_import: "Import a trade's own template",
};

// ---- Bid guard rails --------------------------------------------------------
// The minimum a vendor must answer for a bid to be genuinely comparable. These
// print on the bid-request PDF / email as required fields, and each bid tracks
// which ones came back — so "cheapest" is never judged on price alone.
export const BID_REQ_KEYS = ["lineItemPricing", "materialsIncluded", "ownerSupplied", "exclusions", "leadTime", "permits", "warranty"] as const;
export type BidReqKey = (typeof BID_REQ_KEYS)[number];

export const BID_REQ_LABEL: Record<BidReqKey, string> = {
  lineItemPricing: "Price per scope line",
  materialsIncluded: "Materials included in price?",
  ownerSupplied: "Materials the owner must supply",
  exclusions: "Exclusions",
  leadTime: "Lead time / availability",
  permits: "Permits — included or at cost",
  warranty: "Warranty",
};
/** Sensible default: everything except warranty is required. */
export const BID_REQ_DEFAULT: BidReqKey[] = ["lineItemPricing", "materialsIncluded", "ownerSupplied", "exclusions", "leadTime", "permits"];

// ---- How the package is priced, and how each bid gets back to us ------------
// The basis is a package-level decision taken before the request goes out. A bid
// that comes back on the other basis is flagged in the comparison, never
// converted — a lump sum and a T&M cap are not the same promise.
export type PricingBasis = "lump" | "tm";
export const PRICING_BASIS_LABEL: Record<PricingBasis, string> = {
  lump: "Lump sum",
  tm: "Time & materials",
};
export const PRICING_BASIS_HINT: Record<PricingBasis, string> = {
  lump: "One fixed price against this scope",
  tm: "Crew rate plus materials, to a not-to-exceed",
};

/** Three ways a bid arrives; all three land on the same fields. */
export type BidRoute = "app" | "gc" | "upload";
export const BID_ROUTE_LABEL: Record<BidRoute, string> = {
  app: "They fill it in",
  gc: "We fill it in",
  upload: "They upload",
};
export const BID_ROUTE_HINT: Record<BidRoute, string> = {
  app: "Send them the form",
  gc: "Priced over the phone",
  upload: "Their own quote, scanned",
};
export const BID_ROUTE_SHORT: Record<BidRoute, string> = {
  app: "Filled in the app",
  gc: "Keyed by us",
  upload: "Uploaded + read",
};

// ---- The five fields every bid must land on ---------------------------------
// Completeness is always DERIVED from these values, never latched by a
// "confirmed" flag — clear a field and the bid drops out of the comparison
// again. That invariant is what keeps "cheapest" honest.
export const INTAKE_KEYS = ["amount", "materialsCost", "laborCost", "workingDays", "crewSize"] as const;
export type IntakeKey = (typeof INTAKE_KEYS)[number];
export const INTAKE_LABEL: Record<IntakeKey, string> = {
  amount: "Total cost",
  materialsCost: "Materials line",
  laborCost: "Labor line",
  workingDays: "Working days",
  crewSize: "Crew on site",
};
/** Materials is excluded: a labor-only bid legitimately has no materials line. */
export const INTAKE_REQUIRED: IntakeKey[] = ["amount", "laborCost", "workingDays", "crewSize"];
export type Confidence = "high" | "medium" | "none";

/** Which required fields this bid is still missing. */
export function bidIntakeMissing(b: VendorBid): IntakeKey[] {
  return INTAKE_REQUIRED.filter((k) => typeof b[k] !== "number" || Number.isNaN(b[k] as number));
}
export const bidIntakeComplete = (b: VendorBid) => bidIntakeMissing(b).length === 0;
/** Walk forward n working days from a start date, skipping weekends. The start
 *  date itself counts as day one when it's a weekday. Used to turn a bid's
 *  "N working days" into a real end date on the Gantt. */
export function addWorkingDays(iso: string, n: number): string {
  if (!iso || !n || n < 1) return iso;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  let counted = 0;
  while (counted < n) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) counted++;
    if (counted < n) d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/** Only meaningful once duration is known — the honest per-day comparison. */
export function bidCostPerDay(b: VendorBid): number | null {
  return b.amount && b.workingDays ? Math.round(b.amount / b.workingDays) : null;
}

export type MaterialsBasis = "vendor_supplies" | "owner_supplies" | "mixed";
export const MATERIALS_BASIS_LABEL: Record<MaterialsBasis, string> = {
  vendor_supplies: "Vendor supplies all materials",
  owner_supplies: "Owner supplies materials (labor only)",
  mixed: "Mixed — see scope lines",
};

/** Every trade a vendor can work on — the list that decides which bid packages
 *  they appear in. Older records only carry the single engagement trade. */
export const vendorTrades = (c: ContactSheet): string[] =>
  c.tradeIds?.length ? c.tradeIds : c.tradeId ? [c.tradeId] : [];
export const vendorCovers = (c: ContactSheet, tradeId: string) => vendorTrades(c).includes(tradeId);

/** A stored original document (scanned quote, emailed PDF, photo of paper). */
export interface ScopeDoc { name: string; url: string; scannedAt?: string }

export interface VendorBid {
  id: string;
  vendorName: string;
  contactId?: string;              // link to a vendor ContactSheet
  amount?: number;                 // overall price (pre-markup / sub cost)
  scopeText?: string;              // vendor-submitted scope (vendor-led / RFP return)
  /** The vendor's scope broken into comparable line items. */
  scopeItems?: string[];
  notes?: string;
  receivedVia?: "email" | "text" | "phone" | "form" | "pdf";
  attachments?: { name: string; url: string }[];  // photos / emailed docs
  at: string;
  status: "requested" | "received" | "declined" | "awarded";
  /** Answers to the package's required questions. */
  responses?: Partial<Record<BidReqKey, string>>;
  /** The vendor's original quote (scanned PDF or phone photo), viewable as filed. */
  sourceDoc?: ScopeDoc;

  // ---- Bid Management ----
  /** How this vendor is submitting. */
  route?: BidRoute;
  /** On the upload route: who actually filed the document. Both are first-class
   *  — a trade may upload its own, or email it to us and we upload on their behalf. */
  uploadedBy?: "trade" | "gc";
  /** The five comparable fields. `amount` above is the total cost. */
  materialsCost?: number;
  laborCost?: number;
  workingDays?: number;
  crewSize?: number;
  /** Time & materials only. */
  crewRate?: number;
  notToExceed?: number;
  /** What this bid was actually priced on — flagged when it differs from the package. */
  pricingBasis?: PricingBasis;
  /** Per-field confidence from the document read; absent means keyed by hand. */
  confidence?: Partial<Record<IntakeKey, Confidence>>;
  shortlisted?: boolean;
}

/** Can this package go out to vendors yet? Blocking issues vs. soft warnings. */
export function packageReadiness(p: BidPackage): { ready: boolean; blocking: string[]; warnings: string[] } {
  const items = p.scopeItems ?? [];
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (!p.title.trim()) blocking.push("Give the package a title");
  if (!p.tradeId) blocking.push("Pick a trade");
  if (items.length < 2) blocking.push("Add at least 2 scope line items — vendors can't price a one-liner");
  if (!p.materialsBasis) blocking.push("State who supplies materials");
  if (!p.pricingBasis) blocking.push("Set the pricing basis — lump sum or time & materials");
  if (!p.roomIds.length) warnings.push("No rooms selected — vendors won't know where the work is");
  if (items.length < 4) warnings.push("Only a few scope lines — thin scopes invite change orders");
  if (!(p.requirements ?? BID_REQ_DEFAULT).length) warnings.push("No required questions — bids may not be comparable");
  return { ready: blocking.length === 0, blocking, warnings };
}

export interface BidPackage {
  id: string;
  title: string;
  tradeId: string;
  roomIds: string[];
  /** The scope-of-work text: builder-led, pulled from the scope matrix, or a
   *  brief for RFPs the vendor fills out. */
  scopeDetails: string;
  /** Harmonized scope line items every bid is priced against. */
  scopeItems?: string[];
  origin?: BidOrigin;
  /** Who buys the materials — the single biggest source of non-comparable bids. */
  materialsBasis?: MaterialsBasis;
  /** Questions every vendor must answer (defaults to BID_REQ_DEFAULT). */
  requirements?: BidReqKey[];
  /** Optional ROM target so the builder can see bids against expectation. */
  targetBudget?: number;
  /** Set before the request goes out; every bid is expected on this basis. */
  pricingBasis?: PricingBasis;
  /** Why the winning bid won — the line the team can read in six months. */
  awardReason?: string;

  // ---- The request itself: what a vendor is actually being asked to price ----
  /** What's being built, where it sits in the schedule, what "done" looks like. */
  overview?: string;
  /** The materials the job needs, and who buys each one. The single biggest
   *  source of two bids that look comparable and aren't. */
  materialsList?: ScopeMaterial[];
  /** Free text from us about supply — what's free-issued, what's on site already. */
  supplyNote?: string;
  /** Work the vendor should assume is NOT theirs. Where change orders come from. */
  exclusions?: string;
  /** When we need the bid back, and when we expect them on site. */
  returnBy?: string;
  expectedStart?: string;

  /** Original document an imported scope was scanned from. */
  sourceDoc?: ScopeDoc;
  /** draft = still being built; collecting = out to vendors; awarded = decided. */
  status: "draft" | "collecting" | "awarded";
  createdAt: string;
  bids: VendorBid[];
  awardedBidId?: string;
  /** The Project Budget line the winning bid was promoted into. */
  lineId?: string;
}

/** One line of the materials schedule attached to a bid request. */
export interface ScopeMaterial {
  id: string;
  qty?: string;
  unit?: string;
  item: string;
  /** Who buys it. Stated per line so "materials included" can't hide an assumption. */
  suppliedBy: "vendor" | "owner";
}

// ---- Trade performance ratings ----------------------------------------------
// Each builder rates each trade; the averages surface next to their bids so the
// cheapest number isn't the only thing on screen.
export const RATING_KEYS = ["speed", "clean", "budget", "mistakeFree"] as const;
export type RatingKey = (typeof RATING_KEYS)[number];
export const RATING_LABEL: Record<RatingKey, string> = {
  speed: "Speed",
  clean: "Clean",
  budget: "Within budget",
  mistakeFree: "Mistake-free",
};
export const RATING_HINT: Record<RatingKey, string> = {
  speed: "Keeps pace and hits dates — 5 = always on schedule",
  clean: "Leaves the site tidy — 5 = spotless daily",
  budget: "Holds their number — 5 = no surprise extras",
  mistakeFree: "Quality of work — 5 = no callbacks or rework",
};

export interface TradeRating {
  tradeId: string;
  raterId: string;      // the builder/admin who rated
  raterName: string;
  speed?: number;       // 1–5
  clean?: number;
  budget?: number;
  mistakeFree?: number;
  note?: string;
  at: string;
}

/** Average score per category across everyone who rated this trade. */
export function tradeRatingAvg(ratings: TradeRating[], tradeId: string): { overall: number | null; by: Partial<Record<RatingKey, number>>; raters: number } {
  const mine = ratings.filter((r) => r.tradeId === tradeId);
  if (!mine.length) return { overall: null, by: {}, raters: 0 };
  const by: Partial<Record<RatingKey, number>> = {};
  const all: number[] = [];
  for (const k of RATING_KEYS) {
    const vals = mine.map((r) => r[k]).filter((v): v is number => typeof v === "number" && v > 0);
    if (vals.length) { by[k] = vals.reduce((a, b) => a + b, 0) / vals.length; all.push(...vals); }
  }
  return { overall: all.length ? all.reduce((a, b) => a + b, 0) / all.length : null, by, raters: mine.length };
}

// ---- Site updates (message board) ------------------------------------------
// A field update: photos + title + text, posted to specific recipients who can
// respond in-line. Built to be trivially usable from a phone on-site.
export interface UpdateReply {
  id: string;
  authorId: string;
  authorName: string;
  at: string;    // ISO
  body: string;
}

/** What a message is ABOUT — set when it's launched from an item elsewhere in
 *  the app (a material, cost line, timeline task, or document). Carries a deep
 *  link so recipients can jump straight to that item. */
export interface UpdateContext {
  kind: "material" | "cost" | "timing" | "artifact";
  refId: string;
  label: string;   // item name at time of posting
  href: string;    // in-app link, e.g. /materials?item=mat-12
}

export const UPDATE_CONTEXT_ICON: Record<UpdateContext["kind"], string> = {
  material: "📦", cost: "🧾", timing: "📅", artifact: "📁",
};

export interface SiteUpdate {
  id: string;
  title: string;
  body?: string;
  /** Photo URLs — Supabase Storage links (or compressed data URLs in mock). */
  photos?: string[];
  authorId: string;
  authorName: string;
  at: string;    // ISO
  /** Recipients (user ids). Visible to author + recipients (+ full admin). */
  toUserIds: string[];
  replies: UpdateReply[];
  /** The app item this message was launched from, if any. */
  context?: UpdateContext;
}

/** Who a user may send updates to:
 *  • builder / full_admin → anyone
 *  • owner → the builder(s), designer(s), architect, and their OWN (owner-managed) trades
 *  • trade → the builder(s); plus the owner(s) when the trade contracts directly
 *    with the owner (any of their trades is owner-managed)
 *  • viewer (designer) → owner(s) + builder(s) */
export function canMessageUser(sender: User | undefined, senderRole: Role, target: User, trades: Trade[]): boolean {
  if (target.id === sender?.id || target.status === "invited" || target.status === "pending") return false;
  // Admin, builder and owner can message anyone on the project. (The owner used
  // to be scoped to their own trades + architect/designer/builder, but as the
  // client paying for the job they need to reach the whole team.)
  if (senderRole === "full_admin" || senderRole === "builder" || senderRole === "owner") return true;
  if (senderRole === "trade") {
    if (target.role === "builder" || target.role === "full_admin") return true;
    const iAmOwnerManaged = (sender?.tradeIds ?? []).some((t) => isOwnerManaged(trades.find((x) => x.id === t)));
    if (target.role === "owner") return iAmOwnerManaged;
    return false;
  }
  if (senderRole === "viewer") {
    return target.role === "owner" || target.role === "builder" || target.role === "full_admin";
  }
  return false;
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
  /** Material prerequisites: material ids that must be on-hand for this task. */
  materialDeps?: string[];
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
  updates: SiteUpdate[];
  bidPackages: BidPackage[];
  tradeRatings: TradeRating[];
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
    materials: "edit", vendors: "edit", costs: "edit", budget: "edit", payments: "edit", updates: "edit", bids: "edit",
  },
  owner: {
    dashboard: "edit", timing: "edit", artifacts: "edit", admin: "edit",
    materials: "edit", vendors: "edit", costs: "edit", budget: "edit", payments: "edit", updates: "edit", bids: "view",
  },
  builder: {
    dashboard: "edit", timing: "edit", artifacts: "edit", admin: "edit",
    materials: "edit", vendors: "edit", costs: "edit", budget: "none", payments: "edit", updates: "edit", bids: "edit",
  },
  trade: {
    // Competing bids are never shown to trades.
    dashboard: "view", timing: "edit", artifacts: "view", admin: "none",
    materials: "edit", vendors: "view", costs: "none", budget: "none", payments: "none", updates: "edit", bids: "none",
  },
  viewer: {
    dashboard: "view", timing: "view", artifacts: "view", admin: "none",
    // The designer curates the materials list — they add & assign for all trades.
    materials: "edit", vendors: "view", costs: "none", budget: "none", payments: "none", updates: "edit", bids: "none",
  },
};

export function accessFor(user: User | undefined, role: Role, mod: ModuleKey): AccessLevel {
  return user?.access?.[mod] ?? ROLE_ACCESS[role][mod];
}

/** The architect is a trade with a whole-project view: full timing chart, all
 *  materials, and all (non-contract) documents. Costs and other trades'
 *  contracts stay hidden like any other trade. */
export function isArchitectUser(u: User | undefined): boolean {
  return !!u?.tradeIds?.includes("architect");
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
export function canSeeArtifact(role: Role, user: User | undefined, a: Artifact, trades?: Trade[]): boolean {
  // Full Admin always sees everything (and assigns who else can).
  if (role === "full_admin") return true;
  // Every other role honors the per-document audience set by the Full Admin.
  const audienceOk = !a.audience || a.audience.length === 0 || a.audience.includes(role);
  if (!audienceOk) return false;
  const mine = user?.tradeIds ?? [];
  if (a.kind === "contract") {
    // Contracts are private — trades AND designers/viewers only see contracts
    // explicitly assigned to their own trade (an unassigned contract is NOT theirs).
    if (role === "trade" || role === "viewer") {
      return !!a.tradeIds?.length && mine.some((t) => a.tradeIds!.includes(t));
    }
    // Builder ↔ Owner: a trade's contract belongs to whoever MANAGES that trade.
    // The builder never sees owner-managed contracts and vice versa — unless the
    // Full Admin explicitly granted the role via the document's audience list.
    // Untagged contracts (e.g. the master owner↔builder agreement) stay shared.
    if ((role === "builder" || role === "owner") && a.tradeIds?.length && trades && !a.audience?.includes(role)) {
      const ownerMgd = a.tradeIds.some((t) => isOwnerManaged(trades.find((x) => x.id === t)));
      return role === "owner" ? ownerMgd : !ownerMgd;
    }
    return true;
  }
  // Trades are further limited to artifacts tagged to their own trade — except
  // the architect, who sees all project documents (contracts stay own-only above).
  if (role === "trade" && a.tradeIds && a.tradeIds.length && !isArchitectUser(user)) {
    return mine.some((t) => a.tradeIds!.includes(t));
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
