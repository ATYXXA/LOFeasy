import type { CrossValidation, DataObservation, PremiumRecord, RawFundQuote } from "./types.js";

export interface FreshnessOptions {
  now?: Date;
  maxPriceAgeMs?: number;
  maxNavAgeDays?: number;
}

const DAY_MS = 86_400_000;

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function calculatePremiumRate(price: number | null, nav: number | null): number | null {
  if (price === null || nav === null || !Number.isFinite(price) || !Number.isFinite(nav) || price <= 0 || nav <= 0) {
    return null;
  }
  return (price / nav - 1) * 100;
}

export function toPremiumRecord(raw: RawFundQuote, options: FreshnessOptions = {}): PremiumRecord {
  const now = options.now ?? new Date();
  const maxPriceAgeMs = options.maxPriceAgeMs ?? 15 * 60_000;
  const maxNavAgeDays = options.maxNavAgeDays ?? 3;
  const priceTime = validDate(raw.priceTime);
  const navDate = validDate(raw.navDate);
  const staleReasons: string[] = [];

  if (!priceTime) staleReasons.push("PRICE_TIME_MISSING_OR_INVALID");
  else if (now.getTime() - priceTime.getTime() > maxPriceAgeMs) staleReasons.push("PRICE_STALE");
  if (!navDate) staleReasons.push("NAV_DATE_MISSING_OR_INVALID");
  else if (now.getTime() - navDate.getTime() > maxNavAgeDays * DAY_MS) staleReasons.push("NAV_STALE");

  const singleValidation = (source: string, value: number | null, asOf: string | null) => {
    const observations: DataObservation[] = value !== null && Number.isFinite(value)
      ? [{ source, value, asOf, selected: true }]
      : [];
    return { sourceCount: observations.length, comparableSourceCount: observations.length, spreadPercent: null, consistent: null, observations };
  };
  const crossValidation: CrossValidation = raw.crossValidation ?? {
    selectionPolicy: "latest",
    price: singleValidation(raw.priceSource, raw.price, raw.priceTime),
    nav: singleValidation(raw.navSource, raw.referenceNav, raw.navDate),
    warnings: ["PRICE_SINGLE_SOURCE", "NAV_SINGLE_SOURCE"]
  };
  const { crossValidation: _ignored, ...record } = raw;
  return {
    ...record,
    premiumRate: calculatePremiumRate(raw.price, raw.referenceNav),
    isStale: staleReasons.length > 0,
    staleReasons,
    updatedAt: now.toISOString(),
    crossValidation
  };
}
