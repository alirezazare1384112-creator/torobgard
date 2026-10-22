import { NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { getTools, resolveLocation, NEIGHBORHOODS, type Filters } from "@/lib/torob";
import { buildSystemPrompt } from "@/lib/torob/agent-tools";
import { hasProfanity, sanitizeForModel, sanitizeText } from "@/lib/torob/moderation";
import { parseQuery, normalizeText } from "@/lib/torob/normalize";
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
async function callLLM(zai: Awaited<ReturnType<typeof ZAI.create>>, messages: Msg[], attempts = 3): Promise<string> {
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
      const transient = msg.includes("429") || msg.includes("Too many requests") || msg.includes("timeout");
      if (transient && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 2500 * (i + 1)));
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
      if (c === '"') { inStr = false; out.push(c); continue; }
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

/** Whitelisted session patch from the model's "remember" field. */
function applyRemember(session: ShoppingSession, remember: Record<string, unknown>): ShoppingSession {
  const patch: Partial<ShoppingSession> = {};
  const answers = new Set(session.answersGiven);
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  const category = s(remember.category);
  if (category) patch.category = category;
  const productQuery = s(remember.productQuery);
  if (productQuery) patch.productQuery = productQuery;
  const intendedUse = s(remember.intendedUse);
  if (intendedUse) { patch.intendedUse = intendedUse; answers.add("use"); }
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);
  const budgetMin = n(remember.budgetMin);
  if (budgetMin !== null) { patch.budgetMin = budgetMin; answers.add("budget"); }
  const budgetMax = n(remember.budgetMax);
  if (budgetMax !== null) { patch.budgetMax = budgetMax; answers.add("budget"); }
  const priority = s(remember.priority);
  if (priority) { patch.priority = priority as ShoppingSession["priority"]; answers.add("priority"); }
  const brandPreference = s(remember.brandPreference);
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
    .trim();
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
    switch (name) {
      case "search_products": {
        if (!r || !Array.isArray(r.items)) return null;
        const best = r.items.find((i: any) => typeof i.min_price_toman === "number");
        const q = args.query ? String(args.query) : "";
        return `search_products("${q}") → ${r.total ?? r.items.length} results${best ? `; cheapest: "${best.title}" (${best.product_id}, ${fmtToman(best.min_price_toman)}, ${best.offer_count} offers)` : ""}`;
      }
      case "get_product_details": {
        if (!r || !r.product_id) return null;
        return `get_product_details(${r.product_id}) → "${r.title}" brand=${r.brand ?? "?"} offers=${r.offer_count ?? 0}`;
      }
      case "compare_offers": {
        if (!r || !r.product) return null;
        const s = r.summary;
        const cheapestShop = Array.isArray(r.offers)
          ? r.offers.filter((o: any) => typeof o.price_toman === "number").sort((a: any, b: any) => a.price_toman - b.price_toman)[0]
          : null;
        return `compare_offers(${r.product.product_id}) → ${s?.offer_count ?? 0} offers, min=${fmtToman(s?.min_price_toman)} max=${fmtToman(s?.max_price_toman)}${cheapestShop ? `; cheapest shop: ${cheapestShop.shop?.name} (${cheapestShop.shop?.shop_id})` : ""}`;
      }
      case "find_shops": {
        if (!r || !Array.isArray(r.shops)) return null;
        const first = r.shops[0];
        return `find_shops → ${r.total ?? r.shops.length} shops${first ? `; top: ${first.name} (${first.shop_id}, ${first.matching_offers} offers, ${fmtToman(first.best_price_toman)})` : ""}`;
      }
      case "find_alternatives": {
        if (!r || !Array.isArray(r.alternatives)) return null;
        const first = r.alternatives[0];
        return `find_alternatives(${args.product_id ?? ""}) → ${r.alternatives.length} alternatives${first ? `; cheapest: "${first.title}" (${first.product_id}, ${fmtToman(first.min_price_toman)})` : ""}`;
      }
      case "plan_shopping_trip": {
        if (!r || !Array.isArray(r.plan)) return null;
        const total = r.plan.reduce((a: number, p: any) => a + (p.subtotal_toman ?? 0), 0);
        return `plan_shopping_trip → ${r.plan.length} stops, total≈${fmtToman(total)}`;
      }
      case "check_shop_hours": {
        if (!r || !r.shop_id) return null;
        return `check_shop_hours(${r.shop_id}, ${r.day}) → open_now=${r.open_now} hours=${r.hours ?? "?"}`;
      }
      case "prepare_seller_inquiry": {
        if (!r || !r.shop) return null;
        return `prepare_seller_inquiry(${r.shop.shop_id}, ${r.product?.product_id ?? "?"}) → message drafted`;
      }
      case "record_seller_confirmation": {
        if (!r || !r.record) return null;
        return `record_seller_confirmation(${r.record.shop_id}, ${r.record.product_id}) → ${r.record.status}`;
      }
      default:
        return null;
    }
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
      message: "برای بهترین گزینه‌ای که پیدا کردی، پیشنهاد قیمت فروشگاه‌ها را مقایسه کن",
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

  // Trip planner: only when ≥2 distinct products were surfaced this turn.
  const ids = new Set<string>();
  for (const s of steps) {
    const obs = s.observation as any;
    const list = Array.isArray(obs?.items) ? obs.items : Array.isArray(obs?.alternatives) ? obs.alternatives : [];
    for (const it of list) if (it?.product_id) ids.add(it.product_id);
  }
  if (ids.size >= 2 && !has("plan_shopping_trip")) {
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
  "ماوس", "کیبورد", "لپ‌تاپ", "هدفون", "هدست", "موبایل", "دوربین", "تلویزیون",
  "یخچال", "ماشین لباسشویی", "جاروبرقی", "کفش", "کتونی", "پاور بانک", "پاوربانک",
  "شارژر", "کابل", "رم", "هارد", "مودم", "تبلت", "ساعت هوشمند", "اسپیکر", "پنکه",
];

const USE_VALUES = ["university", "walking", "running", "everyday", "mixed", "office", "gaming", "programming", "calls", "music", "work"];
const PRIORITY_VALUES = ["comfort", "appearance", "durability", "price", "balanced", "precision", "wireless", "mechanical", "quiet", "performance", "portability", "battery", "sound", "noise_cancel"];

function toUnitMult(unit: string | undefined): number {
  if (unit === "میلیارد") return 1_000_000_000;
  if (unit === "میلیون") return 1_000_000;
  if (unit === "هزار") return 1_000;
  return 1;
}

/** Cheap keyword/regex intent extraction that runs before the LLM. Only
 *  matches budgets when a unit or budget keyword is present (the old version
 *  matched bare numbers like «لپ‌تاپ i7» → 7 toman budget). */
function preExtract(message: string, session: ShoppingSession): ShoppingSession {
  const norm = message
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

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

  // Product keyword
  for (const kw of PRODUCT_KEYWORDS) {
    if (message.includes(kw)) {
      session = updateSession(session, { productQuery: kw, category: kw });
      break;
    }
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
]);

/** Progressive query relaxation for the deterministic fallback: try the
 *  cleaned full query first, then keyword+connectivity, then keyword only. */
function fallbackQueryCandidates(message: string): string[] {
  const cleaned = normalizeText(message)
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  const candidates: string[] = [];
  if (cleaned.length) candidates.push(cleaned.join(" "));

  const kw = PRODUCT_KEYWORDS.find((k) => message.includes(k));
  if (kw) {
    const norm = normalizeText(message);
    const hasWireless = /بی\s*سیم|وایرلس|wireless/i.test(norm);
    const hasWired = /با\s*سیم|سیمی|wired/i.test(norm);
    if (hasWireless && !hasWired) candidates.push(`${kw} بی‌سیم`);
    else if (hasWired) candidates.push(`${kw} با سیم`);
    candidates.push(kw);
  }
  return [...new Set(candidates)];
}

function deterministicFallback(message: string, session: ShoppingSession): {
  steps: AgentStep[];
  payload: AgentResponseBody;
} {
  const parsed = parseQuery(message);
  const steps: AgentStep[] = [];

  const candidates = fallbackQueryCandidates(message);
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
    // 0 results relax (drop budget → shorter query) so the user still
    // gets real products instead of an empty answer.
    let result: ReturnType<typeof tools.searchProducts> | null = null;
    let usedQuery = candidates[0];

    for (const cand of candidates) {
      const parsedCand = parseQuery(cand);
      const f: Filters = {
        max_price: parsedCand.maxBudget ?? parsed.maxBudget ?? filters.max_price ?? null,
        min_price: parsedCand.minBudget ?? parsed.minBudget ?? filters.min_price ?? null,
        near: filters.near ? resolveLocation(filters.near) : null,
        installment_only: filters.installment_only,
        sort: (filters.sort as Filters["sort"]) || "relevance",
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
    const reply = count > 0
      ? `${count.toLocaleString("fa-IR")} محصول پیدا شد${cheapest && cheapest.min_price_toman !== null ? ` — ارزان‌ترین: «${cheapest.title}» با قیمت ${cheapest.min_price_toman.toLocaleString("fa-IR")} تومان.` : ""}. برای مقایسهٔ فروشگاه‌ها روی کارت‌ها بزن یا دوباره بپرس.`
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

  // Validate the full request body with Zod (strict: no unknown fields).
  const validated = agentRequestSchema.safeParse(body);
  if (!validated.success) {
    const firstIssue = validated.error.issues[0];
    const msg = firstIssue
      ? `${firstIssue.path.join(".") || "body"}: ${firstIssue.message}`
      : "validation error";
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
  session = preExtract(question, session);

  // Moderation: detect profanity so the loop can (a) show the model a cleaned
  // message (it must never mirror slurs) and (b) remind it to stay polite.
  const userProfane = hasProfanity(question);
  const safeQuestion = userProfane ? sanitizeForModel(question) : question;
  const safeHistory: Msg[] = history.map((m) => ({ role: m.role, content: sanitizeForModel(m.content) }));

  /* ------------------ streaming orchestration ------------------ */

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
            thinking: parsed.thinking ? sanitizeText(parsed.thinking) : null,
            args: { question: cleanQuestion, why: action.why ? sanitizeText(action.why) : null },
            observation: null,
            status: "ok",
          };
          steps.push(step);
          send({ type: "step", step });
          reply = cleanQuestion;
          generative = nextQuestion(session)?.payload ?? null;
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
          thinking: parsed.thinking ? sanitizeText(parsed.thinking) : null,
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
      // LLM unavailable — deterministic fallback (never fabricates data).
      const fb = deterministicFallback(question, session);
      for (const s of fb.steps) send({ type: "step", s });
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
