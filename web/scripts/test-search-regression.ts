/**
 * Phase 3 regression tests for search correctness, budget parsing,
 * negative filters, and edge cases.
 *
 * Run from the project root: node --experimental-strip-types scripts/test-search-regression.ts
 */
import { parseQuery, normalizeText, parseBudgetToman } from "../src/lib/torob/normalize.ts";
import { ShoppingTools, haversineKm, resolveLocation, validateFilters, type Filters } from "../src/lib/torob/tools.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

console.log("\n=== Wired/Wireless Distinction ===");

const t = new ShoppingTools("data/torob.sqlite");

// Wireless query must not return wired products
const wirelessResults = t.searchProducts("ماوس بی سیم", { limit: 100 });
ok("wireless: total > 0", wirelessResults.total > 0);
const wiredLeak = wirelessResults.items.filter((i: any) => {
  const n = normalizeText(i.title);
  return n.includes("با سیم") && !n.includes("بی سیم");
});
ok("wireless: 0 wired titles leaked", wiredLeak.length === 0, wiredLeak.map((i: any) => i.title));

// Wired query must not return wireless products
const wiredResults = t.searchProducts("ماوس با سیم", { limit: 100 });
ok("wired: total > 0", wiredResults.total > 0);
const wirelessLeak = wiredResults.items.filter((i: any) => {
  const n = normalizeText(i.title);
  return n.includes("بی سیم") && !n.includes("با سیم");
});
ok("wired: 0 wireless titles leaked", wirelessLeak.length === 0);

// "بی‌صدا با سیم" (quiet wired) must NOT match wireless query
const quietWired = t.searchProducts("ماوس بی سیم", { limit: 100 });
const quietLeak = quietWired.items.filter((i: any) => {
  const n = normalizeText(i.title);
  return n.includes("بی صدا") && n.includes("با سیم");
});
ok("wireless: excludes quiet wired 'بی‌صدا با سیم'", quietLeak.length === 0);

console.log("\n=== Persian and Latin Digits ===");

ok("normalize: Persian ۱۲۳ → 123", normalizeText("۱۲۳") === "123");
ok("normalize: Arabic ١٢٣ → 123", normalizeText("١٢٣") === "123");
ok("normalize: mixed ۱2۳ → 123", normalizeText("۱2۳") === "123");

console.log("\n=== Budget Parsing ===");

// "تا ۲ میلیون" → max 2000000
const pq1 = parseQuery("ماوس تا 2 میلیون");
ok("budget: 'تا 2 میلیون' → maxBudget 2000000", pq1.maxBudget === 2000000, pq1.maxBudget);
ok("budget: terms include ماوس", pq1.terms.includes("ماوس"));

// "زیر 1 میلیون" → max 1000000
const pq2 = parseQuery("هدفون زیر 1 میلیون");
ok("budget: 'زیر 1 میلیون' → maxBudget 1000000", pq2.maxBudget === 1000000, pq2.maxBudget);

// "بین 2 تا 4 میلیون" → min 2000000, max 4000000
const pq3 = parseQuery("لپتاپ بین 2 تا 4 میلیون");
ok("budget: 'بین 2 تا 4 میلیون' → minBudget 2000000", pq3.minBudget === 2000000, pq3.minBudget);
ok("budget: 'بین 2 تا 4 میلیون' → maxBudget 4000000", pq3.maxBudget === 4000000, pq3.maxBudget);

// Persian digits in budget (normalizeText converts them first)
const pq4 = parseQuery("ماوس تا ۱ میلیون");
ok("budget: Persian digits 'تا ۱ میلیون' → maxBudget 1000000", pq4.maxBudget === 1000000, pq4.maxBudget);

// Thousands separators
const pq5 = parseQuery("لپتاپ زیر 2,000,000");
ok("budget: thousands sep 'زیر 2,000,000' → maxBudget 2000000", pq5.maxBudget === 2000000, pq5.maxBudget);

// "500 هزار" → 500000
const pb1 = parseBudgetToman("500 هزار");
ok("parseBudgetToman: '500 هزار' → 500000", pb1 === 500000);

// "1.5 میلیون" → 1500000
const pb2 = parseBudgetToman("1.5 میلیون");
ok("parseBudgetToman: '1.5 میلیون' → 1500000", pb2 === 1500000);

// Reject nonsensical ranges
try { validateFilters({ min_price: 10, max_price: 5 }); ok("validation: min>max rejected", false); }
catch { ok("validation: min>max rejected", true); }

try { validateFilters({ max_price: -1 }); ok("validation: negative price rejected", false); }
catch { ok("validation: negative price rejected", true); }

console.log("\n=== Negative Filters ===");

// "ماوس بدون پد" → should exclude mouse pads
const negQuery = parseQuery("ماوس بدون پد");
ok("negative: 'بدون پد' creates negative term", negQuery.terms.some((t: string) => t === "-پد"));
ok("negative: ماوس is still positive term", negQuery.terms.includes("ماوس"));

