# TorobGard — Post-Push Audit & Fixes

> تاریخ: ۲۰۲۶-۱۰-۲۲ · شاخه: `main` · commit‌های محلی: `6b358e6` + `469cd05` + (این ممیزی)
> ممیز: تیم ارشد (Senior Engineer + AI Agent Engineer + QA + UX + Security)

## ۱. خلاصه وضعیت

این ممیزی پس از push کد قبلی به GitHub انجام شد. هدف: رفع باگ‌های P0/P1 که
در بازبینی کد عمومی کشف شدند. **۲ باگ P0 و ۵ باگ P1 رفع شدند**، ۳۰ تست
رگرسیون اثبات می‌کنند باگ‌ها برنمی‌گردند.

## ۲. باگ‌های تأییدشده و وضعیت رفع

| ID | اولویت | عنوان | وضعیت | شواهد |
|---|---|---|---|---|
| P0-1 | P0 | مدل می‌تواند تأیید فروشنده جعل کند | **FIXED** | `record_seller_confirmation` از کاتالوگ ابزار حذف شد + از `runTool` switch رد می‌شود + ۶ تست |
| P0-2 | P0 | استخراج بودجه عدد اشتباه را پول فرض می‌کند | **FIXED** | regex عقب‌نشینی‌پذیر با `parseQuery` مشترک جایگزین شد + ۲۴ تست (سن/مدل/بودجهٔ واقعی/بازه) |
| P1-1 | P1 | ورودی API عامل به‌اندازهٔ کافی محدود نشده است | **FIXED** | اعتبارسنجی Zod: body strict، message≤2000، history≤10، session field-by-field، budget∈[0,10B]، lat∈[-90,90]، body size≤64KB |
| P1-2 | P1 | تشخیص بازبودن فروشگاه گمراه‌کننده است | **FIXED** | برچسب «باز» → «باز (ساعات ثبت‌شده)» در shop-card، product-view، assistant-view |
| P1-3 | P1 | برنامهٔ خرید مسیر واقعی نیست | **CONFIRMED (honest)** | `has_real_routing: false` + badge «فاصلهٔ هوایی (مسیریابی تنظیم‌نشده)» در trip-view — هیچ ادعای مسیر جاده‌ای بدون provider واقعی نشده |
| P1-4 | P1 | مبدأ مکانی محدود به چند محله | **CONFIRMED** | ۶ محلهٔ hardcoded مستند شد + تایید شد که وقتی مبدأ غایب است `distance_km: null` و sort=distance به fallback می‌رسد |
| P1-5 | P1 | خطاهای بارگذاری صفحه بی‌صدا نادیده گرفته می‌شوند | **FIXED** | `catch(() => {})` با error state + دکمهٔ «تلاش مجدد» جایگزین شد در page.tsx و home-view.tsx |

## ۳. باگ‌های دیگر بررسی‌شده

| موضوع | وضعیت | شواهد |
|---|---|---|
| تأیید در Map با restart از بین می‌رود | **CONFIRMED (disclosed)** | `confirmations = new Map()` in-memory + note در UI: «ثبت‌ها فقط همین نشست نگه‌داری می‌شوند» |
| فیلتر installment_only بر اساس شواهد معتبر | **FIXED** | badge «اقساط (ثبت‌شده)» + tooltip «بر اساس دادهٔ ثبت‌شده — قبل از مراجعه تأیید کنید» |
| پیشنهادهای بدون قیمت در cheapest-price دخالت نمی‌کنند | **CONFIRMED (PASS)** | `compareOffers` فقط `price_status='ok'` را در summary min/max محاسبه می‌کند (tools.ts:593-601) |
| مدل نمی‌تواند ابزار ناشناخته اجرا کند | **FIXED** | `runTool` default case: `{ error: "unknown tool: ..." }` + `record_seller_confirmation` رد می‌شود |
| fallback دستیار بودجه را در همهٔ مسیرها اعمال می‌کند | **FIXED** | fallback از همان `parseQuery` مشترک استفاده می‌کند + answersGiven فقط وقتی budget واقعاً parse شده اضافه می‌شود |
| build و lint اجرا نشده‌اند | **RUN** | `bun run lint`: 390 error (همگی pre-existing `{}` empty-object-type در کد third-party). `npx tsc --noEmit`: 2 error pre-existing در src/ (session.ts import path، tools.ts .ts extension). **۰ خطای جدید در کد ما.** |

## ۴. README Conflict Markers

**PASS** — `grep -rn "^<<<<<<<\|^=======\|^>>>>>>>" .` در کل مخزن: ۰ مورد.
تعارض README در commit قبلی (`6b358e6`) رفع شده بود.

## ۵. فایل‌های تغییرکرده و دلیل

