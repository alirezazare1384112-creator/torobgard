/**
 * Persian text & value normalization — TypeScript port of tehran_agent/normalize.py.
 *
 * Mirrors the Python behaviour exactly, with one critical fix: JS `\w` is
 * ASCII-only (unlike Python's, which is Unicode), so we use Unicode property
 * escapes to preserve Persian letters/digits while dropping punctuation.
 */

const CHAR_MAP: Record<string, string> = {
  // Unify Arabic/variant Persian letters to canonical Persian forms.
  ي: "ی", // Arabic yeh -> Persian yeh
  ك: "ک", // Arabic kaf -> Persian kaf
  ۑ: "ه", // yeh barree -> heh
  ة: "ه", // teh marbuta -> heh
  "\u200c": " ", // ZWNJ -> space
  "\u200f": " ", // RLM -> space
  "\u200e": " ", // LRM -> space
  "\u0640": "", // tatweel -> remove
};

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const NULL_TOKENS = new Set(["", "null", "none", "nan", "n/a"]);

/** Return a stripped value, or null for empty / placeholder tokens. */
export function cleanNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  return NULL_TOKENS.has(v.toLowerCase()) ? null : v;
}

function translateChar(ch: string): string {
  if (CHAR_MAP[ch] !== undefined) return CHAR_MAP[ch];
  const pd = PERSIAN_DIGITS.indexOf(ch);
  if (pd >= 0) return String(pd);
  const ad = ARABIC_DIGITS.indexOf(ch);
  if (ad >= 0) return String(ad);
  return ch;
}

/** Lowercase, unify Persian characters and digits, collapse whitespace. */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  let v = "";
  for (const ch of value) v += translateChar(ch);
  v = v.toLowerCase();
  // Remove thousands-separators from numbers BEFORE stripping punctuation,
  // so "2,000,000" → "2000000" (not "2 000 000"). Handles ASCII commas AND the
  // Arabic thousands separator U+066C used by fa-IR formatting («۱٬۰۰۰٬۰۰۰»).
  // Only strips separators followed by a 3-digit group, so decimal commas
  // like "2,5" (rare) survive. Dots may be decimal points like "1.5" — kept.
  v = v.replace(/(\d)[٬,](?=\d{3}(?!\d))/g, "$1");
  v = v.replace(/[\u064B-\u065F]/g, ""); // strip Arabic diacritics
  // JS \w is ASCII-only (unlike Python's Unicode \w); use property escapes so
  // Persian letters/digits are preserved while punctuation is dropped.
  v = v.replace(/[^\p{L}\p{N}\s./-]/gu, " ");
  return v.replace(/\s+/g, " ").trim();
}

const MULT: Record<string, number> = {
  "میلیارد": 1_000_000_000,
  "میلیون": 1_000_000,
  "هزار": 1_000,
};

/**
 * Parse a budget like "۱ میلیون", "1.5 میلیون", "500 هزار", "2000000", and the
 * Phase-2 forms "تا ۲ میلیون", "زیر یک میلیون", "حداکثر ۳ میلیون تومان" into toman.
 *
 * Note: spelled-out *numbers* ("یک", "دو", ...) are NOT supported (documented
 * limitation inherited from the Python version). "زیر یک میلیون" works only
 * because the parser extracts the multiplier word "میلیون" and a numeric
 * prefix when present; "زیر یک میلیون" is handled by treating the bare word
 * "یک" before "میلیون" as 1.
 */
const WORD_NUM: Record<string, number> = {
  یک: 1, يک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10,
};

