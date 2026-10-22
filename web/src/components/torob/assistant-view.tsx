"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  GitCompareArrows,
  HelpCircle,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Plus,
  Route,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  Wrench,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCart } from "./cart-store";
import { SyntheticNameBadge } from "./disclaimers";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import { GenerativeMessage, type GenerativePayload } from "./generative-ui";
import { createSession, updateSession, type ShoppingSession } from "@/lib/torob/session";
import { sanitizeText } from "@/lib/torob/moderation";
import type { AgentStep, Suggestion } from "@/lib/torob/agent-types";
import { ShopCard } from "./shop-card";
import type { SearchItem, ShopItem } from "./types";

/**
 * Unified "دستیار خرید" view — a multi-step agentic chat.
 *
 * The agent server runs a ReAct loop (search → compare → trip → answer) and
 * streams each executed step to this UI as NDJSON events, so the user watches
 * the assistant think: every tool call, its Persian reasoning, and its result
 * appear live. Inline product cards, shop cards and offer-verify panels render
 * from the last data-bearing tool result; suggestion chips offer the most
 * useful next action.
 */

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tool?: string | null;
  toolArgs?: Record<string, unknown> | null;
  toolResult?: unknown;
  toolError?: string | null;
  generative?: GenerativePayload | null;
  fallback?: boolean;
  steps?: AgentStep[];
  suggestions?: Suggestion[];
  streaming?: boolean;
  /** user's thumbs vote on this assistant reply (one vote per message) */
  vote?: "up" | "down" | null;
  /** network/agent failure bubble — renders a retry button */
  isError?: boolean;
}

const STARTERS = [
  "یه کفش کتونی برای دانشگاه و پیاده‌روی می‌خوام زیر ۴ میلیون",
  "ارزون‌ترین ماوس بی‌سیم زیر ۱ میلیون رو پیدا کن و بگو کجا بخرم",
  "فروشگاه موبایل نزدیک صادقیه که قسطی داره",
  "برنامه خرید ماوس و کیبورد و هدفون",
];

/** Hard cap matching the server's Zod limit (message ≤ 2000 chars) so a long
 *  paste can never 400 the request — the input itself blocks more text. */
const MAX_MESSAGE_LEN = 2000;

/** sessionStorage key for the refresh-safe conversation (chat is per-tab —
 *  a new browser tab starts a fresh conversation, a refresh keeps it). */
const CHAT_STORAGE_KEY = "torobgard:chat:v2";
/** Soft budget for the persisted payload — beyond this, drop older message
 *  payloads instead of throwing on the sessionStorage quota. */
const CHAT_STORAGE_BUDGET = 400_000;

/** Shrinks a step observation for storage: keep small observations verbatim
 *  (they power the expandable trace details), replace bulky ones with a note. */
function smallObservation(obs: unknown): unknown {
  try {
    const s = JSON.stringify(obs);
    if (!s || s.length <= 1400) return obs;
    return { note: "نتیجهٔ کامل این قدم برای صرفه‌جویی در حافظه ذخیره نشد" };
  } catch {
    return null;
  }
}

/** Compacts the conversation for sessionStorage: last 24 non-streaming
 *  messages, card arrays capped at 8 entries, bulky fields dropped. The
 *  rendered cards, suggestion chips, step traces and cross-turn facts all
 *  survive a refresh; only deep expandable detail is lossy-capped. */
function slimForStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => !m.streaming && m.text.trim().length > 0)
    .slice(-24)
    .map((m) => {
      let toolResult: unknown = m.toolResult;
      if (toolResult && typeof toolResult === "object") {
        try {
          const r = { ...(toolResult as Record<string, unknown>) };
          for (const key of ["items", "offers", "shops", "alternatives", "plan"]) {
            const arr = r[key];
            if (Array.isArray(arr)) r[key] = arr.slice(0, 8);
          }
          delete r.full_week; // bulky weekly-hours JSON, unused by chat cards
          if (typeof r.hours === "string" && r.hours.length > 2000) r.hours = null;
          toolResult = r;
        } catch {
          toolResult = null;
        }
      }
      const steps = (m.steps ?? []).map((s) => ({ ...s, observation: smallObservation(s.observation) }));
      return { ...m, streaming: false, toolResult, steps };
    });
}

function trimResult(r: unknown): string {
  try {
    const s = JSON.stringify(r, null, 2);
    if (!s) return "";
    return s.length > 1400 ? s.slice(0, 1400) + "…" : s;
  } catch {
    return String(r);
  }
}

function extractProductItems(r: unknown): SearchItem[] {
  if (!r || typeof r !== "object") return [];
  const obj = r as any;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.alternatives)) {
    return obj.alternatives.map((a: any) => ({ ...a, min_price_toman: a.min_price ?? a.min_price_toman ?? null, image_url: null }));
  }
  return [];
}
function extractOffers(r: unknown): any[] {
  if (!r || typeof r !== "object") return [];
  return Array.isArray((r as any).offers) ? (r as any).offers : [];
}
function extractShops(r: unknown): ShopItem[] {
  if (!r || typeof r !== "object") return [];
  return Array.isArray((r as any).shops) ? (r as any).shops : [];
}

