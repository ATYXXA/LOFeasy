import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../src/api.js";
import { toPremiumRecord } from "../src/premium.js";
import { PremiumStore } from "../src/store.js";

test("ranking endpoint returns data and rejects invalid query input", async (context) => {
  const store = new PremiumStore();
  store.replace([toPremiumRecord({
    code: "161725", name: "白酒LOF", exchange: "SZ", price: 1.2,
    priceTime: "2026-06-21T02:00:00Z", referenceNav: 1, navDate: "2026-06-20",
    priceSource: "东方财富行情中心", navSource: "东方财富基金净值",
    subscriptionStatus: "open", subscriptionStatusText: "开放申购", subscriptionLimit: null,
    subscriptionStatusTime: "2026-06-21T02:00:00Z", subscriptionSource: "东方财富基金申购状态"
  })]);
  const api = createApiServer(store);
  const address = await api.listen(0);
  context.after(() => new Promise<void>((resolve) => api.server.close(() => resolve())));
  const origin = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${origin}/api/v1/premiums?search=白酒&page=1&pageSize=10&sortBy=code&sortOrder=asc`);
  assert.equal(response.status, 200);
  const body = await response.json() as { data: Array<{ code: string; priceTime: string; navDate: string }> };
  assert.equal(body.data[0]?.code, "161725");
  assert.ok(body.data[0]?.priceTime);
  assert.ok(body.data[0]?.navDate);

  assert.equal((await fetch(`${origin}/api/v1/premiums?page=0`)).status, 400);
  assert.equal((await fetch(`${origin}/api/v1/premiums?pageSize=101`)).status, 400);
  assert.equal((await fetch(`${origin}/api/v1/premiums?sortBy=oops`)).status, 400);
  assert.equal((await fetch(`${origin}/api/v1/premiums?subscriptionStatus=oops`)).status, 400);
});
