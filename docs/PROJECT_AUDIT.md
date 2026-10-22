# TorobGard — Project Audit

**Auditor:** Principal Software Architect / Senior Full-Stack Engineer / QA Lead  
**Date:** 2026-10-21  
**Commit:** `0f1ff00` (HEAD of `main`, clean working tree)  
**Repository:** `https://github.com/alirezazare1384112-creator/torobgard`  

---

## 1. Actual Repository Structure

```
torobgard/
├── .gitignore
├── README.md
├── data/
│   ├── raw/
│   │   ├── .gitkeep
│   │   └── starcoach-dataset-v16-cap300-csv.zip  (58 MB, SHA256 verified)
│   └── torob.sqlite  (389 MB, gitignored — build artifact)
├── docs/
│   ├── DATA_AUDIT.md
│   └── DATASET_SOURCE.md
├── scripts/
│   ├── audit_dataset.py
│   └── prepare_dataset_for_repo.py
├── tehran_agent/
│   ├── __init__.py  (empty)
│   ├── api.py       (stdlib HTTP server)
│   ├── importer.py  (CSV/ZIP → SQLite)
│   ├── normalize.py (Persian text + budget parsing)
│   └── tools.py     (6 core tools: search, details, compare, shops, alternatives, trip)
├── tests/
│   ├── test_api.py  (5 API tests)
│   └── test_core.py (26 unit + DB tests)
└── web/
    ├── .gitignore
    ├── README.md
    ├── bun.lock
    ├── components.json
    ├── eslint.config.mjs
    ├── next.config.ts
    ├── package.json
    ├── postcss.config.mjs
    ├── tailwind.config.ts
    ├── tsconfig.json
    ├── public/ (logo.svg, robots.txt)
    ├── scripts/
    │   ├── seed-torob.ts    (synthetic Persian sample DB generator)
    │   └── verify-tools.ts  (42 TS assertions)
    └── src/
        ├── app/
        │   ├── globals.css
        │   ├── layout.tsx   (RTL, Vazirmatn font, ThemeProvider)
        │   ├── page.tsx     (main view controller)
        │   └── api/
        │       ├── agent/route.ts       (LLM agent with function-calling)
        │       ├── alternatives/[id]/route.ts
        │       ├── compare/[id]/route.ts
        │       ├── confirm/route.ts      (seller confirmation recording)
        │       ├── hours/[id]/route.ts   (shop hours today/any day)
        │       ├── inquiry/route.ts     (seller inquiry message generator)
        │       ├── meta/route.ts
        │       ├── product/[id]/route.ts
        │       ├── route.ts             (hello world placeholder)
        │       ├── search/route.ts
        │       ├── shops/route.ts
        │       ├── stats/route.ts
        │       └── trip/route.ts
        ├── components/
        │   ├── torob/
        │   │   ├── agent-view.tsx       (UNUSED — superseded by assistant-view)
        │   │   ├── assistant-view.tsx   (conversational agent + in-chat product cards + verify panel)
        │   │   ├── cart-store.ts        (zustand: shopping cart)
        │   │   ├── compare-panel.tsx    (side-by-side compare dialog)
        │   │   ├── compare-store.ts     (zustand: max 2 compare)
        │   │   ├── disclaimers.tsx      (synthetic banner, disclaimer list, name badge)
        │   │   ├── explore-view.tsx     (UNUSED — superseded by assistant-view)
        │   │   ├── format.ts           (toPersianDigits, formatToman, formatPersianDate, formatDistanceKm)
        │   │   ├── home-view.tsx       (hero, stats, categories, how-it-works)
        │   │   ├── map-view.tsx         (SVG schematic Tehran map)
        │   │   ├── nearby-view.tsx      (UNUSED — in-store flow moved to assistant)
        │   │   ├── product-card.tsx     (card with image, price, nearest shop, compare+cart buttons)
        │   │   ├── product-view.tsx     (product detail + ranked offers + verify panel)
        │   │   ├── rank.ts             (explainable weighted ranker)
        │   │   ├── search-view.tsx      (search + filters + pagination)
        │   │   ├── shop-card.tsx        (shop card with hours, installment, maps link)
        │   │   ├── shops-map-view.tsx  (list/map toggle for shops)
        │   │   ├── shops-view.tsx       (shop list with filters)
        │   │   ├── theme-provider.tsx
        │   │   ├── top-nav.tsx          (slim nav: home/assistant/search/shops/trip)
        │   │   ├── trip-view.tsx        (multi-stop trip planner with cart + Google Maps links)
        │   │   └── types.ts             (shared client-side types)
        │   └── ui/  (40+ shadcn/ui components)
        ├── hooks/ (use-mobile.ts, use-toast.ts)
        └── lib/
            ├── db.ts       (Prisma client — UNUSED, project uses better-sqlite3)
            ├── utils.ts    (cn helper)
            └── torob/
                ├── agent-tools.ts   (tool catalog + system/summary prompts)
                ├── api-helpers.ts   (filter parsing, error handling)
                ├── index.ts         (singleton ShoppingTools + re-exports)
                ├── normalize.ts     (TS port of normalize.py + parseQuery)
                └── tools.ts         (TS port of tools.py + 3 new tools: checkShopHours, prepareSellerInquiry, recordSellerConfirmation)
```

