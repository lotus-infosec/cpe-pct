import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, Card, ErrorText, Field, Input } from '@/components/ui';

/** Gate: /setup when no owner exists, /login when unauthenticated, children otherwise. */
export function AuthGate({ children }: { children: ReactNode }) {
  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: () => api<{ setUp: boolean }>('/api/setup'),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ id: string }>('/api/me'),
    retry: false,
    enabled: setup.data?.setUp === true,
  });
  if (setup.isPending) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (setup.isError) return <p className="p-6 text-sm text-bad">Cannot reach the API.</p>;
  if (!setup.data.setUp) return <PasswordForm mode="setup" />;
  if (me.isPending) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (me.isError) return <PasswordForm mode="login" />;
  return <>{children}</>;
}

function PasswordForm({ mode }: { mode: 'setup' | 'login' }) {
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const m = useMutation({
    mutationFn: () => api(`/api/${mode}`, { method: 'POST', body: { password } }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'setup' && password !== confirm) return;
    m.mutate();
  };
  return (
    <div className="mx-auto mt-16 max-w-sm px-4">
      <Card>
        <h1 className="mb-1 text-lg font-semibold">
          {mode === 'setup' ? 'Set up CPE PCT' : 'Log in'}
        </h1>
        <p className="mb-4 text-sm text-muted-foreground">
          {mode === 'setup'
            ? 'Single owner. Choose a password of at least 12 characters. Nothing leaves this instance.'
            : 'Enter the owner password.'}
        </p>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Password">
            <Input
              type="password"
              autoFocus
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {mode === 'setup' && (
            <Field label="Confirm">
              <Input
                type="password"
                minLength={12}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
          )}
          {mode === 'setup' && confirm && confirm !== password && (
            <p className="text-xs text-bad">Passwords differ.</p>
          )}
          <ErrorText error={m.error} />
          <Button variant="primary" type="submit" disabled={m.isPending || password.length < 12}>
            {mode === 'setup' ? 'Create owner account' : 'Log in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
