/**
 * Routing provider adapter — multi-provider with graceful fallback.
 *
 * Providers, in order of preference:
 * 1. Neshan Maps (when NESHAN_API_KEY is set) — Iranian road network, accurate
 *    for Iran. Returns road distance + duration from the provider.
 * 2. OSRM public demo server (router.project-osrm.org) — free, no API key,
 *    global OSM road network. Reliable for Tehran. Used by default.
 * 3. Haversine straight-line fallback — when both providers are unreachable,
 *    we compute straight-line distance and clearly label it as an estimate.
 *
 * NEVER fabricate road distances when no provider responds. Every segment
 * carries an `is_estimated` flag (true = straight-line fallback) so the UI
 * can display honest labels.
 *
 * OSRM API (as documented):
 *   GET https://router.project-osrm.org/route/v1/driving/{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson
 *   Returns: routes[0].distance (meters), routes[0].duration (seconds),
 *            routes[0].geometry.coordinates [[lon, lat], ...]
 *
 *   GET https://router.project-osrm.org/table/v1/driving/{p1};{p2};{p3}?annotations=distance,duration
 *   Returns: distances[][] and durations[][] matrices in meters/seconds.
 */
import * as https from "node:https";

export interface RouteSegment {
  from: { lat: number; lon: number; label: string };
  to: { lat: number; lon: number; label: string };
  distance_meters: number;
  duration_seconds: number;
  is_estimated: boolean; // true if haversine fallback, false if real routing
  geometry?: [number, number][]; // [lon, lat] polyline points (OSRM only)
  provider: "neshan" | "osrm" | "haversine";
}

export interface RoutePlan {
  segments: RouteSegment[];
  total_distance_meters: number;
  total_duration_seconds: number;
  has_real_routing: boolean;
  error: string | null;
  provider: "neshan" | "osrm" | "haversine";
  // ordered list of stops (start → optimized order)
  ordered_stops: { lat: number; lon: number; label: string }[];
}

const NESHAN_API_KEY = process.env.NESHAN_API_KEY || "";
const NESHAN_BASE = "https://api.neshan.org";
const OSRM_BASE = "https://router.project-osrm.org";

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
  const avgSpeedMs = (25 * 1000) / 3600;
  return Math.round(distanceMeters / avgSpeedMs);
}

interface Coord {
  lat: number;
  lon: number;
  label: string;
}

/** Solve a small TSP (nearest-neighbor heuristic + 2-opt) using a distance
 *  matrix from OSRM. Returns the best order of stops to visit from the start. */
export function solveTsp(
  start: Coord,
  stops: Coord[],
  distMatrix: number[][]
): Coord[] {
  // indices: 0 = start, 1..N = stops
  const n = stops.length + 1;
  if (stops.length === 0) return [start];
  if (stops.length === 1) return [start, stops[0]];

  // Nearest-neighbor starting from `start`.
  const visited = new Array(n).fill(false);
  visited[0] = true;
  const order: number[] = [0];
  let current = 0;
  while (order.length < n) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 1; i < n; i++) {
      if (!visited[i] && distMatrix[current][i] < bestDist) {
        bestDist = distMatrix[current][i];
        best = i;
      }
    }
    if (best === -1) break;
    visited[best] = true;
    order.push(best);
    current = best;
  }

  // 2-opt improvement (a few iterations; n is small, ≤10 stops).
  let improved = true;
  let iters = 0;
  while (improved && iters < 50) {
    improved = false;
    iters++;
    // We don't reverse the start (index 0 stays at position 0).
    for (let i = 1; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const before = routeLength(order, distMatrix);
        const newOrder = [...order];
        // reverse the segment i..k
        let l = i;
        let r = k;
        while (l < r) {
          [newOrder[l], newOrder[r]] = [newOrder[r], newOrder[l]];
          l++;
          r--;
        }
        const after = routeLength(newOrder, distMatrix);
        if (after < before) {
          order.splice(0, order.length, ...newOrder);
          improved = true;
        }
      }
    }
  }

  return order.map((idx) => (idx === 0 ? start : stops[idx - 1]));
}

function routeLength(order: number[], m: number[][]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    total += m[order[i]][order[i + 1]];
  }
  return total;
}

/** Build a distance+duration matrix from the OSRM /table endpoint. */
async function osrmMatrix(
  points: { lat: number; lon: number }[]
): Promise<{ distances: number[][]; durations: number[][] } | null> {
  const coordStr = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `${OSRM_BASE}/table/v1/driving/${coordStr}?annotations=distance,duration`;
  try {
    const data = await httpsGetJson(url);
    if (!data?.distances || !data?.durations) return null;
    return { distances: data.distances, durations: data.durations };
  } catch {
    return null;
  }
}