export function parseBudgetToman(text: string): number | null {
  if (!text) return null;
  const t = normalizeText(text);
  // NUMERIC expression only (with optional multiplier). Spelled-out numbers
  // ("یک", "دو", ...) are intentionally NOT supported — documented limitation
  // inherited from the Python version (see tests/test_core.py).
  const m = t.match(/(\d+(?:\.\d+)?)\s*(میلیارد|میلیون|هزار)?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = MULT[m[2] ?? ""] ?? 1;
  return Math.round(n * mult);
}

/**
 * Parse a query into (product terms, wired/wireless attribute, budget).
 *
 * Phase-2 search improvement over the milestone-1 substring matcher:
 *   - "بی‌سیم" (wireless) and "با سیم" (wired) are detected as an explicit
 *     connectivity attribute, checked per-title, NOT by banning the substring
 *     "سیم". This fixes the classic false-positive: "ماوس بی‌صدا با سیم"
 *     (a quiet WIRED mouse) must NOT match a query for "ماوس بی‌سیم".
 *   - Budget prefixes "زیر/تا/حداکثر/بیشتر از/کمتر از" plus a NUMERIC price
 *     expression are extracted and removed from the product terms. Spelled-out
 *     numbers are NOT supported (documented limitation).
 *
 * Note: JS `\b` is ASCII-only, so it cannot anchor Persian words. We detect
 * connectivity on the token stream instead.
 */
export interface ParsedQuery {
  terms: string[];
  connectivity: "wireless" | "wired" | null;
  maxBudget: number | null;
  minBudget: number | null;
}

export function hasTokenPair(tokens: string[], a: string, b: string): boolean {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === a && tokens[i + 1] === b) return true;
  }
  return false;
}

