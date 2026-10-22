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

// ============================================================================
// Verification badges — inspired by the Stitch UI design, but honest.
// Three states, each with a distinct color, icon, and tooltip explaining
// the source of the claim. NEVER fabricate a verification state.
// ============================================================================

type VerificationStatus =
  | "confirmed"      // seller confirmed (user manually recorded the call result)
  | "recorded"       // price recorded in the Torob dataset (default, not verified)
  | "pending"        // user has sent an inquiry, waiting for seller response
  | "no_response"    // user contacted seller but got no answer
  | "unavailable"    // seller confirmed the product is out of stock
  | "unknown";       // no data

interface VerificationBadgeProps {
  status: VerificationStatus;
  compact?: boolean;
  className?: string;
}

const VERIFICATION_STYLES: Record<VerificationStatus, {
  label: string;
  icon: React.ReactNode;
  container: string;
  title: string;
}> = {
  confirmed: {
    label: "تأیید فروشنده",
    icon: (
      <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden>
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
      </svg>
    ),
    container: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300",
    title: "قیمت و موجودی توسط شما با تماس دستی با فروشنده تأیید شده است (در همین نشست)",
  },
  recorded: {
    label: "قیمت ثبت‌شده",
    icon: (
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" />
      </svg>
    ),
    container: "bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-900/40 dark:border-slate-700 dark:text-slate-300",
    title: "قیمت از دیتاست Torob ثبت شده — ممکن است قدیمی باشد. قبل از مراجعه تأیید کنید.",
  },
  pending: {
    label: "در انتظار پاسخ",
    icon: (
      <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2a10 10 0 0110 10h-2a8 8 0 00-8-8V2z" />
      </svg>
    ),
    container: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300",
    title: "پیام استعلام برای فروشنده فرستاده شده، در انتظار پاسخ",
  },
  no_response: {
    label: "بدون پاسخ",
    icon: (
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round" />
      </svg>
    ),
    container: "bg-red-50 border-red-200 text-red-600 dark:bg-red-950/40 dark:border-red-800 dark:text-red-300",
    title: "فروشنده پاسخ نداد — فروشگاه‌های جایگزین را امتحان کنید",
  },
  unavailable: {
    label: "ناموجود",
    icon: (
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    container: "bg-red-50 border-red-200 text-red-600 dark:bg-red-950/40 dark:border-red-800 dark:text-red-300",
    title: "فروشنده تأیید کرد این محصول ناموجود است — جایگزین‌های مرتبط را ببینید",
  },
  unknown: {
    label: "نامشخص",
    icon: (
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 016 0c0 2-3 2-3 4M12 17h.01" strokeLinecap="round" />
      </svg>
    ),
    container: "bg-muted border-border text-muted-foreground",
    title: "اطلاعاتی در دسترس نیست",
  },
};

/** A pill badge showing the verification state of a shop/price, with a
 *  tooltip explaining the source of the claim. Inspired by the Stitch UI
 *  design's verification badges, but only displays states that are actually
 *  backed by data or a user action. */
export function VerificationBadge({ status, compact, className = "" }: VerificationBadgeProps) {
  const s = VERIFICATION_STYLES[status];
  return (
    <span
      title={s.title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.container} ${className}`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

/** A "x% ارزان‌تر از بازار" comparison badge. Computes the percentage
 *  difference between a given price and the median of a reference set,
 *  showing green when the price is meaningfully below the median. */
export function MarketComparisonBadge({
  price,
  referencePrices,
  className = "",
}: {
  price: number;
  referencePrices: number[];
  className?: string;
}) {
  if (referencePrices.length < 3) return null; // need at least 3 for a meaningful median
  const sorted = [...referencePrices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  if (median <= 0 || price <= 0) return null;
  const diffPct = Math.round(((median - price) / median) * 100);
  // Only show when the price is at least 5% below the median
  if (diffPct < 5) return null;
  return (
    <span
      title={`میانگین قیمت بازار: ${median.toLocaleString("fa-IR")} تومان`}
      className={`inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300 ${className}`}
    >
      {diffPct.toLocaleString("fa-IR")}٪ ارزان‌تر از بازار
    </span>
  );
}

/** Display a shop's floor / unit info IF it exists in the address.
 *  The Torob dataset's address field sometimes contains mall + floor info
 *  like "پاساژ علاءالدین، طبقه منفی ۱، پلاک ۴۳". We extract and highlight
 *  the floor/unit portion. If no floor info is found, returns null. */
export function FloorUnitBadge({ address }: { address: string | null }) {
  if (!address) return null;
  // Look for "طبقه" or "پلاک" or "واحد" patterns
  const match = address.match(/(طبقه[^،,]*|پلاک\s*\d+|واحد\s*\d+)/);
  if (!match) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {match[1]}
    </span>
  );
}
