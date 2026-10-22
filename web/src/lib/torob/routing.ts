/**
 * Routing provider adapter — Neshan Maps integration.
 *
 * Neshan provides routing APIs for Iran. To use real routing:
 * 1. Get an API key from https://platform.neshan.org/
 * 2. Set NESHAN_API_KEY in your environment (.env file)
 * 3. The adapter will use Neshan's routing API for road distances and times
 *
 * If no API key is configured, the adapter falls back to haversine straight-line
 * distance and clearly labels it as such. Never claims real routing works
 * without a tested API key.
 *
 * Neshan Routing API (as documented):
 *   GET https://api.neshan.org/v1/routing-distance-matrix
 *   Headers: Api-Key: YOUR_KEY
 *   Params: origins=lat,lon|lat,lon  destinations=lat,lon|lat,lon
 *   Returns: rows[] with elements[] containing distance (meters) and duration (seconds)
 *
 * For multi-stop routing, we request each consecutive segment separately
 * (Neshan's distance matrix returns pairwise distances).
 */

export interface RouteSegment {
  from: { lat: number; lon: number; label: string };
  to: { lat: number; lon: number; label: string };
  distance_meters: number;
  duration_seconds: number;
  is_estimated: boolean; // true if haversine fallback, false if real routing
}

export interface RoutePlan {
  segments: RouteSegment[];
  total_distance_meters: number;
  total_duration_seconds: number;
  has_real_routing: boolean;
  error: string | null;
}

const NESHAN_API_KEY = process.env.NESHAN_API_KEY || "";
const NESHAN_BASE = "https://api.neshan.org";

/** Haversine distance in meters between two coordinates. */
function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Estimate driving duration from distance (Tehran average speed ~25 km/h). */
function estimateDuration(distanceMeters: number): number {
  const avgSpeedMs = (25 * 1000) / 3600; // 25 km/h in m/s
  return Math.round(distanceMeters / avgSpeedMs);
}

/**
 * Compute a multi-stop route. Uses Neshan if API key is available,
 * otherwise falls back to haversine straight-line distance.
 */
export async function computeRoute(
  stops: { lat: number; lon: number; label: string }[]
): Promise<RoutePlan> {
  if (stops.length < 2) {
    return {
      segments: [],
      total_distance_meters: 0,
      total_duration_seconds: 0,
      has_real_routing: false,
      error: "need at least 2 stops",
    };
  }

  // Remove duplicate consecutive stops
  const deduped = stops.filter((s, i) => {
    if (i === 0) return true;
    const prev = stops[i - 1];
    return s.lat !== prev.lat || s.lon !== prev.lon;
  });

  if (deduped.length < 2) {
    return {
      segments: [],
      total_distance_meters: 0,
      total_duration_seconds: 0,
      has_real_routing: false,
      error: "all stops are at the same location",
    };
  }

  // If no Neshan API key, use haversine fallback
  if (!NESHAN_API_KEY) {
    const segments: RouteSegment[] = [];
    let totalDist = 0;
    let totalDur = 0;
    for (let i = 0; i < deduped.length - 1; i++) {
      const from = deduped[i];
      const to = deduped[i + 1];
      const dist = haversineMeters([from.lat, from.lon], [to.lat, to.lon]);
      const dur = estimateDuration(dist);
      segments.push({
        from: { lat: from.lat, lon: from.lon, label: from.label },
        to: { lat: to.lat, lon: to.lon, label: to.label },
        distance_meters: dist,
        duration_seconds: dur,
        is_estimated: true,
      });
      totalDist += dist;
      totalDur += dur;
    }
    return {
      segments,
      total_distance_meters: totalDist,
      total_duration_seconds: totalDur,
      has_real_routing: false,
      error: null,
    };
  }

  // Use Neshan routing — request each consecutive segment
  const segments: RouteSegment[] = [];
  let totalDist = 0;
  let totalDur = 0;
  let hadError = false;

  for (let i = 0; i < deduped.length - 1; i++) {
    const from = deduped[i];
    const to = deduped[i + 1];
    try {
      const url = `${NESHAN_BASE}/v4/direction?type=car&origin=${from.lon},${from.lat}&destination=${to.lon},${to.lat}`;
      const resp = await fetch(url, {
        headers: { "Api-Key": NESHAN_API_KEY },
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`Neshan API ${resp.status}`);
      const data = await resp.json();
      const dist = data?.routes?.[0]?.legs?.[0]?.distance?.value ?? haversineMeters([from.lat, from.lon], [to.lat, to.lon]);
      const dur = data?.routes?.[0]?.legs?.[0]?.duration?.value ?? estimateDuration(dist);
      segments.push({
        from: { lat: from.lat, lon: from.lon, label: from.label },
        to: { lat: to.lat, lon: to.lon, label: to.label },
        distance_meters: dist,
        duration_seconds: dur,
        is_estimated: false,
      });
      totalDist += dist;
      totalDur += dur;
    } catch (e) {
      // Fallback to haversine for this segment
      const dist = haversineMeters([from.lat, from.lon], [to.lat, to.lon]);
      const dur = estimateDuration(dist);
      segments.push({
        from: { lat: from.lat, lon: from.lon, label: from.label },
        to: { lat: to.lat, lon: to.lon, label: to.label },
        distance_meters: dist,
        duration_seconds: dur,
        is_estimated: true,
      });
      totalDist += dist;
      totalDur += dur;
      hadError = true;
    }
  }

  return {
    segments,
    total_distance_meters: totalDist,
    total_duration_seconds: totalDur,
    has_real_routing: !hadError,
    error: hadError ? "some segments used straight-line fallback" : null,
  };
}

/** Format distance for display. */
export function formatRouteDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} کیلومتر`;
  return `${meters} متر`;
}

/** Format duration for display. */
export function formatRouteDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs} ساعت${remMins > 0 ? ` و ${remMins} دقیقه` : ""}`;
  }
  return `${mins} دقیقه`;
}

export function isNeshanConfigured(): boolean {
  return NESHAN_API_KEY.length > 0;
}
