import type { Db } from '../db/client';
import type { Clock, Principal } from '../ports';
import type { LocalAuth } from '../adapters/shared/local-auth';

export interface AppContext {
  db: Db;
  clock: Clock;
  auth: LocalAuth;
}

export type Vars = { Variables: { ctx: AppContext; principal: Principal | null } };

export const today = (clock: Clock) => clock.now().toISOString().slice(0, 10);
export const newId = () => crypto.randomUUID();
