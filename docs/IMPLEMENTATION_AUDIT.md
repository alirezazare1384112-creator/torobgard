# TorobGard — Implementation Audit

> تاریخ ممیزی: ۲۰۲۶-۱۰-۲۲ · شاخه: `main` · آخرین commit: `6b358e6 Rename طرب‌گارد → ترب‌گرد`
> ممیز: تیم ارشد (Senior Engineer + AI Agent Engineer + QA + UX + Security)

## ۱. خلاصهٔ وضعیت فعلی

پروژهٔ **ترب‌گرد** یک دستیار خرید حضوری تهران است که روی دیتاست واقعی Torob
(۶٬۴۷۶ فروشگاه / ۲۲۵٬۹۰۳ محصول / ۳۳۱٬۵۰۶ پیشنهاد، بارگذاری‌شده در `data/torob.sqlite`
با حجم ~۳۸۹MB) کار می‌کند. دو لایه دارد:

| لایه | مسیر | زبان | وضعیت |
|---|---|---|---|
| ابزارهای هسته (منبع حقیقت) | `tehran_agent/` | Python | ۳۱ تست PASS |
| رابط کاربری + پورت TS ابزارها + عامل LLM | `web/` (live: `src/`) | TypeScript / Next.js 16 | dev server HTTP 200، ۱۴۸ تست PASS |

**وضعیت کلی**: بیشتر قابلیت‌ها واقعاً پیاده‌سازی شده‌اند و کار می‌کنند. چند باگ
قطعی و چند مورد dead code یافت شد. گزارش زیر بر اساس اجرای واقعی HTTP API، تست‌های
رگرسیون، و ممیزی خط‌به‌خط کد تهیه شده است.

## ۲. جدول قابلیت‌ها و وضعیت واقعی

| Phase | قابلیت | وضعیت | شواهد |
|---|---|---|---|
| 1 | اجرای dev server | **PASS** | `GET /` → 200، `tail dev.log` پاک |
| 1 | `/api/meta` | **PASS** | `is_synthetic:false`، counts درست |
| 1 | `/api/stats` | **PASS** | ۶ دستهٔ برتر + price_status |
| 1 | `/api/search` | **PARTIAL** | کار می‌کند ولی `q` بدون سقف طول، و `near` بدون `radius_km` به‌طور پیش‌فرض به باکس ۵km محدود می‌شود |
| 1 | `/api/product/[id]` | **PASS** | validation `startsWith("product_")`، `offer_count` درست |
| 1 | `/api/compare/[id]` | **PARTIAL** | همان باگ باکس ۵km |
| 1 | `/api/shops` | **PARTIAL** | همان باگ باکس ۵km |
| 1 | `/api/alternatives/[id]` | **PARTIAL** | کار می‌کند ولی `limit` بدون سقف |
| 1 | `/api/trip` | **PARTIAL** | `max_shops` بدون سقف، `items[i].product_id` اعتبارسنجی نمی‌شود |
| 1 | `/api/hours/[id]` | **PASS** | ساعت امروز + کل هفته |
| 1 | `/api/agent` | **PASS** | LLM واقعی (z-ai SDK) کار می‌کند، fallback تعیینی هم دارد |
| 1 | `/api/inquiry` | **PASS** | پیام فارسی آمادهٔ ارسال می‌سازد (ارسال خودکار نمی‌کند) |
| 1 | `/api/confirm` | **PASS** | تأیید دستی فروشنده در حافظه (no persistence) |
| 2 | نرمال‌سازی فارسی (ي/ی، ك/ک، ارقام) | **PASS** | `normalize.ts`، ۳۱ تست Python + ۴۲ تست TS |
| 2 | تشخیص بی‌سیم/سیمی | **PASS** | `parseQuery` + SQL connectivity enforcement |
| 2 | پارس بودجه (میلیون/هزار/میلیارد) | **PASS** | `parseBudgetToman` |
| 3 | رتبه‌بندی قابل‌توضیح | **PARTIAL** | `rank.ts` امتیاز می‌دهد ولی فرمت خروجی کامل نیست |
| 3 | صفحه‌بندی / مرتب‌سازی | **PASS** | `limit/offset`، sort=price_asc/desc/relevance/distance |
| 3 | حالت بدون نتیجه | **PASS** | `status:"no_results"` برای `zzzqqqxxx` |
| 4 | مقایسهٔ محصولات | **PASS** | `compare-panel.tsx` تا ۲ محصول با جدول ویژگی |
| 5 | کشف فروشگاه | **PARTIAL** | باگ باکس ۵km فاصله را پنهان می‌کند |
| 5 | موقعیت مکانی کاربر | **PASS** | فقط با کلیک دکمه، never auto، never persisted |
| 6 | عامل مکالمه‌ای | **PASS** | `ask_user` + `search_products` واقعی، session حفظ می‌شود |
| 6 | Generative UI | **PARTIAL** | فقط ۳ نوع (QuestionCard/ProductCard/QuestionWithOptions) — فاقد ProductComparison/StoreCard/CartSummary/ShoppingRoute |
| 6 | اعتبارسنجی خروجی مدل | **PASS** | discriminated union، no `dangerouslySetInnerHTML`، no raw HTML |
| 7 | سبد خرید | **PARTIAL** | zustand بدون persist → در reload خالی می‌شود |
| 7 | وضعیت تأیید فروشنده | **PARTIAL** | enum فعلی: confirmed/pending/no_response/unconfirmed — فاقد recorded_price/unavailable/not_configured |
| 7 | ارتباط با فروشنده | **PASS** (honest) | پیام آماده می‌شود، ارسال خودکار نمی‌شود، `not_configured` صریح |
| 8 | مسیریابی چندمقصدی | **NOT_IMPLEMENTED** در frontend | `routing.ts` (Neshan adapter) وجود دارد ولی به هیچ endpoint/API/frontend وصل نیست |
| 9 | فارسی RTL | **PASS** | `<html dir="rtl" lang="fa">`، فوتر چسبان (`min-h-screen flex flex-col` + `mt-auto`) |
| 9 | موبایل-فرست | **PASS** | responsive با `sm:/md:/lg:` |
| 9 | حالت loading/empty/error | **PARTIAL** | در برخی نماها کامل، در برخی ناقص |
| 10 | امنیت: SQL/XSS/Path | **PASS** | همه `?` پارامتری، no raw HTML، `startsWith` validation |
| 10 | امنیت: error handling | **PARTIAL** | `e.message` خام روی ۵۰۰ لو می‌رود (مسیر فایل/schema) |
| 10 | امنیت: input caps | **PARTIAL** | alternatives/trip/search/agent بدون سقف |
| 11 | تست سرتاسری | **PARTIAL** | ۱۴۸ تست موجود، ولی e2e کلیک‌در‌مرورگر ناقص |

