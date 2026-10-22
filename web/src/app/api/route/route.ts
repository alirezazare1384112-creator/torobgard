import { NextResponse } from "next/server";
import { computeRoute, isNeshanConfigured, type RoutePlan } from "@/lib/torob/routing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface StopInput {
  lat: number;
  lon: number;
  label?: string;
}

/** POST /api/route — compute a multi-stop route using the Neshan routing
 *  adapter when NESHAN_API_KEY is configured, otherwise haversine
 *  straight-line distances with is_estimated=true. Never fabricates road
 *  distances when no provider is configured.
 *
 *  Body: { stops: [{lat, lon, label?}] }
 *  Returns: RoutePlan { segments[], total_distance_meters, total_duration_seconds,
 *                       has_real_routing, error }
 *
 *  When the Neshan key is missing (the current environment), every segment
 *  has is_estimated=true and has_real_routing=false — the frontend must
 *  display these as straight-line estimates, not driving distances. */
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
  try {
    const plan: RoutePlan = await computeRoute(
      cleanStops.map((s) => ({ lat: s.lat, lon: s.lon, label: s.label as string }))
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

/** GET /api/route — returns the configuration status of the routing provider.
 *  Lets the frontend show whether real road routing is available without
 *  making a full routing call. */
export async function GET() {
  return NextResponse.json({
    provider: "neshan",
    configured: isNeshanConfigured(),
    // when not configured, all distances are straight-line (haversine) estimates
    mode: isNeshanConfigured() ? "real_road" : "straight_line_estimate",
  });
}
