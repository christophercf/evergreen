// ----------------------------------------------------------------------------
// Evergreen seed — the 31810 Evergreen Rd renovation, ported from the two
// working spreadsheets ("31810 Evergreen.xlsx" + the Shared budget workbook).
// buildDB() returns a fresh, fully-seeded DB; the mock backend persists any
// edits over the top of it in localStorage.
// ----------------------------------------------------------------------------

import type {
  Contract, CostLine, DB, Draw, FundingSource, Project, Room, ScopeCell, ScopeItem,
  Trade, TradeScopeTemplate, User, MacroCategory, ScopeStatus, ScheduleItem,
  ScheduleKind, ScheduleStatus, VendorAgreement, Material, Artifact,
  TermClause, TermsConfig, ContactSheet,
} from "./types";
import { lineTotal } from "./money";

// ---- Project ----------------------------------------------------------------
const project: Project = {
  id: "evergreen",
  name: "31810 Evergreen",
  address: "31810 Evergreen Rd",
  built: "1822 Farmhouse",
  bufferPct: 10,
  builderMarkupPct: 20,
};

// ---- Users ------------------------------------------------------------------
const users: User[] = [
  { id: "u-owner", name: "Chris Johnson", email: "christopher.cf@gmail.com", phone: "", role: "full_admin", status: "active" },
  { id: "u-owner2", name: "Emily Johnson", email: "emily@johnson.family", role: "owner", status: "active" },
  { id: "u-builder", name: "Aaron — Oasis", email: "aaron@oasisbuild.example", phone: "248-555-0142", role: "builder", doorCode: "1822", status: "active",
    secondaryContacts: [{ id: "c-aaron-1", label: "Office", name: "Oasis Build LLC", phone: "248-555-0100", email: "office@oasisbuild.example" }] },
  { id: "u-electric", name: "Electrician (Oasis sub)", email: "electric@oasisbuild.example", phone: "248-555-0188", role: "trade", tradeIds: ["electrical"], managedBy: "builder", doorCode: "1822", status: "active" },
  { id: "u-plumb", name: "Lakeside Plumbing — Danny", email: "danny@lakeside.example", phone: "313-554-1900", role: "trade", tradeIds: ["plumbing"], managedBy: "builder", doorCode: "1822", status: "active" },
  { id: "u-windows", name: "Diverse Windows", email: "info@windowsdiverse.example", phone: "313-655-5684", role: "trade", tradeIds: ["windows"], managedBy: "owner", status: "active" },
  { id: "u-design", name: "Designer (TBD)", email: "design@example.com", role: "viewer", status: "active" },
  { id: "u-architect", name: "Joe Mossey (Architect)", email: "architect@example.com", role: "trade", tradeIds: ["architect"], managedBy: "owner", status: "active" },
  { id: "u-tile", name: "Tile Vendor (invited)", email: "tile@example.com", role: "trade", tradeIds: ["tile"], managedBy: "builder", status: "invited", inviteToken: "demo-tile-invite" },
];

// ---- Trades -----------------------------------------------------------------
const T = (id: string, name: string, category: MacroCategory, defaultOwner: "builder" | "owner" = "builder"): Trade =>
  ({ id, name, category, defaultOwner });

const trades: Trade[] = [
  // Soft costs
  T("design", "Design", "Soft Costs", "owner"),
  { id: "architect", name: "Architect", category: "Soft Costs", defaultOwner: "owner", managedBy: "owner" }, // owner contracts the architect directly
  T("structural-eng", "Structural Engineering", "Soft Costs", "owner"),
  T("mechanical-eng", "Mechanical Engineering", "Soft Costs", "owner"),
  T("general-conditions", "General Conditions", "Soft Costs"),
  T("permits", "Permits & Fees", "Soft Costs"),
  // Site & demo
  T("demo", "Demo", "Site & Demo"),
  T("cleaners", "Cleaners", "Site & Demo"),
  T("sewer", "Sewer", "Site & Demo"),
  // Structure & envelope
  T("rough-carpentry", "Rough Carpentry / Framing", "Structure & Envelope"),
  T("footings", "Footings & Foundation", "Structure & Envelope"),
  T("masonry", "Masonry", "Structure & Envelope"),
  T("roofing", "Roofing", "Structure & Envelope"),
  T("waterproofing", "Waterproofing", "Structure & Envelope"),
  T("insulation", "Insulation", "Structure & Envelope"),
  // Two window vendors run in parallel: Diverse (owner-managed restoration) and
  // the builder's window sub (new/basement windows) — each with its own contract.
  { id: "windows", name: "Windows — Diverse", category: "Structure & Envelope", defaultOwner: "builder", managedBy: "owner" },
  { id: "windows-builder", name: "Windows — Builder", category: "Structure & Envelope", defaultOwner: "builder", managedBy: "builder", custom: true },
  T("siding", "Siding", "Structure & Envelope"),
  T("gutters", "Gutters", "Structure & Envelope"),
  T("chimneys", "Chimneys & Fireplaces", "Structure & Envelope"),
  T("mold-asbestos", "Mold / Asbestos", "Structure & Envelope"),
  // Mechanicals
  T("plumbing", "Plumbing", "Mechanicals (MEP)"),
  T("electrical", "Electrical", "Mechanicals (MEP)"),
  T("hvac", "HVAC", "Mechanicals (MEP)"),
  T("electric-service", "Electric Service Provider", "Mechanicals (MEP)", "owner"),
  T("gas-service", "Gas Service Provider", "Mechanicals (MEP)", "owner"),
  // Interior finishes
  T("drywall", "Drywall / Plaster", "Interior Finishes"),
  T("finish-carpentry", "Finish Carpentry", "Interior Finishes"),
  T("custom-carpentry", "Custom Carpentry / Built-ins", "Interior Finishes"),
  T("cabinets", "Cabinets", "Interior Finishes"),
  T("countertops", "Countertops", "Interior Finishes"),
  T("tile", "Tile", "Interior Finishes"),
  T("hardwood-floor", "Hardwood Floor", "Interior Finishes"),
  T("carpet", "Carpet", "Interior Finishes"),
  T("floors-nonhardwood", "Floors (Non-Hardwood)", "Interior Finishes"),
  T("painter-interior", "Painter (Interior)", "Interior Finishes"),
  T("hardware", "Hardware", "Interior Finishes"),
  T("basement-buildout", "Basement Buildout", "Interior Finishes"),
  // Exterior
  T("painter-exterior", "Painter (Exterior)", "Exterior"),
  T("hardscape", "Hardscape (Landscaping)", "Exterior", "owner"),
  T("landscaping", "Landscaping", "Exterior", "owner"),
  { id: "driveway", name: "Driveway & Paving", category: "Exterior", defaultOwner: "owner", managedBy: "owner", custom: true },
  // Owner items
  T("appliances", "Appliances", "Owner Items", "owner"),
  T("fixtures", "Finish Fixtures", "Owner Items", "owner"),
];

// ---- Rooms ------------------------------------------------------------------
const R = (id: string, name: string, floor: Room["floor"], extra: Partial<Room> = {}): Room =>
  ({ id, name, floor, ...extra });

const rooms: Room[] = [
  R("whole-house", "Whole House", "Whole House"),
  // First floor
  R("parlor", "Parlor / Foyer", "First Floor"),
  R("great-room", "Great Room", "First Floor"),
  R("kitchen", "Kitchen", "First Floor"),
  R("breakfast-nook", "Breakfast Nook / Command Ctr", "First Floor"),
  R("pantry", "Pantry / Butler's", "First Floor"),
  R("powder", "Powder Room", "First Floor"),
  R("laundry", "Laundry", "First Floor"),
  R("mudroom", "Mud Room", "First Floor", { addition: true }),
  R("office", "Office / 1st Floor Bedroom", "First Floor"),
  R("dining", "Dining Room", "First Floor"),
  R("porch", "Porch", "First Floor"),
  R("kitchen-peninsula", "Kitchen Peninsula & 2nd Fl Addition", "First Floor", { addition: true }),
  // Second floor
  R("primary-bed", "Primary Bedroom", "Second Floor"),
  R("primary-bath", "Primary Bathroom", "Second Floor"),
  R("primary-closet", "Primary Closet", "Second Floor"),
  R("primary-balcony", "Primary Balcony", "Second Floor"),
  R("bed-2", "Bedroom 2", "Second Floor"),
  R("bed-3", "Bedroom 3", "Second Floor"),
  R("bed-4", "Bedroom 4", "Second Floor"),
  R("kids-bath", "Kids Bathroom", "Second Floor"),
  R("upstairs-hall", "Upstairs Hall", "Second Floor"),
  R("attic", "Attic", "Second Floor"),
  // Basement
  R("basement-finished", "Basement (Finished)", "Basement"),
  R("basement-unfinished", "Basement (Unfinished)", "Basement"),
  R("furnace-room", "Furnace Room", "Basement"),
  // Exterior
  R("roof-chimneys", "Roof & Chimneys", "Exterior"),
  R("exterior", "Exterior / Siding", "Exterior"),
  R("greenhouse", "Greenhouse", "Exterior"),
  R("sunroom", "Sunroom", "Exterior"),
  R("garage", "Garage", "Exterior"),
  R("site", "Driveway & Site", "Exterior"),
];

