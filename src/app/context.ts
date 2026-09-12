import type { Db } from '../db/client';
import type {
  Authenticator,
  Clock,
  JobQueue,
  ObjectStore,
  Principal,
  TextExtractor,
} from '../ports';
import type { LocalAuth } from '../adapters/shared/local-auth';

export interface AppContext {
  db: Db;
  clock: Clock;
  auth: LocalAuth;
  objectStore: ObjectStore;
  textExtractor: TextExtractor;
  jobQueue: JobQueue;
  /**
   * Optional second authenticator. 'gate': must ALSO pass (Cloudflare Access in front of LocalAuth).
   * 'grant': its principal is sufficient on its own (trusted reverse-proxy header on self-hosted).
   */
  extraAuth?: { mode: 'gate' | 'grant'; authenticator: Authenticator } | undefined;
}

/** Evidence upload cap. Buffered in memory for hashing on both targets; keep it modest (VERIFY A2). */
export const EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
/** Inline extraction budget at upload; anything larger becomes an extract_text job. */
export const INLINE_BUDGET = { maxPages: 20, deadlineMs: 5_000 };
export const JOB_BUDGET = { maxPages: 200, deadlineMs: 25_000 };

export type Vars = { Variables: { ctx: AppContext; principal: Principal | null } };

export const today = (clock: Clock) => clock.now().toISOString().slice(0, 10);
export const newId = () => crypto.randomUUID();
