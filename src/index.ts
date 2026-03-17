import "dotenv/config";
import * as cron from "node-cron";
import { loadConfig } from "./config";
import { collect } from "./collector";
import { startMetricsServer, stopMetricsServer } from "./metrics";

async function main(): Promise<void> {
  console.log("[main] GitHub Views Collector starting");

  // Load and validate configuration
  const config = loadConfig();

  console.log(`[main] Configured repos: ${config.repos.map((r) => `${r.owner}/${r.repo}`).join(", ")}`);
  console.log(`[main] Cron schedule: ${config.cronSchedule}`);
  console.log(`[main] Metrics port: ${config.metricsPort}`);
  console.log(`[main] GitHub API URL: ${config.githubApiUrl}`);

  // Start the metrics HTTP server
  const server = startMetricsServer(config.metricsPort);

  // Run initial collection immediately
  console.log("[main] Running initial collection");
  try {
    await collect(config);
  } catch (err) {
    console.error("[main] Initial collection failed:", err instanceof Error ? err.message : err);
  }

  // Schedule periodic collection
  if (!cron.validate(config.cronSchedule)) {
    console.error(`[main] Invalid cron schedule: "${config.cronSchedule}"`);
    process.exit(1);
  }

  const task = cron.schedule(config.cronSchedule, async () => {
    console.log("[main] Scheduled collection triggered");
    try {
      await collect(config);
    } catch (err) {
      console.error("[main] Scheduled collection failed:", err instanceof Error ? err.message : err);
    }
  });

  console.log("[main] Scheduler started -- waiting for next collection run");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[main] Received ${signal}, shutting down`);
    task.stop();
    await stopMetricsServer();
    console.log("[main] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[main] Fatal error:", err);
  process.exit(1);
});