## 2. Current Architecture and Runtime Flow

**Two-layer architecture sharing one SQLite database:**

1. **Python layer** (source of truth): `tehran_agent/importer.py` builds `data/torob.sqlite` from the Torob dataset ZIP. `tehran_agent/tools.py` implements 6 core shopping tools. `tehran_agent/api.py` provides a standalone stdlib HTTP server. `tests/test_core.py` + `tests/test_api.py` test both.

2. **Next.js layer** (user-facing): `web/` is a Next.js 16 app with App Router. It ports the Python tools to TypeScript (`web/src/lib/torob/tools.ts`) and reads the same `data/torob.sqlite` via `better-sqlite3`. 13 API route handlers wrap the TS tools. The frontend is a single-page app (`src/app/page.tsx`) with 5 top-level tabs.

**Runtime flow:** User opens `/` → Next.js renders the RTL Persian SPA → API routes read from SQLite via better-sqlite3 → results rendered as product cards, shop lists, chat, map, and trip plans. The LLM agent (`/api/agent`) uses prompt-based function-calling to call the same TS tools.

## 3. Frontend Framework and UI Entry Points

- **Framework:** Next.js 16 with App Router, React 19, TypeScript 5
- **Styling:** Tailwind CSS 4, shadcn/ui (New York style), Vazirmatn font
- **Entry point:** `src/app/page.tsx` (single route `/`)
- **Navigation:** `top-nav.tsx` — 5 tabs: خانه | دستیار خرید | جست‌وجو | فروشگاه‌ها | برنامهٔ خرید
- **Theme:** next-themes (light/dark), `theme-provider.tsx`
- **State:** Zustand stores for cart (`cart-store.ts`) and compare (`compare-store.ts`)

## 4. Backend and Database Architecture

- **Database:** SQLite (389 MB, 6,476 shops, 225,903 products, 331,506 offers)
- **Schema:** 4 tables (meta, products, shops, offers) + 5 indexes, defined in `importer.py`
- **Access:** `better-sqlite3` (read-only, singleton via `web/src/lib/torob/index.ts`)
- **Server config:** `next.config.ts` marks `better-sqlite3` as `serverExternalPackages`
- **Python API:** `tehran_agent/api.py` — standalone stdlib HTTP server (not used by the Next.js frontend)

## 5. Feature Inventory

### Implemented and tested
| Feature | Tests | Notes |
|---|---|---|
| Persian text normalization (digits, chars, ZWNJ) | 3 Python tests | Python + TS ports are consistent |
| Budget parsing (numeric, "میلیون/هزار/میلیارد") | 1 Python test | Spelled-out numbers not supported (documented) |
| Filter validation (sort, price, location, limit) | 5 Python tests | |
| Haversine distance | 1 Python test | |
| Neighborhood resolution (6 Tehran areas) | 1 Python test | |
| Product search with connectivity filter (wireless/wired) | 5 Python tests | "ماوس بی سیم" excludes wired |
| Product details | 2 Python tests | |
| Offer comparison | 2 Python tests | |
| Shop discovery (with distance, synthetic-name flag) | 2 Python tests | |
| Product alternatives (same category, budget) | 1 Python test | Sorted by cheapest ASC |
| Shopping trip planning (greedy heuristic) | 1 Python test | Straight-line distances |
| Python stdlib HTTP API (health, meta, search, compare, trip) | 5 Python tests | |
| TS tools port (42 assertions) | 42 TS assertions | All pass via `verify-tools.ts` |
| ESLint | Clean (0 errors) | |
| Production build | ✅ Passes | (after fixing missing shops-map-view.tsx) |

