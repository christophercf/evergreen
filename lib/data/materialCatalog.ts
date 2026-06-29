// ----------------------------------------------------------------------------
// Standard material catalog — pick from these when adding a material (per room
// or in the Materials tab), or choose "＋ New custom…" to add your own. Each
// category maps to the trade that typically handles it (so trades auto-see them).
// ----------------------------------------------------------------------------

export interface CatalogCategory {
  category: string;
  tradeId?: string;
  options: string[];
}

export const MATERIAL_CATALOG: CatalogCategory[] = [
  {
    category: "Lighting",
    tradeId: "electrical",
    options: [
      "Chandeliers",
      "Pendant lights",
      "Flush mount ceiling lights",
      "Semi-flush mount ceiling lights",
      "Recessed lights (downlights)",
      "Track lighting",
      "Wall sconces",
      "Under-cabinet lights",
      "Picture lights",
      "Floor lamps",
      "Table lamps",
      "Task and desk lamps",
      "Vanity lights",
      "Cove lights",
      "Soffit lights",
      "Valance lights",
      "Safety and security lights",
    ],
  },
];

export const CATALOG_CATEGORIES = MATERIAL_CATALOG.map((c) => c.category);
export const tradeForCategory = (category: string): string | undefined =>
  MATERIAL_CATALOG.find((c) => c.category === category)?.tradeId;
export const optionsForCategory = (category: string): string[] =>
  MATERIAL_CATALOG.find((c) => c.category === category)?.options ?? [];
