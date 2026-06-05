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

/** Strip the ")]}'" prefix Google prepends to every JSON response. */
function stripPrefix(raw: string): string {
  return raw.replace(/^\)\]\}'\n?/, "");
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
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://trends.google.com/",
  };
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
  type: WidgetType;
  title: string;
  id: string;
  request: Record<string, unknown>;
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

  const res = await fetch(url.toString(), { headers: baseHeaders() });

  if (res.status === 429) {
    throw new Error(
      "Google Trends rate-limited this request (HTTP 429). " +
        "Wait a few minutes and try again. This is a known limitation of the unofficial endpoint."
    );
  }
  if (!res.ok) {
    throw new Error(
      `Google Trends explore request failed with status ${res.status}. ` +
        "The unofficial endpoint may be temporarily unavailable."
    );
  }

  const raw = await res.text();
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

  const res = await fetch(url.toString(), { headers: baseHeaders() });

  if (res.status === 429) {
    throw new Error(
      "Google Trends rate-limited this request (HTTP 429). " +
        "Wait a few minutes and try again."
    );
  }
  if (!res.ok) {
    throw new Error(
      `Google Trends multiline request failed with status ${res.status}.`
    );
  }

  const raw = await res.text();
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

  const res = await fetch(url.toString(), { headers: baseHeaders() });

  if (res.status === 429) {
    throw new Error(
      "Google Trends rate-limited this request (HTTP 429). " +
        "Wait a few minutes and try again."
    );
  }
  if (!res.ok) {
    throw new Error(
      `Google Trends relatedsearches request failed with status ${res.status}.`
    );
  }

  const raw = await res.text();
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

  const res = await fetch(url.toString(), { headers: baseHeaders() });

  if (res.status === 429) {
    throw new Error(
      "Google Trends rate-limited this request (HTTP 429). " +
        "Wait a few minutes and try again."
    );
  }
  if (!res.ok) {
    throw new Error(
      `Google Trends comparedgeo request failed with status ${res.status}.`
    );
  }

  const raw = await res.text();
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

/** Fetch today's trending searches for a given geo. */
export async function dailyTrends(
  geo: string,
  opts: TrendsRequestOptions = {}
): Promise<DailyTrendsResponse> {
  const hl = opts.hl ?? "en-US";
  const tz = opts.tz ?? 360;

  const url = new URL(`${BASE}/dailytrends`);
  url.searchParams.set("hl", hl);
  url.searchParams.set("tz", String(tz));
  url.searchParams.set("geo", geo);
  url.searchParams.set("ns", "15");

  const res = await fetch(url.toString(), { headers: baseHeaders() });

  if (res.status === 429) {
    throw new Error(
      "Google Trends rate-limited this request (HTTP 429). " +
        "Wait a few minutes and try again."
    );
  }
  if (!res.ok) {
    throw new Error(
      `Google Trends dailytrends request failed with status ${res.status}.`
    );
  }

  const raw = await res.text();
  return JSON.parse(stripPrefix(raw)) as DailyTrendsResponse;
}
