/**
 * Fixed-window rate limiter, in memory.
 *
 * Deliberately simple. A distributed limiter needs shared state, and RepoSignal
 * has no requirement that justifies adding Redis — on a single instance this is
 * exact, and across several it limits per instance, which is still a meaningful
 * bound on how fast one client can spend the GitHub rate limit.
 *
 * The tradeoff is written down rather than hidden, because someone scaling this
 * horizontally needs to know the guarantee weakens.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Sent as `Retry-After`. */
  retryAfterSeconds: number;
}

export class RateLimiter {
  #hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitResult {
    const currentTime = this.now();
    const entry = this.#hits.get(key);

    if (entry === undefined || currentTime >= entry.resetAt) {
      this.#hits.set(key, { count: 1, resetAt: currentTime + this.windowMs });
      this.#evictExpired(currentTime);
      return {
        allowed: true,
        remaining: this.limit - 1,
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
      };
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.resetAt - currentTime) / 1000),
    );

    if (entry.count >= this.limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    entry.count += 1;
    return {
      allowed: true,
      remaining: this.limit - entry.count,
      retryAfterSeconds,
    };
  }

  /** Keeps the map from growing without bound on a long-running process. */
  #evictExpired(currentTime: number): void {
    if (this.#hits.size < 1000) return;
    for (const [key, entry] of this.#hits) {
      if (currentTime >= entry.resetAt) this.#hits.delete(key);
    }
  }
}
