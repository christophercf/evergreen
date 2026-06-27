// ----------------------------------------------------------------------------
// Quality-control recommendations. For each trade we suggest the checks that
// should pass before owner + builder sign off. The Timing/QC drill-down pairs
// these with the other trades in-scope in the same room so sign-offs account
// for coordination (e.g. don't close drywall before electrical rough passes).
// ----------------------------------------------------------------------------

const REC: Record<string, string[]> = {
  electrical: [
    "Rough inspection passed before any cover-up",
    "All junction boxes accessible and labeled",
    "GFCI/AFCI protection where code requires",
    "Panel lugs torqued; circuits labeled",
    "Every device & fixture tested after finish",
  ],
  plumbing: [
    "Supply lines pressure-tested, no drops",
    "Drains pitched correctly and vented",
    "All joints leak-checked",
    "Fixture rough-in heights verified to plan",
    "Finish fixtures operate with no leaks",
  ],
  hvac: [
    "Ducts sealed and properly supported",
    "Supply/return balanced per room",
    "Thermostat operation verified",
    "Condensate drainage runs to daylight/drain",
  ],
  "rough-carpentry": [
    "Temp shoring removed safely after load path set",
    "Stud spacing, headers & blocking per plan",
    "Square, level, and plumb confirmed",
    "Hold-downs and fasteners per structural drawings",
  ],
  footings: [
    "Excavation depth below frost line",
    "Rebar size & placement per engineer",
    "Inspected and approved before pour",
  ],
  drywall: [
    "No fastener pops; screws set correctly",
    "Seams & corners sanded smooth and straight",
    "Greenboard/cement board in wet areas",
    "Ready for primer (no telegraphing)",
  ],
  insulation: [
    "Specified R-value achieved with full coverage",
    "No gaps, voids, or compression",
    "Baffles at eaves; vapor control where required",
    "Inspected before drywall",
  ],
  tile: [
    "Waterproofing membrane verified before tile",
    "Floor slope to drain correct",
    "Lippage within tolerance; layout centered",
    "Grout cured and sealed",
  ],
  "painter-interior": [
    "Even coverage, no holidays or roller marks",
    "Clean, straight cut lines",
    "Trim & doors free of drips/sags",
  ],
  "painter-exterior": [
    "Surfaces scraped, primed, and caulked",
    "Even coverage; flashing/caulk at transitions",
    "Back-priming on new wood",
  ],
  cabinets: [
    "Boxes level, plumb, and secured to studs",
    "Doors & drawers aligned and operating",
    "Filler/scribe fit clean to walls",
  ],
  countertops: [
    "Seams tight, level, and color-matched",
    "Adequate overhang support",
    "Sink/faucet/cooktop cutouts correct",
  ],
  "hardwood-floor": [
    "Subfloor moisture within spec before install",
    "No squeaks, gaps, or cupping",
    "Sanding and finish even and consistent",
  ],
  "finish-carpentry": [
    "Joints tight, caulked, and filled",
    "Reveals and returns consistent",
    "Trim secure, level, and plumb",
  ],
  "custom-carpentry": [
    "Built-ins level, plumb, and anchored",
    "Face frames and reveals consistent",
    "Finish-ready surfaces",
  ],
  hardware: [
    "All doors latch and lock smoothly",
    "Cabinet hardware aligned and tight",
    "Bath accessories anchored to blocking",
  ],
  roofing: [
    "Ice/water shield and underlayment per spec",
    "Flashing at all penetrations & valleys",
    "Drip edge installed; no exposed fasteners",
  ],
  masonry: [
    "Tuckpointing matches color & joint profile",
    "Chimney cap/crown poured and sealed",
    "Flashing integrated with masonry",
  ],
  waterproofing: [
    "Sump pump operation tested",
    "Interior drainage runs to sump/daylight",
    "Wall coating coverage complete",
  ],
  windows: [
    "Sill pan & flashing installed correctly",
    "Operation, locks, and weatherstrip verified",
    "Exterior sealed; egress sizing where required",
  ],
  siding: [
    "Proper overlap and flashing laps",
    "Fastener pattern to spec",
    "Caulk at transitions and penetrations",
  ],
  demo: [
    "Only in-scope elements removed",
    "Salvage items protected and stored",
    "Site left safe and clean",
  ],
};

const DEFAULT: string[] = [
  "Work matches the contracted scope",
  "Adjacent finishes protected during work",
  "Site cleaned and debris removed",
  "Photo-documented for the record",
];

export function qcRecommendations(tradeId: string | undefined): string[] {
  return (tradeId && REC[tradeId]) || DEFAULT;
}
