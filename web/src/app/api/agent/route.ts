import { NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { getTools, resolveLocation, NEIGHBORHOODS, type Filters } from "@/lib/torob";
import { buildSystemPrompt } from "@/lib/torob/agent-tools";
import { hasProfanity, sanitizeForModel, sanitizeText } from "@/lib/torob/moderation";
import { parseQuery, normalizeText } from "@/lib/torob/normalize";
import { toPersianDigits } from "@/components/torob/format";
import {
  createSession,
  updateSession,
  nextQuestion,
  sessionToFilters,
  type ShoppingSession,
} from "@/lib/torob/session";
import {
  TOOL_LABELS,
  type AgentStep,
  type Suggestion,
  type AgentResponseBody,
} from "@/lib/torob/agent-types";
import type { GenerativePayload } from "@/components/torob/generative-ui";

/**
 * Multi-step agentic shopping assistant (ReAct loop).
 *
 * Each user turn runs up to MAX_STEPS reasoning steps. In every step the LLM
 * emits ONE JSON object: {"thinking", "remember"?, "action"} where action is a
 * tool call, a clarifying question, or the final answer. Tool results are fed
 * back as observations so the model can chain tools (search → compare → trip)
 * before answering — grounded only in the real Torob dataset.
 *
 * The response is an NDJSON stream of events:
 *   {"type":"step","step":AgentStep}   — after each executed tool/question
 *   {"type":"done","payload":...}      — final reply + cards + suggestions
 *   {"type":"error","error":"..."}     — fatal error (client shows fallback UI)
 * With ?stream=0 the route returns a single JSON body instead.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_STEPS = 4;
const LLM_TIMEOUT_MS = 90_000;
const OBSERVATION_CHAR_LIMIT = 6000;

/** Tools whose raw result drives inline chat cards. */
const DATA_TOOLS = new Set([
  "search_products",
  "find_alternatives",
  "compare_offers",
  "find_shops",
]);

interface Msg {
  role: "assistant" | "user";
  content: string;
}

/* ------------------------------------------------------------------ */
/* Request validation (Zod — ported from the security audit)           */
/* ------------------------------------------------------------------ */

const PRIORITY_VALUES = ["comfort", "appearance", "durability", "price", "balanced", "precision", "wireless", "mechanical", "quiet", "performance", "portability", "battery", "sound", "noise_cancel"] as const;

const sessionSchema = z.object({
  category: z.string().max(120).nullable().optional(),
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
  facts: z.array(z.string().max(600)).max(20).nullish(),
  session: sessionSchema.nullish(),
}).strict();

/** Copies Zod-validated session fields onto a fresh session. */
function sessionFromValidated(s: z.infer<typeof sessionSchema> | null | undefined): ShoppingSession {
  const session = createSession();
  if (!s) return session;
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
  return session;
}

interface ParsedAction {
  thinking: string | null;
  remember: Record<string, unknown> | null;
  action:
    | { type: "tool"; name: string; args: Record<string, unknown> }
    | { type: "ask"; question: string; why?: string }
    | { type: "final"; reply: string };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/** LLM call with retry + exponential backoff for transient 429s. */
async function callLLM(zai: Awaited<ReturnType<typeof ZAI.create>>, messages: Msg[], attempts = 4): Promise<string> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const completion = await withTimeout(
        zai.chat.completions.create({ messages, thinking: { type: "disabled" } }),
        LLM_TIMEOUT_MS
      );
      return completion.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      const transient = msg.includes("429") || msg.includes("Too many requests") || msg.includes("timeout") || msg.includes("ECONNRESET") || msg.includes("socket hang up");
      if (transient && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 3500 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/** Robust JSON extraction: strips code fences, finds the first balanced
 *  object, sanitizes raw control characters inside strings (models often
 *  emit literal newlines inside string values, which is invalid JSON), and
 *  validates the action protocol shape. */
function extractAction(text: string): ParsedAction | null {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = t.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  const out: string[] = [];
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) { esc = false; out.push(c); continue; }
      if (c === "\\") { esc = true; out.push(c); continue; }
      if (c === '"') {
        // Is this a REAL closing quote? In valid JSON, a closing quote is
        // followed (after optional whitespace) by ':', ',', '}' or ']'.
        // Otherwise the model emitted an unescaped inner quote (a very common
        // failure, e.g. «دسته محصول "ماوس" و بودجه…») — escape it and keep
        // the string open so JSON.parse still succeeds.
        let j = i + 1;
        while (j < t.length && /\s/.test(t[j])) j++;
        const next = j < t.length ? t[j] : "";
        if (next === "" || next === ":" || next === "," || next === "}" || next === "]") {
          inStr = false;
          out.push(c);
          continue;
        }
        out.push('\\"');
        continue;
      }
      // Escape raw control characters inside strings — models frequently
      // emit literal newlines in "reply" values, breaking JSON.parse.
      if (c === "\n") { out.push("\\n"); continue; }
      if (c === "\r") { out.push("\\r"); continue; }
      if (c === "\t") { out.push("\\t"); continue; }
      out.push(c);
      continue;
    }
    if (c === '"') { inStr = true; out.push(c); continue; }
    if (c === "{") { depth++; out.push(c); continue; }
    if (c === "}") {
      depth--;
      out.push(c);
      if (depth === 0) { end = i; break; }
      continue;
    }
    out.push(c);
  }
  if (end === -1) return null;
  let obj: any;
  try {
    obj = JSON.parse(out.join(""));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const action = obj.action;
  if (!action || typeof action !== "object") return null;
  const thinking = typeof obj.thinking === "string" ? obj.thinking : null;
  const remember =
    obj.remember && typeof obj.remember === "object" && !Array.isArray(obj.remember)
      ? (obj.remember as Record<string, unknown>)
      : null;
  if (action.type === "tool" && typeof action.name === "string" && action.args && typeof action.args === "object") {
    return { thinking, remember, action: { type: "tool", name: action.name, args: action.args as Record<string, unknown> } };
  }
  if (action.type === "ask" && typeof action.question === "string" && action.question.trim()) {
    return { thinking, remember, action: { type: "ask", question: action.question.trim(), why: typeof action.why === "string" ? action.why : undefined } };
  }
  if (action.type === "final" && typeof action.reply === "string" && action.reply.trim()) {
    return { thinking, remember, action: { type: "final", reply: action.reply.trim() } };
  }
  return null;
}

/** Whitelisted session patch from the model's "remember" field.
 *  IMPORTANT: every value is capped/whitelisted so a hallucinated value can
 *  never poison the session and fail the NEXT request's Zod validation
 *  (e.g. priority="foo" or budgetMax=10^15 would 400 the follow-up turn). */
function applyRemember(session: ShoppingSession, remember: Record<string, unknown>): ShoppingSession {
  const patch: Partial<ShoppingSession> = {};
  const answers = new Set(session.answersGiven);
  const cap = (v: string, max: number) => (v.length > max ? v.slice(0, max) : v);
  const s = (v: unknown, max = 120) => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t ? cap(t, max) : null;
  };

  const category = s(remember.category, 120);
  if (category) patch.category = category;
  const productQuery = s(remember.productQuery, 200);
  if (productQuery) patch.productQuery = productQuery;
  const intendedUse = s(remember.intendedUse, 50);
  if (intendedUse) { patch.intendedUse = intendedUse; answers.add("use"); }
  const n = (v: unknown, max = 10_000_000_000) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(0, Math.round(v)), max) : null;
  const budgetMin = n(remember.budgetMin);
  if (budgetMin !== null) { patch.budgetMin = budgetMin; answers.add("budget"); }
  const budgetMax = n(remember.budgetMax);
  if (budgetMax !== null) { patch.budgetMax = budgetMax; answers.add("budget"); }
  const priority = s(remember.priority, 30);
  if (priority && (PRIORITY_VALUES as readonly string[]).includes(priority)) {
    patch.priority = priority as ShoppingSession["priority"];
    answers.add("priority");
  }
  const brandPreference = s(remember.brandPreference, 100);
  if (brandPreference) patch.brandPreference = brandPreference;
  if (typeof remember.installmentOnly === "boolean") {
    patch.installmentOnly = remember.installmentOnly;
    answers.add("installment");
  }
  if (typeof remember.neighborhood === "string") {
    const nb = normalizeNeighborhood(remember.neighborhood);
    if (nb) patch.neighborhood = nb;
  }
  if (answers.size > session.answersGiven.length) patch.answersGiven = [...answers];
  return Object.keys(patch).length ? updateSession(session, patch) : session;
}

