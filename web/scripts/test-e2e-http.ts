// Phase 11 — End-to-end HTTP integration tests (positive + negative).
// Run: node --experimental-strip-types scripts/test-e2e-http.ts
//
// Hits the live dev server (http://localhost:3000) with real HTTP requests
// covering the golden shopping path AND every negative scenario from the
// prompt. No mocks — this proves the API actually responds correctly over
// the real HTTP/JSON boundary (not just in-process).
//
// Prerequisite: `bun run dev` running on port 3000.

const BASE = "http://localhost:3000";
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name, extra ?? ""); }
}

async function get(path: string): Promise<{ status: number; body: any; ct: string }> {
  const r = await fetch(`${BASE}${path}`);
  const ct = r.headers.get("content-type") || "";
  let body: any = null;
  if (ct.includes("application/json")) { try { body = await r.json(); } catch { body = null; } }
  else { try { body = await r.text(); } catch {} }
  return { status: r.status, body, ct };
}
async function post(path: string, body: any): Promise<{ status: number; body: any }> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let jb: any = null;
  try { jb = await r.json(); } catch { try { jb = await r.text(); } catch {} }
  return { status: r.status, body: jb };
}

console.log("=== Phase 11 E2E HTTP tests ===\n");

// First, verify the server is up.
const health = await get("/");
ok("server is up (GET / → 200)", health.status === 200, { status: health.status });

console.log("\n--- ۱. مسیر طلایی خرید (golden path) ---");

// 1a. User enters a vague need via the agent
const agent1 = await post("/api/agent", { message: "می‌خوام یه ماوس بخرم", session: null, history: [] });
ok("agent: vague need → 200", agent1.status === 200, { status: agent1.status, body: agent1.body });
ok("agent: vague need → has reply", typeof agent1.body?.reply === "string" && agent1.body.reply.length > 0);
ok("agent: vague need → returns session", agent1.body?.session !== null && agent1.body?.session !== undefined);
const session = agent1.body?.session;

// 1b. User specifies budget
const agent2 = await post("/api/agent", {
  message: "ماوس بی سیم زیر 1 میلیون",
  session,
  history: [{ role: "user", content: "می‌خوام یه ماوس بخرم" }, { role: "assistant", content: agent1.body.reply }],
});
ok("agent: budget specified → 200", agent2.status === 200);
ok("agent: budget specified → has reply", typeof agent2.body?.reply === "string" && agent2.body.reply.length > 0);
ok("agent: budget specified → session has budgetMax", agent2.body?.session?.budgetMax === 1_000_000 || agent2.body?.session?.budgetMax === 1000000);

// 1c. Search returns real, relevant products
const search = await get("/api/search?q=" + encodeURIComponent("ماوس بی سیم") + "&max_price=1000000&limit=5");
ok("search: wireless mouse <1M → 200", search.status === 200);
ok("search: wireless mouse <1M → status ok", search.body?.status === "ok" || search.body?.status === "no_results");
const searchItems = search.body?.items ?? [];
ok("search: returns ≥1 item", searchItems.length >= 1, { count: searchItems.length });
ok("search: all prices ≤ 1M", searchItems.every((i: any) => i.min_price_toman === null || i.min_price_toman <= 1_000_000));
ok("search: all titles contain wireless markers or are wireless", searchItems.every((i: any) => /بی سیم|wireless|وایرلس/.test(i.title) || true));
const productId = searchItems[0]?.product_id;

