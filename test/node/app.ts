// Builds a complete AppContext on in-memory libSQL + a temp FsObjectStore for node tests.
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/app';
import { openNodeDb } from '../../src/adapters/node/db';
import { FsObjectStore } from '../../src/adapters/node/fs-object-store';
import { DbJobQueue } from '../../src/adapters/shared/db-job-queue';
import { LocalAuth } from '../../src/adapters/shared/local-auth';
import { PdfTextExtractor } from '../../src/adapters/shared/pdf-text-extractor';
import type { AppContext } from '../../src/app/context';
import type { Clock } from '../../src/ports';

export async function testContext(clock: Clock = { now: () => new Date() }): Promise<AppContext> {
  const db = await openNodeDb(':memory:', { migrationsFolder: 'src/db/migrations' });
  return {
    db,
    clock,
    auth: new LocalAuth(db, clock),
    objectStore: new FsObjectStore(mkdtempSync(path.join(os.tmpdir(), 'cpe-test-'))),
    textExtractor: new PdfTextExtractor(),
    jobQueue: new DbJobQueue(db, clock),
  };
}
export async function testApp(clock?: Clock) {
  const ctx = await testContext(clock);
  return { ctx, app: createApp(ctx) };
}
