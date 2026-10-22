import { NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { getTools, resolveLocation, type Filters } from "@/lib/torob";
import { AGENT_SYSTEM_PROMPT, AGENT_SUMMARY_PROMPT } from "@/lib/torob/agent-tools";
import { parseQuery } from "@/lib/torob/normalize";
import {
  createSession,
  updateSession,
  nextQuestion,
  sessionToFilters,
  type ShoppingSession,
} from "@/lib/torob/session";
import type { GenerativePayload } from "@/components/torob/generative-ui";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ToolCall {
  tool: string;
  args: Record<string, any>;
}

/** Extended response: now includes `generative` (a typed UI payload the
 *  frontend can render as structured questions/cards) and `session`
 *  (the structured shopping context, persisted client-side). */
interface AgentResponseBody {
  reply: string;
  tool: string | null;
  tool_args: Record<string, unknown> | null;
  tool_result: unknown;
  tool_error: string | null;
  generative?: GenerativePayload | null;
  session?: ShoppingSession | null;
  fallback?: boolean;
  error?: string;
  code?: string;
}

function extractJson(text: string): ToolCall | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (obj && typeof obj.tool === "string" && typeof obj.args === "object")
      return obj;
  } catch {
    /* ignore */
  }
  return null;
}

function asFilters(args: Record<string, any>): Filters {
  const nearText = args.near ? resolveLocation(String(args.near)) : null;
  const lat = typeof args.lat === "number" ? args.lat : null;
  const lon = typeof args.lon === "number" ? args.lon : null;
  const near = nearText ?? (lat !== null && lon !== null ? ([lat, lon] as [number, number]) : null);
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
    // SECURITY: record_seller_confirmation is deliberately NOT callable by the
    // model. The LLM cannot manufacture a seller confirmation. Only the
    // human-controlled /api/confirm endpoint (which validates IDs against the
    // DB and requires an explicit user POST) can record a confirmation.
    // If the model attempts to call it, we refuse with an explicit error.
    case "record_seller_confirmation":
      return { error: "record_seller_confirmation is not available to the agent. Confirmations can only be recorded by the user via the dedicated UI." };
    case "ask_user":
      return { kind: "ask_user", question: String(call.args.question ?? ""), why: String(call.args.why ?? "") };
    default:
      return { error: `unknown tool: ${call.tool}` };
  }
}

