"use client";

import * as React from "react";
// Leaflet is a browser-only library (uses window/document). To avoid SSR
// crashes, we load react-leaflet dynamically with ssr:false via a wrapper.

export interface MapStop {
  lat: number;
  lon: number;
  label: string;
  isStart?: boolean;
  subtitle?: string;
}

export interface RouteInfo {
  total_distance_meters: number;
  total_duration_seconds: number;
  has_real_routing: boolean;
  provider: string;
  segments: Array<{
    distance_meters: number;
    duration_seconds: number;
    is_estimated: boolean;
    geometry?: [number, number][];
  }>;
  ordered_stops?: { lat: number; lon: number; label: string }[];
}

// We dynamically import the actual map component only on the client.
const ClientRouteMap = React.lazy(() =>
  import("./route-map-client").then((m) => ({ default: m.RouteMapClient }))
);

export function RouteMap({
  stops,
  route,
}: {
  stops: MapStop[];
  route?: RouteInfo | null;
}) {
  return (
    <React.Suspense
      fallback={
        <div className="h-96 w-full animate-pulse rounded-lg border border-border bg-muted/30" />
      }
    >
      <ClientRouteMap stops={stops} route={route} />
    </React.Suspense>
  );
}
