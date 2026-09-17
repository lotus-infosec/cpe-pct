import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import {
  count,
  creditsAgainst,
  credits,
  DAY_TONE_CLASS,
  daysToCycleEnd,
  lastDay,
  relativeDays,
  standingLabel,
} from '@/lib/format';
import { useList, useListQuery, type Paged } from '@/lib/list';
import { EXPIRY, PROGRESS, STANDING, options } from '@/lib/labels';
import type { Body, DashboardItem, StandingBucket } from '@/lib/types';
import {
  Badge,
  Card,
  CertLink,
  FilterChips,
  LINKED,
  FilterSelect,
  ListEmpty,
  PageHeader,
  Pagination,
  PerPageSelect,
  Progress,
  ResultCount,
  SearchField,
  Skeleton,
  SortControl,
  Toolbar,
  type Chip,
} from '@/components/ui';
import { cn } from '@/lib/utils';

const LABEL: Record<string, string> = {
  cycle_total: 'cycle total',
  annual_min: 'annual minimum',
  category_min: 'category minimum',
  category_max: 'category cap',
  activity_type_max: 'activity cap',
  fee_paid: 'fee',
  prerequisite_current: 'prerequisite',
  attestation: 'attestation',
  recert_exam: 'recert exam',
  any_of: 'alternative',
};

const SORTS = [
  { value: 'severity', label: 'Needs attention' },
  { value: 'expiry', label: 'Cycle end' },
  { value: 'progress', label: 'Credit progress' },
  { value: 'name', label: 'Name' },
] as const;
type Sort = (typeof SORTS)[number]['value'];
const NATURAL_DIR: Record<Sort, 'asc' | 'desc'> = {
  severity: 'desc',
  expiry: 'asc',
  progress: 'asc',
  name: 'asc',
};

type DashboardPage = Paged<DashboardItem> & {
  asOf: string;
  counts: Record<StandingBucket, number>;
};

export function Dashboard() {
  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api<{ bodies: Body[] }>('/api/catalog'),
  });
  const bodies = catalog.data?.bodies ?? [];
  const list = useList({
    sorts: SORTS.map((s) => s.value),
    defaultSort: 'severity',
    defaultDir: 'desc',
    filters: {
      standing: Object.keys(STANDING),
      expiry: Object.keys(EXPIRY),
      progress: Object.keys(PROGRESS),
      bodyId: null,
    },
  });
  const q = useListQuery<DashboardItem, Sort, 'standing' | 'expiry' | 'progress' | 'bodyId'>(
    'dashboard',
    '/api/dashboard',
    list,
  );
  const data = q.data as DashboardPage | undefined;

  const chips: Chip[] = [
    list.q && { key: 'q', label: `Search: ${list.q}`, onRemove: () => list.set({ q: '' }) },
    list.filters.standing && {
      key: 'standing',
      label: STANDING[list.filters.standing as StandingBucket].label,
      onRemove: () => list.set({ standing: '' }),
    },
    list.filters.expiry && {
      key: 'expiry',
      label: `Cycle end: ${EXPIRY[list.filters.expiry as keyof typeof EXPIRY]}`,
      onRemove: () => list.set({ expiry: '' }),
    },
    list.filters.progress && {
      key: 'progress',
      label: `Credits: ${PROGRESS[list.filters.progress as keyof typeof PROGRESS]}`,
      onRemove: () => list.set({ progress: '' }),
    },
    list.filters.bodyId && {
      key: 'bodyId',
      label: bodies.find((b) => b.id === list.filters.bodyId)?.name ?? list.filters.bodyId,
      onRemove: () => list.set({ bodyId: '' }),
    },
  ].filter(Boolean) as Chip[];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        description={
          data ? `Standing as of ${data.asOf}` : 'Standing for every certification you hold'
        }
      />

      {data && (
        <div role="group" aria-label="Filter by standing" className="flex flex-wrap gap-2">
          {(Object.keys(STANDING) as StandingBucket[]).map((b) => {
            const active = list.filters.standing === b;
            return (
              <button
                key={b}
                type="button"
                aria-pressed={active}
                onClick={() => list.set({ standing: active ? '' : b })}
                className={cn(
                  'flex items-baseline gap-2 rounded-card border px-3 py-2 text-left text-sm',
                  active
                    ? 'border-accent/60 bg-accent/10 text-fg'
                    : 'border-hairline bg-panel text-dim hover:bg-panel-strong hover:text-fg',
                )}
              >
                <span
                  className={cn(
                    'num text-lg font-semibold',
                    data.counts[b] > 0 && STANDING[b].tone === 'bad' && 'text-bad',
                    data.counts[b] > 0 && STANDING[b].tone === 'warn' && 'text-warn',
                    data.counts[b] > 0 && STANDING[b].tone === 'ok' && 'text-ok',
                    (data.counts[b] === 0 || STANDING[b].tone === 'muted') && 'text-fg',
                  )}
                >
                  {count(data.counts[b])}
                </span>
                {STANDING[b].label}
              </button>
            );
          })}
        </div>
      )}

      <Toolbar
        label="Dashboard filters"
        end={<ResultCount page={list.page} perPage={list.perPage} total={data?.total} />}
      >
        <SearchField
          label="Search certifications"
          placeholder="Name, body or number"
          value={list.q}
          onCommit={(v) => list.set({ q: v })}
        />
        <FilterSelect
          label="Cycle end"
          value={list.filters.expiry}
          options={options(EXPIRY)}
          onChange={(v) => list.set({ expiry: v })}
        />
        <FilterSelect
          label="Credits"
          value={list.filters.progress}
          options={options(PROGRESS)}
          onChange={(v) => list.set({ progress: v })}
        />
        <FilterSelect
          label="Body"
          value={list.filters.bodyId}
          options={bodies.map((b) => ({ value: b.id, label: b.name }))}
          onChange={(v) => list.set({ bodyId: v })}
        />
        <SortControl
          sort={list.sort}
          dir={list.dir}
          options={[...SORTS]}
          onSort={(s) => list.set({ sort: s, dir: NATURAL_DIR[s] })}
          onDir={() => list.set({ dir: list.dir === 'asc' ? 'desc' : 'asc' })}
        />
        <PerPageSelect value={list.perPage} onChange={(n) => list.set({ per_page: n })} />
      </Toolbar>
      <FilterChips chips={chips} onClearAll={list.clear} />

      {q.isPending && <Skeleton rows={6} />}
      {q.isError && (
        <p role="alert" className="text-sm text-bad">
          The dashboard could not be loaded.
        </p>
      )}
      {data && data.total === 0 && (
        <ListEmpty
          narrowed={list.narrowed}
          onClear={list.clear}
          noun="certifications"
          emptyTitle="No certifications yet"
          emptyDescription="Add the certifications you hold and their renewal cycles appear here."
          emptyAction={
            <Link
              className="inline-flex h-8 items-center rounded-control bg-accent px-3 text-sm font-medium text-ground hover:bg-accent-dim"
              to="/certifications"
            >
              Add a certification
            </Link>
          }
        />
      )}
      {data && data.rows.length > 0 && (
        <div className={cn('grid gap-3 sm:grid-cols-2', q.isPlaceholderData && 'opacity-60')}>
          {data.rows.map((it) => (
            <DashboardCard key={it.held.id} it={it} asOf={data.asOf} />
          ))}
        </div>
      )}
      {data && (
        <Pagination
          page={list.page}
          pages={data.pages}
          perPage={list.perPage}
          total={data.total}
          hrefFor={list.hrefFor}
        />
      )}
    </div>
  );
}

