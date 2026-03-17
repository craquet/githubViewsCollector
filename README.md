# GitHub Views Collector

A long-running service that periodically fetches traffic data from the GitHub API and exposes it as Prometheus metrics for use in Grafana dashboards.

GitHub only retains traffic data for the last 14 days. This service collects that data on a schedule and makes it available to Prometheus, which stores the time series long-term. This lets you build persistent historical dashboards of your repository traffic in Grafana.

## Architecture

```
                         scrape
[GitHub API] ──fetch──> [Collector :9091/metrics] <────── [Prometheus] ──> [Grafana]
                every 6h                            every 5m
```

The collector runs as a standalone service. It fetches data from GitHub on a configurable cron schedule (default: every 6 hours), keeps the latest metrics in memory, and exposes them on a standard `/metrics` HTTP endpoint that Prometheus scrapes.

## Data Collected

The collector fetches four types of traffic data per repository:

| GitHub API Endpoint | Data |
|---|---|
| `GET /repos/{owner}/{repo}/traffic/views?per=day` | Daily page views (total + unique) |
| `GET /repos/{owner}/{repo}/traffic/views?per=week` | Weekly page views (total + unique) |
| `GET /repos/{owner}/{repo}/traffic/clones?per=day` | Daily clones (total + unique) |
| `GET /repos/{owner}/{repo}/traffic/clones?per=week` | Weekly clones (total + unique) |
| `GET /repos/{owner}/{repo}/traffic/popular/referrers` | Top 10 referral sources |
| `GET /repos/{owner}/{repo}/traffic/popular/paths` | Top 10 popular content paths |

This results in **6 API calls per repository** per collection run.

## How Weekly Unique Visitors Work

GitHub's weekly traffic endpoint returns 3 entries covering 14 days:

| Entry | Content | Example |
|---|---|---|
| Entry 0 | Partial trailing days of the oldest week | Mar 2 (covers Mar 4-8, a partial Mon-Sun) |
| Entry 1 | The last **fully completed** Mon-Sun week | Mar 9 (covers Mar 9-15, a full week) |
| Entry 2 | Partial current week (Mon through today) | Mar 16 (covers Mar 16-17, still in progress) |

The `uniques` count within each entry is **deduplicated by GitHub within that period** -- a visitor who comes on Tuesday and Thursday of the same week counts as 1 unique. This deduplication happens server-side and cannot be reconstructed from daily data.

**This collector only emits entry 1 (the full week) for the weekly metric.** Partial weeks are excluded because they are not comparable week-over-week. The 14-day rolling unique count (the top-level `uniques` from the API) is still exposed as a separate metric for the big-picture number.

Over time, Prometheus accumulates a history of full-week values as each week completes and rotates into the "entry 1" position.

## Prometheus Metrics

### Views

| Metric | Labels | Description |
|---|---|---|
| `github_repo_views_total` | `owner`, `repo` | Rolling 14-day total page views |
| `github_repo_views_unique` | `owner`, `repo` | Rolling 14-day unique visitors |
| `github_repo_views_weekly_total` | `owner`, `repo`, `week` | Total views for the last full week (Mon-Sun) |
| `github_repo_views_weekly_unique` | `owner`, `repo`, `week` | Unique visitors for the last full week (Mon-Sun) |
| `github_repo_views_daily_total` | `owner`, `repo`, `date` | Total views per day |
| `github_repo_views_daily_unique` | `owner`, `repo`, `date` | Unique visitors per day |

### Clones

| Metric | Labels | Description |
|---|---|---|
| `github_repo_clones_total` | `owner`, `repo` | Rolling 14-day total clones |
| `github_repo_clones_unique` | `owner`, `repo` | Rolling 14-day unique cloners |
| `github_repo_clones_weekly_total` | `owner`, `repo`, `week` | Total clones for the last full week (Mon-Sun) |
| `github_repo_clones_weekly_unique` | `owner`, `repo`, `week` | Unique cloners for the last full week (Mon-Sun) |
| `github_repo_clones_daily_total` | `owner`, `repo`, `date` | Total clones per day |
| `github_repo_clones_daily_unique` | `owner`, `repo`, `date` | Unique cloners per day |

### Referrers and Popular Paths

| Metric | Labels | Description |
|---|---|---|
| `github_repo_referrer_views_total` | `owner`, `repo`, `referrer` | Total views from a referral source (14-day) |
| `github_repo_referrer_views_unique` | `owner`, `repo`, `referrer` | Unique visitors from a referral source (14-day) |
| `github_repo_popular_path_views_total` | `owner`, `repo`, `path` | Total views for a content path (14-day) |
| `github_repo_popular_path_views_unique` | `owner`, `repo`, `path` | Unique visitors for a content path (14-day) |

### Collector Health

| Metric | Labels | Description |
|---|---|---|
| `github_views_collector_last_run_timestamp_seconds` | -- | Unix timestamp of the last collection run |
| `github_views_collector_duration_seconds` | -- | Duration of the last collection run |
| `github_views_collector_errors_total` | -- | Number of per-repo errors in the last collection run |

Default Node.js process metrics (memory, CPU, event loop) are also exposed.

## Quick Start

### Prerequisites

- Node.js >= 18
- A GitHub personal access token with `repo` scope (needed for traffic API access)
- Write access to the repositories you want to monitor (GitHub requires this for traffic data)

### Setup

