// ----------------------------------------------------------------------------
// Evergreen seed — the 31810 Evergreen Rd renovation, ported from the two
// working spreadsheets ("31810 Evergreen.xlsx" + the Shared budget workbook).
// buildDB() returns a fresh, fully-seeded DB; the mock backend persists any
// edits over the top of it in localStorage.
// ----------------------------------------------------------------------------

import type {
  Contract, CostLine, DB, Draw, FundingSource, Project, Room, ScopeCell, ScopeItem,
  Trade, TradeScopeTemplate, User, MacroCategory, ScopeStatus, ScheduleItem,
  ScheduleKind, ScheduleStatus,
} from "./types";
import { lineTotal } from "./money";

// ---- Project ----------------------------------------------------------------
const project: Project = {
  id: "evergreen",
  name: "31810 Evergreen",
  address: "31810 Evergreen Rd",
  built: "1822 Farmhouse",
  bufferPct: 10,
};

// ---- Users ------------------------------------------------------------------
const users: User[] = [
  { id: "u-owner", name: "Chris Johnson", email: "christopher.cf@gmail.com", phone: "", role: "owner" },
  { id: "u-owner2", name: "Emily Johnson", email: "emily@johnson.family", role: "owner" },
  { id: "u-builder", name: "Aaron — Oasis", email: "aaron@oasisbuild.example", phone: "", role: "builder", doorCode: "1822" },
  { id: "u-electric", name: "Electrician (Oasis sub)", email: "electric@oasisbuild.example", role: "trade", tradeIds: ["electrical"], doorCode: "1822" },
  { id: "u-plumb", name: "Lakeside Plumbing — Danny", email: "danny@lakeside.example", phone: "313-554-1900", role: "trade", tradeIds: ["plumbing"], doorCode: "1822" },
  { id: "u-windows", name: "Diverse Windows", email: "info@windowsdiverse.example", phone: "313-655-5684", role: "trade", tradeIds: ["windows"] },
  { id: "u-design", name: "Designer (TBD)", email: "design@example.com", role: "viewer" },
];

// ---- Trades -----------------------------------------------------------------
const T = (id: string, name: string, category: MacroCategory, defaultOwner: "builder" | "owner" = "builder"): Trade =>
  ({ id, name, category, defaultOwner });

