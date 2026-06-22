import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PremiumService } from "./service.js";
import { EastMoneySource, SinaPriceSource, TencentPriceSource } from "./sources/eastmoney.js";
import { PremiumStore } from "./store.js";

const outputDirectory = resolve(process.env.STATIC_SITE_DIR ?? "_site");
const hydrationWaitMs = Number(process.env.STATIC_HYDRATION_WAIT_MS ?? 70_000);
if (!Number.isFinite(hydrationWaitMs) || hydrationWaitMs < 0) throw new Error("STATIC_HYDRATION_WAIT_MS must be non-negative");

await rm(outputDirectory, { recursive: true, force: true });
await cp(resolve("public"), outputDirectory, { recursive: true });
await mkdir(resolve(outputDirectory, "data"), { recursive: true });

const store = new PremiumStore();
const service = new PremiumService(store, [new EastMoneySource(), new SinaPriceSource(), new TencentPriceSource()]);
const first = await service.refresh();
if (hydrationWaitMs > 0) await new Promise((resolveWait) => setTimeout(resolveWait, hydrationWaitMs));
const second = await service.refresh();
if (first.recordCount === 0 && second.recordCount === 0) throw new Error("all data sources failed; refusing to deploy an empty snapshot");

const snapshot = store.query({
  page: 1,
  pageSize: Number.MAX_SAFE_INTEGER,
  search: "",
  subscriptionStatus: null,
  sortBy: "premiumRate",
  sortOrder: "desc"
});
await writeFile(resolve(outputDirectory, "data", "premiums.json"), JSON.stringify({
  data: snapshot.data,
  meta: { ...snapshot.meta, exportedAt: new Date().toISOString() }
}), "utf8");
await writeFile(resolve(outputDirectory, ".nojekyll"), "", "utf8");
console.info(`exported ${snapshot.data.length} funds to ${outputDirectory}`);