// Search with negative filter
const negResults = t.searchProducts("ماوس بدون پد", { limit: 20 });
ok("negative: results don't contain 'پد' in titles", negResults.items.every((i: any) => !normalizeText(i.title).includes("پد")));

console.log("\n=== Empty and Edge Cases ===");

// Empty query
ok("empty: returns empty_query", t.searchProducts("   ").status === "empty_query");

// No match
ok("no match: returns no_results", t.searchProducts("zzzqqqxxx").status === "no_results");

// Extremely long input (2000 chars of "a")
const longInput = "ماوس " + "a".repeat(2000);
const longResult = t.searchProducts(longInput);
ok("long input: doesn't crash (status is ok or no_results)", longResult.status === "ok" || longResult.status === "no_results" || longResult.status === "empty_query");

// SQL injection attempt
const injection = t.searchProducts("ماوس'; DROP TABLE products;--", { limit: 5 });
ok("SQL injection: doesn't crash", injection.status === "ok" || injection.status === "no_results" || injection.status === "empty_query");

// Single char query
const singleChar = parseQuery("a");
ok("single char: term filtered (len > 1)", !singleChar.terms.includes("a"));

console.log("\n=== Sorting and Pagination ===");

// Price ascending
const asc = t.searchProducts("ماوس", { sort: "price_asc", limit: 10 } as Filters);
const prices = asc.items.map((i: any) => i.min_price_toman).filter((p: any) => p !== null);
ok("sort: price_asc is ascending", JSON.stringify(prices) === JSON.stringify([...prices].sort((a, b) => a - b)));

// Pagination
const page1 = t.searchProducts("ماوس", { limit: 5, offset: 0 } as Filters);
const page2 = t.searchProducts("ماوس", { limit: 5, offset: 5 } as Filters);
ok("pagination: page1 has 5 items", page1.items.length === 5);
ok("pagination: page2 has 5 items", page2.items.length === 5);
ok("pagination: different items on page2", page1.items[0].product_id !== page2.items[0].product_id);

// Stable ordering (same query twice → same order)
const r1 = t.searchProducts("ماوس", { limit: 10 } as Filters);
const r2 = t.searchProducts("ماوس", { limit: 10 } as Filters);
ok("stability: same query returns same order", r1.items[0].product_id === r2.items[0].product_id);

console.log("\n=== Store Distance ===");

// Distance calculation with known location
const loc = resolveLocation("صادقیه")!;
ok("distance: resolveLocation works", loc !== null);
const dist = haversineKm(loc, loc);
ok("distance: same point = 0", Math.abs(dist) < 0.001);

// Search with location → distance_km on results
const withLoc = t.searchProducts("ماوس", { near: loc, limit: 5, sort: "distance" } as Filters);
const distances = withLoc.items.map((i: any) => i.distance_km).filter((d: any) => d !== null && d !== undefined);
ok("distance: results have distance_km", distances.length > 0);
ok("distance: all distances > 0", distances.every((d: any) => d > 0));
ok("distance: distances sorted ascending", JSON.stringify(distances) === JSON.stringify([...distances].sort((a: number, b: number) => a - b)));

console.log("\n=== Missing Brand/Model ===");

// Verify brand is null when missing
const nullBrand = t.searchProducts("ماوس", { limit: 50 } as Filters);
const hasNullBrand = nullBrand.items.some((i: any) => i.brand === null);
ok("missing brand: some products have null brand", hasNullBrand);

// Verify invalid prices are flagged
const details = t.getProductDetails(nullBrand.items[0].product_id);
ok("product details: returns object", details !== null);
ok("product details: has offer_count", details?.offer_count !== undefined);

console.log("\n=== Budget Filtering in Search ===");

// Budget filter respected
const budgetResults = t.searchProducts("ماوس", { max_price: 500000, limit: 50 } as Filters);
ok("budget: all prices <= 500000", budgetResults.items.every((i: any) => i.min_price_toman === null || i.min_price_toman <= 500000));

// Parsed budget from query string
const parsedBudget = t.searchProducts("ماوس زیر 1 میلیون", { limit: 50 });
ok("parsed budget: all prices <= 1000000", parsedBudget.items.every((i: any) => i.min_price_toman === null || i.min_price_toman <= 1000000));

// "بین 2 تا 4 میلیون" range
const rangeResults = t.searchProducts("لپتاپ بین 2 تا 4 میلیون", { limit: 50 });
ok("range budget: all prices in [2000000, 4000000]", rangeResults.items.every((i: any) =>
  i.min_price_toman === null || (i.min_price_toman >= 2000000 && i.min_price_toman <= 4000000)
), rangeResults.items.slice(0, 3).map((i: any) => i.min_price_toman));

t.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
