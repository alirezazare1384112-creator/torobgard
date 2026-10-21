// Ad-hoc verification of the TS tools port against test_core.py expectations.
// Run: node --experimental-strip-types scripts/verify-tools.ts
import { ShoppingTools, haversineKm, resolveLocation, validateFilters } from "../src/lib/torob/tools.ts";
import type { Filters } from "../src/lib/torob/tools.ts";
import { normalizeText, parseBudgetToman, cleanNull, parseQuery } from "../src/lib/torob/normalize.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const t = new ShoppingTools("data/torob.sqlite");

// normalize
ok("cleanNull(null)->null", cleanNull("null") === null);
ok("cleanNull(' NULL ')->null", cleanNull(" NULL ") === null);
ok("cleanNull('')->null", cleanNull("") === null);
ok("cleanNull('0')->'0'", cleanNull("0") === "0");
ok("persian digits+chars", normalizeText("ماوس ۱۲۳") === "ماوس 123" && normalizeText("كتاب") === "کتاب");

// budget (spelled-out numbers are a documented limitation -> null)
ok("budget 'یک میلیون' unsupported->null (documented)", parseBudgetToman("یک میلیون") === null);
ok("budget 'تا 1 میلیون'->1,000,000", parseBudgetToman("تا 1 میلیون") === 1_000_000);
ok("budget '۱.5 میلیون'->1,500,000", parseBudgetToman("۱.5 میلیون") === 1_500_000);
ok("budget '500 هزار'->500,000", parseBudgetToman("500 هزار") === 500_000);
ok("budget 'بی‌سیم'->null", parseBudgetToman("بی‌سیم") === null);

// parseQuery (Phase 2): numeric budget + connectivity
const pq1 = parseQuery("ماوس بی سیم تا 1 میلیون تومان");
ok("parseQuery connectivity wireless", pq1.connectivity === "wireless", pq1);
ok("parseQuery maxBudget 1,000,000", pq1.maxBudget === 1_000_000, pq1);
ok("parseQuery terms include ماوس", pq1.terms.includes("ماوس"), pq1);

const pq2 = parseQuery("ماوس با سیم");
ok("parseQuery connectivity wired", pq2.connectivity === "wired", pq2);

// validation
try { validateFilters({ sort: "random" as any }); ok("bad sort throws", false); }
catch { ok("bad sort throws", true); }
try { validateFilters({ min_price: 10, max_price: 5 }); ok("min>max throws", false); }
catch { ok("min>max throws", true); }
try { validateFilters({ max_price: -1 }); ok("negative throws", false); }
catch { ok("negative throws", true); }
const fl: Filters = { limit: 10_000 };
validateFilters(fl);
ok("limit clamped to 100", fl.limit === 100);
try { validateFilters({ near: [40.0, 50.0] as any }); ok("outside Tehran throws", false); }
catch { ok("outside Tehran throws", true); }
ok("haversine 0", Math.abs(haversineKm([35.7, 51.4], [35.7, 51.4])) < 1e-9);
ok("resolve صادقیه", resolveLocation("صادقیه") !== null);
ok("resolve اصفهان null", resolveLocation("اصفهان") === null);

// search
ok("empty query -> empty_query", t.searchProducts("   ").status === "empty_query");
ok("nonsense -> no_results", t.searchProducts("zzzqqqxxx").status === "no_results");

const sr = t.searchProducts("ماوس بی سیم", { limit: 5 });
ok("search ماوس بی سیم total>0", sr.total > 0, sr.total);
ok("search items have offers", sr.items.every((i) => i.offer_count >= 1));

// THE fix: a wireless query must NOT return wired titles
const wirelessAll = t.searchProducts("ماوس بی سیم", { limit: 100 });
const norm = (s: string) => normalizeText(s);
const wiredLeak = wirelessAll.items.filter((i) => norm(i.title).includes("با سیم") && !norm(i.title).includes("بی سیم"));
ok("WIRELESS query excludes WIRED titles", wiredLeak.length === 0, wiredLeak.map((i) => i.title));

// and must also exclude the quiet wired "ماوس بی‌صدا با سیم" (silent WIRED).
// Note: a "ماوس بی‌سیم ... بی‌صدا" (wireless AND silent) is a valid wireless hit.
const quietLeak = wirelessAll.items.filter(
  (i) => norm(i.title).includes("بی صدا") && norm(i.title).includes("با سیم") && !norm(i.title).includes("بی سیم")
);
ok("WIRELESS query excludes quiet WIRED 'بی‌صدا با سیم'", quietLeak.length === 0, quietLeak.map((i) => i.title));

// budget wired query: "ماوس با سیم" should return wired, not wireless
const wiredAll = t.searchProducts("ماوس با سیم", { limit: 100 });
const wirelessLeak = wiredAll.items.filter((i) => norm(i.title).includes("بی سیم") && !norm(i.title).includes("با سیم"));
ok("WIRED query excludes WIRELESS titles", wirelessLeak.length === 0, wirelessLeak.map((i) => i.title));

// budget filter respected
const pr = t.searchProducts("ماوس", { max_price: 1_000_000, sort: "price_asc", limit: 50 });
ok("price filter respected", pr.items.every((i) => i.min_price_toman === null || i.min_price_toman! <= 1_000_000));

// price sorted ascending
const asc = t.searchProducts("ماوس", { limit: 50 });
const prices = asc.items.map((i) => i.min_price_toman).filter((p): p is number => p !== null);
ok("price sorted ascending", JSON.stringify(prices) === JSON.stringify([...prices].sort((a, b) => a - b)));

// invalid product id
try { t.getProductDetails("bad id"); ok("invalid product id rejected", false); }
catch { ok("invalid product id rejected", true); }
ok("unknown product null", t.getProductDetails("product_doesnotexist") === null);
ok("compare unknown not_found", t.compareOffers("product_doesnotexist").status === "not_found");

// compare
const firstMouse = t.searchProducts("ماوس بی سیم", { limit: 1 });
const cmp = t.compareOffers(firstMouse.items[0].product_id);
const valid = cmp.offers.filter((o) => o.price_status === "ok").map((o) => o.price_toman!);
if (valid.length) ok("compare min matches valid", cmp.summary!.min_price_toman === Math.min(...valid));
for (const o of cmp.offers) {
  ok("compare has price_changed_at", "price_changed_at" in o);
  ok("compare shop has name", "name" in o.shop);
  break;
}

// shops near صادقیه sorted by distance
const loc = resolveLocation("صادقیه")!;
const sh = t.findShops({ limit: 20, sort: "distance", radius_km: 5 } as Filters, loc);
const dists = sh.shops.map((s) => s.distance_km!);
ok("shops near sorted by distance", JSON.stringify(dists) === JSON.stringify([...dists].sort((a, b) => a - b)), dists);
ok("shops within radius", dists.every((d) => d <= 5));
ok("shops flag synthetic names", t.findShops({ limit: 3 } as Filters).shops.every((s) => s.name_is_synthetic_warning));

// alternatives
const alts = t.findAlternatives(firstMouse.items[0].product_id, 1_000_000, 5);
ok("alternatives status ok", alts.status === "ok" || alts.status === "no_results", alts.status);

// trip
const trip = t.planShoppingTrip([{ product_id: firstMouse.items[0].product_id }], loc, 3);
ok("trip status", trip.status === "ok" || trip.status === "no_results", trip.status);

t.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
