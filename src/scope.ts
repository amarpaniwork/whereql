/**
 * Composing filter expressions.
 *
 * Every merge here is an **AND**, which is what makes an access-control scope structurally
 * subtractive: a caller's own filter can narrow the result set but never widen it, so no caller
 * input needs stripping for the restriction to hold.
 */

/** Single-quotes a value for the DSL, escaping embedded quotes SQL-style (`'` → `''`). */
export function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** `field in ('a','b')`. Callers must handle the empty case themselves — an empty list is not a
 *  valid expression, and silently emitting one that matches nothing would hide the mistake. */
export function inClause(field: string, values: readonly string[]): string {
  if (values.length === 0) {
    throw new Error('inClause requires at least one value');
  }
  return `${field} in (${values.map(quote).join(',')})`;
}

/**
 * AND-merges expressions, parenthesising each so internal `or` precedence survives.
 *
 * `and` binds tighter than `or`, so merging `a or b` with `c` unparenthesised would yield
 * `a or b and c` — which parses as `a or (b and c)` and lets `a` through unrestricted. That
 * silent widening is the reason every operand is wrapped.
 */
export function mergeAll(...expressions: (string | null | undefined)[]): string | undefined {
  const parts = expressions.map((e) => (e ?? '').trim()).filter((e) => e.length > 0);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return parts.map((p) => `(${p})`).join(' and ');
}

/**
 * Merges a caller-supplied filter with a scope the caller does not control.
 *
 * Kept as a named function rather than a `mergeAll` call so the asymmetry is legible at the call
 * site: `scope` is always applied, `existing` is optional, and the result can only be narrower
 * than either.
 */
export function mergeFilter(existing: string | null | undefined, scope: string): string {
  return mergeAll(existing, scope)!;
}