// --- Deterministic fallback (no LLM) ---
// When the z-ai SDK is unavailable, we parse the query deterministically and
// run a real searchProducts call so the user still gets real results.
// We never fabricate data.
function deterministicFallback(
  message: string,
  session: ShoppingSession
): AgentResponseBody {
  const parsed = parseQuery(message);
  // Pass the FULL original message as query — searchProducts internally
  // calls parseQuery which handles connectivity + budget extraction.
  // Using only parsed.terms loses the connectivity and budget context.
  let query = message;

  // Fallback to keyword matching if message is too short
  if (!query.trim()) {
    const productKeywords = [
      "ماوس", "کیبورد", "لپ‌تاپ", "هدفون", "موبایل", "دوربین", "تلویزیون",
      "یخچال", "ماشین لباسشویی", "جاروبرقی", "کفش", "کتونی", "پاور بانک",
      "شارژر", "کابل", "رم", "هارد", "مودم", "تبلت", "ساعت",
    ];
    for (const kw of productKeywords) {
      if (message.includes(kw)) {
        query = kw;
        break;
      }
    }
  }

  if (!query) {
    return {
      reply:
        "دستیار هوشمند در حال حاضر در دسترس نیست. اما می‌توانی از تب «جست‌وجو» استفاده کنی تا محصولات را پیدا کنی. لطفاً دوباره تلاش کن.",
      tool: null,
      tool_args: null,
      tool_result: null,
      tool_error: null,
      generative: null,
      session,
      fallback: true,
    };
  }

  // Do a real search with the detected query — use parsed connectivity + budget
  try {
    const tools = getTools();
    const filters = sessionToFilters(session);
    // Merge parsed budget from the query itself (overrides session if present)
    const searchFilters: Filters = {
      max_price: parsed.maxBudget ?? filters.max_price ?? null,
      min_price: parsed.minBudget ?? filters.min_price ?? null,
      near: filters.near ? resolveLocation(filters.near) : null,
      installment_only: filters.installment_only,
      sort: (filters.sort as Filters["sort"]) || "relevance",
      limit: 12,
    };
    const result = tools.searchProducts(query, searchFilters);

    // Only mark "budget" as answered if a budget was actually parsed from the
    // message. Don't blindly add "budget" to answersGiven — that would cause
    // the generative UI to skip the budget question when no budget was stated.
    // Also don't use parsed.terms[0] as category — it could be a non-product
    // word like "من". Keep the category from the main-path keyword extraction.
    const budgetAnswered = parsed.maxBudget !== null || parsed.minBudget !== null;
    const updatedSession = updateSession(session, {
      productQuery: query,
      // Only override category if it's not already set by the main-path
      // keyword extraction (which uses known product keywords, not raw terms).
      ...(session.category ? {} : { category: null }),
      budgetMax: parsed.maxBudget ?? session.budgetMax,
      budgetMin: parsed.minBudget ?? session.budgetMin,
      answersGiven: budgetAnswered
        ? [...new Set([...session.answersGiven, "budget"])]
        : session.answersGiven,
    });

    const count = result.total;
    const cheapest = result.items.find((i) => i.min_price_toman !== null);
    const reply = count > 0
      ? `${count} محصول پیدا شد${
          cheapest && cheapest.min_price_toman !== null
            ? `. ارزان‌ترین: ${cheapest.title} با قیمت ${cheapest.min_price_toman.toLocaleString("fa-IR")} تومان.`
            : ""
        }. برای جزئیات و مقایسه روی محصولات کلیک کن.`
      : `نتیجه‌ای پیدا نشد. عبارت را کلیک‌تر کن.`;

    return {
      reply,
      tool: "search_products",
      tool_args: { query },
      tool_result: result,
      tool_error: null,
      generative: null,
      session: updatedSession,
      fallback: true,
    };
  } catch (e) {
    return {
      reply: "خطا در جست‌وجو. لطفاً دوباره تلاش کن.",
      tool: null,
      tool_args: null,
      tool_result: null,
      tool_error: e instanceof Error ? e.message : String(e),
      generative: null,
      session,
      fallback: true,
    };
  }
}

interface Msg {
  role: "user" | "assistant";
  content: string;
}

// --- Zod schemas for the /api/agent request body (Phase E: input validation) ---

const PRIORITY_VALUES = ["comfort", "appearance", "durability", "price", "balanced", "precision", "wireless", "mechanical", "quiet", "performance", "portability", "battery", "sound", "noise_cancel"] as const;

const sessionSchema = z.object({
  category: z.string().nullable().optional(),
  productQuery: z.string().max(200).nullable().optional(),
  intendedUse: z.string().max(50).nullable().optional(),
  budgetMin: z.number().min(0).max(10_000_000_000).nullable().optional(),
  budgetMax: z.number().min(0).max(10_000_000_000).nullable().optional(),
  priority: z.enum(PRIORITY_VALUES).nullable().optional(),
  style: z.string().max(50).nullable().optional(),
  brandPreference: z.string().max(100).nullable().optional(),
  installmentOnly: z.boolean().optional(),
  neighborhood: z.string().max(100).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  selectedProductIds: z.array(z.string().max(100)).max(50).optional(),
  excludedProductIds: z.array(z.string().max(100)).max(50).optional(),
  answersGiven: z.array(z.string().max(30)).max(20).optional(),
  // Server-managed fields — accepted from client (for round-trip) but
  // overwritten server-side in updateSession. Validated as strings for safety.
  createdAt: z.string().max(50).optional(),
  updatedAt: z.string().max(50).optional(),
}).strict();

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(5000),
}).strict();

const agentRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(historyMessageSchema).max(10).nullish(),
  session: sessionSchema.nullish(),
}).strict();

