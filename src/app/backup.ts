// Backup / restore / verify. Format is target-agnostic on purpose (DECISIONS: data lock-in retired):
//   backup.zip
//     manifest.json      { version, generatedAt, tables: { name: rows }, evidence: [{ key, sha256, size }], checksums: { table: sha256 } }
//     dump.sql           one INSERT per row, all tables, ordered by primary key; applied by either target
//     evidence/<key>     every object under evidence/
// Verify recomputes per-table row counts and checksums (sha256 over canonical JSON of rows ordered by
// primary key) and re-hashes every evidence object from storage. D1 row ordering is neutralised by the ORDER BY.
import { getTableColumns, getTableName, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as s from '../db/schema';
import type { AppContext } from './context';
import { sha256Hex } from './evidence';

/** Restore order respects foreign keys (parents first). */
export const TABLES: SQLiteTable[] = [
  s.settings,
  s.bodies,
  s.certifications,
  s.ruleVersions,
  s.certRequirements,
  s.creditCategories,
  s.creditingRules,
  s.constraints,
  s.certRelations,
  s.memberships,
  s.heldCertifications,
  s.cycles,
  s.activities,
  s.creditApplications,
  s.evidence,
  s.activityEvidence,
  s.payments,
  s.renewals,
  s.jobs,
  s.notifications,
  s.exports_,
  s.importBatches,
  s.cycleRuleChanges,
  s.sessions,
  s.healthPings,
];
const PK: Record<string, string[]> = {
  activity_evidence: ['activity_id', 'evidence_id'],
  settings: ['key'],
};

export interface Manifest {
  version: 1;
  generatedAt: string;
  target: string;
  tables: Record<string, number>;
  checksums: Record<string, string>;
  evidence: { key: string; sha256: string; size: number }[];
}

type Row = Record<string, unknown>;

async function readTable(
  ctx: AppContext,
  t: SQLiteTable,
): Promise<{ name: string; columns: string[]; rows: Row[] }> {
  const name = getTableName(t);
  const columns = Object.values(getTableColumns(t)).map((c) => c.name);
  const order = (PK[name] ?? ['id']).map((c) => `"${c}"`).join(', ');
  const rows = (await ctx.db.all(
    sql.raw(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${name}" ORDER BY ${order}`),
  )) as Row[];
  return { name, columns, rows };
}

const canonical = (rows: Row[], columns: string[]) =>
  JSON.stringify(rows.map((r) => columns.map((c) => normalize(r[c]))));
function normalize(v: unknown): unknown {
  if (v instanceof Uint8Array || v instanceof ArrayBuffer)
    return { bytes: Array.from(new Uint8Array(v as ArrayBuffer)) };
  if (typeof v === 'bigint') return Number(v);
  return v;
}
const lit = (v: unknown): string => {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
};

export async function snapshot(
  ctx: AppContext,
  target: string,
): Promise<{ manifest: Manifest; dump: string }> {
  const manifest: Manifest = {
    version: 1,
    generatedAt: ctx.clock.now().toISOString(),
    target,
    tables: {},
    checksums: {},
    evidence: [],
  };
  const lines: string[] = [
    '-- CPE PCT backup. Apply into an EMPTY database that already has the schema (migrations applied).',
  ];
  for (const t of TABLES) {
    const { name, columns, rows } = await readTable(ctx, t);
    if (name === 'sessions' || name === 'health_pings') continue; // never carry sessions; pings are noise
    manifest.tables[name] = rows.length;
    manifest.checksums[name] = await sha256Hex(new TextEncoder().encode(canonical(rows, columns)));
    for (const r of rows)
      lines.push(
        `INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map((c) => lit(r[c])).join(', ')});`,
      );
  }
  for await (const o of ctx.objectStore.list('evidence/')) {
    const obj = await ctx.objectStore.get(o.key);
    if (!obj) continue;
    const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
    manifest.evidence.push({ key: o.key, sha256: await sha256Hex(bytes), size: bytes.byteLength });
  }
  manifest.evidence.sort((a, b) => a.key.localeCompare(b.key));
  return { manifest, dump: lines.join('\n') + '\n' };
}

export async function isEmpty(ctx: AppContext): Promise<boolean> {
  for (const t of [s.heldCertifications, s.activities, s.evidence, s.settings]) {
    const [r] = (await ctx.db.all(sql.raw(`SELECT COUNT(*) AS n FROM "${getTableName(t)}"`))) as {
      n: number;
    }[];
    if ((r?.n ?? 0) > 0) return false;
  }
  return true;
}

/** Wipes user data (not the catalog seeds, which are re-inserted by the dump with ON CONFLICT-free INSERTs — so wipe them too). */
export async function wipe(ctx: AppContext): Promise<void> {
  for (const t of [...TABLES].reverse())
    await ctx.db.run(sql.raw(`DELETE FROM "${getTableName(t)}"`));
  for await (const o of ctx.objectStore.list('evidence/')) await ctx.objectStore.delete(o.key);
  for await (const o of ctx.objectStore.list('exports/')) await ctx.objectStore.delete(o.key);
}

/** Applies the dump statements in chunks. Statements are one per line by construction. */
export async function applyDump(ctx: AppContext, dump: string): Promise<number> {
  const stmts = dump.split('\n').filter((l) => l.startsWith('INSERT INTO'));
  let n = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const chunk = stmts.slice(i, i + 50).map((q) => ctx.db.run(sql.raw(q)));
    await ctx.db.batch(chunk as [(typeof chunk)[number], ...typeof chunk]);
    n += chunk.length;
  }
  return n;
}

export interface Diff {
  table?: string;
  key?: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

/** Compares a stored manifest with the live instance. Zero diffs = verified restore. */
export function diffManifests(expected: Manifest, actual: Manifest): Diff[] {
  const out: Diff[] = [];
  for (const [t, n] of Object.entries(expected.tables)) {
    if (actual.tables[t] !== n)
      out.push({ table: t, field: 'rows', expected: n, actual: actual.tables[t] ?? 0 });
    else if (actual.checksums[t] !== expected.checksums[t])
      out.push({
        table: t,
        field: 'checksum',
        expected: expected.checksums[t],
        actual: actual.checksums[t],
      });
  }
  const act = new Map(actual.evidence.map((e) => [e.key, e]));
  for (const e of expected.evidence) {
    const a = act.get(e.key);
    if (!a) out.push({ key: e.key, field: 'evidence', expected: 'present', actual: 'missing' });
    else if (a.sha256 !== e.sha256)
      out.push({ key: e.key, field: 'sha256', expected: e.sha256, actual: a.sha256 });
  }
  if (actual.evidence.length !== expected.evidence.length)
    out.push({
      field: 'evidence_count',
      expected: expected.evidence.length,
      actual: actual.evidence.length,
    });
  return out;
}
