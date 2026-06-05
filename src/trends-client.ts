/**
 * Google Trends client built directly against the unofficial endpoints
 * that trends.google.com uses internally. No API key required.
 *
 * IMPORTANT: These are unofficial, undocumented endpoints. Google may
 * change or block them at any time without notice.
 *
 * The response body always starts with the anti-JSON hijacking prefix
 * ")]}'" which must be stripped before parsing.
 */

const BASE = "https://trends.google.com/trends/api";

/**
 * Strip the anti-JSON-hijacking prefix Google prepends to every JSON
 * response. The explore endpoint uses ")]}'" and the widgetdata endpoints
 * use ")]}'," (with a trailing comma), so both forms are handled.
 */
function stripPrefix(raw: string): string {
  return raw.replace(/^\)\]\}',?\n?/, "");
}

export interface TrendsRequestOptions {
  /** BCP-47 locale, e.g. "en-US". Defaults to "en-US". */
  hl?: string;
  /** Two-letter country code for the Trends region, e.g. "US". Defaults to "US". */
  tz?: number;
}

/**
 * Shared headers sent with every request.
 * A realistic User-Agent reduces the chance of immediate blocking.
 */
function baseHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://trends.google.com/",
  };
  if (sessionCookie) {
    headers["Cookie"] = sessionCookie;
  }
  return headers;
}

/**
 * Session cookie (NID) for the Trends API.
 *
 * Google returns HTTP 429 for cookie-less requests to the API endpoints,
 * but that 429 response carries a Set-Cookie header. Capturing that cookie
 * and retrying once makes the request succeed. The cookie is cached for the
 * lifetime of the process.
 */
let sessionCookie: string | null = null;

/** Extract the first cookie pair from a Set-Cookie header value. */
function firstCookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? setCookie;
}

/**
 * Fetch a Trends API URL, transparently bootstrapping the session cookie.
 * On a 429 that provides a Set-Cookie header, the cookie is stored and the
 * request retried once. A 429 without a cookie (or after retry) is a real
 * rate limit.
 */
async function fetchTrends(url: string, label: string): Promise<string> {
  let res = await fetch(url, { headers: baseHeaders() });

  if (res.status === 429) {
    const setCookie =
      typeof res.headers?.get === "function"
        ? res.headers.get("set-cookie")
        : null;
    if (setCookie) {
      sessionCookie = firstCookiePair(setCookie);
      res = await fetch(url, { headers: baseHeaders() });
    }
  }

  if (res.status === 429) {
    throw new Error(
      "Google Trends rate-limited this request (HTTP 429). " +
        "Wait a few minutes and try again. This is a known limitation of the unofficial endpoint."
    );
  }
  if (res.status === 400) {
    throw new Error(
      `Google Trends rejected the ${label} request (HTTP 400). ` +
        "This usually means an invalid geo or timeframe. Use a two-letter ISO " +
        'country code (e.g. "US") or an empty string for worldwide, and a ' +
        'timeframe like "today 12-m", "now 7-d", or "2024-01-01 2024-12-31".'
    );
  }
  if (!res.ok) {
    throw new Error(
      `Google Trends ${label} request failed with status ${res.status}. ` +
        "The unofficial endpoint may be temporarily unavailable."
    );
  }

  return res.text();
}

/** Build a comparisonItem object for the explore endpoint. */
function compItem(
  keyword: string,
  geo: string,
  timeframe: string
): Record<string, string> {
  return { keyword, geo, time: timeframe };
}

export type WidgetType =
  | "TIMESERIES"
  | "RELATED_QUERIES"
  | "GEO_MAP"
  | "RELATED_TOPICS";

export interface ExploreWidget {
  token: string;
  /**
   * Live responses identify widgets by `id` (e.g. "TIMESERIES"); older
   * responses also carried a `type` field. Use findWidget() to match either.
   */
  type?: WidgetType;
  title?: string;
  id: string;
  request: Record<string, unknown>;
}

/** Find a widget by kind, matching either the `id` or legacy `type` field. */
export function findWidget(
  widgets: ExploreWidget[],
  kind: WidgetType
): ExploreWidget | undefined {
  return widgets.find((w) => w.id === kind || w.type === kind);
}

export interface ExploreResponse {
  widgets: ExploreWidget[];
}

/** Call /explore to obtain widget tokens for subsequent data fetches. */
export async function explore(
  terms: string[],
  geo: string,
  timeframe: string,
  opts: TrendsRequestOptions = {}
): Promise<ExploreResponse> {
  const hl = opts.hl ?? "en-US";
  const tz = opts.tz ?? 360;

  const comparisonItem = terms.map((t) => compItem(t, geo, timeframe));
  const req = JSON.stringify({
    comparisonItem,
    category: 0,
    property: "",
  });

  const url = new URL(`${BASE}/explore`);
  url.searchParams.set("hl", hl);
  url.searchParams.set("tz", String(tz));
  url.searchParams.set("req", req);

  const raw = await fetchTrends(url.toString(), "explore");
  const data = JSON.parse(stripPrefix(raw)) as ExploreResponse;
  return data;
}

/** Raw timeline point returned by the multiline endpoint. */
export interface TimelinePoint {
  time: string;
  formattedTime: string;
  formattedAxisTime: string;
  value: number[];
  hasData: boolean[];
  formattedValue: string[];
}

