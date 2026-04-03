/**
 * Simple per-domain token bucket rate limiter.
 * Queues async tasks and ensures at most `rate` tasks per second per domain.
 */

interface QueueEntry {
  fn: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

const queues = new Map<string, QueueEntry[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const INTERVAL_MS = 1100 // slightly over 1s to stay comfortably under 1 req/sec

function processNext(domain: string): void {
  const queue = queues.get(domain)
  if (!queue || queue.length === 0) {
    timers.delete(domain)
    return
  }
  const entry = queue.shift()!
  entry
    .fn()
    .then(entry.resolve)
    .catch(entry.reject)
    .finally(() => {
      timers.set(domain, setTimeout(() => processNext(domain), INTERVAL_MS))
    })
}

/**
 * Schedule `fn` to run after any previously queued calls for `domain`.
 * Returns a Promise that resolves with fn's return value.
 */
export function rateLimited<T>(domain: string, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!queues.has(domain)) queues.set(domain, [])
    queues.get(domain)!.push({ fn: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject })

    // Start processing if not already running
    if (!timers.has(domain)) {
      processNext(domain)
    }
  })
}

/** Reset all queues (useful for testing or when user cancels) */
export function resetAllQueues(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  queues.clear()
  timers.clear()
}