### Implemented but insufficiently tested
| Feature | Status | Gap |
|---|---|---|
| LLM agent (function-calling) | Works (browser-verified) | No automated tests; depends on z-ai-web-dev-sdk availability |
| Seller inquiry message generation | Works via API | No tests |
| Seller confirmation recording | Works via API (in-memory) | No tests; not persisted across restarts |
| Shop hours (today/any day) | Works via API | No tests |
| Installment filter | Works via API | No tests for search or shops |
| Explainable ranking (rank.ts) | Works in product-view | No tests |
| Cart + compare stores (zustand) | Works in UI | No tests |
| Google Maps links (per shop, per trip stop) | Works (external links) | No tests; relies on lat/lon in dataset |
| Trip nearest-neighbor route optimization | Works client-side | No tests |

### Partially implemented
| Feature | Status | What's missing |
|---|---|---|
| Geolocation | `navigator.geolocation` used in search, shops, trip | No fallback if denied (only shows error text) |
| Conversation history in agent | History sent to LLM | No persistence; resets on page reload |
| Open-now filter | Backend supports `open_now` in findShops | Only exposed in nearby-view (now unused); not in shops-view filters |

### UI-only / mocked
| Feature | Status |
|---|---|
| Seller confirmation states (4 badges) | UI shows the 4 states, but the backend stores them in an in-memory Map (no persistence) |
| "قیمت تأییدشده" vs "قیمت ثبت‌شده" distinction | UI labels are present; no actual verification happens — the user must manually call the shop |

### Not implemented
| Feature | Notes |
|---|---|
| Auto-calling shops for price/stock verification | No telephony channel; correctly not faked |
| Routing API (real driving directions) | Only Google Maps external links + straight-line distances |
| User accounts / auth | NextAuth is a dependency but unused |
| Prisma ORM | `src/lib/db.ts` exists with Prisma client but is unused; all DB access uses better-sqlite3 |
| TypeScript strict type checking | `tsc --noEmit` has 9 errors (see §8) |
| Frontend automated tests | No Jest/Vitest/Playwright |

### Blocked by missing external credentials or services
| Feature | Blocker |
|---|---|
| LLM agent in production | Requires z-ai-web-dev-sdk credentials (works in sandbox) |
| Real routing/directions | No maps API key (Google Maps used as external links only) |

## 6. How to Run Tests

### Python tests
```bash
cd torobgard
python -m unittest discover -s tests -v
# Result: 31 tests, all OK (26 in test_core + 5 in test_api)
```

### Frontend lint
```bash
cd torobgard/web
bun run lint
# Result: eslint . — clean, 0 errors
```

### Frontend TS verify-tools
```bash
cd torobgard/web
node --experimental-strip-types scripts/verify-tools.ts
# Result: 42 passed, 0 failed
```

### Production build
```bash
cd torobgard/web
bun run build
# Result: ✅ Passes (after fixing missing shops-map-view.tsx)
```

### Type checking
```bash
cd torobgard/web
npx tsc --noEmit
# Result: 9 errors (see §8 for details)
```

## 7. External Integrations

| Integration | Status | Evidence |
|---|---|---|
| z-ai-web-dev-sdk (LLM) | ✅ Operational in sandbox | `/api/agent` returns grounded Persian answers |
| Google Maps (external links) | ✅ Operational | `https://www.google.com/maps/dir/?api=1&...` links in trip-view and shop-card |
| `navigator.geolocation` | ✅ Operational | Used in search-view, shops-view, trip-view |
| better-sqlite3 (native addon) | ✅ Operational | `serverExternalPackages` configured; loads in Node |
| Prisma ORM | ❌ Unused | `src/lib/db.ts` exists but no route imports it; all access via better-sqlite3 |

