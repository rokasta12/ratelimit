/**
 * @jf/ratelimit - Framework-agnostic rate limiting library
 *
 * @module
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Rate limit information for a single request
 */
export type RateLimitInfo = {
  /** Maximum requests allowed in window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** Unix timestamp (ms) when window resets */
  reset: number;
};

/**
 * Result from store increment operation
 */
export type StoreResult = {
  /** Current request count in window */
  count: number;
  /** When the window resets (Unix timestamp ms) */
  reset: number;
};

/**
 * Rate limit algorithm
 */
export type Algorithm = "fixed-window" | "sliding-window";

/**
 * Store interface for rate limit state.
 *
 * Implement this interface to create custom storage backends.
 * The store is responsible for tracking request counts per key.
 */
export type RateLimitStore = {
  /**
   * Initialize store. Called once before first use.
   * @param windowMs - Window duration in milliseconds
   */
  init?: (windowMs: number) => void | Promise<void>;

  /**
   * Increment counter for key and return current state.
   * This is the main operation - it should atomically increment and return.
   * @param key - Unique identifier for the rate limit bucket
   */
  increment: (key: string) => StoreResult | Promise<StoreResult>;

  /**
   * Decrement counter for key.
   * Used for skip options (skipSuccessfulRequests, skipFailedRequests).
   * @param key - Unique identifier for the rate limit bucket
   */
  decrement?: (key: string) => void | Promise<void>;

  /**
   * Reset a specific key.
   * @param key - Unique identifier to reset
   */
  resetKey: (key: string) => void | Promise<void>;

  /**
   * Reset all keys.
   */
  resetAll?: () => void | Promise<void>;

  /**
   * Get current state for key.
   * Returns undefined if key doesn't exist or has expired.
   * Required for sliding window algorithm.
   * @param key - Unique identifier for the rate limit bucket
   */
  get?: (
    key: string,
  ) => Promise<StoreResult | undefined> | StoreResult | undefined;

  /**
   * Graceful shutdown.
   * Clean up timers, connections, etc.
   */
  shutdown?: () => void | Promise<void>;
};

/**
 * Options for checkRateLimit function
 */
export type CheckRateLimitOptions = {
  /** Storage backend for rate limit state */
  store: RateLimitStore;
  /** Unique identifier for the client/request */
  key: string;
  /** Maximum requests allowed in window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Rate limiting algorithm (default: 'sliding-window') */
  algorithm?: Algorithm;
};

/**
 * Result from checkRateLimit function
 */
export type CheckRateLimitResult = {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Rate limit information */
  info: RateLimitInfo;
};

// ============================================================================
// Memory Store
// ============================================================================

type MemoryEntry = {
  count: number;
  reset: number;
};

/**
 * In-memory store for rate limiting.
 *
 * Features:
 * - Zero dependencies
 * - Automatic cleanup of expired entries
 * - Suitable for single-instance deployments
 *
 * @example
 * ```ts
 * import { MemoryStore, checkRateLimit } from '@jf/ratelimit'
 *
 * const store = new MemoryStore()
 * store.init(60_000) // 1 minute window
 *
 * const result = await checkRateLimit({
 *   store,
 *   key: 'user:123',
 *   limit: 100,
 *   windowMs: 60_000,
 * })
 * ```
 */
export class MemoryStore implements RateLimitStore {
  private entries = new Map<string, MemoryEntry>();
  private windowMs = 60_000;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /**
   * Initialize the store with window duration.
   * Sets up automatic cleanup of expired entries.
   */
  init(windowMs: number): void {
    this.windowMs = windowMs;

    // Cleanup expired entries at a reasonable interval based on windowMs
    // Use the larger of windowMs or 60 seconds (don't clean up too frequently)
    // But cap at 5 minutes to ensure timely cleanup for long windows
    const cleanupInterval = Math.min(Math.max(windowMs, 60_000), 300_000);

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.entries) {
        if (entry.reset <= now) {
          this.entries.delete(key);
        }
      }
    }, cleanupInterval);

    // Don't keep process alive for cleanup
    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Increment counter and return current state.
   */
  increment(key: string): StoreResult {
    const now = Date.now();
    const existing = this.entries.get(key);

    if (!existing || existing.reset <= now) {
      // New window
      const reset = now + this.windowMs;
      this.entries.set(key, { count: 1, reset });
      return { count: 1, reset };
    }

    // Increment existing
    existing.count++;
    return { count: existing.count, reset: existing.reset };
  }

  /**
   * Get current state for key.
   */
  get(key: string): StoreResult | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.reset <= Date.now()) {
      return undefined;
    }
    return { count: entry.count, reset: entry.reset };
  }

  /**
   * Decrement counter for key.
   */
  decrement(key: string): void {
    const entry = this.entries.get(key);
    if (entry && entry.count > 0) {
      entry.count--;
    }
  }

  /**
   * Reset a specific key.
   */
  resetKey(key: string): void {
    this.entries.delete(key);
  }

  /**
   * Reset all keys.
   */
  resetAll(): void {
    this.entries.clear();
  }

  /**
   * Graceful shutdown - clean up timers.
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.entries.clear();
  }
}

// ============================================================================
// Sliding Window Algorithm
// ============================================================================

// Track if we've warned about sliding window degradation
let slidingWindowWarned = false;

/**
 * Check rate limit using the sliding window algorithm.
 *
 * This implements Cloudflare's sliding window approach which provides
 * smoother rate limiting by weighting the previous window's count
 * based on how far we are into the current window.
 *
 * Formula: estimatedCount = floor(previousCount * weight) + currentCount
 * Where weight = (windowMs - elapsedMs) / windowMs
 *
 * @internal
 */
