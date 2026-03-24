import { Config } from "./config";
import { GitHubClient, RepoTrafficData, TrafficEntry } from "./github";
import * as metrics from "./metrics";

/**
 * Format a timestamp string (ISO 8601) to a YYYY-MM-DD date string.
 */
function toDateString(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * Extract the full week entry from a weekly traffic response.
 *
 * GitHub returns up to 3 weekly entries covering 14 days:
 *   - Entry 0: Partial trailing days of the oldest week
 *   - Entry 1: The last fully completed Mon-Sun week
 *   - Entry 2: Partial current week (Mon through today)
 *
 * We only use entry 1 (the full week) for the weekly metric.
 * If fewer than 2 entries are returned, there is no guaranteed full week.
 */
function getFullWeekEntry(entries: TrafficEntry[] | undefined): TrafficEntry | null {
  if (!entries || entries.length < 2) {
    return null;
  }

  // Sort by timestamp ascending to be safe (API should return them in order)
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // The middle entry in a 3-entry response, or the first in a 2-entry response
  // when there are exactly 2, the first is the complete older week
  if (sorted.length >= 3) {
    return sorted[1];
  }

  // With exactly 2 entries: this is ambiguous. It could mean the 14-day window
  // starts exactly on a Monday (no partial first week), giving us [full week, partial current week].
  // In this case entry 0 is the full week.
  return sorted[0];
}

/**
 * Update all Prometheus gauges from the collected data.
 *
 * This performs an atomic update: reset all gauges first, then set all values.
 * This prevents stale labels from accumulating and minimizes the window where
 * Prometheus could scrape incomplete data.
 */
function updateGauges(allData: RepoTrafficData[]): void {
  // Reset all gauges with variable labels (daily, weekly, referrer, path)
  metrics.viewsTotal.reset();
  metrics.viewsUnique.reset();
  metrics.viewsWeeklyTotal.reset();
  metrics.viewsWeeklyUnique.reset();
  metrics.viewsDailyTotal.reset();
  metrics.viewsDailyUnique.reset();
  metrics.clonesTotal.reset();
  metrics.clonesUnique.reset();
  metrics.clonesWeeklyTotal.reset();
  metrics.clonesWeeklyUnique.reset();
  metrics.clonesDailyTotal.reset();
  metrics.clonesDailyUnique.reset();
  metrics.referrerViewsTotal.reset();
  metrics.referrerViewsUnique.reset();


  for (const data of allData) {
    const { owner, repo } = data.repo;

    // --- Views: 14-day rolling totals ---
    metrics.viewsTotal.set({ owner, repo }, data.viewsWeekly.count);
    metrics.viewsUnique.set({ owner, repo }, data.viewsWeekly.uniques);

    // --- Views: weekly (full week only) ---
    const fullViewsWeek = getFullWeekEntry(data.viewsWeekly.views);
    if (fullViewsWeek) {
      const week = toDateString(fullViewsWeek.timestamp);
      metrics.viewsWeeklyTotal.set({ owner, repo, week }, fullViewsWeek.count);
      metrics.viewsWeeklyUnique.set({ owner, repo, week }, fullViewsWeek.uniques);
    }

    // --- Views: daily ---
    if (data.viewsDaily.views) {
      for (const entry of data.viewsDaily.views) {
        const date = toDateString(entry.timestamp);
        metrics.viewsDailyTotal.set({ owner, repo, date }, entry.count);
        metrics.viewsDailyUnique.set({ owner, repo, date }, entry.uniques);
      }
    }

    // --- Clones: 14-day rolling totals ---
    metrics.clonesTotal.set({ owner, repo }, data.clonesWeekly.count);
    metrics.clonesUnique.set({ owner, repo }, data.clonesWeekly.uniques);

    // --- Clones: weekly (full week only) ---
    const fullClonesWeek = getFullWeekEntry(data.clonesWeekly.clones);
    if (fullClonesWeek) {
      const week = toDateString(fullClonesWeek.timestamp);
      metrics.clonesWeeklyTotal.set({ owner, repo, week }, fullClonesWeek.count);
      metrics.clonesWeeklyUnique.set({ owner, repo, week }, fullClonesWeek.uniques);
    }

    // --- Clones: daily ---
    if (data.clonesDaily.clones) {
      for (const entry of data.clonesDaily.clones) {
        const date = toDateString(entry.timestamp);
        metrics.clonesDailyTotal.set({ owner, repo, date }, entry.count);
        metrics.clonesDailyUnique.set({ owner, repo, date }, entry.uniques);
      }
    }

    // --- Referrers ---
    for (const ref of data.referrers) {
      metrics.referrerViewsTotal.set({ owner, repo, referrer: ref.referrer }, ref.count);
      metrics.referrerViewsUnique.set({ owner, repo, referrer: ref.referrer }, ref.uniques);
    }


  }
}

/**
 * Run a full collection cycle: fetch data for all repos, then update gauges atomically.
 */
export async function collect(config: Config): Promise<void> {
  const startTime = Date.now();
  let errorCount = 0;

  console.log(`[collector] Starting collection for ${config.repos.length} repo(s)`);

  const client = new GitHubClient(config.githubApiUrl, config.githubToken);
  const allData: RepoTrafficData[] = [];

  // Collect repos sequentially to avoid hammering the API with parallel requests
  for (const repo of config.repos) {
    const label = `${repo.owner}/${repo.repo}`;
    try {
      console.log(`[collector] Fetching traffic data for ${label}`);
      const data = await client.collectRepo(repo);
      allData.push(data);

      console.log(
        `[collector] ${label}: ` +
          `views=${data.viewsWeekly.count} (${data.viewsWeekly.uniques} unique), ` +
          `clones=${data.clonesWeekly.count} (${data.clonesWeekly.uniques} unique), ` +
          `${data.referrers.length} referrers`
      );
    } catch (err) {
      errorCount++;
      console.error(`[collector] Error collecting ${label}:`, err instanceof Error ? err.message : err);
      // Continue to next repo -- don't let one failure stop the others
    }
  }

  // Atomic gauge update: reset all, then set all collected data
  if (allData.length > 0) {
    updateGauges(allData);
    console.log(`[collector] Gauges updated for ${allData.length} repo(s)`);
  } else {
    console.warn("[collector] No data collected -- gauges not updated");
  }

  const durationSeconds = (Date.now() - startTime) / 1000;
  metrics.lastCollectionTimestamp.set(Date.now() / 1000);
  metrics.collectionDurationSeconds.set(durationSeconds);
  metrics.collectionErrors.set(errorCount);

  console.log(
    `[collector] Collection complete in ${durationSeconds.toFixed(1)}s ` +
      `(${allData.length} succeeded, ${errorCount} failed)`
  );
}
