import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, fmtCredits } from '@/lib/api';
import { fetchAll, useList, useListQuery } from '@/lib/list';
import { APPLICATION_STATUS, options } from '@/lib/labels';
import type { ApplicationRow, Body, Held } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Badge,
  ErrorText,
  FilterChips,
  FilterSelect,
  ListEmpty,
  PageHeader,
  Pagination,
  PerPageSelect,
  ResultCount,
  SearchField,
  Skeleton,
  SortableTh,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Toolbar,
  Tr,
  type Chip,
} from '@/components/ui';

const SORTS = ['occurredOn', 'credits', 'status'] as const;
type Sort = (typeof SORTS)[number];

/** Every credit application across all certifications. Status changes happen on the cycle page. */
export function ApplicationsPage() {
  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api<{ bodies: Body[] }>('/api/catalog'),
  });
  const held = useQuery({
    queryKey: ['held', 'all'],
    queryFn: () => fetchAll<Held>('/api/held?view=basic'),
  });
  const bodies = catalog.data?.bodies ?? [];
  const list = useList({
    sorts: SORTS,
    defaultSort: 'occurredOn',
    defaultDir: 'desc',
    filters: { status: Object.keys(APPLICATION_STATUS), bodyId: null, heldCertId: null },
  });
  const q = useListQuery<ApplicationRow, Sort, 'status' | 'bodyId' | 'heldCertId'>(
    'applications',
    '/api/applications',
    list,
  );
  const data = q.data;
  const heldById = new Map((held.data ?? []).map((h) => [h.id, h]));

  const chips: Chip[] = [
    list.q && { key: 'q', label: `Search: ${list.q}`, onRemove: () => list.set({ q: '' }) },
    list.filters.status && {
      key: 'status',
      label: APPLICATION_STATUS[list.filters.status as keyof typeof APPLICATION_STATUS].label,
      onRemove: () => list.set({ status: '' }),
    },
    list.filters.bodyId && {
      key: 'bodyId',
      label: bodies.find((b) => b.id === list.filters.bodyId)?.name ?? list.filters.bodyId,
      onRemove: () => list.set({ bodyId: '' }),
    },
    list.filters.heldCertId && {
      key: 'heldCertId',
      label: heldById.get(list.filters.heldCertId)?.certification.abbreviation ?? 'Certification',
      onRemove: () => list.set({ heldCertId: '' }),
    },
  ].filter(Boolean) as Chip[];

  const sortTh = (key: Sort, label: string, natural: 'asc' | 'desc', className?: string) => (
    <SortableTh
      active={list.sort === key}
      direction={list.dir}
      onSort={() => list.sortBy(key, natural)}
      {...(className && { className })}
    >
      {label}
    </SortableTh>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Credit applications"
        description="Each credit an activity earned toward a certification. Record issuer outcomes on the cycle page."
      />
      <Toolbar
        label="Credit application filters"
        end={<ResultCount page={list.page} perPage={list.perPage} total={data?.total} />}
      >
        <SearchField
          label="Search credit applications"
          placeholder="Activity title"
          value={list.q}
          onCommit={(v) => list.set({ q: v })}
        />
        <FilterSelect
          label="Status"
          value={list.filters.status}
          options={options(APPLICATION_STATUS)}
          onChange={(v) => list.set({ status: v })}
        />
        <FilterSelect
          label="Body"
          value={list.filters.bodyId}
          options={bodies.map((b) => ({ value: b.id, label: b.name }))}
          onChange={(v) => list.set({ bodyId: v })}
        />
        <FilterSelect
          label="Certification"
          value={list.filters.heldCertId}
          options={(held.data ?? [])
            .map((h) => ({ value: h.id, label: h.certification.abbreviation }))
            .sort((a, b) => a.label.localeCompare(b.label))}
          onChange={(v) => list.set({ heldCertId: v })}
        />
        <PerPageSelect value={list.perPage} onChange={(n) => list.set({ per_page: n })} />
      </Toolbar>
      <FilterChips chips={chips} onClearAll={list.clear} />

      {q.isPending && <Skeleton rows={8} />}
      {q.isError && <ErrorText error={q.error} />}
      {data && data.total === 0 && (
        <ListEmpty
          narrowed={list.narrowed}
          onClear={list.clear}
          noun="credit applications"
          emptyTitle="No credits applied yet"
          emptyDescription="Log an activity and confirm its fan-out; the credits it earns are listed here."
          emptyAction={
            <Link
              className="inline-flex h-8 items-center rounded-control border border-hairline bg-panel px-3 text-sm text-fg hover:bg-panel-strong"
              to="/activities"
            >
              Go to activities
            </Link>
          }
        />
      )}
      {data && data.rows.length > 0 && (
        <div className={cn(q.isPlaceholderData && 'opacity-60')}>
          <Table label="Credit applications">
            <THead>
              <tr>
                <Th>Activity</Th>
                <Th>Certification</Th>
                {sortTh('occurredOn', 'Date', 'desc')}
                {sortTh('credits', 'Credits', 'desc', 'text-right')}
                <Th>Category</Th>
                {sortTh('status', 'Status', 'asc')}
                <Th>Issuer ref.</Th>
              </tr>
            </THead>
            <TBody>
              {data.rows.map((ap) => {
                const h = heldById.get(ap.heldCertId);
                return (
                  <Tr key={ap.id}>
                    <Td className="max-w-80">
                      <Link
                        className="block truncate text-fg underline-offset-2 hover:text-accent hover:underline"
                        to={`/activities/${ap.activityId}`}
                        title={ap.activity.title}
                      >
                        {ap.activity.title}
                      </Link>
                    </Td>
                    <Td>
                      <Link
                        className="text-accent underline-offset-2 hover:underline"
                        to={`/cycles/${ap.cycleId}`}
                      >
                        {h?.certification.abbreviation ?? 'cycle'}
                      </Link>
                    </Td>
                    <Td className="num whitespace-nowrap">{ap.activity.occurredOn}</Td>
                    <Td numeric>
                      {fmtCredits(ap.creditsX100)}
                      {ap.overrideReason && (
                        <span className="block text-xs text-dim" title={ap.overrideReason}>
                          override
                        </span>
                      )}
                    </Td>
                    <Td className="text-dim">{ap.categoryKey ?? ''}</Td>
                    <Td>
                      <Badge tone={APPLICATION_STATUS[ap.status].tone}>
                        {APPLICATION_STATUS[ap.status].label}
                      </Badge>
                    </Td>
                    <Td className="num text-dim">{ap.issuerReference ?? ''}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
      {data && (
        <Pagination
          page={list.page}
          pages={data.pages}
          perPage={list.perPage}
          total={data.total}
          hrefFor={list.hrefFor}
          label="Credit application pages"
        />
      )}
    </div>
  );
}
