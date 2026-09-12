// src/db/client.ts — the database type both targets hand to the app layer.
// Drizzle is the persistence abstraction (DECISIONS D-005). Both drivers expose the same
// query builder and `batch()`; `transaction()` is banned by lint (D-006).
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

export type Schema = typeof schema;
export type Db = BaseSQLiteDatabase<'async', unknown, Schema>;
