import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Card, ErrorText, Field, Input, Textarea } from '@/components/ui';

const TEMPLATE = `certification,occurred_on,title,activity_type,minutes,item_count,credits,category,status,issuer_reference,provider
isc2/cissp,2025-08-01,Example course,attend_training,600,,10,A,accepted,ISC2-REF-EXAMPLE,Example provider
comptia/security-plus,2025-03-01,Example webinar,attend_webinar,60,,1,,accepted,,`;

export function ImportPage() {
  const qc = useQueryClient();
  const [filename, setFilename] = useState('history.csv');
  const [csv, setCsv] = useState('');
  const m = useMutation({
    mutationFn: () =>
      api<{ batchId: string; rows: number }>('/api/import', {
        method: 'POST',
        body: { filename, csv },
      }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const onFile = (f: File | undefined) => {
    if (!f) return;
    setFilename(f.name);
    f.text().then(setCsv);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card>
        <h2 className="mb-1 font-semibold">Import history</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Backfill credits you have already submitted. Rows become activities with accepted (by
          default) credit applications in the cycle that contains the date. The whole file is
          rejected if any row is invalid. The file never leaves your browser except as the JSON sent
          to this instance; keep it out of git.
        </p>
        <div className="space-y-3">
          <Field label="CSV file">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </Field>
          <Field label="Or paste">
            <Textarea
              className="min-h-40 font-mono text-xs"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
            />
          </Field>
          <Field label="Name">
            <Input value={filename} onChange={(e) => setFilename(e.target.value)} />
          </Field>
          <Button disabled={!csv.trim() || m.isPending} onClick={() => m.mutate()}>
            Import
          </Button>
          <ErrorText error={m.error} />
          {m.data && <p className="text-sm text-emerald-700">Imported {m.data.rows} rows.</p>}
        </div>
      </Card>
      <Card>
        <h3 className="mb-1 font-semibold">Format</h3>
        <p className="mb-2 text-xs text-muted-foreground">
          Header row required. Columns: <code>certification</code> (catalog id such as{' '}
          <code>isc2/cissp</code>) or <code>held_cert_id</code>; <code>occurred_on</code>{' '}
          (YYYY-MM-DD); <code>title</code>; <code>activity_type</code> (canonical key, defaults to
          other); <code>minutes</code>; <code>item_count</code>; <code>credits</code> (decimal);{' '}
          <code>category</code>; <code>status</code> (accepted default; claimed / submitted /
          rejected); <code>issuer_reference</code>; <code>provider</code>.
        </p>
        <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px]">{TEMPLATE}</pre>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setCsv(TEMPLATE)}>
          Use template
        </Button>
      </Card>
    </div>
  );
}
