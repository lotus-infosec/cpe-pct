import { Hono } from 'hono';
import { today, type Vars } from '../context';
import { validList } from '../query';
import { filterSortPage, heldListQuery, heldSummaries, standingCounts } from '../held-list';

const dashboardList = heldListQuery({ sort: 'severity', dir: 'desc' });

// Same contract as /api/held, always with standing, plus counts per standing over the whole set.
export const dashboard = new Hono<Vars>().get('/', validList(dashboardList), async (c) => {
  const { db, clock } = c.get('ctx');
  const asOf = today(clock);
  const all = await heldSummaries(db, asOf, { withStanding: true });
  return c.json({
    asOf,
    counts: standingCounts(all),
    ...filterSortPage(all, c.req.valid('query')),
  });
});
