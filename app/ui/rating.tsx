"use client";

import { useStore } from "@/lib/data/hooks";
import { RATING_KEYS, RATING_LABEL, RATING_HINT, tradeRatingAvg, type RatingKey } from "@/lib/data/types";

// Builder ratings for a trade: Speed · Clean · Within budget · Mistake-free.
// Averages across everyone who rated show up beside that vendor's bids.

export function Stars({ value, size = 13 }: { value: number | null; size?: number }) {
  if (value == null) return <span style={{ fontSize: size - 2, color: "var(--muted)" }}>not rated</span>;
  const full = Math.round(value);
  return (
    <span title={`${value.toFixed(1)} / 5`} style={{ color: "var(--brass)", fontSize: size, letterSpacing: 1, whiteSpace: "nowrap" }}>
      {"★".repeat(full)}<span style={{ color: "var(--line)" }}>{"★".repeat(5 - full)}</span>
    </span>
  );
}

/** Editable 1–5 picker for one category. */
function StarPicker({ value, onPick, disabled }: { value?: number; onPick: (v: number) => void; disabled?: boolean }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} disabled={disabled} onClick={() => onPick(n === value ? 0 : n)}
          title={`${n} star${n === 1 ? "" : "s"}${n === value ? " — click to clear" : ""}`}
          style={{ border: "none", background: "transparent", cursor: disabled ? "default" : "pointer", padding: "0 1px", fontSize: 16, lineHeight: 1, color: value && n <= value ? "var(--brass)" : "var(--line)" }}>
          ★
        </button>
      ))}
    </span>
  );
}

/** Full rating editor — your own scores, plus the team average. */
export function TradeRatingEditor({ tradeId, disabled }: { tradeId: string; disabled?: boolean }) {
  const store = useStore();
  const db = store.db;
  const mine = (db.tradeRatings ?? []).find((r) => r.tradeId === tradeId && r.raterId === store.session.userId);
  const { overall, by, raters } = tradeRatingAvg(db.tradeRatings ?? [], tradeId);
  const others = (db.tradeRatings ?? []).filter((r) => r.tradeId === tradeId && r.raterId !== store.session.userId);

  return (
    <div style={{ marginTop: 8, borderTop: "1px dashed var(--line)", paddingTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>Performance rating</span>
        {overall != null && <><Stars value={overall} /><span style={{ fontSize: 11, color: "var(--muted)" }}>{overall.toFixed(1)} avg · {raters} rater{raters === 1 ? "" : "s"}</span></>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "4px 14px" }}>
        {RATING_KEYS.map((k: RatingKey) => (
          <label key={k} title={RATING_HINT[k]} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ flex: 1, color: "var(--muted)" }}>{RATING_LABEL[k]}</span>
            {by[k] != null && others.length > 0 && <span style={{ fontSize: 10, color: "var(--muted)" }}>avg {by[k]!.toFixed(1)}</span>}
            <StarPicker value={mine?.[k]} disabled={disabled} onPick={(v) => store.setTradeRating(tradeId, { [k]: v || undefined })} />
          </label>
        ))}
      </div>
      {others.length > 0 && (
        <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 5 }}>
          Also rated by {others.map((o) => o.raterName).join(", ")}
        </div>
      )}
    </div>
  );
}
