"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Check, GitCompareArrows, MapPin, Plus, Store, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCart } from "./cart-store";
import { useCompare } from "./compare-store";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import type { SearchItem } from "./types";

/** A small placeholder shown when a product has no image_url. */
function ImagePlaceholder({ title }: { title: string }) {
  return (
    <div aria-hidden className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground">
      <div className="flex flex-col items-center gap-2 text-center">
        <MapPin className="size-7 opacity-40" />
        <span className="line-clamp-2 px-3 text-xs">{title}</span>
      </div>
    </div>
  );
}

export function ProductCard({ item, onSelect }: { item: SearchItem; onSelect: (id: string) => void; }) {
  const inCart = useCart((s) => s.items.some((x) => x.product_id === item.product_id));
  const add = useCart((s) => s.add);
  const compareHas = useCompare((s) => s.has(item.product_id));
  const compareAdd = useCompare((s) => s.add);
  const compareRemove = useCompare((s) => s.remove);
  const compareCount = useCompare((s) => s.items.length);

  return (
    <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300, damping: 22 }} className="group h-full text-right">
      <Card className="flex h-full flex-col overflow-hidden p-0 transition-colors group-hover:border-primary/40 group-focus-within:border-primary/60">
        <button type="button" onClick={() => onSelect(item.product_id)} className="text-right" aria-label={`مشاهده ${item.title}`}>
          <div className="overflow-hidden">
            {item.image_url ? (
              <img src={item.image_url} alt={item.title} loading="lazy" className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
            ) : (
              <ImagePlaceholder title={item.title} />
            )}
          </div>
          <div className="flex flex-col gap-2 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {item.category && (
                <Badge variant="secondary" className="gap-1"><Tag className="size-3" aria-hidden />{item.category}</Badge>
              )}
              <Badge variant="outline" className="font-num">{toPersianDigits(item.offer_count)} پیشنهاد</Badge>
            </div>
            <h3 className="line-clamp-2 min-h-[2.6rem] text-sm font-semibold leading-relaxed">{item.title}</h3>
            <p className="text-xs text-muted-foreground">{item.brand ?? "بدون برند"}</p>
            <div className="mt-1 text-sm font-bold font-num text-foreground">
              {item.min_price_toman !== null ? (
                <span><span className="text-muted-foreground text-xs font-normal">از </span>{formatToman(item.min_price_toman)}</span>
              ) : (
                <span className="text-muted-foreground text-xs font-normal">قیمت نامشخص</span>
              )}
            </div>
            {/* nearest shop + distance */}
            {item.nearest_shop_name && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Store className="size-3 shrink-0 text-primary" aria-hidden />
                <span className="line-clamp-1">{item.nearest_shop_name}</span>
                {item.distance_km !== null && item.distance_km !== undefined && (
                  <Badge variant="secondary" className="gap-1 font-num"><MapPin className="size-3" aria-hidden />{formatDistanceKm(item.distance_km)}</Badge>
                )}
              </p>
            )}
          </div>
        </button>

        {/* Actions: add to cart + compare */}
        <div className="flex flex-col gap-2 px-4 pb-4">
          <Button
            type="button"
            variant={inCart ? "secondary" : "outline"}
            size="sm"
            className="h-9 w-full gap-1.5"
            disabled={inCart}
            onClick={() => add(item)}
            aria-label={inCart ? "به برنامهٔ خرید اضافه شد" : "افزودن به برنامهٔ خرید"}
          >
            {inCart ? <><Check className="size-3.5" aria-hidden />به برنامهٔ خرید اضافه شد</> : <><Plus className="size-3.5" aria-hidden />افزودن به برنامهٔ خرید</>}
          </Button>
          <Button
            type="button"
            variant={compareHas ? "default" : "outline"}
            size="sm"
            className="h-9 w-full gap-1.5"
            onClick={() => compareHas ? compareRemove(item.product_id) : compareAdd(item)}
            disabled={!compareHas && compareCount >= 2}
            aria-label={compareHas ? "از مقایسه حذف" : "افزودن به مقایسه"}
          >
            <GitCompareArrows className="size-3.5" aria-hidden />
            {compareHas ? "در مقایسه" : compareCount >= 2 ? "مقایسه پر شد" : "مقایسه"}
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}
