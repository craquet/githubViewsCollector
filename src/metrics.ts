import { Registry, Gauge, collectDefaultMetrics } from "prom-client";
import * as http from "node:http";

// Use a dedicated registry so we have full control over what's exposed.
export const registry = new Registry();

// Collect default Node.js metrics (memory, CPU, event loop, etc.)
collectDefaultMetrics({ register: registry });

// --- Timestamped gauge ---

interface TimestampedGaugeConfig {
  name: string;
  help: string;
  labelNames: readonly string[];
}

interface TimestampedSample {
  labels: Record<string, string>;
  value: number;
  timestampMs: number;
}

/**
 * A gauge that attaches a Prometheus-format timestamp to each sample.
 *
 * Standard prom-client gauges do not support per-sample timestamps. This class
 * stores samples independently and serializes them in the Prometheus exposition
 * format with the optional timestamp suffix: `metric{labels} value timestamp_ms`.
 */
export class TimestampedGauge {
  private readonly name: string;
  private readonly help: string;
  private readonly labelNames: readonly string[];
  private samples: TimestampedSample[] = [];

  constructor(config: TimestampedGaugeConfig) {
    this.name = config.name;
    this.help = config.help;
    this.labelNames = config.labelNames;
  }

  /** Remove all stored samples. */
  reset(): void {
    this.samples = [];
  }

  /** Record a value with an explicit timestamp (milliseconds since epoch). */
  set(labels: Record<string, string>, value: number, timestampMs: number): void {
    this.samples.push({ labels, value, timestampMs });
  }

  /** Serialize all samples in Prometheus exposition format. */
  serialize(): string {
    if (this.samples.length === 0) {
      return "";
    }

    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];

    for (const sample of this.samples) {
      const labelParts = this.labelNames
        .filter((l) => sample.labels[l] !== undefined)
        .map((l) => `${l}="${escapeLabelValue(String(sample.labels[l]))}"`)
        .join(",");
      const labelsStr = labelParts.length > 0 ? `{${labelParts}}` : "";
      lines.push(`${this.name}${labelsStr} ${sample.value} ${sample.timestampMs}`);
    }

    return lines.join("\n");
  }
}

/** Escape special characters in a Prometheus label value. */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** All timestamped gauges, collected for serialization in the /metrics endpoint. */
export const timestampedGauges: TimestampedGauge[] = [];

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

export const viewsDailyTotal = new TimestampedGauge({
  name: "github_repo_views_daily_total",
  help: "Total repository views for the most recent day",
  labelNames: ["owner", "repo"] as const,
});
timestampedGauges.push(viewsDailyTotal);

export const viewsDailyUnique = new TimestampedGauge({
  name: "github_repo_views_daily_unique",
  help: "Unique repository visitors for the most recent day",
  labelNames: ["owner", "repo"] as const,
});
timestampedGauges.push(viewsDailyUnique);

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

export const clonesDailyTotal = new TimestampedGauge({
  name: "github_repo_clones_daily_total",
  help: "Total repository clones for the most recent day",
  labelNames: ["owner", "repo"] as const,
});
timestampedGauges.push(clonesDailyTotal);

export const clonesDailyUnique = new TimestampedGauge({
  name: "github_repo_clones_daily_unique",
  help: "Unique repository cloners for the most recent day",
  labelNames: ["owner", "repo"] as const,
});
timestampedGauges.push(clonesDailyUnique);

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
        const registryOutput = await registry.metrics();
        const timestampedOutput = timestampedGauges
          .map((g) => g.serialize())
          .filter((s) => s.length > 0)
          .join("\n");
        const metrics = timestampedOutput
          ? `${registryOutput}\n${timestampedOutput}\n`
          : registryOutput;
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
