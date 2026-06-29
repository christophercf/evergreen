"use client";

import { useMemo, useRef, useState } from "react";
import type { DB } from "@/lib/data/types";

// ----------------------------------------------------------------------------
// Design Studio — an inspiration + visualization surface inside Materials.
//   1. Live Visualizer: apply paint / wallpaper / cabinet / flooring swatches
//      to a stylized room and see them instantly. Every swatch is shoppable.
//   2. AI Sourcing (image → alternatives) and Lookalike finder — wired UI,
//      results are clearly-labeled placeholders pending a connected vision
//      model + product feed.
//   3. Palette generator: enter one "must-have" material and get curated
//      complementary paint / flooring / backsplash suggestions.
// ----------------------------------------------------------------------------

const shop = (q: string) => `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(q)}`;

type Swatch = { name: string; hex: string; price: string; brand?: string };

const PAINTS: Swatch[] = [
  { name: "Cloud White", hex: "#f3efe3", price: "$52/gal", brand: "Benjamin Moore OC-130" },
  { name: "Sage Whisper", hex: "#c6cdb6", price: "$54/gal", brand: "Farrow & Ball" },
  { name: "Evergreen", hex: "#3a4a3f", price: "$54/gal", brand: "Sherwin-Williams" },
  { name: "Warm Clay", hex: "#c9a987", price: "$52/gal", brand: "Benjamin Moore" },
  { name: "Charcoal", hex: "#3f3a36", price: "$54/gal", brand: "Farrow & Ball" },
  { name: "Blush Linen", hex: "#e7cfc4", price: "$52/gal", brand: "Benjamin Moore" },
];
const CABINETS: Swatch[] = [
  { name: "Natural Oak", hex: "#c8a06a", price: "$ / linear ft" },
  { name: "Walnut", hex: "#6f4e34", price: "$$ / linear ft" },
  { name: "Sage Painted", hex: "#9aa888", price: "$$ / linear ft" },
  { name: "Classic White", hex: "#eef0e9", price: "$ / linear ft" },
  { name: "Deep Navy", hex: "#34435a", price: "$$ / linear ft" },
  { name: "Matte Black", hex: "#2c2a28", price: "$$ / linear ft" },
];
const FLOORS: Swatch[] = [
  { name: "White Oak", hex: "#d8b890", price: "$8–12 / sf" },
  { name: "Walnut Plank", hex: "#7a5333", price: "$10–14 / sf" },
  { name: "Limewash Oak", hex: "#e3dcc9", price: "$9–13 / sf" },
  { name: "Slate Tile", hex: "#6c6f72", price: "$6–10 / sf" },
  { name: "Terracotta", hex: "#c08457", price: "$7–11 / sf" },
];
const WALLPAPERS: (Swatch | { name: "None"; none: true })[] = [
  { name: "None", none: true },
  { name: "Botanical Sage", hex: "#aebd9e", price: "$6 / sf" },
  { name: "Grasscloth Sand", hex: "#cdbfa3", price: "$7 / sf" },
  { name: "Floral Blush", hex: "#e6cbcf", price: "$8 / sf" },
];

// --- deterministic "complementary palette" suggestion engine ----------------
type Suggest = { paints: string[]; floors: string[]; backsplash: string[]; note: string };
function suggestPalette(input: string): Suggest {
  const s = input.toLowerCase();
  const has = (...k: string[]) => k.some((x) => s.includes(x));
  if (has("green", "quartzite", "sage", "emerald"))
    return { paints: ["Cloud White (BM OC-130)", "Soft Sage", "Warm Greige"], floors: ["White Oak — natural", "Walnut — matte"], backsplash: ["Zellige white gloss", "Honed marble subway"], note: "Greens love warm neutrals + natural wood — keep metals brass/aged-gold." };
  if (has("marble", "carrara", "calacatta", "white quartz"))
    return { paints: ["Chantilly Lace", "Pale Oak", "Gentle Gray"], floors: ["White Oak — rift", "Limewash Oak"], backsplash: ["Matching slab backsplash", "White zellige"], note: "Cool marble pairs with crisp whites + soft grays; chrome or polished nickel." };
  if (has("walnut", "wood", "oak", "warm"))
    return { paints: ["Accessible Beige", "Cream", "Olive"], floors: ["Walnut plank", "Wide white oak"], backsplash: ["Terracotta", "Tumbled travertine"], note: "Warm woods want earthy, sun-baked tones; antique brass hardware." };
  if (has("blue", "navy", "indigo"))
    return { paints: ["Swiss Coffee", "Pale Sky", "Mushroom"], floors: ["White Oak", "Slate tile"], backsplash: ["White subway", "Hand-glazed teal"], note: "Blues balance with warm whites + brass to avoid going cold." };
  if (has("black", "charcoal", "soapstone"))
    return { paints: ["Bone White", "Warm Putty", "Forest"], floors: ["Wide oak", "Honed slate"], backsplash: ["White zellige", "Veined marble"], note: "High-contrast bases need a warm neutral to soften; matte black or brass." };
  return { paints: ["Cloud White", "Warm Greige", "Sage Whisper"], floors: ["White Oak", "Walnut plank"], backsplash: ["White zellige", "Honed marble subway"], note: "A safe, timeless base — tell me your must-have material for a tailored set." };
}

