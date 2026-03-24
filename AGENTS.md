# AGENTS.md

Guidelines for AI coding agents working in this repository.

## Project Overview

A single long-running Node.js service that collects GitHub Traffic API data
(views, clones, referrers) and exposes it as Prometheus metrics. Architecture
flow: `index.ts` -> `config.ts` + `metrics.ts` + `collector.ts` -> `github.ts`.

Runtime: Node.js >= 18 (uses native `fetch`). Module system: CommonJS.

## Build / Run Commands

```bash
npm run build          # Compile TypeScript with tsc (output in dist/)
npm run start          # Run compiled app: node dist/index.js
npm run dev            # Build then run (tsc && node dist/index.js)
```

There is no test framework, linter, or formatter configured. The TypeScript
compiler (`tsc`) with `strict: true` is the primary correctness check. Always
run `npm run build` after making changes and fix any errors before finishing.

## Project Structure

```
src/
  index.ts       Entry point: config loading, metrics server, cron scheduling, shutdown
  config.ts      Environment variable parsing/validation, Config and RepoConfig types
  github.ts      GitHub Traffic API client class, response type definitions
  metrics.ts     Prometheus gauge definitions, registry, HTTP server (/metrics, /health)
  collector.ts   Orchestrator: fetches repos sequentially, updates gauges atomically
```

Files are single-word lowercase (`config.ts`, not `configLoader.ts`). Types live
alongside the code that uses them -- there are no separate type-only files.

## Code Style

### Formatting

- 2-space indentation, no tabs
- Semicolons always
- Double quotes everywhere (imports, strings)
- Trailing commas on the last element of multi-line objects/arrays
- Lines under ~110 characters
- No prettier, eslint, or editorconfig is configured -- follow existing patterns

### Imports

- Named imports for specific items: `import { Registry, Gauge } from "prom-client";`
- Namespace imports when using many members: `import * as metrics from "./metrics";`
- Side-effect imports where needed: `import "dotenv/config";`
- Use `node:` prefix for Node.js builtins: `import * as http from "node:http";`
- No default exports or imports -- use named exports exclusively
- Third-party imports first, then local imports

### TypeScript

- Strict mode is enabled (`"strict": true` in tsconfig.json)
- Use `interface`, not `type` aliases, for object shapes
- No `I` prefix on interfaces (`RepoConfig`, not `IRepoConfig`)
- Export types inline at declaration: `export interface Config { ... }`
- Explicitly annotate return types on all functions (public and private)
- Arrow function callback parameters may rely on type inference
- Use `as const` for literal arrays: `labelNames: ["owner", "repo"] as const`
- Use `private readonly` for class fields that don't change
- Use generics for typed API calls: `request<T>(path: string): Promise<T>`
- Use string literal unions for constrained params: `per: "day" | "week"`

### Naming

| Kind              | Convention   | Example                          |
|-------------------|--------------|----------------------------------|
| Variables         | camelCase    | `errorCount`, `rateLimitReset`   |
| Functions         | camelCase    | `loadConfig`, `updateGauges`     |
| Classes           | PascalCase   | `GitHubClient`                   |
| Interfaces        | PascalCase   | `RepoConfig`, `TrafficResponse`  |
| Constants         | camelCase    | `registry`, `viewsTotal`         |
| Files             | lowercase    | `config.ts`, `collector.ts`      |
| Prometheus names  | snake_case   | `github_repo_views_total`        |
| Prometheus labels | lowercase    | `owner`, `repo`, `date`          |

Prometheus metric naming pattern:
- Repo metrics: `github_repo_<category>_[aggregation]_<type>` (e.g., `github_repo_views_weekly_unique`)
- Collector health: `github_views_collector_<metric>` (e.g., `github_views_collector_duration_seconds`)

### Comments

- JSDoc (`/** ... */`) on functions -- plain prose, no `@param`/`@returns` tags
- Section dividers with dashes: `// --- Views ---`
- Inline `//` comments for intent and non-obvious logic
- Interfaces and type fields are self-documenting, no comments needed

## Error Handling

- Throw `new Error("descriptive message")` for failures -- no custom error classes
- Use `err instanceof Error ? err.message : err` when logging caught errors
- Isolate per-item failures: if one repo fails, continue to the next
- Track error counts and expose via Prometheus (`collectionErrors` gauge)
- Never silently swallow errors -- always log with `console.error`
- Fatal startup errors call `process.exit(1)` in `main()`

## Logging

Use `console.log`, `console.warn`, and `console.error` with a bracketed module
prefix:

```typescript
console.log("[collector] Starting collection");
console.warn("[github] Rate limit low: 42 requests remaining");
console.error("[main] Fatal error:", err instanceof Error ? err.message : err);
```

No structured logging library. No timestamps in output (Docker adds them).

## Async Patterns

- Use `async`/`await` exclusively -- no `.then()/.catch()` chains
- Use `Promise.all` for parallel independent calls (e.g., API calls for a repo)
- Process repos sequentially in a `for...of` loop to avoid API rate limit issues
- Wrap callback APIs in `new Promise()` only when necessary (e.g., `server.close`)
- All async functions must have explicit `Promise<T>` return types

## Configuration

All config comes from environment variables, loaded via `dotenv` in `index.ts`.
The `loadConfig()` function in `config.ts` validates eagerly and fails fast with
descriptive error messages. Config is returned as a typed `Config` object and
passed as a parameter -- never re-read from `process.env` after initial load.

Required variables: `GITHUB_TOKEN`, `GITHUB_REPOS`
Optional: `CRON_SCHEDULE` (default `"0 */6 * * *"`), `METRICS_PORT` (default
`9091`), `GITHUB_API_URL` (default `"https://api.github.com"`)

## Prometheus Metrics

Most metrics are prom-client Gauges registered on a dedicated `Registry` instance
(not the global default). Daily metrics use a custom `TimestampedGauge` class
that attaches a Prometheus-format timestamp to each sample instead of encoding
the date as a label. Default Node.js process metrics are also collected. The HTTP
server exposes two endpoints: `GET /metrics` and `GET /health`.

When adding new metrics:
1. Define the Gauge in `metrics.ts` with `registers: [registry]`
   - For timestamped metrics, use `TimestampedGauge` and add it to `timestampedGauges`
2. Reset it in `updateGauges()` in `collector.ts` before setting values
3. Set values in the same function after the reset block
4. Update the metrics table in `README.md`

## Key Patterns

- **Atomic gauge updates**: Reset all gauges first, then set all values, to
  prevent stale labels from accumulating
- **Fail-fast config validation**: All environment variables are validated at
  startup; invalid config terminates the process immediately
- **Graceful shutdown**: SIGTERM/SIGINT handlers stop the cron job and metrics
  server before exiting