// ---- Trade scope templates (default checklists) -----------------------------
const scopeTemplates: TradeScopeTemplate[] = [
  { tradeId: "electrical", items: ["Rough wiring & boxes", "Panel / service", "Finish fixtures", "GFCI / exterior outlets", "Demo old wiring"] },
  { tradeId: "plumbing", items: ["Rough plumbing", "Drains & venting", "Finish fixtures (owner-supplied)", "Hot water tank", "Hose spigots"] },
  { tradeId: "hvac", items: ["Service furnaces", "Ductwork rework", "Add AC", "Returns / supplies for additions"] },
  { tradeId: "demo", items: ["Demo to studs", "Save salvageable wood", "Dumpster / haul-off"] },
  { tradeId: "drywall", items: ["Hang & finish", "Greenboard in baths", "Plaster repairs", "Remove/cover wallpaper"] },
  { tradeId: "painter-interior", items: ["Prep & prime", "Walls & ceilings", "Trim & doors"] },
  { tradeId: "hardwood-floor", items: ["Refinish existing", "Patch / weave-in", "New flooring"] },
  { tradeId: "tile", items: ["Floor tile", "Shower walls/floor", "Waterproofing membrane"] },
  { tradeId: "cabinets", items: ["Supply", "Install", "Hardware"] },
  { tradeId: "insulation", items: ["Attic blown-in", "Exterior wall dense-pack", "Spray foam ducts"] },
];

// ---- Scope matrix (representative, editable) --------------------------------
// Compact map: trade → { status: [roomIds] }. Everything else stays "unset".
type ScopeSeed = Record<string, Partial<Record<ScopeStatus, string[]>>>;
const scopeSeed: ScopeSeed = {
  electrical: { in: ["whole-house", "kitchen", "primary-bath", "kids-bath", "powder", "basement-finished", "mudroom", "great-room", "office"] },
  plumbing: { in: ["kitchen", "primary-bath", "kids-bath", "powder", "laundry", "mudroom", "basement-finished"], existing: ["great-room"] },
  hvac: { in: ["whole-house", "great-room", "kitchen-peninsula", "mudroom"] },
  insulation: { in: ["attic", "exterior", "great-room", "kitchen-peninsula", "mudroom"] },
  demo: { in: ["kitchen", "primary-bath", "kids-bath", "powder", "basement-finished"] },
  drywall: { in: ["kitchen", "primary-bath", "kids-bath", "powder", "basement-finished", "mudroom", "kitchen-peninsula"] },
  "painter-interior": { in: ["whole-house"] },
  "painter-exterior": { in: ["exterior"] },
  roofing: { in: ["roof-chimneys", "mudroom", "kitchen-peninsula"], existing: ["garage"] },
  masonry: { in: ["roof-chimneys"], existing: ["dining"] },
  windows: { in: ["bed-4", "kitchen", "mudroom", "kitchen-peninsula", "basement-unfinished"], existing: ["dining", "great-room"] },
  "hardwood-floor": { in: ["great-room", "dining", "office", "parlor"], existing: ["upstairs-hall"] },
  tile: { in: ["primary-bath", "kids-bath", "powder", "kitchen", "mudroom", "sunroom"] },
  carpet: { in: ["bed-2", "bed-3", "bed-4", "primary-bed"] },
  cabinets: { in: ["kitchen", "primary-bath", "kids-bath", "laundry", "pantry"] },
  countertops: { in: ["kitchen", "primary-bath", "kids-bath", "powder", "great-room"] },
  "finish-carpentry": { in: ["whole-house"] },
  "custom-carpentry": { in: ["great-room", "office", "primary-bed", "basement-finished"] },
  waterproofing: { in: ["basement-unfinished", "basement-finished"] },
  hardware: { in: ["whole-house"] },
  "basement-buildout": { in: ["basement-finished", "basement-unfinished"] },
  chimneys: { in: ["roof-chimneys"], existing: ["dining", "great-room"] },
  siding: { in: ["exterior", "mudroom", "kitchen-peninsula"] },
  gutters: { existing: ["roof-chimneys"] },
};

function buildScope(): ScopeCell[] {
  const cells: ScopeCell[] = [];
  let n = 0;
  for (const [tradeId, byStatus] of Object.entries(scopeSeed)) {
    const tpl = scopeTemplates.find((t) => t.tradeId === tradeId);
    for (const status of Object.keys(byStatus) as ScopeStatus[]) {
      for (const roomId of byStatus[status] ?? []) {
        const items: ScopeItem[] = (tpl?.items ?? []).map((label, i) => ({
          id: `si-${tradeId}-${roomId}-${i}`,
          label,
          included: status === "in",
        }));
        cells.push({ roomId, tradeId, status, items });
        n++;
      }
    }
  }
  void n;
  return cells;
}

// ---- Building cost lines ----------------------------------------------------
// Helper to construct a contracted (passthrough-markup) line with price history.
const hist = (estHigh: number | null, rom: number | null, afterPR: number | null) => {
  const pts = [];
  if (estHigh != null) pts.push({ label: "Initial Estimate", date: "2025-11", amount: estHigh });
  if (rom != null) pts.push({ label: "Working ROM (05.03.26)", date: "2026-05-03", amount: rom });
  if (afterPR != null) pts.push({ label: "After Plan Review", date: "2026-06", amount: afterPR });
  return pts;
};

let cid = 0;
const cl = (o: Omit<CostLine, "id" | "changeOrders" | "phases">): CostLine =>
  ({ id: `cl-${++cid}`, changeOrders: [], phases: [], ...o });