/* ------------------------------------------------------------------ */
/* Step trace — the agent's visible chain of thought                    */
/* ------------------------------------------------------------------ */

function StepIcon({ step }: { step: AgentStep }) {
  if (step.status === "error") return <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />;
  if (step.tool === "ask_user") return <MessageCircle className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />;
  if (step.tool === "plan_shopping_trip") return <Route className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />;
  if (step.tool === "search_products" || step.tool === "find_alternatives") return <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />;
  if (step.tool === "compare_offers") return <GitCompareArrows className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />;
  if (step.tool === "find_shops") return <Store className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />;
  if (step.tool === "check_shop_hours") return <Clock className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />;
  return <Wrench className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />;
}

function StepTrace({ steps, streaming, expanded }: { steps: AgentStep[]; streaming?: boolean; expanded?: boolean }) {
  if (!steps.length) return null;
  const okCount = steps.filter((s) => s.status === "ok").length;
  return (
    <Collapsible defaultOpen={expanded} className="w-full">
      <div className="flex flex-col gap-1.5">
        <ol className="flex flex-col gap-1.5">
          {steps.map((s) => (
            <li key={`${s.index}-${s.tool}`} className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2">
              <StepIcon step={s} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium leading-none">{s.label}</span>
                  <span className="font-mono text-[9px] leading-none text-muted-foreground/70" dir="ltr">{s.tool}</span>
                  {s.status === "ok" && <CheckCircle2 className="size-3 shrink-0 text-emerald-600" aria-hidden />}
                </div>
                {s.thinking && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{s.thinking}</p>
                )}
                {s.status === "error" && s.error && (
                  <p className="text-[11px] leading-relaxed text-destructive">خطا: {s.error}</p>
                )}
                <StepDetails step={s} />
              </div>
            </li>
          ))}
          {streaming && (
            <li className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              در حال فکر کردن به قدم بعدی…
            </li>
          )}
        </ol>
        {!streaming && steps.length > 1 && (
          <p className="pr-1 text-[10px] text-muted-foreground/70">
            {toPersianDigits(okCount)} قدم موفق از {toPersianDigits(steps.length)} قدم
          </p>
        )}
      </div>
    </Collapsible>
  );
}

