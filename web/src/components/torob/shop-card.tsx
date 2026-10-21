"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Clock, CreditCard, MapPin, Store, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDistanceKm, formatToman, toPersianDigits } from "./format";
import { SyntheticNameBadge } from "./disclaimers";
import type { ShopItem } from "./types";

export function ShopCard({ shop }: { shop: ShopItem }) {
  return (
    <motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 300, damping: 22 }}>
      <Card className="h-full gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <Store className="size-4" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold leading-relaxed">{shop.name}</h3>
              {shop.name_is_synthetic_warning && <SyntheticNameBadge />}
            </div>
          </div>
          {shop.supports_fast_delivery && (
            <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
              <Zap className="size-3" aria-hidden />
              ارسال سریع
            </Badge>
          )}
        </div>

        {shop.address && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="leading-relaxed">{shop.address}</span>
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {shop.location_label && <Badge variant="outline">{shop.location_label}</Badge>}
          {shop.distance_km !== null && (
            <Badge variant="secondary" className="font-num">
              {formatDistanceKm(shop.distance_km)}
            </Badge>
          )}
          <Badge variant="outline" className="font-num">
            {toPersianDigits(shop.matching_offers)} پیشنهاد منطبق
          </Badge>
          {shop.best_price_toman !== null && shop.best_price_toman !== undefined && (
            <Badge variant="secondary" className="font-num">
              بهترین قیمت: {formatToman(shop.best_price_toman)}
            </Badge>
          )}
        </div>

        {(shop.weekly_hours || shop.payment_options) && (
          <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
            {shop.weekly_hours && (
              <span className="flex items-center gap-2">
                <Clock className="size-3.5 shrink-0" aria-hidden />
                {shop.weekly_hours}
              </span>
            )}
            {shop.payment_options && (
              <span className="flex items-center gap-2">
                <CreditCard className="size-3.5 shrink-0" aria-hidden />
                {shop.payment_options}
              </span>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}
