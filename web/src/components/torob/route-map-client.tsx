"use client";

import * as React from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Popup,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icons (Leaflet's CSS paths break under bundlers).
const ICON_SVG = (color: string, number?: number) =>
  `data:image/svg+xml;base64,${btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="${color}" stroke="white" stroke-width="2">
      <path d="M16 2C11 2 7 6 7 11c0 7 9 19 9 19s9-12 9-19c0-5-4-9-9-9z"/>
      ${number !== undefined ? `<circle cx="16" cy="11" r="6" fill="white"/><text x="16" y="15" text-anchor="middle" font-size="11" font-weight="bold" fill="${color}" font-family="sans-serif">${number}</text>` : `<circle cx="16" cy="11" r="3" fill="white"/>`}
    </svg>`
  )}`;

const startIcon = L.icon({
  iconUrl: ICON_SVG("#059669"),
  iconSize: [32, 32],
  iconAnchor: [16, 30],
  popupAnchor: [0, -28],
});
const stopIcon = (number: number) =>
  L.icon({
    iconUrl: ICON_SVG("#7c3aed", number),
    iconSize: [32, 32],
    iconAnchor: [16, 30],
    popupAnchor: [0, -28],
  });

export interface MapStop {
  lat: number;
  lon: number;
  label: string;
  isStart?: boolean;
  subtitle?: string;
}

export interface RouteSegment {
  distance_meters: number;
  duration_seconds: number;
  is_estimated: boolean;
  // geometry as [lon, lat][] from OSRM, if available
  geometry?: [number, number][];
}

export interface RouteInfo {
  total_distance_meters: number;
  total_duration_seconds: number;
  has_real_routing: boolean;
  provider: string;
  segments: RouteSegment[];
  // ordered stops (start first, then TSP-optimized order)
  ordered_stops?: { lat: number; lon: number; label: string }[];
}

export function RouteMapClient({
  stops,
  route,
}: {
  stops: MapStop[];
  route?: RouteInfo | null;
}) {
  if (stops.length < 1) return null;

  // Determine the actual display order: use route.ordered_stops if available,
  // else fall back to the input stops order.
  const displayStops = route?.ordered_stops?.length
    ? route.ordered_stops.map((s, i) => ({
        lat: s.lat,
        lon: s.lon,
        label: s.label,
        isStart: i === 0,
      }))
    : stops;

  const lats = displayStops.map((s) => s.lat);
  const lons = displayStops.map((s) => s.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const center: [number, number] = [
    (minLat + maxLat) / 2,
    (minLon + maxLon) / 2,
  ];
  const span = Math.max(maxLat - minLat, maxLon - minLon, 0.01);
  let zoom = 13;
  if (span > 0.15) zoom = 10;
  else if (span > 0.08) zoom = 11;
  else if (span > 0.04) zoom = 12;
  else if (span > 0.02) zoom = 13;
  else zoom = 14;

  // Build polylines for the route. If we have real geometry from OSRM,
  // use it (it follows the actual roads). Otherwise draw straight lines
  // between stops with a dashed style.
  const polylines: Array<{
    positions: [number, number][];
    color: string;
    weight: number;
    opacity: number;
    dashArray?: string;
  }> = [];
  if (route?.segments?.length) {
    route.segments.forEach((seg) => {
      if (seg.geometry && seg.geometry.length >= 2) {
        // OSRM geometry is [lon, lat][]; Leaflet wants [lat, lon][]
        const positions: [number, number][] = seg.geometry.map(([lon, lat]) => [lat, lon]);
        polylines.push({
          positions,
          color: seg.is_estimated ? "#f59e0b" : "#7c3aed",
          weight: seg.is_estimated ? 3 : 4,
          opacity: 0.9,
        });
      }
    });
  }
  // If no real geometry, draw straight dashed lines between consecutive stops.
  if (polylines.length === 0 && displayStops.length >= 2) {
    for (let i = 0; i < displayStops.length - 1; i++) {
      const a = displayStops[i];
      const b = displayStops[i + 1];
      polylines.push({
        positions: [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ],
        color: "#f59e0b",
        weight: 2,
        opacity: 0.7,
        dashArray: "6 6",
      });
    }
  }

  // Total distance/duration
  const totalKm = route ? (route.total_distance_meters / 1000).toFixed(1) : null;
  const totalMin = route ? Math.round(route.total_duration_seconds / 60) : null;

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={false}
        style={{ height: "380px", width: "100%" }}
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Routing: <a href="http://project-osrm.org/">OSRM</a>'
        />
        {/* Route polylines (real road geometry from OSRM) */}
        {polylines.map((line, i) => (
          <Polyline
            key={i}
            positions={line.positions}
            pathOptions={{
              color: line.color,
              weight: line.weight,
              opacity: line.opacity,
              dashArray: line.dashArray,
            }}
          />
        ))}
        {/* Markers with numbered popups */}
        {displayStops.map((s, i) => (
          <Marker
            key={`${s.lat},${s.lon},${i}`}
            position={[s.lat, s.lon]}
            icon={s.isStart ? startIcon : stopIcon(i)}
          >
            <Popup>
              <div
                style={{
                  fontFamily: "sans-serif",
                  direction: "rtl",
                  textAlign: "right",
                  minWidth: "140px",
                }}
              >
                <strong>
                  {s.isStart ? "📍 شروع" : `توقف ${i}`}: {s.label}
                </strong>
                {s.subtitle && (
                  <div style={{ fontSize: "11px", color: "#666" }}>
                    {s.subtitle}
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Route info bar below the map */}
      <div className="bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        {route && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-foreground">
              {route.has_real_routing ? "🛣️ مسیر جاده‌ای واقعی" : "⚠️ مسیر تقریبی (هوایی)"}
            </span>
            {totalKm && (
              <span className="font-num">
                📏 فاصله کل: <strong className="text-foreground">{totalKm}</strong> کیلومتر
              </span>
            )}
            {totalMin && (
              <span className="font-num">
                🕐 زمان رانندگی: <strong className="text-foreground">{totalMin}</strong> دقیقه
              </span>
            )}
            <span className="text-muted-foreground/70">
              ({route.provider === "osrm" ? "OSRM" : route.provider === "neshan" ? "نشان" : "هوایی"})
            </span>
          </div>
        )}
        <p className="mt-1">
          روی هر نشانگر کلیک کن تا نام فروشگاه رو ببینی. برای مسیر هر توقف از لینک گوگل مپ پایین هم می‌تونی استفاده کنی.
        </p>
      </div>
    </div>
  );
}
