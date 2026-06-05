/**
 * Tests for the Google Trends client.
 *
 * All HTTP calls are mocked via vi.stubGlobal("fetch", ...) so no live network
 * requests are made in CI. Fixture JSON files mirror the shape of real
 * Google Trends API responses (including the ")]}'" anti-hijacking prefix).
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  explore,
  multiline,
  relatedSearches,
  comparedGeo,
  dailyTrends,
} from "../src/trends-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, "fixtures", name), "utf-8");
}

function mockFetch(body: string, status = 200) {
  const mockResponse = {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as Response;

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// explore()
// ---------------------------------------------------------------------------

describe("explore()", () => {
  it("strips the )]}' prefix and returns parsed widgets", async () => {
    mockFetch(loadFixture("explore.json"));

    const result = await explore(["coffee"], "US", "today 12-m");

    expect(result.widgets).toHaveLength(3);
    expect(result.widgets[0]?.type).toBe("TIMESERIES");
    expect(result.widgets[0]?.token).toBe("APP6_TIMESERIES_TOKEN");
    expect(result.widgets[1]?.type).toBe("RELATED_QUERIES");
    expect(result.widgets[2]?.type).toBe("GEO_MAP");
  });

  it("throws a friendly message on 429", async () => {
    mockFetch("", 429);

    await expect(explore(["coffee"], "US", "today 12-m")).rejects.toThrow(
      /rate-limited/
    );
  });

  it("throws a friendly message on non-200 errors", async () => {
    mockFetch("", 503);

    await expect(explore(["coffee"], "US", "today 12-m")).rejects.toThrow(
      /503/
    );
  });

  it("explains invalid geo or timeframe on 400", async () => {
    mockFetch("", 400);

    await expect(explore(["coffee"], "USA", "today 12-m")).rejects.toThrow(
      /invalid geo or timeframe/
    );
  });

  it("sends the correct URL parameters", async () => {
    mockFetch(loadFixture("explore.json"));

    await explore(["coffee"], "US", "today 12-m", { hl: "en-GB", tz: 0 });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const url = String(fetchCall?.[0]);
    expect(url).toContain("hl=en-GB");
    expect(url).toContain("tz=0");
    expect(url).toContain("coffee");
  });
});

// ---------------------------------------------------------------------------
// multiline()
// ---------------------------------------------------------------------------

describe("multiline()", () => {
  it("strips prefix and returns timeline data", async () => {
    mockFetch(loadFixture("multiline.json"));

    const result = await multiline("SOME_TOKEN", {});

    const points = result.default.timelineData;
    expect(points).toHaveLength(4);
    expect(points[0]?.formattedTime).toBe("May 29, 2023");
    expect(points[0]?.value).toEqual([72]);
    expect(result.default.averages).toEqual([70]);
  });

  it("throws a friendly message on 429", async () => {
    mockFetch("", 429);

    await expect(multiline("TOK", {})).rejects.toThrow(/rate-limited/);
  });
});

// ---------------------------------------------------------------------------
// relatedSearches()
// ---------------------------------------------------------------------------

describe("relatedSearches()", () => {
  it("strips prefix and returns top + rising queries", async () => {
    mockFetch(loadFixture("relatedsearches.json"));

    const result = await relatedSearches("SOME_TOKEN", {});
    const rankedList = result.default.rankedList;

    expect(rankedList).toHaveLength(2);

    const top = rankedList[0]?.rankedKeyword ?? [];
    expect(top[0]?.query).toBe("coffee near me");
    expect(top[0]?.value).toBe("100");

    const rising = rankedList[1]?.rankedKeyword ?? [];
    expect(rising[0]?.query).toBe("mushroom coffee");
    expect(rising[0]?.value).toBe("Breakout");
  });

  it("throws on 429", async () => {
    mockFetch("", 429);
    await expect(relatedSearches("TOK", {})).rejects.toThrow(/rate-limited/);
  });
});

// ---------------------------------------------------------------------------
// comparedGeo()
// ---------------------------------------------------------------------------

describe("comparedGeo()", () => {
  it("strips prefix and returns geo map data", async () => {
    mockFetch(loadFixture("comparedgeo.json"));

    const result = await comparedGeo("SOME_TOKEN", {});
    const geoData = result.default.geoMapData;

    expect(geoData).toHaveLength(5);
    expect(geoData[0]?.geoCode).toBe("US-WA");
    expect(geoData[0]?.geoName).toBe("Washington");
    expect(geoData[0]?.value).toEqual([100]);
  });

  it("throws on 429", async () => {
    mockFetch("", 429);
    await expect(comparedGeo("TOK", {})).rejects.toThrow(/rate-limited/);
  });
});

// ---------------------------------------------------------------------------
// dailyTrends()
// ---------------------------------------------------------------------------

describe("dailyTrends()", () => {
  it("parses the trending RSS feed into trending searches", async () => {
    mockFetch(loadFixture("trending-rss.xml"));

    const result = await dailyTrends("US");
    const days = result.default.trendingSearchesDays;

    expect(days).toHaveLength(1);

    const searches = days[0]?.trendingSearches ?? [];
    expect(searches).toHaveLength(3);
    expect(searches[0]?.title.query).toBe("Memorial Day");
    expect(searches[0]?.formattedTraffic).toBe("5M+");
    expect(searches[0]?.articles[0]?.source).toBe("CNN");
  });

  it("decodes XML entities in queries", async () => {
    mockFetch(loadFixture("trending-rss.xml"));

    const result = await dailyTrends("US");
    const searches = result.default.trendingSearchesDays[0]?.trendingSearches ?? [];
    expect(searches[1]?.title.query).toBe("jigsaw puzzle & games");
  });

  it("handles items without news articles", async () => {
    mockFetch(loadFixture("trending-rss.xml"));

    const result = await dailyTrends("US");
    const searches = result.default.trendingSearchesDays[0]?.trendingSearches ?? [];
    expect(searches[2]?.title.query).toBe("weather radar");
    expect(searches[2]?.articles).toHaveLength(0);
  });

  it("throws on 429", async () => {
    mockFetch("", 429);
    await expect(dailyTrends("US")).rejects.toThrow(/rate-limited/);
  });

  it("sends geo and hl parameters to the RSS endpoint", async () => {
    mockFetch(loadFixture("trending-rss.xml"));

    await dailyTrends("GB", { hl: "en-GB" });

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const url = String(fetchCall?.[0]);
    expect(url).toContain("/trending/rss");
    expect(url).toContain("geo=GB");
    expect(url).toContain("hl=en-GB");
  });
});

// ---------------------------------------------------------------------------
// Cookie bootstrap on 429
// ---------------------------------------------------------------------------

describe("cookie bootstrap", () => {
  it("retries once with the cookie from a 429 response", async () => {
    const cookieResponse = {
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === "set-cookie" ? "NID=abc123; path=/" : null) },
      text: async () => "",
    } as unknown as Response;

    const okResponse = {
      ok: true,
      status: 200,
      text: async () => loadFixture("explore.json"),
    } as unknown as Response;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(cookieResponse)
      .mockResolvedValueOnce(okResponse);
    vi.stubGlobal("fetch", fetchMock);

    const result = await explore(["coffee"], "US", "today 12-m");
    expect(result.widgets).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCallHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondCallHeaders["Cookie"]).toBe("NID=abc123");
  });

  it("throws rate-limited when 429 persists after the cookie retry", async () => {
    const cookieResponse = {
      ok: false,
      status: 429,
      headers: { get: (name: string) => (name === "set-cookie" ? "NID=abc123; path=/" : null) },
      text: async () => "",
    } as unknown as Response;

    const fetchMock = vi.fn().mockResolvedValue(cookieResponse);
    vi.stubGlobal("fetch", fetchMock);

    await expect(explore(["coffee"], "US", "today 12-m")).rejects.toThrow(/rate-limited/);
  });
});

// ---------------------------------------------------------------------------
// Prefix stripping edge cases
// ---------------------------------------------------------------------------

describe("prefix stripping", () => {
  it("handles response with newline after prefix", async () => {
    const fixture = loadFixture("explore.json");
    // Verify the fixture itself has the prefix
    expect(fixture.trimStart()).toMatch(/^\)\]\}'/);

    mockFetch(fixture);
    const result = await explore(["coffee"], "US", "today 12-m");
    expect(result.widgets).toBeDefined();
  });

  it("handles multiline response with no data points gracefully", async () => {
    const emptyResponse = `)]}'
{
  "default": {
    "timelineData": [],
    "averages": []
  }
}`;
    mockFetch(emptyResponse);

    const result = await multiline("TOK", {});
    expect(result.default.timelineData).toHaveLength(0);
  });
});
