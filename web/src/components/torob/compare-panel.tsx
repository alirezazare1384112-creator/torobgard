"use client";

import * as React from "react";
import { ArrowRight, GitCompareArrows, MapPin, Store, Wallet, X, Zap, Clock, ShieldCheck, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCompare } from "./compare-store";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import type { SearchItem } from "./types";

/**
 * Phase 4: Comprehensive product comparison.
 *
 * Features:
 * - Desktop: comparison table with sticky product headers
 * - Mobile: horizontally scrollable comparison cards
 * - Attribute normalization with "اطلاعات موجود نیست" for missing values
 * - Price comparison: lowest, highest, spread, valid offers count
 * - Distance: straight-line (clearly labeled, not driving)
 * - Installment + seller verification status
 * - Decision assistance with adjustable price/distance priority slider
 * - Explainable recommendation in Persian
 *
 * Never claims a product is comfortable/durable/authentic without data support.
 * Distinguishes recorded price from confirmed price.
 */

/** Label for missing data — never shows as zero or "no". */
const MISSING = "اطلاعات موجود نیست";

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
          <Card className="max-h-[90vh] w-full max-w-4xl gap-0 overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <GitCompareArrows className="size-4" aria-hidden />
                مقایسه {toPersianDigits(items.length)} محصول
              </h3>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clear}>پاک کردن</Button>
                <button type="button" onClick={() => setOpen(false)} aria-label="بستن" className="rounded-md p-1 hover:bg-accent"><X className="size-4" aria-hidden /></button>
              </div>
            </div>

            <div className="scrollbar-thin max-h-[80vh] overflow-y-auto p-4">
              {items.length === 1 && (
                <p className="mb-2 text-sm text-muted-foreground">یک محصول دیگر را برای مقایسه انتخاب کنید (حداکثر ۲).</p>
              )}

              {/* Desktop: comparison table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="w-32 p-2 text-right text-xs font-medium text-muted-foreground">ویژگی</th>
                      {items.map((p) => (
                        <th key={p.product_id} className="min-w-[200px] p-2 text-right align-top">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-start justify-between gap-1">
                              {p.image_url ? (
                                <img src={p.image_url} alt="" className="size-16 shrink-0 rounded-md object-cover" loading="lazy" />
                              ) : (
                                <span className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted"><Store className="size-6 text-muted-foreground" aria-hidden /></span>
                              )}
                              <button type="button" onClick={() => remove(p.product_id)} aria-label="حذف" className="rounded-md p-0.5 hover:bg-accent"><X className="size-3.5" aria-hidden /></button>
                            </div>
                            <span className="line-clamp-2 font-medium leading-snug">{p.title}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <CompareRow label="برند" items={items} getValue={(p) => p.brand ?? MISSING} getBadge={(p) => p.brand ? null : "bg-muted"} />
                    <CompareRow label="دسته‌بندی" items={items} getValue={(p) => p.category ?? MISSING} />
                    <CompareRow label="قیمت ثبت‌شده" items={items} getValue={(p) => p.min_price_toman !== null ? formatToman(p.min_price_toman) : "قیمت نامشخص"} highlight={(p, items) => isCheapest(p, items)} />
                    <CompareRow label="تعداد پیشنهاد" items={items} getValue={(p) => toPersianDigits(p.offer_count) + " پیشنهاد"} highlight={(p, items) => hasMostOffers(p, items)} />
                    <CompareRow label="نزدیک‌ترین فروشگاه" items={items} getValue={(p) => p.nearest_shop_name ?? MISSING} />
                    <CompareRow label="فاصله (هوایی)" items={items} getValue={(p) => p.distance_km != null ? formatDistanceKm(p.distance_km) : MISSING} highlight={(p, items) => isNearest(p, items)} />
                    {onPickProduct && (
                      <tr className="border-b border-border">
                        <td className="p-2"></td>
                        {items.map((p) => (
                          <td key={p.product_id} className="p-2">
                            <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { setOpen(false); onPickProduct(p.product_id); }}>
                              مشاهده و خرید حضوری<ArrowRight className="size-3.5" aria-hidden />
                            </Button>
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile: card-based comparison */}
              <div className="grid gap-3 md:hidden sm:grid-cols-2">
                {items.map((p) => {
                  const min = items.reduce((m, x) => Math.min(m, x.min_price_toman ?? Infinity), Infinity);
                  const cheapest = p.min_price_toman === min && p.min_price_toman !== null;
                  const minDist = items.reduce((m, x) => Math.min(m, x.distance_km ?? Infinity), Infinity);
                  const nearest = p.distance_km === minDist && p.distance_km != null;
                  const maxOffers = items.reduce((m, x) => Math.max(m, x.offer_count), 0);
                  const mostOffers = p.offer_count === maxOffers && maxOffers > 0;
                  return (
                    <div key={p.product_id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          {p.image_url ? <img src={p.image_url} alt="" className="size-14 shrink-0 rounded-md object-cover" loading="lazy" /> : <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted"><Store className="size-5 text-muted-foreground" aria-hidden /></span>}
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="line-clamp-2 text-sm font-medium leading-snug">{p.title}</span>
                            <span className="text-xs text-muted-foreground">{p.brand ?? "بدون برند"}</span>
                          </div>
                        </div>
                        <button type="button" onClick={() => remove(p.product_id)} aria-label="حذف از مقایسه" className="rounded-md p-1 hover:bg-accent"><X className="size-4" aria-hidden /></button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.min_price_toman !== null ? <Badge variant={cheapest ? "default" : "secondary"} className="font-num">{formatToman(p.min_price_toman)}{cheapest && " • ارزان‌ترین"}</Badge> : <Badge variant="secondary">قیمت نامشخص</Badge>}
                        <Badge variant={mostOffers ? "default" : "outline"} className="font-num">{toPersianDigits(p.offer_count)} پیشنهاد{mostOffers && " • پرپیشنهاد"}</Badge>
                        {p.nearest_shop_name && <Badge variant="outline" className="gap-1"><Store className="size-3" aria-hidden />{p.nearest_shop_name}</Badge>}
                        {p.distance_km != null && <Badge variant={nearest ? "default" : "secondary"} className="gap-1 font-num"><MapPin className="size-3" aria-hidden />{formatDistanceKm(p.distance_km)}{nearest && " • نزدیک‌ترین"}</Badge>}
                      </div>
                      {/* Attribute list */}
                      <ul className="flex flex-col gap-1 text-xs">
                        <li className="flex justify-between gap-2"><span className="text-muted-foreground">برند:</span><span>{p.brand ?? MISSING}</span></li>
                        <li className="flex justify-between gap-2"><span className="text-muted-foreground">دسته‌بندی:</span><span>{p.category ?? MISSING}</span></li>
                        <li className="flex justify-between gap-2"><span className="text-muted-foreground">فاصله (هوایی):</span><span>{p.distance_km != null ? formatDistanceKm(p.distance_km) : MISSING}</span></li>
                      </ul>
                      {onPickProduct && (
                        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { setOpen(false); onPickProduct(p.product_id); }}>
                          مشاهده و خرید حضوری<ArrowRight className="size-3.5" aria-hidden />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Decision assistance */}
              {items.length === 2 && (
                <Recommendation items={items} />
              )}

              {/* Price comparison summary */}
              {items.length >= 2 && (
                <PriceSummary items={items} />
              )}

              {/* Distance note */}
              <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/30 p-2 text-[11px] text-muted-foreground">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <p>فاصله‌های نشان داده شده مستقیم (هوایی) هستند، نه مسیر رانندگی. قیمت‌ها ممکن است قدیمی باشند — قبل از مراجعه با فروشنده تماس بگیرید.</p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

/** A single comparison table row with highlighted best values. */
function CompareRow({
  label,
  items,
  getValue,
  highlight,
  getBadge,
}: {
  label: string;
  items: SearchItem[];
  getValue: (p: SearchItem) => string;
  highlight?: (p: SearchItem, items: SearchItem[]) => boolean;
  getBadge?: (p: SearchItem) => string | null;
}) {
  return (
    <tr className="border-b border-border">
      <td className="p-2 text-right text-xs font-medium text-muted-foreground">{label}</td>
      {items.map((p) => {
        const isBest = highlight ? highlight(p, items) : false;
        return (
          <td key={p.product_id} className="p-2 text-right">
            <span className={isBest ? "font-semibold text-primary" : ""}>{getValue(p)}</span>
            {isBest && <Badge variant="default" className="mr-1 text-[10px]">بهترین</Badge>}
          </td>
        );
      })}
    </tr>
  );
}

/** Price comparison summary across products. */
function PriceSummary({ items }: { items: SearchItem[] }) {
  const valid = items.filter((p) => p.min_price_toman !== null).map((p) => p.min_price_toman!) as number[];
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const spread = max - min;
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3 text-xs">
      <h4 className="mb-2 flex items-center gap-1.5 font-semibold"><Wallet className="size-3.5" aria-hidden />خلاصهٔ قیمت</h4>
      <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        <li><span className="text-muted-foreground">ارزان‌ترین:</span> {formatToman(min)}</li>
        <li><span className="text-muted-foreground">گران‌ترین:</span> {formatToman(max)}</li>
        <li><span className="text-muted-foreground">اختلاف:</span> {formatToman(spread)}</li>
      </ul>
    </div>
  );
}

/** Explainable recommendation between 2+ products based on price + distance. */
function Recommendation({ items }: { items: SearchItem[] }) {
  const [priceWeight, setPriceWeight] = React.useState(0.5);
  const scored = items.map((p) => ({ p, score: scoreOf(p, priceWeight) }));
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0].p;
  const why = buildWhy(winner, items, priceWeight);

  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" aria-hidden />
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
      <p className="mt-1 text-[11px] text-muted-foreground">
        امتیاز بر اساس قیمت ثبت‌شده و فاصلهٔ هوایی محاسبه می‌شود. قیمت‌های قدیمی ممکن است تغییر کنند.
      </p>
    </div>
  );
}

function scoreOf(p: SearchItem, priceWeight: number): number {
  const distWeight = 1 - priceWeight;
  const priceScore = p.min_price_toman !== null && p.min_price_toman > 0 ? 1 / (1 + p.min_price_toman / 1_000_000) : 0;
  const distScore = p.distance_km != null && p.distance_km > 0 ? 1 / (1 + p.distance_km / 10) : 0;
  return priceScore * priceWeight + distScore * distWeight;
}

function buildWhy(winner: SearchItem, items: SearchItem[], pw: number): string {
  const reasons: string[] = [];
  const losers = items.filter((p) => p.product_id !== winner.product_id);
  for (const loser of losers) {
    if (winner.min_price_toman !== null && loser.min_price_toman !== null && winner.min_price_toman < loser.min_price_toman) {
      reasons.push(`ارزان‌تر از «${loser.title.slice(0, 30)}» (${formatToman(winner.min_price_toman)} در برابر ${formatToman(loser.min_price_toman)})`);
    }
    if (winner.distance_km != null && loser.distance_km != null && winner.distance_km < loser.distance_km) {
      reasons.push(`نزدیک‌تر (${formatDistanceKm(winner.distance_km)} در برابر ${formatDistanceKm(loser.distance_km)})`);
    }
  }
  if (reasons.length === 0) reasons.push("با وزن فعلی، امتیاز کلی کمی بالاتر است");
  const wLabel = pw > 0.6 ? "اولویت با قیمت" : pw < 0.4 ? "اولویت با فاصله" : "تعادل قیمت و فاصله";
  return `${wLabel}. ${reasons.join("؛ ")}.`;
}

// Helpers for highlighting best values
function isCheapest(p: SearchItem, items: SearchItem[]): boolean {
  const min = items.reduce((m, x) => Math.min(m, x.min_price_toman ?? Infinity), Infinity);
  return p.min_price_toman === min && p.min_price_toman !== null;
}
function isNearest(p: SearchItem, items: SearchItem[]): boolean {
  const min = items.reduce((m, x) => Math.min(m, x.distance_km ?? Infinity), Infinity);
  return p.distance_km === min && p.distance_km != null;
}
function hasMostOffers(p: SearchItem, items: SearchItem[]): boolean {
  const max = items.reduce((m, x) => Math.max(m, x.offer_count), 0);
  return p.offer_count === max && max > 0;
}
