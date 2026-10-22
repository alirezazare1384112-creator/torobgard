import { NextResponse } from "next/server";
import { computeRoute, isNeshanConfigured, type RoutePlan } from "@/lib/torob/routing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface StopInput {
  lat: number;
  lon: number;
  label?: string;
}

/** POST /api/route — compute a multi-stop driving route with optional TSP
 *  ordering. Uses OSRM (free, no API key) for the road network + geometry.
 *  Falls back to Neshan (if NESHAN_API_KEY set), then to haversine straight-line.
 *
 *  Body: {
 *    stops: [{lat, lon, label?}],   // first element = start (user location)
 *    optimize?: boolean              // if true, reorder stops via nearest-neighbor + 2-opt
 *  }
 *  Returns: RoutePlan with:
 *    - segments[]: each has distance_meters, duration_seconds, geometry (OSRM)
 *    - total_distance_meters, total_duration_seconds
 *    - has_real_routing (true if all segments are real road, false if any fallback)
 *    - provider: "osrm" | "neshan" | "haversine"
 *    - ordered_stops: the actual visit order (after TSP optimization)
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", code: "validation_error" },
      { status: 400 }
    );
  }
  const stops = Array.isArray(body?.stops) ? body.stops : null;
  if (!stops || stops.length < 2) {
    return NextResponse.json(
      { error: "stops must be an array of at least 2 {lat, lon} points", code: "validation_error" },
      { status: 400 }
    );
  }
  if (stops.length > 15) {
    return NextResponse.json(
      { error: "too many stops (max 15)", code: "validation_error" },
      { status: 400 }
    );
  }
  // Validate each stop
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const lat = Number(s?.lat);
    const lon = Number(s?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json(
        { error: `invalid coordinates at stop ${i}`, code: "validation_error" },
        { status: 400 }
      );
    }
  }
  const cleanStops: StopInput[] = stops.map((s: any) => ({
    lat: Number(s.lat),
    lon: Number(s.lon),
    label: typeof s.label === "string" ? s.label : `${Number(s.lat).toFixed(4)},${Number(s.lon).toFixed(4)}`,
  }));
  const optimize = body?.optimize === true;
  try {
    const plan: RoutePlan = await computeRoute(
      cleanStops.map((s) => ({ lat: s.lat, lon: s.lon, label: s.label as string })),
      { optimize }
    );
    return NextResponse.json(plan);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/route] error:", msg);
    return NextResponse.json(
      { error: "internal_error", code: "server_error" },
      { status: 500 }
    );
  }
}

/** GET /api/route — returns the configuration status of the routing provider. */
export async function GET() {
  return NextResponse.json({
    provider: isNeshanConfigured() ? "neshan" : "osrm",
    neshan_configured: isNeshanConfigured(),
    osrm_available: true,
    // when neshan not configured, we use OSRM (real road routing, free)
    mode: "real_road",
    note: isNeshanConfigured()
      ? "Using Neshan Maps (Iran-focused)"
      : "Using OSRM public server (real road routing, no API key needed)",
  });
}
