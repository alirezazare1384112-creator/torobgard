# ترب‌گرد — رابط کاربری (Next.js)

رابط کاربری فارسی و راست‌چین (RTL) پروژه ترب‌گرد. این لایه روی همان دیتابیس SQLite که
ب توسط `tehran_agent/importer.py` ساخته می‌شود کار می‌کند، اما ابزارهای هسته به TypeScript
پورت شده‌اند و مستقیماً با `better-sqlite3` از دیتابیس می‌خوانند (بدون نیاز به سرور
پایتون در حین اجرا).

## پیش‌نیازها

- Node.js 22.6 یا بالاتر (برای `--experimental-strip-types` هنگام اجرای اسکریپت seed).
  در صورت نبود، می‌توانید `tsx` را نصب کنید: `npm i -g tsx` و سپس `tsx scripts/seed-torob.ts`.
- در این محیط توسعه از `bun` برای اجرای dev server استفاده می‌شود (`bun install`، `bun run dev`).

## راه‌اندازی

```bash
cd web
bun install                 # یا npm install

# ۱) ساخت دیتابیس نمونه (مصنوعی اما با همان schema واقعی)
node --experimental-strip-types scripts/seed-torob.ts
#    خروجی: data/torob.sqlite (220 فروشگاه / ۳۰۱۰ محصول / ۷۴۹۰ پیشنهاد)

# ۲) اجرای dev server
bun run dev                 # http://localhost:3000
```

## استفاده از دیتابیس واقعی

دیتابیس واقعی را با importer پایتون بسازید (از ریشه مخزن):

```bash
python -m tehran_agent.importer --src data/raw/torob-dataset --db web/data/torob.sqlite
```

سپس فایل `web/data/torob.sqlite` جایگزین نسخه نمونه می‌شود — **بدون هیچ تغییر کد**،
چون schema یکسان است. وقتی `meta.is_synthetic` مقدارش `true` نباشد، بنر «داده نمایشی»
به‌طور خودکار در رابط کاربری مخفی می‌شود.

## راستی‌آمیزی ابزارها (اختیاری)

```bash
node --experimental-strip-types scripts/verify-tools.ts   # ۴۲ assertion
```

## ساختار

| مسیر | توضیح |
|---|---|
| `src/lib/torob/normalize.ts` | پورت `tehran_agent/normalize.py` + `parseQuery` (تشخیص wireless/wired + بودجه) |
| `src/lib/torob/tools.ts` | پورت ۶ ابزار `tehran_agent/tools.py` روی `better-sqlite3` |
| `src/lib/torob/agent-tools.ts` | کاتالوگ ابزار برای دستیار LLM |
| `src/app/api/*` | ۹ مسیر API (search, product, compare, shops, alternatives, trip, stats, meta, agent) |
| `src/app/api/agent/route.ts` | دستیار هوشمند: LLM یک ابزار انتخاب می‌کند، اجرا می‌کند، پاسخ فارسی می‌دهد |
| `src/components/torob/*` | ۵ نما: خانه، جست‌وجو، مقایسه محصول، فروشگاه‌ها، نقشه تهران، دستیار |
| `src/app/page.tsx` | کنترلر view-state تک‌صفحه‌ای (تنها روت کاربری: `/`) |
| `scripts/seed-torob.ts` | ساخت دیتابیس نمونه فارسی (deterministic) |

## رفع باگ تطبیق عبارت

در `DATA_AUDIT.md` ذکر شده که جست‌وجوی «ماوس بی‌سیم» نتیجه‌های «ماوس بی‌صدا با سیم»
(سیمی) هم برمی‌گرداند. در این پورت TypeScript رفع شده است:

- `parseQuery` ویژگی wireless/wired را روی جریان توکن‌ها تشخیص می‌دهد (نه با ممنوع‌کردن
  زیررشته «سیم»).
- شرط connectivity به SQL فشار داده می‌شود: `title_norm LIKE '%بی سیم%'` برای بی‌سیم،
  و `LIKE '%با سیم%' AND NOT LIKE '%بی سیم%'` برای سیمی.
- نتیجه: «ماوس بی‌سیم» فقط ماوس بی‌سیم برمی‌گرداند؛ «ماوس با سیم» فقط سیمی.

## محدودیت‌های داده‌ای (در رابط کاربری نمایش داده می‌شوند)

- نام فروشگاه‌ها مصنوعی است.
- قیمت‌ها ممکن است قدیمی باشند (مهر زمانی تا ۲۰۲۰ برمی‌گردد).
- اطلاعات موجودی (stock) در داده نیست.
- حدود ۴٫۵٪ پیشنهادها قیمت ندارند.

## دیس‌کلیمر

این داده نمونه مصنوعی است و فقط برای توسعه استفاده می‌شود. نام فروشگاه‌ها، آدرس‌ها
و تماس‌ها واقعی نیستند.