## 8. Duplicate Implementations and Inconsistent API Contracts

### Duplicates
1. **Python `tools.py` vs TS `tools.ts`**: Both implement the same 6 tools with the same schema. The Python version is the source of truth. The TS port has 3 additional tools not in Python (`checkShopHours`, `prepareSellerInquiry`, `recordSellerConfirmation`). **Risk: drift** — if the Python tools change, the TS port won't automatically follow.

2. **Python `normalize.py` vs TS `normalize.ts`**: Same logic. The TS version adds `parseQuery` (connectivity detection + budget parsing) which the Python version does not have (the Python search uses `_connection_mode` directly).

3. **Python `api.py` vs Next.js API routes**: Two HTTP APIs serve the same data. The Python one is a standalone stdlib server; the Next.js one uses route handlers. Only the Next.js API is used by the frontend.

4. **Unused components**: `agent-view.tsx`, `explore-view.tsx`, `nearby-view.tsx` are no longer imported by `page.tsx`. They remain in the repo but are dead code.

5. **Unused `src/lib/db.ts`**: Prisma client setup, but the project uses `better-sqlite3` instead. Dead code.

6. **Unused `src/app/api/route.ts`**: Contains only `return NextResponse.json({ message: "Hello, world!" })`. Placeholder from the scaffold.

### Inconsistent contracts
1. **Python `Filters` vs TS `Filters`**: Python's `Filters` dataclass lacks `installment_only` and `open_now`. The TS `Filters` interface has both. The Python `_offer_conditions` does not handle installment filtering (only TS does).

2. **Python `find_shops` response** does not include `contacts`, `weekly_hours`, `payment_options`, `has_installment`, `open_now`, `today_hours`, `website_url`, `instagram` — all of which the TS version returns.

3. **Python `compare_offers` response** does not include enriched shop fields (contacts, hours, installment, open_now). The TS version does.

4. **TypeScript `tsc --noEmit` has 9 errors:**
   - `tools.ts:20` — `.ts` extension in imports not allowed without `allowImportingTsExtensions`
   - `verify-tools.ts:3,5` — same `.ts` extension issue
   - `compare-panel.tsx:148` — `distance_km` possibly undefined (should use `?? null` guard)
   - `product-view.tsx:238` — `unknown` type not assignable to `ReactNode` (warranty field)
   - `tools.ts:793` — `day_info` missing from not-found return in `checkShopHours`
   - `tools.ts:847,849` — `known_price` and `known_price_changed_at` missing from not-found return in `prepareSellerInquiry`
   
   **Note:** `next.config.ts` has `typescript: { ignoreBuildErrors: true }`, so these don't block the build. But they indicate real type safety gaps.

## 9. Broken, Incomplete, or Placeholder Functionality

### Build failure (FIXED during audit)
- `page.tsx:12` imported `@/components/torob/shops-map-view` but the file was missing from the committed repo (existed only in the local workspace). **Fixed by copying the file.** This was a commit omission, not a code bug.

### Type errors (9, non-blocking due to `ignoreBuildErrors: true`)
- See §8 above. The most significant:
  - `tools.ts:793` — `checkShopHours` not-found return is missing `day_info` field
  - `tools.ts:847,849` — `prepareSellerInquiry` not-found returns are missing `known_price` and `known_price_changed_at` fields
  - `product-view.tsx:238` — warranty (`unknown` type) rendered directly as ReactNode

### In-memory-only data
- `recordSellerConfirmation` stores confirmations in a `Map<string, ConfirmationRecord>` module-level variable. This is correctly labeled "not persisted" in the UI, but any server restart loses all confirmations.

### Missing `fast_delivery` filter in Python
- The Python `Filters` dataclass and `_offer_conditions` support `fast_delivery` as a boolean. The TS version added `installment_only` and `open_now` which the Python version does not have. If someone uses the Python API directly, they can't filter by installment or open-now.

## 10. Dependencies and Environmental Requirements