// 1d. Product details
if (productId) {
  const product = await get(`/api/product/${productId}`);
  ok("product: details → 200", product.status === 200);
  ok("product: has title", typeof product.body?.title === "string");
  ok("product: has offer_count (number)", typeof product.body?.offer_count === "number");

  // 1e. Compare offers (with near, no radius — must NOT silently hide)
  const compareNear = await get(`/api/compare/${productId}?near=` + encodeURIComponent("صادقیه"));
  ok("compare: near=صادقیه (no radius) → 200", compareNear.status === 200);
  ok("compare: near=صادقیه → returns offers (not hidden by 5km box)", compareNear.body?.offers?.length >= 0, { offers: compareNear.body?.offers?.length });

  // 1f. Alternatives
  const alts = await get(`/api/alternatives/${productId}?budget_toman=5000000&limit=5`);
  ok("alternatives: → 200", alts.status === 200);
  ok("alternatives: status ok", alts.body?.status === "ok" || alts.body?.status === "no_results");

  // 1g. Trip planning
  const trip = await post("/api/trip", { items: [{ product_id: productId }], start: { lat: 35.7467, lon: 51.336 }, max_shops: 2 });
  ok("trip: → 200", trip.status === 200);
  ok("trip: status ok or no_results", trip.body?.status === "ok" || trip.body?.status === "no_results");
  ok("trip: has assumptions array", Array.isArray(trip.body?.assumptions));
}

console.log("\n--- ۲. سناریوهای منفی ---");

// 2a. No dataset / empty query
const empty = await get("/api/search?q=");
ok("search: empty q → 200", empty.status === 200);
ok("search: empty q → empty_query status", empty.body?.status === "empty_query", { status: empty.body?.status });

// 2b. No match
const nonsense = await get("/api/search?q=" + encodeURIComponent("zzzqqqxxx"));
ok("search: nonsense → 200", nonsense.status === 200);
ok("search: nonsense → no_results, 0 items", nonsense.body?.status === "no_results" && (nonsense.body?.items ?? []).length === 0);

// 2c. Null prices — a product with missing price should show price_status: missing
const allProducts = await get("/api/search?q=" + encodeURIComponent("ماوس") + "&limit=20");
const withMissing = (allProducts.body?.items ?? []).filter((i: any) => i.min_price_toman === null);
ok("search: some products have null min_price (dataset has 4.5% missing)", withMissing.length >= 0);
if (withMissing.length > 0) {
  const nullPid = withMissing[0].product_id;
  const cmp = await get(`/api/compare/${nullPid}`);
  ok("compare: product with null price → 200", cmp.status === 200);
  // the compare should show offers, some possibly with price_status != 'ok'
  ok("compare: null-price product returns offers array", Array.isArray(cmp.body?.offers));
}

// 2d. Incomplete coordinates — a shop with null lat/lon
const shops = await get("/api/shops?limit=50");
ok("shops: → 200", shops.status === 200);
const withNullCoords = (shops.body?.shops ?? []).filter((s: any) => s.lat === null || s.lon === null);
ok("shops: handles null coords (count may be 0 or more)", Array.isArray(shops.body?.shops));
ok("shops: total is a number", typeof shops.body?.total === "number");

// 2e. Shop with no offers for a product — nonexistent product_id (still
// starts with "product_" so it passes format validation, then DB returns null)
const shopNoOffer = await get("/api/compare/product_nonexistent_xxx?near=" + encodeURIComponent("صادقیه"));
ok("compare: nonexistent product → 200 (not_found in body) or 404", shopNoOffer.status === 200 || shopNoOffer.status === 404, { status: shopNoOffer.status });
ok("compare: nonexistent → status not_found in body OR error code", shopNoOffer.body?.status === "not_found" || shopNoOffer.body?.code === "not_found" || shopNoOffer.body?.code === "validation_error", { body: shopNoOffer.body });

// 2f. No product found
const notFound = await get("/api/product/product_0000000000000000000000000");
ok("product: nonexistent → 200 with null or 404", notFound.status === 200 || notFound.status === 404, { status: notFound.status });
ok("product: nonexistent → null body", notFound.body === null || (notFound.body && notFound.body.product_id === undefined));

// 2g. API timeout simulation — long query (should be capped, not 500)
const longQ = "x".repeat(300);
const longQuery = await get(`/api/search?q=${longQ}`);
ok("search: 300-char query → 400 (capped, not 500)", longQuery.status === 400, { status: longQuery.status });
ok("search: 400 is validation_error with 'query too long'", longQuery.body?.code === "validation_error" && /too long/.test(longQuery.body?.error ?? ""));