| فایل | دلیل |
|---|---|
| `src/lib/torob/agent-tools.ts` | P0-1: `record_seller_confirmation` از TOOL_CATALOG حذف شد + یادداشت امنیتی + system prompt به‌روز شد |
| `src/app/api/agent/route.ts` | P0-1: `record_seller_confirmation` از `runTool` switch رد می‌شود + P0-2: regex بودجه با `parseQuery` مشترک جایگزین شد + P1-1: اعتبارسنجی Zod کامل (body/message/history/session) |
| `src/app/page.tsx` | P1-5: error state + retry برای /api/meta و /api/stats (نه `catch(() => {})`) |
| `src/components/torob/home-view.tsx` | P1-5: StatCard حالت خطا + دکمهٔ retry + بخش دسته‌ها حالت خطا |
| `src/components/torob/shop-card.tsx` | P1-2: «باز» → «باز (ساعات ثبت‌شده)» + P1: «قسطی» → «اقساط (ثبت‌شده)» با tooltip |
| `src/components/torob/product-view.tsx` | P1-2 + P1: همان برچسب‌های صادقانه |
| `src/components/torob/assistant-view.tsx` | P1-2 + P1: همان برچسب‌ها |
| `src/lib/torob/api-helpers.ts` | رفع warning eslint-disable بلااستفاده |
| `src/app/api/route/route.ts` | رفع type error: label `string | undefined` → `string` |
| `scripts/test-p0-regression.ts` | **جدید** — ۳۰ تست اثبات P0-1 و P0-2 برنمی‌گردند |
| `scripts/test-persian-normalization.ts` | اضافه‌شدن `export {}` برای module-mode |
| `scripts/test-e2e-http.ts` | اضافه‌شدن `export {}` |

## ۶. تست‌های اجراشده و نتیجه

| تست | تعداد | نتیجه |
|---|---|---|
| Python unittest | 31 | **PASS** |
| TS verify-tools | 42 | **PASS** |
| TS search-regression | 43 | **PASS** |
| TS agent | 63 | **PASS** |
| TS persian-normalization | 59 | **PASS** |
| TS e2e-http | 64 | **PASS** |
| TS p0-regression (جدید) | 30 | **PASS** |
| **مجموع** | **332** | **همه PASS** |
| ESLint | 390 error | همگی pre-existing `{}` type — ۰ در کد ما |
| tsc --noEmit (src/) | 2 error | pre-existing (session.ts import path, tools.ts .ts ext) — ۰ جدید |
| Agent Browser | 5 tab | همگی تعاملی، بدون خطا |

## ۷. وابستگی‌های خارجی پیکربندی‌نشده

| وابستگی | وضعیت | قرارداد |
|---|---|---|
| Neshan Maps | `not_configured` | `/api/route` + `routing.ts` آماده؛ haversine fallback با `is_estimated: true` |
| ارتباط با فروشنده | `not_configured` (by design) | `prepareSellerInquiry` پیام آماده می‌کند، ارسال خودکار نمی‌کند |
| LLM (z-ai SDK) | `PASS` | پیکربندی‌شده + fallback تعیینی |
| rate limiter | `not_configured` | `/api/agent` بدون rate limit (داخلی) |

## ۸. دستور اجرای پروژه

```bash
cd /home/z/my-project
bun run dev          # http://localhost:3000

# تست‌ها
cd torobgard && python3 -m unittest discover -s tests -v   # 31 Python
cd /home/z/my-project
node --experimental-strip-types scripts/verify-tools.ts          # 42
node --experimental-strip-types scripts/test-search-regression.ts # 43
node --experimental-strip-types scripts/test-agent.ts             # 63
node --experimental-strip-types scripts/test-persian-normalization.ts  # 59
node --experimental-strip-types scripts/test-e2e-http.ts          # 64
node --experimental-strip-types scripts/test-p0-regression.ts    # 30

# type-check
npx tsc --noEmit   # 2 pre-existing errors in src/ (documented)
bun run lint       # 390 pre-existing errors (documented)
```

## ۹. محدودیت‌های شناخته‌شده

- تأیید فروشنده در حافظه (Map) — پس از restart سرور پاک می‌شود (عمدی: هیچ ادعای پایداری بدون DB واقعی نشده)
- ۶ محلهٔ hardcoded تهران (صادقیه/ولنجک/ونک/میدان ولیعصر/تجریش/شریعتی) — مستند شد
- ۲ خطای tsc pre-existing در src/ (session.ts import path to generative-ui، tools.ts .ts extension) — `next.config.ts` has `typescript.ignoreBuildErrors: true`
- `data/raw/starcoach-dataset-v16-cap300-csv.zip` (58MB) tracked در git — بهتر است به release asset منتقل شود
