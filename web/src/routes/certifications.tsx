import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api, fmtMoney } from '@/lib/api';
import type { Body, Held, Membership } from '@/lib/types';
import { Badge, Button, Card, ErrorText, Field, Input, Select } from '@/components/ui';

export function Certifications() {
  const qc = useQueryClient();
  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api<{ bodies: Body[] }>('/api/catalog'),
  });
  const held = useQuery({ queryKey: ['held'], queryFn: () => api<Held[]>('/api/held') });
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
  const selected = bodies.flatMap((b) => b.certifications).find((c) => c.id === certificationId);

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <Card>
          <h2 className="mb-3 font-semibold">Held certifications</h2>
          {held.data?.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          <ul className="divide-y">
            {held.data?.map((h) => {
              const open = h.cycles.find((c) => c.status === 'open');
              return (
                <li key={h.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{h.certification.abbreviation}</span>
                  <span className="text-muted-foreground">{h.body.name}</span>
                  <Badge>{h.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    earned {h.earnedOn}
                    {h.certNumber ? ` · #${h.certNumber}` : ''}
                  </span>
                  <span className="ml-auto flex flex-wrap gap-2 text-xs">
                    {h.cycles
                      .filter((c) => c.status !== 'open')
                      .map((c) => (
                        <Link
                          key={c.id}
                          className="text-muted-foreground underline"
                          to={`/cycles/${c.id}`}
                        >
                          cycle {c.sequence} ({c.status})
                        </Link>
                      ))}
                    {open ? (
                      <Link className="underline" to={`/cycles/${open.id}`}>
                        cycle {open.sequence}: {open.startsOn} → {open.endsOn}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">no cycle</span>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (
                        confirm(
                          `Remove ${h.certification.abbreviation} and all its cycles and credit applications?`,
                        )
                      )
                        removeHeld.mutate(h.id);
                    }}
                  >
                    remove
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">Memberships</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Needed where the maintenance fee is per membership rather than per certification (e.g.
            the ISC2 AMF).
          </p>
          <ul className="mb-3 divide-y">
            {memberships.data?.map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="font-medium">
                  {bodies.find((b) => b.id === m.bodyId)?.name ?? m.bodyId}
                </span>
                <span className="text-xs text-muted-foreground">
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
            <p className="text-xs text-muted-foreground">
              {selected.requirement
                ? `${selected.requirement.totalCreditsX100 / 100} ${selected.creditUnitLabel} per ${selected.requirement.cycleMonths}-month cycle` +
                  (selected.requirement.annualMinX100
                    ? `; ${selected.requirement.annualMinX100 / 100}/yr ${selected.requirement.annualMinSeverity === 'soft' ? 'suggested' : 'required'}`
                    : '') +
                  (selected.requirement.feeAmountCents
                    ? `; fee ${fmtMoney(selected.requirement.feeAmountCents, selected.requirement.feeCurrency ?? 'USD')} per ${selected.requirement.feePeriodMonths} months`
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
          <Button type="submit" disabled={!certificationId || !earnedOn || addHeld.isPending}>
            Add
          </Button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">
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
  );
}
