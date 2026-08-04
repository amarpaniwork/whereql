import type { FilterOperator } from './types.js';

export interface LeafNode {
  kind: 'leaf';
  field: string;
  fieldPosition: number;
  op: FilterOperator;
  opPosition: number;
  literal: string | number;
  literalKind: 'string' | 'number';
  literalPosition: number;
}

export interface InValue {
  literal: string | number;
  literalKind: 'string' | 'number';
  position: number;
}

/** `field in ('a','b', …)` / `field not_in ('a','b', …)`. Terminal — no children. */
export interface InNode {
  kind: 'in';
  field: string;
  fieldPosition: number;
  op: 'in' | 'not_in';
  opPosition: number;
  values: InValue[];
}

export interface AndNode {
  kind: 'and';
  children: FilterNode[];
}

export interface OrNode {
  kind: 'or';
  children: FilterNode[];
}

export type FilterNode = LeafNode | InNode | AndNode | OrNode;

export type FilterVisitor = (node: FilterNode) => void;

export function walk(node: FilterNode, visitor: FilterVisitor): void {
  visitor(node);
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.children) {
      walk(child, visitor);
    }
  }
}

export function countNodes(node: FilterNode): number {
  let count = 0;
  walk(node, () => {
    count += 1;
  });
  return count;
}

/** Every field the expression references, deduplicated. Used to decide whether a scope can be
 *  evaluated from data already in hand (path parameters, context) or needs the record fetched. */
export function referencedFields(node: FilterNode): string[] {
  const fields = new Set<string>();
  walk(node, (n) => {
    if (n.kind === 'leaf' || n.kind === 'in') {
      fields.add(n.field);
    }
  });
  return [...fields];
}
