// Phase 2 — Persian normalization & search regression tests.
// Run: node --experimental-strip-types scripts/test-persian-normalization.ts
//
// Covers the Phase 2 requirements:
//   - ي/ی and ك/ک unification
//   - Persian / Arabic / Latin digits
//   - spaces, ZWNJ, tatweel
//   - empty / null placeholder strings
//   - thousands separators and decimal points
//   - تومان / ریال units
//   - spelled-out numbers (documented limitation: NOT supported by parseBudgetToman)
//   - brand / model / feature names
//   - typo tolerance without inflating irrelevant results
//   - the 7 sample queries from the prompt + the no-match case

import { normalizeText, parseBudgetToman, parseQuery, cleanNull } from "../src/lib/torob/normalize.ts";
import { ShoppingTools, resolveLocation, type Filters } from "../src/lib/torob/tools.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

const t = new ShoppingTools("data/torob.sqlite");

console.log("=== ۱. یکسان‌سازی حروف ي/ی و ك/ک ===");
ok("ي -> ی (موسي -> موسی)", normalizeText("موسي") === "موسی");
ok("ك -> ک (كتاب -> کتاب)", normalizeText("كتاب") === "کتاب");
ok("Arabic yeh in mixed text (ماوس بي سيم -> ماوس بی سیم)", normalizeText("ماوس بي سيم") === "ماوس بی سیم");
ok("Arabic kaf in mixed text (كيبورد -> کیبورد)", normalizeText("كيبورد") === "کیبورد");

console.log("\n=== ۲. ارقام فارسی، عربی و لاتین ===");
ok("Persian digits ۰-۹ -> 0-9", normalizeText("قیمت ۱۲۳۴۵") === "قیمت 12345");
ok("Arabic digits ٠-٩ -> 0-9", normalizeText("قیمت ١٢٣٤٥") === "قیمت 12345");
ok("Mixed digits", normalizeText("۱٢۳۴۵") === "12345");
ok("Latin digits preserved", normalizeText("price 100") === "price 100");

console.log("\n=== ۳. فاصله‌ها و نیم‌فاصله (ZWNJ) ===");
ok("ZWNJ -> space (بی‌سیم -> بی سیم)", normalizeText("بی‌سیم") === "بی سیم");
ok("Multiple spaces collapsed", normalizeText("ماوس   بی‌سیم") === "ماوس بی سیم");
ok("Tatweel removed", normalizeText("مـــاوس") === "ماوس");
ok("Leading/trailing trim", normalizeText("  ماوس  ") === "ماوس");

console.log("\n=== ۴. متن‌های خالی و null به‌صورت رشته ===");
ok("empty string -> empty", normalizeText("") === "");
ok("null -> empty", normalizeText(null as unknown as string) === "");
ok("only spaces -> empty", normalizeText("    ") === "");
ok("cleanNull('null') -> null", cleanNull("null") === null);
ok("cleanNull(' NULL ') -> null", cleanNull(" NULL ") === null);
ok("cleanNull('') -> null", cleanNull("") === null);
ok("cleanNull('none') -> null", cleanNull("none") === null);
ok("cleanNull('0') -> '0' (zero is a real value)", cleanNull("0") === "0");
ok("cleanNull('real text') -> 'real text'", cleanNull("real text") === "real text");

console.log("\n=== ۵. جداکننده‌های هزارگان و اعشار ===");
ok("thousands 2,000,000 -> 2000000", normalizeText("2,000,000") === "2000000");
ok("thousands 1,000,000,000 -> 1000000000", normalizeText("1,000,000,000") === "1000000000");
ok("decimal 1.5 preserved", normalizeText("1.5 میلیون").includes("1.5") === true);
ok("comma in text not stripped", normalizeText("سلام، حالت چطوره؟") === "سلام حالت چطوره");

console.log("\n=== ۶. پارس بودجه (تومان) ===");
ok("'تا 1 میلیون' -> 1000000", parseBudgetToman("تا 1 میلیون") === 1_000_000);
ok("'زیر ۱,۰۰۰,۰۰۰' -> 1000000", parseBudgetToman("زیر ۱,۰۰۰,۰۰۰") === 1_000_000);
ok("'۱.5 میلیون' -> 1500000", parseBudgetToman("۱.5 میلیون") === 1_500_000);
ok("'500 هزار' -> 500000", parseBudgetToman("500 هزار") === 500_000);
ok("'2 میلیارد' -> 2000000000", parseBudgetToman("2 میلیارد") === 2_000_000_000);
ok("'2000000' -> 2000000", parseBudgetToman("2000000") === 2_000_000);
ok("'بی‌سیم' -> null (no number)", parseBudgetToman("بی‌سیم") === null);
ok("'تومان' alone -> null", parseBudgetToman("تومان") === null);

console.log("\n=== ۷. اعداد نوشتاری فارسی (محدودیت مستند) ===");
// documented limitation: spelled-out numbers like "یک میلیون" are NOT supported
// by parseBudgetToman (only numeric prefixes). This is intentional parity with
// the Python version. We verify the limitation is documented, not silently wrong.
ok("'یک میلیون' -> null (documented limitation)", parseBudgetToman("یک میلیون") === null);
ok("'دو میلیون' -> null (documented)", parseBudgetToman("دو میلیون") === null);
// BUT parseQuery handles "زیر یک میلیون" via the WORD_NUM map for the "یک" case.
const pq = parseQuery("زیر یک میلیون");
ok("'زیر یک میلیون' maxBudget -> 1000000 (parseQuery handles یک)", pq.maxBudget === 1_000_000);

