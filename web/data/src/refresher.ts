// Per-target read coalescing. At most one read per key runs at a time; a request while a
// read is already on the wire schedules exactly one more read afterwards (the running read
// may predate the change that triggered the request). A request while the read is still
// queued, not yet sent, merges into it.
export type ReadFn = (key: string, onSent: () => void) => Promise<void>;

interface Job {
  sent: boolean;
  rerun: boolean;
  done: Promise<void>;
}

export class Refresher {
  private jobs = new Map<string, Job>();
  constructor(private readonly read: ReadFn) {}

  request(key: string): Promise<void> {
    const existing = this.jobs.get(key);
    if (existing) {
      if (existing.sent) existing.rerun = true;
      return existing.done;
    }
    const job: Job = { sent: false, rerun: false, done: Promise.resolve() };
    this.jobs.set(key, job);
    job.done = (async () => {
      try {
        do {
          job.sent = false;
          job.rerun = false;
          await this.read(key, () => (job.sent = true));
        } while (job.rerun);
      } finally {
        this.jobs.delete(key);
      }
    })();
    return job.done;
  }

  /** Keys with a read queued or running (for tests and diagnostics). */
  get active(): number {
    return this.jobs.size;
  }
}
