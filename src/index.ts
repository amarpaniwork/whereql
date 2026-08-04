/**
 * itti-filter-dsl — the filter expression grammar shared by bank-core and the customer-core proxy.
 *
 * Bank-core translates the AST to SQL; the proxy evaluates it in memory for writes and
 * single-record reads. One grammar, one AST, two backends — so the two cannot drift on what an
 * expression means.
 *
 * Field whitelists deliberately stay in the repo that owns the table: they are per-endpoint data,
 * and centralising them would mean a package release for every new filterable column.
 */

export type { FilterOperator, FilterFieldType } from './types.js';
export { FILTER_MAX_BYTES, FILTER_MAX_DEPTH, FILTER_MAX_NODES } from './types.js';

export type { FilterErrorCode, FilterErrorDetails } from './errors.js';
export { FilterSyntaxError } from './errors.js';

export type { AndNode, FilterNode, FilterVisitor, InNode, InValue, LeafNode, OrNode } from './ast.js';
export { countNodes, referencedFields, walk } from './ast.js';

export type { Token, TokenKind } from './tokenizer.js';
export { tokenize } from './tokenizer.js';

export { parse } from './parser.js';

export type { EvaluateOptions, Tri } from './evaluator.js';
export { evaluate, matches } from './evaluator.js';

export { inClause, mergeAll, mergeFilter, quote } from './scope.js';
