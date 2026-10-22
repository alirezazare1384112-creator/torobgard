"use client";

import * as React from "react";
// Leaflet is a browser-only library (uses window/document). To avoid SSR
// crashes, we load react-leaflet dynamically with ssr:false via a wrapper.
import type { ComponentType } from "react";

// Re-export the MapStop type for consumers.
export interface MapStop {
  lat: number;
  lon: number;
  label: string;
  isStart?: boolean;
  subtitle?: string;
}

// We dynamically import the actual map component only on the client.
const ClientRouteMap = React.lazy(() =>
  import("./route-map-client").then((m) => ({ default: m.RouteMapClient }))
);

export function RouteMap({ stops }: { stops: MapStop[] }) {
  return (
    <React.Suspense fallback={<div className="h-80 w-full animate-pulse rounded-lg border border-border bg-muted/30" />}>
      <ClientRouteMap stops={stops} />
    </React.Suspense>
  );
}

