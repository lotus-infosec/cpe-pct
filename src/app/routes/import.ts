import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import * as s from '../../db/schema';
import { newId, type Vars } from '../context';
import { ACTIVITY_TYPES } from '../../core/domain/activity-types';
import { inRange } from '../../core/cycles/dates';
import { heldCerts, allCycles } from '../rulesets';

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF/LF. Header row required. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim() !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

// Expected columns (case-insensitive): certification (catalog id, e.g. isc2/cissp) or held_cert_id;
// occurred_on; title; activity_type; minutes; item_count; credits (decimal); category; status; issuer_reference; provider.
const rowSchema = z.object({
  certification: z.string().optional(),
  held_cert_id: z.string().optional(),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  activity_type: z.enum(ACTIVITY_TYPES).default('other'),
  minutes: z.coerce.number().int().nonnegative().optional(),
  item_count: z.coerce.number().int().positive().optional(),
  credits: z.coerce.number().nonnegative(),
  category: z.string().optional(),
  status: z.enum(['claimed', 'submitted', 'accepted', 'rejected']).default('accepted'),
  issuer_reference: z.string().optional(),
  provider: z.string().optional(),
});

export const importRoute = new Hono<Vars>().post(
  '/',
  zValidator('json', z.object({ filename: z.string().max(200), csv: z.string().max(5_000_000) })),
  async (c) => {
    const { db, clock } = c.get('ctx');
    const { filename, csv } = c.req.valid('json');
    const records = parseCsv(csv);
    const held = await heldCerts(db);
    const cycles = await allCycles(db);
    const now = clock.now().toISOString();
    const errors: { row: number; error: string }[] = [];
    const activityRows: (typeof s.activities.$inferInsert)[] = [];
    const appRows: (typeof s.creditApplications.$inferInsert)[] = [];
    records.forEach((rec, i) => {
      const clean = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== ''));
      const parsed = rowSchema.safeParse(clean);
      if (!parsed.success) {
        errors.push({
          row: i + 2,
          error: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '),
        });
        return;
      }
      const r = parsed.data;
      const h = r.held_cert_id
        ? held.find((x) => x.id === r.held_cert_id)
        : held.find((x) => x.certificationId === r.certification);
      if (!h) {
        errors.push({
          row: i + 2,
          error: `no held certification for ${r.held_cert_id ?? r.certification}`,
        });
        return;
      }
      const cycle = cycles.find(
        (cy) => cy.heldCertId === h.id && inRange(r.occurred_on, cy.startsOn, cy.endsOn),
      );
      if (!cycle) {
        errors.push({
          row: i + 2,
          error: `no cycle of ${h.certificationId} contains ${r.occurred_on}`,
        });
        return;
      }
      const activityId = newId();
      activityRows.push({
        id: activityId,
        title: r.title,
        occurredOn: r.occurred_on,
        provider: r.provider ?? null,
        durationMinutes: r.minutes ?? null,
        itemCount: r.item_count ?? 1,
        activityType: r.activity_type,
        description: null,
        source: 'import',
        status: 'logged',
        createdAt: now,
      });
      appRows.push({
        id: newId(),
        activityId,
        heldCertId: h.id,
        cycleId: cycle.id,
        creditsX100: Math.round(r.credits * 100),
        categoryKey: r.category ?? null,
        status: r.status,
        ruleVersionId: cycle.ruleVersionId,
        creditingRuleId: null,
        suggestedCreditsX100: null,
        overrideReason: 'imported',
        issuerReference: r.issuer_reference ?? null,
        submittedAt: r.status !== 'claimed' ? now : null,
        resolvedAt: r.status === 'accepted' || r.status === 'rejected' ? now : null,
        explanation: { explain: [`imported from ${filename}`], warnings: [] },
      });
    });
    if (errors.length)
      return c.json({ error: 'invalid_rows', errors, validRows: activityRows.length }, 400);
    if (activityRows.length === 0) return c.json({ error: 'empty' }, 400);
    const batchId = newId();
    await db.batch([
      db
        .insert(s.importBatches)
        .values({ id: batchId, filename, rowCount: activityRows.length, createdAt: now }),
      ...activityRows.map((r) => db.insert(s.activities).values(r)),
      ...appRows.map((r) => db.insert(s.creditApplications).values(r)),
    ]);
    return c.json({ batchId, rows: activityRows.length }, 201);
  },
);
