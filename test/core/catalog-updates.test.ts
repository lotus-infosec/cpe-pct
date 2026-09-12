import { describe, expect, it } from 'vitest';
import { compareLocks } from '../../src/app/routes/catalog-updates';

const e = (v: string) => ({ hash: 'x', migration: 'm', verified_on: v });
describe('compareLocks()', () => {
  it('reports newer versions and unknown bodies, ignores older or equal', () => {
    const r = compareLocks(
      { 'isc2@1': e('2026-09-11'), 'comptia@1': e('2026-09-11') },
      {
        'isc2@1': e('2026-09-11'),
        'isc2@2': e('2027-01-01'),
        'comptia@1': e('2026-09-11'),
        'isaca@1': e('2026-09-12'),
      },
    );
    expect(r.updates).toEqual([
      { body: 'isc2', local: 1, remote: 2, verified_on: '2027-01-01' },
      { body: 'isaca', local: null, remote: 1, verified_on: '2026-09-12' },
    ]);
  });
  it('is empty when local is ahead or equal', () => {
    expect(compareLocks({ 'isc2@2': e('x') }, { 'isc2@1': e('y') }).updates).toEqual([]);
  });
});
