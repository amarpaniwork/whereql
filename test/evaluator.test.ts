import { parse } from '../src/parser.js';
import { evaluate, matches } from '../src/evaluator.js';

const rec = (o: Record<string, unknown>) => o;
const m = (expr: string, record: Record<string, unknown>, opts?: Parameters<typeof matches>[2]) =>
  matches(parse(expr), record, opts);
const e = (expr: string, record: Record<string, unknown>) => evaluate(parse(expr), record);

describe('equality', () => {
  it('matches a string', () => {
    expect(m("status eq 'DRAFT'", rec({ status: 'DRAFT' }))).toBe(true);
    expect(m("status eq 'DRAFT'", rec({ status: 'SUBMITTED' }))).toBe(false);
  });

  it('is case-sensitive by default, matching an ordinary column', () => {
    expect(m("status eq 'draft'", rec({ status: 'DRAFT' }))).toBe(false);
  });

  // bank-core upper-cases the literal for these columns before matching. Without the same
  // treatment here the proxy would refuse a record the list endpoint returns.
  it('is case-insensitive for a declared caseInsensitive field', () => {
    const opts = { caseInsensitiveFields: ['referenceCode'] };
    expect(m("referenceCode eq 'cd-1'", rec({ referenceCode: 'CD-1' }), opts)).toBe(true);
    expect(m("referenceCode eq 'cd-1'", rec({ referenceCode: 'CD-1' }))).toBe(false);
  });

  it('compares numbers numerically, not lexically', () => {
    expect(m('amount eq 10', rec({ amount: 10 }))).toBe(true);
    expect(m('amount gt 9', rec({ amount: 10 }))).toBe(true);
    // '10' < '9' lexically — the trap this guards against.
    expect(m('amount gt 9', rec({ amount: '10' }))).toBe(true);
  });

  it('treats equal instants written in different ISO shapes as equal', () => {
    expect(m("createdAtIso eq '2026-01-01'", rec({ createdAtIso: '2026-01-01T00:00:00Z' }))).toBe(true);
  });

  /**
   * Regression guard. `Date.parse` is far more lenient than it looks — V8 parses 'CD-1' to a
   * real timestamp, and 'cd-1' to the *same* one. Sniffing for dates with `Date.parse` alone
   * therefore made two unrelated reference codes compare equal, admitting records the database
   * had excluded. Both operands must match a strict ISO-8601 shape before either is an instant.
   */
  it('does not treat a reference code as a date, however willingly Date.parse accepts it', () => {
    expect(Number.isNaN(Date.parse('CD-1'))).toBe(false); // the trap is real
    expect(m("referenceCode eq 'cd-1'", rec({ referenceCode: 'CD-1' }))).toBe(false);
    expect(m("referenceCode eq 'CD-1'", rec({ referenceCode: 'CD-2' }))).toBe(false);
  });

  it('does not order two non-date strings as dates', () => {
    expect(m("referenceCode gt 'CD-1'", rec({ referenceCode: 'CD-2' }))).toBe(true);
  });
});

describe('set membership', () => {
  it('matches in / not_in', () => {
    expect(m("referenceCode in ('A','B')", rec({ referenceCode: 'B' }))).toBe(true);
    expect(m("referenceCode in ('A','B')", rec({ referenceCode: 'C' }))).toBe(false);
    expect(m("referenceCode not_in ('A','B')", rec({ referenceCode: 'C' }))).toBe(true);
    expect(m("referenceCode not_in ('A','B')", rec({ referenceCode: 'A' }))).toBe(false);
  });
});

describe('contains', () => {
  it('is case-insensitive, mirroring ILIKE', () => {
    expect(m("dealName contains 'capital'", rec({ dealName: 'ACME CAPITAL' }))).toBe(true);
  });

  it('treats % and _ as literals, not wildcards', () => {
    expect(m("dealName contains '%'", rec({ dealName: 'ACME' }))).toBe(false);
    expect(m("dealName contains '_'", rec({ dealName: 'AB' }))).toBe(false);
    expect(m("dealName contains '_'", rec({ dealName: 'A_B' }))).toBe(true);
  });
});

