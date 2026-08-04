import { inClause, mergeAll, mergeFilter, quote } from '../src/scope.js';
import { parse } from '../src/parser.js';
import { matches } from '../src/evaluator.js';

describe('quoting', () => {
  it('escapes an embedded quote SQL-style, and survives a round trip', () => {
    expect(quote("O'Brien")).toBe("'O''Brien'");
    expect(matches(parse(`name eq ${quote("O'Brien")}`), { name: "O'Brien" })).toBe(true);
  });
});

describe('inClause', () => {
  it('builds a value list', () => {
    expect(inClause('referenceCode', ['A', 'B'])).toBe("referenceCode in ('A','B')");
  });

  // Emitting an expression that silently matches nothing would hide the mistake; the caller
  // has to decide what "no permitted values" means for its endpoint.
  it('refuses an empty list rather than emitting one that matches nothing', () => {
    expect(() => inClause('referenceCode', [])).toThrow();
  });
});

describe('merging', () => {
  it('returns the scope alone when there is no caller filter', () => {
    expect(mergeFilter(undefined, "a eq 'x'")).toBe("a eq 'x'");
    expect(mergeFilter('   ', "a eq 'x'")).toBe("a eq 'x'");
  });

  it('ANDs both, parenthesising each', () => {
    expect(mergeFilter("b eq 'y'", "a eq 'x'")).toBe("(b eq 'y') and (a eq 'x')");
  });

  /**
   * The reason every operand is wrapped. `and` binds tighter than `or`, so merging without
   * parentheses would yield `a or b and scope` — parsed as `a or (b and scope)`, which lets
   * every `a` row through unscoped.
   */
  it('does not let a caller `or` escape the scope', () => {
    const merged = mergeFilter("a eq 'yes' or b eq 'yes'", "scope eq 'required'");
    const ast = parse(merged);

    // `a` matches, but the scope does not — the row must still be excluded.
    expect(matches(ast, { a: 'yes', b: 'no', scope: 'other' })).toBe(false);
    expect(matches(ast, { a: 'yes', b: 'no', scope: 'required' })).toBe(true);
  });

  it('mergeAll drops empty operands and returns undefined when nothing is left', () => {
    expect(mergeAll(undefined, null, '  ')).toBeUndefined();
    expect(mergeAll(undefined, "a eq 'x'")).toBe("a eq 'x'");
    expect(mergeAll("a eq 'x'", "b eq 'y'", "c eq 'z'")).toBe("(a eq 'x') and (b eq 'y') and (c eq 'z')");
  });

  it('composes three scopes so each still constrains the result', () => {
    const ast = parse(mergeAll("a eq '1'", "b eq '2'", "c eq '3'")!);
    expect(matches(ast, { a: '1', b: '2', c: '3' })).toBe(true);
    expect(matches(ast, { a: '1', b: '2', c: 'x' })).toBe(false);
  });
});