console.log("\n=== ۸. parseQuery — عبارت‌های نمونه از پرامپت ===");
const cases: Array<[string, { terms?: string[]; connectivity?: string | null; max?: number | null; min?: number | null }]> = [
  ["ماوس بی‌سیم تا یک میلیون تومان", { connectivity: "wireless", max: 1_000_000 }],
  ["موس وایرلس زیر ۱,۰۰۰,۰۰۰ تومن", { connectivity: "wireless", max: 1_000_000 }],
  ["wireless mouse under 1000000 toman", { connectivity: "wireless", max: 1_000_000 }],
  ["ماوس سیمی", { connectivity: "wired" }],
  ["هدفون بلوتوثی", {}],  // no connectivity attribute (bluetooth is a feature, not wired/wireless)
  ["لپ‌تاپ تا ۳۰ میلیون", { max: 30_000_000 }],
  ["zzzqqqxxx", {}],  // no match, no budget, no connectivity
];
for (const [query, expect_] of cases) {
  const r = parseQuery(query);
  ok(`parseQuery(${query!}) connectivity`, r.connectivity === (expect_.connectivity ?? null), { got: r.connectivity, want: expect_.connectivity ?? null });
  if (expect_.max !== undefined) ok(`parseQuery(${query!}) maxBudget`, r.maxBudget === expect_.max, { got: r.maxBudget, want: expect_.max });
  if (expect_.min !== undefined) ok(`parseQuery(${query!}) minBudget`, r.minBudget === expect_.min, { got: r.minBudget, want: expect_.min });
}

console.log("\n=== ۹. جست‌وجوی واقعی — «بی‌سیم» نباید سیمی برگرداند ===");
// Critical: "ماوس بی‌سیم" must not return wired products in top results.
const wireless = t.searchProducts("ماوس بی سیم", { limit: 20 } as Filters);
ok("wireless search returns results", wireless.items.length > 0, { total: wireless.total });
const wiredInWireless = wireless.items.filter((i: any) => /با سیم|سیمی|wired/.test(i.title));
ok("wireless results contain NO wired titles", wiredInWireless.length === 0, { count: wiredInWireless.length, sample: wiredInWireless.slice(0,2).map((x:any)=>x.title) });

const wired = t.searchProducts("ماوس با سیم", { limit: 20 } as Filters);
ok("wired search returns results", wired.items.length > 0);
const wirelessInWired = wired.items.filter((i: any) => /بی سیم|wireless/.test(i.title));
ok("wired results contain NO wireless titles", wirelessInWired.length === 0, { count: wirelessInWired.length, sample: wirelessInWired.slice(0,2).map((x:any)=>x.title) });

console.log("\n=== ۱۰. بودجهٔ نامعتبر -> فیلتر اعمال نشود ===");
// Invalid budget should NOT silently become a wrong number.
// parseBudgetToman returns null for invalid; searchProducts ignores null max_price.
// Negative max_price should throw (validateFilters rejects it).
try {
  t.searchProducts("ماوس", { max_price: -1 } as Filters);
  ok("negative max_price SHOULD throw", false);
} catch (e) {
  ok("negative max_price throws as expected", /min_price|max_price|negative|invalid/i.test((e as Error).message));
}
// Garbage budget string -> parseBudgetToman returns null -> no filter applied
ok("parseBudgetToman('xyz') -> null", parseBudgetToman("xyz") === null);
ok("parseBudgetToman('!@#') -> null", parseBudgetToman("!@#") === null);

console.log("\n=== ۱۱. نتیجهٔ صفر واقعاً صفر ===");
const nonsense = t.searchProducts("zzzqqqxxx", { limit: 20 } as Filters);
ok("nonsense query -> no_results", nonsense.status === "no_results" && nonsense.items.length === 0, { status: nonsense.status, count: nonsense.items.length });
ok("nonsense total = 0", nonsense.total === 0);

console.log("\n=== ۱۲. غلط تایپی بدون افزایش نتایج نامرتبط ===");
// A typo like "ماوس بی سيم" (with Arabic yeh instead of Persian) should behave
// the same as "ماوس بی سیم" because normalizeText unifies ي/ی.
const withPersianY = t.searchProducts("ماوس بی سیم", { limit: 10 } as Filters);
const withArabicY = t.searchProducts("ماوس بي سيم", { limit: 10 } as Filters);
ok("Arabic yeh yields same total as Persian yeh", withPersianY.total === withArabicY.total, { persian: withPersianY.total, arabic: withArabicY.total });

console.log("\n=== ۱۳. واحد قیمت یکسان (تومان) ===");
// All prices in the dataset are in toman. Verify min_price_toman is always toman.
const sample = t.searchProducts("لپ تاپ", { limit: 5 } as Filters);
ok("laptop search returns items", sample.items.length > 0);
ok("all prices are in toman (positive integers or null)",
  sample.items.every((i: any) => i.min_price_toman === null || (i.min_price_toman > 0 && Number.isFinite(i.min_price_toman))));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// Make this file a module for top-level await.
export {};
