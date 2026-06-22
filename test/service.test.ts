import assert from "node:assert/strict";
import test from "node:test";
import { mergeFundQuotes, PremiumService } from "../src/service.js";
import { PremiumStore } from "../src/store.js";
import type { QuoteSource, RawFundQuote } from "../src/types.js";

const quote: RawFundQuote = {
  code: "161725", name: "白酒LOF", exchange: "SZ", price: 1.2,
  priceTime: "2026-06-21T02:00:00Z", referenceNav: null, navDate: null,
  priceSource: "主行情", navSource: "主源无净值",
  subscriptionStatus: "unknown", subscriptionStatusText: null, subscriptionLimit: null,
  subscriptionStatusTime: null, subscriptionSource: "主源无申购状态"
};

test("merges fallback fields and tolerates one failed source", async () => {
  const sources: QuoteSource[] = [
    { name: "primary", async fetchQuotes() { return [quote]; } },
    { name: "fallback", async fetchQuotes() { return [{ ...quote, price: 9, referenceNav: 1, navDate: "2026-06-20", priceSource: "备行情", navSource: "备净值", subscriptionStatus: "limited", subscriptionStatusText: "限购1000元", subscriptionLimit: 1000, subscriptionStatusTime: "2026-06-21T02:00:00Z", subscriptionSource: "备申购状态" }]; } },
    { name: "broken", async fetchQuotes() { throw new Error("upstream down"); } }
  ];
  const store = new PremiumStore();
  const report = await new PremiumService(store, sources, { now: new Date("2026-06-21T02:05:00Z") }).refresh();
  const result = store.query({ page: 1, pageSize: 10, search: "", subscriptionStatus: null, sortBy: "code", sortOrder: "asc" });
  assert.equal(result.data[0]?.price, 1.2);
  assert.equal(result.data[0]?.referenceNav, 1);
  assert.equal(result.data[0]?.navSource, "备净值");
  assert.equal(result.data[0]?.subscriptionStatus, "limited");
  assert.equal(result.data[0]?.subscriptionLimit, 1000);
  assert.equal(report.sourceResults[2]?.count, 0);
  assert.match(report.sourceResults[2]?.error ?? "", /upstream down/);
});

test("selects the latest source independently and flags cross-source divergence", () => {
  const older = { ...quote, price: 1, priceTime: "2026-06-21T02:00:00Z", priceSource: "东方财富行情", referenceNav: 1, navDate: "2026-06-20", navSource: "净值源A" };
  const latest = { ...quote, price: 1.02, priceTime: "2026-06-21T02:01:00Z", priceSource: "新浪行情", referenceNav: 1.001, navDate: "2026-06-21", navSource: "净值源B" };
  const merged = mergeFundQuotes([older, latest]);
  assert.equal(merged.price, 1.02);
  assert.equal(merged.priceSource, "新浪行情");
  assert.equal(merged.referenceNav, 1.001);
  assert.equal(merged.navSource, "净值源B");
  assert.equal(merged.crossValidation?.price.comparableSourceCount, 2);
  assert.equal(merged.crossValidation?.price.consistent, false);
  assert.ok(merged.crossValidation?.warnings.includes("PRICE_SOURCE_DIVERGENCE"));
  assert.equal(merged.crossValidation?.price.observations.find((item) => item.selected)?.source, "新浪行情");
});

test("does not compare stale market observations against a newer quote", () => {
  const stale = { ...quote, price: 1, priceTime: "2026-06-21T01:00:00Z", priceSource: "旧行情" };
  const latest = { ...quote, price: 1.5, priceTime: "2026-06-21T02:00:00Z", priceSource: "最新行情" };
  const merged = mergeFundQuotes([stale, latest]);
  assert.equal(merged.priceSource, "最新行情");
  assert.equal(merged.crossValidation?.price.comparableSourceCount, 1);
  assert.equal(merged.crossValidation?.price.consistent, null);
  assert.ok(merged.crossValidation?.warnings.includes("PRICE_SINGLE_SOURCE"));
});

test("rejects a newer zero quote and keeps the latest valid positive price", () => {
  const valid = { ...quote, price: 1.345, priceTime: "2026-06-21T02:00:00Z", priceSource: "腾讯行情" };
  const invalid = { ...quote, price: 0, priceTime: "2026-06-21T02:01:00Z", priceSource: "新浪行情" };
  const merged = mergeFundQuotes([valid, invalid]);
  assert.equal(merged.price, 1.345);
  assert.equal(merged.priceSource, "腾讯行情");
  assert.ok(merged.crossValidation?.warnings.includes("PRICE_INVALID_SOURCE_VALUE"));
});

test("excludes a fund when a source identifies a fixed unit-price placeholder", async () => {
  const sources: QuoteSource[] = [
    { name: "universe", async fetchQuotes() { return [quote]; } },
    { name: "market", async fetchQuotes() {
      return [{
        ...quote,
        price: null,
        excludeFromRanking: true,
        exclusionReason: "FIXED_UNIT_PRICE_PLACEHOLDER"
      }];
    } }
  ];
  const store = new PremiumStore();
  const report = await new PremiumService(store, sources).refresh();
  assert.equal(report.recordCount, 0);
  assert.equal(store.query({ page: 1, pageSize: 10, search: "", subscriptionStatus: null, sortBy: "code", sortOrder: "asc" }).pagination.total, 0);
});
