"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  Store,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SyntheticNameBadge } from "./disclaimers";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import type { ShopItem } from "./types";

/**
 * Phase 5: Enhanced shop card with product-specific offer data,
 * confirmation states, and seller-contact workflow.
 *
 * Confirmation states (Phase 5 §6):
 * - "unconfirmed" → gray badge "تأییدنشده"
 * - "pending" → amber badge "در انتظار پاسخ"
 * - "confirmed" → green badge "تأیید شد"
 * - "no_response" → red badge "پاسخ دریافت نشد"
 *
 * Never assumes a shop has stock, is open, or offers installments
 * without verified data. Shows "نامشخص" for unknown fields.
 */

interface SellerConfirmState {
  status: "unconfirmed" | "pending" | "confirmed" | "no_response";
  confirmedPrice: string;
  inStock: boolean | null;
  note: string;
}

export function ShopCard({
  shop,
  productId,
}: {
  shop: ShopItem;
  productId?: string;
}) {
  const mapsUrl = shop.lat !== null && shop.lon !== null
    ? `https://www.google.com/maps/search/?api=1&query=${shop.lat},${shop.lon}`
    : null;
  const today = shop.today_hours;
  const openLabel = today
    ? shop.open_now === true
      ? `باز • تا ${toPersianDigits(today.close || "")}`
      : shop.open_now === false
        ? today.status === "closed" ? "امروز تعطیل" : `بسته • از ${toPersianDigits(today.open || "")}`
        : "ساعت کاری نامشخص"
    : "ساعت کاری نامشخص";

  // Seller confirmation state (local component state; in real app would
  // persist via /api/confirm)
  const [confirmState, setConfirmState] = React.useState<SellerConfirmState>({
    status: "unconfirmed",
    confirmedPrice: "",
    inStock: null,
    note: "",
  });
  const [showInquiry, setShowInquiry] = React.useState(false);
  const [inquiryText, setInquiryText] = React.useState<string | null>(null);
  const [loadingInquiry, setLoadingInquiry] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const phone = shop.contacts?.find((c) => c.channel === "phone")?.display_number;

  const loadInquiry = async () => {
    if (!productId || !shop.shop_id) return;
    setLoadingInquiry(true);
    try {
      const r = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shop.shop_id, product_id: productId, ask_installment: true }),
      });
      const j = await r.json();
      if (j.message) setInquiryText(j.message);
    } catch {}
    setLoadingInquiry(false);
    setShowInquiry(true);
  };

  const copyInquiry = async () => {
    if (!inquiryText) return;
    try { await navigator.clipboard.writeText(inquiryText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const saveConfirmation = async (status: SellerConfirmState["status"]) => {
    if (!productId || !shop.shop_id) return;
    setSaving(true);
    try {
      await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_id: shop.shop_id,
          product_id: productId,
          status,
          confirmed_price_toman: confirmState.confirmedPrice ? Number(confirmState.confirmedPrice) : null,
          in_stock: confirmState.inStock,
          note: confirmState.note || null,
        }),
      });
      setConfirmState((s) => ({ ...s, status }));
    } catch {}
    setSaving(false);
  };

  const statusBadge = {
    unconfirmed: { label: "تأییدنشده", cls: "bg-muted text-muted-foreground" },
    pending: { label: "در انتظار پاسخ", cls: "bg-amber-500/15 text-amber-700" },
    confirmed: { label: "تأیید شد ✓", cls: "bg-emerald-600 text-white" },
    no_response: { label: "پاسخ دریافت نشد", cls: "bg-destructive text-white" },
  }[confirmState.status];

  return (
    <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300, damping: 22 }}>
      <Card className="h-full gap-3 p-4">
        {/* Header: name + badges */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <div className="rounded-md bg-primary/10 p-2 text-primary"><Store className="size-4" aria-hidden /></div>
            <div>
              <h3 className="text-sm font-semibold leading-relaxed">{shop.name}</h3>
              {shop.name_is_synthetic_warning && <SyntheticNameBadge />}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {shop.supports_fast_delivery && <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600"><Zap className="size-3" aria-hidden />ارسال سریع</Badge>}
            {shop.has_installment && <Badge className="gap-1 bg-amber-600 text-white hover:bg-amber-600"><CreditCard className="size-3" aria-hidden />قسطی</Badge>}
            <Badge variant={shop.open_now === true ? "default" : shop.open_now === false ? "destructive" : "secondary"} className="gap-1">
              <Clock className="size-3" aria-hidden />{openLabel}
            </Badge>
          </div>
        </div>

        {/* Address — only if it exists */}
        {shop.address ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span className="leading-relaxed">{shop.address}</span></p>
        ) : (
          <p className="text-xs text-muted-foreground">آدرس: اطلاعات موجود نیست</p>
        )}

        {/* Offer + distance info */}
        <div className="flex flex-wrap gap-1.5">
          {shop.location_label && <Badge variant="outline">{shop.location_label}</Badge>}
          {shop.distance_km !== null ? (
            <Badge variant="secondary" className="font-num gap-1"><Navigation className="size-3" aria-hidden />{formatDistanceKm(shop.distance_km)}</Badge>
          ) : (
            <Badge variant="outline" className="gap-1"><Navigation className="size-3" aria-hidden />فاصله نامشخص</Badge>
          )}
          <Badge variant="outline" className="font-num">{toPersianDigits(shop.matching_offers)} پیشنهاد منطبق</Badge>
          {shop.best_price_toman !== null && shop.best_price_toman !== undefined && <Badge variant="secondary" className="font-num">قیمت ثبت‌شده: {formatToman(shop.best_price_toman)}</Badge>}
        </div>

        {/* Confirmation status badge */}
        <div className="flex items-center gap-2">
          <Badge className={statusBadge.cls + " gap-1"}>
            <ShieldCheck className="size-3" aria-hidden />{statusBadge.label}
          </Badge>
          {confirmState.status === "confirmed" && confirmState.confirmedPrice && (
            <span className="text-xs text-emerald-600">قیمت تأییدشده: {formatToman(Number(confirmState.confirmedPrice))}</span>
          )}
        </div>

        {/* Contact actions */}
        <div className="flex flex-wrap gap-2">
          {phone && (
            <a href={`tel:${phone.replace(/\s/g, "")}`}>
              <Button type="button" variant="default" size="sm" className="h-9 gap-1.5">
                <Phone className="size-3.5" aria-hidden />تماس: {toPersianDigits(phone)}
              </Button>
            </a>
          )}
          {productId && (
            <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={loadInquiry} disabled={loadingInquiry}>
              {loadingInquiry ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}پیام آماده
            </Button>
          )}
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent">
              <Navigation className="size-3.5" aria-hidden />مسیر گوگل مپ<ExternalLink className="size-3" aria-hidden />
            </a>
          )}
        </div>

        {/* Inquiry message */}
        {showInquiry && inquiryText && (
          <div className="rounded-md bg-muted/40 p-2 text-xs leading-relaxed">
            <pre className="whitespace-pre-wrap font-sans">{inquiryText}</pre>
            <Button type="button" variant="ghost" size="sm" className="mt-1 h-8 gap-1" onClick={copyInquiry}>
              {copied ? <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              {copied ? "کپی شد" : "کپی متن"}
            </Button>
          </div>
        )}

        {/* Manual confirmation form */}
        {productId && (
          <div className="mt-1 border-t border-border pt-2">
            <p className="mb-1.5 text-xs font-medium">ثبت نتیجهٔ تماس:</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="number" placeholder="قیمت تأییدشده (تومان)" value={confirmState.confirmedPrice} onChange={(e) => setConfirmState((s) => ({ ...s, confirmedPrice: e.target.value }))} className="h-9 w-40 text-xs" />
              <div className="flex gap-1">
                <Button type="button" variant={confirmState.inStock === true ? "default" : "outline"} size="sm" className="h-9" onClick={() => setConfirmState((s) => ({ ...s, inStock: true }))}>موجود</Button>
                <Button type="button" variant={confirmState.inStock === false ? "default" : "outline"} size="sm" className="h-9" onClick={() => setConfirmState((s) => ({ ...s, inStock: false }))}>ناموجود</Button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button type="button" size="sm" className="h-9 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600" disabled={saving} onClick={() => saveConfirmation("confirmed")}>
                <ShieldCheck className="size-3.5" aria-hidden />تأیید شد
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={saving} onClick={() => saveConfirmation("pending")}>در انتظار</Button>
              <Button type="button" variant="outline" size="sm" className="h-9" disabled={saving} onClick={() => saveConfirmation("no_response")}>پاسخی نیامد</Button>
            </div>
            {confirmState.status !== "unconfirmed" && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {confirmState.status === "confirmed" ? "قیمت و موجودی توسط شما تأیید شد (در همین نشست)." : confirmState.status === "no_response" ? "فروشنده پاسخ نداد — فروشگاه‌های جایگزین را ببینید." : "در انتظار پاسخ فروشنده."}
              </p>
            )}
            <p className="mt-1 text-[11px] text-amber-600">قیمت‌ها ممکن است قدیمی باشند. ثبت‌ها فقط همین نشست نگه‌داری می‌شوند.</p>
          </div>
        )}

        {/* Fallback: when no_response, suggest alternatives */}
        {confirmState.status === "no_response" && shop.matching_offers > 1 && (
          <div className="mt-2 rounded-md bg-amber-500/10 p-2 text-xs">
            <p className="flex items-center gap-1.5 font-medium text-amber-700"><AlertTriangle className="size-3.5" aria-hidden />فروشگاه جایگزین پیشنهاد می‌شود</p>
            <p className="mt-1 text-muted-foreground">این فروشگاه پاسخ نداد. فروشگاه‌های دیگر این محصول را در فهرست بالا ببینید و با آن‌ها تماس بگیرید.</p>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
