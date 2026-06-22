import { toPremiumRecord, type FreshnessOptions } from "./premium.js";
import type { CrossValidation, DataObservation, QuoteSource, RawFundQuote } from "./types.js";
import { PremiumStore } from "./store.js";

export interface RefreshReport {
  sourceResults: Array<{ source: string; count: number; error?: string }>;
  recordCount: number;
}

interface Candidate { value: number; asOf: string | null; source: string; quote: RawFundQuote }

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function numericCandidates(quotes: RawFundQuote[], field: "price" | "referenceNav", dateField: "priceTime" | "navDate", sourceField: "priceSource" | "navSource"): Candidate[] {
  return quotes.flatMap((quote): Candidate[] => {
    const value = quote[field];
    return value !== null && Number.isFinite(value) && value > 0 ? [{ value, asOf: quote[dateField], source: quote[sourceField], quote }] : [];
  });
}

function newest(candidates: Candidate[]): Candidate | null {
  return [...candidates].sort((a, b) => timestamp(b.asOf) - timestamp(a.asOf))[0] ?? null;
}

function validate(candidates: Candidate[], selected: Candidate | null, kind: "price" | "nav"): CrossValidation["price"] {
  const unique = [...new Map(candidates.map((item) => [`${item.source}:${item.asOf ?? ""}`, item])).values()];
  const comparable = selected ? unique.filter((item) => {
    if (kind === "nav") return item.asOf !== null && item.asOf === selected.asOf;
    return item.asOf !== null && selected.asOf !== null && Math.abs(timestamp(item.asOf) - timestamp(selected.asOf)) <= 5 * 60_000;
  }) : [];
  const values = comparable.map((item) => item.value);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const spreadPercent = values.length >= 2 && mean !== 0 ? (Math.max(...values) - Math.min(...values)) / Math.abs(mean) * 100 : null;
  const threshold = kind === "price" ? 0.3 : 0.1;
  const observations: DataObservation[] = unique.map((item) => ({
    source: item.source, value: item.value, asOf: item.asOf,
    selected: selected !== null && item.source === selected.source && item.asOf === selected.asOf && item.value === selected.value
  }));
  return {
    sourceCount: unique.length,
    comparableSourceCount: comparable.length,
    spreadPercent,
    consistent: spreadPercent === null ? null : spreadPercent <= threshold,
    observations
  };
}

export function mergeFundQuotes(quotes: RawFundQuote[]): RawFundQuote {
  const first = quotes[0];
  if (!first) throw new Error("cannot merge an empty quote group");
  const prices = numericCandidates(quotes, "price", "priceTime", "priceSource");
  const navs = numericCandidates(quotes, "referenceNav", "navDate", "navSource");
  const selectedPrice = newest(prices);
  const selectedNav = newest(navs);
  const subscription = [...quotes]
    .filter((quote) => quote.subscriptionStatus !== "unknown")
    .sort((a, b) => timestamp(b.subscriptionStatusTime) - timestamp(a.subscriptionStatusTime))[0] ?? first;
  const details = quotes.find((quote) => quote.historicalPremiums || quote.tradingRules) ?? first;
  const priceValidation = validate(prices, selectedPrice, "price");
  const navValidation = validate(navs, selectedNav, "nav");
  const warnings: string[] = [];
  if (priceValidation.comparableSourceCount < 2) warnings.push("PRICE_SINGLE_SOURCE");
  if (navValidation.comparableSourceCount < 2) warnings.push("NAV_SINGLE_SOURCE");
  if (quotes.some((quote) => quote.price !== null && (!Number.isFinite(quote.price) || quote.price <= 0))) warnings.push("PRICE_INVALID_SOURCE_VALUE");
  if (quotes.some((quote) => quote.referenceNav !== null && (!Number.isFinite(quote.referenceNav) || quote.referenceNav <= 0))) warnings.push("NAV_INVALID_SOURCE_VALUE");
  if (priceValidation.consistent === false) warnings.push("PRICE_SOURCE_DIVERGENCE");
  if (navValidation.consistent === false) warnings.push("NAV_SOURCE_DIVERGENCE");

  return {
    ...first,
    price: selectedPrice?.value ?? null,
    priceTime: selectedPrice?.asOf ?? null,
    priceSource: selectedPrice?.source ?? first.priceSource,
    referenceNav: selectedNav?.value ?? null,
    navDate: selectedNav?.asOf ?? null,
    navSource: selectedNav?.source ?? first.navSource,
    subscriptionStatus: subscription.subscriptionStatus,
    subscriptionStatusText: subscription.subscriptionStatusText,
    subscriptionLimit: subscription.subscriptionLimit,
    subscriptionStatusTime: subscription.subscriptionStatusTime,
    subscriptionSource: subscription.subscriptionSource,
    historicalPremiums: details.historicalPremiums ?? [],
    ...(details.tradingRules ? { tradingRules: details.tradingRules } : {}),
    crossValidation: { selectionPolicy: "latest", price: priceValidation, nav: navValidation, warnings }
  };
}

export class PremiumService {
  constructor(
    private readonly store: PremiumStore,
    private readonly sources: QuoteSource[],
    private readonly freshness: FreshnessOptions = {}
  ) {}

  async refresh(signal?: AbortSignal): Promise<RefreshReport> {
    const settled = await Promise.allSettled(this.sources.map((source) => source.fetchQuotes(signal)));
    const grouped = new Map<string, RawFundQuote[]>();
    const sourceResults: RefreshReport["sourceResults"] = [];

    settled.forEach((result, index) => {
      const source = this.sources[index];
      if (!source) return;
      if (result.status === "rejected") {
        sourceResults.push({ source: source.name, count: 0, error: String(result.reason) });
        return;
      }
      sourceResults.push({ source: source.name, count: result.value.length });
      for (const quote of result.value) {
        const key = `${quote.exchange}:${quote.code}`;
        const group = grouped.get(key) ?? [];
        group.push(quote);
        grouped.set(key, group);
      }
    });

    const eligibleGroups = [...grouped.values()].filter((quotes) =>
      !quotes.some((quote) => quote.excludeFromRanking)
    );
    const records = eligibleGroups.map(mergeFundQuotes).map((raw) => toPremiumRecord(raw, this.freshness));
    if (records.length > 0) this.store.replace(records);
    return { sourceResults, recordCount: records.length };
  }
}
