#!/usr/bin/env node
/**
 * google-trends-mcp
 *
 * MCP server exposing Google Trends data via the unofficial endpoints
 * that trends.google.com itself uses. No API key required.
 *
 * Tools:
 *   interest_over_time  - interest scores for up to 5 terms over a time range
 *   compare_terms       - normalized comparison + winner analysis
 *   related_queries     - rising and top related queries for a term
 *   trending_now        - today's daily trending searches for a country
 *   interest_by_region  - regional breakdown of interest for a term
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  explore,
  multiline,
  relatedSearches,
  comparedGeo,
  dailyTrends,
} from "./trends-client.js";

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------

const GeoSchema = z
  .string()
  .default("")
  .describe(
    'Two-letter country code (e.g. "US", "GB", "DE") or empty string for worldwide.'
  );

const TimeframeSchema = z
  .string()
  .default("today 12-m")
  .describe(
    'Trends timeframe string. Examples: "today 12-m", "today 3-m", "today 5-y", ' +
      '"now 7-d", "2024-01-01 2024-12-31".'
  );

const TermsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(5)
  .describe("Search terms to analyze (1-5 terms).");

const InterestOverTimeSchema = z.object({
  terms: TermsSchema,
  geo: GeoSchema,
  timeframe: TimeframeSchema,
});

const CompareTermsSchema = z.object({
  terms: TermsSchema.min(2),
  geo: GeoSchema,
  timeframe: TimeframeSchema,
});

const RelatedQueriesSchema = z.object({
  term: z.string().min(1).describe("The search term to get related queries for."),
  geo: GeoSchema,
  timeframe: TimeframeSchema,
});

const TrendingNowSchema = z.object({
  geo: z
    .string()
    .min(2)
    .max(2)
    .default("US")
    .describe('Two-letter country code, e.g. "US", "GB", "IN".'),
});

const InterestByRegionSchema = z.object({
  term: z.string().min(1).describe("The search term to get regional interest for."),
  geo: GeoSchema,
  timeframe: TimeframeSchema,
});

// ---------------------------------------------------------------------------
// Tool definitions for ListTools
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "interest_over_time",
    description:
      "Fetch Google Trends interest scores (0-100) for up to 5 search terms over a " +
      "time range. Returns a time series with one value per term per data point. " +
      "Useful for spotting seasonality, growth, or decline in search interest.",
    inputSchema: {
      type: "object" as const,
      properties: {
        terms: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 5,
          description: "Search terms (1-5).",
        },
        geo: {
          type: "string",
          default: "",
          description:
            'Two-letter country code (e.g. "US") or empty for worldwide.',
        },
        timeframe: {
          type: "string",
          default: "today 12-m",
          description:
            'Trends timeframe string, e.g. "today 12-m", "today 5-y", "now 7-d".',
        },
      },
      required: ["terms"],
    },
  },
  {
    name: "compare_terms",
    description:
      "Compare 2-5 search terms against each other using Google Trends normalized " +
      "interest scores. Returns the time series, averages per term, and identifies " +
      "which term has the highest overall interest.",
    inputSchema: {
      type: "object" as const,
      properties: {
        terms: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 5,
          description: "Search terms to compare (2-5).",
        },
        geo: {
          type: "string",
          default: "",
          description: 'Two-letter country code or empty for worldwide.',
        },
        timeframe: {
          type: "string",
          default: "today 12-m",
          description: 'Trends timeframe string.',
        },
      },
      required: ["terms"],
    },
  },
  {
    name: "related_queries",
    description:
      "Get rising and top related search queries for a given term from Google Trends. " +
      "Rising queries have seen the largest recent growth; top queries have the most " +
      "overall volume. Useful for discovering adjacent keywords and content ideas.",
    inputSchema: {
      type: "object" as const,
      properties: {
        term: {
          type: "string",
          description: "The search term to get related queries for.",
        },
        geo: {
          type: "string",
          default: "",
          description: 'Two-letter country code or empty for worldwide.',
        },
        timeframe: {
          type: "string",
          default: "today 12-m",
          description: 'Trends timeframe string.',
        },
      },
      required: ["term"],
    },
  },
  {
    name: "trending_now",
    description:
      "Get today's daily trending searches for a country from Google Trends. " +
      "Returns the top trending queries with estimated traffic and linked news articles.",
    inputSchema: {
      type: "object" as const,
      properties: {
        geo: {
          type: "string",
          default: "US",
          description:
            'Two-letter country code (e.g. "US", "GB", "IN", "AU").',
        },
      },
      required: [],
    },
  },
  {
    name: "interest_by_region",
    description:
      "Get Google Trends interest scores broken down by region (sub-country or " +
      "country, depending on the geo parameter). Returns top regions with the " +
      "highest relative interest for the given term.",
    inputSchema: {
      type: "object" as const,
      properties: {
        term: {
          type: "string",
          description: "The search term to get regional interest for.",
        },
        geo: {
          type: "string",
          default: "",
          description:
            'Two-letter country code to drill into sub-regions (e.g. "US" gives ' +
            "US states), or empty for worldwide country-level breakdown.",
        },
        timeframe: {
          type: "string",
          default: "today 12-m",
          description: 'Trends timeframe string.',
        },
      },
      required: ["term"],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Helper: return tool error text
// ---------------------------------------------------------------------------

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function toolText(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleInterestOverTime(rawArgs: unknown) {
  const args = InterestOverTimeSchema.parse(rawArgs);
  const { terms, geo, timeframe } = args;

  try {
    const exploreData = await explore(terms, geo, timeframe);
    const widget = exploreData.widgets.find((w) => w.type === "TIMESERIES");
    if (!widget) {
      return toolError("No TIMESERIES widget found in Trends explore response.");
    }

    const data = await multiline(widget.token, widget.request);
    const points = data.default.timelineData;

    if (!points.length) {
      return toolText(
        "Google Trends returned no data for the given terms and timeframe. " +
          "Try a broader timeframe or different terms."
      );
    }

    const lines: string[] = [
      `Interest over time for: ${terms.join(", ")}`,
      `Geo: ${geo || "Worldwide"} | Timeframe: ${timeframe}`,
      "",
      ["Date", ...terms].join("\t"),
    ];

    for (const pt of points) {
      const vals = terms.map((_, i) => String(pt.value[i] ?? 0));
      lines.push([pt.formattedTime, ...vals].join("\t"));
    }

    const averages = data.default.averages;
    if (averages?.length) {
      lines.push("");
      lines.push("Averages: " + terms.map((t, i) => `${t}=${averages[i] ?? 0}`).join(", "));
    }

    return toolText(lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(msg);
  }
}

async function handleCompareTerms(rawArgs: unknown) {
  const args = CompareTermsSchema.parse(rawArgs);
  const { terms, geo, timeframe } = args;

  try {
    const exploreData = await explore(terms, geo, timeframe);
    const widget = exploreData.widgets.find((w) => w.type === "TIMESERIES");
    if (!widget) {
      return toolError("No TIMESERIES widget found in Trends explore response.");
    }

    const data = await multiline(widget.token, widget.request);
    const points = data.default.timelineData;
    const averages = data.default.averages ?? [];

    if (!points.length) {
      return toolText(
        "Google Trends returned no data. Try a broader timeframe or different terms."
      );
    }

    // Identify winner by average score
    let winnerIdx = 0;
    for (let i = 1; i < averages.length; i++) {
      if ((averages[i] ?? 0) > (averages[winnerIdx] ?? 0)) winnerIdx = i;
    }

    const lines: string[] = [
      `Comparison: ${terms.join(" vs ")}`,
      `Geo: ${geo || "Worldwide"} | Timeframe: ${timeframe}`,
      "",
    ];

    if (averages.length) {
      lines.push("Average interest scores (0-100):");
      terms.forEach((t, i) => {
        const star = i === winnerIdx ? " <-- highest" : "";
        lines.push(`  ${t}: ${averages[i] ?? 0}${star}`);
      });
      lines.push("");
    }

    lines.push(["Date", ...terms].join("\t"));
    for (const pt of points) {
      const vals = terms.map((_, i) => String(pt.value[i] ?? 0));
      lines.push([pt.formattedTime, ...vals].join("\t"));
    }

    return toolText(lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(msg);
  }
}

async function handleRelatedQueries(rawArgs: unknown) {
  const args = RelatedQueriesSchema.parse(rawArgs);
  const { term, geo, timeframe } = args;

  try {
    const exploreData = await explore([term], geo, timeframe);
    const widget = exploreData.widgets.find((w) => w.type === "RELATED_QUERIES");
    if (!widget) {
      return toolError("No RELATED_QUERIES widget found in Trends explore response.");
    }

    const data = await relatedSearches(widget.token, widget.request);
    const rankedList = data.default.rankedList;

    // rankedList[0] = top queries, rankedList[1] = rising queries
    const top = rankedList[0]?.rankedKeyword ?? [];
    const rising = rankedList[1]?.rankedKeyword ?? [];

    if (!top.length && !rising.length) {
      return toolText("No related queries found for this term.");
    }

    const lines: string[] = [
      `Related queries for: ${term}`,
      `Geo: ${geo || "Worldwide"} | Timeframe: ${timeframe}`,
      "",
    ];

    if (top.length) {
      lines.push("TOP queries (by volume):");
      top.slice(0, 25).forEach((q) => lines.push(`  ${q.query} (${q.value})`));
      lines.push("");
    }

    if (rising.length) {
      lines.push("RISING queries (fastest growing):");
      rising.slice(0, 25).forEach((q) => lines.push(`  ${q.query} (${q.value})`));
    }

    return toolText(lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(msg);
  }
}

async function handleTrendingNow(rawArgs: unknown) {
  const args = TrendingNowSchema.parse(rawArgs);
  const { geo } = args;

  try {
    const data = await dailyTrends(geo);
    const days = data.default.trendingSearchesDays;

    if (!days.length) {
      return toolText("No trending searches returned for this region.");
    }

    const today = days[0];
    const lines: string[] = [
      `Trending searches in ${geo} for ${today?.date ?? "today"}`,
      "",
    ];

    (today?.trendingSearches ?? []).slice(0, 20).forEach((trend, i) => {
      lines.push(`${i + 1}. ${trend.title.query} (${trend.formattedTraffic})`);
      if (trend.articles.length) {
        const art = trend.articles[0];
        if (art) {
          lines.push(`   via ${art.source}: ${art.title}`);
        }
      }
    });

    return toolText(lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(msg);
  }
}

async function handleInterestByRegion(rawArgs: unknown) {
  const args = InterestByRegionSchema.parse(rawArgs);
  const { term, geo, timeframe } = args;

  try {
    const exploreData = await explore([term], geo, timeframe);
    const widget = exploreData.widgets.find((w) => w.type === "GEO_MAP");
    if (!widget) {
      return toolError("No GEO_MAP widget found in Trends explore response.");
    }

    const data = await comparedGeo(widget.token, widget.request);
    const regions = data.default.geoMapData;

    if (!regions.length) {
      return toolText("No regional data found for this term.");
    }

    const lines: string[] = [
      `Interest by region for: ${term}`,
      `Geo: ${geo || "Worldwide"} | Timeframe: ${timeframe}`,
      "",
      "Region\tCode\tScore",
    ];

    regions
      .sort((a, b) => (b.value[0] ?? 0) - (a.value[0] ?? 0))
      .slice(0, 30)
      .forEach((r) => {
        lines.push(`${r.geoName}\t${r.geoCode}\t${r.value[0] ?? 0}`);
      });

    return toolText(lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return toolError(msg);
  }
}

// ---------------------------------------------------------------------------
// Server wiring
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "google-trends-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "interest_over_time":
      return handleInterestOverTime(args);

    case "compare_terms":
      return handleCompareTerms(args);

    case "related_queries":
      return handleRelatedQueries(args);

    case "trending_now":
      return handleTrendingNow(args);

    case "interest_by_region":
      return handleInterestByRegion(args);

    default:
      return toolError(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now running; log only to stderr so stdout stays clean for MCP.
  process.stderr.write("google-trends-mcp running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