## ۳. باگ‌های قابل بازتولید

### BUG-1 (HIGH) — باکس ۵km پیش‌فرض در `near`
**فایل**: `src/lib/torob/tools.ts:274`
**مراحل بازتولید**:
```
GET /api/compare/product_74717ad8e2406094437ecdb5?near=صادقیه
→ {"status":"no_offers","offers":[],"summary":{"offer_count":0,...}}

GET /api/compare/product_74717ad8e2406094437ecdb5   (بدون near)
→ {"status":"ok","offers":[{price:569250,...}],"summary":{"offer_count":1,...}}
```
**علت**: `offerConditions` وقتی `near` تنظیم شده ولی `radius_km` null است، یک باکس
محدود ۵km روی SQL می‌گذارد (`radius = f.radius_km ?? 5.0`). این یک بهینه‌سازی پنهان
است که نتایج را حذف می‌کند. کاربر "نزدیک صادقیه" می‌خواهد همهٔ پیشنهادها را با
فاصله ببیند، نه فقط ≤۵km.
**تأثیر**: `/api/compare`، `/api/shops`، `searchProducts` (همگی از `offerConditions`).
**اصلاح**: وقتی `radius_km` null است، باکس را بزرگ بگیر (مثلاً ۳۰km = کل تهران) تا
فقط بهینه‌سازی باشد نه فیلتر. یا وقتی `near` بدون `radius_km` است، باکس را حذف کن.

### BUG-2 (HIGH) — `e.message` خام در ۵۰۰
**فایل**: `src/lib/torob/api-helpers.ts:52-56`، `src/app/api/agent/route.ts:222,395`
**علت**: `handleToolError` برای خطاهای غیر validation، `e.message` خام را به کلاینت
می‌فرستد. better-sqlite3 پیام‌هایی مثل `unable to open database file:
/home/z/my-project/data/torob.sqlite` می‌دهد که مسیر فایل سیستم و جزئیات schema را
لو می‌رود.
**اصلاح**: برای ۵۰۰، پیام عمومی `"internal_error"` بده و `e.message` را فقط
server-side لاگ کن.

### BUG-3 (HIGH) — دکمهٔ add-to-cart در product-view وجود ندارد
**فایل**: `src/components/torob/product-view.tsx`
**علت**: کاربر از صفحهٔ جزئیات محصول نمی‌تواند آن را به سبد اضافه کند؛ باید
برگردد و از طریق چت یا کارت‌های جست‌وجو اضافه کند.
**اصلاح**: دکمهٔ "افزودن به سبد" اضافه شود که به `cart-store` push کند.

