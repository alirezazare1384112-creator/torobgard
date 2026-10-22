/**
 * Shared shopping cart — products the user picked to "buy in person".
 * Used by the search view ("افزودن به برنامهٔ خرید" on each card), the product
 * view ("افزودن به سبد"), and the trip view (reads the cart as the trip's item
 * list). Kept in zustand with `persist` (localStorage) so the cart survives a
 * full page reload, not just view switches.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SearchItem } from "./types";

interface CartState {
  items: SearchItem[];
  add: (item: SearchItem) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) =>
        set((s) =>
          s.items.some((x) => x.product_id === item.product_id)
            ? s
            : { items: [...s.items, item] }
        ),
      remove: (id) => set((s) => ({ items: s.items.filter((x) => x.product_id !== id) })),
      clear: () => set({ items: [] }),
      has: (id) => get().items.some((x) => x.product_id === id),
    }),
    {
      name: "torobgard:cart",
      storage: createJSONStorage(() => localStorage),
      // Only persist the items array, not the action functions.
      partialize: (s) => ({ items: s.items }),
    }
  )
);