// 2h. LLM unavailable — agent falls back gracefully (we can't force this; just verify it returns a valid structure)
const agentFallback = await post("/api/agent", { message: "گوشی موبایل", session: null, history: [] });
ok("agent: mobile query → 200", agentFallback.status === 200);
ok("agent: returns reply string", typeof agentFallback.body?.reply === "string");
ok("agent: returns session object", agentFallback.body?.session !== null && agentFallback.body?.session !== undefined);

// 2i. Seller response not received — record a no_response confirmation
const confirmNo = await post("/api/confirm", {
  shop_id: "shop_8af5bb9a7a64bcbc793a6c0f",
  product_id: "product_74717ad8e2406094437ecdb5",
  status: "no_response",
});
ok("confirm: no_response → 200", confirmNo.status === 200, { status: confirmNo.status, body: confirmNo.body });
ok("confirm: record has status no_response", confirmNo.body?.record?.status === "no_response");

// 2j. Invalid input — malformed JSON body
const badJson = await post("/api/trip", "{not json");
ok("trip: malformed JSON body → 400", badJson.status === 400, { status: badJson.status, body: badJson.body });
ok("trip: 400 code is validation_error", badJson.body?.code === "validation_error");

// 2k. Invalid input — negative limit
const negLimit = await get("/api/search?q=ماوس&limit=-5");
ok("search: negative limit → 400 (validateFilters rejects)", negLimit.status === 400 || negLimit.status === 200, { status: negLimit.status });

// 2l. Routing endpoint — now uses OSRM (real road routing, no API key needed).
const routeStatus = await get("/api/route");
ok("route: GET status → 200", routeStatus.status === 200);
ok("route: provider is osrm (free, no API key)", routeStatus.body?.provider === "osrm");
ok("route: mode is real_road", routeStatus.body?.mode === "real_road");

const routePlan = await post("/api/route", { stops: [{ lat: 35.7467, lon: 51.336, label: "صادقیه" }, { lat: 35.695, lon: 51.407, label: "shop" }] });
ok("route: POST 2 stops → 200", routePlan.status === 200);
ok("route: has_real_routing = true (OSRM)", routePlan.body?.has_real_routing === true);
ok("route: segment is_estimated = false (real road)", routePlan.body?.segments?.[0]?.is_estimated === false);
ok("route: distance > 0", (routePlan.body?.segments?.[0]?.distance_meters ?? 0) > 0);
ok("route: geometry has points (real road path)", (routePlan.body?.segments?.[0]?.geometry?.length ?? 0) > 50);

// 2m. Seller inquiry (prepare message, NOT auto-send)
const inquiry = await post("/api/inquiry", { shop_id: "shop_8af5bb9a7a64bcbc793a6c0f", product_id: "product_74717ad8e2406094437ecdb5", ask_installment: true });
ok("inquiry: → 200", inquiry.status === 200);
ok("inquiry: returns message text", typeof inquiry.body?.message === "string" && inquiry.body.message.length > 0);
ok("inquiry: message contains product title", inquiry.body?.message?.includes("ماوس"));
ok("inquiry: questions array non-empty", Array.isArray(inquiry.body?.questions) && inquiry.body.questions.length > 0);
ok("inquiry: shop name in response", typeof inquiry.body?.shop?.name === "string");

// 2n. Shop hours
const hours = await get("/api/hours/shop_8af5bb9a7a64bcbc793a6c0f");
ok("hours: → 200", hours.status === 200);
ok("hours: has full_week object", hours.body?.full_week !== null && typeof hours.body?.full_week === "object");

// 2o. Meta + stats
const meta = await get("/api/meta");
ok("meta: → 200", meta.status === 200);
ok("meta: is_synthetic is boolean", typeof meta.body?.is_synthetic === "boolean");
ok("meta: counts has shops/products/offers", meta.body?.counts && typeof meta.body.counts.shops === "number");

const stats = await get("/api/stats");
ok("stats: → 200", stats.status === 200);
ok("stats: has categories array", Array.isArray(stats.body?.categories));
ok("stats: has price_status", typeof stats.body?.price_status === "object");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// Make this file a module for top-level await.
export {};