function Chip({ s, selected, onClick }: { s: Swatch | { name: string; none: true }; selected: boolean; onClick: () => void }) {
  const none = "none" in s;
  return (
    <button onClick={onClick} title={none ? "None" : `${s.name}${(s as Swatch).brand ? " · " + (s as Swatch).brand : ""} · ${(s as Swatch).price}`}
      style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 9px", borderRadius: 8, fontSize: 12, cursor: "pointer",
        border: selected ? "2px solid var(--walnut)" : "1px solid var(--line)", background: selected ? "var(--cream-2)" : "#fff" }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, border: "1px solid rgba(0,0,0,.15)", background: none ? "repeating-linear-gradient(45deg,#eee,#eee 3px,#fff 3px,#fff 6px)" : (s as Swatch).hex }} />
      {s.name}
    </button>
  );
}

function Group({ title, swatches, sel, onSel }: { title: string; swatches: (Swatch | { name: string; none: true })[]; sel: number; onSel: (i: number) => void }) {
  const cur = swatches[sel];
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{title}</strong>
        {!("none" in cur) && <a href={shop((cur as Swatch).brand ?? `${title} ${cur.name}`)} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--sage-2)" }}>shop {cur.name} ↗</a>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
        {swatches.map((s, i) => <Chip key={s.name} s={s} selected={i === sel} onClick={() => onSel(i)} />)}
      </div>
    </div>
  );
}

function Visualizer({ db }: { db: DB }) {
  const rooms = db.rooms;
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [paint, setPaint] = useState(0);
  const [cab, setCab] = useState(0);
  const [floor, setFloor] = useState(0);
  const [wall, setWall] = useState(0);

  const wallHex = "none" in WALLPAPERS[wall] ? PAINTS[paint].hex : (WALLPAPERS[wall] as Swatch).hex;
  const pH = PAINTS[paint].hex, cH = CABINETS[cab].hex, fH = FLOORS[floor].hex;

  return (
    <div className="card" style={{ padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 className="serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--walnut)" }}>Visualizer</h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Apply finishes and see them instantly — every swatch is shoppable.</span>
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ marginLeft: "auto" }}>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,1fr) minmax(240px,1fr)", gap: 18, marginTop: 12, alignItems: "start" }}>
        {/* live room preview */}
        <svg viewBox="0 0 400 280" style={{ width: "100%", borderRadius: 10, border: "1px solid var(--line)", background: "#fff" }}>
          <rect x="0" y="0" width="400" height="190" fill={pH} />
          <rect x="0" y="0" width="132" height="190" fill={wallHex} />
          <line x1="132" y1="0" x2="132" y2="190" stroke="rgba(0,0,0,.06)" />
          {/* window */}
          <rect x="250" y="38" width="112" height="82" fill="#cfe0e6" stroke="#fff" strokeWidth="6" />
          <line x1="306" y1="38" x2="306" y2="120" stroke="#fff" strokeWidth="4" />
          <line x1="250" y1="79" x2="362" y2="79" stroke="#fff" strokeWidth="4" />
          {/* floor */}
          <polygon points="0,190 400,190 400,280 0,280" fill={fH} />
          <line x1="0" y1="190" x2="400" y2="190" stroke="rgba(0,0,0,.12)" />
          {/* cabinets + counter */}
          <rect x="36" y="150" width="170" height="62" fill={cH} stroke="rgba(0,0,0,.12)" />
          <line x1="121" y1="150" x2="121" y2="212" stroke="rgba(0,0,0,.18)" />
          <rect x="80" y="178" width="6" height="6" rx="3" fill="rgba(0,0,0,.35)" /><rect x="156" y="178" width="6" height="6" rx="3" fill="rgba(0,0,0,.35)" />
          <rect x="30" y="142" width="182" height="9" fill="#efeae0" stroke="rgba(0,0,0,.12)" />
        </svg>

        {/* swatch controls */}
        <div>
          <Group title="Paint" swatches={PAINTS} sel={paint} onSel={setPaint} />
          <Group title="Wallpaper (accent wall)" swatches={WALLPAPERS} sel={wall} onSel={setWall} />
          <Group title="Cabinet finish" swatches={CABINETS} sel={cab} onSel={setCab} />
          <Group title="Flooring" swatches={FLOORS} sel={floor} onSel={setFloor} />
        </div>
      </div>
    </div>
  );
}

