import type { Clock } from '../../ports';

export const systemClock: Clock = { now: () => new Date() };
