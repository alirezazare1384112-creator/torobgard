import { getTools, handleToolError, errorJson, json } from "@/lib/torob/api-helpers";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorJson("invalid JSON body", 400, "validation_error");
    }
    const items = Array.isArray(body?.items) ? body.items : null;
    if (!items || items.length === 0) {
      return errorJson("items must be a non-empty array of {product_id}", 400, "validation_error");
    }
    if (items.length > 20) {
      return errorJson("too many items (max 20)", 400, "validation_error");
    }
    // Validate each product_id up front (defensive — fail before hitting the DB).
    for (const it of items) {
      const pid = it?.product_id;
      if (typeof pid !== "string" || !pid.startsWith("product_")) {
        return errorJson(`invalid product_id in items: ${String(pid)}`, 400, "validation_error");
      }
    }
    const start = parseStart(body?.start);
    const rawMaxShops = Number(body?.max_shops ?? 3);
    if (!Number.isFinite(rawMaxShops) || rawMaxShops < 1) {
      return errorJson("max_shops must be a positive number", 400, "validation_error");
    }
    // Clamp max_shops to [1, 10] — more than 10 stops is not a sensible trip.
    const maxShops = Math.min(Math.trunc(rawMaxShops), 10);
    const tools = getTools();
    const res = tools.planShoppingTrip(items as { product_id: string }[], start, maxShops);
    return json(res);
  } catch (e) {
    return handleToolError(e);
  }
}

function parseStart(start: any): [number, number] | undefined {
  if (!start) return undefined;
  const lat = Number(start.lat ?? start[0]);
  const lon = Number(start.lon ?? start[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return [lat, lon];
}
