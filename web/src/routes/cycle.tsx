import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api } from '@/lib/api';
import {
  credits,
  creditsAgainst,
  DAY_TONE_CLASS,
  dateRange,
  daysToCycleEnd,
  money,
  relativeDays,
  standingLabel,
} from '@/lib/format';
import { cn } from '@/lib/utils';
import { fetchAll, useList, useListQuery } from '@/lib/list';
import { APPLICATION_STATUS, options } from '@/lib/labels';
import type { ApplicationRow, ConstraintResult, Held, Membership, Standing } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  FilterSelect,
  Input,
  ListEmpty,
  Pagination,
  PerPageSelect,
  ResultCount,
  SearchField,
  Skeleton,
  SortableTh,
  Toolbar,
} from '@/components/ui';

const APP_SORTS = ['occurredOn', 'credits', 'status'] as const;
type AppSort = (typeof APP_SORTS)[number];

interface FeePeriod {
  targetType: 'cycle' | 'membership';
  targetId: string | null;
  scope: string;
  periodStart: string;
  periodEnd: string;
  dueOn: string;
  amountCents: number | null;
  currency: string | null;
  status: 'paid' | 'waived' | 'due';
  coveredBy: string | null;
}

const LABEL: Record<string, string> = {
  cycle_total: 'Cycle total',
  annual_min: 'Annual minimum',
  category_min: 'Category minimum',
  category_max: 'Category cap',
  activity_type_max: 'Activity-type cap',
  fee_paid: 'Maintenance fee',
  prerequisite_current: 'Prerequisite current',
  attestation: 'Attestation',
  recert_exam: 'Recertification exam',
  any_of: 'One of',
};

