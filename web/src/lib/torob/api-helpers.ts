/** Shared helpers for the /api/* routes over the torob SQLite tools. */
import { NextResponse } from "next/server";
import { getTools, type Filters } from "@/lib/torob";
import { resolveLocation } from "@/lib/torob";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorJson(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code: code ?? "bad_request" }, { status });
}

function num(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: string | null): boolean | null {
  if (v === null) return null;
  if (v === "1" || v.toLowerCase() === "true") return true;
  if (v === "0" || v.toLowerCase() === "false") return false;
  return null;
}

/** Parse the common filter query params into a Filters object. */
export function parseFilters(sp: URLSearchParams): Filters {
  const near = sp.get("near");
  const loc = near ? resolveLocation(near) : null;
  const f: Filters = {
    min_price: num(sp.get("min_price")),
    max_price: num(sp.get("max_price")),
    brand: sp.get("brand") || null,
    category: sp.get("category") || null,
    near: loc,
    radius_km: num(sp.get("radius_km")),
    fast_delivery: bool(sp.get("fast_delivery")),
    installment_only: bool(sp.get("installment_only")),
    open_now: bool(sp.get("open_now")),
    sort: (sp.get("sort") as Filters["sort"]) || "relevance",
    limit: Number(sp.get("limit") ?? 20),
    offset: Number(sp.get("offset") ?? 0),
  };
  // Free-text product-name filter (used by /api/shops to filter by product title).
  const q = sp.get("q");
  if (q !== null) (f as any).q = q.slice(0, 256);
  // also allow explicit lat/lon override
  const lat = num(sp.get("lat"));
  const lon = num(sp.get("lon"));
  if (lat !== null && lon !== null && !loc) f.near = [lat, lon];
  return f;
}

export function handleToolError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const isValidation = /invalid|outside|max_price|min_price|budget|items must|sort|too long|too many/i.test(msg);
  if (isValidation) {
    // Validation errors are short, user-facing strings — safe to return.
    return errorJson(msg, 400, "validation_error");
  }
  // For server errors (5xx), do NOT return raw e.message — it can leak the
  // absolute filesystem path of the SQLite DB and DB schema details
  // (better-sqlite3 messages like "unable to open database file:
  // /home/z/my-project/data/torob.sqlite"). Log server-side only.
  console.error("[api] server error:", msg);
  return errorJson("internal_error", 500, "server_error");
}

export { getTools };
