import { getTools, handleToolError, errorJson, json } from "@/lib/torob/api-helpers";

export const dynamic = "force-dynamic";

const VALID = new Set(["confirmed", "pending", "no_response", "unavailable", "unconfirmed"]);

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return errorJson("invalid JSON body", 400, "validation_error");
    }
    const shop_id = body?.shop_id;
    const product_id = body?.product_id;
    const status = body?.status;
    if (!shop_id || !shop_id.startsWith("shop_")) return errorJson("invalid shop_id", 400, "validation_error");
    if (!product_id || !product_id.startsWith("product_")) return errorJson("invalid product_id", 400, "validation_error");
    if (!VALID.has(status)) return errorJson("status must be confirmed|pending|no_response|unavailable|unconfirmed", 400, "validation_error");
    const res = getTools().recordSellerConfirmation({
      shop_id,
      product_id,
      status,
      confirmed_price_toman: typeof body.confirmed_price_toman === "number" ? body.confirmed_price_toman : null,
      in_stock: typeof body.in_stock === "boolean" ? body.in_stock : null,
      note: typeof body.note === "string" ? body.note : null,
    });
    return json(res);
  } catch (e) {
    return handleToolError(e);
  }
}

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const shop_id = sp.get("shop_id");
    const product_id = sp.get("product_id");
    if (!shop_id || !shop_id.startsWith("shop_")) return errorJson("invalid shop_id", 400, "validation_error");
    if (!product_id || !product_id.startsWith("product_")) return errorJson("invalid product_id", 400, "validation_error");
    const rec = getTools().getConfirmation(shop_id, product_id);
    return json({ status: rec ? "ok" : "none", record: rec });
  } catch (e) {
    return handleToolError(e);
  }
}