### BUG-4 (MEDIUM) — سبد خرید در reload خالی می‌شود
**فایل**: `src/components/torob/cart-store.ts:18`، `compare-store.ts:13`
**علت**: zustand بدون `persist` middleware. کاربر که صفحه را refresh کند سبد خالی
می‌شود (فقط بین جابه‌جایی نماها باقی می‌ماند).
**اصلاح**: `persist` middleware با `localStorage` اضافه شود.

### BUG-5 (MEDIUM) — نوع `AgentResponse` stale + cast `as any`
**فایل**: `src/components/torob/types.ts:148-156`، `assistant-view.tsx:307`
**علت**: `AgentResponse` فاقد `generative`/`session`/`fallback` است و `as any`
دور آن زده می‌شود → قرارداد API type-check نمی‌شود.
**اصلاح**: نوع به‌روز شود، cast حذف شود.

### BUG-6 (MEDIUM) — `/api/alternatives` `limit` بدون سقف
**فایل**: `src/app/api/alternatives/[id]/route.ts:13`
**علت**: `limit` مستقیم به `findAlternatives` می‌رود و `MAX_LIMIT` اعمال نمی‌شود.
کلاینت می‌تواند `?limit=10000` بزند.
**اصلاح**: `Math.min(Math.max(1, limit), 100)`.

### BUG-7 (MEDIUM) — `/api/trip` `max_shops` بدون سقف + `items[i].product_id` اعتبارسنجی نمی‌شود
**فایل**: `src/app/api/trip/route.ts:13,18`
**علت**: `max_shops` منفی یا بزرگ سابق می‌شود؛ `items[i].product_id` قبل از رسیدن
به ابزار validation ندارد.
**اصلاح**: clamp به `[1,10]` و `startsWith("product_")`.

### BUG-8 (MEDIUM) — طول `q` / `message` بدون سقف
**فایل**: `src/app/api/search/route.ts:8`، `src/app/api/agent/route.ts:245`
**علت**: یک مگابایت متن به tokenizer می‌رود و ممکن است SQLite variable limit (۹۹۹)
را بشکند یا هزینهٔ LLM را بالا ببرد.
**اصلاح**: سقف ۱۰۲۴ کاراکتر.

### BUG-9 (MEDIUM) — شکل `session` در `/api/agent` اعتبارسنجی نمی‌شود
**فایل**: `src/app/api/agent/route.ts:259-261`
**علت**: shallow-merge `body.session` بدون type-check. کلاینت می‌تواند
`session: { budgetMax: "evil" }` بفرستد.
**اصلاح**: validation سخت‌گیرانه یا فقط فیلدهای مجاز را از patch بگیر.

### BUG-10 (LOW) — ۳ فایل کامپوننت dead code (~۱٬۳۰۰ LOC)
**فایل‌ها**: `src/components/torob/agent-view.tsx`، `explore-view.tsx`، `nearby-view.tsx`
**علت**: در هیچ جای used import نمی‌شوند. `agent-view` با `assistant-view`،
`nearby-view` با `shops-map-view`، `explore-view` با home/assistant تکراری‌اند.
**اصلاح**: حذف (با احتیاط — اول import ها را grep کن).

### BUG-11 (LOW) — `routing.ts` به هیچ جایی وصل نیست
**فایل**: `src/lib/torob/routing.ts` (نوشته شده ولی unused)
**علت**: adapter نشران خوبی دارد (Neshan واقعی + haversine fallback با `is_estimated`)
ولی نه endpoint HTTP دارد نه `trip-view` از آن استفاده می‌کند (خوش Euclidean
nearest-neighbor خودش را می‌زند).
**اصلاح**: یا `/api/route` بساز و trip-view به آن وصل کن، یا به‌عنوان adapter
آماده مستند کن (وضعیت فعلی `not_configured` صریح).

### BUG-12 (LOW) — فیلتر brand/category در search-view نیست
**فایل**: `src/components/torob/search-view.tsx`
**علت**: API این فیلترها را پشتیبانی می‌کند ولی UI نمایش نمی‌دهد.
**اصلاح**: dropdown brand/category اضافه شود (از `/api/meta`/`stats`).

## ۴. ریسک‌های امنیتی و کیفیت داده

- **امنیت (PASS)**: SQL همگی پارامتری، XSS نه (فقط shadcn chart.tsx که static است)،
  path traversal نه، secrets نه (فقط `process.env` refs)، geolocation فقط با کلیک.
