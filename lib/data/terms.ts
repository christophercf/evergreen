// ----------------------------------------------------------------------------
// Resolve the effective Terms & Conditions for a trade: the builder's standard
// clause set, minus per-trade exclusions, plus per-trade additions and custom
// clauses. Used by the Admin builder preview, the Vendor cards, and the PDF.
// ----------------------------------------------------------------------------

import type { DB, TermClause } from "./types";
import { TERM_CLAUSES } from "./seed";

/** All clauses available to choose from (catalog + builder-authored standard). */
export function clauseCatalog(db: DB): TermClause[] {
  return [...TERM_CLAUSES, ...db.terms.customClauses];
}

/** The ordered clauses that actually apply to a given trade's contract. */
export function effectiveClauses(db: DB, tradeId: string): TermClause[] {
  const cfg = db.terms;
  const catalog = clauseCatalog(db);
  const ov = cfg.perTrade[tradeId] ?? {};
  const ids = new Set(cfg.enabledClauseIds);
  (ov.disabledClauseIds ?? []).forEach((id) => ids.delete(id));
  (ov.extraClauseIds ?? []).forEach((id) => ids.add(id));
  const base = catalog.filter((c) => ids.has(c.id));
  return [...base, ...(ov.customClauses ?? [])];
}

/** Plain-text render of the full agreement terms for a trade (preamble + clauses). */
export function renderTerms(db: DB, tradeId: string): string {
  const cfg = db.terms;
  const clauses = effectiveClauses(db, tradeId);
  const ov = cfg.perTrade[tradeId] ?? {};
  const lines = [cfg.preamble, ""];
  clauses.forEach((c, i) => lines.push(`${i + 1}. ${c.title}. ${c.body}`));
  if (ov.note?.trim()) lines.push("", `Trade-specific addendum: ${ov.note.trim()}`);
  lines.push("", cfg.bindingLanguage);
  return lines.join("\n");
}

/** Distinct cluster names, in catalog order. */
export function clusters(db: DB): string[] {
  const seen: string[] = [];
  clauseCatalog(db).forEach((c) => { if (!seen.includes(c.cluster)) seen.push(c.cluster); });
  return seen;
}
