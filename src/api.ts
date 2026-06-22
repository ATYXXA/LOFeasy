import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { PremiumStore } from "./store.js";
import type { RankingQuery, SortField, SubscriptionStatus } from "./types.js";

const SORT_FIELDS = new Set<SortField>([
  "code", "name", "price", "referenceNav", "premiumRate", "subscriptionStatus", "subscriptionLimit", "priceTime", "navDate"
]);
const SUBSCRIPTION_FILTERS = new Set<SubscriptionStatus | "purchasable">([
  "open", "limited", "suspended", "closed", "unknown", "purchasable"
]);

export class QueryError extends Error {}

function positiveInteger(value: string | null, fallback: number, name: string, max?: number): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
    throw new QueryError(`${name} must be an integer between 1 and ${max ?? "infinity"}`);
  }
  return parsed;
}

export function parseRankingQuery(params: URLSearchParams): RankingQuery {
  const sortBy = params.get("sortBy") ?? "premiumRate";
  const sortOrder = params.get("sortOrder") ?? "desc";
  if (!SORT_FIELDS.has(sortBy as SortField)) throw new QueryError(`unsupported sortBy: ${sortBy}`);
  if (sortOrder !== "asc" && sortOrder !== "desc") throw new QueryError("sortOrder must be asc or desc");
  const subscriptionStatus = params.get("subscriptionStatus");
  if (subscriptionStatus && !SUBSCRIPTION_FILTERS.has(subscriptionStatus as SubscriptionStatus | "purchasable")) {
    throw new QueryError(`unsupported subscriptionStatus: ${subscriptionStatus}`);
  }
  return {
    page: positiveInteger(params.get("page"), 1, "page"),
    pageSize: positiveInteger(params.get("pageSize"), 20, "pageSize", 100),
    search: params.get("search") ?? "",
    subscriptionStatus: subscriptionStatus as SubscriptionStatus | "purchasable" | null,
    sortBy: sortBy as SortField,
    sortOrder
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const PUBLIC_DIR = join(process.cwd(), "public");
const STATIC_ROUTES = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/styles.css", "styles.css"]
]);

async function serveStatic(pathname: string, response: ServerResponse): Promise<boolean> {
  const filename = STATIC_ROUTES.get(pathname);
  if (!filename) return false;
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[extname(filename)] ?? "application/octet-stream";
  try {
    const body = await readFile(join(PUBLIC_DIR, filename));
    response.writeHead(200, { "content-type": `${mime}; charset=utf-8`, "cache-control": "no-cache" });
    response.end(body);
  } catch {
    json(response, 404, { error: "asset_not_found" });
  }
  return true;
}

export function createApiServer(store: PremiumStore) {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      if (request.method === "GET" && url.pathname === "/api/v1/premiums") {
        json(response, 200, store.query(parseRankingQuery(url.searchParams)));
      } else if (request.method === "GET" && url.pathname === "/health") {
        json(response, 200, { status: "ok" });
      } else if (request.method === "GET" && await serveStatic(url.pathname, response)) {
        return;
      } else {
        json(response, 404, { error: "not_found" });
      }
    } catch (error) {
      if (error instanceof QueryError) json(response, 400, { error: "invalid_query", message: error.message });
      else json(response, 500, { error: "internal_error" });
    }
  });
  return {
    server,
    listen(port: number, host = "127.0.0.1"): Promise<AddressInfo> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => resolve(server.address() as AddressInfo));
      });
    }
  };
}
