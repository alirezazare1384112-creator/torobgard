"use client";

import * as React from "react";
import { Loader2, MapPin, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import { NEIGHBORHOODS, type Neighborhood, type ShopItem } from "./types";
import { RouteMap, type MapStop } from "./route-map";

/** Real interactive Leaflet map of shops in Tehran.
 *  Replaces the old SVG schematic with actual OpenStreetMap tiles + markers.
 *  Click a shop marker to see its name, address, and offer count. */
export function MapView({
  near,
  onNearChange,
}: {
  near: Neighborhood | "all";
  onNearChange: (n: Neighborhood | "all") => void;
}) {
  const [shops, setShops] = React.useState<ShopItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLoading(true);
    const sp = new URLSearchParams();
    sp.set("limit", "200");
    sp.set("sort", "distance");
    if (near !== "all") {
      sp.set("near", near);
      sp.set("radius_km", "20");
    } else {
      // Default to central Tehran so we get distance-sorted results
      sp.set("lat", "35.6997");
      sp.set("lon", "51.413");
    }
    fetch(`/api/shops?${sp.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: { shops: ShopItem[] }) => setShops(j.shops ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [near]);

  // Only shops with valid lat/lon land on the map.
  const mapped = shops.filter((s) => s.lat !== null && s.lon !== null);

  // Build map stops for RouteMap. We don't have a "start" location here,
  // so all stops are shop markers (no isStart flag).
  const mapStops: MapStop[] = mapped.slice(0, 50).map((s) => ({
    lat: s.lat!,
    lon: s.lon!,
    label: s.name,
    subtitle: `${toPersianDigits(s.matching_offers)} پیشنهاد${s.best_price_toman !== null ? ` • ${formatToman(s.best_price_toman)}` : ""}${s.distance_km !== null ? ` • ${formatDistanceKm(s.distance_km)}` : ""}`,
  }));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <MapPin className="size-5" aria-hidden />
            نقشهٔ واقعی فروشگاه‌ها
          </h2>
          <p className="text-xs text-muted-foreground">
            نقشهٔ تعاملی OpenStreetMap — هر نشانگر یک فروشگاه. روی هر نشانگر کلیک کن تا نام و تعداد پیشنهاد رو ببینی.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">محله:</span>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => onNearChange("all")}
              className={`min-h-9 rounded-full border px-3 py-1 text-xs transition-colors ${
                near === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent"
              }`}
            >
              همه تهران
            </button>
            {NEIGHBORHOODS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onNearChange(n)}
                className={`min-h-9 rounded-full border px-3 py-1 text-xs transition-colors ${
                  near === n
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-accent"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          در حال بارگذاری نقشهٔ فروشگاه‌ها…
        </div>
      )}

      {error && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">
          خطا در بارگذاری: {error}
        </Card>
      )}

      {!loading && !error && mapped.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-8 text-center text-muted-foreground">
          <MapPin className="size-8" aria-hidden />
          <p className="text-sm">
            هیچ فروشگاهی با مختصات جغرافیایی یافت نشد. محله را تغییر دهید.
          </p>
        </Card>
      )}

      {!loading && !error && mapped.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <Store className="ml-1 inline size-3.5" aria-hidden />
              {toPersianDigits(mapped.length)} فروشگاه روی نقشه (از {toPersianDigits(shops.length)} نتیجه)
            </span>
          </div>
          <RouteMap stops={mapStops} />
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block size-3 rounded-full bg-primary"></span>
              فروشگاه (با popup نشان دادن نام + تعداد پیشنهاد)
            </span>
          </div>
        </>
      )}
    </div>
  );
}
