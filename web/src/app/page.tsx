"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Home as HomeIcon, MapPin, Moon, Navigation, Search, Store, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { SyntheticBanner, DisclaimerList } from "@/components/torob/disclaimers";
import { HomeView } from "@/components/torob/home-view";
import { SearchView, type SearchFiltersState, DEFAULT_SEARCH_FILTERS } from "@/components/torob/search-view";
import { ProductView } from "@/components/torob/product-view";
import { ShopsView } from "@/components/torob/shops-view";
import { MapView } from "@/components/torob/map-view";
import { NearbyView } from "@/components/torob/nearby-view";
import { AgentView } from "@/components/torob/agent-view";
import {
  NEIGHBORHOODS,
  type MetaResponse,
  type Neighborhood,
  type StatsCategory,
  type StatsResponse,
} from "@/components/torob/types";

type View = "home" | "search" | "product" | "shops" | "nearby" | "map" | "agent";

const TABS: { id: View; label: string; icon: React.ReactNode; hideInNav?: boolean }[] = [
  { id: "home", label: "خانه", icon: <HomeIcon className="size-4" aria-hidden /> },
  { id: "nearby", label: "خرید حضوری", icon: <Navigation className="size-4" aria-hidden /> },
  { id: "search", label: "جست‌وجو", icon: <Search className="size-4" aria-hidden /> },
  { id: "shops", label: "فروشگاه‌ها", icon: <Store className="size-4" aria-hidden /> },
  { id: "map", label: "نقشه", icon: <MapPin className="size-4" aria-hidden /> },
  { id: "agent", label: "دستیار هوشمند", icon: <Bot className="size-4" aria-hidden /> },
];

function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className="size-11" aria-hidden />;
  }
  const isDark = (resolvedTheme ?? theme) === "dark";
  return (
    <Button
      variant="outline"
      size="icon"
      className="size-11 shrink-0"
      aria-label={isDark ? "تغییر به حالت روشن" : "تغییر به حالت تیره"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </Button>
  );
}

export default function Home() {
  const [view, setView] = React.useState<View>("home");
  const [searchFilters, setSearchFilters] = React.useState<SearchFiltersState>(DEFAULT_SEARCH_FILTERS);
  const [selectedProductId, setSelectedProductId] = React.useState<string | null>(null);
  const [shopsNear, setShopsNear] = React.useState<Neighborhood | "all">("all");
  const [mapNear, setMapNear] = React.useState<Neighborhood | "all">("all");

  const [meta, setMeta] = React.useState<MetaResponse | null>(null);
  const [categories, setCategories] = React.useState<StatsCategory[]>([]);
  const [loadingMeta, setLoadingMeta] = React.useState(true);
  const [loadingStats, setLoadingStats] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/meta")
      .then((r) => r.json())
      .then((j: MetaResponse) => {
        if (!cancelled) setMeta(j);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingMeta(false));
    fetch("/api/stats")
      .then((r) => r.json())
      .then((j: StatsResponse) => {
        if (!cancelled) setCategories(j.categories ?? []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingStats(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // navigation helpers
  const goSearch = (q: string) => {
    setSearchFilters({ ...DEFAULT_SEARCH_FILTERS, q });
    setView("search");
  };

  const selectProduct = (id: string) => {
    setSelectedProductId(id);
    setView("product");
  };

  const backFromProduct = () => {
    // if a search is in progress, go back to it; else home
    if (searchFilters.q.trim()) setView("search");
    else setView("home");
  };

  const tabsToShow = TABS.filter((t) => !t.hideInNav);

  // product view needs the near/radius from the search filters
  const productNear =
    searchFilters.near === "all" ? null : searchFilters.near;
  const productRadius = searchFilters.near === "all" ? null : searchFilters.radius_km;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SyntheticBanner isSynthetic={meta?.is_synthetic ?? false} />

      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => setView("home")}
            className="flex items-center gap-2"
            aria-label="طرب‌گارد — خانه"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Store className="size-5" aria-hidden />
            </span>
            <span className="text-lg font-extrabold tracking-tight">طرب‌گارد</span>
          </button>

          <nav className="hidden md:block" aria-label="نماها">
            <ul className="flex items-center gap-1">
              {tabsToShow.map((t) => (
                <li key={t.id}>
                  <Button
                    variant={view === t.id ? "secondary" : "ghost"}
                    size="sm"
                    className="min-h-9 gap-1.5"
                    onClick={() => setView(t.id)}
                  >
                    {t.icon}
                    {t.label}
                  </Button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>

        {/* Mobile tab bar */}
        <nav className="md:hidden" aria-label="نماها">
          <ul className="scrollbar-thin mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 pb-2">
            {tabsToShow.map((t) => (
              <li key={t.id} className="shrink-0">
                <Button
                  variant={view === t.id ? "secondary" : "ghost"}
                  size="sm"
                  className="min-h-11 min-w-11 gap-1.5 px-3"
                  onClick={() => setView(t.id)}
                >
                  {t.icon}
                  <span className="text-xs">{t.label}</span>
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* Main content (grows to push footer down) */}
      <main className="flex-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={view + (view === "product" ? selectedProductId ?? "" : "")}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {view === "home" && (
              <HomeView
                meta={meta}
                categories={categories}
                loadingMeta={loadingMeta}
                loadingStats={loadingStats}
                onSearch={goSearch}
              />
            )}
            {view === "search" && (
              <SearchView
                filters={searchFilters}
                onFiltersChange={(next) => setSearchFilters(next)}
                onSelectProduct={selectProduct}
              />
            )}
            {view === "product" && selectedProductId && (
              <ProductView
                productId={selectedProductId}
                near={productNear}
                radiusKm={productRadius}
                onBack={backFromProduct}
                onSelectProduct={selectProduct}
              />
            )}
            {view === "product" && !selectedProductId && (
              <div className="mx-auto max-w-3xl px-4 py-12 text-center text-muted-foreground">
                محصولی انتخاب نشده است.
              </div>
            )}
            {view === "shops" && (
              <ShopsView
                initialNear={shopsNear}
                onNearChange={(n) => setShopsNear(n)}
              />
            )}
            {view === "nearby" && <NearbyView />}
            {view === "map" && (
              <MapView near={mapNear} onNearChange={(n) => setMapNear(n)} />
            )}
            {view === "agent" && <AgentView />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Store className="size-4" aria-hidden />
                </span>
                <span className="font-bold">طرب‌گارد</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                دستیار خرید هوشمند تهران — جست‌وجو، مقایسه قیمت و پیدا کردن نزدیک‌ترین
                فروشگاه.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">نکات داده</h4>
              <DisclaimerList />
            </div>

            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">محله‌های پشتیبانی‌شده</h4>
              <div className="flex flex-wrap gap-1.5">
                {NEIGHBORHOODS.map((n) => (
                  <span
                    key={n}
                    className="rounded-full border border-border bg-card px-2 py-1 text-xs"
                  >
                    {n}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground sm:flex-row">
            <p>
              © {new Date().getFullYear()} طرب‌گارد —{" "}
              {meta?.is_synthetic
                ? "نسخه نمایشی با داده مصنوعی."
                : "پشتیبانی‌شده با دیتاست Torob."}
            </p>
            <p>طراحی‌شده برای کاربران فارسی‌زبان در تهران.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
