# Changelog

Semver, and worth stating what each part means for this package:

- **major** — a grammar change that could reject an expression that used to parse, or change
  what one means. Every consumer has to be re-verified.
- **minor** — a new operator or export. Existing expressions keep their meaning.
- **patch** — a fix where the old behaviour was wrong.

The evaluator agreeing with SQL is a **correctness contract**, not an implementation detail:
a change to `matches()` semantics is at least a minor, and a major if it can flip a verdict.

## 0.1.0

First release. Extracted from the bank-core services, which each carried their own copy of
the tokenizer and parser.

- `parse()` — expression → AST, with the DoS guards (2048 bytes, depth 16, 128 nodes)
- `matches()` / `evaluate()` — in-memory evaluation implementing SQL's three-valued logic,
  so a proxy and a database reach the same verdict about the same record
- `mergeFilter()` / `mergeAll()` / `inClause()` / `quote()` — composing expressions, always
  by AND so a merge can only narrow
- `referencedFields()` — which fields an expression needs, used to decide whether a record
  must be fetched before a decision can be made
- Operators: `eq`, `ne`, `contains`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`

Published as CommonJS. Every consumer today is CJS, and an ESM-only package would fail there
with `ERR_REQUIRE_ESM`; a dual build can wait until an ESM consumer exists.
