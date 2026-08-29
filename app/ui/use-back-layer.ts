"use client";

import { useEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Native back closes the topmost full-screen layer.
//
// On a phone, an open conversation, a photo lightbox or a compose sheet takes
// the whole screen — to a thumb it IS a screen, so the phone's back button
// must peel it off, not leave the page (back from a chat used to land on the
// dashboard). While a layer is open we hold one history entry for it: popping
// that entry (native back) closes the layer, and closing the layer from its
// own ← / ✕ consumes the entry so back never needs pressing twice. Layers
// stack LIFO — back closes the photo before the chat before the page.
//
// Desktop keeps stock behavior: no entry is pushed above 860px, where these
// layers sit beside the page instead of covering it.
// ---------------------------------------------------------------------------

type Layer = { close: () => void };
const stack: Layer[] = [];
let listening = false;

function ensureListener() {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", () => {
    // Only entries WE pushed sit above real navigation entries, so while the
    // stack is non-empty, a pop is a layer-close. An empty stack means this
    // pop is ordinary navigation — leave it alone.
    stack.pop()?.close();
  });
}

const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches;

/** Register `open` as a back-closable layer. Call unconditionally (it's a
 *  hook); it only acts on phone-size viewports, at the moment a layer opens. */
export function useBackLayer(open: boolean, onClose: () => void) {
  const layer = useRef<Layer | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (open && !layer.current && isPhone()) {
      ensureListener();
      const l: Layer = {
        close: () => { layer.current = null; closeRef.current(); },
      };
      layer.current = l;
      stack.push(l);
      window.history.pushState({ everLayer: true }, "");
    } else if (!open && layer.current) {
      // Closed by its own control — take our entry (and stack slot) with us,
      // so the next back press does real navigation instead of a dead pop.
      // ONLY if our entry is still the current one: when the close rode along
      // with a navigation (a nav link closing the layer), the router has
      // already moved past it, and a back() here would cancel that navigation
      // — the "can't open Messages" bug. The stray entry behind the new page
      // is harmless; a no-longer-stacked pop is ignored by the listener.
      const i = stack.indexOf(layer.current);
      if (i >= 0) stack.splice(i, 1);
      layer.current = null;
      const st = window.history.state as { everLayer?: boolean } | null;
      if (st?.everLayer) window.history.back();
    }
  }, [open]);

  // Unmounted with the layer still open (a navigation happened over it): drop
  // the stack slot. The stray entry is harmless — back returns to this page.
  useEffect(() => () => {
    if (layer.current) {
      const i = stack.indexOf(layer.current);
      if (i >= 0) stack.splice(i, 1);
      layer.current = null;
    }
  }, []);
}
