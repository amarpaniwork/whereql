import { FilterSyntaxError } from './errors.js';
import type { FilterOperator } from './types.js';

export type TokenKind =
  | 'IDENT'
  | 'OP'
  | 'AND'
  | 'OR'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'STRING'
  | 'NUMBER'
  | 'EOF';

export interface Token {
  kind: TokenKind;
  value: string;
  position: number;
  op?: FilterOperator;
  numberValue?: number;
}

// `not_in` tokenizes as one IDENT because `_` is an identifier character, so it is matched
// here like any other keyword rather than needing a two-token lookahead.
const OP_KEYWORDS = new Set<string>(['eq', 'ne', 'contains', 'gte', 'lte', 'gt', 'lt', 'in', 'not_in']);

function isIdentStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;

    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }

    const position = i + 1;

    if (ch === '(') {
      tokens.push({ kind: 'LPAREN', value: '(', position });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'RPAREN', value: ')', position });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'COMMA', value: ',', position });
      i += 1;
      continue;
    }

    if (ch === "'") {
      let value = '';
      i += 1;
      let closed = false;
      while (i < n) {
        const c = input[i]!;
        if (c === "'") {
          // SQL-style escape: '' inside a string is one literal quote.
          if (i + 1 < n && input[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          closed = true;
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      if (!closed) {
        throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', { position, detail: 'unterminated string literal' });
      }
      tokens.push({ kind: 'STRING', value, position });
      continue;
    }

    if (isDigit(ch) || (ch === '-' && i + 1 < n && isDigit(input[i + 1]!))) {
      let raw = '';
      if (ch === '-') {
        raw += '-';
        i += 1;
      }
      while (i < n && isDigit(input[i]!)) {
        raw += input[i]!;
        i += 1;
      }
      if (i < n && input[i] === '.') {
        raw += '.';
        i += 1;
        const fracStart = raw.length;
        while (i < n && isDigit(input[i]!)) {
          raw += input[i]!;
          i += 1;
        }
        if (raw.length === fracStart) {
          throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', {
            position,
            detail: `malformed number near '${raw}'`,
          });
        }
      }
      const numberValue = Number(raw);
      if (!Number.isFinite(numberValue)) {
        throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', { position, detail: `malformed number '${raw}'` });
      }
      tokens.push({ kind: 'NUMBER', value: raw, position, numberValue });
      continue;
    }

    if (isIdentStart(ch)) {
      let value = '';
      while (i < n && isIdentPart(input[i]!)) {
        value += input[i]!;
        i += 1;
      }
      const lower = value.toLowerCase();
      if (lower === 'and') {
        tokens.push({ kind: 'AND', value, position });
        continue;
      }
      if (lower === 'or') {
        tokens.push({ kind: 'OR', value, position });
        continue;
      }
      if (OP_KEYWORDS.has(value)) {
        tokens.push({ kind: 'OP', value, position, op: value as FilterOperator });
        continue;
      }
      tokens.push({ kind: 'IDENT', value, position });
      continue;
    }

    throw new FilterSyntaxError('INVALID_FILTER_SYNTAX', { position, detail: `unexpected character '${ch}'` });
  }

  tokens.push({ kind: 'EOF', value: '', position: n + 1 });
  return tokens;
}
