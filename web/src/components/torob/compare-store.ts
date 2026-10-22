/** Shared compare list (max 2 products) for side-by-side comparison.
 *  Persisted to localStorage so the compare list survives a page reload. */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SearchItem } from "./types";

interface CompareState {
  items: SearchItem[];
  add: (item: SearchItem) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
}

export const useCompare = create<CompareState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) =>
        set((s) =>
          s.items.some((x) => x.product_id === item.product_id)
            ? s
            : s.items.length >= 2
              ? { items: [s.items[1], item] } // replace oldest if full
              : { items: [...s.items, item] }
        ),
      remove: (id) => set((s) => ({ items: s.items.filter((x) => x.product_id !== id) })),
      clear: () => set({ items: [] }),
      has: (id) => get().items.some((x) => x.product_id === id),
    }),
    {
      name: "torobgard:compare",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ items: s.items }),
    }
  )
);