export function CyclePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const st = useQuery({
    queryKey: ['standing', id],
    queryFn: () => api<Standing>(`/api/cycles/${id}/standing`),
  });
  const held = useQuery({
    queryKey: ['held', 'all'],
    queryFn: () => fetchAll<Held>('/api/held?view=basic'),
  });
  const list = useList({
    sorts: APP_SORTS,
    defaultSort: 'occurredOn',
    defaultDir: 'desc',
    filters: { status: Object.keys(APPLICATION_STATUS) },
    fixed: { cycleId: id },
  });
  const apps = useListQuery<ApplicationRow, AppSort, 'status'>(
    'applications',
    '/api/applications',
    list,
  );
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api<Membership[]>('/api/memberships'),
  });
  const fees = useQuery({
    queryKey: ['fees', id],
    queryFn: () => api<FeePeriod[]>(`/api/cycles/${id}/fees`),
  });
  const [waiveReason, setWaiveReason] = useState('');
  const [payOn2, setPayOn2] = useState('');
  const invalidateAll = () => qc.invalidateQueries();
  const waive = useMutation({
    mutationFn: (p: FeePeriod) =>
      api('/api/payments', {
        method: 'POST',
        body: {
          targetType: p.targetType,
          targetId: p.targetId,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          dueOn: p.dueOn,
          amountCents: p.amountCents ?? 0,
          currency: p.currency ?? 'USD',
          status: 'waived',
          waiveReason,
        },
      }),
    onSuccess: () => {
      setWaiveReason('');
      invalidateAll();
    },
  });
  const payPeriod = useMutation({
    mutationFn: (p: FeePeriod) =>
      api('/api/payments', {
        method: 'POST',
        body: {
          targetType: p.targetType,
          targetId: p.targetId,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          dueOn: p.dueOn,
          amountCents: p.amountCents ?? 0,
          currency: p.currency ?? 'USD',
          status: 'paid',
          paidOn: payOn2 || p.dueOn,
        },
      }),
    onSuccess: invalidateAll,
  });
  const h = held.data?.find((x) => x.cycles.some((c) => c.id === id));
  const cycle = h?.cycles.find((c) => c.id === id);
  const invalidate = () => qc.invalidateQueries();

  const patch = useMutation({
    mutationFn: (v: { id: string; status: string; issuerReference?: string | undefined }) =>
      api(`/api/applications/${v.id}`, {
        method: 'PATCH',
        body: {
          status: v.status,
          ...(v.issuerReference && { issuerReference: v.issuerReference }),
        },
      }),
    onSuccess: invalidate,
  });
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [renewedOn, setRenewedOn] = useState('');
  const renew = useMutation({
    mutationFn: () => api(`/api/cycles/${id}/renew`, { method: 'POST', body: { renewedOn } }),
    onSuccess: invalidate,
  });
  const [payOn, setPayOn] = useState('');
  const pay = useMutation({
    mutationFn: (c: ConstraintResult) => {
      const [periodStart, periodEnd] = (c.period ?? '..').split('..');
      const isMembership = c.scope?.startsWith('membership:');
      const targetId = isMembership
        ? memberships.data?.find((m) => m.bodyId === c.scope!.split(':')[1])?.id
        : id;
      const req = h?.certification.requirement;
      return api('/api/payments', {
        method: 'POST',
        body: {
          targetType: isMembership ? 'membership' : 'cycle',
          targetId,
          periodStart,
          periodEnd,
          dueOn: c.due,
          amountCents: req?.feeAmountCents ?? 0,
          currency: req?.feeCurrency ?? 'USD',
          status: 'paid',
          paidOn: payOn || c.due,
        },
      });
    },
    onSuccess: invalidate,
  });

  if (st.isPending || held.isPending)
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (st.isError || !h || !cycle) return <p className="text-sm text-bad">Cycle not found.</p>;
  const s = st.data;
  const earned = s.totals.accepted + s.totals.submitted + s.totals.claimed;
  const against = creditsAgainst(earned, s.requiredX100);
  const days = relativeDays(daysToCycleEnd(s.asOf, cycle.endsOn));
  const standing = standingLabel(s.compliant);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">
            {h.certification.abbreviation} — cycle {cycle.sequence}
          </h2>
          <span className="num text-sm text-muted-foreground">
            {dateRange(cycle.startsOn, cycle.endsOn)}
          </span>
          <span className="text-sm text-muted-foreground">· rules {cycle.ruleVersionId}</span>
          <Badge tone={standing.tone}>{standing.label}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            as of <span className="num">{s.asOf}</span> ·{' '}
            {cycle.status === 'open' ? (
              <span className={DAY_TONE_CLASS[days.tone]}>{days.text}</span>
            ) : (
              cycle.status
            )}
          </span>
        </div>
        <p className="mt-2 text-sm">
          <span className="num">{against.text}</span> {h.certification.creditUnitLabel} — accepted{' '}
          <span className="num">{credits(s.totals.accepted)}</span>, submitted{' '}
          <span className="num">{credits(s.totals.submitted)}</span>, claimed{' '}
          <span className="num">{credits(s.totals.claimed)}</span>
        </p>
        {against.surplus && <p className="num mt-0.5 text-xs text-dim">{against.surplus}</p>}
      </Card>

      <Card>
        <h3 className="mb-2 font-semibold">Standing</h3>
        <ul className="divide-y">
          {s.constraints.map((c, i) => (
            <ConstraintRow
              key={i}
              c={c}
              unit={h.certification.creditUnitLabel}
              onPay={c.type === 'fee_paid' && !c.satisfied ? () => pay.mutate(c) : undefined}
              payOn={payOn}
              setPayOn={setPayOn}
              feeCents={h.certification.requirement?.feeAmountCents ?? null}
              feeCurrency={h.certification.requirement?.feeCurrency ?? 'USD'}
            />
          ))}
        </ul>
        <ErrorText error={pay.error} />
        {s.projectedAtCycleEnd.length > 0 && (
          <p className="mt-2 text-xs text-warn">
            At the current pace these will not be met by cycle end:{' '}
            {s.projectedAtCycleEnd.map((t) => LABEL[t] ?? t).join(', ')}.
          </p>
        )}
      </Card>

      {fees.data && fees.data.length > 0 && (
        <Card>
          <h3 className="mb-1 font-semibold">Fee schedule</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Every fee period this cycle implies ({fees.data[0]!.scope}). Record a payment when you
            pay the issuer; waive with a reason when the issuer waived it or a higher certification
            covers it.
          </p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">Period</th>
                <th className="pr-2">Due</th>
                <th className="pr-2">Amount</th>
                <th className="pr-2">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fees.data.map((p) => (
                <tr key={p.periodStart} className="border-t">
                  <td className="num py-1 pr-2">{dateRange(p.periodStart, p.periodEnd)}</td>
                  <td className="pr-2">{p.dueOn}</td>
                  <td className="pr-2">
                    {p.amountCents != null ? money(p.amountCents, p.currency ?? 'USD') : '—'}
                  </td>
                  <td className="pr-2">
                    <Badge
                      tone={
                        p.status === 'paid'
                          ? 'ok'
                          : p.status === 'waived'
                            ? 'muted'
                            : p.dueOn <= s.asOf
                              ? 'bad'
                              : 'warn'
                      }
                    >
                      {p.status}
                      {p.coveredBy ? ` (covered by ${p.coveredBy.split('/')[1]})` : ''}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap">
                    {p.status === 'due' && p.targetId && (
                      <span className="flex flex-wrap items-center gap-1">
                        <Input
                          type="date"
                          className="h-7 w-36 text-xs"
                          value={payOn2}
                          onChange={(e) => setPayOn2(e.target.value)}
                        />
                        <Button size="sm" variant="outline" onClick={() => payPeriod.mutate(p)}>
                          paid
                        </Button>
                        <Input
                          className="h-7 w-32 text-xs"
                          placeholder="waive reason"
                          value={waiveReason}
                          onChange={(e) => setWaiveReason(e.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!waiveReason.trim()}
                          onClick={() => waive.mutate(p)}
                        >
                          waive
                        </Button>
                      </span>
                    )}
                    {p.status === 'due' && !p.targetId && (
                      <span className="text-xs text-warn">
                        add a membership for this body first
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ErrorText error={payPeriod.error ?? waive.error} />
        </Card>
      )}
      <Card>
        <h3 className="mb-2 font-semibold">Credit applications</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          You submit to the issuer yourself; record the outcome here. claimed → submitted → accepted
          / rejected.
        </p>
        <Toolbar
          label="Credit application filters"
          className="mb-3"
          end={<ResultCount page={list.page} perPage={list.perPage} total={apps.data?.total} />}
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
          <PerPageSelect value={list.perPage} onChange={(n) => list.set({ per_page: n })} />
        </Toolbar>
        {apps.isPending && <Skeleton rows={4} />}
        {apps.data && apps.data.total === 0 && (
          <ListEmpty
            narrowed={list.narrowed}
            onClear={list.clear}
            noun="credit applications"
            emptyTitle="No credits applied to this cycle yet"
            emptyDescription="Log an activity and confirm its fan-out to apply credits here."
          />
        )}
        {apps.data && apps.data.rows.length > 0 && (
          <div
            className={cn('relative mb-3 overflow-x-auto', apps.isPlaceholderData && 'opacity-60')}
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Credit applications in this cycle</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-2">
                    Activity
                  </th>
                  <SortableTh
                    active={list.sort === 'occurredOn'}
                    direction={list.dir}
                    onSort={() => list.sortBy('occurredOn', 'desc')}
                  >
                    Date
                  </SortableTh>
                  <SortableTh
                    active={list.sort === 'credits'}
                    direction={list.dir}
                    onSort={() => list.sortBy('credits', 'desc')}
                  >
                    Credits
                  </SortableTh>
                  <th scope="col" className="pr-2">
                    Cat.
                  </th>
                  <SortableTh
                    active={list.sort === 'status'}
                    direction={list.dir}
                    onSort={() => list.sortBy('status')}
                  >
                    Status
                  </SortableTh>
                  <th scope="col" className="pr-2">
                    Issuer ref.
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {apps.data.rows.map((ap) => {
                  return (
                    <tr key={ap.id} className="border-t">
                      <td className="py-1 pr-2">
                        <Link className="underline" to={`/activities/${ap.activityId}`}>
                          {ap.activity.title}
                        </Link>
                        {ap.overrideReason && (
                          <span
                            className="ml-1 text-[11px] text-muted-foreground"
                            title={ap.overrideReason}
                          >
                            (override)
                          </span>
                        )}
                      </td>
                      <td className="num pr-2 text-xs text-muted-foreground">
                        {ap.activity.occurredOn}
                      </td>
                      <td className="pr-2 tabular-nums">
                        {credits(ap.creditsX100)}
                        {ap.suggestedCreditsX100 != null &&
                          ap.suggestedCreditsX100 !== ap.creditsX100 && (
                            <span className="text-[11px] text-muted-foreground">
                              {' '}
                              (suggested {credits(ap.suggestedCreditsX100)})
                            </span>
                          )}
                      </td>
                      <td className="pr-2">{ap.categoryKey ?? '—'}</td>
                      <td className="pr-2">
                        <Badge
                          tone={
                            ap.status === 'accepted'
                              ? 'ok'
                              : ap.status === 'rejected'
                                ? 'bad'
                                : ap.status === 'submitted'
                                  ? 'warn'
                                  : 'muted'
                          }
                        >
                          {ap.status}
                        </Badge>
                      </td>
                      <td className="pr-2">
                        {ap.issuerReference ??
                          (ap.status === 'claimed' || ap.status === 'submitted' ? (
                            <Input
                              className="h-7 w-28 text-xs"
                              placeholder="ref"
                              value={refs[ap.id] ?? ''}
                              onChange={(e) => setRefs({ ...refs, [ap.id]: e.target.value })}
                            />
                          ) : (
                            '—'
                          ))}
                      </td>
                      <td className="space-x-1 whitespace-nowrap">
                        {ap.status === 'claimed' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              patch.mutate({
                                id: ap.id,
                                status: 'submitted',
                                issuerReference: refs[ap.id],
                              })
                            }
                          >
                            submitted
                          </Button>
                        )}
                        {ap.status === 'submitted' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                patch.mutate({
                                  id: ap.id,
                                  status: 'accepted',
                                  issuerReference: refs[ap.id],
                                })
                              }
                            >
                              accepted
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => patch.mutate({ id: ap.id, status: 'rejected' })}
                            >
                              rejected
                            </Button>
                          </>
                        )}
                        {ap.status === 'rejected' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => patch.mutate({ id: ap.id, status: 'claimed' })}
                          >
                            re-claim
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {apps.data && (
          <Pagination
            page={list.page}
            pages={apps.data.pages}
            perPage={list.perPage}
            total={apps.data.total}
            hrefFor={list.hrefFor}
            label="Credit application pages"
          />
        )}
        <ErrorText error={patch.error} />
      </Card>

      {cycle.status !== 'open' && (
        <p className="text-xs text-muted-foreground">
          This cycle is {cycle.status}. Its applications and pinned rule version are kept as
          history.
        </p>
      )}
      {cycle.status === 'open' && (
        <Card>
          <h3 className="mb-1 font-semibold">Renewal</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            When the issuer confirms renewal, close this cycle. The next one starts {cycle.endsOn}{' '}
            and pins the current rule version.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Renewed on">
              <Input type="date" value={renewedOn} onChange={(e) => setRenewedOn(e.target.value)} />
            </Field>
            <Button
              variant="outline"
              disabled={!renewedOn || renew.isPending}
              onClick={() => {
                if (confirm('Close this cycle as renewed and open the next?')) renew.mutate();
              }}
            >
              Record renewal
            </Button>
          </div>
          <ErrorText error={renew.error} />
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Fee shown from catalog:{' '}
        {h.certification.requirement?.feeAmountCents
          ? money(
              h.certification.requirement.feeAmountCents,
              h.certification.requirement.feeCurrency ?? 'USD',
            )
          : 'none'}{' '}
        · membership on file: {memberships.data?.some((m) => m.bodyId === h.body.id) ? 'yes' : 'no'}
      </p>
    </div>
  );
}

function ConstraintRow({
  c,
  unit,
  onPay,
  payOn,
  setPayOn,
  feeCents,
  feeCurrency,
}: {
  c: ConstraintResult;
  unit: string;
  onPay?: (() => void) | undefined;
  payOn: string;
  setPayOn: (v: string) => void;
  feeCents: number | null;
  feeCurrency: string;
}) {
  const tone = c.satisfied ? 'ok' : c.overdue ? (c.severity === 'hard' ? 'bad' : 'warn') : 'muted';
  const against = constraintAgainst(c);
  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{c.satisfied ? 'met' : c.overdue ? 'overdue' : 'open'}</Badge>
        <span className="font-medium">
          {LABEL[c.type] ?? c.type}
          {c.year ? ` — year ${c.year}` : ''}
          {c.category ? ` — ${c.category}` : ''}
          {c.activityType ? ` — ${c.activityType}` : ''}
        </span>
        {c.severity === 'soft' && (
          <span className="text-xs text-muted-foreground">(suggested, not required)</span>
        )}
        {against && (
          <span className="text-xs text-muted-foreground">
            <span className="num">{against.text}</span> {unit}
            {against.surplus && <span className="num"> · {against.surplus}</span>}
          </span>
        )}
        {c.due && !c.satisfied && (
          <span className="text-xs text-muted-foreground">
            due <span className="num">{c.due}</span>
            {c.overdueDays ? ` (${relativeDays(-c.overdueDays).text})` : ''}
          </span>
        )}
        {c.note && <span className="text-xs text-muted-foreground">{c.note}</span>}
        {c.scope && (
          <span className="text-xs text-muted-foreground">
            {c.scope}
            {c.period ? ` · ${periodRange(c.period)}` : ''}
          </span>
        )}
      </div>
      {c.of && (
        <ul className="ml-4 mt-1 text-xs text-muted-foreground">
          {c.of.map((x, i) => (
            <li key={i}>
              {x.year ? `year ${x.year}` : (LABEL[x.type] ?? x.type)}:{' '}
              {x.actual != null ? constraintAgainst(x)?.text : ''}{' '}
              {x.satisfied ? '✓' : x.due ? `due ${x.due}` : '✗'}
            </li>
          ))}
        </ul>
      )}
      {onPay && (
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <Field label="Paid on">
            <Input
              type="date"
              className="h-7 w-40 text-xs"
              value={payOn}
              onChange={(e) => setPayOn(e.target.value)}
            />
          </Field>
          <Button size="sm" variant="outline" onClick={onPay}>
            Record fee paid{feeCents ? ` (${money(feeCents, feeCurrency)})` : ''}
          </Button>
        </div>
      )}
    </li>
  );
}

const CAPS = new Set(['category_max', 'activity_type_max']);

/**
 * A constraint's earned figure against its threshold, capped for display. For a minimum the excess
 * is surplus; for a cap it is the part that does not count. Null when the constraint has no numbers
 * (a cap without a max arrives as null from JSON).
 */
function constraintAgainst(c: ConstraintResult) {
  if (c.required == null || c.actual == null) return null;
  return CAPS.has(c.type)
    ? creditsAgainst(c.actual, c.required, 'over the cap, not counted')
    : creditsAgainst(c.actual, c.required, 'beyond this minimum');
}

/** Fee periods arrive as `start..endExclusive`. */
function periodRange(period: string) {
  const [start = '', end = ''] = period.split('..');
  return start && end ? dateRange(start, end) : period;
}
