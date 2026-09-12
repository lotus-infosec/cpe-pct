// Catalog compiler. Validates catalog/bodies/*.yaml against catalog/schema.ts, enforces immutability of
// released versions via catalog/lock.json, and emits one deterministic seed migration per new body@version.
// Seed SQL uses INSERT ... ON CONFLICT DO NOTHING so re-applying is harmless on both targets.
//
//   npm run catalog:check    validate + lock check only (CI)
//   npm run catalog:compile  validate + lock check + emit migrations for unreleased versions (updates lock)
//
// Journal entries are created with `drizzle-kit generate --custom` so Drizzle's migrate() sees the file;
// wrangler sees it because it is a top-level .sql in the same folder.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { BodyFile, type VersionBlock } from '../catalog/schema';

const ROOT = path.resolve(import.meta.dirname, '..');
const BODIES = path.join(ROOT, 'catalog/bodies');
const LOCK = path.join(ROOT, 'catalog/lock.json');
const MIGRATIONS = path.join(ROOT, 'src/db/migrations');
const write = process.argv.includes('--write');

type Lock = Record<string, { hash: string; migration: string; verified_on: string }>;
const lock: Lock = existsSync(LOCK) ? (JSON.parse(readFileSync(LOCK, 'utf8')) as Lock) : {};

