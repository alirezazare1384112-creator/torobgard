"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  GitCompareArrows,
  Layers,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatToman, toPersianDigits } from "./format";
import type { SearchItem, SearchResponse } from "./types";

/**
 * "Explore / Model picker" view for users who don't yet know which model suits them.
 *
 * Flow:
 *   1. user types what they want in natural language (e.g. "کفش کتونی برای دویدن")
 *   2. we search products in that category
 *   3. we show a side-by-side comparison of the top picks (title, brand, price,
 *      offer_count, image) so the user can compare
 *   4. an optional "دستیار توصیه" panel asks the LLM to recommend based on the
 *      user's stated need + the top picks, grounded in real dataset products.
 *
 * The LLM call goes through /api/agent (server-side) and never exposes the SDK
 * to the client.
 */

const EXAMPLE_NEEDS = [
  "ماوس بی‌سیم برای کار اداری",
  "هدفون برای تماس‌های طولانی",
  "لپ‌تاپ سبک برای دانشجو",
  "کیبورد مکانیکی برای برنامه‌نویسی",
];

export function ExploreView({ onPickProduct }: { onPickProduct: (id: string) => void }) {
  const [need, setNeed] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<SearchItem[] | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [effectiveQuery, setEffectiveQuery] = React.useState<string>("");

  // LLM recommendation
  const [asking, setAsking] = React.useState(false);
  const [recommendation, setRecommendation] = React.useState<string | null>(null);
  const [recError, setRecError] = React.useState<string | null>(null);

  // Persian stop-words that users naturally add but won't appear in product titles.
  const STOP = new Set([
    "برای", "کار", "و", "با", "از", "که", "را", "هم", "یک", "به", "در", "می", "خوب", "سبک", "ارزان",
    "مناسب", "استفاده", "کردن", "باشه", "باشیم", "بخواهم", "میخوام", "می‌خوام", "لاتین",
  ]);

  const runSearch = (q: string) => {
    if (!q.trim()) return;
    setError(null);
    setItems(null);
    setSelectedIds(new Set());
    setRecommendation(null);
    setLoading(true);
    // Try the full query first; if it yields nothing, progressively drop stop-words
    // and then keep only the first 2 content tokens so a natural-language need
    // ("ماوس بی‌سیم برای کار اداری") still finds matching products.
    const tokens = q.trim().split(/\s+/);
    const attempts: string[] = [q.trim()];
    const noStop = tokens.filter((t) => !STOP.has(t));
    if (noStop.length && noStop.join(" ") !== q.trim()) attempts.push(noStop.join(" "));
    if (noStop.length > 2) attempts.push(noStop.slice(0, 2).join(" "));
    attempts.push(noStop.slice(0, 1).join(" "));

    const tryAt = (i: number) => {
      if (i >= attempts.length) {
        setItems([]);
        setError("نتیجه‌ای یافت نشد. علاقه‌مندی‌ات را کلیک‌تر بنویس.");
        setLoading(false);
        return;
      }
      const sp = new URLSearchParams({ q: attempts[i], limit: "24", sort: "relevance" });
      fetch(`/api/search?${sp.toString()}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j: SearchResponse) => {
          if (j.items.length > 0) {
            setItems(j.items);
            setEffectiveQuery(attempts[i]);
            setSelectedIds(new Set(j.items.slice(0, 3).map((x) => x.product_id)));
            setLoading(false);
          } else {
            tryAt(i + 1);
          }
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        });
    };
    tryAt(0);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = items?.filter((i) => selectedIds.has(i.product_id)) ?? [];

  const askAssistant = () => {
    if (selectedItems.length === 0 || !need.trim()) return;
    setAsking(true);
    setRecError(null);
    setRecommendation(null);
    const picks = selectedItems
      .map((i) => `- ${i.title} | برند: ${i.brand ?? "نامشخص"} | ارزان‌ترین: ${i.min_price_toman !== null ? formatToman(i.min_price_toman) : "نامشخص"} | ${toPersianDigits(i.offer_count)} پیشنهاد`)
      .join("\n");
    const message = `علاقه‌مندی من: ${need}\nبرای جست‌وجوی محصول از این عبارت استفاده کن: "${effectiveQuery}"\n\nاین چند مدل پیدا کردم. کدام برای من مناسب‌تر است و چرا؟ فقط بین همین مدل‌ها یکی را پیشنهاد بده.\n${picks}`;
    fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => setRecommendation(j.reply ?? j.error ?? "پاسخی دریافت نشد."))
      .catch((e) => setRecError(e instanceof Error ? e.message : String(e)))
      .finally(() => setAsking(false));
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Sparkles className="size-5 text-primary" aria-hidden />
          کاوش و انتخاب مدل
        </h2>
        <p className="text-sm text-muted-foreground">
          هنوز نمی‌دانی چه مدلی برایت مناسب است؟ بگو چه چیزی می‌خواهی، مدل‌های مختلف را کنار هم
          مقایسه کن، و از دستیار بپرس کدام برایت بهتر است.
        </p>
      </header>

      {/* Step 1: What do you need? */}
      <Card className="gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۱</span>
          چه چیزی می‌خواهی و برای چه کاری؟
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(need);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Input
            value={need}
            onChange={(e) => setNeed(e.target.value)}
            placeholder="مثلاً: ماوس بی‌سیم برای کار اداری"
            className="text-base"
            aria-label="علاقه‌مندی شما"
          />
          <Button type="submit" disabled={!need.trim() || loading} className="min-h-11 gap-2">
            <Layers className="size-4" aria-hidden />
            مدل‌ها را ببین
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_NEEDS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setNeed(q);
                runSearch(q);
              }}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      </Card>

      {/* Step 2: Browse + select models to compare */}
      {loading && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}
      {error && !loading && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">{error}</Card>
      )}
      {items && !loading && (
        <Card className="gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۲</span>
              {toPersianDigits(items.length)} مدل — انتخاب کن تا مقایسه شوند
            </div>
            <span className="text-xs text-muted-foreground">
              {toPersianDigits(selectedIds.size)} انتخاب‌شده
            </span>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const selected = selectedIds.has(item.product_id);
              return (
                <li key={item.product_id}>
                  <button
                    type="button"
                    onClick={() => toggleSelect(item.product_id)}
                    className={`relative flex w-full items-start gap-3 rounded-lg border p-3 text-right transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-accent"
                    }`}
                  >
                    {selected && (
                      <CheckCircle2 className="absolute left-2 top-2 size-4 text-primary" aria-hidden />
                    )}
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="size-12 shrink-0 rounded-md object-cover" loading="lazy" />
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.brand ?? "بدون برند"} • {toPersianDigits(item.offer_count)} پیشنهاد
                      </span>
                      <span className="text-xs font-semibold text-primary">
                        {item.min_price_toman !== null ? `از ${formatToman(item.min_price_toman)}` : "قیمت نامشخص"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Step 3: Side-by-side comparison */}
      {selectedItems.length > 0 && (
        <Card className="gap-3 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۳</span>
            <GitCompareArrows className="size-4" aria-hidden />
            مقایسه کنار هم
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {selectedItems.map((item) => {
              const min =
                selectedItems.reduce((m, x) => Math.min(m, x.min_price_toman ?? Infinity), Infinity);
              const cheapest = item.min_price_toman === min && item.min_price_toman !== null;
              const maxOffers = selectedItems.reduce((m, x) => Math.max(m, x.offer_count), 0);
              const mostOffers = item.offer_count === maxOffers && maxOffers > 0;
              return (
                <motion.div
                  key={item.product_id}
                  layout
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-start gap-2">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="size-14 shrink-0 rounded-md object-cover" loading="lazy" />
                    ) : (
                      <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Layers className="size-5 text-muted-foreground" aria-hidden />
                      </span>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</span>
                      <span className="text-xs text-muted-foreground">{item.brand ?? "بدون برند"}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.min_price_toman !== null ? (
                      <Badge variant={cheapest ? "default" : "secondary"} className="font-num">
                        {formatToman(item.min_price_toman)}
                        {cheapest && " • ارزان‌ترین"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">قیمت نامشخص</Badge>
                    )}
                    <Badge variant={mostOffers ? "default" : "outline"} className="font-num">
                      {toPersianDigits(item.offer_count)} پیشنهاد
                      {mostOffers && " • پرپیشنهاد"}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => onPickProduct(item.product_id)}
                  >
                    مشاهده و خرید حضوری
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Button>
                </motion.div>
              );
            })}
          </div>

          {/* Step 4: Ask the assistant */}
          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۴</span>
              <Bot className="size-4" aria-hidden />
              از دستیار بپرس کدام برایت مناسب‌تر است
            </div>
            <Button
              type="button"
              onClick={askAssistant}
              disabled={asking}
              className="min-h-11 gap-2 self-start"
            >
              {asking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Bot className="size-4" aria-hidden />}
              {asking ? "در حال تحلیل..." : "توصیه بده"}
            </Button>
            {recError && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {recError}
              </p>
            )}
            {recommendation && (
              <div className="whitespace-pre-line rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm leading-relaxed">
                {recommendation}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