function UploadCard({ title, blurb, cta, results }: { title: string; blurb: string; cta: string; results: { v: string; p: string; note: string }[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 className="serif" style={{ fontSize: 16, fontWeight: 700, color: "var(--walnut)" }}>{title}</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>{blurb}</p>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) { setName(f.name); setShow(true); } }} />
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}>📷 {cta}</button>
        {name && <span style={{ fontSize: 12, color: "var(--muted)" }}>Uploaded: <strong style={{ color: "var(--ink)" }}>{name}</strong></span>}
      </div>
      {show && (
        <>
          <div style={{ marginTop: 10, padding: "7px 10px", background: "#f0e6cd", borderRadius: 8, fontSize: 11.5, color: "var(--brass-2)" }}>✨ Placeholder matches — wired UI, pending a connected vision model + product feed.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
            {results.map((r) => (
              <div key={r.v} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12.5 }}>
                <span><strong>{r.v}</strong> <span style={{ color: "var(--muted)" }}>· {r.note}</span></span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}><strong>{r.p}</strong><a href={shop(r.v)} target="_blank" rel="noreferrer" style={{ color: "var(--sage-2)" }}>shop ↗</a></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PaletteCard() {
  const [input, setInput] = useState("");
  const [out, setOut] = useState<Suggest | null>(null);
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 className="serif" style={{ fontSize: 16, fontWeight: 700, color: "var(--walnut)" }}>Complementary palette generator</h3>
      <p style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>Enter one “must-have” material and get matching paint, flooring & backsplash.</p>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input placeholder="e.g. green quartzite countertop" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && input.trim() && setOut(suggestPalette(input))} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn btn-primary btn-sm" disabled={!input.trim()} onClick={() => setOut(suggestPalette(input))}>✨ Generate</button>
      </div>
      {out && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {([["Paint", out.paints], ["Flooring", out.floors], ["Backsplash", out.backsplash]] as const).map(([lbl, arr]) => (
            <div key={lbl}>
              <strong style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{lbl}</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {arr.map((x) => <a key={x} href={shop(x)} target="_blank" rel="noreferrer" style={{ fontSize: 12, padding: "4px 9px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--sage-tint)", color: "var(--ink)" }}>{x} ↗</a>)}
              </div>
            </div>
          ))}
          <div style={{ fontSize: 12, color: "var(--brass-2)", fontStyle: "italic" }}>💡 {out.note}</div>
        </div>
      )}
    </div>
  );
}

export default function DesignStudio({ db }: { db: DB }) {
  const tileResults = useMemo(() => [
    { v: "Bedrosians Cassis Zellige", p: "$11/sf", note: "closest match · in stock" },
    { v: "Fireclay Tile — Mint", p: "$28/sf", note: "exact glaze · 3wk lead" },
    { v: "Home Depot Merola lookalike", p: "$5/sf", note: "budget lookalike · in stock" },
  ], []);
  const itemResults = useMemo(() => [
    { v: "Rejuvenation pendant", p: "$329", note: "near-exact silhouette" },
    { v: "Wayfair lookalike", p: "$149", note: "−55% · in stock" },
    { v: "CB2 alt finish", p: "$199", note: "aged brass option" },
  ], []);
  return (
    <div>
      <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--sage-tint)", borderRadius: 10, fontSize: 13, color: "var(--ink)" }}>
        ✨ <strong>Design Studio</strong> — stay organized, productive & inspired. Try finishes live, find shoppable lookalikes, and build a palette from a single must-have.
      </div>

      <Visualizer db={db} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))", gap: 16, marginTop: 16 }}>
        <UploadCard title="Find alternatives from a photo" blurb="Upload an item you love — get similar, in-stock, or cheaper alternatives, each linked to a real product." cta="Upload an item photo" results={itemResults} />
        <UploadCard title="Identify a tile or countertop" blurb="Snap a tile or slab from Pinterest or a showroom — get the likely manufacturer, material, and a cheaper lookalike." cta="Upload a tile / slab photo" results={tileResults} />
        <PaletteCard />
      </div>
    </div>
  );
}