const canonical = (v: unknown): string => JSON.stringify(sortKeys(v));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  return v;
}
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const q = (v: unknown): string => {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const x100 = (n: number | undefined | null) => (n == null ? null : Math.round(n * 100));
const cents = (n: number | undefined | null) => (n == null ? null : Math.round(n * 100));

let failed = false;
const files = readdirSync(BODIES)
  .filter((f) => f.endsWith('.yaml'))
  .sort();
const newLock: Lock = { ...lock };

for (const file of files) {
  const raw = parse(readFileSync(path.join(BODIES, file), 'utf8')) as unknown;
  const parsed = BodyFile.safeParse(raw);
  if (!parsed.success) {
    failed = true;
    console.error(`✖ ${file}`);
    for (const i of parsed.error.issues) console.error(`   ${i.path.join('.')}: ${i.message}`);
    continue;
  }
  const body = parsed.data;
  if (`${body.body.id}.yaml` !== file) {
    failed = true;
    console.error(`✖ ${file}: body.id ${body.body.id} must match filename`);
    continue;
  }

  for (const v of body.versions) {
    const key = `${body.body.id}@${v.version}`;
    const hash = sha(
      canonical({ body: body.body, certifications: body.certifications, version: v }),
    );
    const released = lock[key];
    if (released && released.hash !== hash) {
      failed = true;
      console.error(
        `✖ ${key}: content changed after release (lock ${released.hash.slice(0, 12)} ≠ ${hash.slice(0, 12)}). Add a new version instead.`,
      );
      continue;
    }
    if (released) {
      console.log(`= ${key} unchanged (${released.migration})`);
      continue;
    }
    if (!write) {
      console.log(`+ ${key} not yet released (run with --write to emit its seed migration)`);
      continue;
    }

    const name = `seed_${body.body.id}_v${v.version}`;
    execFileSync('npx', ['drizzle-kit', 'generate', '--custom', `--name=${name}`], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    const target = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(`_${name}.sql`))
      .sort()
      .at(-1);
    if (!target) throw new Error(`drizzle-kit did not create a migration for ${name}`);
    writeFileSync(path.join(MIGRATIONS, target), seedSql(body, v, key));
    newLock[key] = { hash, migration: target, verified_on: v.verified_on };
    console.log(`✔ ${key} → src/db/migrations/${target}`);
  }
}

if (write && !failed)
  writeFileSync(
    LOCK,
    JSON.stringify(Object.fromEntries(Object.entries(newLock).sort()), null, 2) + '\n',
  );
if (failed) process.exit(1);
console.log(write ? 'catalog compiled' : 'catalog valid');

function seedSql(body: BodyFile, v: VersionBlock, rv: string): string {
  const b = body.body;
  const rows: string[] = [];
  const ins = (table: string, cols: string[], vals: unknown[]) =>
    rows.push(
      `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (${vals.map(q).join(', ')}) ON CONFLICT DO NOTHING;`,
    );

  ins(
    'bodies',
    ['id', 'name', 'website', 'fee_scope'],
    [b.id, b.name, b.website ?? null, b.fee_scope],
  );
  for (const c of body.certifications)
    ins(
      'certifications',
      ['id', 'body_id', 'name', 'abbreviation', 'credit_unit_label', 'expires', 'retired_on'],
      [c.id, b.id, c.name, c.abbreviation, c.credit_unit_label, c.expires, c.retired_on ?? null],
    );
  const src = v.sources[0]!;
  ins(
    'rule_versions',
    [
      'id',
      'body_id',
      'version',
      'effective_from',
      'source_url',
      'source_title',
      'verified_on',
      'notes',
    ],
    [rv, b.id, v.version, v.effective_from, src.url, src.title, v.verified_on, v.notes ?? null],
  );
  for (const c of v.categories)
    ins(
      'credit_categories',
      ['id', 'rule_version_id', 'key', 'name', 'parent_key'],
      [`${rv}/${c.key}`, rv, c.key, c.name, c.parent_key ?? null],
    );
  for (const r of v.requirements) {
    const { amount, currency, period_months, ...feeParams } = r.fee ?? {};
    ins(
      'cert_requirements',
      [
        'id',
        'rule_version_id',
        'certification_id',
        'cycle_months',
        'total_credits_x100',
        'annual_min_x100',
        'annual_min_severity',
        'fee_amount_cents',
        'fee_currency',
        'fee_period_months',
        'fee_params',
      ],
      [
        `${rv}/${r.certification}`,
        rv,
        r.certification,
        r.cycle_months,
        x100(r.total_credits),
        x100(r.annual_min),
        r.annual_min_severity ?? null,
        cents(amount),
        currency ?? null,
        period_months ?? null,
        Object.keys(feeParams).length ? JSON.stringify(feeParams) : null,
      ],
    );
  }
  v.crediting.forEach((c, i) => {
    const id = `${rv}/cr/${String(i + 1).padStart(3, '0')}-${c.activity_type}${c.applies_to ? '-' + c.applies_to.split('/')[1] : ''}`;
    ins(
      'crediting_rules',
      [
        'id',
        'rule_version_id',
        'activity_type',
        'body_label',
        'basis',
        'minutes_per_credit',
        'credits_per_item_x100',
        'rounding',
        'category_key',
        'cap_per_cycle_x100',
        'cap_per_year_x100',
        'cap_per_item_x100',
        'evidence_required',
        'applies_to_cert_id',
      ],
      [
        id,
        rv,
        c.activity_type,
        c.body_label,
        c.basis,
        c.minutes_per_credit ?? null,
        x100(c.credits_per_item),
        c.rounding,
        c.category ?? null,
        x100(c.cap_per_cycle),
        x100(c.cap_per_year),
        x100(c.cap_per_item),
        c.evidence_required,
        c.applies_to ?? null,
      ],
    );
  });
  v.constraints.forEach((c, i) => {
    ins(
      'constraints',
      ['id', 'rule_version_id', 'certification_id', 'type', 'params', 'severity'],
      [
        `${rv}/con/${String(i + 1).padStart(3, '0')}-${c.type}`,
        rv,
        c.applies_to ?? null,
        c.type,
        JSON.stringify(c.params),
        c.severity,
      ],
    );
  });
  v.relations.forEach((r, i) => {
    ins(
      'cert_relations',
      ['id', 'rule_version_id', 'from_cert_id', 'to_cert_id', 'relation', 'credits_x100'],
      [
        `${rv}/rel/${String(i + 1).padStart(3, '0')}`,
        rv,
        r.from,
        r.to,
        r.relation,
        x100(r.credits),
      ],
    );
  });
  return (
    `-- Seed ${rv}: generated by scripts/compile-catalog.ts from catalog/bodies/${b.id}.yaml. Do not edit.\n` +
    rows.join('\n--> statement-breakpoint\n') +
    '\n'
  );
}
