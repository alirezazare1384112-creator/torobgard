"use client";

import * as React from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A dismissible banner shown at the top of the page when the dataset is
 * synthetic (meta.is_synthetic === true). Stored in localStorage so the
 * user stays dismissed across reloads of the synthetic dev dataset.
 */
export function SyntheticBanner({ isSynthetic }: { isSynthetic: boolean }) {
  const [dismissed, setDismissed] = React.useState(false);

  // read once on mount so SSR/CSR agree (suppressHydrationWarning on <html>)
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      setDismissed(window.localStorage.getItem("torobgard:synthetic-banner-dismissed") === "1");
    }
  }, []);

  if (!isSynthetic || dismissed) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-40 w-full border-b border-amber-500/30 bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-2.5 text-sm">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="flex-1 leading-relaxed">
          <span className="font-semibold">نمایشی:</span> این داده نمونه مصنوعی است برای
          توسعه؛ دیتابیس واقعی جایگزین می‌شود.
        </p>
        <Button
          size="sm"
          variant="ghost"
          aria-label="بستن اعلان"
          className="h-8 shrink-0 px-2 text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/50"
          onClick={() => {
            setDismissed(true);
            try {
              window.localStorage.setItem("torobgard:synthetic-banner-dismissed", "1");
            } catch {
              /* ignore */
            }
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Small inline list of disclaimers, used near price/offer cards and in footer. */
export function DisclaimerList({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const items = compact
    ? [
        "نام فروشگاه‌ها مصنوعی است",
        "قیمت‌ها ممکن است قدیمی باشند",
        "اطلاعات موجودی در داده نیست",
        "حدود ۴٫۵٪ پیشنهادها قیمت ندارند",
      ]
    : [
        "نام فروشگاه‌ها در دیتاست Torob مصنوعی است (نه کسب‌وکار واقعی).",
        "قیمت‌ها ممکن است قدیمی باشند؛ مهر زمانی تا ۲۰۲۰ برمی‌گردد.",
        "اطلاعات موجودی (stock) در داده وجود ندارد.",
        "حدود ۴٫۵٪ پیشنهادها قیمت ندارند (price_status = missing).",
        "موقعیت جغرافیایی نقشه شماتیک است، نه مسیریابی واقعی.",
      ];
  return (
    <ul className={`space-y-1 ${className}`}>
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="leading-relaxed">{t}</span>
        </li>
      ))}
    </ul>
  );
}

/** A tiny inline "نام مصنوعی" warning badge used next to synthetic shop names. */
export function SyntheticNameBadge() {
  return (
    <span
      title="نام این فروشگاه مصنوعی است"
      className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <AlertTriangle className="size-2.5" aria-hidden />
      نام مصنوعی
    </span>
  );
}