function normalizeNeighborhood(input: string): string | null {
  const keys = Object.keys(NEIGHBORHOODS);
  const trimmed = input.trim();
  const exact = keys.find((k) => k === trimmed);
  if (exact) return exact;
  const partial = keys.find((k) => trimmed.includes(k) || k.includes(trimmed));
  return partial ?? null;
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
    open_now: typeof args.open_now === "boolean" ? args.open_now : null,
    sort: (args.sort as Filters["sort"]) || "relevance",
    limit: typeof args.limit === "number" ? Math.min(Math.max(1, Math.round(args.limit)), 20) : 20,
    offset: typeof args.offset === "number" ? args.offset : 0,
  };
}

function cleanReply(s: string): string {
  if (!s) return s;
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/`{1,3}/g, "")
    .trim();
}

/** English tool identifiers → Persian labels so the user-visible "thinking"
 *  trace reads as natural Persian (models like writing tool names in English). */
const TOOL_NAME_FA: Record<string, string> = {
  search_products: "جست‌وجوی محصولات",
  get_product_details: "جزئیات محصول",
  compare_offers: "مقایسهٔ پیشنهادها",
  find_shops: "یافتن فروشگاه‌ها",
  find_alternatives: "یافتن جایگزین‌ها",
  plan_shopping_trip: "برنامه‌ریزی سفر خرید",
  check_shop_hours: "بررسی ساعت کاری",
  prepare_seller_inquiry: "آماده‌سازی پیام فروشنده",
  ask_user: "پرسش از کاربر",
  product_id: "شناسهٔ محصول",
  shop_id: "شناسهٔ فروشگاه",
};

function cleanThinking(s: string): string {
  if (!s) return s;
  let out = s;
  for (const [en, fa] of Object.entries(TOOL_NAME_FA)) {
    out = out.split(en).join(fa);
  }
  return out.trim();
}

function execTool(name: string, args: Record<string, any>): unknown {
  const tools = getTools();
  switch (name) {
    case "search_products":
      return tools.searchProducts(String(args.query ?? ""), asFilters(args));
    case "get_product_details":
      return tools.getProductDetails(String(args.product_id ?? ""));
    case "compare_offers":
      return tools.compareOffers(String(args.product_id ?? ""), asFilters(args));
    case "find_shops":
      return tools.findShops(asFilters(args));
    case "find_alternatives":
      return tools.findAlternatives(
        String(args.product_id ?? ""),
        typeof args.budget === "number" ? args.budget : null,
        typeof args.limit === "number" ? Math.min(args.limit, 8) : 8
      );
    case "plan_shopping_trip": {
      const items = Array.isArray(args.items)
        ? args.items.filter((it: any) => it && typeof it.product_id === "string").map((it: any) => ({ product_id: String(it.product_id) }))
        : [];
      let start: [number, number] | undefined;
      if (args.start && typeof args.start === "object") {
        const lat = Number((args.start as any).lat);
        const lon = Number((args.start as any).lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) start = [lat, lon];
      }
      return tools.planShoppingTrip(items, start, typeof args.max_shops === "number" ? Math.min(args.max_shops, 3) : 3);
    }
    case "check_shop_hours":
      return tools.checkShopHours(String(args.shop_id ?? ""), args.day ? String(args.day) : undefined);
    case "prepare_seller_inquiry":
      return tools.prepareSellerInquiry({
        shop_id: String(args.shop_id ?? ""),
        product_id: String(args.product_id ?? ""),
        color: args.color ? String(args.color) : null,
        size: args.size ? String(args.size) : null,
        ask_installment: !!args.ask_installment,
      });
    case "record_seller_confirmation":
      // SECURITY: the LLM must not be able to manufacture a seller
      // confirmation from its own generated arguments — only the
      // human-controlled /api/confirm endpoint (validates IDs against the DB,
      // explicit user POST) can record one.
      return { error: "record_seller_confirmation is not available to the agent. Confirmations can only be recorded by the user via the dedicated UI." };
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

/* ------------------------------------------------------------------ */
/* Compact observations (fed back to the LLM)                         */
/* ------------------------------------------------------------------ */

function compactResult(name: string, result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as any;
  try {
    switch (name) {
      case "search_products": {
        const items: any[] = Array.isArray(r.items) ? r.items : [];
        return {
          status: r.status,
          total: r.total,
          items: items.slice(0, 8).map((i) => ({
            product_id: i.product_id,
            title: i.title,
            brand: i.brand ?? null,
            category: i.category ?? null,
            min_price_toman: i.min_price_toman ?? null,
            offer_count: i.offer_count,
            nearest_shop_name: i.nearest_shop_name ?? null,
            distance_km: i.distance_km ?? null,
          })),
          note: items.length > 8 ? `(compact: 8 of ${items.length}; total=${r.total})` : undefined,
        };
      }
      case "get_product_details": {
        return {
          product_id: r.product_id,
          title: r.title,
          brand: r.brand ?? null,
          model: r.model ?? null,
          category: r.category ?? null,
          offer_count: r.offer_count,
          specs: Array.isArray(r.specs) ? r.specs.slice(0, 14) : [],
        };
      }
      case "compare_offers": {
        const offers: any[] = Array.isArray(r.offers) ? r.offers : [];
        return {
          status: r.status,
          product: r.product
            ? { product_id: r.product.product_id, title: r.product.title, brand: r.product.brand ?? null }
            : null,
          summary: r.summary ?? null,
          offers: offers.slice(0, 6).map((o) => ({
            offer_id: o.offer_id,
            price_toman: o.price_toman ?? null,
            price_status: o.price_status,
            price_changed_at: o.price_changed_at ?? null,
            shop: o.shop
              ? {
                  shop_id: o.shop.shop_id,
                  name: o.shop.name,
                  location_label: o.shop.location_label ?? null,
                  distance_km: o.shop.distance_km ?? null,
                  has_installment: o.shop.has_installment ?? false,
                  open_now: o.shop.open_now ?? null,
                  today_hours: o.shop.today_hours ?? null,
                  phone: o.shop.contacts?.find((c: any) => c.channel === "phone")?.display_number ?? null,
                }
              : null,
          })),
          note: offers.length > 6 ? `(compact: 6 of ${offers.length} offers)` : undefined,
        };
      }
      case "find_shops": {
        const shops: any[] = Array.isArray(r.shops) ? r.shops : [];
        return {
          status: r.status,
          total: r.total,
          shops: shops.slice(0, 6).map((s) => ({
            shop_id: s.shop_id,
            name: s.name,
            location_label: s.location_label ?? null,
            matching_offers: s.matching_offers,
            best_price_toman: s.best_price_toman ?? null,
            distance_km: s.distance_km ?? null,
            open_now: s.open_now ?? null,
            today_hours: s.today_hours ?? null,
            has_installment: s.has_installment ?? false,
          })),
          note: shops.length > 6 ? `(compact: 6 of ${shops.length}; total=${r.total})` : undefined,
        };
      }
      case "find_alternatives": {
        return {
          status: r.status,
          basis: r.basis ?? null,
          alternatives: Array.isArray(r.alternatives) ? r.alternatives.slice(0, 8) : [],
        };
      }
      case "plan_shopping_trip": {
        return {
          status: r.status,
          assumptions: Array.isArray(r.assumptions) ? r.assumptions : [],
          plan: (Array.isArray(r.plan) ? r.plan : []).map((p: any) => ({
            shop: p.shop
              ? {
                  shop_id: p.shop.shop_id,
                  name: p.shop.name,
                  location_label: p.shop.location_label ?? null,
                  address: p.shop.address ?? null,
                  distance_km: p.shop.distance_km ?? null,
                  today_hours: p.shop.today_hours ?? null,
                }
              : null,
            items: p.items,
            subtotal_toman: p.subtotal_toman,
          })),
          unmatched_product_ids: Array.isArray(r.unmatched_product_ids) ? r.unmatched_product_ids : [],
        };
      }
      default:
        return r; // hours / inquiry / confirmation responses are already small
    }
  } catch {
    return { error: "compact serialization failed", tool: name };
  }
}

/* ------------------------------------------------------------------ */
/* Fact lines (cross-turn memory, shown to the LLM + kept by client)   */
/* ------------------------------------------------------------------ */

function fmtToman(n: number | null | undefined): string {
  return typeof n === "number" ? `${n.toLocaleString("en-US")} toman` : "بدون قیمت";
}

function factLine(name: string, result: unknown, args: Record<string, unknown>): string | null {
  try {
    const r = result as any;
    let line: string | null = null;
    switch (name) {
      case "search_products": {
        if (!r || !Array.isArray(r.items)) return null;
        const best = r.items.find((i: any) => typeof i.min_price_toman === "number");
        const q = args.query ? String(args.query) : "";
        line = `search_products("${q}") → ${r.total ?? r.items.length} results${best ? `; cheapest: "${best.title}" (${best.product_id}, ${fmtToman(best.min_price_toman)}, ${best.offer_count} offers)` : ""}`;
        break;
      }
      case "get_product_details": {
        if (!r || !r.product_id) return null;
        line = `get_product_details(${r.product_id}) → "${r.title}" brand=${r.brand ?? "?"} offers=${r.offer_count ?? 0}`;
        break;
      }
      case "compare_offers": {
        if (!r || !r.product) return null;
        const s = r.summary;
        const cheapestShop = Array.isArray(r.offers)
          ? r.offers.filter((o: any) => typeof o.price_toman === "number").sort((a: any, b: any) => a.price_toman - b.price_toman)[0]
          : null;
        line = `compare_offers(${r.product.product_id}) → ${s?.offer_count ?? 0} offers, min=${fmtToman(s?.min_price_toman)} max=${fmtToman(s?.max_price_toman)}${cheapestShop ? `; cheapest shop: ${cheapestShop.shop?.name} (${cheapestShop.shop?.shop_id})` : ""}`;
        break;
      }
      case "find_shops": {
        if (!r || !Array.isArray(r.shops)) return null;
        const first = r.shops[0];
        line = `find_shops → ${r.total ?? r.shops.length} shops${first ? `; top: ${first.name} (${first.shop_id}, ${first.matching_offers} offers, ${fmtToman(first.best_price_toman)})` : ""}`;
        break;
      }
      case "find_alternatives": {
        if (!r || !Array.isArray(r.alternatives)) return null;
        const first = r.alternatives[0];
        line = `find_alternatives(${args.product_id ?? ""}) → ${r.alternatives.length} alternatives${first ? `; cheapest: "${first.title}" (${first.product_id}, ${fmtToman(first.min_price_toman)})` : ""}`;
        break;
      }
      case "plan_shopping_trip": {
        if (!r || !Array.isArray(r.plan)) return null;
        const total = r.plan.reduce((a: number, p: any) => a + (p.subtotal_toman ?? 0), 0);
        line = `plan_shopping_trip → ${r.plan.length} stops, total≈${fmtToman(total)}`;
        break;
      }
      case "check_shop_hours": {
        if (!r || !r.shop_id) return null;
        // NOTE: r.hours is the FULL weekly JSON blob (easily >600 chars) — never
        // inline it; a fact line must stay compact or the NEXT request 400s
        // on the Zod facts.<=600 cap. Today's hours are the useful memory.
        const th = r.today_hours;
        const today = th ? ` ${th.open}-${th.close}` : "";
        line = `check_shop_hours(${r.shop_id}, ${r.day}) → open_now=${r.open_now}${today}`;
        break;
      }
      case "prepare_seller_inquiry": {
        if (!r || !r.shop) return null;
        line = `prepare_seller_inquiry(${r.shop.shop_id}, ${r.product?.product_id ?? "?"}) → message drafted`;
        break;
      }
      case "record_seller_confirmation": {
        if (!r || !r.record) return null;
        line = `record_seller_confirmation(${r.record.shop_id}, ${r.record.product_id}) → ${r.record.status}`;
        break;
      }
      default:
        line = null;
    }
    // Hard cap: fact lines are memory hints replayed by the client on the
    // next turn (Zod caps them at 600) — never let one grow unbounded.
    if (line && line.length > 500) line = line.slice(0, 500);
    return line;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Proactive suggestion chips (deterministic, based on the trace)      */
/* ------------------------------------------------------------------ */

function buildSuggestions(steps: AgentStep[], session: ShoppingSession): Suggestion[] {
  const out: Suggestion[] = [];
  const names = steps.map((s) => s.tool);
  const has = (t: string) => names.includes(t);
  const lastSearch = [...steps].reverse().find(
    (s) => (s.tool === "search_products" || s.tool === "find_alternatives") && s.status === "ok"
  );
  const lastCompare = [...steps].reverse().find((s) => s.tool === "compare_offers" && s.status === "ok");

  if (lastSearch && !has("compare_offers")) {
    out.push({
      label: "مقایسه قیمت فروشگاه‌ها",
      message: "برای بهترین گزینه‌ای که پیدا کردید، پیشنهاد قیمت فروشگاه‌ها را مقایسه کن",
    });
  }
  if ((lastSearch || lastCompare) && !has("find_alternatives")) {
    out.push({
      label: "جایگزین ارزان‌تر",
      message: "جایگزین‌های ارزان‌تر بهترین گزینه را نشان بده",
    });
  }
  if (lastCompare) {
    if (!has("check_shop_hours")) {
      out.push({ label: "ساعت کاری امروز", message: "ساعت کاری امروز بهترین فروشگاه را چک کن" });
    }
    if (!has("prepare_seller_inquiry")) {
      out.push({ label: "پیام استعلام قیمت", message: "یک پیام آماده برای استعلام قیمت و موجودی امروز از فروشنده بساز" });
    }
  } else if (lastSearch && !session.neighborhood) {
    out.push({ label: "نزدیک‌ترین فروشگاه", message: "نزدیک‌ترین فروشگاه برای خریدش کجاست؟" });
  }

  // Trip planner: only when ≥2 DISTINCT product categories were surfaced this
  // turn (a single "cheapest mouse" answer listing 5 mice is one shopping
  // decision, not a multi-stop trip).
  const ids = new Set<string>();
  const categories = new Set<string>();
  for (const s of steps) {
    const obs = s.observation as any;
    const list = Array.isArray(obs?.items) ? obs.items : Array.isArray(obs?.alternatives) ? obs.alternatives : [];
    for (const it of list) {
      if (it?.product_id) ids.add(it.product_id);
      if (typeof it?.category === "string" && it.category) categories.add(it.category);
    }
  }
  if (ids.size >= 2 && categories.size >= 2 && !has("plan_shopping_trip")) {
    out.push({
      label: "برنامه سفر خرید",
      message: "برای خرید حضوری این محصولات، برنامه سفر خرید بچین",
    });
  }

  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true))).slice(0, 4);
}

/* ------------------------------------------------------------------ */
/* Deterministic pre-extraction (safety net before the LLM loop)       */
/* ------------------------------------------------------------------ */

const PRODUCT_KEYWORDS = [
  "ماوس", "کیبورد", "لپ‌تاپ", "لپتاپ", "هدفون", "هندزفری", "هدست", "موبایل", "گوشی",
  "دوربین", "تلویزیون", "یخچال", "ماشین لباسشویی", "جاروبرقی", "کفش", "کتونی",
  "پاور بانک", "پاوربانک", "شارژر", "کابل", "رم", "هارد", "مودم", "تبلت",
  "ساعت هوشمند", "اسپیکر", "پنکه", "مانیتور", "پرینتر", "کنسول", "پلی استیشن",
];

const USE_VALUES = ["university", "walking", "running", "everyday", "mixed", "office", "gaming", "programming", "calls", "music", "work"];
// PRIORITY_VALUES is declared once, next to the Zod schemas above.

/** Does the message mention a product keyword? Short keywords (≤3 chars,
 *  like «رم») require whole-TOKEN equality — «بخرم» contains the substring «رم»
 *  but must NOT trigger a RAM search. Longer keywords use substring matching. */
function mentionsProductKeyword(message: string): string | null {
  const norm = normalizeText(message);
  const tokens = norm.split(/\s+/).filter(Boolean);
  for (const k of PRODUCT_KEYWORDS) {
    if (k.length <= 3) {
      if (tokens.includes(k)) return k;
    } else if (message.includes(k) || norm.includes(k)) {
      return k;
    }
  }
  return null;
}

/** Bare greetings / thanks / bye — no shopping intent at all. */
const GREETING_RE = /^(سلام|سلام عليكم|درود|هي|hi|hello|salam|سلامم+|صبح بخیر|شب بخیر|خوبی|خوب هستی)[!؟?.،\s]*$/i;
const THANKS_RE = /^(ممنون|مرسی|با تشکر|دمت گرم|توضیع خدمتتون|مرسی از راهنمایی)[!؟?.،\s]*$/i;
const BYE_RE = /^(خداحافظ|خداحفظی|بای|بای بای|فعلاً?|خدانگهدار)[!؟?.،\s]*$/i;

function toUnitMult(unit: string | undefined): number {
  if (unit === "میلیارد") return 1_000_000_000;
  if (unit === "میلیون") return 1_000_000;
  if (unit === "هزار") return 1_000;
  return 1;
}

/** Cheap keyword/regex intent extraction that runs before the LLM. Only
 *  matches budgets when a unit or budget keyword is present (the old version
 *  matched bare numbers like «لپ‌تاپ i7» → 7 toman budget). */
function preExtract(message: string, session: ShoppingSession, history: Msg[]): ShoppingSession {
  const norm = message
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    // thousands separators (fa-IR "۱٬۰۰۰٬۰۰۰" uses U+066C; also plain commas
    // between digit groups) so the toman regexes can see the full number
    .replace(/(\d)[٬٬,](?=\d{3}(?!\d))/g, "$1");

  // 1) Budget ranges with units: «بین ۲ تا ۴ میلیون»
  const rangeUnits = norm.match(/بین\s*(\d+(?:[.,]\d+)?)\s*(?:تا|و|-)\s*(\d+(?:[.,]\d+)?)\s*(میلیارد|میلیون|هزار)/);
  if (rangeUnits) {
    const mult = toUnitMult(rangeUnits[3]);
    const a = Math.round(parseFloat(rangeUnits[1].replace(/,/g, "")) * mult);
    const b = Math.round(parseFloat(rangeUnits[2].replace(/,/g, "")) * mult);
    session = updateSession(session, {
      budgetMin: Math.min(a, b),
      budgetMax: Math.max(a, b),
      answersGiven: [...new Set([...session.answersGiven, "budget"])],
    });
  } else {
    // 2) Single budget with unit: «زیر ۲ میلیون», «تا ۵ میلیون», «۴ میلیون»
    const singleUnit = norm.match(/(?:زیر|تا|حداکثر|سقف|بودجه)?\s*(\d+(?:[.,]\d+)?)\s*(میلیارد|میلیون|هزار)\s*(?:تومان)?/);
    if (singleUnit && (singleUnit[0].includes("زیر") || singleUnit[0].includes("تا") || singleUnit[0].includes("حداکثر") || singleUnit[0].includes("سقف") || singleUnit[0].includes("بودجه") || /(?:زیر|تا|حداکثر|سقف)/.test(norm))) {
      const mult = toUnitMult(singleUnit[2]);
      const amount = Math.round(parseFloat(singleUnit[1].replace(/,/g, "")) * mult);
      if (amount >= 1000) {
        session = updateSession(session, {
          budgetMax: amount,
          answersGiven: [...new Set([...session.answersGiven, "budget"])],
        });
      }
    } else {
      // 3) Raw toman numbers: «بودجه از ۱۰۰۰۰۰۰ تا ۵۰۰۰۰۰۰ تومان», «زیر ۵۰۰۰۰۰ تومان»
      const rawToman = norm.match(/(?:از\s*)?(\d{4,})\s*(?:تا\s*(\d{4,}))?\s*تومان/);
      if (rawToman) {
        const min = parseInt(rawToman[1], 10);
        const max = rawToman[2] ? parseInt(rawToman[2], 10) : null;
        if (max !== null) {
          session = updateSession(session, {
            budgetMin: Math.min(min, max),
            budgetMax: Math.max(min, max),
            answersGiven: [...new Set([...session.answersGiven, "budget"])],
          });
        } else if (/زیر|تا|حداکثر|بودجه|سقف/.test(norm)) {
          session = updateSession(session, {
            budgetMax: min,
            answersGiven: [...new Set([...session.answersGiven, "budget"])],
          });
        }
      }
    }
  }

  // Product keyword (token-aware: «بخرم» must not match the RAM keyword «رم»)
  const kw = mentionsProductKeyword(message);
  if (kw) {
    session = updateSession(session, { productQuery: kw, category: kw });
  }

  // Installment
  if (message.includes("قسطی") || message.includes("اقساط")) {
    session = updateSession(session, {
      installmentOnly: true,
      answersGiven: [...new Set([...session.answersGiven, "installment"])],
    });
  }

  // Neighborhood
  for (const nb of Object.keys(NEIGHBORHOODS)) {
    if (message.includes(nb)) {
      session = updateSession(session, { neighborhood: nb });
      break;
    }
  }

  // Structured answers from the generative UI (raw English values)
  for (const u of USE_VALUES) {
    if (norm.trim() === u || (norm.length <= 40 && norm.includes(u))) {
      session = updateSession(session, { intendedUse: u, answersGiven: [...new Set([...session.answersGiven, "use"])] });
      break;
    }
  }
  for (const p of PRIORITY_VALUES) {
    if (norm.trim() === p || (norm.length <= 40 && norm.includes(p))) {
      session = updateSession(session, { priority: p as ShoppingSession["priority"], answersGiven: [...new Set([...session.answersGiven, "priority"])] });
      break;
    }
  }

  // "رد شد" — mark the current pending question as answered
  if (message.includes("رد شد")) {
    for (const key of ["budget", "use", "priority", "installment"]) {
      if (!session.answersGiven.includes(key)) {
        session = updateSession(session, { answersGiven: [...new Set([...session.answersGiven, key])] });
        break;
      }
    }
  }

  // Bare number answering a pending budget question («۲» after «بودجه چند؟»).
  // Colloquial convention: 1–99 = N میلیون تومان, 100–999 = N هزار تومان,
  // ≥1000 = raw toman. Only applied when a budget question is actually pending
  // (last assistant message asked about budget, or budget is the next open slot).
  const bareNum = norm.trim().match(/^\d{1,7}$/);
  if (bareNum && !session.answersGiven.includes("budget")) {
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
    const budgetAsked = /بودجه|قیمت|میلیون|هزار|تومن|تومان/.test(lastAssistant) || session.productQuery !== null || session.category !== null;
    if (budgetAsked) {
      const v = parseInt(bareNum[0], 10);
      const scaled = v >= 1 && v <= 99 ? v * 1_000_000 : v >= 100 && v <= 999 ? v * 1_000 : v;
      if (scaled >= 10_000) {
        session = updateSession(session, {
          budgetMax: scaled,
          answersGiven: [...new Set([...session.answersGiven, "budget"])],
        });
      }
    }
  }

  // Generative-UI structured answers for the installment question — only BARE
  // answers (the generative card sends exactly "yes"/"no"); «بله یه هدفون
  // می‌خواهم» inside a longer message must NOT flip installmentOnly.
  const bare = norm.trim().toLowerCase();
  const bareMsg = message.trim();
  if (bare === "yes" || bareMsg === "بله" || bareMsg === "بله فقط قسطی") {
    session = updateSession(session, {
      installmentOnly: true,
      answersGiven: [...new Set([...session.answersGiven, "installment"])],
    });
  } else if (bare === "no" || bareMsg === "خیر" || bareMsg === "فرقی نداره") {
    if (!session.answersGiven.includes("installment")) {
      session = updateSession(session, { answersGiven: [...new Set([...session.answersGiven, "installment"])] });
    }
  }

  return session;
}

/* ------------------------------------------------------------------ */
/* Context building                                                    */
/* ------------------------------------------------------------------ */

function buildContext(session: ShoppingSession, facts: string[], userProfane = false): string {
  const lines: string[] = ["حافظهٔ ساختاریافتهٔ خرید کاربر:"];
  if (userProfane) {
    lines.push("- ⚠️ کاربر در همین پیام از الفاظ نامناسب/توهین استفاده کرده است. طبق بخش TONE & SAFETY: مودب و حرفه‌ای بمان، توهین را هرگز بازتاب یا نقل نکن و فقط نیاز خرید را مودبانه دنبال کن.");
  }
  lines.push(`- دسته: ${session.category ?? "نامشخص"}`);
  lines.push(`- عبارت هدف: ${session.productQuery ?? "نامشخص"}`);
  const budget =
    session.budgetMin !== null || session.budgetMax !== null
      ? `${session.budgetMin !== null ? session.budgetMin.toLocaleString("en-US") + " تا " : "تا "}${session.budgetMax !== null ? session.budgetMax.toLocaleString("en-US") : "?"} تومان`
      : "نامشخص";
  lines.push(`- بودجه: ${budget}`);
  lines.push(`- کاربری: ${session.intendedUse ?? "نامشخص"}`);
  lines.push(`- اولویت: ${session.priority ?? "نامشخص"}`);
  lines.push(`- برند ترجیحی: ${session.brandPreference ?? "نامشخص"}`);
  lines.push(`- محله: ${session.neighborhood ?? "نامشخص"}`);
  lines.push(`- فقط قسطی: ${session.installmentOnly ? "بله" : "خیر"}`);
  if (facts.length) {
    lines.push("");
    lines.push("نتایج ابزارهای قبلی این گفتگو (product_id و shop_id ها را برای ارجاع بعدی از همین‌ها بردار):");
    for (const f of facts.slice(-10)) lines.push(`- ${f}`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Deterministic fallback (no LLM)                                     */
/* ------------------------------------------------------------------ */

/** Persian stopwords + verb noise that should never reach the SQL term
 *  matching (all terms are AND-ed, so one noisy token kills the search). */
const STOPWORDS = new Set([
  "رو", "را", "و", "با", "برای", "از", "که", "تا", "هم", "این", "آن", "یک", "یه",
  "پیدا", "کن", "کنم", "بگو", "بگوی", "نشان", "بده", "میخوام", "می‌خوام", "خواهم",
  "می", "داره", "دارن", "باشه", "بود", "است", "هست", "کجا", "بخرم", "خرید", "خریدن",
  "زیر", "حدود", "تومان", "میلیون", "میلیارد", "هزار", "ارزون", "ارزان", "ترین",
  "بهترین", "گران", "قیمت", "چند", "برام", "من", "شما", "لطفا", "ممنون",
  // follow-up question words — pronoun references like «نزدیک‌ترین فروشگاهش کجاست؟»
  // must relax down to the session's remembered productQuery, not search garbage
  "نزدیک", "نزدیکترین", "فروشگاه", "فروشگاهش", "فروشگاهها", "کجاست", "کجاست؟", "چیست",
  "چه", "کدام", "دومی", "اولی", "همون", "همونی", "الان", "دیگه", "باز", "کنید", "کنید",
  "میخواد", "می‌خواد", "میکنی", "می‌کنی", "میتونی", "می‌تونی", "باشه؟", "خب", "دمت",
]);

/** Progressive query relaxation for the deterministic fallback: try the
 *  cleaned full query first, then keyword+connectivity, then keyword only,
 *  then finally the remembered session query (follow-up turns). */
function fallbackQueryCandidates(message: string, session: ShoppingSession): string[] {
  const cleaned = normalizeText(message)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  const candidates: string[] = [];
  if (cleaned.length) candidates.push(cleaned.join(" "));

  const kw = mentionsProductKeyword(message);
  if (kw) {
    const norm = normalizeText(message);
    const hasWireless = /بی\s*سیم|وایرلس|wireless/i.test(norm);
    const hasWired = /با\s*سیم|سیمی|wired/i.test(norm);
    if (hasWireless && !hasWired) candidates.push(`${kw} بی‌سیم`);
    else if (hasWired) candidates.push(`${kw} با سیم`);
    candidates.push(kw);
  }

  // Follow-up turns (pronoun references): relax to the remembered query.
  if (session.productQuery) candidates.push(session.productQuery);
  else if (session.category) candidates.push(session.category);
  return [...new Set(candidates)];
}

/** Last regex capture across the replayed fact lines (cross-turn memory). */
function lastFactCapture(facts: string[], re: RegExp): string | null {
  for (let i = facts.length - 1; i >= 0; i--) {
    const m = facts[i].match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function deterministicFallback(message: string, session: ShoppingSession, facts: string[] = []): {
  steps: AgentStep[];
  payload: AgentResponseBody;
} {
  const parsed = parseQuery(message);
  const steps: AgentStep[] = [];

  /* ---- Follow-up turns without the LLM: reuse product/shop ids from the
   *      fact lines the client replays (cross-turn memory). «نزدیک‌ترین
   *      فروشگاهش کجاست؟» → compare_offers on the last product; «ساعت کاری»
   *      → check_shop_hours on the last shop. ---- */
  const normMsg = normalizeText(message);
  const hasProductKeyword = mentionsProductKeyword(message) !== null;
  const isFollowUp =
    !hasProductKeyword && facts.length > 0 &&
    /نزدیک|فروشگاه|کجا|قیمت|چند|ساعت|باز|بسته|خریدم|همون|دومی|پیشنهاد|مقایسه|جایگزین|ارزان|ارزون/.test(normMsg);

  if (isFollowUp) {
    try {
      const tools = getTools();
      // last product surfaced (search/alternatives/compare facts), last shop
      const lastProductId =
        lastFactCapture(facts, /cheapest: "[^"]+" \((product_[A-Za-z0-9]+)/) ??
        lastFactCapture(facts, /compare_offers\((product_[A-Za-z0-9]+)/) ??
        lastFactCapture(facts, /find_alternatives\((product_[A-Za-z0-9]+)/);
      const lastShopId =
        lastFactCapture(facts, /shop: [^(]+ \((shop_[A-Za-z0-9]+)/) ??
        lastFactCapture(facts, /check_shop_hours\((shop_[A-Za-z0-9]+)/);

      if (lastProductId) {
        // «جایگزین / ارزان‌تر» → find_alternatives on the remembered product
        // (much better than a generic category search).
        if (/جایگزین|ارزان|ارزون/.test(normMsg)) {
          const alt = tools.findAlternatives(lastProductId, session.budgetMax ?? null, 8);
          const alternatives = (alt as any)?.alternatives ?? [];
          if (alternatives.length) {
            steps.push({
              index: 0,
              tool: "find_alternatives",
              label: TOOL_LABELS["find_alternatives"] ?? "یافتن جایگزین‌ها",
              thinking: "یافتن جایگزین‌های ارزان‌تر محصول قبلاً معرفی‌شده (حالت بدون هوش مصنوعی)",
              args: { product_id: lastProductId, budget: session.budgetMax },
              observation: compactResult("find_alternatives", alt),
              status: "ok",
              fact: factLine("find_alternatives", alt, { product_id: lastProductId }),
            });
            const list = alternatives
              .slice(0, 3)
              .map((a: any) => `— «${a.title}»${typeof a.min_price_toman === "number" ? ` با قیمت ${a.min_price_toman.toLocaleString("fa-IR")} تومان` : ""}`)
              .join("\n");
            return {
              steps,
              payload: {
                reply: `جایگزین‌های ارزان‌تر (هم‌دستهٔ محصول قبلاً معرفی‌شده):\n${list}\nقیمت‌ها از دیتاست است و ممکن است قدیمی باشد.`,
                steps,
                tool: "find_alternatives",
                tool_args: { product_id: lastProductId },
                tool_result: alt,
                tool_error: null,
                generative: null,
                session,
                suggestions: [],
                fallback: true,
              },
            };
          }
        }
        const wantsHours = /ساعت|باز|بسته/.test(normMsg) && lastShopId;
        if (wantsHours && lastShopId) {
          const shopName = lastFactCapture(facts, /cheapest shop: (.+?) \(shop_/) ?? "فروشگاه";
          const hours = tools.checkShopHours(lastShopId);
          const th = (hours as any)?.today_hours;
          steps.push({
            index: 0,
            tool: "check_shop_hours",
            label: TOOL_LABELS["check_shop_hours"] ?? "بررسی ساعت کاری",
            thinking: "بررسی ساعت کاری فروشگاه قبلاً معرفی‌شده (حالت بدون هوش مصنوعی)",
            args: { shop_id: lastShopId },
            observation: hours,
            status: "ok",
            fact: factLine("check_shop_hours", hours, { shop_id: lastShopId }),
          });
          const reply = (hours as any)?.open_now === true
            ? `فروشگاه ${shopName} الان باز است — تا ساعت ${toPersianDigits(th?.close ?? "?")} (طبق دادهٔ ثبت‌شده).`
            : (hours as any)?.open_now === false
              ? `فروشگاه ${shopName} الان بسته است — از ساعت ${toPersianDigits(th?.open ?? "?")} باز می‌شود (طبق دادهٔ ثبت‌شده).`
              : "ساعت کاری دقیق در داده‌ها ثبت نشده؛ قبل از مراجعه تلفنی تأیید کنید.";
          return { steps, payload: { reply, steps, tool: "check_shop_hours", tool_args: { shop_id: lastShopId }, tool_result: hours, tool_error: null, generative: null, session, suggestions: [], fallback: true } };
        }
        // nearest-shop / price question → compare offers on the remembered product
        const near = session.neighborhood ? resolveLocation(session.neighborhood) : null;
        const cmp = tools.compareOffers(lastProductId, { near: near ?? undefined, sort: near ? "distance" : "price_asc", limit: 6 } as Filters);
        steps.push({
          index: 0,
          tool: "compare_offers",
          label: TOOL_LABELS["compare_offers"] ?? "مقایسهٔ پیشنهادها",
          thinking: "مقایسهٔ پیشنهادهای محصول قبلاً معرفی‌شده (حالت بدون هوش مصنوعی)",
          args: { product_id: lastProductId },
          observation: compactResult("compare_offers", cmp),
          status: "ok",
          fact: factLine("compare_offers", cmp, { product_id: lastProductId }),
        });
        const offers = (cmp as any)?.offers ?? [];
        if (offers.length) {
          const top = offers
            .filter((o: any) => typeof o.price_toman === "number")
            .slice(0, 3)
            .map((o: any) => `— ${o.shop?.name ?? "فروشگاه"}${o.shop?.location_label ? ` (${o.shop.location_label})` : ""}: ${(o.price_toman as number).toLocaleString("fa-IR")} تومان`)
            .join("\n");
          return {
            steps,
            payload: {
              reply: `پیشنهادهای ثبت‌شده برای «${(cmp as any)?.product?.title ?? "محصول قبلی"}»:\n${top || "— پیشنهادی با قیمت ثبت‌شده نیست."}\nقیمت‌ها از دیتاست است و ممکن است قدیمی باشد؛ قبل از مراجعه تماس بگیرید.`,
              steps,
              tool: "compare_offers",
              tool_args: { product_id: lastProductId },
              tool_result: cmp,
              tool_error: null,
              generative: null,
              session,
              suggestions: [],
              fallback: true,
            },
          };
        }
      }
    } catch {
      // fall through to the plain search path below
    }
  }

  const candidates = fallbackQueryCandidates(message, session);

  // Greeting / thanks / bye with no shopping intent → friendly canned reply
  // (never run a product search for «سلام» — it surfaced «چسب اتوکلاو سلامت…»).
  if (!mentionsProductKeyword(message)) {
    const normTrim = normalizeText(message).trim();
    if (GREETING_RE.test(normTrim)) {
      return {
        steps,
        payload: {
          reply:
            "سلام و خوش‌آمدی! من ترب‌گرد هستم — دستیار خرید حضوری تهران. مثلاً بنویسید: «ارزون‌ترین ماوس بی‌سیم زیر ۱ میلیون» یا «فروشگاه موبایل نزدیک صادقیه که قسطی داره» تا برایتان جست‌وجو و مقایسه کنم.",
          steps,
          tool: null,
          tool_args: null,
          tool_result: null,
          tool_error: null,
          generative: null,
          session,
          suggestions: [],
          fallback: true,
        },
      };
    }
    if (THANKS_RE.test(normTrim)) {
      return {
        steps,
        payload: {
          reply:
            "خواهش می‌کنم! اگر چیز دیگری لازم داشتید — جست‌وجوی محصول، مقایسهٔ قیمت فروشگاه‌ها، برنامهٔ سفر خرید — در خدمت شما هستم.",
          steps,
          tool: null,
          tool_args: null,
          tool_result: null,
          tool_error: null,
          generative: null,
          session,
          suggestions: [],
          fallback: true,
        },
      };
    }
    if (BYE_RE.test(normTrim)) {
      return {
        steps,
        payload: {
          reply: "خدانگهدار! هر وقت خرید جدیدی در ذهن داشتید، اینجا هستم. خرید خوبی داشته باشید!",
          steps,
          tool: null,
          tool_args: null,
          tool_result: null,
          tool_error: null,
          generative: null,
          session,
          suggestions: [],
          fallback: true,
        },
      };
    }
  }
  if (!candidates.length) {
    return {
      steps,
      payload: {
        reply:
          "دستیار هوشمند الان در دسترس نیست، ولی همچنان می‌توانم ساده جست‌وجو کنم. لطفاً نام محصول (مثل «ماوس بی‌سیم») را بنویس، یا از تب «جست‌وجو» استفاده کن.",
        steps,
        tool: null,
        tool_args: null,
        tool_result: null,
        tool_error: null,
        generative: null,
        session,
        suggestions: [],
        fallback: true,
      },
    };
  }

  try {
    const tools = getTools();
    const filters = sessionToFilters(session);

    // Progressive relaxation: try the most specific candidate first; on
    // 0 results relax (drop budget → shorter query → remembered session
    // query) so the user still gets real products instead of an empty answer.
    // «ارزان/ارزون» requests sort by price so the cheapest really surfaces.
    const wantsCheapest = /ارزان|ارزون/i.test(normalizeText(message));
    const fallbackSort: Filters["sort"] = wantsCheapest ? "price_asc" : ((filters.sort as Filters["sort"]) || "relevance");
    let result: ReturnType<typeof tools.searchProducts> | null = null;
    let usedQuery = candidates[0];

    for (const cand of candidates) {
      const parsedCand = parseQuery(cand);
      const f: Filters = {
        max_price: parsedCand.maxBudget ?? parsed.maxBudget ?? filters.max_price ?? null,
        min_price: parsedCand.minBudget ?? parsed.minBudget ?? filters.min_price ?? null,
        near: filters.near ? resolveLocation(filters.near) : null,
        installment_only: filters.installment_only,
        sort: fallbackSort,
        limit: 12,
      };
      const r = tools.searchProducts(cand, f);
      if (r.total > 0) {
        result = r;
        usedQuery = cand;
        break;
      }
      // keep the last attempt for the "no results" message
      result = r;
      usedQuery = cand;
      // relax budget for the next candidate
      parsed.maxBudget = null;
      parsed.minBudget = null;
    }

    const query = usedQuery;
    const result0: NonNullable<typeof result> = result ?? tools.searchProducts(candidates[0], { limit: 12 });
    const fact = factLine("search_products", result0, { query });
    steps.push({
      index: 0,
      tool: "search_products",
      label: TOOL_LABELS["search_products"],
      thinking: candidates.length > 1 && query !== candidates[0]
        ? `اول «${candidates[0]}» جست‌وجو کردم؛ چون نتیجه نداشت عبارت را ساده‌تر کردم به «${query}»`
        : "جست‌وجوی مستقیم در دیتابیس (حالت بدون هوش مصنوعی)",
      args: { query, relaxed: candidates.findIndex((c) => c === query) },
      observation: compactResult("search_products", result0),
      status: "ok",
      fact,
    });

    const updatedSession = updateSession(session, {
      productQuery: query,
      category: parsed.terms.find((t) => PRODUCT_KEYWORDS.includes(t)) ?? query,
      budgetMax: parsed.maxBudget ?? session.budgetMax,
      budgetMin: parsed.minBudget ?? session.budgetMin,
      answersGiven: [...new Set([...session.answersGiven, "budget"])],
    });

    const count = result0.total;
    const cheapest = result0.items.find((i) => i.min_price_toman !== null);
    const usedMemory = candidates.length > 1 && query === candidates[candidates.length - 1] && !!session.productQuery;
    const cheapestLine = cheapest && cheapest.min_price_toman !== null
      ? ` — ارزان‌ترین: «${cheapest.title}» با قیمت ${cheapest.min_price_toman.toLocaleString("fa-IR")} تومان`
      : "";
    const reply = count > 0
      ? usedMemory
        ? `${count.toLocaleString("fa-IR")} محصول برای «${query}» (از حافظهٔ گفتگو) پیدا شد${cheapestLine}. برای مقایسهٔ فروشگاه‌ها روی کارت‌ها بزن یا دوباره بپرس.`
        : `${count.toLocaleString("fa-IR")} محصول پیدا شد${cheapestLine}. برای مقایسهٔ فروشگاه‌ها روی کارت‌ها بزن یا دوباره بپرس.`
      : "نتیجه‌ای پیدا نشد — عبارت را کلیک‌تر یا بدون فیلتر امتحان کن.";

    return {
      steps,
      payload: {
        reply,
        steps,
        tool: "search_products",
        tool_args: { query },
        tool_result: result0,
        tool_error: null,
        generative: null,
        session: updatedSession,
        suggestions: buildSuggestions(steps, updatedSession),
        fallback: true,
      },
    };
  } catch (e) {
    return {
      steps,
      payload: {
        reply: "خطا در جست‌وجو. لطفاً دوباره تلاش کن.",
        steps,
        tool: null,
        tool_args: null,
        tool_result: null,
        tool_error: e instanceof Error ? e.message : String(e),
        generative: null,
        session,
        suggestions: [],
        fallback: true,
      },
    };
  }
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export async function POST(req: Request) {
  const url = new URL(req.url);
  const streamMode = url.searchParams.get("stream") !== "0";

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

  // Tolerance: drop empty/whitespace history entries before strict validation —
  // a client recovering from an interrupted stream may replay an empty bubble,
  // and that must never 400 the whole turn.
  if (body && Array.isArray(body.history)) {
    body.history = body.history.filter(
      (m: unknown) => m && typeof m === "object" && typeof (m as any).content === "string" && (m as any).content.trim().length > 0
    );
  }
  // Tolerance: truncate over-long fact lines (client accumulates raw tool
  // memory; a bulky fact must never 400 the next turn).
  if (body && Array.isArray(body.facts)) {
    body.facts = body.facts
      .filter((f: unknown) => typeof f === "string" && f.trim().length > 0)
      .map((f: string) => (f.length > 600 ? f.slice(0, 600) : f))
      .slice(-10);
  }

  // Validate the full request body with Zod (strict: no unknown fields).
  const validated = agentRequestSchema.safeParse(body);
  if (!validated.success) {
    const firstIssue = validated.error.issues[0];
    const msg = firstIssue
      ? `${firstIssue.path.join(".") || "body"}: ${firstIssue.message}`
      : "validation error";
    console.warn(`[agent 400] ${msg}`);
    return NextResponse.json(
      { error: msg, code: "validation_error" },
      { status: 400 }
    );
  }
  const { message: rawMessage, history: rawHistory, facts: rawFacts } = validated.data;

  const question = rawMessage.trim();
  if (!question) {
    return NextResponse.json(
      { error: "message is required", code: "validation_error" },
      { status: 400 }
    );
  }

  const history: Msg[] = (rawHistory ?? []).map((m) => ({ role: m.role as Msg["role"], content: m.content }));
  const facts: string[] = (rawFacts ?? []).filter((f) => f.trim()).slice(-10);

  let session: ShoppingSession = sessionFromValidated(validated.data.session);

  // Cheap pre-extraction, then the LLM "remember" patches refine/override it.
  session = preExtract(question, session, history);

  // Moderation: detect profanity so the loop can (a) show the model a cleaned
  // message (it must never mirror slurs) and (b) remind it to stay polite.
  const userProfane = hasProfanity(question);
  const safeQuestion = userProfane ? sanitizeForModel(question) : question;
  const safeHistory: Msg[] = history.map((m) => ({ role: m.role, content: sanitizeForModel(m.content) }));

  /* ------------------ streaming orchestration ------------------ */

  /** Attach the deterministic generative card ONLY when its topic actually
   *  matches what the model asked about — otherwise the bubble asks about use
   *  while the card below answers budget (mismatch = confusing double question). */
  function matchingGenerative(session: ShoppingSession, asked: string): GenerativePayload | null {
    const q = nextQuestion(session);
    if (!q) return null;
    const a = asked.replace(/\u200c/g, " ");
    switch (q.key) {
      case "budget":
        return /بودجه|قیمت|چقدر|میلیون|هزار|تومن|تومان/.test(a) ? q.payload : null;
      case "use":
        return /کار|استفاده|برای چی|موقعیت|هدف/.test(a) ? q.payload : null;
      case "priority":
        return /مهم|اولویت|ترجیح|بهتر/.test(a) ? q.payload : null;
      case "installment":
        return /قسط|اقساط/.test(a) ? q.payload : null;
      default:
        return null;
    }
  }

  const runAgent = async (send: (ev: unknown) => void): Promise<AgentResponseBody> => {
    const steps: AgentStep[] = [];
    const rawResults: { tool: string; args: Record<string, unknown>; result: unknown }[] = [];
    let reply = "";
    let generative: GenerativePayload | null = null;

    try {
      const zai = await ZAI.create();
      const context = buildContext(session, facts, userProfane);
      const loopMsgs: Msg[] = [
        { role: "assistant", content: buildSystemPrompt(context) },
        ...safeHistory.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: safeQuestion },
      ];

      let stepIndex = 0;
      let parseFailures = 0;

      for (let iter = 0; iter < MAX_STEPS && !reply; iter++) {
        const text = await callLLM(zai, loopMsgs);
        const parsed = extractAction(text);

        if (!parsed) {
          parseFailures++;
          if (parseFailures >= 2 || !text.trim()) {
            reply = sanitizeText(cleanReply(text)) || "الان نتونستم درست فکر کنم — لطفاً یک بار دیگر بپرس.";
            break;
          }
          loopMsgs.push({ role: "assistant", content: text.slice(0, 400) });
          loopMsgs.push({
            role: "user",
            content: "⚠️ OUTPUT FORMAT ERROR — پاسخ فقط و فقط یک JSON object طبق پروتکل است. دوباره فقط JSON بفرست.",
          });
          continue;
        }
        parseFailures = 0;

        if (parsed.remember) session = applyRemember(session, parsed.remember);

        const action = parsed.action;

        if (action.type === "final") {
          reply = sanitizeText(cleanReply(action.reply));
          break;
        }

        if (action.type === "ask") {
          const cleanQuestion = sanitizeText(action.question);
          const step: AgentStep = {
            index: stepIndex++,
            tool: "ask_user",
            label: TOOL_LABELS["ask_user"] ?? "پرسش از کاربر",
            thinking: parsed.thinking ? sanitizeText(cleanThinking(parsed.thinking)) : null,
            args: { question: cleanQuestion, why: action.why ? sanitizeText(action.why) : null },
            observation: null,
            status: "ok",
          };
          steps.push(step);
          send({ type: "step", step });
          reply = cleanQuestion;
          generative = matchingGenerative(session, cleanQuestion);
          break;
        }

        // Tool call
        let result: unknown = null;
        let error: string | null = null;
        try {
          result = execTool(action.name, action.args);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        const compact = error ? { error } : compactResult(action.name, result);
        const step: AgentStep = {
          index: stepIndex++,
          tool: action.name,
          label: TOOL_LABELS[action.name] ?? action.name,
          thinking: parsed.thinking ? sanitizeText(cleanThinking(parsed.thinking)) : null,
          args: action.args,
          observation: compact,
          status: error ? "error" : "ok",
          error,
          fact: error ? null : factLine(action.name, result, action.args),
        };
        steps.push(step);
        if (!error) rawResults.push({ tool: action.name, args: action.args, result });
        send({ type: "step", step });

        // Feed the observation back for the next reasoning step.
        loopMsgs.push({
          role: "assistant",
          content: JSON.stringify({ thinking: parsed.thinking ?? "", action }),
        });
        loopMsgs.push({
          role: "user",
          content: `[TOOL_RESULT ${action.name}]\n${JSON.stringify(compact).slice(0, OBSERVATION_CHAR_LIMIT)}`,
        });
      }

      // Step budget exhausted without a final answer — force one composition call.
      if (!reply) {
        loopMsgs.push({
          role: "user",
          content: "STEP BUDGET EXHAUSTED — همین حالا action نهایی را بفرست (type=final) و بر اساس نتایج بالا پاسخ فارسی کامل بده.",
        });
        const text = await callLLM(zai, loopMsgs);
        const parsed = extractAction(text);
        reply =
          parsed?.action.type === "final"
            ? sanitizeText(cleanReply(parsed.action.reply))
            : sanitizeText(cleanReply(text)) || "نتونستم پاسخ نهایی را بسازم — لطفاً دوباره بپرس.";
      }

      // Primary card data: last data-bearing tool result.
      const primary = [...rawResults].reverse().find((r) => DATA_TOOLS.has(r.tool));
      const lastErrorStep = [...steps].reverse().find((s) => s.status === "error");

      return {
        reply,
        steps,
        tool: primary?.tool ?? (steps.length ? steps[steps.length - 1].tool : null),
        tool_args: primary?.args ?? null,
        tool_result: primary?.result ?? null,
        tool_error: lastErrorStep?.error ?? null,
        generative,
        session,
        suggestions: buildSuggestions(steps, session),
      } satisfies AgentResponseBody;
    } catch {
      // LLM unavailable mid-loop. Salvage whatever already executed:
      //   1. a data-bearing tool result → compose a grounded reply (keep steps)
      //   2. a check_shop_hours result → compose the hours answer (keep steps)
      //   3. otherwise → facts-aware deterministic fallback (cross-turn memory)
      const dataEntry = [...rawResults].reverse().find((r) => {
        const res = r.result as any;
        return (
          (Array.isArray(res?.items) && res.items.length > 0) ||
          (Array.isArray(res?.offers) && res.offers.length > 0) ||
          (Array.isArray(res?.shops) && res.shops.length > 0) ||
          (Array.isArray(res?.alternatives) && res.alternatives.length > 0)
        );
      });
      if (steps.length && dataEntry) {
        let composed = "ارتباط با هستهٔ هوش مصنوعی قطع شد، ولی نتایجی که تا اینجا گرفتم معتبر است:";
        const r = dataEntry.result as any;
        if (Array.isArray(r?.items) && r.items.length) {
          const best = r.items.find((i: any) => typeof i.min_price_toman === "number");
          composed += best
            ? `\n— ارزان‌ترین «${best.title}» با قیمت ${(best.min_price_toman as number).toLocaleString("fa-IR")} تومان (${best.offer_count} پیشنهاد).`
            : `\n— ${r.total ?? r.items.length} نتیجهٔ دیگر در کارت‌های زیر.`;
        } else if (Array.isArray(r?.offers) && r.offers.length) {
          const withPrice = r.offers.filter((o: any) => typeof o.price_toman === "number");
          const cheapest = [...withPrice].sort((a: any, b: any) => a.price_toman - b.price_toman)[0];
          composed += cheapest
            ? `\n— ارزان‌ترین پیشنهاد: ${(cheapest.price_toman as number).toLocaleString("fa-IR")} تومان در «${cheapest.shop?.name ?? "فروشگاه"}».`
            : "\n— پیشنهادها در کارت‌های زیر.";
        } else if (Array.isArray(r?.shops) && r.shops.length) {
          composed += `\n— ${r.shops.length} فروشگاه مطابق در کارت‌های زیر.`;
        } else if (Array.isArray(r?.alternatives) && r.alternatives.length) {
          const first = r.alternatives[0];
          composed += first
            ? `\n— جایگزین ارزان‌تر: «${first.title}»${typeof first.min_price_toman === "number" ? ` با قیمت ${first.min_price_toman.toLocaleString("fa-IR")} تومان` : ""}.`
            : "\n— جایگزین‌ها در کارت‌های زیر.";
        }
        composed += "\nلطفاً چند لحظه بعد دوباره بپرس تا تحلیل کامل شود.";
        return {
          reply: sanitizeText(composed),
          steps,
          tool: dataEntry.tool,
          tool_args: dataEntry.args,
          tool_result: dataEntry.result,
          tool_error: null,
          generative: null,
          session,
          suggestions: buildSuggestions(steps, session),
        } satisfies AgentResponseBody;
      }
      // A check_shop_hours step already ran before the failure → answer from it.
      const hoursStep = [...steps].reverse().find((s) => s.tool === "check_shop_hours" && s.status === "ok");
      if (hoursStep) {
        const h = hoursStep.observation as any;
        const th = h?.today_hours;
        const shopName = lastFactCapture(facts, /cheapest shop: (.+?) \(shop_/) ?? "فروشگاه";
        const line =
          h?.open_now === true
            ? `«${shopName}» الان باز است — تا ساعت ${toPersianDigits(th?.close ?? "؟")} (طبق دادهٔ ثبت‌شده).`
            : h?.open_now === false
              ? `«${shopName}» الان بسته است — از ساعت ${toPersianDigits(th?.open ?? "؟")} باز می‌شود (طبق دادهٔ ثبت‌شده).`
              : "ساعت کاری دقیق ثبت نشده؛ قبل از مراجعه تلفنی تأیید کنید.";
        return {
          reply: sanitizeText(`ارتباط با هستهٔ هوش مصنوعی قطع شد، ولی نتیجهٔ بررسی معتبر است:\n— ${line}\nلطفاً چند لحظه بعد دوباره بپرس.`),
          steps,
          tool: "check_shop_hours",
          tool_args: hoursStep.args,
          tool_result: h,
          tool_error: null,
          generative: null,
          session,
          suggestions: [],
        } satisfies AgentResponseBody;
      }
      // Nothing usable executed — deterministic fallback (never fabricates data).
      const fb = deterministicFallback(question, session, facts);
      for (const s of fb.steps) send({ type: "step", step: s });
      return fb.payload;
    }
  };

  if (!streamMode) {
    const payload = await runAgent(() => {});
    return NextResponse.json(payload);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          /* client disconnected */
        }
      };
      try {
        const payload = await runAgent(send);
        send({ type: "done", payload });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