export function parseQuery(query: string): ParsedQuery {
  const norm = normalizeText(query);
  const out: ParsedQuery = { terms: [], connectivity: null, maxBudget: null, minBudget: null };
  if (!norm) return out;

  const tokens = norm.split(/\s+/).filter(Boolean);

  // connectivity: detect "بی سیم" (wireless) or "با سیم" (wired). normalizeText
  // already collapsed ZWNJ to a space, so both spellings land here as two tokens.
  // Also support the single-token adjectives "سیمی", the Persian transliteration
  // "وایرلس", and English "wireless"/"wired".
  // NOTE: "بلوتوثی" (bluetooth) is NOT treated as a connectivity attribute —
  // bluetooth is a feature, and a title may say "بلوتوثی" without "بی سیم",
  // so forcing the wireless SQL filter would exclude the very products the user
  // wants. "بلوتوثی" stays as a search term instead.
  const hasWireless =
    hasTokenPair(tokens, "بی", "سیم") ||
    tokens.includes("wireless") ||
    tokens.includes("وایرلس");
  const hasWired =
    hasTokenPair(tokens, "با", "سیم") ||
    tokens.includes("سیمی") ||
    tokens.includes("wired");
  if (hasWireless && !hasWired) out.connectivity = "wireless";
  else if (hasWired && !hasWireless) out.connectivity = "wired";

  // strip connectivity tokens from the product-terms stream (applied below).
  const stripConn = new Set(["بی", "با", "سیم", "سیمی", "wireless", "wired", "وایرلس"]);

  // Budget parsing — supports:
  //   "تا ۲ میلیون" / "زیر یک میلیون" / "حداکثر ۳ میلیون"   (Persian prefixes)
  //   "under 2000000" / "below 3m toman" / "up to 5 million" (English prefixes)
  //   "بین ۲ تا ۴ میلیون"
  //   "1,000,000" / "1.5 میلیون" / "500 هزار"
  //   Spelled-out Persian numbers (یک/دو/.../ده) before a unit are supported
  //   via the WORD_NUM map (so "زیر یک میلیون" works). Standalone spelled-out
  //   numbers without a unit are NOT supported (documented limitation).
  //   Persian digits already normalized to Latin by normalizeText.
  let budgetStripped = norm;

  // Pattern 1: "بین X تا Y [unit]" → min=X, max=Y
  const rangeRe = /بین\s+(\d+(?:[,.]\d+)?)\s*(?:تا|-)\s*(\d+(?:[,.]\d+)?)\s*(میلیارد|میلیون|هزار)?/;
  const rm = norm.match(rangeRe);
  if (rm) {
    const mult = MULT[rm[3] ?? ""] ?? 1;
    const lo = Math.round(parseFloat(rm[1].replace(/,/g, "")) * mult);
    const hi = Math.round(parseFloat(rm[2].replace(/,/g, "")) * mult);
    out.minBudget = Math.min(lo, hi);
    out.maxBudget = Math.max(lo, hi);
    budgetStripped = norm.replace(rangeRe, " ");
  } else {
    // Pattern 2: "prefix X [unit]" — single bound. Supports Persian prefixes
    // (زیر|تا|حداکثر|بیشتر از|کمتر از) and English prefixes
    // (under|below|up to|max|less than|more than|cheaper than). X can be a
    // digit sequence OR a spelled-out Persian number (یک/دو/...).
    const wordNumAlt = Object.keys(WORD_NUM).join("|");
    const budgetRe = new RegExp(
      `(زیر|تا|حداکثر|بیشتر\\s*از|کمتر\\s*از|under|below|up\\s*to|less\\s*than|more\\s*than|cheaper\\s*than|max)\\s+((?:\\d+(?:[,.]\\d+)?)|(?:${wordNumAlt}))\\s*(میلیارد|میلیون|هزار|million|billion|k|m)?`,
      "i"
    );
    const bm = norm.match(budgetRe);
    if (bm) {
      const rawN = bm[2];
      const n = /^\d/.test(rawN) ? parseFloat(rawN.replace(/,/g, "")) : (WORD_NUM[rawN] ?? null);
      if (n !== null) {
        const unitRaw = (bm[3] ?? "").toLowerCase();
        const mult =
          MULT[bm[3] ?? ""] ??
          (unitRaw === "million" ? 1_000_000 :
           unitRaw === "billion" ? 1_000_000_000 :
           unitRaw === "k" ? 1_000 :
           unitRaw === "m" ? 1_000_000 : 1);
        const amount = Math.round(n * mult);
        const prefix = bm[1].toLowerCase();
        // "بیشتر"/"more than"/"cheaper than" (cheaper is a misspeak — treat as "more than" is wrong;
        // actually "cheaper than X" means "under X". Handle explicitly.)
        if (prefix.includes("بیشتر") || prefix === "more than") out.minBudget = amount;
        else out.maxBudget = amount;
        budgetStripped = norm.replace(bm[0], " ");
      }
    }
  }

  // Negative filters: "بدون X" / "نه X" — exclude term X from results
  const negativeRe = /(?:بدون|نه)\s+(\S+)/g;
  const negatives: string[] = [];
  let negMatch;
  while ((negMatch = negativeRe.exec(norm)) !== null) {
    negatives.push(negMatch[1]);
  }
  if (negatives.length > 0) {
    budgetStripped = budgetStripped.replace(/(?:بدون|نه)\s+\S+/g, " ");
  }

  // drop the budget prefix word, currency word, unit words, and connectivity tokens
  // (Persian + English; case-insensitive for English)
  let termStream = budgetStripped
    .replace(/(زیر|تا|حداکثر|بیشتر\s*از|کمتر\s*از|بین)/g, " ")
    .replace(/\b(under|below|up\s*to|less\s*than|more\s*than|cheaper\s*than|max|million|billion|toman)\b/gi, " ")
    .replace(/toman|تومان/gi, " ")
    // standalone unit letters k/m after a number were already consumed by the
    // budget regex; drop any stragglers so they don't pollute the term stream.
    .replace(/\b[km]\b/gi, " ");
  const termTokens = termStream.split(/\s+/).filter((t) => t.length > 1);
  out.terms = termTokens.filter((t) => !stripConn.has(t));

  // Attach negatives as a special field (prefixed with -)
  for (const neg of negatives) {
    if (neg.length > 1 && !stripConn.has(neg)) {
      out.terms.push("-" + neg);
    }
  }

  return out;
}
