import { createApiServer } from "./api.js";
import { RefreshScheduler } from "./scheduler.js";
import { PremiumService } from "./service.js";
import { EastMoneySource, SinaPriceSource, TencentPriceSource } from "./sources/eastmoney.js";
import { PremiumStore } from "./store.js";

const port = Number(process.env.PORT ?? 3000);
const refreshIntervalMs = Number(process.env.REFRESH_INTERVAL_MS ?? 60_000);
const store = new PremiumStore();
const service = new PremiumService(store, [new EastMoneySource(), new SinaPriceSource(), new TencentPriceSource()]);
const scheduler = new RefreshScheduler(service, refreshIntervalMs);
const api = createApiServer(store);

await api.listen(port, "0.0.0.0");
scheduler.start();
console.info(`LOFeasy API listening on :${port}`);

function shutdown(): void {
  scheduler.stop();
  api.server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
