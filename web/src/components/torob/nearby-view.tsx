"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Clock,
  CreditCard,
  LocateFixed,
  MapPin,
  Navigation,
  Package,
  Phone,
  Search,
  Store,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SyntheticNameBadge } from "./disclaimers";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import type { CompareOffer, CompareResponse, SearchItem, SearchResponse } from "./types";

const NEIGHBORHOODS = [
  "صادقیه", "ولنجک", "ونک", "میدان ولیعصر", "تجریش", "شریعتی",
];

const EXAMPLE_QUERIES = [
  "ماوس بی‌سیم زیر ۱ میلیون",
  "هدفون بی‌سیم",
  "لپ‌تاپ ایسوس",
  "کیبورد مکانیکی",
  "دوربین مدار بسته",
  "پاور بانک",
];

type Loc = { lat: number; lon: number; label: string } | null;

/** Human label for today's hours / open status from the backend. */
function todayStatus(o: CompareOffer["shop"]): { label: string; tone: "open" | "closed" | "unknown" } {
  const t = o.today_hours;
  if (!t) return { label: "ساعت کاری نامشخص", tone: "unknown" };
  if (o.open_now === true) {
    return t.close
      ? { label: `باز • تا ${toPersianDigits(t.close)}`, tone: "open" }
      : { label: "باز", tone: "open" };
  }
  if (o.open_now === false) {
    if (t.status === "closed") return { label: "امروز تعطیل", tone: "closed" };
    return t.open
      ? { label: `بسته • از ${toPersianDigits(t.open)}`, tone: "closed" }
      : { label: "اکنون بسته", tone: "closed" };
  }
  return { label: "ساعت کاری نامشخص", tone: "unknown" };
}

