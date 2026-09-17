import type { Builder } from './types';
import { isc2 } from './isc2';
import { comptia } from './comptia';

/** One builder per body key. Bodies without a builder get the generic CSV. */
export const builders: Record<string, Builder> = { isc2, comptia };
export { generic } from './generic';
export { selectionBundle } from './selection';
export type { ExportInput, ExportApplication, SelectionActivity, SelectionInput } from './types';
