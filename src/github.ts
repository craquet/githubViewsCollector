import { RepoConfig } from "./config";

// --- Response types from the GitHub Traffic API ---

export interface TrafficEntry {
  timestamp: string;
  count: number;
  uniques: number;
}

export interface TrafficResponse {
  count: number;
  uniques: number;
  views?: TrafficEntry[];
  clones?: TrafficEntry[];
}

export interface ReferrerEntry {
  referrer: string;
  count: number;
  uniques: number;
}

// --- Collected data for a single repo ---

export interface RepoTrafficData {
  repo: RepoConfig;
  viewsDaily: TrafficResponse;
  viewsWeekly: TrafficResponse;
  clonesDaily: TrafficResponse;
  clonesWeekly: TrafficResponse;
  referrers: ReferrerEntry[];
}

// --- GitHub API client ---

export class GitHubClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (response.status === 403) {
      const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
      const rateLimitReset = response.headers.get("X-RateLimit-Reset");
      if (rateLimitRemaining === "0") {
        const resetDate = rateLimitReset
          ? new Date(parseInt(rateLimitReset, 10) * 1000).toISOString()
          : "unknown";
        throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate}`);
      }
      throw new Error(`GitHub API returned 403 Forbidden for ${path}`);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API error ${response.status} for ${path}: ${body}`);
    }

    const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
    if (rateLimitRemaining !== null) {
      const remaining = parseInt(rateLimitRemaining, 10);
      if (remaining < 100) {
        console.warn(`[github] Rate limit low: ${remaining} requests remaining`);
      }
    }

    return (await response.json()) as T;
  }

  async getViews(repo: RepoConfig, per: "day" | "week"): Promise<TrafficResponse> {
    return this.request<TrafficResponse>(
      `/repos/${repo.owner}/${repo.repo}/traffic/views?per=${per}`
    );
  }

  async getClones(repo: RepoConfig, per: "day" | "week"): Promise<TrafficResponse> {
    return this.request<TrafficResponse>(
      `/repos/${repo.owner}/${repo.repo}/traffic/clones?per=${per}`
    );
  }

  async getReferrers(repo: RepoConfig): Promise<ReferrerEntry[]> {
    return this.request<ReferrerEntry[]>(
      `/repos/${repo.owner}/${repo.repo}/traffic/popular/referrers`
    );
  }

  /**
   * Fetch all traffic data for a single repository.
   * Makes 5 API calls: views (daily + weekly), clones (daily + weekly), referrers.
   */
  async collectRepo(repo: RepoConfig): Promise<RepoTrafficData> {
    const [viewsDaily, viewsWeekly, clonesDaily, clonesWeekly, referrers] =
      await Promise.all([
        this.getViews(repo, "day"),
        this.getViews(repo, "week"),
        this.getClones(repo, "day"),
        this.getClones(repo, "week"),
        this.getReferrers(repo),
      ]);

    return {
      repo,
      viewsDaily,
      viewsWeekly,
      clonesDaily,
      clonesWeekly,
      referrers,
    };
  }
}
