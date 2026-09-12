// src/db/schema.ts — Drizzle schema, single source of truth for both targets.
// Stage 0: only settings, jobs, health_pings. The full domain schema lands in Stage 1.
// Credits and fees are integers (hundredths / cents). Dates are ISO strings.
import { sqliteTable as t, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const settings = t('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const healthPings = t('health_pings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: text('at').notNull(),
});

export const jobs = t(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    idempotencyKey: text('idempotency_key'),
    runAt: text('run_at').notNull(),
    cron: text('cron'), // recurring jobs: next occurrence enqueued on completion
    leaseUntil: text('lease_until'),
    attempts: integer('attempts').notNull().default(0),
    status: text('status', { enum: ['queued', 'running', 'done', 'failed'] })
      .notNull()
      .default('queued'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
  },
  (x) => [index('jobs_due').on(x.status, x.runAt), uniqueIndex('jobs_idem').on(x.idempotencyKey)],
);