const trades: Trade[] = [
  // Soft costs
  T("design", "Design", "Soft Costs", "owner"),
  T("architect", "Architect", "Soft Costs", "owner"),
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
  T("windows", "Windows", "Structure & Envelope"),
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

  // ---- Allowances not yet contracted (right-hand table, low/high)
  cl({ name: "Painting (interior)", tradeId: "painter-interior", category: "Interior Finishes", owner: "builder", roomIds: ["whole-house"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "~3400 sqft.", allowanceLow: 20000, allowanceHigh: 25000, history: hist(42000, 25000, null) }),
  cl({ name: "Cabinets", tradeId: "cabinets", category: "Interior Finishes", owner: "builder", roomIds: ["kitchen", "primary-bath", "kids-bath"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Kitchen & bathroom cabinets (~35).", allowanceLow: 30000, allowanceHigh: 35000, history: hist(35000, 35000, null) }),
  cl({ name: "Drywall / Plaster", tradeId: "drywall", category: "Interior Finishes", owner: "builder", roomIds: [], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Drywall replacement as needed; greenboard in baths; plaster repairs; wallpaper removal.", allowanceLow: 22000, allowanceHigh: 26000, history: hist(18000, 26000, null) }),
  cl({ name: "Floors (Hardwood)", tradeId: "hardwood-floor", category: "Interior Finishes", owner: "builder", roomIds: ["great-room", "dining", "office", "parlor"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "~3400 sqft, repairs & patches as needed.", allowanceLow: 27000, allowanceHigh: 35000, history: hist(30000, 35000, null) }),
  cl({ name: "Tile", tradeId: "tile", category: "Interior Finishes", owner: "builder", roomIds: ["primary-bath", "kids-bath", "powder", "kitchen"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Shower walls/floors, bathroom floors, kitchen floor, master bath walls.", allowanceLow: 15000, allowanceHigh: 20000, history: hist(null, 20000, null) }),
  cl({ name: "Hardware", tradeId: "hardware", category: "Interior Finishes", owner: "builder", roomIds: ["whole-house"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Assess/adjust door hardware; work old existing hardware for accents.", allowanceLow: 6000, allowanceHigh: 7500, history: hist(12000, 7500, null) }),
  cl({ name: "Floors (Non-Hardwood)", tradeId: "floors-nonhardwood", category: "Interior Finishes", owner: "builder", roomIds: ["kitchen", "primary-bath", "kids-bath"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Bathrooms, kitchen, areas where hardwood not existing.", allowanceLow: 5000, allowanceHigh: 8000, history: hist(8000, 8000, null) }),
  cl({ name: "Basement Windows", tradeId: "windows", category: "Structure & Envelope", owner: "builder", roomIds: ["basement-unfinished"], markupModel: "passthrough", markupPct: 20, status: "allowance", desc: "Glass-block basement windows in old portion.", allowanceLow: 3500, allowanceHigh: 4500, history: hist(4500, 4500, null) }),
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

// ---- Funding sources (owner budget) ----------------------------------------
const funding: FundingSource[] = [
  { id: "f-bank", name: "Current Bank Cash", amount: 16677, drawn: 0, rate: 0, liquidityRank: 1, timeframe: "Now", note: "On-hand operating cash." },
  { id: "f-401k", name: "CJ — 401k", amount: 50000, drawn: 50000, rate: 0, liquidityRank: 2, timeframe: "Dec", note: "Already drawn." },
  { id: "f-estate", name: "Estate Sale", amount: 28323, drawn: 0, rate: 0, liquidityRank: 3, timeframe: "TBD" },
  { id: "f-gold", name: "Gold (safe)", amount: 65400, drawn: 0, rate: 0, liquidityRank: 4, timeframe: "Now", note: "Liquidate as needed." },
  { id: "f-bonus", name: "CJ — Bonus", amount: 129000, drawn: 0, rate: 0, liquidityRank: 5, timeframe: "March" },
  { id: "f-wros", name: "CJ — Joint WROS", amount: 265000, drawn: 175000, rate: 0.02, costToAccess: 14000, liquidityRank: 6, timeframe: "Jan", note: "Investment account — opportunity cost of selling positions." },
  { id: "f-dj-reno", name: "DJ — Renovation", amount: 100000, drawn: 0, rate: 0.055, costToAccess: 5500, liquidityRank: 7, timeframe: "Dec" },
  { id: "f-heloc", name: "CJ — HELOC", amount: 222000, drawn: 0, rate: 0.07, costToAccess: 18000, liquidityRank: 8, timeframe: "June", note: "Highest cost of access — tap last." },
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
  confirm: "confirmed", confirmedStart: start, confirmedEnd: end,
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

// ---- Draws (Payments tab) ---------------------------------------------------
// Draw 1 (paid): the mobilization phase of the early structural/MEP work.
const ph1 = (name: string) => { const id = byName(name); return id ? { lineId: id, phaseId: `${id}-ph1` } : null; };
const draw1Refs = ["General Conditions", "Waterproofing", "Footings", "Roof for Additions", "Masonry"].map(ph1).filter(Boolean) as { lineId: string; phaseId: string }[];
const draw2Refs = ["HVAC", "Electrical", "Plumbing", "Framing"].map(ph1).filter(Boolean) as { lineId: string; phaseId: string }[];
const draws: Draw[] = [
  { id: "draw-1", name: "Draw 1 — Mobilization", phaseRefs: draw1Refs, status: "paid", paidDate: "2026-06-15", note: "Initial mobilization across early structural & site work." },
  { id: "draw-2", name: "Draw 2 — Rough-in", phaseRefs: draw2Refs, status: "planned", note: "Released after rough inspections pass." },
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
    funding,
    schedule,
    notifications: [],
    draws,
  };
}

// A cheap signature so the store can detect "is this still the seed?" if needed.
export function signatureOf(db: DB): string {
  return `${db.costLines.length}:${db.rooms.length}:${db.funding.length}`;
}
