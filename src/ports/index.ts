// src/ports/index.ts — port interfaces. Types only.
// Nothing here imports from adapters, @cloudflare/*, node:*, or drizzle-orm.
// Persistence is deliberately NOT a port: Drizzle over the SQLite dialect is the abstraction.
// Contract for parity: NEVER db.transaction(); ALWAYS db.batch([...]).

// ── Files ────────────────────────────────────────────────────────────
export interface ObjectStore {
  put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    meta: { contentType: string; size?: number },
  ): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<Omit<StoredObject, 'body'> | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): AsyncIterable<{ key: string; size: number }>;
}
export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  size: number;
}

// ── Intake ───────────────────────────────────────────────────────────
export interface TextExtractor {
  supports(contentType: string): boolean;
  extract(bytes: Uint8Array, contentType: string, budget: CpuBudget): Promise<Extraction>;
}
export type Extraction =
  | { ok: true; text: string; method: 'pdf-text' | 'plain' }
  | {
      ok: false;
      reason: 'unsupported' | 'no-text-layer' | 'budget-exceeded' | 'error';
      detail?: string;
    };
export interface CpuBudget {
  maxPages: number;
  deadlineMs: number;
}

/** Seam only, with no implementation: image evidence degrades to manual entry on both targets. */
export interface ImageOcr {
  recognize(bytes: Uint8Array, contentType: string): Promise<Extraction>;
}

// ── Background work ──────────────────────────────────────────────────
export type JobType = 'extract_text' | 'renewal_scan' | 'build_export' | 'verify_backup';
export interface JobPayload {
  extract_text: { evidenceId: string };
  renewal_scan: { asOf: string };
  build_export: { exportId: string };
  verify_backup: { manifestKey: string };
}
export interface JobQueue {
  enqueue<T extends JobType>(
    type: T,
    payload: JobPayload[T],
    opts?: { runAt?: Date; idempotencyKey?: string; cron?: string },
  ): Promise<string>;
}
/** The only per-target difference in background work: who calls the runner, and how much it may do per call. */
export interface TickSource {
  start(run: (budget: TickBudget) => Promise<void>): void;
}
export interface TickBudget {
  maxJobs: number;
  softDeadlineMs: number;
}

// ── Auth ─────────────────────────────────────────────────────────────
export interface Principal {
  id: 'owner';
  via: 'local' | 'cf-access' | 'trusted-header' | 'demo';
}
export interface Authenticator {
  authenticate(req: Request): Promise<Principal | null>;
  /** Whether the app should mount /login and /logout routes for this adapter. */
  routes: 'local' | 'none';
}

// ── Outbound ─────────────────────────────────────────────────────────
export type NotificationKind =
  'cycle_ending' | 'annual_floor_at_risk' | 'fee_due' | 'fee_overdue' | 'export_ready';
export interface Notification {
  /** Idempotency key: `${cycleId}:${kind}:${bucket}` */
  key: string;
  kind: NotificationKind;
  title: string;
  body: string;
  severity: 'info' | 'warn' | 'urgent';
}
export interface Notifier {
  send(n: Notification): Promise<{ ok: boolean; detail?: string }>;
}

// ── Small ones ───────────────────────────────────────────────────────
export interface Clock {
  now(): Date;
}
