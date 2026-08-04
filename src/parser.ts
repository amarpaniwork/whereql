import type { AndNode, FilterNode, InNode, InValue, LeafNode, OrNode } from './ast.js';
import { countNodes } from './ast.js';
import { FilterSyntaxError } from './errors.js';
import { tokenize, type Token } from './tokenizer.js';
import { FILTER_MAX_BYTES, FILTER_MAX_DEPTH, FILTER_MAX_NODES } from './types.js';

class TokenStream {
  private idx = 0;

  constructor(private readonly tokens: Token[]) {}

  peek(): Token {
    return this.tokens[this.idx]!;
  }

  next(): Token {
    const t = this.tokens[this.idx]!;
    this.idx += 1;
    return t;
  }

  expect(kind: TokenKindOf, detail: string): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', { position: t.position, detail });
    }
    return this.next();
  }
}

type TokenKindOf = Token['kind'];

/** Parses the parenthesised value list of `field in ('a','b', …)` or `field not_in (…)`. */
function parseInList(stream: TokenStream, fieldTok: Token, opTok: Token): InNode {
  stream.expect('LPAREN', `expected '(' after '${opTok.value}'`);

  if (stream.peek().kind === 'RPAREN') {
    const t = stream.peek();
    // An empty list is refused rather than read as "matches nothing": a value list stripped
    // on write must not silently become a different restriction from the one authored.
    throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', {
      position: t.position,
      field: fieldTok.value,
      detail: `'${opTok.value}' list cannot be empty`,
    });
  }

  const values: InValue[] = [];
  for (;;) {
    const litTok = stream.peek();
    if (litTok.kind === 'STRING') {
      stream.next();
      values.push({ literal: litTok.value, literalKind: 'string', position: litTok.position });
    } else if (litTok.kind === 'NUMBER') {
      stream.next();
      values.push({
        literal: litTok.numberValue ?? Number(litTok.value),
        literalKind: 'number',
        position: litTok.position,
      });
    } else {
      throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', {
        position: litTok.position,
        field: fieldTok.value,
        detail: `expected a literal in '${opTok.value}' list for field '${fieldTok.value}'`,
      });
    }

    if (stream.peek().kind === 'COMMA') {
      stream.next();
      continue;
    }
    break;
  }

  stream.expect('RPAREN', `expected ')' to close '${opTok.value}' list`);

  return {
    kind: 'in',
    field: fieldTok.value,
    fieldPosition: fieldTok.position,
    op: opTok.op as 'in' | 'not_in',
    opPosition: opTok.position,
    values,
  };
}

function parseLeaf(stream: TokenStream): LeafNode | InNode {
  const fieldTok = stream.peek();
  if (fieldTok.kind !== 'IDENT') {
    throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', {
      position: fieldTok.position,
      detail: `expected field name, got '${fieldTok.value || fieldTok.kind}'`,
    });
  }
  stream.next();

  const opTok = stream.peek();
  if (opTok.kind !== 'OP' || !opTok.op) {
    throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', {
      position: opTok.position,
      field: fieldTok.value,
      detail: `expected operator after field '${fieldTok.value}'`,
    });
  }
  stream.next();

  if (opTok.op === 'in' || opTok.op === 'not_in') {
    return parseInList(stream, fieldTok, opTok);
  }

  const litTok = stream.peek();
  if (litTok.kind === 'STRING') {
    stream.next();
    return {
      kind: 'leaf',
      field: fieldTok.value,
      fieldPosition: fieldTok.position,
      op: opTok.op,
      opPosition: opTok.position,
      literal: litTok.value,
      literalKind: 'string',
      literalPosition: litTok.position,
    };
  }
  if (litTok.kind === 'NUMBER') {
    stream.next();
    return {
      kind: 'leaf',
      field: fieldTok.value,
      fieldPosition: fieldTok.position,
      op: opTok.op,
      opPosition: opTok.position,
      literal: litTok.numberValue ?? Number(litTok.value),
      literalKind: 'number',
      literalPosition: litTok.position,
    };
  }
  throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', {
    position: litTok.position,
    field: fieldTok.value,
    detail: `expected literal after operator '${opTok.value}'`,
  });
}

function parseAtom(stream: TokenStream, depth: number): FilterNode {
  if (depth > FILTER_MAX_DEPTH) {
    const t = stream.peek();
    throw new FilterSyntaxError('FILTER_TOO_DEEP', { position: t.position, max: FILTER_MAX_DEPTH });
  }
  const t = stream.peek();
  if (t.kind === 'LPAREN') {
    stream.next();
    const inner = parseOr(stream, depth + 1);
    stream.expect('RPAREN', "expected ')'");
    return inner;
  }
  return parseLeaf(stream);
}

function parseAnd(stream: TokenStream, depth: number): FilterNode {
  const left = parseAtom(stream, depth);
  const children: FilterNode[] = [left];
  while (stream.peek().kind === 'AND') {
    stream.next();
    children.push(parseAtom(stream, depth));
  }
  if (children.length === 1) {
    return left;
  }
  const node: AndNode = { kind: 'and', children };
  return node;
}

function parseOr(stream: TokenStream, depth: number): FilterNode {
  const left = parseAnd(stream, depth);
  const children: FilterNode[] = [left];
  while (stream.peek().kind === 'OR') {
    stream.next();
    children.push(parseAnd(stream, depth));
  }
  if (children.length === 1) {
    return left;
  }
  const node: OrNode = { kind: 'or', children };
  return node;
}

/**
 * UTF-8 byte length, computed directly so the package needs neither Node's `Buffer` nor the DOM
 * lib's `TextEncoder`. The limit is in bytes rather than characters because it exists to bound
 * the URL, and a multi-byte character costs more than one.
 */
function utf8ByteLength(input: string): number {
  let bytes = 0;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair — one 4-byte code point across two UTF-16 units.
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function parse(input: string): FilterNode {
  if (utf8ByteLength(input) > FILTER_MAX_BYTES) {
    throw new FilterSyntaxError('FILTER_TOO_LONG', { position: 1, max: FILTER_MAX_BYTES });
  }

  const tokens = tokenize(input);
  const stream = new TokenStream(tokens);
  if (stream.peek().kind === 'EOF') {
    throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', { position: 1, detail: 'filter expression is empty' });
  }
  const ast = parseOr(stream, 1);
  const trailing = stream.peek();
  if (trailing.kind !== 'EOF') {
    throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', {
      position: trailing.position,
      detail: `unexpected token '${trailing.value || trailing.kind}'`,
    });
  }
  const nodes = countNodes(ast);
  if (nodes > FILTER_MAX_NODES) {
    throw new FilterSyntaxError('FILTER_TOO_COMPLEX', { position: 1, max: FILTER_MAX_NODES });
  }
  return ast;
}
