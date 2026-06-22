import assert from "node:assert/strict";
import test from "node:test";
import { toPremiumRecord } from "../src/premium.js";
import { PremiumStore } from "../src/store.js";
import type { RawFundQuote } from "../src/types.js";

const raw = (code: string, name: string, premiumNav: number | null, price = 1): RawFundQuote => ({
  code, name, exchange: code.startsWith("5") ? "SH" : "SZ", price,
  priceTime: "2026-06-21T02:00:00Z", referenceNav: premiumNav, navDate: "2026-06-20",
  priceSource: "p", navSource: "n", subscriptionStatus: "open", subscriptionStatusText: "开放申购",
  subscriptionLimit: null, subscriptionStatusTime: "2026-06-21T02:00:00Z", subscriptionSource: "s"
});

test("supports search, pagination and descending premium sort", () => {
  const store = new PremiumStore();
  store.replace([
    toPremiumRecord(raw("161001", "富国一号", 1, 1.1)),
    toPremiumRecord(raw("161002", "富国二号", 1, 1.3)),
    toPremiumRecord(raw("501003", "其他基金", 1, 1.2))
  ], "2026-06-21T02:05:00Z");
  const result = store.query({ page: 1, pageSize: 1, search: "富国", subscriptionStatus: null, sortBy: "premiumRate", sortOrder: "desc" });
  assert.deepEqual(result.data.map((item) => item.code), ["161002"]);
  assert.deepEqual(result.pagination, { page: 1, pageSize: 1, total: 2, totalPages: 2 });
  assert.equal(result.meta.lastRefreshAt, "2026-06-21T02:05:00Z");
});

test("missing values sort last in both directions and remain JSON null", () => {
  const store = new PremiumStore();
  store.replace([
    toPremiumRecord(raw("161001", "正常", 1, 1.1)),
    toPremiumRecord(raw("161002", "缺失", null, 1)),
    toPremiumRecord(raw("161003", "零值", 0, 1)),
    toPremiumRecord(raw("161004", "异常高值", 0.01, 10))
  ]);
  for (const sortOrder of ["asc", "desc"] as const) {
    const result = store.query({ page: 1, pageSize: 10, search: "", subscriptionStatus: null, sortBy: "premiumRate", sortOrder });
    assert.deepEqual(result.data.slice(-2).map((item) => item.premiumRate), [null, null]);
    assert.match(JSON.stringify(result), /"premiumRate":null/);
  }
});

test("filters exact and broadly purchasable subscription statuses", () => {
  const store = new PremiumStore();
  const open = toPremiumRecord(raw("161001", "开放", 1));
  const limited = toPremiumRecord({ ...raw("161002", "限购", 1), subscriptionStatus: "limited", subscriptionLimit: 1000 });
  const suspended = toPremiumRecord({ ...raw("161003", "暂停", 1), subscriptionStatus: "suspended" });
  store.replace([open, limited, suspended]);
  const query = { page: 1, pageSize: 10, search: "", sortBy: "code" as const, sortOrder: "asc" as const };
  assert.deepEqual(store.query({ ...query, subscriptionStatus: "purchasable" }).data.map((item) => item.code), ["161001", "161002"]);
  assert.deepEqual(store.query({ ...query, subscriptionStatus: "limited" }).data.map((item) => item.code), ["161002"]);
});
