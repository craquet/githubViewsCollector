export interface RepoConfig {
  owner: string;
  repo: string;
}

export interface Config {
  githubToken: string;
  githubApiUrl: string;
  repos: RepoConfig[];
  cronSchedule: string;
  metricsPort: number;
}

export function loadConfig(): Config {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  const githubRepos = process.env.GITHUB_REPOS;
  if (!githubRepos) {
    throw new Error("GITHUB_REPOS environment variable is required (comma-separated owner/repo list)");
  }

  const repos = githubRepos.split(",").map((entry) => {
    const trimmed = entry.trim();
    const parts = trimmed.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid repo format: "${trimmed}". Expected "owner/repo".`);
    }
    return { owner: parts[0], repo: parts[1] };
  });

  if (repos.length === 0) {
    throw new Error("GITHUB_REPOS must contain at least one repository");
  }

  const cronSchedule = process.env.CRON_SCHEDULE || "0 */6 * * *";

  const metricsPort = parseInt(process.env.METRICS_PORT || "9091", 10);
  if (isNaN(metricsPort) || metricsPort < 1 || metricsPort > 65535) {
    throw new Error(`Invalid METRICS_PORT: "${process.env.METRICS_PORT}". Must be a number between 1 and 65535.`);
  }

  const githubApiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");

  return {
    githubToken,
    githubApiUrl,
    repos,
    cronSchedule,
    metricsPort,
  };
}
