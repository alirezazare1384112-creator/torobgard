/**
 * Core shopping tools — TypeScript port of tehran_agent/tools.py.
 *
 * All results come from the SQLite dataset (data/torob.sqlite) via better-sqlite3.
 * No LLM is involved here. The DB schema matches tehran_agent/importer.py exactly,
 * so the real importer output can replace the synthetic seed with no code change.
 *
 * Tools: searchProducts, getProductDetails, compareOffers, findShops,
 *        findAlternatives, planShoppingTrip.
 *
 * Phase-2 search improvement: searchProducts parses the query into product terms,
 * a wired/wireless attribute, and a budget (see normalize.parseQuery), then:
 *   - checks connectivity per-title (NOT by banning the substring "سیم"), so a
 *     "ماوس بی‌صدا با سیم" (quiet WIRED) mouse is never returned for "ماوس بی‌سیم";
 *   - applies the budget as a price filter;
 *   - demotes accessory titles ("ماوس پد") in relevance without removing them.
 */
import Database from "better-sqlite3";
import { resolve as resolvePath } from "node:path";
import { normalizeText, parseQuery, hasTokenPair, type ParsedQuery } from "./normalize.ts";

export const DEFAULT_DB = "data/torob.sqlite";
export const MAX_LIMIT = 100;

// Named reference points in Tehran (from tools.py).
export const NEIGHBORHOODS: Record<string, [number, number]> = {
  "صادقیه": [35.7467, 51.336],
  "ولنجک": [35.779, 51.387],
  "ونک": [35.765, 51.412],
  "میدان ولیعصر": [35.6997, 51.413],
  "تجریش": [35.805, 51.43],
  "شریعتی": [35.76, 51.433],
};

// Accessory-ish title markers that should be demoted, not removed, for a
// device search (e.g. a mouse query should rank a real mouse above a mouse pad).
const ACCESSORY_MARKERS = ["پد", "پده", "استند", "کیف", "محافظ", "شارژر"];

export interface Filters {
  min_price?: number | null;
  max_price?: number | null;
  brand?: string | null;
  category?: string | null;
  near?: [number, number] | null;
  radius_km?: number | null;
  fast_delivery?: boolean | null;
  sort?: "relevance" | "price_asc" | "price_desc" | "distance" | "matching_offers";
  limit?: number;
  offset?: number;
}

export function defaultFilters(f?: Filters): RequiredExcept<Filters> {
  return {
    min_price: f?.min_price ?? null,
    max_price: f?.max_price ?? null,
    brand: f?.brand ?? null,
    category: f?.category ?? null,
    near: f?.near ?? null,
    radius_km: f?.radius_km ?? null,
    fast_delivery: f?.fast_delivery ?? null,
    sort: f?.sort ?? "relevance",
    limit: f?.limit ?? 20,
    offset: f?.offset ?? 0,
  };
}

type RequiredExcept<T> = { [K in keyof T]-?: T[K] };

export function validateFilters(f: Filters): void {
  const sort = f.sort ?? "relevance";
  if (!["relevance", "price_asc", "price_desc", "distance", "matching_offers"].includes(sort)) {
    throw new Error("invalid sort: " + sort);
  }
  const min = f.min_price ?? null;
  const max = f.max_price ?? null;
  if (min !== null && max !== null && min > max) throw new Error("min_price > max_price");
  if (min !== null && min < 0) throw new Error("min_price < 0");
  if (max !== null && max < 0) throw new Error("max_price < 0");
  f.limit = Math.max(1, Math.min(Math.floor(f.limit ?? 20), MAX_LIMIT));
  f.offset = Math.max(0, Math.floor(f.offset ?? 0));
  if (f.near) {
    const [lat, lon] = f.near;
    if (!(35.4 <= lat && lat <= 36.1 && 50.9 <= lon && lon <= 51.8)) {
      throw new Error("location outside supported Tehran area");
    }
  }
}

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371.0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function resolveLocation(text: string | null | undefined): [number, number] | null {
  if (!text) return null;
  const t = normalizeText(text);
  for (const name of Object.keys(NEIGHBORHOODS)) {
    if (normalizeText(name) && t.includes(normalizeText(name))) {
      return NEIGHBORHOODS[name];
    }
  }
  return null;
}

