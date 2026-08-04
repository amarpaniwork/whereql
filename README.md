# whereql

A small filter-expression language, with two backends that agree with each other: parse once,
then either **translate to SQL** or **evaluate in memory against a plain object**.

```
status in ('ACTIVE','PENDING') and country eq 'GBR' and createdAt gte '2026-01-01'
```

```js
const { parse, matches, mergeFilter } = require('whereql');

const ast = parse("status eq 'ACTIVE' and amount gte 1000");
matches(ast, { status: 'ACTIVE', amount: 2500 }); // true
mergeFilter("city eq 'London'", "status eq 'ACTIVE'");
// → "(city eq 'London') and (status eq 'ACTIVE')"
```

## Why it exists

A service that filters lists in the database, but also has to judge a *single* record
in-process — before a write, say — needs the same predicate answered twice, in two places. A
separate parser and a hand-written comparison drift apart, and the drift is invisible until
the two disagree about one row.

This package is the single definition: one grammar, one AST, two backends.

## API

| Export | Purpose |
|---|---|
| `parse(input, opts?)` | expression → AST. Throws `FilterSyntaxError` |
| `matches(ast, record, opts?)` | does this record satisfy the expression? |
| `evaluate(ast, record, opts?)` | three-valued result — `true \| false \| 'unknown'` |
| `mergeFilter(existing, extra)` | AND-merge, parenthesised |
| `mergeAll(...exprs)` | AND-merge several, skipping empties |
| `inClause(field, values)` | build `field in ('a','b')` |
| `quote(value)` | single-quote, escaping `'` → `''` |
| `referencedFields(ast)` | which fields the expression needs |
| `tokenize(input)` | tokens, if you need them |

**Operators** — `eq`, `ne`, `contains`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, with `and` /
`or` and parentheses. `and` binds tighter than `or`.

**Literals** — strings single-quoted with `''` as an escaped quote; bare numbers; ISO-8601
dates in quotes.

**Limits** — 2048 bytes, nesting depth 16, 128 AST nodes by default. The defaults suit an
expression carried in a query string; raise them when it travels somewhere roomier:

```js
parse(input, { maxBytes: 8192, maxDepth: 64, maxNodes: 512 });
```

Exceeding a limit **throws**. Nothing is silently truncated, because shortening a `not_in`
list would *widen* what the expression permits rather than narrow it — the one direction a
length guard must never move.

## Two things that are easy to get wrong

**SQL is three-valued.** `city ne 'London'` is UNKNOWN when `city IS NULL`, and `WHERE` keeps
only rows where the predicate is TRUE — so the row is excluded. A naive
`record.city !== 'London'` returns `true` and admits exactly the row the database filtered out.

`matches()` treats UNKNOWN as **not a match**, which keeps the two backends in agreement and
fails closed when a record is missing a field the expression tests. Use `evaluate()` when you
need to tell "excluded" from "undecidable".

**`Date.parse` is not a date test.** V8 parses `'CD-1'` to a real timestamp — and `'cd-1'` to
the *same* one. Sniffing for dates with `Date.parse` alone therefore made two unrelated
reference codes compare equal. Both operands must match a strict ISO-8601 shape before either
is treated as an instant.

## Field whitelists are not included, deliberately

What fields an endpoint accepts, and which operators are legal on each, is data owned by
whoever owns the table. Centralising it here would mean a package release for every new
filterable column, and a stale copy would wrongly reject valid expressions.

This package defines the **grammar**. Validate fields against your own whitelist after
parsing — `referencedFields()` is there for that.

## Case sensitivity

String comparison is case-sensitive by default. For columns stored upper-cased, pass the field
names so in-memory comparison matches what the database does:

```js
matches(ast, record, { caseInsensitiveFields: ['sku', 'countryCode'] });
```

`contains` is always case-insensitive, mirroring `ILIKE`.

## Module format

CommonJS. Every consumer today is CJS, and an ESM-only build would fail there with
`ERR_REQUIRE_ESM`. A dual build can wait until an ESM consumer exists.

## Verifying against a SQL translator

`test/parser-differential.manual.ts` compares this parser's AST with another implementation's,
expression by expression. It is not part of `npm test` because it reaches outside the package.

> Still outstanding: a differential test of `matches()` against a live database running the
> translated SQL. Reasoning about NULL semantics by reading the code is how that bug ships.
