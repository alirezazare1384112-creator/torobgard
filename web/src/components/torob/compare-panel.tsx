"use client";

import * as React from "react";
import { ArrowRight, GitCompareArrows, Store, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCompare } from "./compare-store";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import type { SearchItem } from "./types";

/**
 * Side-by-side compare panel for up to 2 products. Compares price, brand,
 * offer_count, nearest shop + distance, and the user's adjustable preference
 * (price vs distance) to produce an explainable recommendation.
 */
export function CompareBar({ onPickProduct }: { onPickProduct?: (id: string) => void }) {
  const items = useCompare((s) => s.items);
  const remove = useCompare((s) => s.remove);
  const clear = useCompare((s) => s.clear);
  const [open, setOpen] = React.useState(false);

  if (items.length === 0) return null;

  return (
    <>
      {/* Floating trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-[1.02]"
        aria-label="مقایسه محصولات"
      >
        <GitCompareArrows className="size-4" aria-hidden />
        مقایسه {toPersianDigits(items.length)} محصول
      </button>

      {/* Compare dialog */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="مقایسه کنار هم">
          <Card className="max-h-[88vh] w-full max-w-3xl gap-0 overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><GitCompareArrows className="size-4" aria-hidden />مقایسه {toPersianDigits(items.length)} محصول</h3>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clear}>پاک کردن</Button>
                <button type="button" onClick={() => setOpen(false)} aria-label="بستن" className="rounded-md p-1 hover:bg-accent"><X className="size-4" aria-hidden /></button>
              </div>
            </div>

            <div className="scrollbar-thin max-h-[78vh] overflow-y-auto p-4">
              {items.length === 1 && (
                <p className="mb-2 text-sm text-muted-foreground">یک محصول دیگر را برای مقایسه انتخاب کنید (حداکثر ۲).</p>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((p, idx) => {
                  const min = items.reduce((m, x) => Math.min(m, x.min_price_toman ?? Infinity), Infinity);
                  const cheapest = p.min_price_toman === min && p.min_price_toman !== null;
                  const minDist = items.reduce((m, x) => Math.min(m, x.distance_km ?? Infinity), Infinity);
                  const nearest = p.distance_km === minDist && p.distance_km !== null;
                  return (
                    <div key={p.product_id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          {p.image_url ? <img src={p.image_url} alt="" className="size-14 shrink-0 rounded-md object-cover" loading="lazy" /> : <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted"><Store className="size-5 text-muted-foreground" aria-hidden /></span>}
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="line-clamp-2 text-sm font-medium leading-snug">{p.title}</span><span className="text-xs text-muted-foreground">{p.brand ?? "بدون برند"}</span></div>
                        </div>
                        <button type="button" onClick={() => remove(p.product_id)} aria-label="حذف از مقایسه" className="rounded-md p-1 hover:bg-accent"><X className="size-4" aria-hidden /></button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.min_price_toman !== null ? <Badge variant={cheapest ? "default" : "secondary"} className="font-num">{formatToman(p.min_price_toman)}{cheapest && " • ارزان‌ترین"}</Badge> : <Badge variant="secondary">قیمت نامشخص</Badge>}
                        <Badge variant="outline" className="font-num">{toPersianDigits(p.offer_count)} پیشنهاد</Badge>
                        {p.nearest_shop_name && <Badge variant="outline" className="gap-1"><Store className="size-3" aria-hidden />{p.nearest_shop_name}</Badge>}
                        {p.distance_km !== null && p.distance_km !== undefined && <Badge variant={nearest ? "default" : "secondary"} className="gap-1 font-num">{formatDistanceKm(p.distance_km)}{nearest && " • نزدیک‌ترین"}</Badge>}
                      </div>
                      {onPickProduct && (
                        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { setOpen(false); onPickProduct(p.product_id); }}>
                          مشاهده و خرید حضوری<ArrowRight className="size-3.5" aria-hidden />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              {items.length === 2 && (
                <Recommendation items={items} />
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/** Explainable recommendation between 2 products based on price + distance. */
function Recommendation({ items }: { items: [SearchItem, SearchItem] | SearchItem[] }) {
  const [priceWeight, setPriceWeight] = React.useState(0.5);
  const [a, b] = items as [SearchItem, SearchItem];

  const scoreA = scoreOf(a, priceWeight);
  const scoreB = scoreOf(b, priceWeight);
  const winner = scoreA >= scoreB ? a : b;
  const why = buildWhy(winner, a, b, priceWeight);

  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <GitCompareArrows className="size-4 text-primary" aria-hidden />
        <span className="font-semibold">پیشنهاد دستیار</span>
      </div>
      <p className="mb-2 leading-relaxed">
        با وزن فعلی، <strong className="text-primary">{winner.title}</strong> مناسب‌تر است.
      </p>
      <p className="mb-3 text-xs text-muted-foreground">{why}</p>
      <label className="mb-1 flex items-center justify-between text-xs">
        <span>اولویت: قیمت ← فاصله</span>
        <span className="font-num">{toPersianDigits(Math.round(priceWeight * 100))}٪ / {toPersianDigits(Math.round((1 - priceWeight) * 100))}٪</span>
      </label>
      <input
        type="range"
        min={0}
        max={100}
        step={10}
        value={priceWeight * 100}
        onChange={(e) => setPriceWeight(Number(e.target.value) / 100)}
        className="w-full"
        aria-label="وزن قیمت در برابر فاصله"
      />
    </div>
  );
}

function scoreOf(p: SearchItem, priceWeight: number): number {
  const distWeight = 1 - priceWeight;
  const priceScore = p.min_price_toman !== null && p.min_price_toman > 0 ? 1 / (1 + p.min_price_toman / 1_000_000) : 0;
  const distScore = p.distance_km !== null && p.distance_km !== undefined && p.distance_km > 0 ? 1 / (1 + p.distance_km / 10) : 0;
  return priceScore * priceWeight + distScore * distWeight;
}

function buildWhy(winner: SearchItem, a: SearchItem, b: SearchItem, pw: number): string {
  const reasons: string[] = [];
  const loser = winner === a ? b : a;
  if (winner.min_price_toman !== null && loser.min_price_toman !== null && winner.min_price_toman < loser.min_price_toman) {
    reasons.push(`ارزان‌تر است (${formatToman(winner.min_price_toman)} در برابر ${formatToman(loser.min_price_toman)})`);
  }
  if (winner.distance_km !== null && loser.distance_km !== null && winner.distance_km < loser.distance_km) {
    reasons.push(`نزدیک‌تر است (${formatDistanceKm(winner.distance_km)} در برابر ${formatDistanceKm(loser.distance_km)})`);
  }
  if (winner.offer_count > loser.offer_count) {
    reasons.push(`گزینه‌های پیشنهاد بیشتری دارد (${toPersianDigits(winner.offer_count)} در برابر ${toPersianDigits(loser.offer_count)})`);
  }
  if (reasons.length === 0) reasons.push("با وزن فعلی، امتیاز کلی کمی بالاتر است");
  const wLabel = pw > 0.6 ? "اولویت با قیمت" : pw < 0.4 ? "اولویت با فاصله" : "تعادل قیمت و فاصله";
  return `${wLabel}. ${reasons.join("؛ ")}.`;
}
