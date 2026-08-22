"use client";

// ---------------------------------------------------------------------------
// Free-text search over a list.
//
// Materials proved the pattern: one box, matched against everything a person
// might remember about a row — its name, its room, its trade, a note. Budget
// Management, the vendor roster and the artifact library are all long enough
// to need it and had nothing.
//
// One control, so every module's search looks and behaves the same, and a
// deep link into any of them can clear it the same way.
// ---------------------------------------------------------------------------

export function SearchBox({ value, onChange, placeholder, count, of }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Rows currently shown, and the total, so a filtered list says so. */
  count?: number;
  of?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ position: "relative", flex: 1, minWidth: 180, maxWidth: 340 }}>
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          style={{ width: "100%", fontSize: 12.5, paddingRight: value ? 28 : undefined }}
        />
        {value ? (
          <button
            onClick={() => onChange("")}
            aria-label="Clear the search"
            style={{
              position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
              border: "none", background: "transparent", cursor: "pointer",
              color: "var(--muted)", fontSize: 14, lineHeight: 1, padding: "4px 6px",
            }}>✕</button>
        ) : null}
      </div>
      {value && count != null && of != null ? (
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
          {count} of {of}{count === 0 ? " — nothing matches" : ""}
        </span>
      ) : null}
    </div>
  );
}

/** Does any of these fields contain the query? Case- and space-insensitive,
 *  and every caller uses this rather than writing its own comparison. */
export function matches(query: string, ...fields: (string | undefined | null)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}
