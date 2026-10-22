"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";

import { SyntheticBanner, DisclaimerList } from "@/components/torob/disclaimers";
import { HomeView } from "@/components/torob/home-view";
import { SearchView, DEFAULT_SEARCH_FILTERS, type SearchFiltersState } from "@/components/torob/search-view";
import { ProductView } from "@/components/torob/product-view";
import { AssistantView } from "@/components/torob/assistant-view";
import { ShopsMapView } from "@/components/torob/shops-map-view";
import { TripView } from "@/components/torob/trip-view";
import { TopNav, type NavBarView } from "@/components/torob/top-nav";
import {
  NEIGHBORHOODS,
  type MetaResponse,
  type Neighborhood,
  type StatsCategory,
  type StatsResponse,
} from "@/components/torob/types";

/**
 * Redesigned IA. Top-level navigation is intentionally slim:
 *   home | assistant | shops
 * Everything else (product/compare, in-store shopping, trip planning, search
 * results) opens INSIDE the assistant flow or as a product detail — never as
 * a parallel top-level tab. This keeps "in-person shopping" the destination,
 * not a sibling section.
 */

type View = "home" | "assistant" | "search" | "shops" | "trip" | "product";

export default function Home() {
  // top-nav active tab (only home/assistant/shops are real tabs)
  const [nav, setNav] = React.useState<NavBarView>("home");
  // internal view: "product" overlays the current nav tab
  const [internal, setInternal] = React.useState<"product" | null>(null);
  const [searchFilters, setSearchFilters] = React.useState<SearchFiltersState>(DEFAULT_SEARCH_FILTERS);
  const [selectedProductId, setSelectedProductId] = React.useState<string | null>(null);
  const [shopsNear, setShopsNear] = React.useState<Neighborhood | "all">("all");

  const [meta, setMeta] = React.useState<MetaResponse | null>(null);
  const [categories, setCategories] = React.useState<StatsCategory[]>([]);
  const [loadingMeta, setLoadingMeta] = React.useState(true);
  const [loadingStats, setLoadingStats] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/meta").then((r) => r.json()).then((j: MetaResponse) => { if (!cancelled) setMeta(j); }).catch(() => {}).finally(() => !cancelled && setLoadingMeta(false));
    fetch("/api/stats").then((r) => r.json()).then((j: StatsResponse) => { if (!cancelled) setCategories(j.categories ?? []); }).catch(() => {}).finally(() => !cancelled && setLoadingStats(false));
    return () => { cancelled = true; };
  }, []);

  const goSearch = (q: string) => {
    setSearchFilters({ ...DEFAULT_SEARCH_FILTERS, q });
    setNav("search");
    setInternal(null);
  };

  const selectProduct = (id: string) => {
    setSelectedProductId(id);
    setInternal("product");
  };

  const backFromProduct = () => {
    setInternal(null);
  };

  const setNavView = (v: NavBarView) => {
    setNav(v);
    setInternal(null);
  };

  const productNear = searchFilters.near === "all" ? null : searchFilters.near;
  const productRadius = searchFilters.near === "all" ? null : searchFilters.radius_km;

  // effective view for rendering
  const view: View = internal === "product" && selectedProductId ? "product" : nav;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SyntheticBanner isSynthetic={meta?.is_synthetic ?? false} />

      <TopNav view={nav} onView={setNavView} />

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
                onOpenAssistant={() => setNavView("assistant")}
              />
            )}
            {view === "assistant" && (
              <AssistantView
                onPickProduct={selectProduct}
              />
            )}
            {view === "search" && (
              <SearchView
                filters={searchFilters}
                onFiltersChange={(next) => setSearchFilters(next)}
                onSelectProduct={selectProduct}
              />
            )}
            {view === "shops" && (
              <ShopsMapView near={shopsNear} onNearChange={(n) => setShopsNear(n)} />
            )}
            {view === "trip" && <TripView />}
            {view === "product" && selectedProductId && (
              <ProductView
                productId={selectedProductId}
                near={productNear}
                radiusKm={productRadius}
                onBack={backFromProduct}
                onSelectProduct={selectProduct}
              />
            )}
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
                  <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 9l1-5h16l1 5M4 9v11h16V9M4 9h16" /></svg>
                </span>
                <span className="font-bold">ترب‌گرد</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                دستیار خرید حضوری تهران — از «نمی‌دانم چی بخرم» تا «می‌دانم کدام فروشگاه نزدیک است».
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
                  <span key={n} className="rounded-full border border-border bg-card px-2 py-1 text-xs">{n}</span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-col items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground sm:flex-row">
            <p>© {new Date().getFullYear()} ترب‌گرد — دستیار خرید تهران.</p>
            <p>طراحی‌شده برای کاربران فارسی‌زبان در تهران.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
