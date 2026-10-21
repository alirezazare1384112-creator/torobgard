/**
 * Shared shopping cart — products the user picked to "buy in person".
 * Used by the search view ("افزودن به برنامهٔ خرید" on each card) and the
 * trip view (reads the cart as the trip's item list). Kept in zustand so it
 * survives view switches without prop-drilling.
 */
import { create } from "zustand";
import type { SearchItem } from "./types";

interface CartState {
  items: SearchItem[];
  add: (item: SearchItem) => void;
  remove: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
}

export const useCart = create<CartState>((set, get) => ({
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
}));