- **امنیت (PARTIAL)**: `e.message` خام روی ۵۰۰ (BUG-2)، بدون rate limit روی
  `/api/agent` (برای ابزار داخلی قابل‌قبول ولی اگر public شود مشکل‌ساز).
- **کیفیت داده (PASS در disclaimers)**: نام‌های نمایشی، قیمت‌های قدیمی، بدون
  موجودی، ~۴٫۵٪ بدون قیمت — همگی در `disclaimers.tsx` (footer + banner + badge)
  به کاربر نشان داده می‌شود.

## ۵. وابستگی‌های خارجی پیکربندی‌نشده

| وابستگی | وضعیت | قرارداد اتصال |
|---|---|---|
| **Neshan Maps API** | `BLOCKED_EXTERNAL_DEPENDENCY` | `routing.ts` آماده است؛ `NESHAN_API_KEY` از env خوانده می‌شود؛ وقتی نباشد haversine fallback با `is_estimated:true` و `has_real_routing:false`. کلید موجود نیست → وضعیت فعلی "نمایشی/هوایی". |
| **LLM (z-ai SDK)** | `PASS` (پیکربندی‌شده در این محیط) | در دسترس. اگر نباشد fallback تعیینی کار می‌کند. |
| **ارتباط با فروشنده (تلفن/پیام‌رسان)** | `BLOCKED_EXTERNAL_DEPENDENCY` (by design) | `prepareSellerInquiry` پیام آماده می‌کند، ارسال خودکار نمی‌کند. `recordSellerConfirmation` تأیید دستی را در حافظه ذخیره می‌کند. هیچ ادعای تماس موفق نشده. |

## ۶. اولویت اصلاحات

1. **BUG-1** (باکس ۵km) — بیشترین تأثیر روی UX جست‌وجو/مقایسه/فروشگاه‌ها
2. **BUG-2** (sanitization خطا) — امنیت
3. **BUG-3** (add-to-cart) — UX
4. **BUG-4** (persist سبد) — UX
5. **BUG-6,7,8,9** (input caps) — امنیت/پایداری
6. **BUG-5** (نوع stale) — quality
7. **BUG-10** (dead code) — quality
8. **BUG-11** (routing) — تکمیل
9. **BUG-12** (فیلترها) — nice-to-have

## ۷. معیار پذیرش هر قابلیت

| قابلیت | معیار |
|---|---|
| `/api/compare?near=X` | وقتی پیشنهاد در شعاع بزرگ‌تر از ۵km اما داخل تهران است، با `distance_km` برگردد نه `no_offers` |
| خطای ۵۰۰ | بدنهٔ JSON `{error:"internal_error"}` بدون مسیر فایل/schema |
| add-to-cart | دکمه در product-view، بعد از کلیک سبد شامل آیتم باشد (zustand state) |
| persist سبد | بعد از reload صفحه سبد همچنان پر باشد (localStorage) |
| `limit` caps | `?limit=100000` → clamped به ۱۰۰، نه خطا |
| `q` cap | `?q=<1024 chars>` → 400 "query too long" نه ۵۰۰ |
| dead code | `agent-view/explore-view/nearby-view` حذف شوند، build همچنان OK |
| routing adapter | `/api/route` موجود و `isNeshanConfigured()` در trip-view نمایش داده شود |

## ۸. دستور اجرای پروژه

```bash
# ۱) اجرای dev server (پورت ۳۰۰۰)
cd /home/z/my-project
bun run dev          # http://localhost:3000

# ۲) اجرای تست‌ها
python3 -m unittest discover -s torobgard/tests -v     # 31 Python tests
node --experimental-strip-types scripts/verify-tools.ts      # 42 TS assertions
node --experimental-strip-types scripts/test-search-regression.ts  # 43 regression
node --experimental-strip-types scripts/test-agent.ts        # 63 agent tests
```

## ۹. نتیجهٔ تست‌ها در زمان ممیزی

| تست | تعداد | نتیجه |
|---|---|---|
| Python unittest | 31 | **PASS** (۶٫۷s) |
| TS verify-tools | 42 | **PASS** |
| TS search regression | 43 | **PASS** |
| TS agent tests | 63 | **PASS** |
| ESLint | 8330 problems | 390 errors (همگی از نوع `{}` empty-object-type در کد third-party/legacy، بدون رابطه با باگ‌های این ممیزی) |
| Dev server HTTP | 12 endpoints | 11 × 200، 1 × 404 (`/api/route` موجود نیست) |
| Agent Browser | 5 tabs | همگی تعاملی، بدون خطای کنسول |
