"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  LocateFixed,
  MapPin,
  Navigation,
  Route,
  Store,
  Trash2,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SyntheticNameBadge } from "./disclaimers";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import type { SearchItem, SearchResponse } from "./types";

/**
 * "برنامهٔ خرید" view — multi-stop in-person trip planning.
 *
 * The user builds a shopping list (search + add items), sets a start point
 * (geolocation or neighborhood), and we call /api/trip to get a greedy
 * shop-coverage plan. We render the stops in order with a schematic route
 * line connecting them on a small SVG map.
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

const NEIGHBORHOODS = [
  "صادقیه", "ولنجک", "ونک", "میدان ولیعصر", "تجریش", "شریعتی",
] as const;
const NB_COORDS: Record<string, [number, number]> = {
  "صادقیه": [35.7467, 51.336], "ولنجک": [35.779, 51.387], "ونک": [35.765, 51.412],
  "میدان ولیعصر": [35.6997, 51.413], "تجریش": [35.805, 51.43], "شریعتی": [35.76, 51.433],
};

// Tehran bbox for the schematic map
const LAT_MIN = 35.64, LAT_MAX = 35.81, LON_MIN = 51.31, LON_MAX = 51.51;
const VB_W = 600, VB_H = 500, PAD = 30;
function lonToX(lon: number) { return PAD + ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * (VB_W - 2 * PAD); }
function latToY(lat: number) { return PAD + ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * (VB_H - 2 * PAD); }

export function TripView() {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchItem[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [list, setList] = React.useState<SearchItem[]>([]);
  const [loc, setLoc] = React.useState<{ lat: number; lon: number; label: string } | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [maxShops, setMaxShops] = React.useState(3);

  const [plan, setPlan] = React.useState<TripStop[] | null>(null);
  const [unmatched, setUnmatched] = React.useState<string[]>([]);
  const [planning, setPlanning] = React.useState(false);
  const [planError, setPlanError] = React.useState<string | null>(null);

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
    if (list.length === 0) return;
    setPlanning(true);
    setPlanError(null);
    fetch("/api/trip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: list.map((i) => ({ product_id: i.product_id })),
        start: loc ? { lat: loc.lat, lon: loc.lon } : undefined,
        max_shops: maxShops,
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { setPlan(j.plan ?? []); setUnmatched(j.unmatched_product_ids ?? []); })
      .catch((e) => setPlanError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPlanning(false));
  };

  // stops with valid coords for the schematic map
  const mappedStops = (plan ?? []).filter((s) => s.shop.lat !== null && s.shop.lon !== null);
  const points = [
    loc ? { x: lonToX(loc.lon), y: latToY(loc.lat), label: loc.label, isStart: true } : null,
    ...mappedStops.map((s) => ({ x: lonToX(s.shop.lon!), y: latToY(s.shop.lat!), label: s.shop.name, isStart: false })),
  ].filter(Boolean) as { x: number; y: number; label: string; isStart: boolean }[];
  const pathD = points.length > 1 ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") : "";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Route className="size-5" aria-hidden />برنامهٔ خرید
        </h2>
        <p className="text-sm text-muted-foreground">
          چند محصول را اضافه کن، موقعیتت را مشخص کن، و ببین می‌توانی همه را در چند توقف بخری.
          مسیر شماتیک است، نه مسیریابی واقعی.
        </p>
      </header>

      {/* Build the list */}
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">۱. محصولات موردنظر</div>
        <form onSubmit={(e) => { e.preventDefault(); search(query); }} className="flex gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="مثلاً: ماوس بی سیم" className="text-base" aria-label="جست‌وجوی محصول" />
          <Button type="submit" disabled={!query.trim() || searching} className="min-h-11 gap-2">جست‌وجو</Button>
        </form>
        {searching && <Skeleton className="h-20 w-full" />}
        {results && !searching && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {results.slice(0, 9).map((r) => {
              const inList = list.some((x) => x.product_id === r.product_id);
              return (
                <button key={r.product_id} type="button" onClick={() => setList((l) => inList ? l.filter((x) => x.product_id !== r.product_id) : [...l, r])} className={`flex items-start gap-2 rounded-lg border p-2 text-right text-xs transition-colors ${inList ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}>
                  {r.image_url ? <img src={r.image_url} alt="" className="size-9 shrink-0 rounded object-cover" loading="lazy" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded bg-muted"><Store className="size-4 text-muted-foreground" aria-hidden /></span>}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-2 font-medium leading-snug">{r.title}</span>
                    <span className="text-muted-foreground">{r.brand ?? "بدون برند"} • {r.min_price_toman !== null ? formatToman(r.min_price_toman) : "نامشخص"}</span>
                  </span>
                  {inList && <Badge variant="default" className="shrink-0">در لیست</Badge>}
                </button>
              );
            })}
          </div>
        )}
        {list.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {list.map((i) => (
              <Badge key={i.product_id} variant="secondary" className="gap-1">
                <span className="line-clamp-1 max-w-40">{i.title}</span>
                <button type="button" onClick={() => setList((l) => l.filter((x) => x.product_id !== i.product_id))} aria-label="حذف"><Trash2 className="size-3" aria-hidden /></button>
              </Badge>
            ))}
            <span className="text-xs text-muted-foreground">{toPersianDigits(list.length)} محصول</span>
          </div>
        )}
      </Card>

      {/* Location + plan */}
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">۲. نقطهٔ شروع و برنامه‌ریزی</div>
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
        <Button type="button" onClick={runPlan} disabled={list.length === 0 || planning} className="min-h-11 gap-2"><Navigation className="size-4" aria-hidden />{planning ? "در حال برنامه‌ریزی…" : "برنامه بساز"}</Button>
        {planError && <p className="flex items-start gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{planError}</p>}
      </Card>

      {/* Plan result */}
      {plan && !planning && (
        <Card className="gap-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">۳. برنامهٔ پیشنهادی ({toPersianDigits(plan.length)} توقف)</div>
            {plan.length > 0 && <span className="text-xs text-muted-foreground">مجموع: {formatToman(plan.reduce((s, p) => s + p.subtotal_toman, 0))}</span>}
          </div>

          {plan.length === 0 ? (
            <p className="text-sm text-amber-600">هیچ فروشگاهی برای این محصولات پیدا نشد. محصولات را عوض کن یا حداکثر توقف‌ها را زیاد کن.</p>
          ) : (
            <>
              {/* schematic route map */}
              {points.length > 0 && (
                <div className="rounded-lg border border-border bg-muted/20 p-2">
                  <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full" role="img" aria-label="مسیر شماتیک خرید">
                    <rect x={0} y={0} width={VB_W} height={VB_H} className="fill-muted/30" />
                    <rect x={PAD} y={PAD} width={VB_W - 2 * PAD} height={VB_H - 2 * PAD} rx={16} className="fill-background stroke-border" strokeWidth={2} />
                    {pathD && <path d={pathD} fill="none" className="stroke-primary" strokeWidth={2.5} strokeDasharray="6 6" />}
                    {points.map((p, i) => (
                      <g key={i} transform={`translate(${p.x}, ${p.y})`}>
                        <circle r={p.isStart ? 6 : 5} className={p.isStart ? "fill-emerald-600" : "fill-primary"} />
                        <text x={8} y={-6} className="fill-foreground text-[11px]" style={{ fontFamily: "var(--font-vazirmatn), sans-serif" }}>{p.isStart ? "شروع" : `توقف ${toPersianDigits(i)}`}</text>
                      </g>
                    ))}
                  </svg>
                  <p className="mt-1 text-[11px] text-muted-foreground">مسیر شماتیک (فاصلهٔ هوایی) — نه مسیریابی واقعی.</p>
                </div>
              )}

              <ol className="grid gap-2">
                {plan.map((stop, idx) => (
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
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </li>
                ))}
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
