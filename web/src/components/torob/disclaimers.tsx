"use client";

import * as React from "react";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A dismissible banner shown at the top of the page when the dataset is
 * synthetic. Only shown in development — not in production with real data.
 */
export function SyntheticBanner({ isSynthetic }: { isSynthetic: boolean }) {
  const [dismissed, setDismissed] = React.useState(false);

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
        <X className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p className="flex-1 leading-relaxed">
          <span className="font-semibold">داده نمایشی:</span> این نسخه از داده نمونه استفاده می‌کند.
        </p>
        <Button
          size="sm"
          variant="ghost"
          aria-label="بستن اعلان"
          className="h-8 shrink-0 px-2 text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/50"
          onClick={() => {
            setDismissed(true);
            try { window.localStorage.setItem("torobgard:synthetic-banner-dismissed", "1"); } catch {}
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** Concise, user-friendly data notes for the footer. */
export function DisclaimerList({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const items = compact
    ? [
        "نام فروشگاه‌ها نمایشی است",
        "قیمت‌ها ممکن است تغییر کرده باشند",
        "موجودی تأیید نشده است",
      ]
    : [
        "نام فروشگاه‌ها نمایشی است و کسب‌وکار واقعی نیستند.",
        "قیمت‌ها قیمت ثبت‌شده هستند و ممکن است تغییر کرده باشند.",
        "موجودی کالا تأیید نشده است — قبل از مراجعه تماس بگیرید.",
        "فاصله‌های نمایش‌داده‌شده تقریبی (هوایی) هستند، نه مسیر رانندگی.",
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

/** Small badge next to shop names — concise, not alarming. */
export function SyntheticNameBadge() {
  return (
    <span
      title="نام نمایشی"
      className="inline-flex items-center gap-1 rounded border border-muted-foreground/30 bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
    >
      نمایشی
    </span>
  );
}
