"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  MapPin,
  Package,
  Search,
  ShieldCheck,
  Store,
  Tags,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, toPersianDigits } from "./format";
import type { MetaResponse, StatsCategory } from "./types";

const EXAMPLE_QUERIES = [
  "ماوس بی‌سیم تا ۱ میلیون",
  "ماوس با سیم",
  "لپ‌تاپ ایسوس",
  "هدفون بی‌سیم",
];

function StatCard({ label, value, icon, loading }: { label: string; value: number | null; icon: React.ReactNode; loading: boolean }) {
  return (
    <Card className="flex items-center gap-4 p-4 sm:p-6">
      <div className="rounded-lg bg-primary/10 p-3 text-primary">{icon}</div>
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        {loading ? <Skeleton className="mt-1 h-7 w-24" /> : <span className="text-2xl font-bold font-num">{formatNumber(value)}</span>}
      </div>
    </Card>
  );
}

export function HomeView({
  meta,
  categories,
  loadingMeta,
  loadingStats,
  onSearch,
  onOpenAssistant,
}: {
  meta: MetaResponse | null;
  categories: StatsCategory[];
  loadingMeta: boolean;
  loadingStats: boolean;
  onSearch: (q: string) => void;
  onOpenAssistant?: () => void;
}) {
  const [q, setQ] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = q.trim();
    if (!value) return;
    onSearch(value);
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:py-12">
      {/* Hero */}
      <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex flex-col items-center gap-4 text-center">
        <Badge variant="secondary" className="gap-1">
          <Store className="size-3" aria-hidden />دستیار خرید حضوری تهران
        </Badge>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">طرب‌گارد</h1>
        <p className="max-w-2xl text-balance text-base text-foreground sm:text-xl">
          چی لازم داری؟ با هم پیداش می‌کنیم.
        </p>
        <p className="max-w-2xl text-sm text-muted-foreground">
          حتی اگر نمی‌دانی دقیقاً چه مدلی می‌خواهی — بگو چی می‌خوای، محصولات را مقایسه می‌کنیم،
          فروشگاه‌های نزدیک تهران را پیدا می‌کنیم، و قبل از مراجعه با فروشنده تماس می‌گیری تا
          موجودی و قیمت امروز را تأیید کنی.
        </p>

        {/* Big search box */}
        <form onSubmit={submit} className="mt-4 flex w-full max-w-2xl flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام محصول، برند یا دسته… مثلاً «ماوس بی‌سیم»" className="h-12 pr-10 text-base" aria-label="جست‌وجوی محصول" />
          </div>
          <Button type="submit" size="lg" className="h-12 min-h-11 px-6">جست‌وجو<ArrowLeft className="size-4" aria-hidden /></Button>
        </form>

        {/* Example query chips */}
        <div className="flex flex-wrap items-center justify-center gap-2" aria-label="نمونه جست‌وجو">
          {EXAMPLE_QUERIES.map((ex) => (
            <button key={ex} type="button" onClick={() => { setQ(ex); onSearch(ex); }} className="min-h-9 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
              «{ex}»
            </button>
          ))}
        </div>

        {/* Assistant CTA */}
        {onOpenAssistant && (
          <Button type="button" variant="outline" size="lg" onClick={onOpenAssistant} className="mt-2 min-h-11 gap-2">
            <Bot className="size-4" aria-hidden />یا با دستیار هوشمند شروع کن
          </Button>
        )}
      </motion.section>

      {/* How it works — trust + process */}
      <section aria-label="چطور کار می‌کند" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: <Search className="size-5" aria-hidden />, t: "۱. بگو چی می‌خوای", d: "نیازت را طبیعی بنویس — دستیار سؤال لازم را می‌پرسد." },
          { icon: <Tags className="size-5" aria-hidden />, t: "۲. مقایسه کنار هم", d: "مدل‌ها را با قیمت، برند و تعداد پیشنهاد مقایسه کن." },
          { icon: <ShieldCheck className="size-5" aria-hidden />, t: "۳. تأیید قیمت و موجودی", d: "فروشگاه نزدیک را پیدا کن، تماس بگیر و قبل از مراجعه مطمئن شو." },
        ].map((s) => (
          <Card key={s.t} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2 text-primary">{s.icon}<span className="text-sm font-semibold">{s.t}</span></div>
            <p className="text-xs text-muted-foreground">{s.d}</p>
          </Card>
        ))}
      </section>

      {/* Stat cards */}
      <section aria-label="آمار کلی" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="تعداد محصولات" icon={<Package className="size-6" aria-hidden />} value={meta?.counts.products ?? null} loading={loadingMeta} />
        <StatCard label="فروشگاه‌ها" icon={<Store className="size-6" aria-hidden />} value={meta?.counts.shops ?? null} loading={loadingMeta} />
        <StatCard label="پیشنهادها" icon={<Tags className="size-6" aria-hidden />} value={meta?.counts.offers ?? null} loading={loadingMeta} />
      </section>

      {/* Category quick-links */}
      <section aria-label="دسته‌بندی‌ها" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">دسته‌بندی‌های محبوب</h2>
        </div>
        {loadingStats ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : categories.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            <MapPin className="mx-auto mb-2 size-5 opacity-50" aria-hidden />
            هنوز دسته‌ای بارگذاری نشده است.
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((c) => (
              <button key={c.category} type="button" onClick={() => onSearch(c.category)} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-right transition-colors hover:bg-accent hover:text-accent-foreground" aria-label={`جست‌وجو در دسته ${c.category}`}>
                <span className="line-clamp-1 text-sm font-medium">{c.category}</span>
                <Badge variant="secondary" className="font-num">{toPersianDigits(c.c)}</Badge>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Honest data note */}
      <section aria-label="نکتهٔ داده" className="text-center">
        <p className="mx-auto flex max-w-2xl items-center justify-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
          مبتنی بر دیتاست واقعی Torob. نام فروشگاه‌ها مصنوعی است و قیمت‌ها ممکن است قدیمی باشند —
          قبل از مراجعه با فروشنده تماس بگیر.
        </p>
      </section>
    </div>
  );
}
