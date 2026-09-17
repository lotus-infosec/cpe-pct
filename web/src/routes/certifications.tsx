import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/lib/api';
import {
  creditsAgainst,
  credits,
  DAY_TONE_CLASS,
  lastDay,
  money,
  relativeDays,
  timestamp,
  standingLabel,
} from '@/lib/format';
import { useList, useListQuery } from '@/lib/list';
import { EXPIRY, PROGRESS, STANDING, options } from '@/lib/labels';
import type { Body, Held, Membership, StandingBucket } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Badge,
  Button,
  Card,
  CertLink,
  ErrorText,
  Field,
  FilterChips,
  FilterSelect,
  Input,
  LIFT,
  LINKED,
  ListEmpty,
  PageHeader,
  Pagination,
  PerPageSelect,
  ResultCount,
  SearchField,
  Select,
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

interface UpdateCheck {
  url: string;
  checkedAt: string;
  updates: { body: string; local: number | null; remote: number; verified_on: string }[];
  remoteBodies: string[];
}

export function Certifications() {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api<{ bodies: Body[] }>('/api/catalog'),
  });
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api<Membership[]>('/api/memberships'),
  });
  const invalidate = () => qc.invalidateQueries();

  const [certificationId, setCert] = useState('');
  const [earnedOn, setEarnedOn] = useState('');
  const [certNumber, setCertNumber] = useState('');
  const addHeld = useMutation({
    mutationFn: () =>
      api('/api/held', {
        method: 'POST',
        body: { certificationId, earnedOn, ...(certNumber && { certNumber }) },
      }),
    onSuccess: () => {
      setCert('');
      setEarnedOn('');
      setCertNumber('');
      invalidate();
    },
  });
  const removeHeld = useMutation({
    mutationFn: (id: string) => api(`/api/held/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const [mBody, setMBody] = useState('');
  const [mNumber, setMNumber] = useState('');
  const [mSince, setMSince] = useState('');
  const addMembership = useMutation({
    mutationFn: () =>
      api('/api/memberships', {
        method: 'POST',
        body: {
          bodyId: mBody,
          ...(mNumber && { memberNumber: mNumber }),
          ...(mSince && { since: mSince }),
        },
      }),
    onSuccess: () => {
      setMBody('');
      setMNumber('');
      setMSince('');
      invalidate();
    },
  });
  const removeMembership = useMutation({
    mutationFn: (id: string) => api(`/api/memberships/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const bodies = catalog.data?.bodies ?? [];
  const check = useMutation({
    mutationFn: () => api<UpdateCheck>('/api/catalog/updates/check', { method: 'POST' }),
  });
  const selected = bodies.flatMap((b) => b.certifications).find((c) => c.id === certificationId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certifications"
        description="What you hold, where each cycle stands, and the memberships that carry fees."
      />
      <HeldList
        onRemove={(h) => {
          if (
            confirm(
              `Remove ${h.certification.abbreviation} and all its cycles and credit applications?`,
            )
          )
            removeHeld.mutate(h.id);
        }}
        bodies={bodies}
      />
      <ErrorText error={removeHeld.error} />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 font-semibold">Memberships</h2>
            <p className="mb-2 text-xs text-dim">
              Needed where the maintenance fee is per membership rather than per certification (e.g.
              the ISC2 AMF).
            </p>
            <ul className="mb-3 divide-y">
              {memberships.data?.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="font-medium">
                    {bodies.find((b) => b.id === m.bodyId)?.name ?? m.bodyId}
                  </span>
                  <span className="text-xs text-dim">
                    {m.memberNumber ? `#${m.memberNumber}` : ''}
                    {m.since ? ` since ${m.since}` : ''}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => removeMembership.mutate(m.id)}
                  >
                    remove
                  </Button>
                </li>
              ))}
            </ul>
            <form
              className="grid gap-2 sm:grid-cols-4"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                addMembership.mutate();
              }}
            >
              <Field label="Body">
                <Select value={mBody} onChange={(e) => setMBody(e.target.value)} required>
                  <option value="">Select…</option>
                  {bodies
                    .filter((b) => b.feeScope === 'membership')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Member number (optional)">
                <Input value={mNumber} onChange={(e) => setMNumber(e.target.value)} />
              </Field>
              <Field label="Since">
                <Input type="date" value={mSince} onChange={(e) => setMSince(e.target.value)} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={!mBody || addMembership.isPending}>
                  Add
                </Button>
              </div>
            </form>
            <ErrorText error={addMembership.error} />
          </Card>
        </div>
        <Card>
          <h2 className="mb-3 font-semibold">Add a held certification</h2>
          <form
            className="space-y-3"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              addHeld.mutate();
            }}
          >
            <Field label="Certification (from catalog)">
              <Select value={certificationId} onChange={(e) => setCert(e.target.value)} required>
                <option value="">Select…</option>
                {bodies.map((b) => (
                  <optgroup key={b.id} label={b.name}>
                    {b.certifications.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.abbreviation} — {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            {selected && (
              <p className="text-xs text-dim">
                {selected.requirement
                  ? `${credits(selected.requirement.totalCreditsX100)} ${selected.creditUnitLabel} per ${selected.requirement.cycleMonths}-month cycle` +
                    (selected.requirement.annualMinX100
                      ? `; ${credits(selected.requirement.annualMinX100)}/yr ${selected.requirement.annualMinSeverity === 'soft' ? 'suggested' : 'required'}`
                      : '') +
                    (selected.requirement.feeAmountCents
                      ? `; fee ${money(selected.requirement.feeAmountCents, selected.requirement.feeCurrency ?? 'USD')} per ${selected.requirement.feePeriodMonths} months`
                      : '')
                  : 'No continuing-education requirement of its own.'}
              </p>
            )}
            <Field label="Earned on (cycle starts here)">
              <Input
                type="date"
                value={earnedOn}
                onChange={(e) => setEarnedOn(e.target.value)}
                required
              />
            </Field>
            <Field label="Certification number (optional, stays in your database)">
              <Input value={certNumber} onChange={(e) => setCertNumber(e.target.value)} />
            </Field>
            <ErrorText error={addHeld.error} />
            <Button
              variant="primary"
              type="submit"
              disabled={!certificationId || !earnedOn || addHeld.isPending}
            >
              Add
            </Button>
          </form>
          <div className="mt-4 border-t pt-3 text-xs text-dim">
            <p>
              <Button size="sm" onClick={() => check.mutate()} disabled={check.isPending}>
                Check for catalog updates
              </Button>{' '}
              fetches one file, <code>catalog/lock.json</code>, from this project's GitHub
              repository and compares versions. Nothing about you is sent. It never runs on its own.
            </p>
            {check.data && (
              <p className="mt-1">
                {check.data.updates.length === 0
                  ? `Up to date with ${check.data.url} as of ${timestamp(check.data.checkedAt)}.`
                  : `Newer rule versions available: ${check.data.updates.map((u) => `${u.body} v${u.remote} (verified ${u.verified_on})`).join(', ')}. Update by redeploying or pulling a new image.`}
              </p>
            )}
            <ErrorText error={check.error} />
          </div>
          <p className="mt-4 text-xs text-dim">
            Catalog:{' '}
            {bodies
              .map(
                (b) =>
                  `${b.name} v${b.currentVersion?.version ?? '?'} (verified ${b.currentVersion?.verifiedOn ?? '?'})`,
              )
              .join(' · ')}
          </p>
        </Card>
      </div>
    </div>
  );
}

const HELD_SORTS = ['name', 'severity', 'expiry', 'progress'] as const;
type HeldSort = (typeof HELD_SORTS)[number];

function HeldList({ bodies, onRemove }: { bodies: Body[]; onRemove: (h: Held) => void }) {
  const list = useList({
    sorts: HELD_SORTS,
    defaultSort: 'name',
    defaultDir: 'asc',
    filters: {
      standing: Object.keys(STANDING),
      expiry: Object.keys(EXPIRY),
      progress: Object.keys(PROGRESS),
      bodyId: null,
    },
  });
  const q = useListQuery<Held, HeldSort, 'standing' | 'expiry' | 'progress' | 'bodyId'>(
    'held',
    '/api/held',
    list,
  );
  const data = q.data;
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
  const sortTh = (
    key: HeldSort,
    label: string,
    natural: 'asc' | 'desc' = 'asc',
    className?: string,
  ) => (
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
    <section aria-labelledby="held-heading" className="space-y-3">
      <h2 id="held-heading" className="text-lg font-semibold">
        Held certifications
      </h2>
      <Toolbar
        label="Held certification filters"
        end={<ResultCount page={list.page} perPage={list.perPage} total={data?.total} />}
      >
        <SearchField
          label="Search held certifications"
          placeholder="Name, body or number"
          value={list.q}
          onCommit={(v) => list.set({ q: v })}
        />
        <FilterSelect
          label="Standing"
          value={list.filters.standing}
          options={options(STANDING)}
          onChange={(v) => list.set({ standing: v })}
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
        <PerPageSelect value={list.perPage} onChange={(n) => list.set({ per_page: n })} />
      </Toolbar>
      <FilterChips chips={chips} onClearAll={list.clear} />
      {q.isPending && <Skeleton rows={5} />}
      {q.isError && <ErrorText error={q.error} />}
      {data && data.total === 0 && (
        <ListEmpty
          narrowed={list.narrowed}
          onClear={list.clear}
          noun="certifications"
          emptyTitle="No held certifications yet"
          emptyDescription="Add one below. Its first renewal cycle is created from the date you earned it."
        />
      )}
      {data && data.rows.length > 0 && (
        <div className={cn(q.isPlaceholderData && 'opacity-60')}>
          <Table label="Held certifications">
            <THead>
              <tr>
                {sortTh('name', 'Certification')}
                <Th>Body</Th>
                {sortTh('severity', 'Standing', 'desc')}
                {sortTh('expiry', 'Cycle end')}
                {sortTh('progress', 'Credits', 'asc', 'text-right')}
                <Th>Cycles</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {data.rows.map((h) => {
                const open = h.cycles.find((c) => c.status === 'open');
                const standing = standingLabel(h.derived.standing);
                const days =
                  h.derived.daysToExpiry != null ? relativeDays(h.derived.daysToExpiry) : null;
                const against = h.derived.requiredX100
                  ? creditsAgainst(h.derived.earnedX100 ?? 0, h.derived.requiredX100)
                  : null;
                return (
                  <Tr key={h.id} className={cn(h.cycles.length > 0 && LINKED)}>
                    <Td>
                      <CertLink cycles={h.cycles} stretch className="font-medium">
                        {h.certification.abbreviation}
                      </CertLink>
                      <span
                        className="block max-w-72 truncate text-xs text-dim"
                        title={h.certification.name}
                      >
                        {h.certification.name}
                        {h.certNumber && <span className="num"> · #{h.certNumber}</span>}
                      </span>
                    </Td>
                    <Td className="text-dim">{h.body.name}</Td>
                    <Td>
                      <Badge tone={standing.tone}>{standing.label}</Badge>
                    </Td>
                    <Td className="num whitespace-nowrap">
                      {open ? (
                        <>
                          {lastDay(open.endsOn)}
                          {days && (
                            <span className={cn('block text-xs', DAY_TONE_CLASS[days.tone])}>
                              {days.text}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-dim">none</span>
                      )}
                    </Td>
                    <Td numeric className="whitespace-nowrap">
                      {against ? (
                        <>
                          {against.text}
                          {against.surplus && (
                            <span className="block text-xs text-dim">
                              +{credits(against.surplusX100)} beyond
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-dim">n/a</span>
                      )}
                    </Td>
                    <Td className="text-xs">
                      <span className="flex flex-wrap gap-x-2">
                        {open && (
                          <Link
                            className={cn(LIFT, 'text-accent underline-offset-2 hover:underline')}
                            to={`/cycles/${open.id}`}
                          >
                            cycle {open.sequence}
                          </Link>
                        )}
                        {h.cycles
                          .filter((c) => c.status !== 'open')
                          .map((c) => (
                            <Link
                              key={c.id}
                              className={cn(LIFT, 'text-dim underline-offset-2 hover:underline')}
                              to={`/cycles/${c.id}`}
                            >
                              cycle {c.sequence} ({c.status})
                            </Link>
                          ))}
                      </span>
                    </Td>
                    <Td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={LIFT}
                        onClick={() => onRemove(h)}
                      >
                        Remove
                        <span className="sr-only"> {h.certification.abbreviation}</span>
                      </Button>
                    </Td>
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
          label="Held certifications pages"
        />
      )}
    </section>
  );
}