function StepDetails({ step }: { step: AgentStep }) {
  const [open, setOpen] = React.useState(false);
  if (!step.args && step.observation === null && step.observation === undefined) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground" aria-expanded={open}>
          <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          جزئیات
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {step.args && Object.keys(step.args).length > 0 && (
          <div className="mt-1">
            <p className="mb-0.5 text-[10px] text-muted-foreground">آرگومان‌ها:</p>
            <pre className="scrollbar-thin max-h-32 overflow-auto rounded bg-background p-1.5 text-[10px] font-mono leading-relaxed" dir="ltr">{JSON.stringify(step.args, null, 2)}</pre>
          </div>
        )}
        {step.observation !== null && step.observation !== undefined && (
          <div className="mt-1">
            <p className="mb-0.5 text-[10px] text-muted-foreground">نتیجه (خلاصه):</p>
            <pre className="scrollbar-thin max-h-40 overflow-auto rounded bg-background p-1.5 text-[10px] font-mono leading-relaxed" dir="ltr">{trimResult(step.observation)}</pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Quick reply-copy affordance for finished assistant messages. */
function CopyReplyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label="کپی پاسخ"
      title={copied ? "کپی شد" : "کپی پاسخ"}
      className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

/** Quick "refine preference" chips attached to each product card. */
const REFINE_CHIPS = [
  { label: "ارزان‌تر", msg: "گزینه‌های ارزان‌تر از این نشان بده" },
  { label: "کیفیت بالاتر", msg: "گزینه‌های با کیفیت/برند بهتر نشان بده" },
  { label: "گزینهٔ دیگر", msg: "مدل دیگری از همین دسته نشان بده" },
  { label: "بازنگری", msg: "ترجیحاتم را عوض کنم" },
];

/** A product card in the chat with pick-to-compare + add-to-cart + refine chips. */
function ProductCard({
  p,
  picked,
  onTogglePick,
  onPick,
  onRefine,
}: {
  p: SearchItem;
  picked: boolean;
  onTogglePick: () => void;
  onPick: () => void;
  onRefine: (msg: string) => void;
}) {
  const inCart = useCart((s) => s.items.some((x) => x.product_id === p.product_id));
  const addToCart = useCart((s) => s.add);
  return (
    <div className={`rounded-lg border p-2 transition-colors ${picked ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <button type="button" onClick={onPick} className="flex w-full items-center gap-2 text-right">
        {p.image_url ? (
          <img src={p.image_url} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted"><Package className="size-4 text-muted-foreground" aria-hidden /></span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-xs font-medium leading-snug">{p.title}</span>
          <span className="text-[11px] text-muted-foreground">{p.brand ?? "بدون برند"} • {toPersianDigits(p.offer_count)} پیشنهاد</span>
          <span className="text-[11px] font-semibold text-primary">{p.min_price_toman !== null ? `از ${formatToman(p.min_price_toman)}` : "قیمت نامشخص"}</span>
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Button type="button" variant={picked ? "default" : "outline"} size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={onTogglePick}>
          <GitCompareArrows className="size-3" aria-hidden />{picked ? "در مقایسه" : "مقایسه"}
        </Button>
        <Button
          type="button"
          variant={inCart ? "secondary" : "outline"}
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={inCart}
          onClick={() => addToCart(p)}
        >
          {inCart ? <><Check className="size-3" aria-hidden />اضافه شد</> : <><Plus className="size-3" aria-hidden />برنامهٔ خرید</>}
        </Button>
        {REFINE_CHIPS.map((c) => (
          <button key={c.label} type="button" onClick={() => onRefine(c.msg)} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Verify panel for a shop offer (4 states + copyable inquiry + manual record). */
function VerifyPanel({ offer }: { offer: any }) {
  const shop = offer.shop;
  const shopId = shop?.shop_id;
  const pid = shop?.product_id;
  const [status, setStatus] = React.useState<"unconfirmed" | "pending" | "confirmed" | "no_response" | "unavailable">("unconfirmed");
  const [inquiry, setInquiry] = React.useState<string | null>(null);
  const [loadingInquiry, setLoadingInquiry] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [confirmedPrice, setConfirmedPrice] = React.useState("");
  const [inStock, setInStock] = React.useState<boolean | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savedNote, setSavedNote] = React.useState<string | null>(null);

  const loadInquiry = async () => {
    if (!shopId || !pid) return;
    setLoadingInquiry(true);
    try {
      const r = await fetch("/api/inquiry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop_id: shopId, product_id: pid, ask_installment: true }) });
      const j = await r.json();
      if (j.message) setInquiry(j.message);
    } catch {}
    setLoadingInquiry(false);
  };
  const copy = async () => {
    if (!inquiry) return;
    try { await navigator.clipboard.writeText(inquiry); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  const save = async (s: "confirmed" | "pending" | "no_response" | "unavailable" | "unconfirmed") => {
    if (!shopId || !pid) return;
    setSaving(true);
    try {
      await fetch("/api/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop_id: shopId, product_id: pid, status: s, confirmed_price_toman: confirmedPrice ? Number(confirmedPrice) : null, in_stock: inStock }) });
      setStatus(s);
      setSavedNote(
        s === "confirmed" ? "تأیید شد (همین session)."
        : s === "no_response" ? "بدون پاسخ — جایگزین پیشنهاد می‌شود."
        : s === "unavailable" ? "ناموجود — جایگزین پیشنهاد می‌شود."
        : s === "pending" ? "در انتظار پاسخ فروشنده."
        : "ثبت شد."
      );
    } catch {}
    setSaving(false);
  };

  const phone = shop?.contacts?.find((c: any) => c.channel === "phone")?.display_number;
  const statusBadge = {
    unconfirmed: { label: "قیمت ثبت‌شده (تأییدنشده)", cls: "bg-muted text-muted-foreground" },
    pending: { label: "در انتظار پاسخ", cls: "bg-amber-500/15 text-amber-700" },
    confirmed: { label: "تأیید فروشنده ✓", cls: "bg-emerald-600 text-white" },
    no_response: { label: "پاسخ دریافت نشد", cls: "bg-destructive text-white" },
    unavailable: { label: "ناموجود", cls: "bg-red-500/15 text-red-700" },
  }[status];

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Store className="size-4 text-primary" aria-hidden />
        <span className="line-clamp-1 text-sm font-semibold">{shop?.name}</span>
        <SyntheticNameBadge />
        <Badge className={statusBadge.cls}>{statusBadge.label}</Badge>
        {shop?.has_installment && <Badge title="بر اساس دادهٔ ثبت‌شده — قبل از مراجعه تأیید کنید" className="gap-1 bg-amber-600 text-white"><Clock className="size-3" aria-hidden />اقساط (ثبت‌شده)</Badge>}
      </div>
      {shop?.address && <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground"><MapPin className="mt-0.5 size-3 shrink-0" aria-hidden /><span className="leading-relaxed">{shop.address}</span></p>}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        {offer.price_status === "ok" && offer.price_toman !== null ? <span className="font-num font-semibold text-primary">{formatToman(offer.price_toman)}</span> : <span className="text-muted-foreground">قیمت نامشخص</span>}
        {shop?.distance_km !== null && shop?.distance_km !== undefined && <Badge variant="secondary" className="font-num">{formatDistanceKm(shop.distance_km)}</Badge>}
        {shop?.today_hours && <Badge variant="outline" className="gap-1"><Clock className="size-3" aria-hidden />{shop.open_now === true ? `باز (ثبت‌شده) • تا ${toPersianDigits(shop.today_hours.close)}` : shop.open_now === false ? `بسته (ثبت‌شده) • از ${toPersianDigits(shop.today_hours.open)}` : "ساعت کاری نامشخص"}</Badge>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {phone && <a href={`tel:${phone.replace(/\s/g, "")}`}><Button type="button" variant="default" size="sm" className="h-9 gap-1.5"><Phone className="size-3.5" aria-hidden />تماس: {toPersianDigits(phone)}</Button></a>}
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={loadInquiry} disabled={loadingInquiry || !pid}>{loadingInquiry ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}پیام آماده برای فروشنده</Button>
      </div>
      {inquiry && (
        <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs leading-relaxed">
          <pre className="whitespace-pre-wrap font-sans">{inquiry}</pre>
          <div className="mt-1"><Button type="button" variant="ghost" size="sm" className="h-8 gap-1" onClick={copy}>{copied ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}{copied ? "کپی شد" : "کپی متن"}</Button></div>
        </div>
      )}
      <div className="mt-3 border-t border-border pt-2">
        <p className="mb-1.5 text-xs font-medium">ثبت نتیجهٔ تماس:</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="number" placeholder="قیمت تأییدشده (تومان)" value={confirmedPrice} onChange={(e) => setConfirmedPrice(e.target.value)} className="h-9 w-40 text-xs" />
          <div className="flex gap-1">
            <Button type="button" variant={inStock === true ? "default" : "outline"} size="sm" className="h-9" onClick={() => setInStock(true)}>موجود</Button>
            <Button type="button" variant={inStock === false ? "default" : "outline"} size="sm" className="h-9" onClick={() => setInStock(false)}>ناموجود</Button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button type="button" size="sm" className="h-9 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600" disabled={saving} onClick={() => save("confirmed")}><ShieldCheck className="size-3.5" aria-hidden />تأیید فروشنده</Button>
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={saving} onClick={() => save("pending")}>در انتظار</Button>
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={saving} onClick={() => save("no_response")}>پاسخی نیامد</Button>
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={saving} onClick={() => save("unavailable")}>ناموجود</Button>
        </div>
        {savedNote && <p className="mt-1.5 text-xs text-muted-foreground">{savedNote}</p>}
        <p className="mt-1 text-[11px] text-amber-600">قیمت‌ها ممکن است قدیمی باشند — قبل از مراجعه تماس بگیرید. ثبت‌ها فقط همین نشست نگه‌داری می‌شوند.</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          <AlertCircle className="ml-1 inline size-3 align-middle" aria-hidden />
          ارسال خودکار پیام به فروشنده پیکربندی‌نشده است (not_configured). متن را کپی کن و خودت از طریق تلفن یا پیام‌رسان ارسال کن — ما پیام را جای تو نمی‌فرستیم.
        </p>
      </div>
    </div>
  );
}

export function AssistantView({ onPickProduct }: { onPickProduct?: (id: string) => void }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  // products picked for side-by-side comparison (from chat result cards)
  const [picked, setPicked] = React.useState<Record<string, SearchItem>>({});
  const [compareOpen, setCompareOpen] = React.useState(false);
  // structured session state (persisted across turns)
  const [session, setSession] = React.useState<ShoppingSession | null>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // keep the live message id so stream events can patch it
  const liveIdRef = React.useRef<string | null>(null);
  // synchronous re-entrancy lock: React's setLoading is async, so two rapid
  // chip clicks could both pass the `loading` check and fire two interleaved
  // requests (double bubbles, cross-patched streams). A ref is immediate.
  const busyRef = React.useRef(false);
  // hydration guard: skip the first save effect until the sessionStorage
  // restore has run, otherwise the initial empty render wipes the saved chat.
  const hydratedRef = React.useRef(false);

  // Restore the refresh-safe conversation once on mount (client-only —
  // sessionStorage is not available during SSR, and the initial render
  // must match the server output to avoid hydration mismatches).
  React.useEffect(() => {
    hydratedRef.current = true;
    try {
      const raw = sessionStorage.getItem(CHAT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { messages?: unknown[]; session?: unknown };
        if (Array.isArray(parsed?.messages) && parsed.messages.length) {
          const restored: ChatMessage[] = (parsed.messages as unknown[])
            .filter(
              (m): m is ChatMessage =>
                !!m && typeof (m as ChatMessage).role === "string" &&
                ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
                typeof (m as ChatMessage).text === "string" && (m as ChatMessage).text.trim().length > 0
            )
            .map((m) => ({ ...m, streaming: false, isError: false, vote: m.vote ?? null }));
          if (restored.length) {
            setMessages(restored);
            if (parsed.session && typeof parsed.session === "object") {
              setSession(parsed.session as ShoppingSession);
            }
          }
        }
      }
    } catch {
      /* corrupted storage — start a fresh conversation */
    }
  }, []);

  // Persist after every change (messages/session) — refresh-safe chat.
  React.useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      if (!messages.length) {
        sessionStorage.removeItem(CHAT_STORAGE_KEY);
        return;
      }
      const payload = JSON.stringify({ messages: slimForStorage(messages), session, v: 2 });
      if (payload.length <= CHAT_STORAGE_BUDGET) {
        sessionStorage.setItem(CHAT_STORAGE_KEY, payload);
      } else {
        // over budget: persist without the heavy tool results at all
        const light = slimForStorage(messages).map((m) => ({ ...m, toolResult: null, steps: (m.steps ?? []).map((s) => ({ ...s, observation: null })) }));
        const lightPayload = JSON.stringify({ messages: light, session, v: 2 });
        if (lightPayload.length <= CHAT_STORAGE_BUDGET) sessionStorage.setItem(CHAT_STORAGE_KEY, lightPayload);
        else sessionStorage.removeItem(CHAT_STORAGE_KEY);
      }
    } catch {
      /* quota exceeded — persistence is best-effort, never disturb the chat */
    }
  }, [messages, session]);

  /** Start a fresh conversation (clears messages, session, storage, picks). */
  const clearChat = () => {
    if (loading) return;
    setMessages([]);
    setSession(null);
    setPicked({});
    try {
      sessionStorage.removeItem(CHAT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  /** Retry a failed exchange: drops the error bubble and its user bubble,
   *  then re-sends the same text. */
  const retryMessage = (msgId: string) => {
    if (loading || busyRef.current) return;
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    let userIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        userIdx = i;
        break;
      }
    }
    const retryText = userIdx >= 0 ? messages[userIdx].text : "";
    if (!retryText) return;
    const dropIds = new Set([msgId, ...(userIdx >= 0 ? [messages[userIdx].id] : [])]);
    setMessages((ms) => ms.filter((m) => !dropIds.has(m.id)));
    // wait a tick so the state settles before send() reads `messages` for history
    setTimeout(() => send(retryText), 0);
  };

  /** Thumbs vote on an assistant reply — optimistic UI + fire-and-forget log. */
  const voteOnMessage = (msgId: string, rating: "up" | "down") => {
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    const msg = messages[idx];
    if (msg.vote) return; // one vote per message
    setMessages((ms) => ms.map((m) => (m.id === msgId ? { ...m, vote: rating } : m)));
    let question = "";
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        question = messages[i].text;
        break;
      }
    }
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        question: question.slice(0, 400),
        reply_excerpt: msg.text.slice(0, 600),
        tools: (msg.steps ?? []).map((s) => s.tool).slice(0, 8),
        fallback: msg.fallback ?? false,
      }),
    }).catch(() => {
      /* telemetry is best-effort */
    });
  };

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const patchLive = React.useCallback((patch: Partial<ChatMessage> | ((prev: ChatMessage) => Partial<ChatMessage>)) => {
    const id = liveIdRef.current;
    if (!id) return;
    setMessages((ms) =>
      ms.map((m) => {
        if (m.id !== id) return m;
        const p = typeof patch === "function" ? patch(m) : patch;
        return { ...m, ...p };
      })
    );
  }, []);

  const appendStep = React.useCallback((step: AgentStep) => {
    const id = liveIdRef.current;
    if (!id) return;
    // client-side moderation: the model's "thinking" is rendered on the page
    const safeStep: AgentStep = step.thinking ? { ...step, thinking: sanitizeText(step.thinking) } : step;
    setMessages((ms) =>
      ms.map((m) =>
        m.id === id ? { ...m, steps: [...(m.steps ?? []), safeStep] } : m
      )
    );
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim().slice(0, MAX_MESSAGE_LEN);
    if (!trimmed || loading || busyRef.current) return;
    busyRef.current = true;
    // Heal any stuck streaming placeholder from an interrupted previous turn
    // (e.g. stream died mid-request): give it a graceful text and stop the
    // spinner so it can never leak an empty content into history.
    setMessages((ms) => ms.map((m) =>
      m.streaming
        ? { ...m, streaming: false, text: m.text || "ارتباط قبلی ناتمام ماند — دوباره بپرسید." }
        : m
    ));
    // Defensive: cap each history entry AND never send empty/streaming
    // contents — an empty string would 400 the whole request server-side.
    const history = messages
      .filter((m) => !m.streaming && m.text.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.text.slice(0, 900) }));
    // cross-turn tool memory: one compact fact line per executed step.
    // Hard-capped client-side too: a bulky fact line would 400 the next turn.
    const facts = messages
      .flatMap((m) => (m.steps ?? []).map((s) => s.fact))
      .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      .map((f) => (f.length > 500 ? f.slice(0, 500) : f))
      .slice(-10);

    const liveId = `a-${Date.now()}`;
    liveIdRef.current = liveId;
    setMessages((m) => [
      ...m,
      // display copy is moderated (the raw message still goes to the server
      // so intent detection & regex pre-extraction keep working)
      { id: `u-${Date.now()}`, role: "user", text: sanitizeText(trimmed) },
      { id: liveId, role: "assistant", text: "", steps: [], streaming: true },
    ]);
    setInput("");
    setLoading(true);

    const finalize = (payload: any) => {
      if (payload?.session) setSession(payload.session);
      const rawText = payload?.reply || (payload?.error ? `خطا: ${payload.error}` : "پاسخی دریافت نشد.");
      patchLive({
        text: sanitizeText(rawText),
        tool: payload?.tool ?? null,
        toolArgs: payload?.tool_args ?? null,
        toolResult: payload?.tool_result ?? null,
        toolError: payload?.tool_error ?? null,
        generative: payload?.generative ?? null,
        fallback: payload?.fallback ?? false,
        suggestions: payload?.suggestions ?? [],
        steps: payload?.steps ?? undefined,
        streaming: false,
      });
    };

    try {
      const r = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history, facts, session }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        // non-streaming fallback (?stream=0 or validation error)
        const j = await r.json();
        finalize(j);
      } else {
        // NDJSON event stream
        const reader = r.body?.getReader();
        if (!reader) throw new Error("no response body");
        const decoder = new TextDecoder();
        let buf = "";
        let gotTerminal = false; // done or error event received
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let ev: any;
            try { ev = JSON.parse(line); } catch { continue; }
            if (ev.type === "step" && ev.step) appendStep(ev.step);
            else if (ev.type === "done" && ev.payload) { gotTerminal = true; finalize(ev.payload); }
            else if (ev.type === "error") {
              gotTerminal = true;
              patchLive({ text: sanitizeText(`خطا در دستیار: ${ev.error ?? "نامشخص"}`), streaming: false, isError: true });
            }
          }
        }
        // stream ended without a terminal event → close gracefully
        if (!gotTerminal) {
          patchLive((prev) => (prev.text ? { streaming: false } : { text: "ارتباط قطع شد — لطفاً دوباره بپرس.", streaming: false, isError: true }));
        }
      }
    } catch (e) {
      patchLive({ text: `خطا در ارتباط با دستیار: ${e instanceof Error ? e.message : String(e)}`, streaming: false, isError: true });
    } finally {
      liveIdRef.current = null;
      busyRef.current = false;
      setLoading(false);
    }
  };

  const togglePick = (p: SearchItem) => {
    setPicked((prev) => {
      const next = { ...prev };
      if (next[p.product_id]) delete next[p.product_id];
      else next[p.product_id] = p;
      return next;
    });
  };

  const pick = (id: string) => {
    if (onPickProduct) onPickProduct(id);
    else send(`برای محصول ${id} نزدیک‌ترین فروشگاه‌ها و قیمت‌ها را نشان بده`);
  };

  const pickedList = Object.values(picked);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <Bot className="size-5" aria-hidden />دستیار خرید
            <Badge variant="secondary" className="gap-1"><Sparkles className="size-3" aria-hidden />چندمرحله‌ای</Badge>
          </h2>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              disabled={loading}
              className="flex min-h-9 items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              title="پیام‌ها و حافظهٔ خرید را پاک کن"
            >
              <Trash2 className="size-3.5" aria-hidden />گفتگوی جدید
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          بگو چی می‌خوای — دستیار قدم‌به‌قدم فکر می‌کند (جست‌وجو → مقایسه → پاسخ)، سؤال‌های لازم را می‌پرسد،
          و برای تأیید قیمت/موجودی بهت کمک می‌کند با فروشگاه تماس بگیری. گفتگو با نوسازی صفحه پاک نمی‌شود.
        </p>
      </header>

      {/* compare drawer trigger */}
      {pickedList.length > 0 && (
        <button type="button" onClick={() => setCompareOpen(true)} className="flex items-center gap-2 rounded-full border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15">
          <GitCompareArrows className="size-3.5" aria-hidden />مقایسه {toPersianDigits(pickedList.length)} محصول
        </button>
      )}

      <Card className="flex h-[62vh] min-h-[440px] flex-col gap-0 p-0">
        <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && !loading && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <Sparkles className="size-10 opacity-40" aria-hidden />
              <p className="text-sm">مثلاً بگو: «یه کفش کتونی برای دانشگاه می‌خوام زیر ۴ میلیون»</p>
              <p className="max-w-md text-xs leading-relaxed opacity-70">
                دستیار اول سؤال‌های مهم را می‌پرسد، بعد دیتابیس واقعی ۲۲۵ هزار محصولی را جست‌وجو می‌کند،
                پیشنهاد فروشگاه‌ها را مقایسه می‌کند و در نهایت جواب می‌دهد.
              </p>
            </div>
          )}
          {messages.map((m) => {
            const isDataTool = m.tool === "search_products" || m.tool === "find_alternatives";
            const products = isDataTool ? extractProductItems(m.toolResult) : [];
            const offers = m.tool === "compare_offers" ? extractOffers(m.toolResult) : [];
            const shops = m.tool === "find_shops" ? extractShops(m.toolResult) : [];
            const showThinking = m.streaming && !m.text;
            return (
              <motion.div key={m.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div className={`flex max-w-[88%] items-start gap-2 rounded-2xl px-3 py-2 text-sm leading-relaxed ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                  {m.role === "assistant" && <Bot className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden />}
                  {m.role === "user" && <User className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden />}
                  {showThinking ? (
                    <span className="flex items-center gap-2 py-0.5"><Loader2 className="size-4 animate-spin" aria-hidden /><span className="text-xs">در حال فکر کردن…</span></span>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  )}
                  {m.role === "assistant" && !m.streaming && m.text && <CopyReplyButton text={m.text} />}
                  {m.fallback && !m.streaming && m.role === "assistant" && m.text && (
                    <Badge variant="outline" className="ml-1 shrink-0 self-center text-[9px]">حالت ساده</Badge>
                  )}
                </div>

                {/* live step trace (multi-step reasoning) */}
                {m.role === "assistant" && (m.steps?.length ?? 0) > 0 && (
                  <div className="w-full max-w-[94%]">
                    <StepTrace steps={m.steps ?? []} streaming={m.streaming} expanded={m.streaming} />
                  </div>
                )}

                {products.length > 0 && (
                  <div className="grid w-full max-w-[94%] gap-2 sm:grid-cols-2">
                    {products.slice(0, 6).map((p) => (
                      <ProductCard key={p.product_id} p={p} picked={!!picked[p.product_id]} onTogglePick={() => togglePick(p)} onPick={() => pick(p.product_id)} onRefine={send} />
                    ))}
                    {products.length > 6 && <p className="text-xs text-muted-foreground">و {toPersianDigits(products.length - 6)} نتیجهٔ دیگر…</p>}
                  </div>
                )}

                {offers.length > 0 && (
                  <div className="flex w-full max-w-[94%] flex-col gap-2">
                    {offers.slice(0, 4).map((o) => {
                      const tr = m.toolResult as any;
                      const pid = tr?.product?.product_id;
                      return <VerifyPanel key={o.offer_id} offer={{ ...o, shop: { ...o.shop, product_id: pid } }} />;
                    })}
                    {offers.length > 4 && <p className="text-xs text-muted-foreground">و {toPersianDigits(offers.length - 4)} فروشگاه دیگر…</p>}
                  </div>
                )}

                {shops.length > 0 && (
                  <div className="flex w-full max-w-[94%] flex-col gap-2">
                    {shops.slice(0, 3).map((s) => (
                      <ShopCard key={s.shop_id} shop={s} />
                    ))}
                    {shops.length > 3 && <p className="text-xs text-muted-foreground">و {toPersianDigits(shops.length - 3)} فروشگاه دیگر…</p>}
                  </div>
                )}

                {/* Suggestion chips — the agent's proactive next steps */}
                {m.role === "assistant" && !m.streaming && (m.suggestions?.length ?? 0) > 0 && m.text && (
                  <div className="flex w-full max-w-[94%] flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-muted-foreground">قدم بعدی:</span>
                    {(m.suggestions ?? []).map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        disabled={loading}
                        onClick={() => send(s.message)}
                        title={s.message}
                        className="flex min-h-8 items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2.5 text-[11px] text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Sparkles className="size-3" aria-hidden />
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Retry a failed exchange (network/agent error bubbles) */}
                {m.role === "assistant" && m.isError && !m.streaming && (
                  <button
                    type="button"
                    onClick={() => retryMessage(m.id)}
                    disabled={loading}
                    className="flex min-h-8 items-center gap-1 rounded-full border border-border bg-card px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw className="size-3" aria-hidden />تلاش دوباره
                  </button>
                )}

                {/* Feedback — one thumbs vote per finished assistant reply */}
                {m.role === "assistant" && !m.streaming && !m.isError && m.text && (
                  <div className="flex w-full max-w-[94%] items-center gap-1 pt-0.5" dir="ltr">
                    <span className="text-[10px] text-muted-foreground" dir="rtl">این پاسخ مفید بود؟</span>
                    <button
                      type="button"
                      onClick={() => voteOnMessage(m.id, "up")}
                      disabled={!!m.vote}
                      aria-label="پاسخ خوب بود"
                      aria-pressed={m.vote === "up"}
                      className={`flex size-7 items-center justify-center rounded-full border transition-colors disabled:cursor-default ${
                        m.vote === "up"
                          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-600"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <ThumbsUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => voteOnMessage(m.id, "down")}
                      disabled={!!m.vote}
                      aria-label="پاسخ مفید نبود"
                      aria-pressed={m.vote === "down"}
                      className={`flex size-7 items-center justify-center rounded-full border transition-colors disabled:cursor-default ${
                        m.vote === "down"
                          ? "border-red-500/60 bg-red-500/15 text-red-600"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <ThumbsDown className="size-3.5" aria-hidden />
                    </button>
                    {m.vote && <span className="text-[10px] text-muted-foreground" dir="rtl">{m.vote === "up" ? "ممنون از بازخوردتون" : "ثبت شد؛ بهتر می‌شیم"}</span>}
                  </div>
                )}

                {/* Generative UI: structured question/budget/preference cards */}
                {m.role === "assistant" && !m.streaming && m.generative && (
                  <div className="w-full max-w-[94%]">
                    <GenerativeMessage
                      payload={m.generative}
                      onAnswer={(answer) => {
                        // Convert the structured answer into a chat message
                        if (Array.isArray(answer)) {
                          send(answer.join("، "));
                        } else if (typeof answer === "object" && "min" in answer) {
                          send(`بودجه از ${answer.min.toLocaleString("fa-IR")} تا ${answer.max.toLocaleString("fa-IR")} تومان`);
                        } else {
                          send(String(answer));
                        }
                      }}
                      onSkip={() => send("رد شد")}
                    />
                  </div>
                )}
              </motion.div>
            );
          })}
          {loading && messages[messages.length - 1]?.streaming !== true && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <Bot className="mt-0.5 size-4 shrink-0 opacity-70" aria-hidden />
              <div className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2"><Loader2 className="size-4 animate-spin" aria-hidden /><span>در حال فکر کردن…</span></div>
            </div>
          )}
        </div>

        {messages.length === 0 && (
          <div className="border-t border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">برای شروع:</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="min-h-9 rounded-full border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-accent">{s}</button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2 border-t border-border p-3">
          <div className="flex min-h-11 max-h-32 flex-1 flex-col gap-0.5">
            <Textarea value={input} onChange={(e) => setInput(e.target.value.slice(0, MAX_MESSAGE_LEN))} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} placeholder="بنویس… (Enter برای ارسال)" className="min-h-11 max-h-32 flex-1 resize-none" aria-label="پیام به دستیار" rows={1} maxLength={MAX_MESSAGE_LEN} />
            {input.length > MAX_MESSAGE_LEN - 200 && (
              <p className="text-right text-[10px] text-muted-foreground" dir="ltr">{toPersianDigits(input.length)}/{toPersianDigits(MAX_MESSAGE_LEN)}</p>
            )}
          </div>
          <Button type="submit" size="icon" className="size-11 shrink-0" disabled={loading || !input.trim()}>{loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}<span className="sr-only">ارسال</span></Button>
        </form>
      </Card>

      <p className="text-center text-xs text-muted-foreground">{toPersianDigits(messages.filter(m => m.role === "user").length)} پیام</p>

      {/* Side-by-side compare drawer */}
      {compareOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="مقایسه کنار هم">
          <Card className="max-h-[85vh] w-full max-w-3xl gap-3 overflow-hidden p-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><GitCompareArrows className="size-4" aria-hidden />مقایسه {toPersianDigits(pickedList.length)} محصول</h3>
              <button type="button" onClick={() => setCompareOpen(false)} aria-label="بستن" className="rounded-md p-1 hover:bg-accent"><X className="size-4" aria-hidden /></button>
            </div>
            <div className="scrollbar-thin max-h-[70vh] overflow-y-auto">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {pickedList.map((p) => {
                  const min = pickedList.reduce((m, x) => Math.min(m, x.min_price_toman ?? Infinity), Infinity);
                  const cheapest = p.min_price_toman === min && p.min_price_toman !== null;
                  const maxOffers = pickedList.reduce((m, x) => Math.max(m, x.offer_count), 0);
                  const mostOffers = p.offer_count === maxOffers && maxOffers > 0;
                  return (
                    <div key={p.product_id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
                      <div className="flex items-start gap-2">
                        {p.image_url ? <img src={p.image_url} alt="" className="size-14 shrink-0 rounded-md object-cover" loading="lazy" /> : <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted"><Package className="size-5 text-muted-foreground" aria-hidden /></span>}
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="line-clamp-2 text-sm font-medium leading-snug">{p.title}</span><span className="text-xs text-muted-foreground">{p.brand ?? "بدون برند"}</span></div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {p.min_price_toman !== null ? <Badge variant={cheapest ? "default" : "secondary"} className="font-num">{formatToman(p.min_price_toman)}{cheapest && " • ارزان‌ترین"}</Badge> : <Badge variant="secondary">قیمت نامشخص</Badge>}
                        <Badge variant={mostOffers ? "default" : "outline"} className="font-num">{toPersianDigits(p.offer_count)} پیشنهاد{mostOffers && " • پرپیشنهاد"}</Badge>
                      </div>
                      <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => { setCompareOpen(false); pick(p.product_id); }}>مشاهده و خرید حضوری<ArrowRight className="size-3.5" aria-hidden /></Button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex justify-end"><Button type="button" variant="ghost" size="sm" onClick={() => { setPicked({}); setCompareOpen(false); }}>پاک کردن انتخاب‌ها</Button></div>
          </Card>
        </div>
      )}
    </div>
  );
}
