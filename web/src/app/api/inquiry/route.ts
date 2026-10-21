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
    const shop_id = body?.shop_id;
    const product_id = body?.product_id;
    if (!shop_id || !shop_id.startsWith("shop_")) return errorJson("invalid shop_id", 400, "validation_error");
    if (!product_id || !product_id.startsWith("product_")) return errorJson("invalid product_id", 400, "validation_error");
    const res = getTools().prepareSellerInquiry({
      shop_id,
      product_id,
      color: body.color ?? null,
      size: body.size ?? null,
      ask_installment: !!body.ask_installment,
    });
    if (res.status === "not_found") return errorJson("shop or product not found", 404, "not_found");
    return json(res);
  } catch (e) {
    return handleToolError(e);
  }
}
