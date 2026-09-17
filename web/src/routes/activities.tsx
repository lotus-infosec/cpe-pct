import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { count, credits } from '@/lib/format';
import { fetchAll, useList, useListQuery } from '@/lib/list';
import {
  BulkDeleteDialog,
  ExportStatusLine,
  PageCheckbox,
  SelectionBar,
  useActivitySelection,
  useSelectionExport,
  type ActivityFilterBody,
} from '@/components/bulk-delete';
import { options } from '@/lib/labels';
import type { Activity, ActivityRow, ActivityType, Held } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Badge,
  CertLink,
  Button,
  Dialog,
  ErrorText,
  Field,
  FilterChips,
  FilterSelect,
  Input,
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
  Textarea,
  Th,
  THead,
  Toolbar,
  Tr,
  type Chip,
} from '@/components/ui';

const SORTS = ['occurredOn', 'title', 'credits', 'createdAt'] as const;
type Sort = (typeof SORTS)[number];
const STATUS = { draft: 'Draft', logged: 'Logged' } as const;

export function Activities() {
  const qc = useQueryClient();
  const [logging, setLogging] = useState(false);
  const types = useQuery({
    queryKey: ['activity-types'],
    queryFn: () => api<ActivityType[]>('/api/catalog/activity-types'),
  });
  const held = useQuery({
    queryKey: ['held', 'all'],
    queryFn: () => fetchAll<Held>('/api/held?view=basic'),
  });
  const list = useList({
    sorts: SORTS,
    defaultSort: 'occurredOn',
    defaultDir: 'desc',
    filters: { type: null, status: Object.keys(STATUS), from: null, to: null },
  });
  const q = useListQuery<ActivityRow, Sort, 'type' | 'status' | 'from' | 'to'>(
    'activities',
    '/api/activities',
    list,
  );
  const data = q.data;
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/activities/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const filterBody: ActivityFilterBody = {
    ...(list.q.trim() && { q: list.q.trim() }),
    ...list.filters,
  };
  const sel = useActivitySelection(filterBody, data?.total);
  const pageIds = data?.rows.map((r) => r.id) ?? [];
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const exp = useSelectionExport();
  const typeLabel = (key: string) => types.data?.find((t) => t.key === key)?.label ?? key;
  const heldById = (heldId: string) => held.data?.find((h) => h.id === heldId);

  const chips: Chip[] = [
    list.q && { key: 'q', label: `Search: ${list.q}`, onRemove: () => list.set({ q: '' }) },
    list.filters.type && {
      key: 'type',
      label: typeLabel(list.filters.type),
      onRemove: () => list.set({ type: '' }),
    },
    list.filters.status && {
      key: 'status',
      label: STATUS[list.filters.status as keyof typeof STATUS],
      onRemove: () => list.set({ status: '' }),
    },
    list.filters.from && {
      key: 'from',
      label: `From ${list.filters.from}`,
      onRemove: () => list.set({ from: '' }),
    },
    list.filters.to && {
      key: 'to',
      label: `To ${list.filters.to}`,
      onRemove: () => list.set({ to: '' }),
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
        title="Activities"
        description="Everything you have done that might earn credit, and where that credit went."
        actions={
          <Button variant="primary" onClick={() => setLogging(true)}>
            <Plus aria-hidden strokeWidth={1.5} />
            Log an activity
          </Button>
        }
      />
      <LogActivityDialog open={logging} onClose={() => setLogging(false)} types={types.data} />
      <BulkDeleteDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        selection={sel.body}
        onDeleted={(r) => {
          setConfirming(false);
          sel.clear();
          setResult(
            `Deleted ${count(r.deleted)} ${r.deleted === 1 ? 'activity' : 'activities'} and ${count(r.applicationsRemoved)} credit applications.` +
              (r.refused.length
                ? ` ${count(r.refused.length)} with submitted or accepted credit ${r.refused.length === 1 ? 'was' : 'were'} kept.`
                : ''),
          );
        }}
      />

      <Toolbar
        label="Activity filters"
        end={<ResultCount page={list.page} perPage={list.perPage} total={data?.total} />}
      >
        <SearchField
          label="Search activities"
          placeholder="Title, provider or notes"
          value={list.q}
          onCommit={(v) => list.set({ q: v })}
        />
        <FilterSelect
          label="Type"
          value={list.filters.type}
          options={(types.data ?? []).map((t) => ({ value: t.key, label: t.label }))}
          onChange={(v) => list.set({ type: v })}
        />
        <FilterSelect
          label="Status"
          value={list.filters.status}
          options={options(STATUS)}
          onChange={(v) => list.set({ status: v })}
        />
        <DateFilter
          label="From"
          value={list.filters.from}
          onChange={(v) => list.set({ from: v })}
        />
        <DateFilter label="To" value={list.filters.to} onChange={(v) => list.set({ to: v })} />
        <PerPageSelect value={list.perPage} onChange={(n) => list.set({ per_page: n })} />
      </Toolbar>
      <FilterChips chips={chips} onClearAll={list.clear} />

      {result && (
        <p role="status" className="flex items-center gap-2 text-sm text-ok">
          {result}
          <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
            Dismiss
          </Button>
        </p>
      )}
      {data && (
        <SelectionBar
          sel={sel}
          pageIds={pageIds}
          total={data.total}
          narrowed={list.narrowed}
          onDelete={() => {
            setResult(null);
            setConfirming(true);
          }}
          onExport={() => sel.body && exp.start.mutate(sel.body)}
          exporting={exp.start.isPending || exp.status?.status === 'building'}
        />
      )}
      <ExportStatusLine exp={exp} />
      {q.isPending && <Skeleton rows={8} />}
      {q.isError && <ErrorText error={q.error} />}
      <ErrorText error={remove.error} />
      {data && data.total === 0 && (
        <ListEmpty
          narrowed={list.narrowed}
          onClear={list.clear}
          noun="activities"
          emptyTitle="Nothing logged yet"
          emptyDescription="Log a course, a conference or a book, then confirm which certifications it counts toward."
          emptyAction={
            <Button variant="primary" size="sm" onClick={() => setLogging(true)}>
              Log an activity
            </Button>
          }
        />
      )}
      {data && data.rows.length > 0 && (
        <div className={cn(q.isPlaceholderData && 'opacity-60')}>
          <Table label="Activities">
            <THead>
              <tr>
                <Th className="w-10">
                  <PageCheckbox sel={sel} pageIds={pageIds} />
                </Th>
                {sortTh('title', 'Activity', 'asc')}
                {sortTh('occurredOn', 'Date', 'desc')}
                <Th>Type</Th>
                {sortTh('credits', 'Credits', 'desc', 'text-right')}
                <Th>Applied to</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {data.rows.map((a) => (
                <Tr key={a.id} className={cn(sel.has(a.id) && 'bg-accent/5')}>
                  <Td>
                    <input
                      type="checkbox"
                      className="size-4 align-middle"
                      checked={sel.has(a.id)}
                      onChange={() => undefined}
                      onClick={(e) => sel.toggle(a.id, pageIds, e)}
                      aria-label={`Select ${a.title}`}
                    />
                  </Td>
                  <Td className="max-w-80">
                    <Link
                      className="block truncate font-medium text-fg underline-offset-2 hover:text-accent hover:underline"
                      to={`/activities/${a.id}`}
                      title={a.title}
                    >
                      {a.title}
                    </Link>
                    {a.provider && (
                      <span className="block truncate text-xs text-dim">{a.provider}</span>
                    )}
                  </Td>
                  <Td className="num whitespace-nowrap">{a.occurredOn}</Td>
                  <Td className="whitespace-nowrap text-dim">
                    {typeLabel(a.activityType)}
                    {a.durationMinutes ? (
                      <span className="num block text-xs">{a.durationMinutes} min</span>
                    ) : null}
                  </Td>
                  <Td numeric>{a.creditTotalX100 ? credits(a.creditTotalX100) : ''}</Td>
                  <Td className="text-xs">
                    {Object.keys(a.appliedTo).length > 0 ? (
                      <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {Object.entries(a.appliedTo).map(([heldId, x100]) => (
                          <span key={heldId} className="num whitespace-nowrap text-dim">
                            <CertLink cycles={heldById(heldId)?.cycles}>
                              {heldById(heldId)?.certification.abbreviation ?? '?'}
                            </CertLink>{' '}
                            {credits(x100)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-dim">none</span>
                    )}
                  </Td>
                  <Td>
                    <span className="flex gap-1">
                      <Badge tone={a.status === 'logged' ? 'ok' : 'warn'}>{STATUS[a.status]}</Badge>
                      {a.source !== 'manual' && <Badge>{a.source}</Badge>}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Delete "${a.title}" and its credit applications?`))
                          remove.mutate(a.id);
                      }}
                    >
                      Delete
                      <span className="sr-only"> {a.title}</span>
                    </Button>
                  </Td>
                </Tr>
              ))}
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
          label="Activity pages"
        />
      )}
    </div>
  );
}

function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm text-dim max-sm:[&>input]:flex-1">
      {label}
      <Input
        type="date"
        className="w-auto"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

const BLANK = {
  title: '',
  occurredOn: '',
  activityType: 'attend_training',
  provider: '',
  durationMinutes: '',
  itemCount: '1',
  description: '',
};

function LogActivityDialog({
  open,
  onClose,
  types,
}: {
  open: boolean;
  onClose: () => void;
  types: ActivityType[] | undefined;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [f, setF] = useState(BLANK);
  const type = types?.find((t) => t.key === f.activityType);
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
      setF(BLANK);
      onClose();
      nav(`/activities/${a.id}`);
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log an activity"
      description="Saving opens the fan-out, where you confirm which certifications it counts toward."
    >
      <form
        id="log-activity"
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
            maxLength={300}
            required
          />
        </Field>
        <Field label="Type">
          <Select
            value={f.activityType}
            onChange={(e) => setF({ ...f, activityType: e.target.value })}
          >
            {types?.map((t) => (
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
          <Input
            value={f.provider}
            maxLength={300}
            onChange={(e) => setF({ ...f, provider: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <Textarea
            value={f.description}
            maxLength={5000}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        {f.activityType === 'other' && (
          <p className="text-xs text-warn">
            "Other" never gets automatic suggestions; every credit you apply will need a reason.
          </p>
        )}
        <ErrorText error={create.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={create.isPending}>
            Save and see fan-out
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
