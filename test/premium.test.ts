import assert from "node:assert/strict";
import test from "node:test";
import { calculatePremiumRate, toPremiumRecord } from "../src/premium.js";
import type { RawFundQuote } from "../src/types.js";

const base: RawFundQuote = {
  code: "161725",
  name: "招商中证白酒LOF",
  exchange: "SZ",
  price: 1.1,
  priceTime: "2026-06-21T02:00:00.000Z",
  referenceNav: 1,
  navDate: "2026-06-20",
  priceSource: "测试行情",
  navSource: "测试净值",
  subscriptionStatus: "limited",
  subscriptionStatusText: "限制申购1000元",
  subscriptionLimit: 1000,
  subscriptionStatusTime: "2026-06-21T02:00:00Z",
  subscriptionSource: "测试申购状态"
};

test("calculates normal and extreme premium values with the documented formula", () => {
  assert.ok(Math.abs((calculatePremiumRate(1.1, 1) ?? 0) - 10) < 1e-12);
  assert.equal(calculatePremiumRate(101, 1), 10_000);
  assert.equal(calculatePremiumRate(-1, 1), null);
});

test("missing, zero and non-finite NAV never produce a premium", () => {
  assert.equal(calculatePremiumRate(1, null), null);
  assert.equal(calculatePremiumRate(1, 0), null);
  assert.equal(calculatePremiumRate(1, -1), null);
  assert.equal(calculatePremiumRate(1, Number.NaN), null);
  assert.equal(calculatePremiumRate(null, 1), null);
  assert.equal(calculatePremiumRate(Number.POSITIVE_INFINITY, 1), null);
});

test("marks stale timestamps explicitly and preserves source metadata", () => {
  const record = toPremiumRecord(base, { now: new Date("2026-06-21T02:10:00.000Z") });
  assert.equal(record.isStale, false);
  assert.equal(record.priceSource, "测试行情");
  assert.equal(record.navSource, "测试净值");

  const stale = toPremiumRecord({ ...base, priceTime: "2026-06-20T01:00:00Z", navDate: "2026-06-01" }, {
    now: new Date("2026-06-21T02:10:00Z")
  });
  assert.equal(stale.isStale, true);
  assert.deepEqual(stale.staleReasons, ["PRICE_STALE", "NAV_STALE"]);
});

test("missing dates are stale and missing NAV remains null rather than zero", () => {
  const record = toPremiumRecord({ ...base, referenceNav: null, priceTime: null, navDate: null });
  assert.equal(record.premiumRate, null);
  assert.equal(record.isStale, true);
  assert.deepEqual(record.staleReasons, ["PRICE_TIME_MISSING_OR_INVALID", "NAV_DATE_MISSING_OR_INVALID"]);
});