async function checkSlidingWindow(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
): Promise<CheckRateLimitResult> {
  const now = Date.now();
  const currentWindowStart = Math.floor(now / windowMs) * windowMs;
  const previousWindowStart = currentWindowStart - windowMs;

  const previousKey = `${key}:${previousWindowStart}`;
  const currentKey = `${key}:${currentWindowStart}`;

  // Increment current window
  const current = await store.increment(currentKey);

  // Get previous window (may not exist)
  let previousCount = 0;
  if (store.get) {
    const prev = await store.get(previousKey);
    previousCount = prev?.count ?? 0;
  } else if (!slidingWindowWarned) {
    // Warn once that sliding window is degraded to fixed window
    slidingWindowWarned = true;
    console.warn(
      "[@jf/ratelimit] Store does not implement get() method. " +
        "Sliding window algorithm will behave like fixed window. " +
        "Consider using a store with get() support or switch to 'fixed-window' algorithm.",
    );
  }

  // Cloudflare's weighted formula
  const elapsedMs = now - currentWindowStart;
  const weight = (windowMs - elapsedMs) / windowMs;
  const estimatedCount = Math.floor(previousCount * weight) + current.count;

  const remaining = Math.max(0, limit - estimatedCount);
  const allowed = estimatedCount <= limit;
  const reset = currentWindowStart + windowMs;

  return {
    allowed,
    info: { limit, remaining, reset },
  };
}

// ============================================================================
// Fixed Window Algorithm
// ============================================================================

/**
 * Check rate limit using the fixed window algorithm.
 *
 * Simple counter that resets at fixed time boundaries.
 * Windows are aligned to epoch time (e.g., every minute at :00).
 *
 * Note: This algorithm has a burst vulnerability at window boundaries
 * where a client could make 2x the limit in a short period.
 * Use sliding-window for better protection.
 *
 * @internal
 */
async function checkFixedWindow(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
): Promise<CheckRateLimitResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowKey = `${key}:${windowStart}`;

  const { count, reset } = await store.increment(windowKey);

  const remaining = Math.max(0, limit - count);
  const allowed = count <= limit;

  return {
    allowed,
    info: { limit, remaining, reset },
  };
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Check if a request should be rate limited.
 *
 * This is the core function of the library - it's framework-agnostic and
 * can be used with any HTTP framework or standalone.
 *
 * @param options - Rate limit check options
 * @returns Whether the request is allowed and rate limit info
 *
 * @example
 * ```ts
 * import { checkRateLimit, MemoryStore } from '@jf/ratelimit'
 *
 * const store = new MemoryStore()
 * store.init(60_000)
 *
 * // In your request handler:
 * const result = await checkRateLimit({
 *   store,
 *   key: getClientIP(request),
 *   limit: 100,
 *   windowMs: 60_000,
 * })
 *
 * if (!result.allowed) {
 *   return new Response('Too Many Requests', { status: 429 })
 * }
 * ```
 */
export async function checkRateLimit(
  options: CheckRateLimitOptions,
): Promise<CheckRateLimitResult> {
  const { store, key, limit, windowMs, algorithm = "sliding-window" } = options;

  // Validate
  if (limit <= 0) {
    throw new Error(
      "[@jf/ratelimit] limit must be a positive number, got: " + limit,
    );
  }
  if (windowMs <= 0) {
    throw new Error(
      "[@jf/ratelimit] windowMs must be a positive number, got: " + windowMs,
    );
  }

  if (algorithm === "sliding-window") {
    return checkSlidingWindow(store, key, limit, windowMs);
  }
  return checkFixedWindow(store, key, limit, windowMs);
}

/**
 * Create a rate limiter instance with pre-configured options.
 *
 * This is useful when you want to reuse the same configuration
 * across multiple rate limit checks.
 *
 * @param config - Default configuration
 * @returns A function that checks rate limits with the pre-configured options
 *
 * @example
 * ```ts
 * import { createRateLimiter, MemoryStore } from '@jf/ratelimit'
 *
 * const store = new MemoryStore()
 * store.init(60_000)
 *
 * const limiter = createRateLimiter({
 *   store,
 *   limit: 100,
 *   windowMs: 60_000,
 * })
 *
 * // Later, just pass the key:
 * const result = await limiter('user:123')
 * ```
 */
export function createRateLimiter(
  config: Omit<CheckRateLimitOptions, "key">,
): (key: string) => Promise<CheckRateLimitResult> {
  return (key: string) => checkRateLimit({ ...config, key });
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Reset the sliding window warning flag.
 * Useful for testing.
 * @internal
 */
export function resetSlidingWindowWarning(): void {
  slidingWindowWarned = false;
}