export function NearbyView() {
  const [query, setQuery] = React.useState("");
  const [loc, setLoc] = React.useState<Loc>(null);
  const [locError, setLocError] = React.useState<string | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [radius, setRadius] = React.useState(10); // km
  const [installmentOnly, setInstallmentOnly] = React.useState(false);
  const [openNow, setOpenNow] = React.useState(false);

  // search state
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [results, setResults] = React.useState<SearchItem[] | null>(null);
  const [selected, setSelected] = React.useState<SearchItem | null>(null);

  // offers state
  const [loadingOffers, setLoadingOffers] = React.useState(false);
  const [offers, setOffers] = React.useState<CompareOffer[]>([]);
  const [offersError, setOffersError] = React.useState<string | null>(null);

  // ---- geolocation ----
  const detectLocation = () => {
    setLocError(null);
    if (!("geolocation" in navigator)) {
      setLocError("مرورگر شما از موقعیت‌یابی پشتیبانی نمی‌کند. محله را دستی وارد کنید.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lon: Number(pos.coords.longitude.toFixed(6)),
          label: "موقعیت فعلی شما",
        });
        setLocating(false);
      },
      (err) => {
        setLocError(
          err.code === err.PERMISSION_DENIED
            ? "دسترسی به موقعیت رد شد. محله را دستی وارد کنید یا دوباره تلاش کنید."
            : "دریافت موقعیت ناموفق بود. محله را دستی وارد کنید."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };

  const setNeighborhood = (n: string) => {
    const coords: Record<string, [number, number]> = {
      "صادقیه": [35.7467, 51.336],
      "ولنجک": [35.779, 51.387],
      "ونک": [35.765, 51.412],
      "میدان ولیعصر": [35.6997, 51.413],
      "تجریش": [35.805, 51.43],
      "شریعتی": [35.76, 51.433],
    };
    const c = coords[n];
    if (c) setLoc({ lat: c[0], lon: c[1], label: n });
  };

  // ---- search ----
  const runSearch = (q: string) => {
    if (!q.trim()) return;
    setSearchError(null);
    setResults(null);
    setSelected(null);
    setOffers([]);
    setSearching(true);
    const sp = new URLSearchParams({ q, limit: "40", sort: "relevance" });
    fetch(`/api/search?${sp.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: SearchResponse) => {
        setResults(j.items);
        if (j.items.length === 0) setSearchError("نتیجه‌ای یافت نشد. عبارت را کلیک‌تر کنید.");
      })
      .catch((e) => setSearchError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSearching(false));
  };

  // ---- compare offers near location ----
  const loadOffers = React.useCallback((item: SearchItem) => {
    setSelected(item);
    setOffers([]);
    setOffersError(null);
    if (!loc) {
      setOffersError("برای دیدن نزدیک‌ترین فروشگاه‌ها ابتدا موقعیت خود را مشخص کنید.");
      return;
    }
    setLoadingOffers(true);
    const sp = new URLSearchParams({
      lat: String(loc.lat),
      lon: String(loc.lon),
      radius_km: String(radius),
      sort: "distance",
      limit: "50",
    });
    if (installmentOnly) sp.set("installment_only", "true");
    if (openNow) sp.set("open_now", "true");
    fetch(`/api/compare/${item.product_id}?${sp.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: CompareResponse) => {
        setOffers(j.offers);
        if (j.offers.length === 0)
          setOffersError("هیچ فروشگاهی در این شعور این کالا را ندارد. شعور را زیاد کنید یا فیلترها را loosen کنید.");
      })
      .catch((e) => setOffersError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingOffers(false));
  }, [loc, radius, installmentOnly, openNow]);

  // reload offers when filters change if a product is selected
  React.useEffect(() => {
    if (selected) loadOffers(selected);
  }, [loc, radius, installmentOnly, openNow]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:py-8">
      <header className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Navigation className="size-5" aria-hidden />
          خرید حضوری
        </h2>
        <p className="text-sm text-muted-foreground">
          بگو چی می‌خوای، موقعیتت رو مشخص کن، بعد ببین کدوم فروشگاه‌های نزدیک این کالا رو دارن —
          با قیمت، فاصله، ساعت کاری امروز و شماره تماس.
        </p>
      </header>

      {/* Step 1: What do you want? */}
      <Card className="gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۱</span>
          چی می‌خوای؟
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="مثلاً: ماوس بی‌سیم زیر ۱ میلیون"
              className="pr-9 text-base"
              aria-label="جست‌وجوی محصول"
            />
          </div>
          <Button type="submit" disabled={!query.trim() || searching} className="min-h-11 gap-2">
            <Search className="size-4" aria-hidden />
            پیدا کن
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_QUERIES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setQuery(q);
                runSearch(q);
              }}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      </Card>

      {/* Step 2: Where are you? */}
      <Card className="gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۲</span>
          کجایی؟
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="default" onClick={detectLocation} disabled={locating} className="min-h-11 gap-2">
            <LocateFixed className="size-4" aria-hidden />
            {locating ? "در حال یافتن..." : "موقعیت من"}
          </Button>
          <span className="text-xs text-muted-foreground">یا یک محله:</span>
          {NEIGHBORHOODS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNeighborhood(n)}
              className={`min-h-9 rounded-full border px-3 py-1 text-xs transition-colors ${
                loc?.label === n
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {loc && (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm">
            <MapPin className="size-4 text-emerald-600" aria-hidden />
            <span className="font-num">{loc.label}</span>
            <span className="text-muted-foreground">
              ( {toPersianDigits(loc.lat)} ، {toPersianDigits(loc.lon)} )
            </span>
          </div>
        )}
        {locError && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {locError}
          </p>
        )}
        {loc && (
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">شعور:</span>
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="rounded-md border border-border bg-card px-2 py-1"
              >
                <option value={5}>۵ کیلومتر</option>
                <option value={10}>۱۰ کیلومتر</option>
                <option value={20}>۲۰ کیلومتر</option>
                <option value={50}>۵۰ کیلومتر</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={installmentOnly} onCheckedChange={setInstallmentOnly} aria-label="فقط فروشگاه‌های قسطی" />
              <span className="flex items-center gap-1">
                <CreditCard className="size-3.5" aria-hidden /> فقط قسطی
              </span>
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={openNow} onCheckedChange={setOpenNow} aria-label="فقط فروشگاه‌های باز" />
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden /> فقط باز الآن
              </span>
            </label>
          </div>
        )}
      </Card>

      {/* Step 3: Results — product list */}
      {searching && (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}
      {searchError && !searching && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">{searchError}</Card>
      )}
      {results && !searching && (
        <Card className="gap-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۳</span>
              {results.length > 0 ? `${toPersianDigits(results.length)} محصول پیدا شد — یکی رو انتخاب کن` : "نتیجه‌ای نبود"}
            </div>
          </div>
          {results.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {results.map((item) => {
                const active = selected?.product_id === item.product_id;
                return (
                  <li key={item.product_id}>
                    <button
                      type="button"
                      onClick={() => loadOffers(item)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-right transition-colors ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:bg-accent"
                      }`}
                    >
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt=""
                          className="size-12 shrink-0 rounded-md object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
                          <Package className="size-5 text-muted-foreground" aria-hidden />
                        </span>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="line-clamp-2 text-sm font-medium leading-snug">{item.title}</span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {item.brand ? <span>{item.brand}</span> : <span>بدون برند</span>}
                          <span aria-hidden>•</span>
                          <span className="font-num">{toPersianDigits(item.offer_count)} پیشنهاد</span>
                        </span>
                        <span className="text-xs font-semibold text-primary">
                          {item.min_price_toman !== null
                            ? `از ${formatToman(item.min_price_toman)}`
                            : "قیمت نامشخص"}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {/* Step 4: Nearby shops for the selected product */}
      {selected && (
        <Card className="gap-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">۴</span>
              نزدیک‌ترین فروشگاه‌ها برای «{selected.title}»
            </div>
            {offers.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {toPersianDigits(offers.length)} فروشگاه
              </span>
            )}
          </div>
          {!loc && (
            <p className="flex items-start gap-2 text-sm text-amber-600">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              برای دیدن فاصله و مرتب‌سازی بر اساس نزدیکی، ابتدا در مرحله ۲ موقعیت خود را مشخص کنید.
            </p>
          )}
          {loadingOffers && (
            <div className="grid gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          )}
          {offersError && !loadingOffers && (
            <p className="text-sm text-amber-600">{offersError}</p>
          )}
          {offers.length > 0 && !loadingOffers && (
            <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-2">
              {offers.map((o, idx) => {
                const st = todayStatus(o.shop);
                const phone = o.shop.contacts?.find((c) => c.channel === "phone")?.display_number;
                return (
                  <li key={o.offer_id}>
                    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-num text-sm font-semibold text-primary">
                        {toPersianDigits(idx + 1)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Store className="size-4 text-primary" aria-hidden />
                          <span className="line-clamp-1 text-sm font-semibold">{o.shop.name}</span>
                          <SyntheticNameBadge />
                          {o.shop.supports_fast_delivery && (
                            <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                              <Zap className="size-3" aria-hidden />
                              ارسال سریع
                            </Badge>
                          )}
                          {o.shop.has_installment && (
                            <Badge className="gap-1 bg-amber-600 text-white hover:bg-amber-600">
                              <CreditCard className="size-3" aria-hidden />
                              قسطی
                            </Badge>
                          )}
                          <Badge
                            variant={st.tone === "open" ? "default" : st.tone === "closed" ? "destructive" : "secondary"}
                            className="gap-1"
                          >
                            <Clock className="size-3" aria-hidden />
                            {st.label}
                          </Badge>
                        </div>
                        {o.shop.address && (
                          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden />
                            <span className="leading-relaxed">{o.shop.address}</span>
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {o.price_status === "ok" && o.price_toman !== null ? (
                            <span className="font-num font-semibold text-primary">
                              {formatToman(o.price_toman)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">قیمت نامشخص</span>
                          )}
                          {o.shop.distance_km !== null && (
                            <Badge variant="secondary" className="font-num">
                              {formatDistanceKm(o.shop.distance_km)}
                            </Badge>
                          )}
                          {o.shop.location_label && <Badge variant="outline">{o.shop.location_label}</Badge>}
                        </div>
                        {phone && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <a href={`tel:${phone.replace(/\s/g, "")}`}>
                              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5">
                                <Phone className="size-3.5" aria-hidden />
                                تماس: {toPersianDigits(phone)}
                              </Button>
                            </a>
                            <span className="text-[11px] text-amber-600">
                              قیمت‌ها ممکن است قدیمی باشند — قبل از مراجعه تماس بگیرید و موجودی را بپرسید.
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </motion.ul>
          )}
        </Card>
      )}
    </div>
  );
}
