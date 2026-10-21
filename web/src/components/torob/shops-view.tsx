"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { ExternalLink, Filter, LocateFixed, Loader2, MapPin, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toPersianDigits } from "./format";
import { ShopCard } from "./shop-card";
import { SyntheticNameBadge } from "./disclaimers";
import { NEIGHBORHOODS, type Neighborhood, type ShopSortOption, type ShopsResponse } from "./types";

export interface ShopsFiltersState {
  near: Neighborhood | "all";
  radius_km: number;
  fast_delivery: boolean;
  installment_only: boolean;
  sort: ShopSortOption;
  lat: number | null;
  lon: number | null;
}

export const DEFAULT_SHOPS_FILTERS: ShopsFiltersState = {
  near: "all",
  radius_km: 5,
  fast_delivery: false,
  installment_only: false,
  sort: "matching_offers",
  lat: null,
  lon: null,
};

function buildUrl(f: ShopsFiltersState, limit: number): string {
  const sp = new URLSearchParams();
  sp.set("limit", String(limit));
  sp.set("sort", f.sort);
  if (f.near !== "all") {
    sp.set("near", f.near);
    sp.set("radius_km", String(f.radius_km));
  }
  if (f.lat !== null && f.lon !== null) {
    sp.set("lat", String(f.lat));
    sp.set("lon", String(f.lon));
  }
  if (f.fast_delivery) sp.set("fast_delivery", "1");
  if (f.installment_only) sp.set("installment_only", "1");
  return `/api/shops?${sp.toString()}`;
}

export function ShopsView({
  initialNear,
  onNearChange,
}: {
  initialNear: Neighborhood | "all";
  onNearChange: (next: Neighborhood | "all") => void;
}) {
  const [draft, setDraft] = React.useState<ShopsFiltersState>({ ...DEFAULT_SHOPS_FILTERS, near: initialNear });
  const [applied, setApplied] = React.useState<ShopsFiltersState>({ ...DEFAULT_SHOPS_FILTERS, near: initialNear });
  const [data, setData] = React.useState<ShopsResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDraft((d) => ({ ...d, near: initialNear }));
    setApplied((a) => ({ ...a, near: initialNear }));
  }, [initialNear]);

  const doFetch = React.useCallback(async (f: ShopsFiltersState) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(buildUrl(f, 50));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ShopsResponse;
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    doFetch(applied);
  }, [applied, doFetch]);

  const shops = data?.shops ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Store className="size-5" aria-hidden />
          فروشگاه‌های تهران
        </h2>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {loading ? (
            "در حال بارگذاری…"
          ) : (
            <span className="font-num">{toPersianDigits(total)}</span>
          )}{" "}
          فروشگاه
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Card className="flex flex-col gap-4 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Filter className="size-4" aria-hidden />
              فیلترها
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shops-near">موقعیت (برای محاسبه فاصله)</Label>
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { if ("geolocation" in navigator) navigator.geolocation.getCurrentPosition((p) => setDraft({ ...draft, lat: Number(p.coords.latitude.toFixed(6)), lon: Number(p.coords.longitude.toFixed(6)) }), () => {}, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }); }}>
                <LocateFixed className="size-3.5" aria-hidden />موقعیت من
              </Button>
              {draft.lat !== null && draft.lon !== null && (
                <p className="text-[11px] text-emerald-600">({toPersianDigits(draft.lat)}، {toPersianDigits(draft.lon)})</p>
              )}
              <Select value={draft.near} onValueChange={(v) => { const next = v as Neighborhood | "all"; setDraft({ ...draft, near: next }); }}>
                <SelectTrigger id="shops-near" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همه تهران</SelectItem>
                  {NEIGHBORHOODS.map((n) => (<SelectItem key={n} value={n}>{n}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            {draft.near !== "all" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="shops-radius">شعاع (کیلومتر)</Label>
                  <Badge variant="secondary" className="font-num">
                    {toPersianDigits(draft.radius_km)}
                  </Badge>
                </div>
                <Slider
                  id="shops-radius"
                  min={1}
                  max={20}
                  step={1}
                  value={[draft.radius_km]}
                  onValueChange={(v) => setDraft({ ...draft, radius_km: v[0] })}
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="shops-sort">ترتیب</Label>
              <Select
                value={draft.sort}
                onValueChange={(v) => setDraft({ ...draft, sort: v as ShopSortOption })}
              >
                <SelectTrigger id="shops-sort" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="matching_offers">بیشترین پیشنهاد منطبق</SelectItem>
                  <SelectItem value="distance">نزدیک‌ترین</SelectItem>
                  <SelectItem value="price_asc">ارزان‌ترین فروشگاه</SelectItem>
                  <SelectItem value="price_desc">گران‌ترین فروشگاه</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="shops-fast" className="text-sm">فقط ارسال سریع</Label>
              <Switch id="shops-fast" checked={draft.fast_delivery} onCheckedChange={(c) => setDraft({ ...draft, fast_delivery: c })} />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="shops-installment" className="text-sm">فقط فروشگاه‌های قسطی</Label>
              <Switch id="shops-installment" checked={draft.installment_only} onCheckedChange={(c) => setDraft({ ...draft, installment_only: c })} />
            </div>

            <Button
              type="button"
              className="min-h-11"
              onClick={() => {
                setApplied(draft);
                onNearChange(draft.near);
              }}
            >
              اعمال فیلترها
            </Button>
          </Card>
        </aside>

        <section aria-label="فهرست فروشگاه‌ها">
          {error && (
            <Card className="mb-4 border-destructive/40 p-4 text-sm text-destructive">
              خطا در بارگذاری: {error}
            </Card>
          )}

          {loading && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full" />
              ))}
            </div>
          )}

          {!loading && !error && shops.length === 0 && (
            <Card className="flex flex-col items-center gap-3 p-8 text-center text-muted-foreground">
              <MapPin className="size-8" aria-hidden />
              <p className="text-sm">
                فروشگاه‌ای با این فیلترها یافت نشد. محله یا شعاع را تغییر دهید.
              </p>
            </Card>
          )}

          {!loading && shops.length > 0 && (
            <motion.div
              key={`${applied.near}-${applied.radius_km}-${applied.sort}-${applied.fast_delivery}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              {shops.map((s) => (
                <ShopCard key={s.shop_id} shop={s} />
              ))}
            </motion.div>
          )}

          {loading && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              در حال بارگذاری…
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
