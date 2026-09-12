import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api, fmtCredits } from '@/lib/api';
import type { Activity, ActivityType, Held } from '@/lib/types';
import { Badge, Button, Card, ErrorText, Field, Input, Select, Textarea } from '@/components/ui';

export function Activities() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['activities'],
    queryFn: () => api<Activity[]>('/api/activities'),
  });
  const types = useQuery({
    queryKey: ['activity-types'],
    queryFn: () => api<ActivityType[]>('/api/catalog/activity-types'),
  });
  const held = useQuery({ queryKey: ['held'], queryFn: () => api<Held[]>('/api/held') });
  const [f, setF] = useState({
    title: '',
    occurredOn: '',
    activityType: 'attend_training',
    provider: '',
    durationMinutes: '',
    itemCount: '1',
    description: '',
  });
  const type = types.data?.find((t) => t.key === f.activityType);
  const create = useMutation({
    mutationFn: () =>
      api<Activity>('/api/activities', {
        method: 'POST',
        body: {
          title: f.title,
          occurredOn: f.occurredOn,
          activityType: f.activityType,
          ...(f.provider && { provider: f.provider }),
          ...(f.durationMinutes && { durationMinutes: Number(f.durationMinutes) }),
          ...(type?.itemBased && { itemCount: Number(f.itemCount) || 1 }),
          ...(f.description && { description: f.description }),
        },
      }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      nav(`/activities/${a.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/activities/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const abbr = (heldId: string) =>
    held.data?.find((h) => h.id === heldId)?.certification.abbreviation ?? '?';

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Card>
        <h2 className="mb-3 font-semibold">Log an activity</h2>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Title">
            <Input
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
              required
            />
          </Field>
          <Field label="Type">
            <Select
              value={f.activityType}
              onChange={(e) => setF({ ...f, activityType: e.target.value })}
            >
              {types.data?.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date (end date if multi-day)">
              <Input
                type="date"
                value={f.occurredOn}
                onChange={(e) => setF({ ...f, occurredOn: e.target.value })}
                required
              />
            </Field>
            {type?.itemBased ? (
              <Field label="Count">
                <Input
                  type="number"
                  min={1}
                  value={f.itemCount}
                  onChange={(e) => setF({ ...f, itemCount: e.target.value })}
                />
              </Field>
            ) : (
              <Field label="Minutes">
                <Input
                  type="number"
                  min={0}
                  value={f.durationMinutes}
                  onChange={(e) => setF({ ...f, durationMinutes: e.target.value })}
                />
              </Field>
            )}
          </div>
          {type?.itemBased && (
            <Field label="Minutes (optional; some bodies credit reading by time)">
              <Input
                type="number"
                min={0}
                value={f.durationMinutes}
                onChange={(e) => setF({ ...f, durationMinutes: e.target.value })}
              />
            </Field>
          )}
          <Field label="Provider">
            <Input value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} />
          </Field>
          <Field label="Notes">
            <Textarea
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
          {f.activityType === 'other' && (
            <p className="text-xs text-amber-700">
              "Other" never gets automatic suggestions; every credit you apply will need a reason.
            </p>
          )}
          <ErrorText error={create.error} />
          <Button type="submit" disabled={create.isPending}>
            Save and see fan-out
          </Button>
        </form>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Activities</h2>
        {list.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing logged yet.</p>
        )}
        <ul className="divide-y">
          {list.data?.map((a) => (
            <li key={a.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link className="font-medium underline" to={`/activities/${a.id}`}>
                  {a.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {a.occurredOn} ·{' '}
                  {types.data?.find((t) => t.key === a.activityType)?.label ?? a.activityType}
                  {a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}
                </span>
                <Badge tone={a.status === 'logged' ? 'ok' : 'warn'}>{a.status}</Badge>
                {a.source !== 'manual' && <Badge>{a.source}</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => {
                    if (confirm('Delete this activity and its credit applications?'))
                      remove.mutate(a.id);
                  }}
                >
                  delete
                </Button>
              </div>
              {a.applications.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.applications
                    .map(
                      (ap) =>
                        `${abbr(ap.heldCertId)} ${fmtCredits(ap.creditsX100)}${ap.categoryKey ? ` ${ap.categoryKey}` : ''} (${ap.status})`,
                    )
                    .join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
