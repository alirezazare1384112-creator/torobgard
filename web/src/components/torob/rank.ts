/**
 * Explainable shop ranking for the in-store shopping assistant.
 *
 * The user can tune how much each criterion matters (price, distance, stock
 * confidence, open-now, installment, info-freshness). Each criterion is scored
 * 0..1 on real, explainable signals from the offer/shop data; the weighted
 * sum is the rank. The breakdown is returned so the UI can show WHY a shop
 * ranks where it does (no fake scores).
 *
 * Signals used (all from real dataset fields):
 *  - price: relative to the cheapest valid offer for this product (cheapest=1).
 *  - distance: 1 - distance/maxDistance (closer=higher). Null distance -> 0.
 *  - stock_confidence: 0.2 baseline (price_status ok) ; +0.6 if a manual
 *    confirmation exists with in_stock=true ; 0.1 if no_response.
 *  - open_now: 1 if open_now===true, 0.5 if unknown, 0 if false.
 *  - installment: 1 if has_installment, else 0.
 *  - freshness: 1 - ageDays/365 capped at [0,1], based on price_changed_at.
 *    Null timestamp -> 0.3 (we simply don't know).
 */

export interface RankWeights {
  price: number;       // 0..1
  distance: number;    // 0..1
  stock_confidence: number;
  open_now: number;
  installment: number;
  freshness: number;
}

export const DEFAULT_WEIGHTS: RankWeights = {
  price: 0.35,
  distance: 0.3,
  stock_confidence: 0.2,
  open_now: 0.1,
  installment: 0.05,
  freshness: 0.0,
};

export interface RankInput {
  price_toman: number | null;
  price_status: string;
  price_changed_at: string | null;
  distance_km: number | null;
  open_now: boolean | null;
  has_installment: boolean;
  // optional manual confirmation record (from /api/confirm)
  confirmation?: { status: string; in_stock: boolean | null; confirmed_price_toman: number | null } | null;
}

export interface RankBreakdown {
  criterion: string;
  label: string;
  raw: number;       // 0..1 raw score
  weight: number;    // 0..1
  contribution: number; // raw * weight
  note: string;
}

export interface RankedOffer extends RankInput {
  score: number;            // 0..100
  breakdown: RankBreakdown[];
}

const DAY_MS = 86400000;

function freshnessRaw(changedAt: string | null): { raw: number; note: string } {
  if (!changedAt) return { raw: 0.3, note: "زمان آخرین تغییر قیمت نامشخص" };
  const d = Date.parse(changedAt);
  if (Number.isNaN(d)) return { raw: 0.3, note: "زمان نامعتبر" };
  const ageDays = (Date.now() - d) / DAY_MS;
  const raw = Math.max(0, Math.min(1, 1 - ageDays / 365));
  const note = ageDays < 30 ? "به‌تازه‌گی کمتر از یک ماه" : ageDays < 180 ? "حدود چند ماه" : "بیش از نیم سال";
  return { raw, note };
}

/** Rank a list of offers for one product. The cheapest valid offer anchors the
 *  price score. Returns offers sorted by score desc, each with a breakdown. */
export function rankOffers(
  offers: RankInput[],
  weights: RankWeights = DEFAULT_WEIGHTS
): RankedOffer[] {
  const validPrices = offers
    .map((o) => o.price_toman)
    .filter((p): p is number => p !== null && p > 0);
  const cheapest = validPrices.length ? Math.min(...validPrices) : 1;
  const distances = offers.map((o) => o.distance_km).filter((d): d is number => d !== null);
  const maxDist = distances.length ? Math.max(...distances) : 1;

  return offers
    .map((o): RankedOffer => {
      const breakdown: RankBreakdown[] = [];

      // price
      let priceRaw = 0;
      let priceNote = "قیمت نامشخص";
      if (o.price_status === "ok" && o.price_toman !== null && cheapest > 0) {
        priceRaw = cheapest / o.price_toman; // cheapest -> 1, more expensive -> <1
        priceNote = `ارزان‌ترین: ${Math.round(priceRaw * 100)}٪ نسبت به کم‌ترین`;
      } else if (o.price_status !== "ok") {
        priceNote = "قیمت نامعتبر/نامشخص";
      }
      breakdown.push({ criterion: "price", label: "قیمت", raw: priceRaw, weight: weights.price, contribution: priceRaw * weights.price, note: priceNote });

      // distance
      let distRaw = 0;
      let distNote = "فاصله نامشخص";
      if (o.distance_km !== null && maxDist > 0) {
        distRaw = 1 - o.distance_km / maxDist;
        distNote = `${o.distance_km.toFixed(1)} کیلومتر`;
      }
      breakdown.push({ criterion: "distance", label: "فاصله", raw: distRaw, weight: weights.distance, contribution: distRaw * weights.distance, note: distNote });

      // stock_confidence
      let stockRaw = 0.2;
      let stockNote = "فقط قیمت ثبت‌شده (موجودی تأییدنشده)";
      if (o.confirmation) {
        if (o.confirmation.status === "confirmed" && o.confirmation.in_stock === true) {
          stockRaw = 0.95; stockNote = "موجودی توسط فروشنده تأیید شد";
        } else if (o.confirmation.status === "confirmed") {
          stockRaw = 0.7; stockNote = "تماس تأیید شد";
        } else if (o.confirmation.status === "pending") {
          stockRaw = 0.3; stockNote = "در انتظار پاسخ فروشنده";
        } else if (o.confirmation.status === "no_response") {
          stockRaw = 0.1; stockNote = "فروشنده پاسخ نداد — جایگزین پیشنهاد می‌شود";
        }
      }
      breakdown.push({ criterion: "stock_confidence", label: "اطمینان به موجودی", raw: stockRaw, weight: weights.stock_confidence, contribution: stockRaw * weights.stock_confidence, note: stockNote });

      // open_now
      const openRaw = o.open_now === true ? 1 : o.open_now === false ? 0 : 0.5;
      const openNote = o.open_now === true ? "اکنون باز" : o.open_now === false ? "اکنون بسته" : "وضعیت باز بودن نامشخص";
      breakdown.push({ criterion: "open_now", label: "باز بودن", raw: openRaw, weight: weights.open_now, contribution: openRaw * weights.open_now, note: openNote });

      // installment
      const instRaw = o.has_installment ? 1 : 0;
      breakdown.push({ criterion: "installment", label: "اقساطی", raw: instRaw, weight: weights.installment, contribution: instRaw * weights.installment, note: o.has_installment ? "خرید اقساطی دارد" : "اقساطی ندارد" });

      // freshness
      const fr = freshnessRaw(o.price_changed_at);
      breakdown.push({ criterion: "freshness", label: "به‌روز بودن قیمت", raw: fr.raw, weight: weights.freshness, contribution: fr.raw * weights.freshness, note: fr.note });

      const total = breakdown.reduce((s, b) => s + b.contribution, 0);
      return { ...o, score: Math.round(total * 100), breakdown };
    })
    .sort((a, b) => b.score - a.score);
}
