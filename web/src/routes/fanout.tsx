import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { api, fmtCredits } from '@/lib/api';
import type { Fanout, Held, Standing } from '@/lib/types';
import { Badge, Button, Card, ErrorText, Input } from '@/components/ui';

interface Row {
  heldCertId: string;
  label: string;
  include: boolean;
  creditsX100: number;
  suggested: number | null;
  categoryKey: string | null;
  overrideReason: string;
  explain: string[];
  warnings: string[];
  coveredBy: string | null;
  kind: 'credit' | 'renewal' | 'none';
}

export function FanoutPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['fanout', id],
    queryFn: () => api<Fanout>(`/api/activities/${id}/fanout`),
  });
  const held = useQuery({ queryKey: ['held'], queryFn: () => api<Held[]>('/api/held') });
  const [rows, setRows] = useState<Row[]>([]);
  const [showCovered, setShowCovered] = useState(false);
  const abbr = (heldId: string) =>
    held.data?.find((h) => h.id === heldId)?.certification.abbreviation ?? heldId;

  useEffect(() => {
    if (!q.data || !held.data) return;
    const existing = new Map(q.data.existing.map((e) => [e.heldCertId, e]));
    const fromSuggestions: Row[] = q.data.suggestions.map((s) => {
      const ex = existing.get(s.heldCertId);
      return {
        heldCertId: s.heldCertId,
        label: `${abbr(s.heldCertId)}`,
        kind: s.kind,
        include: s.kind === 'credit' && !s.coveredBy,
        creditsX100: ex?.creditsX100 ?? s.creditsX100,
        suggested: s.creditsX100,
        categoryKey: ex?.categoryKey ?? s.categoryKey,
        overrideReason: ex?.overrideReason ?? '',
        explain: s.explain,
        warnings: s.warnings,
        coveredBy: s.coveredBy,
      };
    });
    const manual: Row[] = q.data.heldWithoutSuggestion
      .filter((h) => h.cycle)
      .map((h) => ({
        heldCertId: h.heldCertId,
        label: abbr(h.heldCertId),
        kind: 'none',
        include: existing.has(h.heldCertId),
        creditsX100: existing.get(h.heldCertId)?.creditsX100 ?? 0,
        suggested: null,
        categoryKey: existing.get(h.heldCertId)?.categoryKey ?? null,
        overrideReason: existing.get(h.heldCertId)?.overrideReason ?? '',
        explain: ['No rule at this body for this activity type.'],
        warnings: [],
        coveredBy: null,
      }));
    setRows([...fromSuggestions, ...manual]);
  }, [q.data, held.data]);

  const apply = useMutation({
    mutationFn: () =>
      api<{ standings: Standing[] }>(`/api/activities/${id}/applications`, {
        method: 'POST',
        body: {
          applications: rows
            .filter((r) => r.include && r.kind !== 'renewal')
            .map((r) => ({
              heldCertId: r.heldCertId,
              creditsX100: r.creditsX100,
              categoryKey: r.categoryKey,
              ...(r.overrideReason && { overrideReason: r.overrideReason }),
            })),
        },
      }),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (q.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.isError) return <p className="text-sm text-red-600">Not found.</p>;
  const a = q.data.activity;
  const update = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const changed = (r: Row) => r.suggested == null || r.creditsX100 !== r.suggested;
  const blocked = rows.some(
    (r) => r.include && r.kind !== 'renewal' && changed(r) && !r.overrideReason.trim(),
  );
  const visible = rows.filter((r) => showCovered || !r.coveredBy);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{a.title}</h2>
          <span className="text-sm text-muted-foreground">
            {a.occurredOn} · {a.activityType}
            {a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}
            {a.itemCount && a.itemCount > 1 ? ` · ×${a.itemCount}` : ''}
          </span>
          <Badge tone={a.status === 'logged' ? 'ok' : 'warn'}>{a.status}</Badge>
          <Link to="/activities" className="ml-auto text-xs underline">
            back
          </Link>
        </div>
      </Card>
      <Card>
        <h3 className="mb-1 font-semibold">Credit fan-out</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          One row per held certification with an open cycle on that date. Suggested values come from
          the pinned rule version; change a value and you must say why. Nothing is applied until you
          confirm.
        </p>
        {rows.some((r) => r.coveredBy) && (
          <button className="mb-2 text-xs underline" onClick={() => setShowCovered(!showCovered)}>
            {showCovered ? 'Hide' : 'Show'} {rows.filter((r) => r.coveredBy).length} covered by a
            higher certification
          </button>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-2">Apply</th>
                <th className="pr-2">Certification</th>
                <th className="pr-2">Suggested</th>
                <th className="pr-2">Credits</th>
                <th className="pr-2">Category</th>
                <th className="pr-2">Reason for change</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const i = rows.indexOf(r);
                return (
                  <tr key={r.heldCertId} className="border-t align-top">
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={r.include}
                        disabled={r.kind === 'renewal'}
                        onChange={(e) => update(i, { include: e.target.checked })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{r.label}</div>
                      {r.kind === 'renewal' && (
                        <Badge tone="ok">
                          renews this certification — record it on the cycle page
                        </Badge>
                      )}
                      {r.coveredBy && <Badge>covered by {abbr(r.coveredBy)}</Badge>}
                      <ul className="mt-1 text-[11px] text-muted-foreground">
                        {r.explain.map((x, k) => (
                          <li key={k}>{x}</li>
                        ))}
                      </ul>
                      {r.warnings
                        .filter((w) => w !== 'evidence_required')
                        .map((w) => (
                          <Badge key={w} tone="warn">
                            {w.replace(/_/g, ' ')}
                          </Badge>
                        ))}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {r.suggested == null ? '—' : fmtCredits(r.suggested)}
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        type="number"
                        step="0.25"
                        min={0}
                        className="w-24"
                        value={r.creditsX100 / 100}
                        disabled={r.kind === 'renewal'}
                        onChange={(e) =>
                          update(i, { creditsX100: Math.round(Number(e.target.value) * 100) })
                        }
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <Input
                        className="w-16"
                        value={r.categoryKey ?? ''}
                        placeholder="—"
                        onChange={(e) => update(i, { categoryKey: e.target.value || null })}
                      />
                    </td>
                    <td className="py-2 pr-2">
                      {r.include && changed(r) && r.kind !== 'renewal' && (
                        <Input
                          placeholder="required"
                          value={r.overrideReason}
                          onChange={(e) => update(i, { overrideReason: e.target.value })}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No held certification has an open cycle covering {a.occurredOn}.
          </p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <Button
            onClick={() => apply.mutate()}
            disabled={blocked || apply.isPending || !rows.some((r) => r.include)}
          >
            Confirm and apply as claimed
          </Button>
          {blocked && (
            <span className="text-xs text-amber-700">A changed value needs a reason.</span>
          )}
          <ErrorText error={apply.error} />
        </div>
        {apply.data && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {apply.data.standings.map((s) => (
              <div key={s.cycleId} className="rounded border p-2 text-xs">
                <Link className="underline" to={`/cycles/${s.cycleId}`}>
                  {abbr(held.data?.find((h) => h.cycles.some((c) => c.id === s.cycleId))?.id ?? '')}{' '}
                  cycle
                </Link>
                :{' '}
                <Badge tone={s.compliant ? 'ok' : 'bad'}>
                  {s.compliant ? 'in good standing' : 'action needed'}
                </Badge>{' '}
                {fmtCredits(s.totals.accepted + s.totals.submitted + s.totals.claimed)} /{' '}
                {fmtCredits(s.requiredX100)}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
