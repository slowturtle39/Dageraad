/**
 * Time, behind an interface, so the referee loop is testable without waiting
 * forty real seconds per test — and so the host pause is a first-class concept
 * rather than something bolted on.
 */
export interface Clock {
  now(): number;
  /** Resolves after `ms` of UNPAUSED time. */
  sleep(ms: number): Promise<void>;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Deterministic clock for tests: nothing happens until `advance` is called.
 */
export class FakeClock implements Clock {
  private t = 0;
  private waiters: { at: number; resolve: () => void }[] = [];

  now(): number {
    return this.t;
  }

  sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push({ at: this.t + ms, resolve });
    });
  }

  /** Move time forward, releasing anything due. */
  async advance(ms: number): Promise<void> {
    this.t += ms;
    const due = this.waiters.filter((w) => w.at <= this.t);
    this.waiters = this.waiters.filter((w) => w.at > this.t);
    for (const w of due) w.resolve();
    // Let the woken continuations run before returning.
    await new Promise((r) => setImmediate(r));
  }

  get pending(): number {
    return this.waiters.length;
  }
}

/**
 * A clock that can be paused by the host for an absent player (§5.3).
 *
 * Pausing stops the countdown for EVERYONE at once, and it is triggered
 * manually and shown publicly. That is what keeps it leak-free: it is never
 * tied to hidden state, so nobody learns anything from the fact that time
 * stopped. Paused windows are excluded from timing telemetry, otherwise one
 * toilet break inflates every future window.
 */
export class PausableClock implements Clock {
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  /** True if a pause overlapped the window currently being timed. */
  private dirty = false;

  constructor(private readonly inner: Clock) {}

  now(): number {
    if (this.pausedAt !== null) return this.pausedAt - this.pausedTotal;
    return this.inner.now() - this.pausedTotal;
  }

  async sleep(ms: number): Promise<void> {
    const deadline = this.now() + ms;
    // Re-check rather than sleeping once: a pause during the wait extends it.
    for (;;) {
      const remaining = deadline - this.now();
      if (remaining <= 0) return;
      await this.inner.sleep(Math.min(remaining, 250));
    }
  }

  pause(): void {
    if (this.pausedAt === null) {
      this.pausedAt = this.inner.now();
      this.dirty = true;
    }
  }

  resume(): void {
    if (this.pausedAt !== null) {
      this.pausedTotal += this.inner.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }

  get isPaused(): boolean {
    return this.pausedAt !== null;
  }

  /** Whether a pause touched the window just timed — if so, discard its sample. */
  consumeDirty(): boolean {
    const was = this.dirty;
    this.dirty = false;
    return was;
  }
}
