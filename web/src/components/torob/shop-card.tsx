"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Clock, CreditCard, ExternalLink, MapPin, Navigation, Store, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import { SyntheticNameBadge } from "./disclaimers";
import type { ShopItem } from "./types";

export function ShopCard({ shop }: { shop: ShopItem }) {
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
    : null;

  return (
    <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300, damping: 22 }}>
      <Card className="h-full gap-3 p-4">
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
            {openLabel && (
              <Badge variant={shop.open_now === true ? "default" : shop.open_now === false ? "destructive" : "secondary"} className="gap-1">
                <Clock className="size-3" aria-hidden />{openLabel}
              </Badge>
            )}
          </div>
        </div>

        {shop.address && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span className="leading-relaxed">{shop.address}</span></p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {shop.location_label && <Badge variant="outline">{shop.location_label}</Badge>}
          {shop.distance_km !== null && <Badge variant="secondary" className="font-num gap-1"><Navigation className="size-3" aria-hidden />{formatDistanceKm(shop.distance_km)}</Badge>}
          <Badge variant="outline" className="font-num">{toPersianDigits(shop.matching_offers)} پیشنهاد منطبق</Badge>
          {shop.best_price_toman !== null && shop.best_price_toman !== undefined && <Badge variant="secondary" className="font-num">بهترین قیمت: {formatToman(shop.best_price_toman)}</Badge>}
        </div>

        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 self-start rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
            <Navigation className="size-3.5" aria-hidden />مسیر در گوگل مپ<ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </Card>
    </motion.div>
  );
}
