"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  Route,
  Store,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCart } from "./cart-store";
import { SyntheticNameBadge } from "./disclaimers";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import { RouteMap, type MapStop } from "./route-map";
import type { SearchItem, SearchResponse } from "./types";

/**
 * "برنامهٔ خرید" — multi-stop in-person trip planning.
 *
 * Reads the shared cart (products the user added from search). The user sets a
 * start point (geolocation or neighborhood), we call /api/trip for a greedy
 * shop-coverage plan, then render stops in order with a schematic route, the
 * total price across all stops, and a per-stop Google Maps directions link
 * (opens the route to that shop's coordinates) plus the straight-line distance.
 */

interface TripStop {
  shop: {
    shop_id: string;
    name: string;
    address: string | null;
    location_label: string | null;
    lat: number | null;
    lon: number | null;
    distance_km: number | null;
  };
  items: { product_id: string; price_toman: number }[];
  subtotal_toman: number;
  straight_line_distance_km_from_start: number | null;
}

const NEIGHBORHOODS = ["صادقیه", "ولنجک", "ونک", "میدان ولیعصر", "تجریش", "شریعتی"] as const;
const NB_COORDS: Record<string, [number, number]> = {
  "صادقیه": [35.7467, 51.336], "ولنجک": [35.779, 51.387], "ونک": [35.765, 51.412],
  "میدان ولیعصر": [35.6997, 51.413], "تجریش": [35.805, 51.43], "شریعتی": [35.76, 51.433],
};

/** Google Maps directions URL from start to a destination lat/lon. */
function gmapsDirectionsUrl(from: { lat: number; lon: number } | null, to: { lat: number; lon: number }): string {
  const dest = `${to.lat},${to.lon}`;
  if (from) return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${dest}&travelmode=driving`;
  return `https://www.google.com/maps/search/?api=1&query=${dest}`;
}