/**
 * The centrepiece. SQL is three-valued and `WHERE` keeps only TRUE rows, so anything UNKNOWN
 * must be invisible here too. Getting this backwards would let the proxy admit a write to a
 * record the list endpoint filtered out.
 */
describe('NULL and three-valued logic', () => {
  it.each(['eq', 'ne'])('yields UNKNOWN for %s against a NULL column', (op) => {
    expect(e(`city ${op} 'London'`, rec({ city: null }))).toBe('unknown');
  });

  it('yields UNKNOWN when the record omits the field entirely', () => {
    expect(e("city eq 'London'", rec({}))).toBe('unknown');
  });

  it('yields UNKNOWN for in / not_in against NULL, as SQL does', () => {
    expect(e("city in ('London')", rec({ city: null }))).toBe('unknown');
    expect(e("city not_in ('London')", rec({ city: null }))).toBe('unknown');
  });

  // The exact case a naive `!==` gets wrong: it would return true and admit the row.
  it('does NOT admit a NULL row on ne — the JS-vs-SQL trap', () => {
    expect(m("city ne 'London'", rec({ city: null }))).toBe(false);
  });

  it('AND is FALSE if any operand is FALSE, even beside UNKNOWN', () => {
    expect(e("city eq 'London' and status eq 'DRAFT'", rec({ city: null, status: 'SUBMITTED' }))).toBe(false);
  });

  it('AND is UNKNOWN when an operand is UNKNOWN and none is FALSE', () => {
    expect(e("city eq 'London' and status eq 'DRAFT'", rec({ city: null, status: 'DRAFT' }))).toBe('unknown');
  });

  it('OR is TRUE if any operand is TRUE, even beside UNKNOWN', () => {
    expect(e("city eq 'London' or status eq 'DRAFT'", rec({ city: null, status: 'DRAFT' }))).toBe(true);
  });

  it('OR is UNKNOWN when an operand is UNKNOWN and none is TRUE', () => {
    expect(e("city eq 'London' or status eq 'DRAFT'", rec({ city: null, status: 'SUBMITTED' }))).toBe('unknown');
  });

  it('a range op against a non-comparable value is UNKNOWN, not false', () => {
    expect(e('amount gt 5', rec({ amount: 'not-a-number' }))).toBe('unknown');
  });
});

describe('composition', () => {
  it('honours precedence — and binds tighter than or', () => {
    // a or (b and c): true because `a` holds, regardless of the rest.
    const record = rec({ a: 'yes', b: 'no', c: 'no' });
    expect(m("a eq 'yes' or b eq 'yes' and c eq 'yes'", record)).toBe(true);
  });

  it('honours explicit parentheses', () => {
    const record = rec({ a: 'yes', b: 'no', c: 'no' });
    expect(m("(a eq 'yes' or b eq 'yes') and c eq 'yes'", record)).toBe(false);
  });

  /**
   * The `NOT(when) OR scope` fold from the access-control design: restrict inside UK private
   * equity, leave everything else untouched.
   */
  describe('NOT(when) OR scope fold', () => {
    const expr =
      "(countryAlpha3 ne 'GBR' or assetClass ne 'PRIVATE_EQUITY') or referenceCode in ('CD-1','CD-2')";

    it('admits a record outside the when', () => {
      expect(m(expr, rec({ countryAlpha3: 'USA', assetClass: 'PRIVATE_EQUITY', referenceCode: 'CD-9' }))).toBe(true);
    });

    it('admits a listed record inside the when', () => {
      expect(m(expr, rec({ countryAlpha3: 'GBR', assetClass: 'PRIVATE_EQUITY', referenceCode: 'CD-1' }))).toBe(true);
    });

    it('refuses an unlisted record inside the when', () => {
      expect(m(expr, rec({ countryAlpha3: 'GBR', assetClass: 'PRIVATE_EQUITY', referenceCode: 'CD-9' }))).toBe(false);
    });
  });
});
