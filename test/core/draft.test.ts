import { describe, expect, it } from 'vitest';
import { draft } from '../../src/core/intake/draft';
import { nextCron, backoffMs } from '../../src/core/jobs/runner';

describe('intake.draft()', () => {
  it('fills title, date, provider, duration, credits hint from a typical certificate', () => {
    const d = draft(
      'Certificate of Completion This certifies that Test Holder completed Incident Response Fundamentals Provider: Example Training Co Date: March 14, 2026 Duration: 3.5 hours Credits: 3.5 CPE',
    );
    expect(d.occurredOn).toBe('2026-03-14');
    expect(d.durationMinutes).toBe(210);
    expect(d.provider).toBe('Example Training Co');
    expect(d.title).toBe('Incident Response Fundamentals');
    expect(d.creditsHint).toBe(3.5);
    expect(d.from).toMatchObject({
      occurredOn: 'extracted',
      durationMinutes: 'extracted',
      provider: 'extracted',
      title: 'extracted',
    });
  });
  it('leaves the date blank when several unlabelled dates appear', () => {
    const d = draft('Session 1 on 2026-01-05 and session 2 on 2026-01-12, thanks for attending');
    expect(d.occurredOn).toBeUndefined();
  });
  it('prefers a labelled completion date', () => {
    const d = draft('Registered 2026-01-05. Completed on 2026-02-20. Duration 90 minutes. webinar');
    expect(d.occurredOn).toBe('2026-02-20');
    expect(d.durationMinutes).toBe(90);
    expect(d.activityType).toBe('attend_webinar');
  });
  it('never guesses from noise', () => {
    const d = draft('lorem ipsum dolor sit amet');
    expect(d).toEqual({ from: {} });
  });
});

describe('cron dialect', () => {
  const from = new Date('2026-09-12T10:07:30Z');
  it('every N minutes', () =>
    expect(nextCron('*/5 * * * *', from)?.toISOString()).toBe('2026-09-12T10:10:00.000Z'));
  it('hourly at minute', () =>
    expect(nextCron('30 * * * *', from)?.toISOString()).toBe('2026-09-12T10:30:00.000Z'));
  it('daily at H:M', () =>
    expect(nextCron('0 6 * * *', from)?.toISOString()).toBe('2026-09-13T06:00:00.000Z'));
  it('unsupported → null', () => expect(nextCron('0 6 * * 1', from)).toBeNull());
  it('backoff grows and caps', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});
