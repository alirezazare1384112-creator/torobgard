import { getTools, handleToolError, errorJson, json } from "@/lib/torob/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !id.startsWith("shop_")) return errorJson("invalid shop_id", 400, "validation_error");
    const sp = new URL(_req.url).searchParams;
    const day = sp.get("day") || undefined;
    const res = getTools().checkShopHours(id, day);
    if (res.status === "not_found") return errorJson("shop not found", 404, "not_found");
    return json(res);
  } catch (e) {
    return handleToolError(e);
  }
}
