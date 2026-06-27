"use client";

import { useSyncExternalStore } from "react";
import { store } from "./store";

// Subscribe a component to the store; re-renders on any state change.
export function useStore() {
  useSyncExternalStore(
    (cb) => {
      const unsub = store.subscribe(cb);
      store.start();
      return unsub;
    },
    () => store.version,
    () => 0,
  );
  return store;
}
