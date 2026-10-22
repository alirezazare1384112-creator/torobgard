"use client";

import * as React from "react";
import { List, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MapView } from "./map-view";
import { ShopsView } from "./shops-view";
import type { Neighborhood } from "./types";

/**
 * "فروشگاه‌ها" — unified list/map view. A toggle switches between the shop
 * list (ShopsView) and the schematic map (MapView); both share the same
 * neighborhood filter so the user doesn't lose context when switching.
 */
export function ShopsMapView({
  near,
  onNearChange,
}: {
  near: Neighborhood | "all";
  onNearChange: (n: Neighborhood | "all") => void;
}) {
  const [mode, setMode] = React.useState<"list" | "map">("list");
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6">
      {/* toggle */}
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <MapPin className="size-5" aria-hidden />فروشگاه‌های تهران
        </h2>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <Button type="button" variant={mode === "list" ? "secondary" : "ghost"} size="sm" className="h-9 gap-1.5" onClick={() => setMode("list")} aria-pressed={mode === "list"}>
            <List className="size-4" aria-hidden />فهرست
          </Button>
          <Button type="button" variant={mode === "map" ? "secondary" : "ghost"} size="sm" className="h-9 gap-1.5" onClick={() => setMode("map")} aria-pressed={mode === "map"}>
            <MapPin className="size-4" aria-hidden />نقشه
          </Button>
        </div>
      </div>
      {mode === "list" ? (
        <ShopsView initialNear={near} onNearChange={onNearChange} />
      ) : (
        <MapView near={near} onNearChange={onNearChange} />
      )}
    </div>
  );
}
