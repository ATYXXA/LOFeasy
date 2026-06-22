export type Exchange = "SH" | "SZ";
export type SubscriptionStatus = "open" | "suspended" | "limited" | "closed" | "unknown";

export interface DataObservation {
  source: string;
  value: number;
  asOf: string | null;
  selected: boolean;
}

export interface FieldValidation {
  sourceCount: number;
  comparableSourceCount: number;
  spreadPercent: number | null;
  consistent: boolean | null;
  observations: DataObservation[];
}

export interface CrossValidation {
  selectionPolicy: "latest";
  price: FieldValidation;
  nav: FieldValidation;
  warnings: string[];
}

export interface HistoricalPremiumPoint {
  date: string;
  closePrice: number | null;
  referenceNav: number | null;
  premiumRate: number | null;
  priceSource: string;
  navSource: string;
  isComplete: boolean;
}

export interface FeeTier {
  condition: string;
  rate: string;
  discountedRate: string | null;
}

export interface TradingRules {
  purchaseConfirmDays: number | null;
  redemptionConfirmDays: number | null;
  purchaseConfirmText: string | null;
  redemptionConfirmText: string | null;
  onExchangeSellableDays: number | null;
  onExchangeSellableText: string | null;
  onExchangeSellableBasis: "CONFIRMATION_PLUS_ONE_TRADING_DAY" | "UNKNOWN";
  subscriptionFees: FeeTier[];
  redemptionFees: FeeTier[];
  source: string;
  updatedAt: string;
}

export interface RawFundQuote {
  code: string;
  name: string;
  exchange: Exchange;
  price: number | null;
  priceTime: string | null;
  referenceNav: number | null;
  navDate: string | null;
  priceSource: string;
  navSource: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionStatusText: string | null;
  subscriptionLimit: number | null;
  subscriptionStatusTime: string | null;
  subscriptionSource: string;
  historicalPremiums?: HistoricalPremiumPoint[];
  tradingRules?: TradingRules;
  crossValidation?: CrossValidation;
  excludeFromRanking?: boolean;
  exclusionReason?: "FIXED_UNIT_PRICE_PLACEHOLDER";
}

export interface PremiumRecord extends Omit<RawFundQuote, "crossValidation"> {
  premiumRate: number | null;
  isStale: boolean;
  staleReasons: string[];
  updatedAt: string;
  crossValidation: CrossValidation;
}

export type SortField =
  | "code"
  | "name"
  | "price"
  | "referenceNav"
  | "premiumRate"
  | "subscriptionStatus"
  | "subscriptionLimit"
  | "priceTime"
  | "navDate";

export interface RankingQuery {
  page: number;
  pageSize: number;
  search: string;
  subscriptionStatus: SubscriptionStatus | "purchasable" | null;
  sortBy: SortField;
  sortOrder: "asc" | "desc";
}

export interface RankingResult {
  data: PremiumRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  meta: { generatedAt: string; lastRefreshAt: string | null };
}

export interface QuoteSource {
  readonly name: string;
  fetchQuotes(signal?: AbortSignal): Promise<RawFundQuote[]>;
}
