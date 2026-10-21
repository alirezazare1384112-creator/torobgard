/**
 * Shared types for the Torobgard frontend. These mirror the API response
 * shapes from /api/* (built in src/app/api/* and src/lib/torob/tools.ts) but
 * are decoupled from the server so client components stay independent.
 */

export interface MetaResponse {
  is_synthetic: boolean;
  source: string | null;
  note: string | null;
  imported_at: string | null;
  price_bounds_toman: string | null;
  counts: {
    shops: number;
    products: number;
    offers: number;
  };
}

export interface StatsCategory {
  category: string;
  c: number;
}

export interface StatsResponse {
  counts: { shops: number; products: number; offers: number };
  price_status: Record<string, number>;
  price_bounds_ok: { min: number | null; max: number | null };
  categories: StatsCategory[];
  meta: Record<string, string>;
}

export interface SearchItem {
  product_id: string;
  title: string;
  brand: string | null;
  category: string | null;
  min_price_toman: number | null;
  offer_count: number;
  image_url: string | null;
}

export interface SearchResponse {
  status: "ok" | "no_results" | "empty_query";
  total: number;
  limit: number;
  offset: number;
  items: SearchItem[];
}

export interface ProductDetails {
  product_id: string;
  title: string;
  brand: string | null;
  category: string | null;
  model: string | null;
  images: string[];
  specs: { section: string | null; key: string | null; value: string | null }[];
  offer_count: number;
}

export interface CompareOffer {
  offer_id: string;
  price_toman: number | null;
  price_status: "ok" | "missing" | "too_low" | "too_high";
  price_changed_at: string | null;
  seller_title: string | null;
  description: string | null;
  warranty: unknown;
  shop: {
    shop_id: string;
    name: string;
    address: string | null;
    location_label: string | null;
    lat: number | null;
    lon: number | null;
    supports_fast_delivery: boolean | null;
    distance_km: number | null;
  };
}

export interface CompareResponse {
  status: string;
  product: ProductDetails | null;
  summary: {
    offer_count: number;
    min_price_toman: number | null;
    max_price_toman: number | null;
    spread_toman: number | null;
  } | null;
  offers: CompareOffer[];
}

export interface ShopItem {
  shop_id: string;
  name: string;
  address: string | null;
  location_label: string | null;
  lat: number | null;
  lon: number | null;
  supports_fast_delivery: boolean | null;
  website_url: string | null;
  instagram: string | null;
  weekly_hours: string | null;
  payment_options: string | null;
  matching_offers: number;
  best_price_toman: number | null;
  distance_km: number | null;
  name_is_synthetic_warning: boolean;
}

export interface ShopsResponse {
  status: string;
  total: number;
  shops: ShopItem[];
}

export interface AlternativeItem {
  product_id: string;
  title: string;
  brand: string | null;
  min_price_toman: number | null;
  offer_count: number;
}

export interface AlternativesResponse {
  status: string;
  basis: string | null;
  alternatives: AlternativeItem[];
}

export interface AgentResponse {
  reply: string;
  tool: string | null;
  tool_args: Record<string, unknown> | null;
  tool_result: unknown;
  tool_error: string | null;
  error?: string;
  code?: string;
}

export type SortOption = "relevance" | "price_asc" | "price_desc" | "distance";
export type ShopSortOption = "matching_offers" | "distance" | "price_asc" | "price_desc";

/** The 6 Tehran neighborhoods the backend supports (NEIGHBORHOODS in tools.ts). */
export const NEIGHBORHOODS = [
  "صادقیه",
  "ولنجک",
  "ونک",
  "میدان ولیعصر",
  "تجریش",
  "شریعتی",
] as const;

export type Neighborhood = (typeof NEIGHBORHOODS)[number];

/** Approx lat/lon of the 6 neighborhoods, used by the schematic SVG map. */
export const NEIGHBORHOOD_COORDS: Record<Neighborhood, [number, number]> = {
  صادقیه: [35.7467, 51.336],
  ولنجک: [35.779, 51.387],
  ونک: [35.765, 51.412],
  "میدان ولیعصر": [35.6997, 51.413],
  تجریش: [35.805, 51.43],
  شریعتی: [35.76, 51.433],
};