function DashboardCard({ it, asOf }: { it: DashboardItem; asOf: string }) {
  const st = it.standing;
  const earned = it.derived.earnedX100 ?? 0;
  const standing = standingLabel(it.derived.standing);
  const stale =
    it.ruleVersion && Date.now() - new Date(it.ruleVersion.verifiedOn).getTime() > 365 * 86_400_000;
  const cycles = it.cycle ? [it.cycle] : [];
  const against = st ? creditsAgainst(earned, st.requiredX100) : null;
  const days = it.cycle ? relativeDays(daysToCycleEnd(asOf, it.cycle.endsOn)) : null;
  return (
    <Card className={cn(it.cycle && LINKED)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">
            <CertLink cycles={cycles} stretch>
              {it.certification.abbreviation}
            </CertLink>{' '}
            <span className="font-normal text-dim">· {it.body.name}</span>
          </h2>
          <p className="text-xs text-dim">{it.certification.name}</p>
        </div>
        <Badge tone={standing.tone}>{standing.label}</Badge>
      </div>
      {it.cycle && st && against && days && (
        <>
          <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-xs text-dim">
            <span className="num">
              {against.text} <span className="font-sans">{it.certification.creditUnitLabel}</span>
            </span>
            <span className="num">
              <span className={DAY_TONE_CLASS[days.tone]}>{days.text}</span> · ends{' '}
              {lastDay(it.cycle.endsOn)}
            </span>
          </div>
          <Progress
            value={earned}
            max={st.requiredX100}
            failing={!st.compliant}
            label={`${it.certification.abbreviation} credits toward the cycle requirement`}
          />
          <p className="num mt-1 text-xs text-dim">
            accepted {credits(st.totals.accepted)} · submitted {credits(st.totals.submitted)} ·
            claimed {credits(st.totals.claimed)}
          </p>
          {against.surplus && <p className="num mt-0.5 text-xs text-dim">{against.surplus}</p>}
          {st.failing.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {st.failing.map((f, i) => (
                <li key={i} className="flex items-center gap-1">
                  <Badge tone={f.overdue ? (f.severity === 'hard' ? 'bad' : 'warn') : 'muted'}>
                    {f.overdue ? 'overdue' : 'open'}
                  </Badge>
                  <span>
                    {LABEL[f.type] ?? f.type}
                    {f.severity === 'soft' ? ' (suggested)' : ''}
                    {f.due ? ` · due ${f.due}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {st.projectedAtCycleEnd.length > 0 && (
            <p className="mt-1 text-xs text-warn">
              Behind pace for: {st.projectedAtCycleEnd.map((t) => LABEL[t] ?? t).join(', ')}
            </p>
          )}
          {(it.ruleVersion || stale) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {it.ruleVersion && (
                <span className="text-dim">
                  rules v{it.ruleVersion.version}, verified{' '}
                  <span className="num">{it.ruleVersion.verifiedOn}</span>
                </span>
              )}
              {stale && <Badge tone="warn">rules verified over a year ago</Badge>}
            </div>
          )}
        </>
      )}
      {!it.cycle && (
        <p className="text-xs text-dim">
          No renewal cycle: this credential has no CE requirement of its own.
        </p>
      )}
    </Card>
  );
}
