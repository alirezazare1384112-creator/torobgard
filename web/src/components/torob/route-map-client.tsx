"use client";

import * as React from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icons (Leaflet's CSS paths break under bundlers).
// We use a small inline SVG data URL so no external icon files are needed.
const ICON_SVG = (color: string) =>
  `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1.5"><path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white"/></svg>`)}`;

const startIcon = L.icon({
  iconUrl: ICON_SVG("#059669"), // emerald-600
  iconSize: [28, 28],
  iconAnchor: [14, 26],
  popupAnchor: [0, -24],
});
const stopIcon = L.icon({
  iconUrl: ICON_SVG("#7c3aed"), // primary (violet)
  iconSize: [26, 26],
  iconAnchor: [13, 24],
  popupAnchor: [0, -22],
});

export interface MapStop {
  lat: number;
  lon: number;
  label: string;
  isStart?: boolean;
  subtitle?: string;
}

export function RouteMapClient({ stops }: { stops: MapStop[] }) {
  // Compute bbox center + zoom covering all stops.
  if (stops.length < 1) return null;
  const lats = stops.map((s) => s.lat);
  const lons = stops.map((s) => s.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const center: [number, number] = [
    (minLat + maxLat) / 2,
    (minLon + maxLon) / 2,
  ];
  // Estimate a reasonable zoom from the bbox span.
  const latSpan = maxLat - minLat;
  const lonSpan = maxLon - minLon;
  const span = Math.max(latSpan, lonSpan, 0.01);
  let zoom = 13;
  if (span > 0.1) zoom = 11;
  else if (span > 0.05) zoom = 12;
  else if (span > 0.02) zoom = 13;
  else zoom = 14;

  // Polyline points (start → stops in order)
  const polyline: [number, number][] = stops.map((s) => [s.lat, s.lon]);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={false}
        style={{ height: "340px", width: "100%" }}
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {/* Route line connecting all stops */}
        {polyline.length >= 2 && (
          <Polyline
            positions={polyline}
            pathOptions={{ color: "#7c3aed", weight: 3, opacity: 0.8, dashArray: "6 6" }}
          />
        )}
        {/* Markers with popups */}
        {stops.map((s, i) => (
          <Marker
            key={`${s.lat},${s.lon},${i}`}
            position={[s.lat, s.lon]}
            icon={s.isStart ? startIcon : stopIcon}
          >
            <Popup>
              <div style={{ fontFamily: "sans-serif", direction: "rtl", textAlign: "right" }}>
                <strong>{s.isStart ? "📍 شروع" : `توقف ${i}`}: {s.label}</strong>
                {s.subtitle && <div style={{ fontSize: "11px", color: "#666" }}>{s.subtitle}</div>}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <p className="bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        نقشهٔ واقعی (OpenStreetMap) — خط بنفش = مسیر هوایی بین توقف‌ها. روی هر نشانگر کلیک کن تا نام فروشگاه رو ببینی. برای مسیر رانندگی واقعی از لینک گوگل مپ هر توقف استفاده کن.
      </p>
    </div>
  );
}