export function TripView() {
  const cartItems = useCart((s) => s.items);
  const removeFromCart = useCart((s) => s.remove);
  const clearCart = useCart((s) => s.clear);

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchItem[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [loc, setLoc] = React.useState<{ lat: number; lon: number; label: string } | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [maxShops, setMaxShops] = React.useState(3);

  const [plan, setPlan] = React.useState<TripStop[] | null>(null);
  const [unmatched, setUnmatched] = React.useState<string[]>([]);
  const [planning, setPlanning] = React.useState(false);
  const [planError, setPlanError] = React.useState<string | null>(null);

  // Routing provider status — fetched once on mount. Shows whether real road
  // routing (Neshan) is configured or distances are straight-line estimates.
  const [routingMode, setRoutingMode] = React.useState<"real_road" | "straight_line_estimate" | null>(null);
  React.useEffect(() => {
    fetch("/api/route")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { mode: "real_road" | "straight_line_estimate" }) => setRoutingMode(j.mode))
      .catch(() => setRoutingMode(null));
  }, []);

  const search = (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setResults(null);
    const sp = new URLSearchParams({ q, limit: "20", sort: "relevance" });
    fetch(`/api/search?${sp.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: SearchResponse) => setResults(j.items))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  };

  const detect = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLoc({ lat: Number(p.coords.latitude.toFixed(6)), lon: Number(p.coords.longitude.toFixed(6)), label: "موقعیت شما" }); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };

  const runPlan = () => {
    if (cartItems.length === 0) return;
    setPlanning(true);
    setPlanError(null);
    fetch("/api/trip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cartItems.map((i) => ({ product_id: i.product_id })),
        start: loc ? { lat: loc.lat, lon: loc.lon } : undefined,
        max_shops: maxShops,
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { setPlan(j.plan ?? []); setUnmatched(j.unmatched_product_ids ?? []); })
      .catch((e) => setPlanError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPlanning(false));
  };

  // product_id -> title lookup from the cart so we can show item names in stops
  const titleById = React.useMemo(() => {
    const m: Record<string, string> = {};
    cartItems.forEach((i) => { m[i.product_id] = i.title; });
    return m;
  }, [cartItems]);

  // total across all stops
  const grandTotal = (plan ?? []).reduce((s, p) => s + p.subtotal_toman, 0);

  // Order stops by nearest-neighbor from start (so the route is the best path,
  // not just the greedy shop-coverage order the backend returns).
  const orderedPlan = React.useMemo(() => {
    if (!plan || plan.length === 0) return [];
    const withCoords = plan.filter((s) => s.shop.lat !== null && s.shop.lon !== null);
    if (withCoords.length === 0) return plan;
    const remaining = [...plan];
    const ordered: typeof plan = [];
    let cur: [number, number] | null = loc ? [loc.lat, loc.lon] : null;
    while (remaining.length) {
      if (!cur) { ordered.push(...remaining); break; }
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const s = remaining[i];
        if (s.shop.lat === null || s.shop.lon === null) continue;
        const d = Math.hypot(s.shop.lat - cur[0], s.shop.lon - cur[1]);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const [pickedStop] = remaining.splice(bestIdx, 1);
      ordered.push(pickedStop);
      if (pickedStop.shop.lat !== null && pickedStop.shop.lon !== null) {
        cur = [pickedStop.shop.lat!, pickedStop.shop.lon!];
      }
    }
    return ordered;
  }, [plan, loc]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Route className="size-5" aria-hidden />برنامهٔ خرید
          </h2>
          {routingMode && (
            <Badge variant={routingMode === "real_road" ? "default" : "outline"} className="gap-1 text-[11px]">
              <Navigation className="size-3" aria-hidden />
              {routingMode === "real_road" ? "مسیریابی واقعی (نشان)" : "فاصلهٔ هوایی (مسیریابی تنظیم‌نشده)"}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          محصول‌هایی که از جست‌وجو اضافه کردی اینجا جمع می‌شوند. موقعیتت را مشخص کن، برنامه را بساز،
          و برای هر توقف مسیر رسیدن در گوگل مپ و فاصله را ببین.{" "}
          {routingMode === "real_road"
            ? "مسیرها بر اساس مسیریابی واقعی جاده‌ای (نشان) محاسبه می‌شوند."
            : "مسیر روی نقشه شماتیک است (فاصلهٔ هوایی)، ولی لینک مپ واقعی است."}
        </p>
      </header>

      {/* Cart (items added from search) */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Wallet className="size-4" aria-hidden />سبد خرید ({toPersianDigits(cartItems.length)})
          </div>
          {cartItems.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={clearCart}>پاک کردن سبد</Button>
          )}
        </div>
        {cartItems.length === 0 ? (
          <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
            هنوز محصولی اضافه نکردی. از تب «جست‌وجو» محصول‌ها را پیدا کن و «افزودن به برنامهٔ خرید» را بزن.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {cartItems.map((i) => (
              <div key={i.product_id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
                {i.image_url ? (
                  <img src={i.image_url} alt={i.title} loading="lazy" className="size-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted"><Store className="size-5 text-muted-foreground" aria-hidden /></span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-2 text-xs font-medium leading-tight">{i.title}</span>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {i.min_price_toman !== null && <span className="font-num font-semibold text-primary">{formatToman(i.min_price_toman)}</span>}
                    {i.offer_count !== undefined && <Badge variant="outline" className="font-num text-[10px]">{toPersianDigits(i.offer_count)} پیشنهاد</Badge>}
                    {i.nearest_shop_name && <span className="line-clamp-1">• نزدیک‌ترین: {i.nearest_shop_name}</span>}
                  </div>
                </div>
                <button type="button" onClick={() => removeFromCart(i.product_id)} aria-label={`حذف ${i.title} از سبد`} className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"><Trash2 className="size-4" aria-hidden /></button>
              </div>
            ))}
          </div>
        )}

        {/* quick add by search (optional) */}
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted-foreground">+ افزودن سریع با جست‌وجو</summary>
          <form onSubmit={(e) => { e.preventDefault(); search(query); }} className="mt-2 flex gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="مثلاً: ماوس بی سیم" className="text-sm" aria-label="جست‌وجوی محصول" />
            <Button type="submit" size="sm" disabled={!query.trim() || searching} className="min-h-9">جست‌وجو</Button>
          </form>
          {searching && <Skeleton className="mt-2 h-16 w-full" />}
          {results && !searching && (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {results.slice(0, 6).map((r) => {
                const inCart = cartItems.some((x) => x.product_id === r.product_id);
                return (
                  <button key={r.product_id} type="button" onClick={() => !inCart && useCart.getState().add(r)} disabled={inCart} className={`flex items-center gap-2 rounded-md border p-1.5 text-right text-xs transition-colors ${inCart ? "border-primary/40 bg-primary/5 opacity-70" : "border-border hover:bg-accent"}`}>
                    {r.image_url ? <img src={r.image_url} alt="" className="size-7 rounded object-cover" loading="lazy" /> : <span className="flex size-7 items-center justify-center rounded bg-muted"><Store className="size-3.5 text-muted-foreground" aria-hidden /></span>}
                    <span className="flex min-w-0 flex-1 flex-col"><span className="line-clamp-1">{r.title}</span><span className="text-muted-foreground">{r.min_price_toman !== null ? formatToman(r.min_price_toman) : "نامشخص"}</span></span>
                    {inCart && <Badge variant="secondary" className="text-[10px]">افزوده شد</Badge>}
                  </button>
                );
              })}
            </div>
          )}
        </details>
      </Card>

      {/* Start + plan */}
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">نقطهٔ شروع و برنامه‌ریزی</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={detect} disabled={locating} className="min-h-11 gap-2"><LocateFixed className="size-4" aria-hidden />{locating ? "..." : "موقعیت من"}</Button>
          {NEIGHBORHOODS.map((n) => (
            <button key={n} type="button" onClick={() => setLoc({ lat: NB_COORDS[n][0], lon: NB_COORDS[n][1], label: n })} className={`min-h-9 rounded-full border px-3 py-1 text-xs transition-colors ${loc?.label === n ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent"}`}>{n}</button>
          ))}
        </div>
        {loc && <p className="text-xs text-emerald-600">شروع: {loc.label} ({toPersianDigits(loc.lat)}، {toPersianDigits(loc.lon)})</p>}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2">حداکثر توقف‌ها:
            <select value={maxShops} onChange={(e) => setMaxShops(Number(e.target.value))} className="rounded-md border border-border bg-card px-2 py-1">
              <option value={1}>۱</option><option value={2}>۲</option><option value={3}>۳</option><option value={5}>۵</option>
            </select>
          </label>
        </div>
        <Button type="button" onClick={runPlan} disabled={cartItems.length === 0 || planning} className="min-h-11 gap-2"><Navigation className="size-4" aria-hidden />{planning ? "در حال برنامه‌ریزی…" : "برنامه بساز"}</Button>
        {planError && <p className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{planError}</p>}
      </Card>

      {/* Plan result */}
      {plan && !planning && (
        <Card className="gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">برنامهٔ پیشنهادی ({toPersianDigits(plan.length)} توقف)</div>
            {plan.length > 0 && (
              <Badge variant="default" className="gap-1 font-num text-sm">
                <Wallet className="size-3.5" aria-hidden />مجموع: {formatToman(grandTotal)}
              </Badge>
            )}
          </div>

          {plan.length === 0 ? (
            <p className="text-sm text-amber-600">هیچ فروشگاهی برای این محصولات پیدا نشد. محصولات را عوض کن یا حداکثر توقف‌ها را زیاد کن.</p>
          ) : (
            <>
              {/* Interactive OpenStreetMap (Leaflet) showing the start + all
                  stops as markers + a dashed polyline connecting them in order.
                  No API key needed. Replaces the old crude SVG schematic. */}
              {(() => {
                const mapStops: MapStop[] = [];
                if (loc) {
                  mapStops.push({ lat: loc.lat, lon: loc.lon, label: loc.label, isStart: true, subtitle: "موقعیت شروع شما" });
                }
                orderedPlan.forEach((stop, idx) => {
                  if (stop.shop.lat !== null && stop.shop.lon !== null) {
                    mapStops.push({
                      lat: stop.shop.lat!,
                      lon: stop.shop.lon!,
                      label: stop.shop.name,
                      subtitle: `توقف ${idx + 1} • ${stop.items.length} کالا • ${formatToman(stop.subtotal_toman)}`,
                    });
                  }
                });
                if (mapStops.length >= 1) return <RouteMap stops={mapStops} />;
                return null;
              })()}

              <ol className="grid gap-2">
                {orderedPlan.map((stop, idx) => {
                  const mapsUrl = stop.shop.lat !== null && stop.shop.lon !== null
                    ? gmapsDirectionsUrl(loc, { lat: stop.shop.lat!, lon: stop.shop.lon! })
                    : null;
                  return (
                    <li key={stop.shop.shop_id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-num text-sm font-semibold text-primary">{toPersianDigits(idx + 1)}</span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Store className="size-4 text-primary" aria-hidden />
                          <span className="line-clamp-1 text-sm font-semibold">{stop.shop.name}</span>
                          <SyntheticNameBadge />
                        </div>
                        {stop.shop.address && <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />{stop.shop.address}</p>}
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="secondary" className="font-num">{toPersianDigits(stop.items.length)} کالا</Badge>
                          <span className="font-num font-semibold text-primary">{formatToman(stop.subtotal_toman)}</span>
                          {stop.straight_line_distance_km_from_start !== null && <Badge variant="outline" className="font-num gap-1"><Truck className="size-3" aria-hidden />{formatDistanceKm(stop.straight_line_distance_km_from_start)} از شروع</Badge>}
                        </div>
                        {/* items in this stop */}
                        <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted-foreground">
                          {stop.items.map((it) => (
                            <li key={it.product_id} className="flex items-center justify-between gap-2">
                              <span className="line-clamp-1">{titleById[it.product_id] ?? it.product_id}</span>
                              <span className="font-num">{it.price_toman !== null ? formatToman(it.price_toman) : "نامشخص"}</span>
                            </li>
                          ))}
                        </ul>
                        {/* Google Maps link */}
                        {mapsUrl ? (
                          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
                            <Navigation className="size-3.5" aria-hidden />مسیر رسیدن در گوگل مپ
                            <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : (
                          <span className="mt-1 text-[11px] text-amber-600">موقعیت فروشگاه نامشخص — لینک مپ در دسترس نیست.</span>
                        )}
                      </div>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </li>
                  );
                })}
              </ol>

              {unmatched.length > 0 && (
                <p className="text-xs text-amber-600">{toPersianDigits(unmatched.length)} محصول در فروشگاه‌های پیشنهادی پوشش داده نشد — با افزایش توقف‌ها یا عوض کردن محصول ممکن است کامل شود.</p>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  );
}