```bash
# Install dependencies
npm install

# Copy and fill in configuration
cp .env.example .env
# Edit .env with your GitHub token and repository list

# Build and run
npm run build
npm start
```

Verify it works:

```bash
curl http://localhost:9091/metrics
curl http://localhost:9091/health
```

## Configuration

All configuration is via environment variables. A `.env` file is supported for local development.

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | Yes | -- | GitHub personal access token with `repo` scope |
| `GITHUB_REPOS` | Yes | -- | Comma-separated list of repositories (`owner/repo`) |
| `CRON_SCHEDULE` | No | `0 */6 * * *` | Cron expression for the collection schedule |
| `METRICS_PORT` | No | `9091` | Port for the HTTP `/metrics` endpoint |
| `GITHUB_API_URL` | No | `https://api.github.com` | GitHub API base URL (for GitHub Enterprise) |

### Example `.env`

```env
GITHUB_TOKEN=ghp_abc123
GITHUB_REPOS=my-org/backend,my-org/frontend,my-user/side-project
CRON_SCHEDULE=0 */6 * * *
METRICS_PORT=9091
```

### Cron Schedule Examples

| Expression | Frequency |
|---|---|
| `0 */6 * * *` | Every 6 hours (default) |
| `0 */3 * * *` | Every 3 hours |
| `0 0 * * *` | Once daily at midnight |
| `*/30 * * * *` | Every 30 minutes |

The schedule uses the container/process timezone. GitHub traffic timestamps are always UTC.

## Docker

### Build and Run

```bash
docker build -t github-views-collector .

docker run -d \
  --name github-views-collector \
  -p 9091:9091 \
  -e GITHUB_TOKEN=ghp_abc123 \
  -e GITHUB_REPOS=owner/repo1,owner/repo2 \
  github-views-collector
```

### Docker Compose

```yaml
services:
  github-views-collector:
    build: .
    restart: unless-stopped
    ports:
      - "9091:9091"
    environment:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      GITHUB_REPOS: owner/repo1,owner/repo2
      CRON_SCHEDULE: "0 */6 * * *"
```

## Prometheus Configuration

Add a scrape target to your existing Prometheus configuration:

```yaml
scrape_configs:
  - job_name: "github-views-collector"
    scrape_interval: 5m
    static_configs:
      - targets: ["<collector-host>:9091"]
```

A 5-minute scrape interval is recommended. The underlying data only changes every few hours at most, so scraping more frequently provides no benefit.

## Grafana Dashboard Examples

### Big Number: 14-Day Unique Visitors

```promql
github_repo_views_unique{owner="my-org", repo="my-repo"}
```

### Weekly Unique Visitors Over Time

```promql
github_repo_views_weekly_unique{owner="my-org", repo="my-repo"}
```

This gives you one data point per week (the full Mon-Sun unique count), building a clean week-over-week trend as Prometheus accumulates historical scrapes.

### Daily Views Time Series

```promql
github_repo_views_daily_total{owner="my-org", repo="my-repo"}
```

Use a table or time series panel with the `date` label for a 14-day breakdown.

### Top Referrers Table

```promql
sort_desc(github_repo_referrer_views_total{owner="my-org", repo="my-repo"})
```

### Total Views Across All Repos

```promql
sum(github_repo_views_total)
```

### Collector Health

```promql
# Time since last successful collection (in minutes)
(time() - github_views_collector_last_run_timestamp_seconds) / 60

# Alert if collection has errors
github_views_collector_errors_total > 0
```

## GitHub API Rate Limits

With authenticated requests, GitHub allows 5,000 requests per hour. Each collection run uses 6 API calls per repository, so:

| Repos | Calls per Run | Runs per Hour (every 6h) | Hourly Usage |
|---|---|---|---|
| 1 | 6 | ~0.17 | ~1 |
| 10 | 60 | ~0.17 | ~10 |
| 50 | 300 | ~0.17 | ~50 |
| 100 | 600 | ~0.17 | ~100 |

The collector logs a warning when the remaining rate limit drops below 100 requests and provides detailed error messages on rate limit exhaustion.

## Error Handling

- **Per-repo isolation**: If one repository fails (e.g., 404, revoked access), the collector logs the error and continues to the next repository. One bad repo does not prevent data collection for the others.
- **Atomic gauge updates**: All repositories are collected first, then all Prometheus gauges are reset and re-set in a single pass. This prevents stale labels from accumulating and minimizes the window where Prometheus could scrape partial data.
- **Graceful shutdown**: The service handles `SIGINT` and `SIGTERM` signals, cleanly stopping the cron scheduler and HTTP server. This ensures proper behavior in Docker and Kubernetes environments.
- **Startup resilience**: If the initial collection fails, the service continues running and retries on the next scheduled run.

## Project Structure

```
src/
  index.ts        Entry point: config, metrics server, scheduler, shutdown
  config.ts       Environment variable parsing and validation
  github.ts       GitHub Traffic API client with typed responses
  metrics.ts      Prometheus gauge definitions and HTTP /metrics server
  collector.ts    Orchestrator: fetches all repos, atomically updates gauges
.env.example      Template for required environment variables
Dockerfile        Multi-stage build (compile TS, run JS on node:20-alpine)
```

## Requirements

- **Node.js >= 18** (uses native `fetch`)
- **GitHub token scope**: `repo` (full repository access) -- required by GitHub to read traffic data, even for public repositories
- **Repository access**: You must have write/admin access to each repository to view its traffic data

## License

Private.
