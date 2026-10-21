import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { getTools, resolveLocation, type Filters } from "@/lib/torob";
import { AGENT_SYSTEM_PROMPT, AGENT_SUMMARY_PROMPT } from "@/lib/torob/agent-tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ToolCall {
  tool: string;
  args: Record<string, any>;
}

function extractJson(text: string): ToolCall | null {
  if (!text) return null;
  // grab the first {...} block (tolerate leading/trailing prose)
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (obj && typeof obj.tool === "string" && typeof obj.args === "object") return obj;
  } catch {
    /* ignore */
  }
  return null;
}

function asFilters(args: Record<string, any>): Filters {
  const nearText = args.near ? resolveLocation(String(args.near)) : null;
  const lat = typeof args.lat === "number" ? args.lat : null;
  const lon = typeof args.lon === "number" ? args.lon : null;
  const near = nearText ?? (lat !== null && lon !== null ? [lat, lon] as [number, number] : null);
  return {
    min_price: typeof args.min_price === "number" ? args.min_price : null,
    max_price: typeof args.max_price === "number" ? args.max_price : null,
    brand: args.brand ? String(args.brand) : null,
    category: args.category ? String(args.category) : null,
    near,
    radius_km: typeof args.radius_km === "number" ? args.radius_km : null,
    fast_delivery: typeof args.fast_delivery === "boolean" ? args.fast_delivery : null,
    installment_only: typeof args.installment_only === "boolean" ? args.installment_only : null,
    open_now: null,
    sort: (args.sort as Filters["sort"]) || "relevance",
    limit: typeof args.limit === "number" ? args.limit : 20,
    offset: typeof args.offset === "number" ? args.offset : 0,
  };
}

function runTool(call: ToolCall): unknown {
  const tools = getTools();
  switch (call.tool) {
    case "search_products":
      return tools.searchProducts(String(call.args.query ?? ""), asFilters(call.args));
    case "get_product_details":
      return tools.getProductDetails(String(call.args.product_id ?? ""));
    case "compare_offers": {
      const f = asFilters(call.args);
      return tools.compareOffers(String(call.args.product_id ?? ""), f);
    }
    case "find_shops":
      return tools.findShops(asFilters(call.args));
    case "find_alternatives":
      return tools.findAlternatives(
        String(call.args.product_id ?? ""),
        typeof call.args.budget === "number" ? call.args.budget : null,
        typeof call.args.limit === "number" ? call.args.limit : 10
      );
    case "plan_shopping_trip": {
      const items = Array.isArray(call.args.items) ? call.args.items : [];
      let start: [number, number] | undefined;
      if (call.args.start && typeof call.args.start === "object") {
        const lat = Number((call.args.start as any).lat);
        const lon = Number((call.args.start as any).lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) start = [lat, lon];
      }
      return tools.planShoppingTrip(items, start, typeof call.args.max_shops === "number" ? call.args.max_shops : 3);
    }
    case "check_shop_hours":
      return tools.checkShopHours(String(call.args.shop_id ?? ""), call.args.day ? String(call.args.day) : undefined);
    case "prepare_seller_inquiry":
      return tools.prepareSellerInquiry({
        shop_id: String(call.args.shop_id ?? ""),
        product_id: String(call.args.product_id ?? ""),
        color: call.args.color ? String(call.args.color) : null,
        size: call.args.size ? String(call.args.size) : null,
        ask_installment: !!call.args.ask_installment,
      });
    case "record_seller_confirmation":
      return tools.recordSellerConfirmation({
        shop_id: String(call.args.shop_id ?? ""),
        product_id: String(call.args.product_id ?? ""),
        status: (call.args.status as any) ?? "unconfirmed",
        confirmed_price_toman: typeof call.args.confirmed_price_toman === "number" ? call.args.confirmed_price_toman : null,
        in_stock: typeof call.args.in_stock === "boolean" ? call.args.in_stock : null,
        note: call.args.note ? String(call.args.note) : null,
      });
    case "ask_user":
      // pseudo-tool: the agent wants to ask the user a clarifying question.
      // We do NOT call any backend tool; the orchestrator returns the question directly.
      return { kind: "ask_user", question: String(call.args.question ?? ""), why: String(call.args.why ?? "") };
    default:
      return { error: `unknown tool: ${call.tool}` };
  }
}

interface Msg { role: "user" | "assistant"; content: string }

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body", code: "validation_error" }, { status: 400 });
  }
  const question = typeof body?.message === "string" ? body.message.trim() : "";
  if (!question) {
    return NextResponse.json({ error: "message is required", code: "validation_error" }, { status: 400 });
  }
  // optional conversation history so the agent can keep context (Phase 1 ask:
  // "don't re-ask answered questions"). Each item {role, content}.
  const history: Msg[] = Array.isArray(body?.history)
    ? body.history.filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    : [];

  try {
    const zai = await ZAI.create();

    // Step 1: ask the model which tool to call, with conversation history.
    const pick = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: AGENT_SYSTEM_PROMPT },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: question },
      ],
      thinking: { type: "disabled" },
    });
    const pickText = pick.choices?.[0]?.message?.content ?? "";
    const call = extractJson(pickText);

    let toolName: string | null = null;
    let toolArgs: Record<string, unknown> = {};
    let toolResult: unknown = null;
    let toolError: string | null = null;

    if (!call) {
      return NextResponse.json({
        reply: pickText.trim() || "متأسفم، نتونستم ابزار مناسبی انتخاب کنم. لطفاً سؤال را دقیق‌تر بپرسید.",
        tool: null,
        tool_args: null,
        tool_result: null,
      });
    }

    toolName = call.tool;
    toolArgs = call.args;
    try {
      toolResult = runTool(call);
    } catch (e) {
      toolError = e instanceof Error ? e.message : String(e);
      toolResult = { error: toolError };
    }

    // If the agent asked the user a clarifying question, short-circuit and return it
    // directly (no second LLM call needed — the question is already Persian).
    if (toolResult && typeof toolResult === "object" && (toolResult as any).kind === "ask_user") {
      const au = toolResult as { kind: string; question: string; why: string };
      return NextResponse.json({
        reply: au.question,
        tool: "ask_user",
        tool_args: toolArgs,
        tool_result: toolResult,
        tool_error: null,
      });
    }

    // Step 2: ask the model for a Persian answer grounded in the tool result.
    const summaryPrompt = AGENT_SUMMARY_PROMPT.replace("{QUESTION}", question)
      .replace("{TOOL}", toolName)
      .replace("{RESULT}", JSON.stringify(toolResult, null, 2).slice(0, 6000));

    const final = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: summaryPrompt },
        { role: "user", content: question },
      ],
      thinking: { type: "disabled" },
    });
    const reply = final.choices?.[0]?.message?.content?.trim() || "";

    return NextResponse.json({
      reply,
      tool: toolName,
      tool_args: toolArgs,
      tool_result: toolResult,
      tool_error: toolError,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), code: "agent_error" },
      { status: 500 }
    );
  }
}
