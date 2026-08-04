import type { FilterNode, InNode, LeafNode } from './ast.js';

/**
 * In-memory evaluation of a filter expression against a single record.
 *
 * The database evaluates the *same* expression as SQL. Where a list endpoint pushes the filter
 * down, a single-record read or a write has to be judged in-process — and the two must reach the
 * same verdict about the same row, or the proxy permits a write to a record the list would have
 * excluded.
 *
 * That means implementing SQL's **three-valued logic**, not JavaScript's two-valued one:
 *
 *   city ne 'London'   with city IS NULL   →   UNKNOWN   (not `true`)
 *
 * `WHERE` returns only rows where the predicate is TRUE, discarding both FALSE and UNKNOWN, so
 * UNKNOWN must mean *not visible*. A naive `record.city !== 'London'` returns `true` and admits
 * exactly the row Postgres filtered out.
 */

export type Tri = true | false | 'unknown';

export interface EvaluateOptions {
  /**
   * Fields whose column is stored upper-cased, so bank-core upper-cases the literal before
   * matching (`caseInsensitive` in its whitelist). Comparison here must do the same or the two
   * disagree — `referenceCode eq 'cd-1'` matches in SQL and would not match here.
   *
   * Reference codes are minted upper-case (`CD-YYMM-XXXXX`), so authoring them in canonical
   * case avoids relying on this; it is provided for correctness rather than convenience.
   */
  caseInsensitiveFields?: ReadonlySet<string> | readonly string[];
}

function isCaseInsensitive(field: string, opts: EvaluateOptions | undefined): boolean {
  const set = opts?.caseInsensitiveFields;
  if (!set) return false;
  return Array.isArray(set) ? set.includes(field) : (set as ReadonlySet<string>).has(field);
}

/**
 * Same shape bank-core's validator accepts, and it must stay strict.
 *
 * `Date.parse` alone is uselessly lenient here: V8 parses `'CD-1'` to a real timestamp, and
 * `'cd-1'` to the *same* one — so sniffing with `Date.parse` would make two unrelated reference
 * codes compare equal and admit records the database excluded. Both operands have to look like
 * ISO-8601 before either is treated as an instant.
 */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Both operands are ISO-8601 ⇒ compare as instants, so '2026-01-01' and '2026-01-01T00:00:00Z'
 *  are equal rather than merely different strings. */
function asDatePair(a: unknown, b: unknown): [number, number] | null {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  if (!ISO_DATE_PATTERN.test(a) || !ISO_DATE_PATTERN.test(b)) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return [ta, tb];
}

/** Ordering comparison. Returns null when the pair is not meaningfully ordered, which the caller
 *  turns into UNKNOWN rather than guessing. */
function compare(recordValue: unknown, literal: string | number): number | null {
  if (typeof literal === 'number') {
    const n = typeof recordValue === 'number' ? recordValue : Number(recordValue);
    if (Number.isNaN(n)) return null;
    return n < literal ? -1 : n > literal ? 1 : 0;
  }

  const dates = asDatePair(recordValue, literal);
  if (dates) {
    const [a, b] = dates;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  if (typeof recordValue !== 'string') return null;
  return recordValue < literal ? -1 : recordValue > literal ? 1 : 0;
}

function equals(recordValue: unknown, literal: string | number, caseInsensitive: boolean): boolean {
  if (typeof literal === 'number') {
    const n = typeof recordValue === 'number' ? recordValue : Number(recordValue);
    return !Number.isNaN(n) && n === literal;
  }
  if (typeof recordValue === 'number') {
    return String(recordValue) === literal;
  }
  if (typeof recordValue !== 'string') return false;

  // A date-typed column may come back in a different ISO shape than the literal was written in.
  const dates = asDatePair(recordValue, literal);
  if (dates) return dates[0] === dates[1];

  return caseInsensitive ? recordValue.toUpperCase() === literal.toUpperCase() : recordValue === literal;
}

function evalLeaf(node: LeafNode, record: Record<string, unknown>, opts?: EvaluateOptions): Tri {
  const value = record[node.field];

  // NULL — and a field the record simply does not carry — yields UNKNOWN for every operator.
  // Treating an absent field as "no match" would be a guess; UNKNOWN propagates and fails closed.
  if (value === null || value === undefined) return 'unknown';

  const ci = isCaseInsensitive(node.field, opts);

  switch (node.op) {
    case 'eq':
      return equals(value, node.literal, ci);
    case 'ne':
      return !equals(value, node.literal, ci);
    case 'contains': {
      // Mirrors ILIKE '%x%' — unconditionally case-insensitive, regardless of the column.
      if (typeof value !== 'string') return 'unknown';
      return value.toUpperCase().includes(String(node.literal).toUpperCase());
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const c = compare(value, node.literal);
      if (c === null) return 'unknown';
      if (node.op === 'gt') return c > 0;
      if (node.op === 'gte') return c >= 0;
      if (node.op === 'lt') return c < 0;
      return c <= 0;
    }
    default:
      // `in` / `not_in` are InNodes; a leaf carrying one is a parser bug, not caller input.
      throw new Error(`unreachable: operator '${node.op}' on a leaf node`);
  }
}

function evalIn(node: InNode, record: Record<string, unknown>, opts?: EvaluateOptions): Tri {
  const value = record[node.field];

  // Matches SQL: `x IN (…)` and `x NOT IN (…)` are both NULL when x is NULL.
  if (value === null || value === undefined) return 'unknown';

  const ci = isCaseInsensitive(node.field, opts);
  const hit = node.values.some((v) => equals(value, v.literal, ci));
  return node.op === 'not_in' ? !hit : hit;
}

/** SQL `AND`: FALSE if any operand is FALSE, else UNKNOWN if any is UNKNOWN, else TRUE. */
function andTri(parts: Tri[]): Tri {
  if (parts.some((p) => p === false)) return false;
  if (parts.some((p) => p === 'unknown')) return 'unknown';
  return true;
}

/** SQL `OR`: TRUE if any operand is TRUE, else UNKNOWN if any is UNKNOWN, else FALSE. */
function orTri(parts: Tri[]): Tri {
  if (parts.some((p) => p === true)) return true;
  if (parts.some((p) => p === 'unknown')) return 'unknown';
  return false;
}

/** Three-valued result, for callers that need to distinguish "excluded" from "undecidable". */
export function evaluate(node: FilterNode, record: Record<string, unknown>, opts?: EvaluateOptions): Tri {
  switch (node.kind) {
    case 'leaf':
      return evalLeaf(node, record, opts);
    case 'in':
      return evalIn(node, record, opts);
    case 'and':
      return andTri(node.children.map((c) => evaluate(c, record, opts)));
    case 'or':
      return orTri(node.children.map((c) => evaluate(c, record, opts)));
  }
}

/**
 * Whether the record satisfies the expression — the question `WHERE` answers.
 *
 * **UNKNOWN counts as not visible.** This is what keeps the proxy and the database in agreement,
 * and it is also the fail-closed direction: a record missing a field the scope predicates on is
 * refused rather than admitted.
 */
export function matches(node: FilterNode, record: Record<string, unknown>, opts?: EvaluateOptions): boolean {
  return evaluate(node, record, opts) === true;
}
