import { calculatePremiumRate } from "../premium.js";
import type { Exchange, FeeTier, HistoricalPremiumPoint, QuoteSource, RawFundQuote, SubscriptionStatus, TradingRules } from "../types.js";

interface EastMoneyRow {
  f2?: number | "-";
  f12?: string;
  f13?: number;
  f14?: string;
  f124?: number;
  fallbackOnly?: boolean;
}

interface NavPayload {
  fundcode?: string;
  name?: string;
  jzrq?: string;
  dwjz?: string;
}

interface NavHistoryRow { FSRQ?: string; DWJZ?: string }
interface FundHistoryBundle {
  latestNav: number | null;
  latestNavDate: string | null;
  premiums: HistoricalPremiumPoint[];
}

interface SubscriptionInfo {
  status: SubscriptionStatus;
  text: string;
  limit: number | null;
  fetchedAt: string;
  source: string;
}

export function parseSubscriptionStatus(text: string | null | undefined): SubscriptionStatus {
  if (!text) return "unknown";
  if (/暂停|停止/.test(text)) return "suspended";
  if (/限|限制/.test(text)) return "limited";
  if (/开放/.test(text)) return "open";
  if (/封闭|关闭/.test(text)) return "closed";
  return "unknown";
}

export function parseSubscriptionLimit(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, "").match(
    /(?:限购|限制(?:大额)?申购|(?:申购|购买)(?:金额)?上限|不得超过)[^\d]{0,30}(\d+(?:\.\d+)?)\s*(万|亿)?\s*元/
  );
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1;
  return Number.isFinite(value) ? value * multiplier : null;
}

export function parseSubscriptionRows(body: string, fetchedAt: string): Map<string, SubscriptionInfo> {
  const rows = parseFundListDataRows(body);
  return new Map(rows.flatMap((row): Array<[string, SubscriptionInfo]> => {
    const code = typeof row[0] === "string" ? row[0] : null;
    // Some variants split status and limit text, but later columns contain unrelated fee numbers.
    const relevant = row.slice(9).filter((value): value is string =>
      typeof value === "string" && /申购|限购|限制大额|限大额/.test(value)
    );
    const text = relevant.join(" ");
    return code ? [[code, {
      status: parseSubscriptionStatus(text), text, limit: parseSubscriptionLimit(text), fetchedAt,
      source: "天天基金批量申购状态"
    }]] : [];
  }));
}

export function parseTiantianPurchaseLimitHtml(html: string): number | null {
  const transaction = html.match(/交易状态[：:][\s\S]{0,500}/)?.[0] ?? "";
  return parseSubscriptionLimit(decodeHtml(transaction));
}

const tiantianLimitCache = new Map<string, { expiresAt: number; value: number }>();

