import { parse } from '../src/parser.js';
import { referencedFields } from '../src/ast.js';
import { FilterSyntaxError } from '../src/errors.js';
import { FILTER_MAX_BYTES } from '../src/types.js';
import type { InNode, LeafNode } from '../src/ast.js';

const err = (expr: string) => {
  try {
    parse(expr);
  } catch (e) {
    return e as FilterSyntaxError;
  }
  throw new Error(`expected ${expr} to throw`);
};

describe('parsing', () => {
  it('parses a leaf', () => {
    const ast = parse("status eq 'DRAFT'") as LeafNode;
    expect(ast.kind).toBe('leaf');
    expect(ast.field).toBe('status');
    expect(ast.op).toBe('eq');
    expect(ast.literal).toBe('DRAFT');
  });

  it('parses in and not_in as distinct terminal nodes', () => {
    expect((parse("a in ('x')") as InNode).op).toBe('in');
    expect((parse("a not_in ('x')") as InNode).op).toBe('not_in');
  });

  it('unescapes a doubled quote inside a string', () => {
    expect((parse("name eq 'O''Brien'") as LeafNode).literal).toBe("O'Brien");
  });

  it('parses negative and fractional numbers', () => {
    expect((parse('amount gte -1500.50') as LeafNode).literal).toBe(-1500.5);
  });

  it('reports referenced fields, deduplicated', () => {
    const ast = parse("a eq '1' and (b in ('x') or a eq '2')");
    expect(referencedFields(ast).sort()).toEqual(['a', 'b']);
  });
});

describe('refusals', () => {
  it.each([
    ["a in ()", 'empty in list'],
    ["a not_in ()", 'empty not_in list'],
    ["a in ('x'", 'unclosed list'],
    ['a in (b)', 'non-literal member'],
    ["a eq", 'missing literal'],
    ["eq 'x'", 'missing field'],
    ["a eq 'x' extra", 'trailing token'],
    ['', 'empty expression'],
    ["a eq 'unterminated", 'unterminated string'],
  ])('refuses %s (%s)', (expr) => {
    expect(err(expr)).toBeInstanceOf(FilterSyntaxError);
  });

  it('carries a 1-based position pointing at the offending token', () => {
    const input = "status eq 'DRAFT' and bogus";
    expect(err(input).details.position).toBe(input.length + 1);
  });

  // Refused rather than truncated: shortening a not_in list would widen access.
  it('refuses an over-long expression before parsing it', () => {
    const e = err(`a eq '${'x'.repeat(FILTER_MAX_BYTES)}'`);
    expect(e.code).toBe('FILTER_TOO_LONG');
  });

  it('refuses excessive nesting', () => {
    expect(err(`${'('.repeat(40)}a eq 'x'${')'.repeat(40)}`).code).toBe('FILTER_TOO_DEEP');
  });

  // The defaults suit an expression carried in a query string. A consumer sending it in a
  // request body has no reason to accept that ceiling, so each limit is overridable.
  describe('configurable limits', () => {
    const long = `a eq '${'x'.repeat(3000)}'`;
    const deep = `${'('.repeat(40)}a eq 'x'${')'.repeat(40)}`;
    const complex = Array.from({ length: 140 }, () => 'a eq 1').join(' and ');

    it('raises the byte limit', () => {
      expect(err(long).code).toBe('FILTER_TOO_LONG');
      expect(() => parse(long, { maxBytes: 8192 })).not.toThrow();
    });

    it('raises the depth limit', () => {
      expect(err(deep).code).toBe('FILTER_TOO_DEEP');
      expect(() => parse(deep, { maxDepth: 64 })).not.toThrow();
    });

    it('raises the node limit', () => {
      expect(err(complex).code).toBe('FILTER_TOO_COMPLEX');
      expect(() => parse(complex, { maxNodes: 512 })).not.toThrow();
    });

    it('lowers a limit just as readily', () => {
      expect(() => parse("a eq 'x'")).not.toThrow();
      expect(() => parse("a eq 'x'", { maxBytes: 4 })).toThrow(FilterSyntaxError);
    });

    it('reports the limit that was actually applied, not the default', () => {
      try {
        parse(long, { maxBytes: 100 });
        throw new Error('expected a refusal');
      } catch (e) {
        expect((e as FilterSyntaxError).details.max).toBe(100);
      }
    });
  });

  // Deliberately short clauses: a longer expression would trip FILTER_TOO_LONG first and this
  // would stop testing the node-count guard at all.
  it('refuses an over-complex expression on node count, within the byte limit', () => {
    const clause = Array.from({ length: 140 }, () => 'a eq 1').join(' and ');
    expect(clause.length).toBeLessThan(FILTER_MAX_BYTES);
    expect(err(clause).code).toBe('FILTER_TOO_COMPLEX');
  });

  it('applies the byte limit before parsing, so length wins over complexity', () => {
    const clause = Array.from({ length: 400 }, () => 'a eq 1').join(' and ');
    expect(err(clause).code).toBe('FILTER_TOO_LONG');
  });
});
