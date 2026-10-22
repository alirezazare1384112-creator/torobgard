import { getTools, handleToolError, errorJson, json } from "@/lib/torob/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || !id.startsWith("product_")) {
      return errorJson("invalid product_id", 400, "validation_error");
    }
    const sp = new URL(req.url).searchParams;
    const budget = sp.get("budget");
    const rawLimit = Number(sp.get("limit") ?? 10);
    if (!Number.isFinite(rawLimit) || rawLimit < 1) {
      return errorJson("limit must be a positive number", 400, "validation_error");
    }
    // Clamp to MAX_LIMIT (100) — same cap as /api/search.
    const limit = Math.min(Math.trunc(rawLimit), 100);
    const rawBudget = budget === null || budget === "" ? null : Number(budget);
    if (rawBudget !== null && (!Number.isFinite(rawBudget) || rawBudget < 0)) {
      return errorJson("budget must be a non-negative number", 400, "validation_error");
    }
    const tools = getTools();
    const res = tools.findAlternatives(id, rawBudget, limit);
    if (res.status === "not_found") return errorJson("product not found", 404, "not_found");
    return json(res);
  } catch (e) {
    return handleToolError(e);
  }
}
