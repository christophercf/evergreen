"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Destructive confirmation, in the app's own voice.
//
// window.confirm cannot explain anything, cannot be styled, and on a phone it
// is a browser alert dropped on top of the work. Everything here already has a
// sheet; a decision that cannot be undone deserves it more than most.
//
//   const ask = useConfirm();
//   if (await ask({ title: "Delete the package?", body: "…", danger: "Delete" })) …
// ---------------------------------------------------------------------------

export type ConfirmSpec = {
  title: string;
  /** What actually happens. Say the consequence, not "are you sure". */
  body?: ReactNode;
  /** Label for the destructive action; its presence makes the button rust. */
  danger?: string;
  /** Label for a non-destructive confirm. */
  confirm?: string;
  cancel?: string;
};

type Ask = (spec: ConfirmSpec) => Promise<boolean>;

const Ctx = createContext<Ask>(async () => false);

export function useConfirm(): Ask {
  return useContext(Ctx);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((s) => {
    setSpec(s);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const close = (v: boolean) => {
    setSpec(null);
    resolver.current?.(v);
    resolver.current = null;
  };

  return (
    <Ctx.Provider value={ask}>
      {children}
      {spec ? (
        <div className="ever-sheet-overlay"
          onClick={() => close(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(44,36,28,.45)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div className="card ever-sheet" onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460, width: "100%", padding: 20, maxHeight: "90vh", overflowY: "auto" }}>
            <h3 className="serif" style={{ fontSize: 17, fontWeight: 700, color: "var(--walnut)", margin: 0 }}>{spec.title}</h3>
            {spec.body ? (
              <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55, marginTop: 8, whiteSpace: "pre-wrap" }}>{spec.body}</div>
            ) : null}
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn btn-primary"
                style={spec.danger ? { background: "var(--rust)", borderColor: "var(--rust)", color: "#fff" } : undefined}
                onClick={() => close(true)}>
                {spec.danger ?? spec.confirm ?? "Confirm"}
              </button>
              <button className="btn" onClick={() => close(false)}>{spec.cancel ?? "Cancel"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}