### Python
- Python 3.10+ (standard library only; no pip installs needed)
- `pandas` not available (sandbox can't reach PyPI); audit/import use stdlib `csv` + `sqlite3`

### Frontend (web/)
- Node.js 22.6+ (for `--experimental-strip-types` on verify-tools)
- Bun 1.3.14 (for `bun run dev`, `bun run lint`, `bun run build`)
- Next.js 16.1.1 with Turbopack
- Key deps: better-sqlite3@13, z-ai-web-dev-sdk@0.0.18, zustand@5, framer-motion@12, next-themes@0.4
- No Prisma migrations needed (Prisma is installed but unused; all DB access is via better-sqlite3)

### Dataset
- `data/raw/starcoach-dataset-v16-cap300-csv.zip` (58 MB, committed to git)
- SHA256: `b0afb47b2b70f65c6d8ec07b7423dcc49efc71cd7a27e95606fb81da008c210d` (verified)

### Dev server
- `bun run dev` starts on port 3000
- `data/torob.sqlite` must exist (build with `python -m tehran_agent.importer --src data/raw/starcoach-dataset-v16-cap300-csv.zip --db data/torob.sqlite`)

---

## Prioritized Implementation Roadmap

### Module 1: Architecture and Data Contracts
- [P0] Fix 9 TypeScript type errors (missing fields in not-found returns, unknown→ReactNode, .ts extension imports)
- [P0] Remove dead code: `agent-view.tsx`, `explore-view.tsx`, `nearby-view.tsx`, `src/lib/db.ts`, `src/app/api/route.ts`
- [P1] Sync Python `Filters` with TS `Filters` (add `installment_only`, `open_now`)
- [P1] Sync Python `find_shops` / `compare_offers` responses with enriched TS fields
- [P2] Add `allowImportingTsExtensions: true` to `tsconfig.json` or remove `.ts` extensions from imports

### Module 2: Design System and Navigation
- [P1] Verify mobile responsiveness across all 5 tabs (390px, 768px, 1280px)
- [P1] Audit accessibility: focus states, ARIA labels, keyboard navigation, color contrast
- [P2] Document the design system (color tokens, spacing, typography)

### Module 3: Agentic Shopping Assistant and Generative UI
- [P1] Add automated test for the agent route (mock the z-ai SDK)
- [P1] Handle agent failure gracefully (SDK unavailable, timeout, malformed JSON)
- [P2] Persist conversation history (localStorage or server-side session)
- [P2] Add multi-turn tool-chaining (agent calls a tool, sees results, then calls another)

### Module 4: Product Search
- [P1] Add test for installment_only filter
- [P1] Add test for nearest-shop + distance on search results
- [P2] Add fuzzy search or typo tolerance (currently exact LIKE matching)

### Module 5: Product Comparison
- [P1] Add test for compare-panel recommendation logic
- [P1] Fix `distance_km` possibly-undefined type error in compare-panel
- [P2] Add more comparison criteria (specs, categories) when dataset supports

### Module 6: Shop Discovery and Filtering
- [P1] Add test for shop hours (open/closed) logic
- [P1] Add `open_now` filter to shops-view UI (currently only in the unused nearby-view)
- [P2] Add test for installment filter on shops

### Module 7: Cart and Seller-Confirmation Workflow
- [P1] Add test for cart-store (add, remove, clear, has)
- [P1] Add test for compare-store (max 2, replace oldest)
- [P2] Persist confirmations to SQLite (currently in-memory only)
- [P2] Add test for prepareSellerInquiry + recordSellerConfirmation

### Module 8: Map Integration and Shopping-Route Planner
- [P1] Add test for nearest-neighbor trip ordering
- [P2] Integrate a real routing API (OSRM or Google Directions) for driving time estimates
- [P2] Add drag-to-reorder stops in the trip view

### Module 9: Integration Tests, Performance, Accessibility, and Final QA
- [P0] Add Playwright or Cypress E2E tests for the golden path (search → compare → shop → trip)
- [P1] Run Lighthouse audit (performance, accessibility, SEO)
- [P1] Test all 5 data states: real data, synthetic data, empty results, error state, loading
- [P2] Add API rate limiting and input sanitization audit
- [P2] Performance: benchmark search queries on the 225k-product dataset (add FTS5 index if slow)
