import type { PremiumRecord, RankingQuery, RankingResult, SortField } from "./types.js";

function compareNullable(a: unknown, b: unknown, direction: 1 | -1): number {
  // Missing values always sort last; they are never coerced to zero.
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
  return String(a).localeCompare(String(b), "zh-CN", { numeric: true }) * direction;
}

export class PremiumStore {
  readonly #records = new Map<string, PremiumRecord>();
  #lastRefreshAt: string | null = null;

  replace(records: PremiumRecord[], refreshedAt = new Date().toISOString()): void {
    this.#records.clear();
    for (const record of records) this.#records.set(`${record.exchange}:${record.code}`, record);
    this.#lastRefreshAt = refreshedAt;
  }

  query(query: RankingQuery): RankingResult {
    const needle = query.search.trim().toLocaleLowerCase("zh-CN");
    const direction = query.sortOrder === "asc" ? 1 : -1;
    const sortBy: SortField = query.sortBy;
    const filtered = [...this.#records.values()].filter((item) => {
      const matchesSearch = !needle || item.code.toLocaleLowerCase().includes(needle) || item.name.toLocaleLowerCase().includes(needle);
      const matchesSubscription = !query.subscriptionStatus
        || (query.subscriptionStatus === "purchasable"
          ? item.subscriptionStatus === "open" || item.subscriptionStatus === "limited"
          : item.subscriptionStatus === query.subscriptionStatus);
      return matchesSearch && matchesSubscription;
    });
    filtered.sort((a, b) => compareNullable(a[sortBy], b[sortBy], direction) || a.code.localeCompare(b.code));
    const total = filtered.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      data: filtered.slice(start, start + query.pageSize),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize)
      },
      meta: { generatedAt: new Date().toISOString(), lastRefreshAt: this.#lastRefreshAt }
    };
  }
}