export interface MultilineResponse {
  default: {
    timelineData: TimelinePoint[];
    averages: number[];
  };
}

/** Fetch interest-over-time data using a token from explore. */
export async function multiline(
  token: string,
  request: Record<string, unknown>,
  opts: TrendsRequestOptions = {}
): Promise<MultilineResponse> {
  const hl = opts.hl ?? "en-US";
  const tz = opts.tz ?? 360;

  const url = new URL(`${BASE}/widgetdata/multiline`);
  url.searchParams.set("hl", hl);
  url.searchParams.set("tz", String(tz));
  url.searchParams.set("token", token);
  url.searchParams.set("req", JSON.stringify(request));

  const raw = await fetchTrends(url.toString(), "multiline");
  return JSON.parse(stripPrefix(raw)) as MultilineResponse;
}

export interface RelatedQuery {
  query: string;
  value: string;
}

export interface RelatedQueriesResponse {
  default: {
    rankedList: Array<{
      rankedKeyword: RelatedQuery[];
    }>;
  };
}

/** Fetch related queries (top + rising) using a token from explore. */
export async function relatedSearches(
  token: string,
  request: Record<string, unknown>,
  opts: TrendsRequestOptions = {}
): Promise<RelatedQueriesResponse> {
  const hl = opts.hl ?? "en-US";
  const tz = opts.tz ?? 360;

  const url = new URL(`${BASE}/widgetdata/relatedsearches`);
  url.searchParams.set("hl", hl);
  url.searchParams.set("tz", String(tz));
  url.searchParams.set("token", token);
  url.searchParams.set("req", JSON.stringify(request));

  const raw = await fetchTrends(url.toString(), "relatedsearches");
  return JSON.parse(stripPrefix(raw)) as RelatedQueriesResponse;
}

export interface GeoPoint {
  geoCode: string;
  geoName: string;
  value: number[];
  formattedValue: string[];
  maxValueIndex: number;
  hasData: boolean[];
}

export interface ComparedGeoResponse {
  default: {
    geoMapData: GeoPoint[];
  };
}

/** Fetch interest-by-region data using a token from explore. */
export async function comparedGeo(
  token: string,
  request: Record<string, unknown>,
  opts: TrendsRequestOptions = {}
): Promise<ComparedGeoResponse> {
  const hl = opts.hl ?? "en-US";
  const tz = opts.tz ?? 360;

  const url = new URL(`${BASE}/widgetdata/comparedgeo`);
  url.searchParams.set("hl", hl);
  url.searchParams.set("tz", String(tz));
  url.searchParams.set("token", token);
  url.searchParams.set("req", JSON.stringify(request));

  const raw = await fetchTrends(url.toString(), "comparedgeo");
  return JSON.parse(stripPrefix(raw)) as ComparedGeoResponse;
}

export interface DailyTrend {
  title: { query: string; exploreLink: string };
  formattedTraffic: string;
  articles: Array<{ title: string; url: string; source: string }>;
}

export interface DailyTrendsResponse {
  default: {
    trendingSearchesDays: Array<{
      date: string;
      trendingSearches: DailyTrend[];
    }>;
  };
}

/** Decode the handful of XML entities that appear in the Trends RSS feed. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Pull the text content of the first occurrence of an XML tag. */
function tagText(block: string, tag: string): string {
  const m = block.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)
  );
  return m?.[1] ? decodeXmlEntities(m[1].trim()) : "";
}

/**
 * Fetch today's trending searches for a given geo.
 *
 * Note: the old /trends/api/dailytrends JSON endpoint was removed by Google
 * (it now returns 404). This uses the RSS feed that backs the current
 * trends.google.com/trending page instead, and adapts it to the same
 * response shape.
 */
export async function dailyTrends(
  geo: string,
  opts: TrendsRequestOptions = {}
): Promise<DailyTrendsResponse> {
  const hl = opts.hl ?? "en-US";

  const url = new URL("https://trends.google.com/trending/rss");
  url.searchParams.set("geo", geo.toUpperCase());
  url.searchParams.set("hl", hl);

  const res = await fetch(url.toString(), { headers: baseHeaders() });

  if (res.status === 429) {
    throw new Error(
      "Google Trends rate-limited this request (HTTP 429). " +
        "Wait a few minutes and try again."
    );
  }
  if (res.status === 400 || res.status === 404) {
    throw new Error(
      `Google Trends does not recognize the geo code "${geo}". ` +
        'Use a two-letter ISO country code such as "US", "GB", or "DE".'
    );
  }
  if (!res.ok) {
    throw new Error(
      `Google Trends trending RSS request failed with status ${res.status}.`
    );
  }

  const xml = await res.text();

  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const trendingSearches: DailyTrend[] = items.map((item) => {
    const query = tagText(item, "title");
    const traffic = tagText(item, "ht:approx_traffic");
    const newsBlocks = item.match(/<ht:news_item>[\s\S]*?<\/ht:news_item>/g) ?? [];
    const articles = newsBlocks.map((nb) => ({
      title: tagText(nb, "ht:news_item_title"),
      url: tagText(nb, "ht:news_item_url"),
      source: tagText(nb, "ht:news_item_source"),
    }));
    return {
      title: { query, exploreLink: "" },
      formattedTraffic: traffic,
      articles,
    };
  });

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  return {
    default: {
      trendingSearchesDays: [{ date, trendingSearches }],
    },
  };
}
