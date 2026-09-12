import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api, fmtCredits, fmtMoney } from '@/lib/api';
import type {
  Activity,
  Application,
  ConstraintResult,
  Held,
  Membership,
  Standing,
} from '@/lib/types';
import { Badge, Button, Card, ErrorText, Field, Input } from '@/components/ui';

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
  const held = useQuery({ queryKey: ['held'], queryFn: () => api<Held[]>('/api/held') });
  const apps = useQuery({
    queryKey: ['applications', id],
    queryFn: () => api<Application[]>(`/api/applications?cycleId=${id}`),
  });
  const acts = useQuery({
    queryKey: ['activities'],
    queryFn: () => api<Activity[]>('/api/activities'),
  });
  const memberships = useQuery({
    queryKey: ['memberships'],
    queryFn: () => api<Membership[]>('/api/memberships'),
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
  if (st.isError || !h || !cycle) return <p className="text-sm text-red-600">Cycle not found.</p>;
  const s = st.data;
  const earned = s.totals.accepted + s.totals.submitted + s.totals.claimed;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">
            {h.certification.abbreviation} — cycle {cycle.sequence}
          </h2>
          <span className="text-sm text-muted-foreground">
            {cycle.startsOn} → {cycle.endsOn} · rules {cycle.ruleVersionId}
          </span>
          <Badge tone={s.compliant ? 'ok' : 'bad'}>
            {s.compliant ? 'in good standing' : 'action needed'}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            as of {s.asOf} · {s.daysRemaining} days remaining
          </span>
        </div>
        <p className="mt-2 text-sm">
          {fmtCredits(earned)} of {fmtCredits(s.requiredX100)} {h.certification.creditUnitLabel} —
          accepted {fmtCredits(s.totals.accepted)}, submitted {fmtCredits(s.totals.submitted)},
          claimed {fmtCredits(s.totals.claimed)}
        </p>
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
          <p className="mt-2 text-xs text-amber-700">
            At the current pace these will not be met by cycle end:{' '}
            {s.projectedAtCycleEnd.map((t) => LABEL[t] ?? t).join(', ')}.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 font-semibold">Credit applications</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          You submit to the issuer yourself; record the outcome here. claimed → submitted → accepted
          / rejected.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">Activity</th>
                <th className="pr-2">Date</th>
                <th className="pr-2">Credits</th>
                <th className="pr-2">Cat.</th>
                <th className="pr-2">Status</th>
                <th className="pr-2">Issuer ref.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {apps.data?.map((ap) => {
                const act = acts.data?.find((a) => a.id === ap.activityId);
                return (
                  <tr key={ap.id} className="border-t">
                    <td className="py-1 pr-2">
                      <Link className="underline" to={`/activities/${ap.activityId}`}>
                        {act?.title ?? ap.activityId}
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
                    <td className="pr-2 text-xs text-muted-foreground">{act?.occurredOn}</td>
                    <td className="pr-2 tabular-nums">
                      {fmtCredits(ap.creditsX100)}
                      {ap.suggestedCreditsX100 != null &&
                        ap.suggestedCreditsX100 !== ap.creditsX100 && (
                          <span className="text-[11px] text-muted-foreground">
                            {' '}
                            (suggested {fmtCredits(ap.suggestedCreditsX100)})
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
        {apps.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No credits applied to this cycle yet.</p>
        )}
        <ErrorText error={patch.error} />
      </Card>

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
          ? fmtMoney(
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
        {c.required != null && c.actual != null && (
          <span className="text-xs text-muted-foreground">
            {fmtCredits(c.actual)} / {fmtCredits(c.required)} {unit}
          </span>
        )}
        {c.due && !c.satisfied && (
          <span className="text-xs text-muted-foreground">
            due {c.due}
            {c.overdueDays ? ` (${c.overdueDays} days overdue)` : ''}
          </span>
        )}
        {c.note && <span className="text-xs text-muted-foreground">{c.note}</span>}
        {c.scope && (
          <span className="text-xs text-muted-foreground">
            {c.scope}
            {c.period ? ` · ${c.period.replace('..', ' → ')}` : ''}
          </span>
        )}
      </div>
      {c.of && (
        <ul className="ml-4 mt-1 text-xs text-muted-foreground">
          {c.of.map((x, i) => (
            <li key={i}>
              {x.year ? `year ${x.year}` : (LABEL[x.type] ?? x.type)}:{' '}
              {x.actual != null ? `${fmtCredits(x.actual)} / ${fmtCredits(x.required ?? 0)}` : ''}{' '}
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
            Record fee paid{feeCents ? ` (${fmtMoney(feeCents, feeCurrency)})` : ''}
          </Button>
        </div>
      )}
    </li>
  );
}