export async function POST(req: Request) {
  // Cap request body size at 64KB to prevent oversized payloads.
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 65536) {
    return NextResponse.json(
      { error: "request body too large (max 64KB)", code: "validation_error" },
      { status: 413 }
    );
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", code: "validation_error" },
      { status: 400 }
    );
  }

  // Validate the full request body with Zod.
  const parsed = agentRequestSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const msg = firstIssue
      ? `${firstIssue.path.join(".") || "body"}: ${firstIssue.message}`
      : "validation error";
    return NextResponse.json(
      { error: msg, code: "validation_error" },
      { status: 400 }
    );
  }
  const { message: rawMessage, history: rawHistory, session: rawSession } = parsed.data;

  const question = rawMessage.trim();
  if (!question) {
    return NextResponse.json(
      { error: "message is required", code: "validation_error" },
      { status: 400 }
    );
  }

  const history: Msg[] = (rawHistory ?? []).map((m) => ({ role: m.role, content: m.content }));

  // Session state (persisted client-side, sent back each turn).
  // Zod already validated the shape; copy validated fields into a fresh session.
  let session: ShoppingSession = createSession();
  if (rawSession) {
    const s = rawSession;
    session.category = s.category ?? null;
    session.productQuery = s.productQuery ?? null;
    session.intendedUse = s.intendedUse ?? null;
    session.budgetMin = s.budgetMin ?? null;
    session.budgetMax = s.budgetMax ?? null;
    session.priority = (s.priority as ShoppingSession["priority"]) ?? null;
    session.style = s.style ?? null;
    session.brandPreference = s.brandPreference ?? null;
    session.installmentOnly = s.installmentOnly ?? false;
    session.neighborhood = s.neighborhood ?? null;
    session.lat = s.lat ?? null;
    session.lon = s.lon ?? null;
    session.selectedProductIds = s.selectedProductIds ?? [];
    session.excludedProductIds = s.excludedProductIds ?? [];
    session.answersGiven = s.answersGiven ?? [];
  }

  // Update session from the user's message (simple keyword extraction)
  // Budget: look for numbers + میلیون/هزار/میلیارد (also normalize Persian digits first)
  // Budget extraction — use the SHARED, TESTED parseQuery from normalize.ts.
  // This is the same parser the fallback path and searchProducts use, so the
  // LLM path and fallback path apply identical budget logic.
  // CRITICAL: parseQuery only extracts a budget when there is a CLEAR money
  // signal (زیر|تا|حداکثر|بیشتر از|کمتر از|بین + a number + optional unit, OR
  // English under/below/up to + number + optional unit). A bare number like
  // "20" in "من 20 سالمه" or "مدل 17" has NO money signal → maxBudget stays null.
  // This prevents age, model numbers, and other unrelated numbers from being
  // mistaken for a budget (P0 fix).
  const parsedQuery = parseQuery(question);
  if (parsedQuery.maxBudget !== null || parsedQuery.minBudget !== null) {
    const patch: Partial<ShoppingSession> = {
      answersGiven: [...new Set([...session.answersGiven, "budget"])],
    };
    if (parsedQuery.maxBudget !== null) patch.budgetMax = parsedQuery.maxBudget;
    if (parsedQuery.minBudget !== null) patch.budgetMin = parsedQuery.minBudget;
    session = updateSession(session, patch);
  }
  // If no budget was parsed, do NOT mark "budget" as answered — the generative
  // UI will ask for it in a later turn.

  // Product query: extract known product keywords
  const productKeywords = [
    "ماوس", "کیبورد", "لپ‌تاپ", "هدفون", "موبایل", "دوربین", "تلویزیون",
    "یخچال", "ماشین لباسشویی", "جاروبرقی", "کفش", "کتونی", "پاور بانک",
    "شارژر", "کابل", "رم", "هارد", "مودم", "تبلت", "ساعت",
  ];
  for (const kw of productKeywords) {
    if (question.includes(kw)) {
      session = updateSession(session, {
        productQuery: kw,
        category: kw,
      });
      break;
    }
  }

  // Installment
  if (question.includes("قسطی") || question.includes("اقساط")) {
    session = updateSession(session, { installmentOnly: true, answersGiven: [...new Set([...session.answersGiven, "installment"])] });
  }

  // Neighborhood
  const neighborhoods = ["صادقیه", "ولنجک", "ونک", "میدان ولیعصر", "تجریش", "شریعتی"];
  for (const nb of neighborhoods) {
    if (question.includes(nb)) {
      session = updateSession(session, { neighborhood: nb });
      break;
    }
  }

  // Detect use-type answers (from generative UI selections)
  // Normalize Persian/Arabic digits to Latin for matching English use-type values.
  const normalizedQ = question
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const useValues = ["university", "walking", "running", "everyday", "mixed", "office", "gaming", "programming", "calls", "music", "work"];
  for (const u of useValues) {
    if (normalizedQ === u || normalizedQ.includes(u)) {
      session = updateSession(session, { intendedUse: u, answersGiven: [...new Set([...session.answersGiven, "use"])] });
      break;
    }
  }

  // Detect priority answers (from generative UI selections)
  const priorityValues = ["comfort", "appearance", "durability", "price", "balanced", "precision", "wireless", "mechanical", "quiet", "performance", "portability", "battery", "sound", "noise_cancel"];
  for (const p of priorityValues) {
    if (normalizedQ === p || normalizedQ.includes(p)) {
      session = updateSession(session, { priority: p as any, answersGiven: [...new Set([...session.answersGiven, "priority"])] });
      break;
    }
  }

  // Detect "رد شد" (skip) — mark the current question as answered
  if (question === "رد شد" || question.includes("رد شد")) {
    // Don't set any value, but mark whatever question was pending as answered.
    // We check which question is pending and mark it as answered.
    if (!session.answersGiven.includes("budget")) {
      session = updateSession(session, { answersGiven: [...new Set([...session.answersGiven, "budget"])] });
    } else if (!session.answersGiven.includes("use")) {
      session = updateSession(session, { answersGiven: [...new Set([...session.answersGiven, "use"])] });
    } else if (!session.answersGiven.includes("priority")) {
      session = updateSession(session, { answersGiven: [...new Set([...session.answersGiven, "priority"])] });
    } else if (!session.answersGiven.includes("installment")) {
      session = updateSession(session, { answersGiven: [...new Set([...session.answersGiven, "installment"])] });
    }
  }

  try {
    const zai = await ZAI.create();

    // Step 1: ask the model which tool to call, with conversation history + session context.
    const sessionContext = `\n\n[Session context: category=${session.category ?? "?"}, budget_max=${session.budgetMax ?? "?"}, priority=${session.priority ?? "?"}, use=${session.intendedUse ?? "?"}, installment=${session.installmentOnly}, near=${session.neighborhood ?? "?"}]`;

    const pick = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: AGENT_SYSTEM_PROMPT + sessionContext },
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
      // Model didn't emit a tool call — return its text as-is (or a fallback)
      return NextResponse.json({
        reply: pickText.trim() || "متأسفم، نتونستم ابزار مناسبی انتخاب کنم. لطفاً سؤال را دقیق‌تر بپرسید.",
        tool: null,
        tool_args: null,
        tool_result: null,
        tool_error: null,
        generative: null,
        session,
      } satisfies AgentResponseBody);
    }

    toolName = call.tool;
    toolArgs = call.args;
    try {
      toolResult = runTool(call);
    } catch (e) {
      toolError = e instanceof Error ? e.message : String(e);
      toolResult = { error: toolError };
    }

    // If the agent asked a clarifying question, return it + a generative payload
    if (toolResult && typeof toolResult === "object" && (toolResult as any).kind === "ask_user") {
      const au = toolResult as { kind: string; question: string; why: string };
      // Also generate a structured question if the session has a next question
      const next = nextQuestion(session);
      return NextResponse.json({
        reply: au.question,
        tool: "ask_user",
        tool_args: toolArgs,
        tool_result: toolResult,
        tool_error: null,
        generative: next?.payload ?? null,
        session,
      } satisfies AgentResponseBody);
    }

    // Step 2: ask the model for a Persian answer grounded in the tool result.
    const summaryPrompt = AGENT_SUMMARY_PROMPT.replace("{QUESTION}", question)
      .replace("{TOOL}", String(toolName))
      .replace("{RESULT}", JSON.stringify(toolResult, null, 2).slice(0, 6000));

    const final = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: summaryPrompt },
        { role: "user", content: question },
      ],
      thinking: { type: "disabled" },
    });
    const reply = final.choices?.[0]?.message?.content?.trim() || "";

    // Check if there's a next structured question to show
    const next = nextQuestion(session);

    return NextResponse.json({
      reply,
      tool: toolName,
      tool_args: toolArgs,
      tool_result: toolResult,
      tool_error: toolError,
      generative: next?.payload ?? null,
      session,
    } satisfies AgentResponseBody);
  } catch (e) {
    // LLM unavailable — fall back to deterministic parsing
    const fallbackResult = deterministicFallback(question, session);
    return NextResponse.json(fallbackResult satisfies AgentResponseBody);
  }
}
