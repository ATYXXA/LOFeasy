import { PremiumService } from "./service.js";

export class RefreshScheduler {
  #timer: NodeJS.Timeout | null = null;
  #running = false;

  constructor(private readonly service: PremiumService, private readonly intervalMs: number) {
    if (!Number.isFinite(intervalMs) || intervalMs < 1_000) throw new Error("refresh interval must be at least 1000ms");
  }

  async runOnce(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      const report = await this.service.refresh();
      console.info("premium refresh completed", report);
    } catch (error) {
      console.error("premium refresh failed", error);
    } finally {
      this.#running = false;
    }
  }

  start(): void {
    if (this.#timer) return;
    void this.runOnce();
    this.#timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
