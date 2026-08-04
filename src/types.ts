/**
 * Grammar-level types only. Field whitelists stay in the repo that owns the table — they are
 * per-endpoint data, and centralising them would mean a package release for every new
 * filterable column.
 */

export type FilterOperator = 'eq' | 'ne' | 'contains' | 'gte' | 'lte' | 'gt' | 'lt' | 'in' | 'not_in';

export type FilterFieldType = 'text' | 'enum' | 'numeric' | 'date';

/** DoS guards. Exceeding one refuses the expression — never truncates it, since a truncated
 *  `not_in` list would widen access rather than narrow it. */
export const FILTER_MAX_BYTES = 2048;
export const FILTER_MAX_DEPTH = 16;
export const FILTER_MAX_NODES = 128;
