import { getTools, parseFilters, handleToolError, errorJson, json } from "@/lib/torob/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const query = sp.get("q") || "";
    if (query.length > 256) {
      return errorJson("query too long (max 256 chars)", 400, "validation_error");
    }
    const filters = parseFilters(sp);
    const tools = getTools();
    const res = tools.searchProducts(query, filters);
    return json(res);
  } catch (e) {
    return handleToolError(e);
  }
}
