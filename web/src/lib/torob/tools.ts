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
  installment_only?: boolean | null;
  open_now?: boolean | null;
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
    installment_only: f?.installment_only ?? null,
    open_now: f?.open_now ?? null,
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

// --- shop enrichment helpers (Tehran / Asia timezone) ----------------------
// weekly_hours JSON: { "sat": {"status":"declared","shifts":[{"start_time":"10:00:00","end_time":"19:00:00"}]}, ... }
// Returns today's status and shift window, with the timezone set to Asia/Tehran.

const DAY_KEYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"] as const;
type DayKey = (typeof DAY_KEYS)[number];

function tehranNow(): Date {
  // Asia/Tehran is UTC+3:30 with no DST since 2022.
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + 3.5 * 3600000);
}

function todayKey(d = tehranNow()): DayKey {
  // JS getDay(): 0=Sun..6=Sat. Map to our keys.
  const map: Record<number, DayKey> = { 6: "sat", 0: "sun", 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri" };
  return map[d.getDay()] ?? "sat";
}

function hhmmToMinutes(t: string | undefined): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function parseTodayHours(
  weeklyRaw: string | null
): { status: string; open: string; close: string; isOpen: boolean | null } | null {
  if (!weeklyRaw) return null;
  let h: any;
  try {
    h = JSON.parse(weeklyRaw);
  } catch {
    return null;
  }
  if (!h || typeof h !== "object") return null;
  const key = todayKey();
  const day = h[key];
  if (!day) return null;
  const status = day.status ?? "declared";
  if (status === "closed") return { status, open: "", close: "", isOpen: false };
  if (status === "unsupported") return { status, open: "", close: "", isOpen: null };
  const shift = Array.isArray(day.shifts) && day.shifts.length ? day.shifts[0] : null;
  if (!shift) return { status, open: "", close: "", isOpen: null };
  const open = String(shift.start_time ?? "").slice(0, 5);
  const close = String(shift.end_time ?? "").slice(0, 5);
  const nowMin = tehranNow().getHours() * 60 + tehranNow().getMinutes();
  const oMin = hhmmToMinutes(open);
  const cMin = hhmmToMinutes(close);
  let isOpen: boolean | null = false;
  if (oMin === null || cMin === null || (cMin <= oMin && cMin !== 0)) isOpen = null;
  else if (cMin === 0) isOpen = nowMin >= oMin; // open-ended (end_time 00:00:00 means open rest of day)
  else isOpen = nowMin >= oMin && nowMin < cMin;
  return { status, open, close, isOpen };
}

function hasInstallment(paymentRaw: string | null): boolean {
  if (!paymentRaw) return false;
  let p: any;
  try {
    p = JSON.parse(paymentRaw);
  } catch {
    return false;
  }
  if (!Array.isArray(p)) return false;
  return p.some((x: any) => x && typeof x.provider_name === "string" && x.provider_name.length > 0);
}

function parseContacts(contactsRaw: string | null): { channel: string; display_number: string }[] | null {
  if (!contactsRaw) return null;
  let c: any;
  try {
    c = JSON.parse(contactsRaw);
  } catch {
    return null;
  }
  if (!Array.isArray(c)) return null;
  return c
    .filter((x: any) => x && typeof x.channel === "string" && typeof x.display_number === "string")
    .map((x: any) => ({ channel: x.channel, display_number: x.display_number }));
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
    if (f.installment_only) {
      // a shop has installment if payment_options JSON has at least one entry
      // with a non-empty provider_name (اسنپ‌پی/ترب‌پی/دیجی‌پی per the dataset)
      conds.push(
        "AND o.shop_id IN (SELECT shop_id FROM shops WHERE payment_options IS NOT NULL AND payment_options NOT IN ('[]','') AND payment_options LIKE '%provider_name%')"
      );
    }
    if (f.near) {
      const [lat, lon] = f.near;
      // When radius_km is explicitly set, use it as a hard filter. When it's
      // null, use a LARGE bounding box (~30km) purely as a SQL pre-filter so
      // we don't compute haversine for shops in Shiraz — but it must NOT hide
      // any shop in greater Tehran. 30km covers all of Tehran + suburbs.
      // The actual radius filtering (if any) happens in the post-filter loop.
      const radius = f.radius_km ?? 30.0;
      const dlat = radius / 111.0;
      const dlon = radius / (111.0 * Math.cos((lat * Math.PI) / 180));
      conds.push(
        "AND o.shop_id IN (SELECT shop_id FROM shops WHERE lat IS NOT NULL AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?)"
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
      // title_norm uses spaces (ZWNJ collapsed). Match any of the wireless
      // markers: "بی سیم" (Persian), "wireless" (English), "وایرلس" (Persian
      // transliteration of "wireless"). Each needs its own LIKE ? placeholder.
      connConds.push("AND (p.title_norm LIKE ? OR p.title_norm LIKE ? OR p.title_norm LIKE ?)");
      connParams.push("%بی سیم%", "%wireless%", "%وایرلس%");
      connConds.push("AND p.title_norm NOT LIKE ?");
      connConds.push("AND p.title_norm NOT LIKE ?");
      connConds.push("AND p.title_norm NOT LIKE ?");
      connParams.push("%با سیم%", "%سیمی%", "%wired%");
    } else if (parsed.connectivity === "wired") {
      connConds.push("AND (p.title_norm LIKE ? OR p.title_norm LIKE ? OR p.title_norm LIKE ?)");
      connParams.push("%با سیم%", "%سیمی%", "%wired%");
    }
    const connClause = connConds.join(" ");

    // Separate positive terms (must match) from negative terms (must NOT match)
    const positiveTerms = terms.filter((t) => !t.startsWith("-"));
    const negativeTerms = terms.filter((t) => t.startsWith("-")).map((t) => t.slice(1));

    if (positiveTerms.length === 0 && negativeTerms.length === 0 && parsed.connectivity === null)
      return result([], 0, f, "empty_query");

    // Build WHERE clause: all positive terms must match (AND), all negative
    // terms must NOT match (AND NOT).
    const whereParts: string[] = [];
    const termParams: string[] = [];
    for (const t of positiveTerms) {
      whereParts.push("p.title_norm LIKE ?");
      termParams.push(`%${t}%`);
    }
    for (const t of negativeTerms) {
      whereParts.push("p.title_norm NOT LIKE ?");
      termParams.push(`%${t}%`);
    }
    const where = whereParts.join(" AND ");

    // If no positive terms at all (only negatives), use "1=1" as base
    const whereSql = where || "1=1";

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
          `SELECT COUNT(*) c FROM products p WHERE ${whereSql} ${connClause} ${offerClause}`
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
    // nearest-shop subquery: pick the shop with the lowest valid offer price
    // for this product (the same shop the min_price comes from). We join on
    // offers + shops, filter price_status='ok', and ORDER BY price ASC LIMIT 1.
    const nearSubselect = `
      (SELECT s.shop_id FROM offers o2
         JOIN shops s ON s.shop_id = o2.shop_id
         WHERE o2.product_id = p.product_id AND o2.price_status = 'ok'
         ORDER BY o2.price_toman ASC LIMIT 1) AS nearest_shop_id,
      (SELECT s.name FROM offers o2
         JOIN shops s ON s.shop_id = o2.shop_id
         WHERE o2.product_id = p.product_id AND o2.price_status = 'ok'
         ORDER BY o2.price_toman ASC LIMIT 1) AS nearest_shop_name,
      (SELECT s.lat FROM offers o2
         JOIN shops s ON s.shop_id = o2.shop_id
         WHERE o2.product_id = p.product_id AND o2.price_status = 'ok'
         ORDER BY o2.price_toman ASC LIMIT 1) AS nearest_shop_lat,
      (SELECT s.lon FROM offers o2
         JOIN shops s ON s.shop_id = o2.shop_id
         WHERE o2.product_id = p.product_id AND o2.price_status = 'ok'
         ORDER BY o2.price_toman ASC LIMIT 1) AS nearest_shop_lon
    `;
    const rows = this.db
      .prepare(
        `
        SELECT p.product_id, p.title, p.brand, p.category, p.title_norm,
               (SELECT MIN(o.price_toman) FROM offers o
                  WHERE o.product_id = p.product_id AND o.price_status = 'ok' ${offerConds}) AS min_price,
               (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.product_id ${offerConds}) AS offer_count,
               p.image_urls,
               ${nearSubselect}
        FROM products p
        WHERE ${whereSql} ${connClause} ${offerClause}
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
          nearest_shop_id: r.nearest_shop_id ?? null,
          nearest_shop_name: r.nearest_shop_name ?? null,
          nearest_shop_lat: r.nearest_shop_lat ?? null,
          nearest_shop_lon: r.nearest_shop_lon ?? null,
          distance_km: f.near && r.nearest_shop_lat !== null && r.nearest_shop_lon !== null
            ? Math.round(haversineKm(f.near, [r.nearest_shop_lat, r.nearest_shop_lon]) * 100) / 100
            : null,
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
    } else if (f.sort === "distance" && f.near) {
      // distance sort: nearest first; null distances (no nearest shop with
      // coords) pushed to the end. Falls back to price-asc when there's no
      // `near` (distance is undefined — can't sort by it).
      sorted.sort(
        (a, b) => {
          const ad = a.item.distance_km ?? Infinity;
          const bd = b.item.distance_km ?? Infinity;
          if (ad !== bd) return ad - bd;
          return (a.item.min_price_toman ?? Infinity) - (b.item.min_price_toman ?? Infinity);
        }
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

    const items = sorted.slice(f.offset, f.offset + f.limit).map(({ item }) => {
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
               s.lat, s.lon, s.supports_fast_delivery, s.contacts,
               s.weekly_hours, s.payment_options, s.website_url, s.instagram
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
      const today = parseTodayHours(r.weekly_hours);
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
          contacts: parseContacts(r.contacts),
          weekly_hours: r.weekly_hours ?? null,
          payment_options: r.payment_options ?? null,
          has_installment: hasInstallment(r.payment_options),
          open_now: today?.isOpen ?? null,
          today_hours: today ? { status: today.status, open: today.open, close: today.close } : null,
          website_url: r.website_url ?? null,
          instagram: r.instagram ?? null,
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
               s.supports_fast_delivery, s.website_url, s.instagram, s.contacts,
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
      const installment = hasInstallment(r.payment_options);
      if (f.installment_only && !installment) continue;
      const today = parseTodayHours(r.weekly_hours);
      const openNow = today?.isOpen ?? null;
      if (f.open_now && openNow !== true) continue;
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
        contacts: parseContacts(r.contacts),
        weekly_hours: r.weekly_hours ?? null,
        payment_options: r.payment_options ?? null,
        has_installment: installment,
        open_now: openNow,
        today_hours: today ? { status: today.status, open: today.open, close: today.close } : null,
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

  // --------------------------------------------------- shop hours (today + any day)
  /** Returns the open/closed status for a shop, today by default or for a given
   *  weekday key ("sat".."fri"). Uses Asia/Tehran time. */
  checkShopHours(shop_id: string, day?: string): ShopHoursResponse {
    if (!shop_id || !shop_id.startsWith("shop_")) throw new Error("invalid shop_id");
    const r = this.db
      .prepare("SELECT weekly_hours FROM shops WHERE shop_id = ?")
      .get(shop_id) as { weekly_hours: string | null } | undefined;
    if (!r) return { status: "not_found", shop_id, day: day ?? todayKey(), hours: null, open_now: null, today_hours: null, full_week: null, day_info: null };
    const key = (day as DayKey) || todayKey();
    const today = parseTodayHours(r.weekly_hours);
    let fullWeek: Record<string, { status: string; open: string; close: string }> | null = null;
    if (r.weekly_hours) {
      try {
        const h = JSON.parse(r.weekly_hours);
        if (h && typeof h === "object") {
          fullWeek = {};
          for (const d of DAY_KEYS) {
            const dd = h[d];
            if (!dd) { fullWeek[d] = { status: "unknown", open: "", close: "" }; continue; }
            const shift = Array.isArray(dd.shifts) && dd.shifts.length ? dd.shifts[0] : null;
            fullWeek[d] = {
              status: dd.status ?? "unknown",
              open: shift ? String(shift.start_time ?? "").slice(0, 5) : "",
              close: shift ? String(shift.end_time ?? "").slice(0, 5) : "",
            };
          }
        }
      } catch {}
    }
    let dayInfo: { status: string; open: string; close: string } | null = null;
    if (fullWeek && fullWeek[key]) dayInfo = fullWeek[key];
    return {
      status: "ok",
      shop_id,
      day: key,
      hours: r.weekly_hours,
      open_now: today?.isOpen ?? null,
      today_hours: today ? { status: today.status, open: today.open, close: today.close } : null,
      full_week: fullWeek,
      day_info: dayInfo,
    };
  }

  // ------------------------------------------------- prepare seller inquiry text
  /** Builds a ready-to-send Persian inquiry message asking the shop to confirm
   *  price + stock for a specific product. Returns the message text + the
   *  structured questions. The user (or agent) then sends this via phone/messenger
   *  themselves — we do NOT auto-send (no telephony channel in this environment). */
  prepareSellerInquiry(args: {
    shop_id: string;
    product_id: string;
    color?: string | null;
    size?: string | null;
    ask_installment?: boolean;
  }): SellerInquiryResponse {
    const { shop_id, product_id } = args;
    if (!shop_id || !shop_id.startsWith("shop_")) throw new Error("invalid shop_id");
    if (!product_id || !product_id.startsWith("product_")) throw new Error("invalid product_id");
    const shop = this.db
      .prepare("SELECT shop_id, name, contacts FROM shops WHERE shop_id = ?")
      .get(shop_id) as { shop_id: string; name: string; contacts: string | null } | undefined;
    if (!shop) return { status: "not_found", message: null, questions: [], shop: null, product: null, known_price: null, known_price_changed_at: null };
    const product = this.getProductDetails(product_id);
    if (!product) return { status: "not_found", message: null, questions: [], shop: null, product: null, known_price: null, known_price_changed_at: null };
    // the cheapest known offer for this product at this shop, if any
    const known = this.db
      .prepare(
        "SELECT price_toman, price_status, price_changed_at FROM offers WHERE shop_id = ? AND product_id = ?"
      )
      .get(shop_id, product_id) as { price_toman: number | null; price_status: string; price_changed_at: string | null } | undefined;
    const phone = parseContacts(shop.contacts)?.find((c) => c.channel === "phone")?.display_number ?? null;
    const lines = [
      `سلام، برای محصول زیر لطفاً موجودی و قیمت امروز را تأیید کنید:`,
      ``,
      `محصول: ${product.title}`,
      product.brand ? `برند: ${product.brand}` : null,
      product.model ? `مدل: ${product.model}` : null,
      args.color ? `رنگ موردنظر: ${args.color}` : null,
      args.size ? `اندازه: ${args.size}` : null,
      known && known.price_status === "ok" && known.price_toman !== null
        ? `قیمت ثبت‌شده در تورب: ${toFaNum(known.price_toman)} تومان (ممکن است قدیمی باشد)`
        : `قیمت ثبت‌شده: نامشخص`,
      known && known.price_changed_at ? `آخرین تغییر قیمت: ${known.price_changed_at.slice(0, 10)}` : null,
      ``,
      `سؤالات:`,
      `۱) آیا همین مدل هم‌اکنون موجود است؟`,
      `۲) رنگ/اندازهٔ موردنظر موجود است؟`,
      `۳) قیمت نهایی امروز چقدر است؟`,
      `۴) آیا تخفیف یا هزینهٔ جانبی دارد؟`,
      `۵) خرید اقساطی ممکن است؟ با چه شرایطی؟`,
      `۶) امکان نگه‌داشتن محصول تا مراجعه هست؟`,
    ].filter((x) => x !== null) as string[];
    const message = lines.join("\n");
    return {
      status: "ok",
      message,
      questions: [
        "موجودی همین مدل",
        "رنگ/اندازه",
        "قیمت امروز",
        "تخفیف/هزینه جانبی",
        args.ask_installment ? "شرایط اقساط" : null,
        "نگه‌داشتن محصول",
      ].filter((x): x is string => x !== null),
      shop: { shop_id: shop.shop_id, name: shop.name, phone },
      product: { product_id: product.product_id, title: product.title },
      known_price: known && known.price_status === "ok" ? known.price_toman : null,
      known_price_changed_at: known?.price_changed_at ?? null,
    };
  }

  // ----------------------------------------------- record a manual seller confirmation
  /** Records the result of a manual seller contact (user called/texted and
   *  entered the answer). Stored in an in-memory Map for the session — there is
   *  no persistence layer, so confirmations do not survive a server restart.
   *  This is deliberately honest: we never claim a confirmation we don't have. */
  recordSellerConfirmation(args: {
    shop_id: string;
    product_id: string;
    /** confirmed = seller confirmed price+stock; pending = waiting for seller
     *  response; no_response = seller didn't answer; unavailable = seller
     *  confirmed the product is out of stock / not carried; unconfirmed =
     *  default, no manual contact attempted yet. */
    status: "confirmed" | "pending" | "no_response" | "unavailable" | "unconfirmed";
    confirmed_price_toman?: number | null;
    in_stock?: boolean | null;
    note?: string | null;
  }): ConfirmationResponse {
    const { shop_id, product_id } = args;
    if (!shop_id || !shop_id.startsWith("shop_")) throw new Error("invalid shop_id");
    if (!product_id || !product_id.startsWith("product_")) throw new Error("invalid product_id");
    const key = `${shop_id}:${product_id}`;
    const rec: ConfirmationRecord = {
      shop_id,
      product_id,
      status: args.status,
      confirmed_price_toman: args.confirmed_price_toman ?? null,
      in_stock: args.in_stock ?? null,
      note: args.note ?? null,
      recorded_at: new Date().toISOString(),
      source: "manual",
    };
    confirmations.set(key, rec);
    return { status: "ok", record: rec, note: "recorded in memory for this session (not persisted)" };
  }

  getConfirmation(shop_id: string, product_id: string): ConfirmationRecord | null {
    return confirmations.get(`${shop_id}:${product_id}`) ?? null;
  }
}

// session-scoped manual confirmations (in-memory, no persistence layer)
const confirmations = new Map<string, ConfirmationRecord>();

function toFaNum(n: number): string {
  return n.toLocaleString("fa-IR");
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
  nearest_shop_name?: string | null;
  nearest_shop_id?: string | null;
  nearest_shop_lat?: number | null;
  nearest_shop_lon?: number | null;
  distance_km?: number | null;
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
    contacts: { channel: string; display_number: string }[] | null;
    weekly_hours: string | null;
    payment_options: string | null;
    has_installment: boolean;
    open_now: boolean | null;
    today_hours: { status: string; open: string; close: string } | null;
    website_url: string | null;
    instagram: string | null;
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
  contacts: { channel: string; display_number: string }[] | null;
  weekly_hours: string | null;
  payment_options: string | null;
  has_installment: boolean;
  open_now: boolean | null;
  today_hours: { status: string; open: string; close: string } | null;
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

export interface ShopHoursResponse {
  status: string;
  shop_id: string;
  day: string;
  hours: string | null;
  open_now: boolean | null;
  today_hours: { status: string; open: string; close: string } | null;
  full_week: Record<string, { status: string; open: string; close: string }> | null;
  day_info: { status: string; open: string; close: string } | null;
}

export interface SellerInquiryResponse {
  status: string;
  message: string | null;
  questions: string[];
  shop: { shop_id: string; name: string; phone: string | null } | null;
  product: { product_id: string; title: string } | null;
  known_price: number | null;
  known_price_changed_at: string | null;
}

export interface ConfirmationRecord {
  shop_id: string;
  product_id: string;
  status: "confirmed" | "pending" | "no_response" | "unavailable" | "unconfirmed";
  confirmed_price_toman: number | null;
  in_stock: boolean | null;
  note: string | null;
  recorded_at: string;
  source: "manual";
}

export interface ConfirmationResponse {
  status: string;
  record: ConfirmationRecord;
  note: string;
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