const costLines: CostLine[] = [
  // ---- Oasis contracted lines (passthrough 20% markup, with plan-review delta)
  cl({ name: "General Conditions", tradeId: "general-conditions", category: "Soft Costs", owner: "builder", roomIds: [], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Dumpsters, permit admin, site cleanup & protection, vendor coordination. $3,750 billed to date — total $11,250.", history: hist(12000, 7500, 7500) }),
  cl({ name: "HVAC", tradeId: "hvac", category: "Mechanicals (MEP)", owner: "builder", roomIds: ["whole-house"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Service 2 furnaces, add AC to two basement furnaces, rework great-room return/supply, modernize ducts, supplies/returns for additions. Excludes permits.", history: hist(20000, 17700, 23060) }),
  cl({ name: "Electrical", tradeId: "electrical", category: "Mechanicals (MEP)", owner: "builder", roomIds: ["whole-house"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Full rough + finish wiring (basement, great room, bar, foyer, dining, office, pantry, mudroom, 4 beds, kitchen, 2 full + 1 half bath, exterior, porch, halls/closets). 220V hot-tub + heat-lamp lines. Demo old wiring. Permits at cost.", history: hist(45000, 39000, 43095) }),
  cl({ name: "Framing", tradeId: "rough-carpentry", category: "Structure & Envelope", owner: "builder", roomIds: ["mudroom", "kitchen-peninsula"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Addition framing, structural work, partition walls. Materials included.", history: hist(40000, 50000, null) }),
  cl({ name: "Additional Framing Allowance", tradeId: "rough-carpentry", category: "Structure & Envelope", owner: "builder", roomIds: [], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "For ongoing changes and unforeseen additions.", allowanceLow: 10000, allowanceHigh: 10000, history: hist(null, 10000, null) }),
  cl({ name: "Plumbing", tradeId: "plumbing", category: "Mechanicals (MEP)", owner: "builder", roomIds: ["kitchen", "primary-bath", "kids-bath", "powder", "mudroom", "laundry", "great-room"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Rough plumbing for full kitchen, 2 full + 1 half bath, mudroom rinse sink, wet bar, laundry box + tub, 5 exterior spigots, HWT. Finish fixtures owner-supplied. Permits at cost.", history: hist(29000, 28500, 34000) }),
  cl({ name: "Roof for Additions", tradeId: "roofing", category: "Structure & Envelope", owner: "builder", roomIds: ["mudroom", "kitchen-peninsula"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "EPDM flat roof for mudroom; roof to spec for 2nd-floor addition. Sheeting, felt, ice guard, drip edge, flashing. Excludes gutters/downspouts.", history: hist(null, 14000, null) }),
  cl({ name: "Waterproofing", tradeId: "waterproofing", category: "Structure & Envelope", owner: "builder", roomIds: ["basement-unfinished", "basement-finished"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Interior drainage system (new side of basement) w/ sump pump, remove retaining wall, waterproof walk-out, delta board, backfill to grade.", history: hist(null, 16410, 16410) }),
  cl({ name: "Insulation", tradeId: "insulation", category: "Structure & Envelope", owner: "builder", roomIds: ["attic", "exterior", "great-room"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Attic blown-in cellulose (R60), spray-foam ducts, 2nd-floor exterior-wall closed-cell foam, great-room cathedral dense-pack. Excludes mudroom/kitchen/2nd-story addition.", history: hist(6000, 31022.6, 31022.6) }),
  cl({ name: "Masonry", tradeId: "masonry", category: "Structure & Envelope", owner: "builder", roomIds: ["roof-chimneys"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Large chimney: rebuild top 20 rows w/ 2 arched flue openings, new concrete cap, grind/tuckpoint shoulders, replace damaged brick. Dining chimney to be assessed as a CO.", history: hist(null, 12300, 12300) }),
  cl({ name: "Footings", tradeId: "footings", category: "Structure & Envelope", owner: "builder", roomIds: ["mudroom", "porch"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Footings for mudroom addition + added front porch (not in previous estimates).", history: hist(null, 8000, 11425) }),
  cl({ name: "New Siding (Additions)", tradeId: "siding", category: "Structure & Envelope", owner: "builder", roomIds: ["mudroom", "kitchen-peninsula"], markupModel: "passthrough", markupPct: 20, status: "contracted", contractId: "c-oasis", desc: "Siding for additions to match house; scab in elsewhere as needed.", history: hist(null, 12000, null) }),

  // ---- Completed early work (from the Completed Work ledger; paid via signed Exhibit A) ----
  cl({ name: "Demo (completed)", tradeId: "demo", category: "Site & Demo", owner: "builder", roomIds: [], markupModel: "blackbox", markupPct: 0, status: "complete", contractId: "c-oasis", desc: "Demo kitchen + adjacent room to studs (save wood), basement large room, water-damaged drywall, 2 baths + half bath to studs, remove tanks/carpet/LVP. Dumpsters included.", history: [{ label: "Signed Exhibit A-2", date: "2026-01-22", amount: 9660 }] }),
  cl({ name: "Roof — Main House (completed)", tradeId: "roofing", category: "Structure & Envelope", owner: "builder", roomIds: [], markupModel: "blackbox", markupPct: 0, status: "complete", contractId: "c-oasis", desc: "Strip to deck, 50-yr architectural shingles on house + garage, drip edge, chimney kit, vents, synthetic felt, ice guard, step flashing, fascia + aluminum trim. Incl. chimney repairs ×2 + rotten-wood carpentry.", history: [{ label: "Completed (incl. chimney repairs)", date: "2026-02", amount: 43560 }] }),

  // ---- Allowances not yet contracted (right-hand table, low/high)
  cl({ name: "Painting (interior)", tradeId: "painter-interior", category: "Interior Finishes", owner: "builder", roomIds: ["whole-house"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "~3400 sqft.", allowanceLow: 20000, allowanceHigh: 25000, history: hist(42000, 25000, null) }),
  cl({ name: "Cabinets", tradeId: "cabinets", category: "Interior Finishes", owner: "builder", roomIds: ["kitchen", "primary-bath", "kids-bath"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Kitchen & bathroom cabinets (~35).", allowanceLow: 30000, allowanceHigh: 35000, history: hist(35000, 35000, null) }),
  cl({ name: "Drywall / Plaster", tradeId: "drywall", category: "Interior Finishes", owner: "builder", roomIds: [], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Drywall replacement as needed; greenboard in baths; plaster repairs; wallpaper removal.", allowanceLow: 22000, allowanceHigh: 26000, history: hist(18000, 26000, null) }),
  cl({ name: "Floors (Hardwood)", tradeId: "hardwood-floor", category: "Interior Finishes", owner: "builder", roomIds: ["great-room", "dining", "office", "parlor"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "~3400 sqft, repairs & patches as needed.", allowanceLow: 27000, allowanceHigh: 35000, history: hist(30000, 35000, null) }),
  cl({ name: "Tile", tradeId: "tile", category: "Interior Finishes", owner: "builder", roomIds: ["primary-bath", "kids-bath", "powder", "kitchen"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Shower walls/floors, bathroom floors, kitchen floor, master bath walls.", allowanceLow: 15000, allowanceHigh: 20000, history: hist(null, 20000, null) }),
  cl({ name: "Hardware", tradeId: "hardware", category: "Interior Finishes", owner: "builder", roomIds: ["whole-house"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Assess/adjust door hardware; work old existing hardware for accents.", allowanceLow: 6000, allowanceHigh: 7500, history: hist(12000, 7500, null) }),
  cl({ name: "Floors (Non-Hardwood)", tradeId: "floors-nonhardwood", category: "Interior Finishes", owner: "builder", roomIds: ["kitchen", "primary-bath", "kids-bath"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Bathrooms, kitchen, areas where hardwood not existing.", allowanceLow: 5000, allowanceHigh: 8000, history: hist(8000, 8000, null) }),
  cl({ name: "Basement Windows", tradeId: "windows-builder", category: "Structure & Envelope", owner: "builder", roomIds: ["basement-unfinished"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Glass-block basement windows in old portion.", allowanceLow: 3500, allowanceHigh: 4500, history: hist(4500, 4500, null) }),
  cl({ name: "Mold", tradeId: "mold-asbestos", category: "Structure & Envelope", owner: "builder", roomIds: ["basement-unfinished"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Treat basement for mold.", allowanceLow: 3500, allowanceHigh: 5000, history: hist(15000, 5000, null) }),
  cl({ name: "Basement (Unfinished)", tradeId: "basement-buildout", category: "Interior Finishes", owner: "builder", roomIds: ["basement-unfinished"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Paint ceiling black, waterproof old cobble walls as needed.", allowanceLow: 3500, allowanceHigh: 5000, history: hist(5000, 5000, null) }),
  cl({ name: "Chimneys (service)", tradeId: "chimneys", category: "Structure & Envelope", owner: "builder", roomIds: ["roof-chimneys"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "3 — service fireplaces & chimneys to make operational (assessment only).", allowanceLow: 2500, allowanceHigh: 3000, history: hist(3000, 3000, null) }),
  cl({ name: "Kitchen Peninsula & 2nd Floor Addition", tradeId: "rough-carpentry", category: "Structure & Envelope", owner: "builder", roomIds: ["kitchen-peninsula"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Vaulted 2nd-floor ceiling, 7-8 windows to match, drywall, trim, doors, insulation, siding, carpet.", allowanceLow: 30000, allowanceHigh: 40000, history: hist(null, 40000, null) }),
  cl({ name: "Mud Room Addition", tradeId: "rough-carpentry", category: "Structure & Envelope", owner: "builder", roomIds: ["mudroom"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "1-2 windows to match, drywall, trim, doors, insulation, siding, tile floors.", allowanceLow: 10000, allowanceHigh: 13000, history: hist(null, 13000, null) }),
  cl({ name: "Custom Carpentry", tradeId: "custom-carpentry", category: "Interior Finishes", owner: "builder", roomIds: ["great-room", "office", "primary-bed"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Allowance — built-ins, bookshelves, etc throughout.", allowanceLow: 20000, allowanceHigh: 25000, history: hist(null, 25000, null) }),
  cl({ name: "Finish Carpentry", tradeId: "finish-carpentry", category: "Interior Finishes", owner: "builder", roomIds: ["whole-house"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Allowance — cabinet install, trim throughout, restore wood accents.", allowanceLow: 25000, allowanceHigh: 35000, history: hist(35000, 35000, null) }),
  cl({ name: "Countertops", tradeId: "countertops", category: "Interior Finishes", owner: "builder", roomIds: ["kitchen", "primary-bath", "kids-bath"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Allowance.", allowanceLow: 15000, allowanceHigh: 19000, history: hist(19000, 19000, null) }),
  cl({ name: "Basement (Finished)", tradeId: "basement-buildout", category: "Interior Finishes", owner: "builder", roomIds: ["basement-finished"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Allowance — finish level TBD; half bath + theater/arcade electrical.", allowanceLow: 12000, allowanceHigh: 16000, history: hist(16000, 16000, null) }),
  cl({ name: "Exterior Painting", tradeId: "painter-exterior", category: "Exterior", owner: "builder", roomIds: ["exterior"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Scrape paint, repaint, caulk and flash as needed.", allowanceLow: 20000, allowanceHigh: 20000, history: hist(23000, 20000, null) }),

  // ---- Owner-carried lines (black-box / direct purchase)
  cl({ name: "Window Restoration", tradeId: "windows", category: "Structure & Envelope", owner: "owner", roomIds: ["whole-house"], markupModel: "blackbox", markupPct: 0, status: "contracted", contractId: "c-windows", desc: "Diverse Windows — restoration of ~33 windows. $16,249 paid to date.", history: hist(null, 40623, 40623) }),
  cl({ name: "Architecture & Structural Engineering", tradeId: "architect", category: "Soft Costs", owner: "owner", roomIds: [], markupModel: "blackbox", markupPct: 0, status: "contracted", desc: "Joseph Mosey Architecture — retainer $15k + deposit $14k + balance $4k.", history: hist(15000, 33000, 33000) }),
  cl({ name: "Driveway (asphalt)", tradeId: "hardscape", category: "Exterior", owner: "owner", roomIds: ["site"], markupModel: "blackbox", markupPct: 0, status: "contracted", desc: "Mr. Blacktop (Peter Stanley).", history: hist(13500, 24000, 24000) }),
  cl({ name: "Kitchen Appliances", tradeId: "appliances", category: "Owner Items", owner: "owner", roomIds: ["kitchen"], markupModel: "blackbox", markupPct: 0, status: "allowance", desc: "Fridge, range, microwave, range vent, food-warmer lamp (owner-purchased).", allowanceLow: 12000, allowanceHigh: 18000, history: hist(null, 15000, null) }),
];

// Agreed (contracted/complete) lines are already locked — their cost is the contract
// price and changes flow through change orders. Allowances stay unlocked (ranges).
costLines.forEach((l) => {
  if ((l.status === "contracted" || l.status === "complete") && l.lockedCost == null) {
    l.lockedCost = l.history.length ? l.history[l.history.length - 1].amount : (l.allowanceHigh ?? 0);
    l.locked = true;
    l.lockedAt = "2026-05-03";
    l.lockedBy = "Aaron — Oasis";
  }
});

// ---- Contracts (master terms templates, appended to each line's contract) ---
export const MASTER_TERMS = "No lien shall be filed against the property for any reason. Change orders require written owner approval before work proceeds; each is attached as a numbered Exhibit to this contract. The parties agree to good-faith negotiation on any disputed scope or pricing. Work performed in a neat, workmanlike manner and to current local code.";
const contracts: Contract[] = [
  {
    id: "c-oasis",
    name: "Oasis (General Contractor)",
    tradeIds: ["general-conditions", "hvac", "electrical", "rough-carpentry", "plumbing", "roofing", "waterproofing", "insulation", "masonry", "footings", "siding"],
    terms: `Transparent pass-through with agreed 20% markup. Permits billed at cost. ${MASTER_TERMS}`,
    termsAccepted: true,
  },
  {
    id: "c-windows",
    name: "Diverse Windows",
    tradeIds: ["windows"],
    terms: `Window restoration. 40% deposit, balance on completion. ${MASTER_TERMS}`,
    termsAccepted: true,
  },
];

// ---- Terms & Conditions catalog --------------------------------------------
// Suggested, tick-box clauses grouped into clusters. Builders enable the ones
// they want as their standard terms, override per trade, or add their own.
// NOTE: suggested language only — not legal advice; have counsel review.
export const TERM_CLAUSES: TermClause[] = [
  // Schedule & Timing
  { id: "schedule-malus", cluster: "Schedule & Timing", title: "Timing penalty (liquidated damages) for missed dates",
    body: "Contractor shall start and complete its Work on the start and finish dates assigned in the Project app. If Contractor fails to meet an assigned date, Builder may assess liquidated damages of $250 per day of delay. This penalty shall NOT apply where the delay is caused by a critical-path predecessor item — as identified and tracked within the Project app — that was not completed before Contractor's assigned start date, nor to delays caused by Builder/Owner, approved Change Orders, or force majeure." },
  { id: "ready-to-work", cluster: "Schedule & Timing", title: "Duty to confirm readiness before start",
    body: "Contractor shall review the Project app before each assigned start date and promptly notify the Builder if any critical-path predecessor is incomplete, rather than mobilizing into work that cannot be performed." },
  // Liens & Payment
  { id: "no-lien", cluster: "Liens & Payment", title: "No-lien clause + lien waivers",
    body: "To the fullest extent permitted by law, Contractor waives and agrees not to file any mechanic's lien or claim against the Property, and shall obtain like waivers from its subcontractors and suppliers. Contractor shall furnish conditional and unconditional lien waivers as a condition of each progress payment or draw." },
  { id: "pay-by-draw", cluster: "Liens & Payment", title: "Payment via the app draw schedule",
    body: "Payment shall be made through the draw schedule maintained in the Project app. Each draw request must be supported by completed scope and the required lien waivers." },
  // Change Orders
  { id: "co-process", cluster: "Change Orders", title: "Change-order request & approval process",
    body: "No change to the scope, price, or schedule is authorized unless requested and approved as a written Change Order in the Project app BEFORE the affected Work proceeds. Each approved Change Order is incorporated as a numbered Exhibit to this Contract." },
  { id: "co-in-app-accept", cluster: "Change Orders", title: "In-app changes accepted without a CO are included",
    body: "If a scope change is presented in the Project app and accepted by Contractor without a corresponding Change Order request, that change shall be deemed included within this Contract at no additional cost or time." },
  { id: "no-verbal", cluster: "Change Orders", title: "No verbal change orders",
    body: "Verbal instructions do not constitute a Change Order. Contractor proceeds with un-approved extra work at its own risk and waives any claim for additional payment." },
  // Scope & System of Record
  { id: "align-app-scope", cluster: "Scope & System of Record", title: "Agreement to align to app-defined scope & terms",
    body: "Contractor agrees that the scope, materials, selections, schedule, and terms maintained in the Project app, together with this executed Contract, constitute the complete agreement between the parties. Contractor is responsible for reviewing and aligning its Work to the app-defined scope and these terms." },
  { id: "app-source-of-truth", cluster: "Scope & System of Record", title: "The app is the system of record",
    body: "Where any conflict arises, the most recently approved scope, selection, or Change Order recorded in the Project app governs, and the parties agree to be bound by the records it maintains." },
  // General
  { id: "workmanlike", cluster: "General", title: "Workmanlike quality & code compliance",
    body: "All Work shall be performed in a good and workmanlike manner, in accordance with the approved plans and current applicable building codes, by appropriately licensed personnel." },
  { id: "insurance", cluster: "General", title: "Insurance & licensing",
    body: "Contractor shall maintain general liability and workers' compensation insurance in the amounts required by law, name the Builder/Owner as additional insured, and provide certificates on request." },
  { id: "warranty", cluster: "General", title: "One-year workmanship warranty",
    body: "Contractor warrants its Work and materials against defects for one (1) year from substantial completion and shall promptly correct defective Work at no cost to the Owner." },
  { id: "cleanup", cluster: "General", title: "Daily cleanup & site protection",
    body: "Contractor shall keep the site clean and safe, protect existing finishes, and remove its debris at the end of each work period." },
  // Dispute & Execution
  { id: "dispute", cluster: "Dispute & Execution", title: "Good-faith dispute resolution",
    body: "The parties shall negotiate in good faith to resolve any dispute; any dispute not so resolved shall be submitted to mediation before either party commences litigation." },
];

// The "intent to be bound" / e-signature language shown above the signatures.
export const BINDING_LANGUAGE =
  "By applying their electronic signatures below, the parties intend to be legally bound by this Contract, including the scope, schedule, and terms maintained in the Project app. Each party agrees that an electronic signature applied within the Project app is valid and enforceable and has the same legal effect as a handwritten signature under applicable electronic-records law (including the U.S. ESIGN Act and the Uniform Electronic Transactions Act). Each signer represents they are authorized to bind their company. This Contract is effective on the date of the last signature below.";

const TERMS_PREAMBLE =
  "This Trade Contract is entered into between the Builder/General Contractor and the Trade/Vendor named below for work on the Project identified in the Evergreen app. The following terms apply to all Work, in addition to the scope, materials, selections, and schedule maintained in the app.";

// Sensible default standard set — includes the required clauses, with insurance,
// warranty and dispute available to toggle on.
const termsConfig: TermsConfig = {
  preamble: TERMS_PREAMBLE,
  bindingLanguage: BINDING_LANGUAGE,
  enabledClauseIds: [
    "schedule-malus", "ready-to-work", "no-lien", "pay-by-draw",
    "co-process", "co-in-app-accept", "no-verbal",
    "align-app-scope", "app-source-of-truth", "workmanlike",
  ],
  customClauses: [],
  perTrade: {},
};

// ---- Funding sources (owner budget) ----------------------------------------
const funding: FundingSource[] = [
  { id: "f-bank", name: "Current Bank Cash", amount: 16677, drawn: 0, rate: 0, liquidityRank: 1, fundType: "cash", timeframe: "Now", note: "On-hand operating cash." },
  { id: "f-401k", name: "CJ — 401k", amount: 50000, drawn: 50000, rate: 0, liquidityRank: 2, fundType: "debt", timeframe: "Dec", note: "401k loan — already drawn, must be repaid." },
  { id: "f-estate", name: "Estate Sale", amount: 28323, drawn: 0, rate: 0, liquidityRank: 3, fundType: "cash", timeframe: "TBD" },
  { id: "f-gold", name: "Gold (safe)", amount: 65400, drawn: 0, rate: 0, liquidityRank: 4, fundType: "cash", timeframe: "Now", note: "Liquidate as needed." },
  { id: "f-bonus", name: "CJ — Bonus", amount: 129000, drawn: 0, rate: 0, liquidityRank: 5, fundType: "cash", timeframe: "March" },
  { id: "f-wros", name: "CJ — Joint WROS", amount: 265000, drawn: 175000, rate: 0.02, costToAccess: 14000, liquidityRank: 6, fundType: "cash", timeframe: "Jan", note: "Investment account — opportunity cost of selling positions." },
  { id: "f-dj-reno", name: "DJ — Renovation", amount: 100000, drawn: 0, rate: 0.055, costToAccess: 5500, liquidityRank: 7, fundType: "debt", timeframe: "Dec", note: "Renovation loan — repaid." },
  { id: "f-heloc", name: "CJ — HELOC", amount: 222000, drawn: 0, rate: 0.07, costToAccess: 18000, liquidityRank: 8, fundType: "debt", timeframe: "June", note: "Highest cost of access — tap last; must be repaid." },
];

// ---- Schedule (Gantt) -------------------------------------------------------
// Ported verbatim from the live Google Sheet "Gantt" tab (tasks, start/end,
// duration). tradeId pairs each task to a Building Costs line so cost & QC
// progress stay live. Statuses are a snapshot as of 2026-06-27 (editable).
let sid = 0;
const sch = (
  label: string, start: string, end: string, durationLabel: string,
  tradeId: string | undefined, kind: ScheduleKind, status: ScheduleStatus,
): ScheduleItem => ({
  id: `sch-${++sid}`, label, start, end, durationLabel, tradeId, kind, status,
  confirm: "confirmed", confirmedStart: start, confirmedEnd: end, origStart: start, origEnd: end,
});

const schedule: ScheduleItem[] = [
  sch("Order kitchen cabinets & Windows (Time Sensitive)", "2026-06-16", "2026-07-28", "4 to 6 Weeks", "cabinets", "procurement", "in_progress"),
  sch("Waterproofing of Basement", "2026-06-16", "2026-06-29", "2 Weeks", "waterproofing", "work", "in_progress"),
  sch("Install new footings and foundations", "2026-06-16", "2026-06-29", "2 Weeks", "footings", "work", "in_progress"),
  sch("Framing and temp shoring", "2026-06-17", "2026-07-07", "3 Weeks", "rough-carpentry", "work", "in_progress"),
  sch("Demo kitchen floors", "2026-06-23", "2026-06-24", "2 Days", "demo", "work", "done"),
  sch("Rough Plumbing", "2026-06-23", "2026-07-06", "2 Weeks", "plumbing", "work", "in_progress"),
  sch("HVAC", "2026-07-06", "2026-07-12", "1 Week", "hvac", "work", "not_started"),
  sch("Rough Electrical", "2026-06-23", "2026-07-06", "2 Weeks", "electrical", "work", "in_progress"),
  sch("Exterior Sheathing and Tyvek", "2026-07-06", "2026-07-07", "2 Days", "rough-carpentry", "work", "not_started"),
  sch("Rough Inspections (Milestone)", "2026-07-06", "2026-07-12", "1 Week", undefined, "milestone", "not_started"),
  sch("Roofing", "2026-06-23", "2026-06-29", "1 Week", "roofing", "work", "in_progress"),
  sch("Siding", "2026-07-08", "2026-07-10", "3 Days", "siding", "work", "not_started"),
  sch("Windows", "2026-07-13", "2026-07-15", "3 Days", "windows", "work", "not_started"),
  sch("Insulation", "2026-07-13", "2026-07-19", "1 Week", "insulation", "work", "not_started"),
  sch("Drywall", "2026-07-20", "2026-08-02", "2 Weeks", "drywall", "work", "not_started"),
  sch("Masonry", "2026-07-06", "2026-07-12", "1 Week", "masonry", "work", "not_started"),
  sch("Finish trim and doors", "2026-08-03", "2026-08-09", "1 Week", "finish-carpentry", "work", "not_started"),
  sch("Specialty carpentry", "2026-08-10", "2026-08-23", "2 Weeks", "custom-carpentry", "work", "not_started"),
  sch("Install kitchen cabinets", "2026-08-10", "2026-08-23", "2 Weeks", "cabinets", "work", "not_started"),
  sch("Prime and paint", "2026-08-03", "2026-08-09", "1 Week", "painter-interior", "work", "not_started"),
  sch("Floor repairs/sanding/install", "2026-08-24", "2026-09-02", "10 Days", "hardwood-floor", "work", "not_started"),
  sch("Tile work", "2026-08-10", "2026-08-19", "10 Days", "tile", "work", "not_started"),
  sch("Countertops", "2026-08-24", "2026-08-26", "3 Days", "countertops", "work", "not_started"),
  sch("Order countertops (Time Sensitive)", "2026-07-20", "2026-08-02", "2 Weeks", "countertops", "procurement", "not_started"),
  sch("Order custom glass (Time Sensitive)", "2026-07-20", "2026-08-16", "4 Weeks", "fixtures", "procurement", "not_started"),
  sch("Install finish hardware", "2026-08-24", "2026-08-30", "1 Week", "hardware", "work", "not_started"),
  sch("Finish Plumbing", "2026-09-03", "2026-09-09", "1 Week", "plumbing", "work", "not_started"),
  sch("Finish HVAC", "2026-09-03", "2026-09-05", "3 Days", "hvac", "work", "not_started"),
  sch("Finish electrical", "2026-09-03", "2026-09-07", "5 Days", "electrical", "work", "not_started"),
  sch("Final Inspections (Milestone)", "2026-09-10", "2026-09-23", "2 Weeks", undefined, "milestone", "not_started"),
  sch("Punch list walkthrough", "2026-09-10", "2026-09-23", "2 Weeks", "general-conditions", "milestone", "not_started"),
];

// Assign trade users (for confirmations + notifications) where we have one.
const TRADE_USER: Record<string, string> = { electrical: "u-electric", plumbing: "u-plumb", windows: "u-windows" };
schedule.forEach((s) => { if (s.tradeId && TRADE_USER[s.tradeId]) s.assignedUserId = TRADE_USER[s.tradeId]; });

// Critical-path dependencies (by label → predecessor labels).
const byLabel = (l: string) => schedule.find((s) => s.label === l)?.id;
const DEPS: Record<string, string[]> = {
  "Rough Plumbing": ["Framing and temp shoring"],
  "Rough Electrical": ["Framing and temp shoring"],
  "HVAC": ["Framing and temp shoring"],
  "Exterior Sheathing and Tyvek": ["Framing and temp shoring"],
  "Rough Inspections (Milestone)": ["Rough Plumbing", "Rough Electrical", "HVAC"],
  "Insulation": ["Rough Inspections (Milestone)"],
  "Drywall": ["Insulation"],
  "Finish trim and doors": ["Drywall"],
  "Prime and paint": ["Drywall"],
  "Tile work": ["Drywall"],
  "Install kitchen cabinets": ["Drywall", "Order kitchen cabinets & Windows (Time Sensitive)"],
  "Specialty carpentry": ["Drywall"],
  "Countertops": ["Install kitchen cabinets", "Order countertops (Time Sensitive)"],
  "Floor repairs/sanding/install": ["Prime and paint"],
  "Install finish hardware": ["Prime and paint"],
  "Finish Plumbing": ["Countertops"],
  "Finish HVAC": ["Drywall"],
  "Finish electrical": ["Prime and paint"],
  "Final Inspections (Milestone)": ["Finish Plumbing", "Finish electrical", "Finish HVAC"],
  "Punch list walkthrough": ["Final Inspections (Milestone)"],
  "Siding": ["Exterior Sheathing and Tyvek"],
  "Windows": ["Exterior Sheathing and Tyvek"],
};
schedule.forEach((s) => {
  const deps = (DEPS[s.label] ?? []).map(byLabel).filter(Boolean) as string[];
  if (deps.length) s.deps = deps;
});

// ---- Lock baselines + per-line contracts + phases on contracted work --------
// Contracted lines are treated as locked-in: baseline = their all-in total, with
// a standard 40/40/20 phase split and the master terms appended.
costLines.forEach((l) => {
  l.contractMode = l.owner === "owner" ? "direct" : "appendix";
  l.termsAppended = true;
  l.contractSummary = l.desc;
  if (l.status === "contracted") {
    l.locked = true;
    l.baseline = lineTotal(l);
    l.phases = [
      { id: `${l.id}-ph1`, name: "Mobilization / Deposit", mode: "pct", value: 40 },
      { id: `${l.id}-ph2`, name: "Substantial completion", mode: "pct", value: 40 },
      { id: `${l.id}-ph3`, name: "Final / punch", mode: "pct", value: 20 },
    ];
  }
});

// A couple of real-world change orders + a found saving, as contract exhibits.
const addCO = (lineId: string, co: { kind: "change" | "savings"; title: string; desc: string; amount: number; date: string; status: "proposed" | "approved" }) => {
  const l = costLines.find((x) => x.id === lineId);
  if (!l) return;
  l.changeOrders.push({ id: `${lineId}-co${l.changeOrders.length + 1}`, exhibit: `Exhibit ${String.fromCharCode(65 + l.changeOrders.length)}`, ...co });
};
const byName = (name: string) => costLines.find((l) => l.name === name)?.id;
const masonryId = byName("Masonry");
if (masonryId) addCO(masonryId, { kind: "change", title: "Dining room chimney tuckpoint", desc: "Owner-requested CO to tuckpoint and assess the dining-room chimney once the mason is on site.", amount: 1800, date: "2026-06-20", status: "proposed" });
const demoId = byName("Insulation, Drywall & Demo") ?? byName("Insulation");
if (demoId) addCO(demoId, { kind: "savings", title: "Demo carved out of drywall bid", desc: "Aaron confirmed demo represented ~$5k of the combined bid; removed and tracked as a saving.", amount: 5000, date: "2026-05-20", status: "approved" });

// ---- Draws (Payment Tracker) ------------------------------------------------
// Budget lines allocated into draws by % of their current total. Three default
// draws; Draw 1 is paid (mobilization), Draw 2 pushed (rough-in), Draw 3 empty.
const alloc = (names: string[], pct: number) => names.map((n) => byName(n)).filter(Boolean).map((lineId) => ({ lineId: lineId as string, mode: "pct" as const, value: pct }));
// Fixed-dollar allocations for historical (already-paid) draws.
const flat = (pairs: [string, number][]) => pairs.map(([n, a]) => { const id = byName(n); return id ? { lineId: id, mode: "flat" as const, value: a } : null; }).filter(Boolean) as { lineId: string; mode: "flat"; value: number }[];
const draws: Draw[] = [
  // ---- Historical / already-paid draws (from the signed Exhibit A docs & ledger) ----
  { id: "draw-h1", name: "Exhibit A-1 — Mobilization", status: "paid", paidDate: "2026-01-22", note: "Permit admin, GC mobilization & early plumbing (sewer scope, water-meter rework, toilet). Signed Exhibit A.", allocations: flat([["General Conditions", 3750], ["Plumbing", 2034]]) },
  { id: "draw-h2", name: "Exhibit A-2 — Demolition", status: "paid", paidDate: "2026-01-22", note: "Demo to studs across kitchen, basement & baths. Paid in full — signed Exhibit A-2.", allocations: flat([["Demo (completed)", 9660]]) },
  { id: "draw-h3", name: "Roof & Chimney", status: "paid", paidDate: "2026-02-15", note: "Full roof replacement + chimney repairs/carpentry — completed & paid.", allocations: flat([["Roof — Main House (completed)", 43560]]) },
  { id: "draw-h4", name: "Exhibit A-3 — HVAC", status: "paid", paidDate: "2026-02-09", note: "Furnace replacement + temporary thermostats/duct repairs. Signed Exhibit A-3.", allocations: flat([["HVAC", 5760]]) },
  { id: "draw-h5", name: "Exhibit A-4 — Electrical Service", status: "paid", paidDate: "2026-04-02", note: "Service call + new 200A service/panel/grounding. Signed Exhibit A-4.", allocations: flat([["Electrical", 4998]]) },
  { id: "draw-h6", name: "Exhibit A-5 — Waterproofing", status: "paid", paidDate: "2026-05-06", note: "Interior drainage + sump, walk-out waterproofing. Paid on signing — Exhibit A-5.", allocations: flat([["Waterproofing", 19692]]) },
  // ---- Upcoming ----
  { id: "draw-2", name: "Draw 2 — Rough-in", status: "planned", note: "Release after rough inspections pass.", allocations: alloc(["HVAC", "Electrical", "Plumbing", "Framing"], 40) },
  { id: "draw-3", name: "Draw 3 — Finishes", status: "planned", note: "", allocations: [] },
];

// ---- Vendor agreements ------------------------------------------------------
// One per trade that has any cost line. Round 1 = scope+cost, Round 2 = draw
// schedule + dates. A few are pre-populated to show the signing flow.
const activeTradeIds = Array.from(new Set(costLines.map((l) => l.tradeId)));
const vendorAgreements: VendorAgreement[] = activeTradeIds.map((tradeId) => ({
  tradeId, round1: [], round2: [],
}));
const va = (tradeId: string) => vendorAgreements.find((a) => a.tradeId === tradeId);
const plumbA = va("plumbing");
if (plumbA) { plumbA.drawRequest = "30% deposit on contract signing, then monthly progress draws on % complete; net-15 terms."; plumbA.round1 = [{ party: "builder", name: "Aaron — Oasis", at: "2026-05-10T15:00:00Z" }, { party: "trade", name: "Lakeside Plumbing — Danny", at: "2026-05-11T18:00:00Z" }]; }
const elecA = va("electrical");
if (elecA) elecA.drawRequest = "25% mobilization, 50% at rough-in inspection, 25% at finish; net-30.";

// ---- Materials (from the real materials list) -------------------------------
let mid = 0;
// Materials default to owner-purchased; timing ties to the trade's Gantt when a
// trade is set (and no hard date given), else falls back to a hard date.
const m = (o: Omit<Material, "id">): Material => ({
  id: `mat-${++mid}`,
  ...o,
  purchaser: o.purchaser ?? "owner",
  qty: o.qty ?? 1,
  dueMode: o.dueMode ?? (o.tradeId ? "trade" : "hard"), // a trade always drives the dates
});
const materials: Material[] = [
  m({ item: "Shower Trim", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Vent", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Faucet 1", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Faucet 2", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Toilet", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Tub", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Trim Kit (TP Holder, Towel Bar, etc)", roomId: "primary-bath", roomLabel: "Primary Bathroom", status: "needed", purchaser: "owner" }),
  m({ item: "Mirror (2)", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "cabinets", status: "needed", purchaser: "owner" }),
  m({ item: "Vanities (2)", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "cabinets", status: "needed", purchaser: "owner" }),
  m({ item: "Cabinet Pulls", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "cabinets", status: "needed", notes: "Might not be needed", purchaser: "owner" }),
  m({ item: "SteamSpa Kit", roomId: "primary-bath", roomLabel: "Master Bathroom", tradeId: "appliances", qty: 1, status: "ordered", location: "InGarage", purchaser: "owner" }),
  m({ item: "Wall sconces", roomId: "primary-bed", roomLabel: "Primary Bedroom", tradeId: "electrical", status: "needed", purchaser: "owner" }),
  m({ item: "Water tap", roomId: "primary-balcony", roomLabel: "Primary Balcony", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Shower Trim", roomId: "kids-bath", roomLabel: "Kids Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Vent", roomId: "kids-bath", roomLabel: "Kids Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Faucet 1", roomId: "kids-bath", roomLabel: "Kids Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Faucet 2", roomId: "kids-bath", roomLabel: "Kids Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Tub", roomId: "kids-bath", roomLabel: "Kids Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Toilet", roomId: "kids-bath", roomLabel: "Kids Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Mirror", roomId: "kids-bath", roomLabel: "Kids Bathroom", tradeId: "cabinets", status: "needed", purchaser: "owner" }),
  m({ item: "Vanity", roomId: "kids-bath", roomLabel: "Kids Bathroom", tradeId: "cabinets", status: "needed", notes: "3 x 3 drawers if avail", purchaser: "owner" }),
  m({ item: "Cabinet Pulls", roomId: "kids-bath", roomLabel: "Kids Bathroom", tradeId: "cabinets", status: "needed", notes: "Might not be needed", purchaser: "owner" }),
  m({ item: "Faucet 1", roomId: "powder", roomLabel: "First Floor Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Vent", roomId: "powder", roomLabel: "First Floor Bathroom", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Toilet", roomId: "powder", roomLabel: "First Floor Bathroom", tradeId: "plumbing", specLink: "https://www.bedbathandbeyond.com/Home-Garden/Dark-Oak-High-Tank-Pull-Chain-Toilet-Renovators-Supply/34791514/product.html", status: "needed", purchaser: "owner" }),
  m({ item: "Trim Kit (TP Holder, Towel Bar, etc)", roomId: "powder", roomLabel: "First Floor Bathroom", status: "needed", purchaser: "owner" }),
  m({ item: "Mirror", roomId: "powder", roomLabel: "First Floor Bathroom", tradeId: "cabinets", status: "needed", purchaser: "owner" }),
  m({ item: "Vanity", roomId: "powder", roomLabel: "First Floor Bathroom", tradeId: "cabinets", specLink: "https://www.wayfair.com/home-improvement/pdp/house-of-hampton-vintage-console-bathroom-vanities-set-w115767035.html", status: "needed", purchaser: "owner" }),
  m({ item: "Cabinet Pulls", roomId: "powder", roomLabel: "First Floor Bathroom", tradeId: "cabinets", status: "needed", notes: "Might not be needed", purchaser: "owner" }),
  m({ item: "Drain (p-trap)", tradeId: "plumbing", specLink: "https://www.wayfair.com/home-improvement/pdp/kingston-brass-vintage-p-trap-kbbb3267.html", status: "needed", purchaser: "owner" }),
  m({ item: "Faucet", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Disposal Switch", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Cup Rinser", roomId: "kitchen", roomLabel: "Kitchen or bar?", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Sink", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "plumbing", status: "needed", purchaser: "owner" }),
  m({ item: "Cabinet Pulls - 1", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "cabinets", status: "needed", purchaser: "owner" }),
  m({ item: "Cabinet Pulls - 2", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "cabinets", status: "needed", purchaser: "owner" }),
  m({ item: "Range Vent", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "appliances", status: "needed", purchaser: "owner" }),
  m({ item: "Fridge", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "appliances", status: "needed", purchaser: "owner" }),
  m({ item: "Range", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "appliances", status: "needed", purchaser: "owner" }),
  m({ item: "Microwave", roomId: "kitchen", roomLabel: "Kitchen", status: "needed", purchaser: "owner" }),
  m({ item: "Food Warmer Lamp", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "appliances", status: "purchased", location: "InGarage", purchaser: "owner" }),
  m({ item: "Pendant Light", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "electrical", status: "needed", purchaser: "owner" }),
  m({ item: "Breakers - 20A", roomId: "basement-finished", roomLabel: "Basement", tradeId: "electrical", qty: 14, status: "ordered", location: "InGarage", purchaser: "owner" }),
  m({ item: "Breakers - 15A", roomId: "basement-finished", roomLabel: "Basement", tradeId: "electrical", qty: 10, status: "ordered", location: "InGarage", purchaser: "owner" }),
  m({ item: "Breakers - 20A - Remote Control", roomId: "basement-finished", roomLabel: "Basement", tradeId: "electrical", qty: 3, status: "ordered", location: "InGarage", notes: "Need to know what we want on these circuits", purchaser: "owner" }),
  m({ item: "Breakers - 50A - Remote Control", roomId: "basement-finished", roomLabel: "Basement", tradeId: "electrical", qty: 1, status: "ordered", location: "InGarage", notes: "Need to know what we want on this circuit", purchaser: "owner" }),
  m({ item: "Smart Smoke Detectors", roomId: "whole-house", roomLabel: "Entire House", tradeId: "electrical", qty: 9, status: "ordered", location: "InGarage", notes: "Discuss locations", purchaser: "owner" }),
  m({ item: "Single Pole Push Button Dimmers", tradeId: "electrical", qty: 14, status: "ordered", location: "InGarage", notes: "Need locations", purchaser: "owner" }),
  m({ item: "Movie Screen Kit", roomId: "basement-finished", roomLabel: "Basement", tradeId: "electrical", status: "needed", purchaser: "owner" }),
  m({ item: "Sink", roomId: "basement-finished", roomLabel: "Basement", tradeId: "plumbing", specLink: "https://www.homedepot.com/p/HOROW-Wall-Mounted-Vessel-Sink/323330758", status: "needed", purchaser: "owner" }),
  m({ item: "Toilet", roomId: "basement-finished", roomLabel: "Basement", tradeId: "plumbing", specLink: "https://www.homedepot.com/p/KOHLER-Highline-Arc-Toilet/327529133", status: "needed", purchaser: "owner" }),
  m({ item: "Water heater", roomId: "basement-finished", roomLabel: "Basement", tradeId: "plumbing", specLink: "https://www.lowes.com/pd/A-O-Smith-80-Gallon-Hybrid-Heat-Pump-Water-Heater/5013803451", status: "needed", purchaser: "owner" }),
  m({ item: "Ext Door", roomId: "primary-bath", roomLabel: "Primary Bathroom", tradeId: "windows", desc: "30'' ext door", status: "needed", purchaser: "owner" }),
  m({ item: "Window 1", roomId: "bed-4", roomLabel: "Bed 4", tradeId: "windows", desc: "3'x5' - Egress", status: "needed", notes: "Reuse removed window (measure)", purchaser: "owner" }),
  m({ item: "Window 2", roomId: "bed-4", roomLabel: "Bed 4", tradeId: "windows", desc: "3'x5' - Egress", status: "needed", notes: "Reuse removed window (measure)", purchaser: "owner" }),
  m({ item: "Window 3", roomId: "bed-4", roomLabel: "Bed 4", tradeId: "windows", desc: "2'8''x3'6'' - Tempered", status: "needed", purchaser: "owner" }),
  m({ item: "Window 1", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "windows", desc: "2'6''x3'6''", status: "needed", purchaser: "owner" }),
  m({ item: "Window 2", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "windows", desc: "2'6''x3'6'' DH", status: "needed", purchaser: "owner" }),
  m({ item: "Window 3", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "windows", desc: "2'6''x3'6'' DH", status: "needed", purchaser: "owner" }),
  m({ item: "Window 4", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "windows", desc: "2'6''x3'6'' DH", status: "needed", purchaser: "owner" }),
  m({ item: "Window 5", roomId: "kitchen", roomLabel: "Kitchen", tradeId: "windows", desc: "2'6''x3'6''", status: "needed", purchaser: "owner" }),
  m({ item: "Window 1", roomId: "mudroom", roomLabel: "Mud Hall", tradeId: "windows", desc: "2'4''x3'6''", status: "needed", purchaser: "owner" }),
  m({ item: "Ext Door", roomId: "mudroom", roomLabel: "Mud Hall", tradeId: "windows", desc: "32''", status: "needed", notes: "Transom door w/ window (measure)", purchaser: "owner" }),
];
// Critical-path selections + designer approval states (demo).
const matBy = (item: string, room?: string) => materials.find((x) => x.item === item && (!room || x.roomLabel === room));
const mc = (item: string, room: string | undefined, due: string, opts: Partial<Material> = {}) => { const x = matBy(item, room); if (x) Object.assign(x, { critical: true, dueDate: due, ...opts }); };
mc("Vanity", "First Floor Bathroom", "2026-07-05", { approvalRequested: true });
mc("Toilet", "First Floor Bathroom", "2026-07-05", { designerApproved: true });
mc("Tub", "Primary Bathroom", "2026-07-12");
mc("Sink", "Kitchen", "2026-07-15", { approvalRequested: true });
mc("Water heater", "Basement", "2026-07-01", { designerApproved: true });
const steam = matBy("SteamSpa Kit"); if (steam) steam.designerApproved = true;

// ---- Artifacts (document library) -------------------------------------------
let aid = 0;
const af = (o: Omit<Artifact, "id">): Artifact => ({ id: `art-${++aid}`, ...o });
// A signed Scope-of-Work / Exhibit-A contract PDF (served from /public/contracts).
// Visible to the Owner and Builder only (full_admin always sees everything).
const sc = (name: string, tradeId: string, signedDate: string, summary: string, file: string): Artifact => af({
  name, kind: "contract", source: "Oasis Asset Management LLC", date: signedDate, audience: ["owner", "builder"], tradeIds: [tradeId], summary,
  versions: [{ id: `v-${file}`, label: "Signed", uploadedAt: `${signedDate}T16:00:00.000Z`, uploadedBy: "DocuSign", fileUrl: `/contracts/${file}`, fileName: file }],
});
const artifacts: Artifact[] = [
  af({ name: "Architectural Plans — Schematic Set", kind: "drawing", source: "Joseph Mosey Architecture", date: "2026-05", notes: "Floor plans, elevations, sections. Open the interactive view to pin comments, photo details, or change requests — and to shade each trade's scope.", watch: true,
    versions: [
      { id: "v-arch-1", label: "v1 — schematic", uploadedAt: "2026-04-02T15:00:00.000Z", uploadedBy: "Joseph Mosey Architecture", driveUrl: "https://drive.google.com/drive/architectural" },
      { id: "v-arch-2", label: "v2 — after plan review", uploadedAt: "2026-05-09T15:00:00.000Z", uploadedBy: "Joseph Mosey Architecture", driveUrl: "https://drive.google.com/drive/architectural" },
    ] }),
  af({ name: "Structural Engineering Drawings", kind: "drawing", source: "Metropolitan Structural Engineers", date: "2026-04", url: "" }),
  af({ name: "Land Survey", kind: "survey", source: "Fenn & Associates", date: "2026-04-17", url: "" }),
  af({ name: "General Construction Permit", kind: "permit", source: "Municipality", date: "2026-05", isGeneralPermit: true, permitStatus: "issued", notes: "Master permit for the project (billed at cost, $6,638.72). Covers the general construction scope — no per-trade one-offs required unless a trade pulls its own.", url: "" }),
  af({ name: "Electrical Permit", kind: "permit", source: "Municipality", date: "2026-05", audience: ["owner", "builder", "trade"], tradeIds: ["electrical"], permitStatus: "pending", gatesTradeIds: ["electrical"], notes: "Sub-permit under the General Construction Permit.", url: "" }),
  af({ name: "Plumbing Permit", kind: "permit", source: "Municipality", date: "2026-05", audience: ["owner", "builder", "trade"], tradeIds: ["plumbing"], permitStatus: "issued", gatesTradeIds: ["plumbing"], notes: "Sub-permit under the General Construction Permit.", url: "" }),
  af({ name: "Design Intent — Restoration", kind: "design", source: "The Johnson Family", date: "2026-03", notes: "Grand vision, guiding principles, room-by-room intent (1822 farmhouse).", url: "" }),
  af({ name: "Pinterest References", kind: "design", source: "Owner", url: "https://pinterest.com" }),
  // ---- Signed payment documents (Scope of Work / Exhibit A). Owner + Builder only.
  sc("Signed: Demo — Scope of Work (Exhibit A-2)", "demo", "2026-01-22",
    "Total $9,660. Draw: $4,830 deposit + $4,830 on completion. DocuSigned by Christopher Johnson (Owner) & Aaron Wright (Oasis, Managing Member). Envelope 2C69AF5B.", "exhibit-a2-demo-signed.pdf"),
  sc("Signed: HVAC (temp repairs) — Scope of Work (Exhibit A-3)", "hvac", "2026-02-09",
    "Total $960, due on signing. Thermostat wiring + basement duct repair. DocuSigned by Christopher Johnson & Aaron Wright. Envelope 337F90A9.", "exhibit-a3-hvac-signed.pdf"),
  sc("Signed: Electrical 200A Service — Scope of Work (Exhibit A-4)", "electrical", "2026-04-02",
    "Total $4,560 ($3,800 + 20% Oasis fee), due on signing. New 200A service, meter, panel, grounding. DocuSigned by Christopher Johnson & Aaron Wright. Envelope 57503B95.", "exhibit-a4-electrical-service-signed.pdf"),
  sc("Signed: Waterproofing — Scope of Work (Exhibit A-5)", "waterproofing", "2026-05-06",
    "Total $19,692, due on signing. Interior drainage + sump, walk-out waterproofing, retaining-wall removal. Permits billed as CO at cost. DocuSigned by Christopher Johnson & Aaron Wright. Envelope 346EF5E8.", "exhibit-a5-waterproofing-signed.pdf"),
];

// ---- Contacts & billing -----------------------------------------------------
let ctid = 0;
const ct = (o: Omit<ContactSheet, "id">): ContactSheet => ({ id: `contact-${++ctid}`, ...o });
const contacts: ContactSheet[] = [
  ct({ party: "builder", company: "Oasis Builders (General Contractor)", contactName: "Marcus Reed", email: "marcus@oasisbuilders.com", phone: "(248) 555-0142", address: "1100 Industrial Row, Royal Oak, MI",
    billing: { payableTo: "Oasis Builders LLC", email: "ar@oasisbuilders.com", taxId: "38-1234567", paymentTerms: "Net 15 on approved draws", remittance: "ACH on file / checks to Oasis Builders LLC" },
    workers: [{ id: "w-b1", name: "Marcus Reed", role: "Project Lead / GC", email: "marcus@oasisbuilders.com", phone: "(248) 555-0142", appAccess: true }, { id: "w-b2", name: "Dana Cole", role: "Site Super", phone: "(248) 555-0177", appAccess: true }] }),
  ct({ party: "owner", company: "The Johnson Family (Owner)", contactName: "Chris Johnson", email: "christopher.cf@gmail.com", phone: "(248) 555-0190", address: "31810 Evergreen Rd",
    billing: { payableTo: "Christopher Johnson", email: "christopher.cf@gmail.com", paymentTerms: "Funds draws per schedule" } }),
  ct({ party: "vendor", tradeId: "electrical", company: "Brightwire Electric", contactName: "Sam Ortiz", email: "sam@brightwire.com", phone: "(586) 555-0233",
    billing: { payableTo: "Brightwire Electric Inc.", email: "billing@brightwire.com", taxId: "38-7654321", paymentTerms: "40% deposit, balance on inspection" },
    workers: [{ id: "w-e1", name: "Sam Ortiz", role: "Master Electrician", email: "sam@brightwire.com", appAccess: true }, { id: "w-e2", name: "Leo Park", role: "Apprentice", appAccess: false }] }),
  ct({ party: "vendor", tradeId: "windows", company: "Diverse Windows", contactName: "Rita Vance", email: "rita@diversewindows.com", phone: "(313) 555-0288",
    billing: { payableTo: "Diverse Windows LLC", paymentTerms: "40% deposit, balance on completion" } }),
  ct({ party: "vendor", tradeId: "driveway", company: "Johnson-managed paver (TBD)", contactName: "Chris Johnson", email: "christopher.cf@gmail.com", phone: "(248) 555-0190", notes: "Owner is sourcing the driveway/paving vendor directly.",
    billing: { paymentTerms: "Owner pays vendor directly" } }),
];

// ---- Assemble ---------------------------------------------------------------
export function buildDB(): DB {
  return {
    project,
    users,
    trades,
    rooms,
    scopeTemplates,
    scope: buildScope(),
    costLines,
    contracts,
    contacts,
    terms: termsConfig,
    funding,
    schedule,
    notifications: [],
    scheduleRevisions: [],
    draws,
    vendorAgreements,
    materials,
    artifacts,
    updates: [],
    bidPackages: [],
    tradeRatings: [],
  };
}

// A cheap signature so the store can detect "is this still the seed?" if needed.
export function signatureOf(db: DB): string {
  return `${db.costLines.length}:${db.rooms.length}:${db.funding.length}`;
}
