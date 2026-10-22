/**
 * Shared types for the multi-step agentic assistant.
 *
 * The agent runs a ReAct-style loop: each LLM step emits a JSON "action"
 * (call a tool, ask the user, or produce the final answer). The server
 * executes the action, feeds a compact observation back to the model, and
 * repeats until a final answer is produced (or the step budget is spent).
 *
 * These types are shared between the API route (server) and the chat UI
 * (client), so they must stay free of both "use client" and server-only
 * imports.
 */

/** Persian display labels for tools — used by the step-trace UI. */
export const TOOL_LABELS: Record<string, string> = {
  search_products: "جست‌وجوی محصولات",
  get_product_details: "جزئیات محصول",
  compare_offers: "مقایسه پیشنهاد فروشگاه‌ها",
  find_shops: "کشف فروشگاه‌ها",
  find_alternatives: "جایگزین‌های هم‌دسته",
  plan_shopping_trip: "برنامه‌ریزی سفر خرید",
  check_shop_hours: "بررسی ساعت کاری",
  prepare_seller_inquiry: "ساخت پیام استعلام",
  record_seller_confirmation: "ثبت تأییدیهٔ فروشنده",
  ask_user: "پرسش از کاربر",
};

export type AgentStepStatus = "running" | "ok" | "error";

/** One executed step of the agent loop, rendered as a "thinking trace". */
export interface AgentStep {
  /** Step index within the turn (0-based). */
  index: number;
  /** Tool name (or "ask_user"). */
  tool: string;
  /** Persian label for the UI. */
  label: string;
  /** The model's short Persian reasoning emitted with this step. */
  thinking?: string | null;
  /** Raw args sent to the tool (displayed in the expandable trace). */
  args?: Record<string, unknown> | null;
  /** Compact observation the model received (displayed in the trace). */
  observation?: unknown;
  status: AgentStepStatus;
  error?: string | null;
  /** One-line Persian summary of this step, used for cross-turn memory. */
  fact?: string | null;
}

/** A suggested follow-up action, rendered as a chip under the reply. */
export interface Suggestion {
  label: string;
  message: string;
}

/** Full response body of POST /api/agent. */
export interface AgentResponseBody {
  reply: string;
  /** Full multi-step trace for this turn. */
  steps?: AgentStep[];
  /** Primary (last data-bearing) tool name — drives inline cards. */
  tool: string | null;
  tool_args: Record<string, unknown> | null;
  tool_result: unknown;
  tool_error: string | null;
  generative?: unknown | null;
  session?: unknown | null;
  suggestions?: Suggestion[];
  fallback?: boolean;
  error?: string;
  code?: string;
}
