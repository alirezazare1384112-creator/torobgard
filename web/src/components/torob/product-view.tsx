"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  HelpCircle,
  Loader2,
  MapPin,
  Package,
  Replace,
  Store,
  Truck,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { formatDistanceKm, formatNumber, formatPersianDate, formatToman, toPersianDigits } from "./format";
import { SyntheticNameBadge } from "./disclaimers";
import { DEFAULT_WEIGHTS, rankOffers, type RankWeights, type RankedOffer } from "./rank";
import type {
  AlternativeItem,
  AlternativesResponse,
  CompareOffer,
  CompareResponse,
  ProductDetails,
} from "./types";

function priceStatusBadge(status: CompareOffer["price_status"]) {
  switch (status) {
    case "ok":
      return (
        <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
          <CheckCircle2 className="size-3" aria-hidden />
          قیمت معتبر
        </Badge>
      );
    case "missing":
      return (
        <Badge variant="secondary" className="gap-1">
          <HelpCircle className="size-3" aria-hidden />
          نامشخص
        </Badge>
      );
    case "too_low":
    case "too_high":
      return (
        <Badge className="gap-1 bg-orange-500 text-white hover:bg-orange-500">
          <HelpCircle className="size-3" aria-hidden />
          غیرمنطقی
        </Badge>
      );
    default:
      return null;
  }
}

function ImageGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = React.useState(0);
  if (!images.length) {
    return (
      <div
        aria-hidden
        className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground"
      >
        <div className="flex flex-col items-center gap-2 text-sm">
          <Package className="size-8 opacity-40" />
          بدون تصویر
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <img
          src={images[active]}
          alt={title}
          className="aspect-square w-full object-cover"
        />
      </div>
      {images.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {images.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className={`overflow-hidden rounded-md border ${
                active === i ? "border-primary" : "border-border"
              }`}
              aria-label={`تصویر ${toPersianDigits(i + 1)}`}
            >
              <img src={src} alt={`${title} ${toPersianDigits(i + 1)}`} className="size-16 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SpecsTable({ specs }: { specs: ProductDetails["specs"] }) {
  if (!specs.length) {
    return (
      <p className="text-sm text-muted-foreground">مشخصات فنی برای این محصول ثبت نشده است.</p>
    );
  }
  // group by section
  const groups = new Map<string, { key: string; value: string }[]>();
  for (const s of specs) {
    const section = s.section ?? "عمومی";
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section)!.push({ key: s.key ?? "—", value: s.value ?? "—" });
  }
  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([section, rows]) => (
        <Card key={section} className="overflow-hidden p-0">
          <div className="bg-muted/40 px-4 py-2 text-sm font-semibold">{section}</div>
          <dl className="divide-y divide-border">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[140px_1fr] gap-3 px-4 py-2 text-sm">
                <dt className="text-muted-foreground">{r.key}</dt>
                <dd className="font-medium">{r.value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
  );
}

function OfferRow({
  offer,
  cheapest,
  ranked,
}: {
  offer: CompareOffer;
  cheapest: number | null;
  ranked?: RankedOffer;
}) {
  const isCheapest = cheapest !== null && offer.price_status === "ok" && offer.price_toman === cheapest;
  const top = ranked?.breakdown?.some((b) => b.contribution > 0) ? ranked : undefined;
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-4 ${
        isCheapest ? "border-emerald-500/50 bg-emerald-50/40 dark:bg-emerald-950/20" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Store className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{offer.shop.name}</span>
              <SyntheticNameBadge />
            </div>
            {offer.seller_title && (
              <p className="text-xs text-muted-foreground">{offer.seller_title}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {top && (
            <Badge variant="default" className="gap-1 font-num">
              <CheckCircle2 className="size-3" aria-hidden />
              امتیاز {toPersianDigits(top.score)}
            </Badge>
          )}
          {priceStatusBadge(offer.price_status)}
        </div>
      </div>

      {offer.shop.address && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {offer.shop.address}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {offer.shop.location_label && <Badge variant="outline">{offer.shop.location_label}</Badge>}
        {offer.shop.distance_km !== null && (
          <Badge variant="secondary" className="font-num">
            {formatDistanceKm(offer.shop.distance_km)}
          </Badge>
        )}
        {offer.shop.supports_fast_delivery && (
          <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
            <Zap className="size-3" aria-hidden />
            ارسال سریع
          </Badge>
        )}
        {offer.shop.has_installment && (
          <Badge className="gap-1 bg-amber-600 text-white hover:bg-amber-600">
            <Zap className="size-3" aria-hidden />
            قسطی
          </Badge>
        )}
        {offer.shop.today_hours && (
          <Badge variant="outline" className="gap-1">
            <Calendar className="size-3" aria-hidden />
            {offer.shop.open_now === true
              ? `باز • تا ${toPersianDigits(offer.shop.today_hours.close)}`
              : offer.shop.open_now === false
                ? `بسته • از ${toPersianDigits(offer.shop.today_hours.open)}`
                : "ساعت کاری نامشخص"}
          </Badge>
        )}
        {isCheapest && (
          <Badge className="gap-1 bg-emerald-700 text-white hover:bg-emerald-700">
            <CheckCircle2 className="size-3" aria-hidden />
            ارزان‌ترین
          </Badge>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-lg font-bold font-num">
          {offer.price_status === "ok" || offer.price_toman !== null
            ? formatToman(offer.price_toman)
            : "نامشخص"}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="size-3.5" aria-hidden />
            <span className="font-num">{formatPersianDate(offer.price_changed_at)}</span>
          </span>
        </div>
      </div>
      {offer.warranty != null && (
        <p className="text-xs text-muted-foreground">
          گارانتی: {typeof offer.warranty === "string" ? offer.warranty : JSON.stringify(offer.warranty)}
        </p>
      )}

      {/* Explainable rank breakdown */}
      {top && top.breakdown.length > 0 && (
        <details className="mt-1 rounded-md bg-muted/40 p-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">چرا این امتیاز؟ (رتبه‌بندی قابل‌توضیح)</summary>
          <ul className="mt-2 space-y-1">
            {top.breakdown
              .filter((b) => b.weight > 0)
              .map((b) => (
                <li key={b.criterion} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-num">{toPersianDigits(Math.round(b.raw * 100))}٪</span>
                    <span className="text-muted-foreground">×{toPersianDigits(b.weight)}</span>
                    <span className="text-[10px] text-muted-foreground">({b.note})</span>
                  </span>
                </li>
              ))}
          </ul>
        </details>
      )}

      {/* Phone + verify (compact) */}
      {offer.shop.contacts && offer.shop.contacts.some((c) => c.channel === "phone") && (
        <div className="mt-1 flex items-center gap-2">
          <a href={`tel:${offer.shop.contacts!.find((c) => c.channel === "phone")!.display_number.replace(/\s/g, "")}`}>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Truck className="size-3.5" aria-hidden />
              تماس: {toPersianDigits(offer.shop.contacts!.find((c) => c.channel === "phone")!.display_number)}
            </Button>
          </a>
          <span className="text-[11px] text-amber-600">قیمت قدیمی ممکن است — تماس بگیرید</span>
        </div>
      )}
    </div>
  );
}

export function ProductView({
  productId,
  near,
  radiusKm,
  onBack,
  onSelectProduct,
}: {
  productId: string;
  near: string | null;
  radiusKm: number | null;
  onBack: () => void;
  onSelectProduct: (id: string) => void;
}) {
  const [product, setProduct] = React.useState<ProductDetails | null>(null);
  const [compare, setCompare] = React.useState<CompareResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [alts, setAlts] = React.useState<AlternativeItem[]>([]);
  const [altsLoading, setAltsLoading] = React.useState(false);
  const [altsError, setAltsError] = React.useState<string | null>(null);
  const [showAlts, setShowAlts] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setShowAlts(false);
    setAlts([]);
    const productUrl = `/api/product/${encodeURIComponent(productId)}`;
    const cmpSp = new URLSearchParams();
    if (near) {
      cmpSp.set("near", near);
      if (radiusKm !== null) cmpSp.set("radius_km", String(radiusKm));
    }
    cmpSp.set("limit", "100");
    const compareUrl = `/api/compare/${encodeURIComponent(productId)}?${cmpSp.toString()}`;
    Promise.all([
      fetch(productUrl).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetch(compareUrl).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    ])
      .then(([p, c]) => {
        if (cancelled) return;
        setProduct(p);
        setCompare(c);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, near, radiusKm]);

  const offers = compare?.offers ?? [];
  const summary = compare?.summary;
  const cheapest = summary?.min_price_toman ?? null;

  // explainable ranking (user-tunable weights)
  const [weights, setWeights] = React.useState<RankWeights>(DEFAULT_WEIGHTS);
  const ranked = React.useMemo(() => {
    return rankOffers(
      offers.map((o) => ({
        price_toman: o.price_toman,
        price_status: o.price_status,
        price_changed_at: o.price_changed_at,
        distance_km: o.shop.distance_km,
        open_now: o.shop.open_now,
        has_installment: !!o.shop.has_installment,
      })),
      weights
    );
  }, [offers, weights]);

  const loadAlternatives = async () => {
    if (showAlts) {
      setShowAlts(false);
      return;
    }
    if (alts.length > 0) {
      setShowAlts(true);
      return;
    }
    setAltsLoading(true);
    setAltsError(null);
    try {
      const budget = cheapest ?? "";
      const url = `/api/alternatives/${encodeURIComponent(productId)}?limit=8${
        cheapest !== null ? `&budget=${cheapest}` : ""
      }`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as AlternativesResponse;
      setAlts(j.alternatives);
      setShowAlts(true);
    } catch (e) {
      setAltsError(e instanceof Error ? e.message : String(e));
    } finally {
      setAltsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8">
        <Skeleton className="h-10 w-40" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="aspect-square w-full" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8">
        <Button variant="ghost" onClick={onBack} className="w-fit">
          <ArrowRight className="size-4" aria-hidden />
          بازگشت
        </Button>
        <Card className="p-6 text-sm text-destructive">
          خطا در بارگذاری محصول: {error ?? "محصول یافت نشد"}
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack} className="w-fit">
          <ArrowRight className="size-4" aria-hidden />
          بازگشت به نتایج
        </Button>
        <div className="flex flex-wrap gap-1.5">
          {product.category && <Badge variant="secondary">{product.category}</Badge>}
          {product.brand && <Badge variant="outline">{product.brand}</Badge>}
          <Badge variant="outline" className="font-num">
            {toPersianDigits(product.offer_count)} پیشنهاد
          </Badge>
        </div>
      </div>

      <motion.h2
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-bold leading-relaxed sm:text-3xl"
      >
        {product.title}
      </motion.h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: product details */}
        <div className="flex flex-col gap-4">
          <ImageGallery images={product.images} title={product.title} />
          {product.model && (
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">مدل</p>
              <p className="text-sm font-medium">{product.model}</p>
            </Card>
          )}
          <div>
            <h3 className="mb-2 text-sm font-semibold">مشخصات فنی</h3>
            <SpecsTable specs={product.specs} />
          </div>
        </div>

        {/* Right: comparison */}
        <div className="flex flex-col gap-4">
          {/* Summary */}
          {summary && (
            <Card className="p-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">ارزان‌ترین</p>
                  <p className="text-sm font-bold font-num text-emerald-600 dark:text-emerald-400">
                    {formatToman(summary.min_price_toman)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">گران‌ترین</p>
                  <p className="text-sm font-bold font-num">
                    {formatToman(summary.max_price_toman)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">اختلاف قیمت</p>
                  <p className="text-sm font-bold font-num text-orange-600 dark:text-orange-400">
                    {formatToman(summary.spread_toman)}
                  </p>
                </div>
              </div>
            </Card>
          )}

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              مقایسه پیشنهادها{" "}
              <span className="font-num text-muted-foreground">({toPersianDigits(offers.length)})</span>
            </h3>
            <Button variant="outline" size="sm" onClick={loadAlternatives} disabled={altsLoading} className="min-h-9">
              {altsLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Replace className="size-4" aria-hidden />
              )}
              جایگزین‌ها
            </Button>
          </div>

          {/* Offers list — scrollable */}
          {offers.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              هیچ پیشنهادی برای این محصول یافت نشد.
            </Card>
          ) : (
            <React.Fragment>
            {/* Rank weights — tunable by the user */}
            <details className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <summary className="cursor-pointer font-medium">رتبه‌بندی قابل‌تنظیم — وزن معیارها</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {([
                  ["price", "قیمت", "ارزان‌تر = امتیاز بالاتر"],
                  ["distance", "فاصله", "نزدیک‌تر = امتیاز بالاتر"],
                  ["stock_confidence", "اطمینان به موجودی", "تأیید فروشنده = امتیاز بالاتر"],
                  ["open_now", "باز بودن", "باز اکنون = امتیاز بالاتر"],
                  ["installment", "اقساطی", "دارای اقساط = امتیاز بالاتر"],
                  ["freshness", "به‌روز بودن قیمت", "قیمت جدیدتر = امتیاز بالاتر"],
                ] as const).map(([key, label, hint]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{label}</span>
                      <span className="font-num text-muted-foreground">{toPersianDigits(Math.round(weights[key] * 100))}٪</span>
                    </div>
                    <Slider
                      value={[Math.round(weights[key] * 100)]}
                      min={0}
                      max={100}
                      step={5}
                      onValueChange={(v) => setWeights((w) => ({ ...w, [key]: v[0] / 100 }))}
                      aria-label={label}
                    />
                    <span className="text-[11px] text-muted-foreground">{hint}</span>
                  </div>
                ))}
              </div>
              <Button type="button" variant="ghost" size="sm" className="mt-2 h-8" onClick={() => setWeights(DEFAULT_WEIGHTS)}>بازنشانی وزن‌ها</Button>
            </details>

            <div className="scrollbar-thin max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {ranked.map((r) => {
                const o = offers.find((x) => x.price_toman === r.price_toman && x.shop.distance_km === r.distance_km);
                if (!o) return null;
                return <OfferRow key={o.offer_id} offer={o} cheapest={cheapest} ranked={r} />;
              })}
            </div>
            </React.Fragment>
          )}

          {altsError && (
            <p className="text-xs text-destructive">خطا در بارگذاری جایگزین‌ها: {altsError}</p>
          )}

          {/* Alternatives */}
          {showAlts && alts.length > 0 && (
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold">جایگزین‌های هم‌دسته</h4>
              <div className="scrollbar-thin max-h-80 space-y-2 overflow-y-auto pr-1">
                {alts.map((a) => (
                  <button
                    key={a.product_id}
                    type="button"
                    onClick={() => onSelectProduct(a.product_id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-right transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <div className="flex flex-col items-start gap-1">
                      <span className="line-clamp-1 text-sm font-medium">{a.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.brand ?? "بدون برند"} • {toPersianDigits(a.offer_count)} پیشنهاد
                      </span>
                    </div>
                    <div className="shrink-0 text-left text-xs font-num text-muted-foreground">
                      {formatToman(a.min_price_toman)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Disclaimer near offers */}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Truck className="size-3.5 shrink-0" aria-hidden />
            قیمت‌ها ممکن است قدیمی باشند و موجودی در داده نیست.
          </p>
        </div>
      </div>
    </div>
  );
}
