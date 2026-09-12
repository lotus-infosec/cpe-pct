import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, fmtCredits } from '@/lib/api';
import type { DashboardItem } from '@/lib/types';
import { Badge, Card } from '@/components/ui';

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

export function Dashboard() {
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<{ asOf: string; items: DashboardItem[] }>('/api/dashboard'),
  });
  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.isError) return <p className="text-sm text-red-600">Failed to load.</p>;
  if (q.data.items.length === 0)
    return (
      <Card>
        <p className="text-sm">
          No certifications yet.{' '}
          <Link className="underline" to="/certifications">
            Add the ones you hold.
          </Link>
        </p>
      </Card>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {q.data.items.map((it) => {
        const st = it.standing;
        const earned = st ? st.totals.accepted + st.totals.submitted + st.totals.claimed : 0;
        const pct =
          st && st.requiredX100 > 0
            ? Math.min(100, Math.round((earned / st.requiredX100) * 100))
            : 0;
        const stale =
          it.ruleVersion &&
          Date.now() - new Date(it.ruleVersion.verifiedOn).getTime() > 365 * 86_400_000;
        return (
          <Card key={it.held.id}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">
                  {it.certification.abbreviation}{' '}
                  <span className="font-normal text-muted-foreground">· {it.body.name}</span>
                </h2>
                <p className="text-xs text-muted-foreground">{it.certification.name}</p>
              </div>
              {st ? (
                <Badge tone={st.compliant ? 'ok' : 'bad'}>
                  {st.compliant ? 'in good standing' : 'action needed'}
                </Badge>
              ) : (
                <Badge>no cycle</Badge>
              )}
            </div>
            {it.cycle && st && (
              <>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>
                    {fmtCredits(earned)} / {fmtCredits(st.requiredX100)}{' '}
                    {it.certification.creditUnitLabel}
                  </span>
                  <span>
                    {st.daysRemaining} days left · ends {it.cycle.endsOn}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded bg-muted">
                  <div
                    className={`h-full ${st.compliant ? 'bg-emerald-500' : 'bg-red-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  accepted {fmtCredits(st.totals.accepted)} · submitted{' '}
                  {fmtCredits(st.totals.submitted)} · claimed {fmtCredits(st.totals.claimed)}
                </p>
                {st.failing.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {st.failing.map((f, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <Badge
                          tone={f.overdue ? (f.severity === 'hard' ? 'bad' : 'warn') : 'muted'}
                        >
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
                  <p className="mt-1 text-xs text-amber-700">
                    Behind pace for: {st.projectedAtCycleEnd.map((t) => LABEL[t] ?? t).join(', ')}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <Link className="underline" to={`/cycles/${it.cycle.id}`}>
                    Standing detail
                  </Link>
                  {it.ruleVersion && (
                    <span className="text-muted-foreground">
                      rules v{it.ruleVersion.version}, verified {it.ruleVersion.verifiedOn}
                    </span>
                  )}
                  {stale && <Badge tone="warn">rules verified over a year ago</Badge>}
                </div>
              </>
            )}
            {!it.cycle && (
              <p className="text-xs text-muted-foreground">
                No renewal cycle: this credential has no CE requirement of its own.
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