// --- helpers --------------------------------------------------------------
function jsonOr<T = unknown>(raw: string | null | undefined, fallback: T): unknown {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function firstImage(raw: string | null | undefined): string | null {
  const urls = jsonOr(raw, []);
  return Array.isArray(urls) && urls.length ? String(urls[0]) : null;
}

function allImages(raw: string | null | undefined): string[] {
  const urls = jsonOr(raw, []);
  return Array.isArray(urls) ? urls.map(String) : [];
}

function boolOrNull(v: number | null): boolean | null {
  return v === null || v === undefined ? null : Boolean(v);
}

// --- ShoppingTools --------------------------------------------------------
export class ShoppingTools {
  private db: Database.Database;
  readonly isSynthetic: boolean;

  constructor(dbPath: string = DEFAULT_DB) {
    const path = resolvePath(process.cwd(), dbPath);
    this.db = new Database(path, { readonly: true, fileMustExist: true });
    // Note: do NOT set journal_mode=WAL here — that is a write and fails on a
    // read-only connection. The seed script already uses WAL; readers honor it.
    const meta = this.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get("is_synthetic") as { value?: string } | undefined;
    this.isSynthetic = meta?.value === "true";
  }

  close(): void {
    this.db.close();
  }

  get counts(): { shops: number; products: number; offers: number } {
    const get = (t: string) => (this.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as any).c;
    return { shops: get("shops"), products: get("products"), offers: get("offers") };
  }

  // offer-level conditions shared by search/compare/find_shops
  private offerConditions(f: RequiredExcept<Filters>): { conds: string; params: any[] } {
    const conds: string[] = [];
    const params: any[] = [];
    if (f.min_price !== null) {
      conds.push("AND o.price_status = 'ok' AND o.price_toman >= ?");
      params.push(f.min_price);
    }
    if (f.max_price !== null) {
      conds.push("AND o.price_status = 'ok' AND o.price_toman <= ?");
      params.push(f.max_price);
    }
    if (f.fast_delivery) {
      conds.push("AND o.shop_id IN (SELECT shop_id FROM shops WHERE supports_fast_delivery = 1)");
    }
    if (f.near) {
      const [lat, lon] = f.near;
      const radius = f.radius_km ?? 5.0;
      const dlat = radius / 111.0;
      const dlon = radius / (111.0 * Math.cos((lat * Math.PI) / 180));
      conds.push(
        "AND o.shop_id IN (SELECT shop_id FROM shops WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?)"
      );
      params.push(lat - dlat, lat + dlat, lon - dlon, lon + dlon);
    }
    return { conds: conds.join(" "), params };
  }

  // ---------------------------------------------------------------- search
  searchProducts(query: string, filters?: Filters): SearchResponse {
    const f = defaultFilters(filters);
    validateFilters(f as Filters);

    const parsed = parseQuery(query);
    // terms may come from parsed; if parseQuery yielded nothing, fall back to
    // splitting the raw normalized query (keeps "zzzqqqxxx" -> no_results path).
    let terms = parsed.terms;
    if (terms.length === 0) {
      terms = normalizeText(query)
        .split(/\s+/)
        .filter((t) => t.length > 1);
    }
    if (terms.length === 0) return result([], 0, f, "empty_query");

    // Connectivity: push the attribute into SQL so `total` and `items` agree.
    // title_norm uses spaces (ZWNJ collapsed), so "بی سیم" / "با سیم" are
    // contiguous substrings. The classic trap "ماوس بی‌صدا با سیم" normalizes
    // to "...بی صدا با سیم" — it contains "با سیم" and NOT "بی سIM", so a
    // wireless query (requires "بی سیم") excludes it, and a wired query
    // (requires "با سیم" and forbids "بی سیم") includes it.
    // Phase-2 parity: also match the single-token adjective "سیمی" and the
    // English words "wireless"/"wired".
    const connConds: string[] = [];
    const connParams: string[] = [];
    if (parsed.connectivity === "wireless") {
      connConds.push("AND (p.title_norm LIKE ? OR p.title_norm LIKE ?)");
      connParams.push("%بی سیم%", "%wireless%");
      connConds.push("AND p.title_norm NOT LIKE ?");
      connConds.push("AND p.title_norm NOT LIKE ?");
      connConds.push("AND p.title_norm NOT LIKE ?");
      connParams.push("%با سیم%", "%سیمی%", "%wired%");
    } else if (parsed.connectivity === "wired") {
      connConds.push("AND (p.title_norm LIKE ? OR p.title_norm LIKE ? OR p.title_norm LIKE ?)");
      connParams.push("%با سیم%", "%سیمی%", "%wired%");
    }
    const connClause = connConds.join(" ");

    const where = terms.map(() => "p.title_norm LIKE ?").join(" AND ");
    const termParams = terms.map((t) => `%${t}%`);

    // fold parsed budget into filters (explicit filters take precedence)
    if (f.min_price === null && parsed.minBudget !== null) f.min_price = parsed.minBudget;
    if (f.max_price === null && parsed.maxBudget !== null) f.max_price = parsed.maxBudget;

    const { conds: offerConds, params: offerParams } = this.offerConditions(f);
    const offerClause = offerConds
      ? `AND EXISTS (SELECT 1 FROM offers o WHERE o.product_id = p.product_id ${offerConds})`
      : "AND EXISTS (SELECT 1 FROM offers o WHERE o.product_id = p.product_id)";

    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) c FROM products p WHERE ${where} ${connClause} ${offerClause}`
        )
        .get(...termParams, ...connParams, ...offerParams) as any
    ).c;

    // NOTE: better-sqlite3 binds ? in LEXICAL order across the whole statement.
    // The SELECT clause's two correlated subqueries come before the WHERE
    // clause in the text, so the parameter order is:
    //   min_price subq (offerParams) + offer_count subq (offerParams)
    //   + WHERE terms (termParams) + conn (connParams)
    //   + EXISTS offerConds (offerParams)
    //   + LIMIT, OFFSET
    const rows = this.db
      .prepare(
        `
        SELECT p.product_id, p.title, p.brand, p.category, p.title_norm,
               (SELECT MIN(o.price_toman) FROM offers o
                  WHERE o.product_id = p.product_id AND o.price_status = 'ok' ${offerConds}) AS min_price,
               (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.product_id ${offerConds}) AS offer_count,
               p.image_urls
        FROM products p
        WHERE ${where} ${connClause} ${offerClause}
        LIMIT ? OFFSET ?
        `
      )
      .all(
        ...offerParams, // min_price subquery
        ...offerParams, // offer_count subquery
        ...termParams, // WHERE term LIKEs
        ...connParams, // WHERE connectivity
        ...offerParams, // EXISTS offer conditions
        MAX_LIMIT * 4,
        f.offset
      ) as any[];

    // Relevance scoring. Connectivity is already enforced in SQL (see above),
    // so no per-title dropping is needed here — we only adjust ranking.
    type Item = SearchItem & { _norm: string };
    const scored: { item: Item; score: number }[] = [];
    for (const r of rows) {
      const norm: string = r.title_norm || normalizeText(r.title);
      let score = 0;
      // demote accessory markers (mause pad, etc.) — do NOT remove them
      if (ACCESSORY_MARKERS.some((m) => norm.includes(m))) score -= 50;
      // reward titles that contain all terms contiguously
      const joined = terms.join(" ");
      if (norm.includes(joined)) score += 20;
      // reward having a valid (ok) min_price so real devices surface first
      if (r.min_price !== null) score += 5;
      scored.push({
        item: {
          product_id: r.product_id,
          title: r.title,
          brand: r.brand ?? null,
          category: r.category ?? null,
          min_price_toman: r.min_price ?? null,
          offer_count: r.offer_count ?? 0,
          image_url: firstImage(r.image_urls),
          _norm: norm,
        },
        score,
      });
    }

    // sort:
    //  - price_asc / price_desc: pure price order (matches milestone-1 contract;
    //    the ascending test in tests/test_core.py uses the default sort and
    //    expects ascending prices, so "relevance" must NOT reorder by price
    //    when there is no clear device intent).
    //  - relevance (default): price-asc order, BUT when the query carried a
    //    connectivity attribute (the user clearly wants a device, e.g.
    //    "ماوس بی‌سیم"), demote accessory titles ("ماوس پد") to the end via the
    //    relevance score, then price-asc within each score tier. A bare
    //    "ماوس" query keeps pure price-asc so prices stay globally ascending.
    let sorted = scored;
    if (f.sort === "price_asc") {
      sorted.sort(
        (a, b) =>
          (a.item.min_price_toman ?? Infinity) - (b.item.min_price_toman ?? Infinity)
      );
    } else if (f.sort === "price_desc") {
      sorted.sort(
        (a, b) =>
          (b.item.min_price_toman ?? -Infinity) - (a.item.min_price_toman ?? -Infinity)
      );
    } else if (parsed.connectivity) {
      // relevance with device intent: score desc (accessories last), price asc within tier
      sorted.sort(
        (a, b) =>
          b.score - a.score ||
          (a.item.min_price_toman ?? Infinity) - (b.item.min_price_toman ?? Infinity)
      );
    } else {
      // relevance with no device intent: pure price-asc (faithful to milestone-1)
      sorted.sort(
        (a, b) =>
          (a.item.min_price_toman ?? Infinity) - (b.item.min_price_toman ?? Infinity)
      );
    }

    const items = sorted.slice(0, f.limit).map(({ item }) => {
      const { _norm, ...rest } = item;
      return rest;
    });

    return result(items, total, f, null);
  }

  // ---------------------------------------------------------------- details
  getProductDetails(product_id: string): ProductDetails | null {
    if (!product_id || !product_id.startsWith("product_")) {
      throw new Error("invalid product_id");
    }
    const r = this.db
      .prepare("SELECT * FROM products WHERE product_id = ?")
      .get(product_id) as any;
    if (!r) return null;
    const specs = (jsonOr(r.specs, []) as any[]).map((s) => ({
      section: s?.section ?? null,
      key: s?.key ?? null,
      value: s?.value ?? null,
    }));
    const offer_count = (
      this.db
        .prepare("SELECT COUNT(*) c FROM offers WHERE product_id = ?")
        .get(product_id) as any
    ).c;
    return {
      product_id: r.product_id,
      title: r.title,
      brand: r.brand ?? null,
      category: r.category ?? null,
      model: r.model ?? null,
      images: allImages(r.image_urls),
      specs,
      offer_count,
    };
  }

  // ---------------------------------------------------------------- compare
  compareOffers(product_id: string, filters?: Filters): CompareResponse {
    const f = defaultFilters(filters);
    validateFilters(f as Filters);
    const product = this.getProductDetails(product_id);
    if (product === null) {
      return { status: "not_found", product: null, summary: null, offers: [] };
    }
    const { conds, params } = this.offerConditions(f);
    const rows = this.db
      .prepare(
        `
        SELECT o.offer_id, o.price_toman, o.price_status, o.price_changed_at,
               o.seller_title, o.description, o.warranty,
               s.shop_id, s.name AS shop_name, s.address, s.location_label,
               s.lat, s.lon, s.supports_fast_delivery
        FROM offers o JOIN shops s ON s.shop_id = o.shop_id
        WHERE o.product_id = ? ${conds}
        ORDER BY (o.price_status != 'ok'), o.price_toman ASC
        `
      )
      .all(product_id, ...params) as any[];

    const offers: Offer[] = [];
    for (const r of rows) {
      let d: number | null = null;
      if (f.near && r.lat !== null) d = Math.round(haversineKm(f.near, [r.lat, r.lon]) * 100) / 100;
      if (f.near && f.radius_km !== null && (d === null || d > f.radius_km)) continue;
      offers.push({
        offer_id: r.offer_id,
        price_toman: r.price_toman ?? null,
        price_status: r.price_status,
        price_changed_at: r.price_changed_at ?? null,
        seller_title: r.seller_title ?? null,
        description: r.description ?? null,
        warranty: (jsonOr(r.warranty, null) as any) ?? null,
        shop: {
          shop_id: r.shop_id,
          name: r.shop_name,
          address: r.address ?? null,
          location_label: r.location_label ?? null,
          lat: r.lat ?? null,
          lon: r.lon ?? null,
          supports_fast_delivery: boolOrNull(r.supports_fast_delivery),
          distance_km: d,
        },
      });
    }
    if (f.sort === "distance" && f.near) {
      offers.sort((a, b) => {
        const ad = a.shop.distance_km ?? Infinity;
        const bd = b.shop.distance_km ?? Infinity;
        return ad - bd;
      });
    }
    const valid = offers
      .filter((o) => o.price_status === "ok")
      .map((o) => o.price_toman!) as number[];
    const summary = {
      offer_count: offers.length,
      min_price_toman: valid.length ? Math.min(...valid) : null,
      max_price_toman: valid.length ? Math.max(...valid) : null,
      spread_toman: valid.length ? Math.max(...valid) - Math.min(...valid) : null,
    };
    return {
      status: offers.length ? "ok" : "no_offers",
      product,
      summary,
      offers: offers.slice(f.offset, f.offset + f.limit),
    };
  }

  // ------------------------------------------------------------------ shops
  findShops(filters?: Filters, location?: [number, number]): ShopsResponse {
    const f = defaultFilters(filters);
    if (location) f.near = location;
    validateFilters(f as Filters);

    const { conds, params } = this.offerConditions(
      defaultFilters({
        max_price: f.max_price,
        min_price: f.min_price,
        fast_delivery: f.fast_delivery,
      })
    );
    let condSql = conds;
    const p = [...params];
    if (f.category) {
      condSql += " AND o.product_id IN (SELECT product_id FROM products WHERE category = ?)";
      p.push(f.category);
    }
    if (f.brand) {
      condSql += " AND o.product_id IN (SELECT product_id FROM products WHERE brand = ?)";
      p.push(f.brand);
    }
    const rows = this.db
      .prepare(
        `
        SELECT s.shop_id, s.name, s.address, s.location_label, s.lat, s.lon,
               s.supports_fast_delivery, s.website_url, s.instagram,
               s.weekly_hours, s.payment_options,
               COUNT(o.offer_id) AS matching_offers,
               MIN(CASE WHEN o.price_status = 'ok' THEN o.price_toman END) AS best_price_toman
        FROM shops s JOIN offers o ON o.shop_id = s.shop_id
        WHERE 1=1 ${condSql}
        GROUP BY s.shop_id
        ORDER BY matching_offers DESC
        LIMIT 500
        `
      )
      .all(...p) as any[];

    const shops: Shop[] = [];
    for (const r of rows) {
      let d: number | null = null;
      if (f.near && r.lat !== null) d = Math.round(haversineKm(f.near, [r.lat, r.lon]) * 100) / 100;
      if (f.near && f.radius_km !== null && (d === null || d > f.radius_km)) continue;
      shops.push({
        shop_id: r.shop_id,
        name: r.name,
        address: r.address ?? null,
        location_label: r.location_label ?? null,
        lat: r.lat ?? null,
        lon: r.lon ?? null,
        supports_fast_delivery: boolOrNull(r.supports_fast_delivery),
        website_url: r.website_url ?? null,
        instagram: r.instagram ?? null,
        weekly_hours: r.weekly_hours ?? null,
        payment_options: r.payment_options ?? null,
        matching_offers: r.matching_offers ?? 0,
        best_price_toman: r.best_price_toman ?? null,
        distance_km: d,
        name_is_synthetic_warning: true,
      });
    }
    if (f.sort === "distance" && f.near) {
      shops.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
    } else if (f.sort === "price_asc") {
      shops.sort(
        (a, b) =>
          (a.best_price_toman ?? Infinity) - (b.best_price_toman ?? Infinity) ||
          b.matching_offers - a.matching_offers
      );
    } else if (f.sort === "price_desc") {
      shops.sort(
        (a, b) =>
          (b.best_price_toman ?? -Infinity) - (a.best_price_toman ?? -Infinity) ||
          b.matching_offers - a.matching_offers
      );
    } else {
      // relevance / matching_offers: most matching offers first, then nearest
      shops.sort(
        (a, b) =>
          b.matching_offers - a.matching_offers ||
          (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity)
      );
    }
    return {
      status: shops.length ? "ok" : "no_results",
      total: shops.length,
      shops: shops.slice(f.offset, f.offset + f.limit),
    };
  }

  // ------------------------------------------------------------ alternatives
  findAlternatives(product_id: string, budget_toman?: number | null, limit = 10): AlternativesResponse {
    const base = this.getProductDetails(product_id);
    if (base === null) return { status: "not_found", basis: null, alternatives: [] };
    if (budget_toman !== null && budget_toman !== undefined && budget_toman <= 0) {
      throw new Error("budget must be positive");
    }
    const params: any[] = [base.category, product_id];
    let budgetSql = "";
    if (budget_toman !== null && budget_toman !== undefined) {
      budgetSql = "HAVING min_price <= ?";
      params.push(budget_toman);
    }
    const rows = this.db
      .prepare(
        `
        SELECT p.product_id, p.title, p.brand,
               MIN(o.price_toman) AS min_price, COUNT(o.offer_id) AS offer_count
        FROM products p JOIN offers o ON o.product_id = p.product_id AND o.price_status = 'ok'
        WHERE p.category = ? AND p.product_id != ?
        GROUP BY p.product_id
        ${budgetSql}
        ORDER BY min_price ASC
        LIMIT ?
        `
      )
      .all(...params, limit) as any[];
    return {
      status: rows.length ? "ok" : "no_results",
      basis: "same_category",
      alternatives: rows.map((r) => ({
        product_id: r.product_id,
        title: r.title,
        brand: r.brand ?? null,
        min_price_toman: r.min_price ?? null,
        offer_count: r.offer_count ?? 0,
      })),
    };
  }

  // ------------------------------------------------------------- trip plan
  planShoppingTrip(items: { product_id: string }[], start?: [number, number], max_shops = 3): TripResponse {
    if (!items || items.length === 0) throw new Error("items must not be empty");
    const candidates: { product_id: string; offers: Offer[] }[] = [];
    for (const it of items) {
      const cmp = this.compareOffers(it.product_id, { limit: MAX_LIMIT });
      candidates.push({
        product_id: it.product_id,
        offers: cmp.offers.filter((o) => o.price_status === "ok"),
      });
    }
    // greedy: pick the shops covering the most items at the smallest total
    const shopCover = new Map<string, { shop: Offer["shop"]; items: Map<string, number> }>();
    for (const c of candidates) {
      for (const o of c.offers) {
        const sid = o.shop.shop_id;
        let entry = shopCover.get(sid);
        if (!entry) {
          entry = { shop: o.shop, items: new Map() };
          shopCover.set(sid, entry);
        }
        if (!entry.items.has(c.product_id)) entry.items.set(c.product_id, o.price_toman!);
      }
    }
    const ranked = [...shopCover.values()].sort(
      (a, b) => b.items.size - a.items.size || sum(a.items) - sum(b.items)
    );
    const chosen = ranked.slice(0, max_shops);
    const covered = new Set<string>();
    for (const e of chosen) for (const pid of e.items.keys()) covered.add(pid);
    const unmatched = candidates.filter((c) => !covered.has(c.product_id)).map((c) => c.product_id);
    const plan = chosen.map((e) => {
      let d: number | null = null;
      if (start && e.shop.lat !== null) {
        d = Math.round(haversineKm(start, [e.shop.lat, e.shop.lon!]) * 100) / 100;
      }
      return {
        shop: e.shop,
        items: [...e.items.entries()].map(([product_id, price_toman]) => ({ product_id, price_toman })),
        subtotal_toman: sum(e.items),
        straight_line_distance_km_from_start: d,
      };
    });
    return {
      status: plan.length ? "ok" : "no_results",
      assumptions: [
        "Only dataset offers with valid prices are used.",
        "Prices may have changed since last_price_changed_at.",
        "Distances are straight-line estimates, not routed travel times.",
      ],
      plan,
      unmatched_product_ids: unmatched,
    };
  }
}

function sum(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

// --- response types -------------------------------------------------------
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
  status: string;
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
export interface Offer {
  offer_id: string;
  price_toman: number | null;
  price_status: string;
  price_changed_at: string | null;
  seller_title: string | null;
  description: string | null;
  warranty: any;
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
  offers: Offer[];
}
export interface Shop {
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
  shops: Shop[];
}
export interface AlternativesResponse {
  status: string;
  basis: string | null;
  alternatives: {
    product_id: string;
    title: string;
    brand: string | null;
    min_price_toman: number | null;
    offer_count: number;
  }[];
}
export interface TripResponse {
  status: string;
  assumptions: string[];
  plan: {
    shop: Offer["shop"];
    items: { product_id: string; price_toman: number }[];
    subtotal_toman: number;
    straight_line_distance_km_from_start: number | null;
  }[];
  unmatched_product_ids: string[];
}

function result(items: SearchItem[], total: number, f: RequiredExcept<Filters>, reason: string | null): SearchResponse {
  return {
    status: reason || (items.length ? "ok" : "no_results"),
    total,
    limit: f.limit,
    offset: f.offset,
    items,
  };
}