async function fetchTiantianPurchaseLimit(code: string, signal?: AbortSignal): Promise<number | null> {
  const cached = tiantianLimitCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000);
  const response = await fetch(`https://fund.eastmoney.com/${code}.html`, {
    signal: requestSignal,
    headers: { referer: "https://fund.eastmoney.com/", "user-agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from 天天基金基金页`);
  const value = parseTiantianPurchaseLimitHtml(await response.text());
  if (value !== null) tiantianLimitCache.set(code, { expiresAt: Date.now() + 6 * 60 * 60_000, value });
  return value;
}

function parseFundListDataRows(body: string): unknown[][] {
  const dataStart = body.indexOf("datas:");
  const arrayStart = dataStart < 0 ? -1 : body.indexOf("[", dataStart + 6);
  const markers = [
    body.indexOf(",count:", arrayStart),
    body.indexOf(",allRecords:", arrayStart),
    body.indexOf(",record:", arrayStart)
  ].filter((index) => index >= 0);
  const arrayEnd = markers.length ? Math.min(...markers) : -1;
  if (arrayStart < 0 || arrayEnd < 0) throw new Error("东方财富申购状态响应格式已变化");
  return JSON.parse(body.slice(arrayStart, arrayEnd)) as unknown[][];
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || value === "-") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function feeTableBody(html: string, title: string): string | null {
  const heading = html.indexOf(`>${title}<`);
  if (heading < 0) return null;
  const table = html.indexOf("<table", heading);
  const bodyStart = html.indexOf("<tbody", table);
  const contentStart = html.indexOf(">", bodyStart) + 1;
  const bodyEnd = html.indexOf("</tbody>", contentStart);
  return table >= 0 && bodyStart >= 0 && contentStart > 0 && bodyEnd >= 0 ? html.slice(contentStart, bodyEnd) : null;
}

export function parseFeeTiers(html: string, title: "申购费率" | "赎回费率"): FeeTier[] {
  const body = feeTableBody(html, title);
  if (!body) return [];
  const rows: FeeTier[] = [];
  const rowPattern = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  for (const match of body.matchAll(rowPattern)) {
    if (!match[1] || !match[2]) continue;
    const condition = decodeHtml(match[1]);
    const rateText = decodeHtml(match[2]);
    const strike = match[2].match(/<strike[^>]*>([\s\S]*?)<\/strike>/i);
    const parts = rateText.split("|").map((part) => part.trim()).filter(Boolean);
    rows.push({
      condition,
      rate: strike?.[1] ? decodeHtml(strike[1]) : (parts[0] ?? rateText),
      discountedRate: strike?.[1] ? (parts.at(-1) ?? null) : null
    });
  }
  return rows;
}

export function parseTradingRules(html: string, updatedAt = new Date().toISOString()): TradingRules {
  const purchaseText = html.match(/买入确认日<\/td>\s*<td[^>]*>\s*(T\+\d+)/i)?.[1] ?? null;
  const redemptionText = html.match(/卖出确认日<\/td>\s*<td[^>]*>\s*(T\+\d+)/i)?.[1] ?? null;
  const days = (text: string | null) => text ? Number(text.slice(2)) : null;
  const purchaseDays = days(purchaseText);
  const sellableDays = purchaseDays === null ? null : purchaseDays + 1;
  return {
    purchaseConfirmDays: purchaseDays,
    redemptionConfirmDays: days(redemptionText),
    purchaseConfirmText: purchaseText,
    redemptionConfirmText: redemptionText,
    onExchangeSellableDays: sellableDays,
    onExchangeSellableText: sellableDays === null ? null : `T+${sellableDays}`,
    onExchangeSellableBasis: sellableDays === null ? "UNKNOWN" : "CONFIRMATION_PLUS_ONE_TRADING_DAY",
    subscriptionFees: parseFeeTiers(html, "申购费率"),
    redemptionFees: parseFeeTiers(html, "赎回费率"),
    source: "东方财富基金费率",
    updatedAt
  };
}

function shanghaiNow(): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

function completedTradingDates(klines: string[]): Array<{ date: string; close: number | null }> {
  const now = shanghaiNow();
  return klines.map((line) => {
    const values = line.split(",");
    return { date: values[0] ?? "", close: finiteNumber(values[2]) };
  }).filter((item) => item.date && (item.date !== now.date || now.minutes >= 15 * 60)).slice(-5).reverse();
}

const historyCache = new Map<string, { expiresAt: number; value: FundHistoryBundle }>();
const rulesCache = new Map<string, { expiresAt: number; value: TradingRules }>();

async function fetchHistoricalKlines(code: string, exchange: Exchange, signal?: AbortSignal): Promise<{ klines: string[]; source: string }> {
  const symbol = `${exchange.toLowerCase()}${code}`;
  const historySignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000);
  const params = new URLSearchParams({ symbol, scale: "240", ma: "no", datalen: "10" });
  const response = await fetch(`https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?${params}`, {
    signal: historySignal,
    headers: { referer: "https://finance.sina.com.cn/", "user-agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from 新浪财经历史行情`);
  const values = await response.json() as Array<{ day?: string; open?: string; close?: string }>;
  if (!values.length) throw new Error("新浪财经未返回历史行情");
  return {
    klines: values.map((row) => `${row.day ?? ""},${row.open ?? ""},${row.close ?? ""}`),
    source: "新浪财经历史行情"
  };
}

export async function fetchFundHistory(code: string, exchange: Exchange, signal?: AbortSignal): Promise<FundHistoryBundle> {
  const cached = historyCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const navParams = new URLSearchParams({ type: "lsjz", code, page: "1", per: "10", sdate: "", edate: "" });
  const fetchNavHistory = async () => {
    let lastError: unknown = new Error("东方财富历史净值请求失败");
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000);
        const response = await fetch(`https://fund.eastmoney.com/f10/F10DataApi.aspx?${navParams}`, {
          signal: requestSignal,
          headers: { referer: "https://fund.eastmoney.com/", "user-agent": "Mozilla/5.0" }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} from 东方财富历史净值`);
        const body = await response.text();
        const rows: NavHistoryRow[] = [...body.matchAll(/<tr><td>(\d{4}-\d{2}-\d{2})<\/td><td[^>]*>([\d.]+)<\/td>/g)]
          .flatMap((match): NavHistoryRow[] => match[1] && match[2] ? [{ FSRQ: match[1], DWJZ: match[2] }] : []);
        if (rows.length === 0) throw new Error("东方财富历史净值响应格式已变化");
        return { Data: { LSJZList: rows } };
      } catch (error) {
        lastError = error;
        if (signal?.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    throw lastError;
  };
  const [klineResult, navPayload] = await Promise.all([
    fetchHistoricalKlines(code, exchange, signal),
    fetchNavHistory()
  ]);
  const navRows = navPayload.Data?.LSJZList ?? [];
  const navByDate = new Map(navRows.flatMap((row): Array<[string, number]> => {
    const value = finiteNumber(row.DWJZ);
    return row.FSRQ && value !== null && value > 0 ? [[row.FSRQ, value]] : [];
  }));
  const latest = navRows.find((row) => row.FSRQ && finiteNumber(row.DWJZ) !== null);
  const premiums = completedTradingDates(klineResult.klines).map(({ date, close }): HistoricalPremiumPoint => {
    const nav = navByDate.get(date) ?? null;
    return {
      date, closePrice: close, referenceNav: nav,
      premiumRate: calculatePremiumRate(close, nav),
      priceSource: klineResult.source,
      navSource: "东方财富历史净值",
      isComplete: close !== null && nav !== null
    };
  });
  const value = {
    latestNav: finiteNumber(latest?.DWJZ),
    latestNavDate: latest?.FSRQ ?? null,
    premiums
  };
  historyCache.set(code, { expiresAt: Date.now() + 10 * 60_000, value });
  return value;
}

async function fetchFundRules(code: string, signal?: AbortSignal): Promise<TradingRules> {
  const cached = rulesCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(3_000)]) : AbortSignal.timeout(3_000);
  const response = await fetch(`https://fundf10.eastmoney.com/jjfl_${code}.html`, {
    signal: requestSignal, headers: { referer: "https://fund.eastmoney.com/", "user-agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from 东方财富基金费率`);
  const value = parseTradingRules(await response.text());
  rulesCache.set(code, { expiresAt: Date.now() + 24 * 60 * 60_000, value });
  return value;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item !== undefined) results[index] = await mapper(item, index);
    }
  }));
  return results;
}

let detailsHydration: Promise<void> | null = null;

function startDetailsHydration(rows: EastMoneyRow[]): void {
  if (detailsHydration) return;
  const eligible = rows.filter((row) => {
    if (!row.fallbackOnly) return true;
    if (!row.f12 || !row.f14 || (row.f13 !== 0 && row.f13 !== 1)) return false;
    const exchange: Exchange = row.f13 === 1 ? "SH" : "SZ";
    return verifiedListedFunds.has(`${exchange}:${row.f12}`) || /QDII|LOF|海外|全球|港美/i.test(row.f14);
  });
  const prioritized = [...eligible].sort((a, b) => {
    const score = (row: EastMoneyRow) => /QDII|海外|全球|港美/i.test(row.f14 ?? "") ? 1 : 0;
    return score(b) - score(a);
  });
  const isQdii = (row: EastMoneyRow) => /QDII|海外|全球|港美/i.test(row.f14 ?? "");
  const qdiiRows = prioritized.filter(isQdii);
  const otherRows = prioritized.filter((row) => !isQdii(row));
  const hydrate = async (row: EastMoneyRow) => {
    if (!row.f12 || (row.f13 !== 0 && row.f13 !== 1)) return;
    const exchange: Exchange = row.f13 === 1 ? "SH" : "SZ";
    const [historyResult] = await Promise.allSettled([
      fetchFundHistory(row.f12, exchange),
      fetchFundRules(row.f12)
    ]);
    if (historyResult.status === "rejected") await fetchNav(row.f12).catch(() => null);
  };
  detailsHydration = (async () => {
    await mapWithConcurrency(qdiiRows, 2, hydrate);
    await mapWithConcurrency(otherRows, 10, hydrate);
  })().finally(() => { detailsHydration = null; });
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal: signal ?? null, headers: { "user-agent": "LOFeasy/0.1", referer: "https://fund.eastmoney.com/" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.json();
}

let lofRowsCache: { expiresAt: number; rows: EastMoneyRow[] } | null = null;
let lofRowsPending: Promise<EastMoneyRow[]> | null = null;
export const LOF_BOARD_CODES = ["MK0404", "MK0405", "MK0406", "MK0407", "MK0408"] as const;
let fallbackUniverseCache: { expiresAt: number; rows: EastMoneyRow[] } | null = null;
const verifiedListedFunds = new Set<string>();

async function fetchFallbackLofUniverse(signal?: AbortSignal): Promise<EastMoneyRow[]> {
  if (fallbackUniverseCache && fallbackUniverseCache.expiresAt > Date.now()) return fallbackUniverseCache.rows;
  const params = new URLSearchParams({
    t: "1", lx: "9", letter: "", gsid: "", text: "", sort: "zdf,desc",
    page: "1,50000", dt: String(Date.now()), atfc: "", onlySale: "0"
  });
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  const response = await fetch(`https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?${params}`, {
    signal: requestSignal, headers: { referer: "https://fund.eastmoney.com/", "user-agent": "LOFeasy/0.1" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from 东方财富基金名录`);
  const rows = parseFundListDataRows(await response.text()).flatMap((row): EastMoneyRow[] => {
    const code = typeof row[0] === "string" ? row[0] : "";
    const name = typeof row[1] === "string" ? row[1] : "";
    const isListedLofCode = /^16\d{4}$/.test(code) || /^50[126]\d{3}$/.test(code);
    if (!code || !name || !isListedLofCode) return [];
    return [{ f12: code, f14: name, f13: code.startsWith("5") ? 1 : 0, f2: "-", fallbackOnly: true }];
  });
  fallbackUniverseCache = { expiresAt: Date.now() + 30 * 60_000, rows };
  return rows;
}

async function fetchLofBoard(board: string, signal?: AbortSignal): Promise<EastMoneyRow[]> {
  const pageSize = 100;
  const fetchPage = async (page: number) => {
    const params = new URLSearchParams({
      pn: String(page), pz: String(pageSize), po: "1", np: "1", fltt: "2", invt: "2",
      fid: "f12", fs: `b:${board}`, fields: "f2,f12,f13,f14,f124"
    });
    let lastError: unknown = new Error(`${board} page ${page} failed`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(3_000)]) : AbortSignal.timeout(3_000);
        return await fetchJson(`https://push2.eastmoney.com/api/qt/clist/get?${params}`, requestSignal) as {
          data?: { total?: number; diff?: EastMoneyRow[] };
        };
      } catch (error) {
        lastError = error;
        if (signal?.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    throw lastError;
  };
  const first = await fetchPage(1);
  const total = first.data?.total ?? 0;
  const pageCount = Math.ceil(total / pageSize);
  const rest = pageCount > 1
    ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => fetchPage(index + 2)))
    : [];
  return [first, ...rest].flatMap((payload) => payload.data?.diff ?? []);
}

async function fetchListedLofRows(signal?: AbortSignal): Promise<EastMoneyRow[]> {
  if (lofRowsCache && lofRowsCache.expiresAt > Date.now()) return lofRowsCache.rows;
  if (lofRowsPending) return lofRowsPending;
  lofRowsPending = (async () => {
    const settled = await Promise.allSettled(LOF_BOARD_CODES.map((board) => fetchLofBoard(board, signal)));
    const boardRows = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const fallbackRows = settled.some((result) => result.status === "rejected")
      ? await fetchFallbackLofUniverse(signal).catch(() => [])
      : [];
    if (boardRows.length === 0 && fallbackRows.length === 0) throw new Error("all LOF universe sources failed");
    const rows = [...new Map([...boardRows.flat(), ...fallbackRows].flatMap((row): Array<[string, EastMoneyRow]> =>
      row.f12 && (row.f13 === 0 || row.f13 === 1) ? [[`${row.f13}:${row.f12}`, row]] : []
    )).values()];
    lofRowsCache = { expiresAt: Date.now() + 60_000, rows };
    return rows;
  })();
  try {
    return await lofRowsPending;
  } finally {
    lofRowsPending = null;
  }
}

async function resolveFunds(funds: FundIdentity[] | undefined, signal?: AbortSignal): Promise<FundIdentity[]> {
  if (funds) return funds;
  return (await fetchListedLofRows(signal)).flatMap((row): FundIdentity[] =>
    row.f12 && row.f14 && (row.f13 === 0 || row.f13 === 1)
      ? [{ code: row.f12, name: row.f14, exchange: row.f13 === 1 ? "SH" : "SZ" }]
      : []
  );
}

function emptySecondaryFields() {
  return {
    referenceNav: null,
    navDate: null,
    navSource: "该来源未提供可验证净值日期",
    subscriptionStatus: "unknown" as const,
    subscriptionStatusText: null,
    subscriptionLimit: null,
    subscriptionStatusTime: null,
    subscriptionSource: "该来源未提供申购状态"
  };
}

const navCache = new Map<string, { expiresAt: number; value: NavPayload | null }>();

async function fetchNav(code: string, signal?: AbortSignal): Promise<NavPayload | null> {
  const cached = navCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetch(`https://fundgz.1234567.com.cn/js/${code}.js`, {
    signal: signal ?? null,
    headers: { referer: "https://fund.eastmoney.com/" }
  });
  if (!response.ok) return null;
  const body = await response.text();
  const match = body.match(/jsonpgz\((.*)\)\s*;?$/s);
  if (!match?.[1]) return null;
  try {
    const value = JSON.parse(match[1]) as NavPayload;
    navCache.set(code, { expiresAt: Date.now() + 30 * 60_000, value });
    return value;
  } catch {
    navCache.set(code, { expiresAt: Date.now() + 5 * 60_000, value: null });
    return null;
  }
}

/** Eastmoney quote centre + fund NAV service. MK0404 is its listed LOF board. */
export class EastMoneySource implements QuoteSource {
  readonly name = "东方财富";
  #subscriptionCache: { expiresAt: number; values: Map<string, SubscriptionInfo> } | null = null;

  async #fetchSubscriptionStatuses(signal?: AbortSignal): Promise<Map<string, SubscriptionInfo>> {
    if (this.#subscriptionCache && this.#subscriptionCache.expiresAt > Date.now()) return this.#subscriptionCache.values;
    const params = new URLSearchParams({
      t: "1", lx: "9", letter: "", gsid: "", text: "", sort: "zdf,desc",
      page: "1,50000", dt: String(Date.now()), atfc: "", onlySale: "0"
    });
    const response = await fetch(`https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?${params}`, {
      signal: signal ?? null,
      headers: { referer: "https://fund.eastmoney.com/", "user-agent": "LOFeasy/0.1" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from 东方财富申购状态`);
    const values = parseSubscriptionRows(await response.text(), new Date().toISOString());
    const missingLimits = [...values.entries()].filter(([, item]) => item.status === "limited" && item.limit === null);
    await mapWithConcurrency(missingLimits, 6, async ([code, item]) => {
      const limit = await fetchTiantianPurchaseLimit(code, signal).catch(() => null);
      if (limit !== null) values.set(code, { ...item, limit, source: "天天基金基金页交易状态" });
    });
    const stillMissing = [...values.values()].some((item) => item.status === "limited" && item.limit === null);
    this.#subscriptionCache = { expiresAt: Date.now() + (stillMissing ? 60_000 : 30 * 60_000), values };
    return values;
  }

  async fetchQuotes(signal?: AbortSignal): Promise<RawFundQuote[]> {
    const rows = await fetchListedLofRows(signal);
    const subscriptionResult = await this.#fetchSubscriptionStatuses(signal).catch(() => new Map<string, SubscriptionInfo>());
    startDetailsHydration(rows);

    return rows.flatMap((row, index): RawFundQuote[] => {
      if (!row.f12 || !row.f14 || (row.f13 !== 0 && row.f13 !== 1)) return [];
      const exchange: Exchange = row.f13 === 1 ? "SH" : "SZ";
      if (row.fallbackOnly && !verifiedListedFunds.has(`${exchange}:${row.f12}`)) return [];
      const history = historyCache.get(row.f12)?.value;
      const navFallback = navCache.get(row.f12)?.value;
      const rules = rulesCache.get(row.f12)?.value;
      const subscription = subscriptionResult.get(row.f12);
      return [{
        code: row.f12,
        name: row.f14,
        exchange,
        price: finiteNumber(row.f2),
        priceTime: row.f124 ? new Date(row.f124 * 1000).toISOString() : null,
        referenceNav: history?.latestNav ?? finiteNumber(navFallback?.dwjz),
        navDate: history?.latestNavDate ?? navFallback?.jzrq ?? null,
        priceSource: "东方财富行情中心",
        navSource: "东方财富基金净值",
        subscriptionStatus: subscription?.status ?? "unknown",
        subscriptionStatusText: subscription?.text || null,
        subscriptionLimit: subscription?.limit ?? null,
        subscriptionStatusTime: subscription?.fetchedAt ?? null,
        subscriptionSource: subscription?.source ?? "申购状态暂不可用",
        historicalPremiums: history?.premiums ?? [],
        ...(rules ? { tradingRules: rules } : {})
      }];
    });
  }
}

export interface FundIdentity { code: string; name: string; exchange: Exchange }

/** Tencent returns this shape for obsolete/non-tradable fund symbols. */
export function isFixedUnitPricePlaceholder(values: string[]): boolean {
  return finiteNumber(values[3]) === 1
    && finiteNumber(values[4]) === 1
    && finiteNumber(values[5]) === 0
    && finiteNumber(values[6]) === 0
    && finiteNumber(values[7]) === 0
    && finiteNumber(values[8]) === 0;
}

/** Optional Sina market-price fallback for a configured fund universe. */
export class SinaPriceSource implements QuoteSource {
  readonly name = "新浪财经";
  constructor(private readonly funds?: FundIdentity[]) {}

  async fetchQuotes(signal?: AbortSignal): Promise<RawFundQuote[]> {
    const funds = await resolveFunds(this.funds, signal);
    const bySymbol = new Map(funds.map((fund) => [`${fund.exchange.toLowerCase()}${fund.code}`, fund]));
    const chunks = Array.from({ length: Math.ceil(funds.length / 80) }, (_, index) => funds.slice(index * 80, index * 80 + 80));
    const texts = await Promise.all(chunks.map(async (chunk) => {
      const symbols = chunk.map((fund) => `${fund.exchange.toLowerCase()}${fund.code}`).join(",");
      const response = await fetch(`https://hq.sinajs.cn/list=${symbols}`, {
        signal: signal ?? null,
        headers: { referer: "https://finance.sina.com.cn/", "user-agent": "Mozilla/5.0" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from 新浪财经`);
      return new TextDecoder("gbk").decode(await response.arrayBuffer());
    }));
    return texts.flatMap((text): RawFundQuote[] => text.split("\n").flatMap((line): RawFundQuote[] => {
      const match = line.match(/^var hq_str_(\w+)="(.*)";?$/);
      const fund = match?.[1] ? bySymbol.get(match[1]) : undefined;
      if (!fund || !match?.[2]) return [];
      const values = match[2].split(",");
      const date = values[30];
      const time = values[31];
      const price = finiteNumber(values[3]);
      if (price === null || price <= 0) return [];
      verifiedListedFunds.add(`${fund.exchange}:${fund.code}`);
      return [{
        ...fund,
        price,
        priceTime: date && time ? new Date(`${date}T${time}+08:00`).toISOString() : null,
        priceSource: "新浪财经实时行情",
        ...emptySecondaryFields()
      }];
    }));
  }
}

/** Tencent quote service, used as a third independent market-price observation. */
export class TencentPriceSource implements QuoteSource {
  readonly name = "腾讯证券";
  constructor(private readonly funds?: FundIdentity[]) {}

  async fetchQuotes(signal?: AbortSignal): Promise<RawFundQuote[]> {
    const funds = await resolveFunds(this.funds, signal);
    const bySymbol = new Map(funds.map((fund) => [`${fund.exchange.toLowerCase()}${fund.code}`, fund]));
    const chunks = Array.from({ length: Math.ceil(funds.length / 80) }, (_, index) => funds.slice(index * 80, index * 80 + 80));
    const texts = await Promise.all(chunks.map(async (chunk) => {
      const symbols = chunk.map((fund) => `${fund.exchange.toLowerCase()}${fund.code}`).join(",");
      const response = await fetch(`https://qt.gtimg.cn/q=${symbols}`, {
        signal: signal ?? null,
        headers: { referer: "https://gu.qq.com/", "user-agent": "Mozilla/5.0" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from 腾讯证券`);
      return new TextDecoder("gbk").decode(await response.arrayBuffer());
    }));
    return texts.flatMap((text): RawFundQuote[] => text.split(";").flatMap((line): RawFundQuote[] => {
      const match = line.trim().match(/^v_(\w+)="(.*)"$/);
      const fund = match?.[1] ? bySymbol.get(match[1]) : undefined;
      if (!fund || !match?.[2]) return [];
      const values = match[2].split("~");
      const price = finiteNumber(values[3]);
      if (price === null || price <= 0) return [];
      const stamp = values[30];
      const priceTime = stamp && /^\d{14}$/.test(stamp)
        ? new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}+08:00`).toISOString()
        : null;
      if (isFixedUnitPricePlaceholder(values)) {
        return [{
          ...fund,
          price: null,
          priceTime,
          priceSource: "腾讯证券占位行情",
          ...emptySecondaryFields(),
          excludeFromRanking: true,
          exclusionReason: "FIXED_UNIT_PRICE_PLACEHOLDER"
        }];
      }
      verifiedListedFunds.add(`${fund.exchange}:${fund.code}`);
      return [{
        ...fund,
        price,
        priceTime,
        priceSource: "腾讯证券实时行情",
        ...emptySecondaryFields()
      }];
    }));
  }
}
