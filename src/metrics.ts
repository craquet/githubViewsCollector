import { Registry, Gauge, collectDefaultMetrics } from "prom-client";
import * as http from "node:http";

// Use a dedicated registry so we have full control over what's exposed.
export const registry = new Registry();

// Collect default Node.js metrics (memory, CPU, event loop, etc.)
collectDefaultMetrics({ register: registry });

// --- Views ---

export const viewsTotal = new Gauge({
  name: "github_repo_views_total",
  help: "Total repository views over the last 14 days",
  labelNames: ["owner", "repo"] as const,
  registers: [registry],
});

export const viewsUnique = new Gauge({
  name: "github_repo_views_unique",
  help: "Unique repository visitors over the last 14 days",
  labelNames: ["owner", "repo"] as const,
  registers: [registry],
});

export const viewsWeeklyTotal = new Gauge({
  name: "github_repo_views_weekly_total",
  help: "Total repository views for the last full week (Mon-Sun)",
  labelNames: ["owner", "repo", "week"] as const,
  registers: [registry],
});

export const viewsWeeklyUnique = new Gauge({
  name: "github_repo_views_weekly_unique",
  help: "Unique repository visitors for the last full week (Mon-Sun)",
  labelNames: ["owner", "repo", "week"] as const,
  registers: [registry],
});

export const viewsDailyTotal = new Gauge({
  name: "github_repo_views_daily_total",
  help: "Total repository views per day",
  labelNames: ["owner", "repo", "date"] as const,
  registers: [registry],
});

export const viewsDailyUnique = new Gauge({
  name: "github_repo_views_daily_unique",
  help: "Unique repository visitors per day",
  labelNames: ["owner", "repo", "date"] as const,
  registers: [registry],
});

// --- Clones ---

export const clonesTotal = new Gauge({
  name: "github_repo_clones_total",
  help: "Total repository clones over the last 14 days",
  labelNames: ["owner", "repo"] as const,
  registers: [registry],
});

export const clonesUnique = new Gauge({
  name: "github_repo_clones_unique",
  help: "Unique repository cloners over the last 14 days",
  labelNames: ["owner", "repo"] as const,
  registers: [registry],
});

export const clonesWeeklyTotal = new Gauge({
  name: "github_repo_clones_weekly_total",
  help: "Total repository clones for the last full week (Mon-Sun)",
  labelNames: ["owner", "repo", "week"] as const,
  registers: [registry],
});

export const clonesWeeklyUnique = new Gauge({
  name: "github_repo_clones_weekly_unique",
  help: "Unique repository cloners for the last full week (Mon-Sun)",
  labelNames: ["owner", "repo", "week"] as const,
  registers: [registry],
});

export const clonesDailyTotal = new Gauge({
  name: "github_repo_clones_daily_total",
  help: "Total repository clones per day",
  labelNames: ["owner", "repo", "date"] as const,
  registers: [registry],
});

export const clonesDailyUnique = new Gauge({
  name: "github_repo_clones_daily_unique",
  help: "Unique repository cloners per day",
  labelNames: ["owner", "repo", "date"] as const,
  registers: [registry],
});

// --- Referrers ---

export const referrerViewsTotal = new Gauge({
  name: "github_repo_referrer_views_total",
  help: "Total views from a referrer over the last 14 days",
  labelNames: ["owner", "repo", "referrer"] as const,
  registers: [registry],
});

export const referrerViewsUnique = new Gauge({
  name: "github_repo_referrer_views_unique",
  help: "Unique visitors from a referrer over the last 14 days",
  labelNames: ["owner", "repo", "referrer"] as const,
  registers: [registry],
});

// --- Popular paths ---

export const popularPathViewsTotal = new Gauge({
  name: "github_repo_popular_path_views_total",
  help: "Total views for a popular path over the last 14 days",
  labelNames: ["owner", "repo", "path"] as const,
  registers: [registry],
});

export const popularPathViewsUnique = new Gauge({
  name: "github_repo_popular_path_views_unique",
  help: "Unique visitors for a popular path over the last 14 days",
  labelNames: ["owner", "repo", "path"] as const,
  registers: [registry],
});

// --- Collection metadata ---

export const lastCollectionTimestamp = new Gauge({
  name: "github_views_collector_last_run_timestamp_seconds",
  help: "Unix timestamp of the last successful collection run",
  registers: [registry],
});

export const collectionDurationSeconds = new Gauge({
  name: "github_views_collector_duration_seconds",
  help: "Duration of the last collection run in seconds",
  registers: [registry],
});

export const collectionErrors = new Gauge({
  name: "github_views_collector_errors_total",
  help: "Number of errors during the last collection run",
  registers: [registry],
});

// --- HTTP server ---

let server: http.Server | null = null;

export function startMetricsServer(port: number): http.Server {
  server = http.createServer(async (req, res) => {
    if (req.url === "/metrics" && req.method === "GET") {
      try {
        const metrics = await registry.metrics();
        res.writeHead(200, { "Content-Type": registry.contentType });
        res.end(metrics);
      } catch (err) {
        res.writeHead(500);
        res.end("Error collecting metrics");
        console.error("[metrics] Error generating metrics:", err);
      }
    } else if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(port, () => {
    console.log(`[metrics] Metrics server listening on port ${port}`);
    console.log(`[metrics] Endpoints: GET /metrics, GET /health`);
  });

  return server;
}

export function stopMetricsServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
