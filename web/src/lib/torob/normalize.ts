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

  // connectivity: detect "بی سIM" (wireless) or "با سIM" (wired). normalizeText
  // already collapsed ZWNJ to a space, so both spellings land here as two tokens.
  // Also support the single-token adjectives "سیمی", plus English "wireless"/"wired"
  // (Phase-2 parity with the Python tools._connection_mode).
  const hasWireless =
    hasTokenPair(tokens, "بی", "سیم") || tokens.includes("wireless");
  const hasWired =
    hasTokenPair(tokens, "با", "سیم") ||
    tokens.includes("سیمی") ||
    tokens.includes("wired");
  if (hasWireless && !hasWired) out.connectivity = "wireless";
  else if (hasWired && !hasWireless) out.connectivity = "wired";

  // strip connectivity tokens from the product-terms stream (applied below).
  const stripConn = new Set(["بی", "با", "سیم", "سیمی", "wireless", "wired"]);

  // extract a NUMERIC budget expression like "تا ۱ میلیون", "زیر 2 میلیون",
  // "حداکثر 500 هزار". The prefix sets the bound direction.
  const budgetRe = /(زیر|تا|حداکثر|بیشتر\s*از|کمتر\s*از)\s+(\d+(?:\.\d+)?)\s*(میلیارد|میلیون|هزار)?/;
  const bm = norm.match(budgetRe);
  let budgetStripped = norm;
  if (bm) {
    const n = parseFloat(bm[2]);
    const mult = MULT[bm[3] ?? ""] ?? 1;
    const amount = Math.round(n * mult);
    const prefix = bm[1];
    if (prefix.includes("بیشتر")) out.minBudget = amount;
    else out.maxBudget = amount; // زیر/تا/حداکثر/کمتر از -> upper bound
    budgetStripped = norm.replace(budgetRe, " ");
  }

  // drop the budget prefix word, currency word, and connectivity tokens
  let termStream = budgetStripped
    .replace(/(زیر|تا|حداکثر|بیشتر\s*از|کمتر\s*از)/g, " ")
    .replace(/toman/gi, " ");
  const termTokens = termStream.split(/\s+/).filter((t) => t.length > 1);
  out.terms = termTokens.filter((t) => !stripConn.has(t));
  return out;
}