/** Get the actual road route + geometry between two points via OSRM. */
async function osrmRoute(
  from: Coord,
  to: Coord
): Promise<{ distance: number; duration: number; geometry: [number, number][] } | null> {
  const url = `${OSRM_BASE}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  try {
    const data = await httpsGetJson(url);
    if (data?.code !== "Ok" || !data?.routes?.length) return null;
    const r = data.routes[0];
    return {
      distance: r.distance ?? 0,
      duration: r.duration ?? 0,
      geometry: r.geometry?.coordinates ?? [],
    };
  } catch {
    return null;
  }
}

/** GET a JSON response from a URL using node:https (with IPv4 forced).
 *  Node's fetch (undici) defaults to IPv6, which fails for OSRM in this
 *  environment; forcing IPv4 via `family: 4` fixes it. */
function httpsGetJson(url: string, extraHeaders?: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        family: 4, // force IPv4 — Node's fetch defaults to IPv6 which is broken here
        headers: {
          "User-Agent": "TorobGard/1.0 (https://github.com/alirezazare1384112-creator/torobgard)",
          ...(extraHeaders || {}),
        },
      },
      (res: any) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
  });
}

/** Alias for httpsGetJson with explicit headers (kept for readability). */
function httpsGetJsonWithHeaders(url: string, headers: Record<string, string>): Promise<any> {
  return httpsGetJson(url, headers);
}

/**
 * Compute a multi-stop route with optimal ordering (TSP) using OSRM.
 * If OSRM is unreachable, falls back to Neshan (if configured), then to
 * haversine straight-line with is_estimated=true.
 *
 * @param stops  Unordered list including the start (first element should be
 *              the start). If `optimize` is true, the order is rearranged
 *              using nearest-neighbor + 2-opt over the OSRM distance matrix.
 */
export async function computeRoute(
  stops: { lat: number; lon: number; label: string }[],
  opts: { optimize?: boolean } = {}
): Promise<RoutePlan> {
  if (stops.length < 2) {
    return {
      segments: [],
      total_distance_meters: 0,
      total_duration_seconds: 0,
      has_real_routing: false,
      error: "need at least 2 stops",
      provider: "haversine",
      ordered_stops: stops,
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
      provider: "haversine",
      ordered_stops: deduped,
    };
  }

  const start = deduped[0];
  const rest = deduped.slice(1);

  // === OSRM path: distance matrix → TSP → per-segment route with geometry ===
  if (!NESHAN_API_KEY) {
    try {
      const matrix = await osrmMatrix(deduped);
      if (matrix) {
        // Optional TSP optimization using the distance matrix.
        const ordered = opts.optimize
          ? solveTsp(start, rest, matrix.distances)
          : deduped;

        // Now fetch the actual road geometry for each consecutive pair.
        const segments: RouteSegment[] = [];
        let totalDist = 0;
        let totalDur = 0;
        let allReal = true;
        for (let i = 0; i < ordered.length - 1; i++) {
          const from = ordered[i];
          const to = ordered[i + 1];
          const seg = await osrmRoute(from, to);
          if (seg) {
            segments.push({
              from: { lat: from.lat, lon: from.lon, label: from.label },
              to: { lat: to.lat, lon: to.lon, label: to.label },
              distance_meters: seg.distance,
              duration_seconds: seg.duration,
              is_estimated: false,
              geometry: seg.geometry,
              provider: "osrm",
            });
            totalDist += seg.distance;
            totalDur += seg.duration;
          } else {
            // Per-segment fallback for this leg
            const dist = haversineMeters([from.lat, from.lon], [to.lat, to.lon]);
            const dur = estimateDuration(dist);
            segments.push({
              from: { lat: from.lat, lon: from.lon, label: from.label },
              to: { lat: to.lat, lon: to.lon, label: to.label },
              distance_meters: dist,
              duration_seconds: dur,
              is_estimated: true,
              provider: "haversine",
            });
            totalDist += dist;
            totalDur += dur;
            allReal = false;
          }
        }
        return {
          segments,
          total_distance_meters: totalDist,
          total_duration_seconds: totalDur,
          has_real_routing: allReal,
          error: allReal ? null : "some segments used straight-line fallback",
          provider: "osrm",
          ordered_stops: ordered,
        };
      }
    } catch {
      // fall through to Neshan / haversine
    }
  }

  // === Neshan path (only if API key configured) ===
  if (NESHAN_API_KEY) {
    // Neshan v4 direction endpoint — one segment at a time. No TSP.
    const segments: RouteSegment[] = [];
    let totalDist = 0;
    let totalDur = 0;
    let hadError = false;
    for (let i = 0; i < deduped.length - 1; i++) {
      const from = deduped[i];
      const to = deduped[i + 1];
      try {
        const url = `${NESHAN_BASE}/v4/direction?type=car&origin=${from.lon},${from.lat}&destination=${to.lon},${to.lat}`;
        const data = await httpsGetJsonWithHeaders(url, { "Api-Key": NESHAN_API_KEY });
        const dist = data?.routes?.[0]?.legs?.[0]?.distance?.value ?? haversineMeters([from.lat, from.lon], [to.lat, to.lon]);
        const dur = data?.routes?.[0]?.legs?.[0]?.duration?.value ?? estimateDuration(dist);
        segments.push({
          from: { lat: from.lat, lon: from.lon, label: from.label },
          to: { lat: to.lat, lon: to.lon, label: to.label },
          distance_meters: dist,
          duration_seconds: dur,
          is_estimated: false,
          provider: "neshan",
        });
        totalDist += dist;
        totalDur += dur;
      } catch {
        const dist = haversineMeters([from.lat, from.lon], [to.lat, to.lon]);
        const dur = estimateDuration(dist);
        segments.push({
          from: { lat: from.lat, lon: from.lon, label: from.label },
          to: { lat: to.lat, lon: to.lon, label: to.label },
          distance_meters: dist,
          duration_seconds: dur,
          is_estimated: true,
          provider: "haversine",
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
      provider: "neshan",
      ordered_stops: deduped,
    };
  }

  // === Haversine fallback ===
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
      provider: "haversine",
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
    provider: "haversine",
    ordered_stops: deduped,
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
