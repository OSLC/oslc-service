/*
 * Copyright 2014 IBM Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * query-parser.ts -- OSLC Query parameter parser.
 *
 * Parses OSLC query parameters (oslc.where, oslc.select, oslc.orderBy,
 * oslc.searchTerms, oslc.prefix, oslc.paging, oslc.pageSize, oslc.page)
 * into a structured AST.
 *
 * Implements the OSLC Query Syntax as defined in:
 * https://docs.oasis-open.org/oslc-core/oslc-query/v3.0/oslc-query-v3.0.html
 */

// ============================================================================
// Types
// ============================================================================

/** Resolved prefix map: prefix string -> namespace URI */
export type PrefixMap = Map<string, string>;

// --- WHERE clause AST ---

export type WhereExpression = ComparisonTerm | InTerm | NestedTerm | CompoundTerm;

export interface ComparisonTerm {
  type: 'comparison';
  property: string;       // prefixed name, e.g. "dcterms:title"
  operator: '=' | '!=' | '<' | '>' | '<=' | '>=';
  value: OslcValue;
}

export interface InTerm {
  type: 'in';
  property: string;
  values: OslcValue[];
}

export interface NestedTerm {
  type: 'nested';
  property: string;
  inner: WhereExpression;
}

export interface CompoundTerm {
  type: 'compound';
  operator: 'and' | 'or';
  operands: WhereExpression[];
}

export interface OslcValue {
  kind: 'string' | 'number' | 'boolean' | 'uri';
  value: string;
}

// --- SELECT clause AST ---

export type SelectTerm = SimpleSelect | NestedSelect | WildcardSelect;

export interface SimpleSelect {
  type: 'property';
  property: string;
}

export interface NestedSelect {
  type: 'nested';
  property: string;
  children: SelectTerm[];
}

export interface WildcardSelect {
  type: 'wildcard';
}

// --- ORDER BY AST ---

export interface OrderByTerm {
  property: string;
  direction: 'asc' | 'desc';
}

// --- Complete parsed query ---

export interface OslcQuery {
  prefixes: PrefixMap;
  where?: WhereExpression;
  select?: SelectTerm[];
  orderBy?: OrderByTerm[];
  searchTerms?: string[];
  pageSize?: number;
  page?: number;
}

// ============================================================================
// Tokenizer
// ============================================================================

/**
 * Tokenize an OSLC query string into an array of tokens.
 *
 * Handles:
 * - Whitespace skipping
 * - Single-char tokens: { } , [ ]
 * - Quoted strings (with backslash escape handling)
 * - URIs in angle brackets: <http://...>
 * - Multi-char operators: !=, <=, >=
 * - Single-char operators: =, <, >
 * - Word tokens (property names, keywords like "and"/"or"/"in", numbers, booleans)
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    const ch = input[i];

    // Single-char structural tokens
    if (ch === '{' || ch === '}' || ch === ',' || ch === '[' || ch === ']') {
      tokens.push(ch);
      i++;
      continue;
    }

    // Quoted string
    if (ch === '"') {
      let str = '"';
      i++; // skip opening quote
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          str += input[i] + input[i + 1];
          i += 2;
        } else {
          str += input[i];
          i++;
        }
      }
      if (i < input.length) {
        str += '"'; // closing quote
        i++;
      }
      tokens.push(str);
      continue;
    }

    // URI in angle brackets
    if (ch === '<') {
      // Lookahead: if the next non-whitespace looks like a URI scheme or path,
      // treat as URI. Otherwise fall through to operator handling.
      // We detect URI by checking for a colon or slash after <.
      const rest = input.slice(i + 1);
      const uriMatch = rest.match(/^[^\s>]*>/);
      if (uriMatch && /[:/]/.test(uriMatch[0])) {
        const uri = '<' + uriMatch[0];
        tokens.push(uri);
        i += uri.length;
        continue;
      }
    }

    // Multi-char operators: !=, <=, >=
    if (ch === '!' && i + 1 < input.length && input[i + 1] === '=') {
      tokens.push('!=');
      i += 2;
      continue;
    }
    if (ch === '<' && i + 1 < input.length && input[i + 1] === '=') {
      tokens.push('<=');
      i += 2;
      continue;
    }
    if (ch === '>' && i + 1 < input.length && input[i + 1] === '=') {
      tokens.push('>=');
      i += 2;
      continue;
    }

    // Single-char operators
    if (ch === '=' || ch === '<' || ch === '>') {
      tokens.push(ch);
      i++;
      continue;
    }

    // Wildcard
    if (ch === '*') {
      tokens.push('*');
      i++;
      continue;
    }

    // +/- prefixes for orderBy
    if (ch === '+' || ch === '-') {
      tokens.push(ch);
      i++;
      continue;
    }

    // Word tokens: property names (with colons for prefixed names), keywords, numbers
    if (/[a-zA-Z0-9_]/.test(ch)) {
      let word = '';
      while (i < input.length && /[a-zA-Z0-9_:.\-]/.test(input[i])) {
        word += input[i];
        i++;
      }
      tokens.push(word);
      continue;
    }

    // Unknown character -- skip it
    i++;
  }

  return tokens;
}

// ============================================================================
// Token stream helper
// ============================================================================

/**
 * A simple token stream that supports peek, consume, and expect operations
 * for recursive descent parsing.
 */
class TokenStream {
  private tokens: string[];
  private pos: number;

  constructor(tokens: string[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  /** Return the current token without consuming it, or undefined if at end. */
  peek(): string | undefined {
    return this.tokens[this.pos];
  }

  /** Consume and return the current token. Throws if at end. */
  next(): string {
    if (this.pos >= this.tokens.length) {
      throw new Error('Unexpected end of input');
    }
    return this.tokens[this.pos++];
  }

  /** Consume the current token if it matches the expected value, otherwise throw. */
  expect(expected: string): string {
    const tok = this.next();
    if (tok !== expected) {
      throw new Error(`Expected '${expected}' but got '${tok}'`);
    }
    return tok;
  }

  /** Return true if there are more tokens. */
  hasMore(): boolean {
    return this.pos < this.tokens.length;
  }

  /** Check if the current token matches the expected value without consuming. */
  matches(expected: string): boolean {
    return this.peek() === expected;
  }

  /** Consume the current token if it matches, returning true. Otherwise return false. */
  tryConsume(expected: string): boolean {
    if (this.peek() === expected) {
      this.pos++;
      return true;
    }
    return false;
  }
}

// ============================================================================
// Prefix parser
// ============================================================================

/**
 * Parse an oslc.prefix parameter value into a PrefixMap.
 *
 * Format: "pfx1=<uri1>,pfx2=<uri2>"
 *
 * Example: "dcterms=<http://purl.org/dc/terms/>,oslc=<http://open-services.net/ns/core#>"
 */
export function parsePrefixes(input: string): PrefixMap {
  const map: PrefixMap = new Map();
  if (!input || input.trim().length === 0) {
    return map;
  }

  // Split on commas that are NOT inside angle brackets
  const entries = splitPrefixEntries(input);

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      throw new Error(`Invalid prefix declaration: '${trimmed}' (missing '=')`);
    }

    const prefix = trimmed.slice(0, eqIndex).trim();
    let uri = trimmed.slice(eqIndex + 1).trim();

    // Strip angle brackets from URI
    if (uri.startsWith('<') && uri.endsWith('>')) {
      uri = uri.slice(1, -1);
    }

    if (prefix.length === 0) {
      throw new Error(`Invalid prefix declaration: empty prefix name in '${trimmed}'`);
    }

    map.set(prefix, uri);
  }

  return map;
}

/**
 * Split prefix entries on commas that are outside angle brackets.
 */
function splitPrefixEntries(input: string): string[] {
  const entries: string[] = [];
  let current = '';
  let inBrackets = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '<') {
      inBrackets = true;
      current += ch;
    } else if (ch === '>') {
      inBrackets = false;
      current += ch;
    } else if (ch === ',' && !inBrackets) {
      entries.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    entries.push(current);
  }

  return entries;
}

// ============================================================================
// WHERE clause parser
// ============================================================================

const COMPARISON_OPS = new Set(['=', '!=', '<', '>', '<=', '>=']);

/**
 * Parse an oslc.where parameter value into a WhereExpression AST.
 *
 * Grammar (simplified):
 *   compound    ::= term (('and' | 'or') term)*
 *   term        ::= property (comparison_op value | 'in' '[' value_list ']' | '{' compound '}')
 *   value       ::= quoted_string | uri | number | boolean | prefixed_name
 *   value_list  ::= value (',' value)*
 */
export function parseWhere(input: string): WhereExpression {
  const tokens = tokenize(input);
  const stream = new TokenStream(tokens);
  const result = parseCompound(stream);
  if (stream.hasMore()) {
    throw new Error(`Unexpected token '${stream.peek()}' after where expression`);
  }
  return result;
}

/**
 * Parse a compound expression: term (('and'|'or') term)*
 *
 * All terms at the same level must use the same logical operator.
 */
function parseCompound(stream: TokenStream): WhereExpression {
  const first = parseTerm(stream);
  const operands: WhereExpression[] = [first];
  let operator: 'and' | 'or' | undefined;

  while (stream.hasMore()) {
    const tok = stream.peek();
    if (tok === 'and' || tok === 'or') {
      if (operator !== undefined && tok !== operator) {
        throw new Error(
          `Cannot mix 'and' and 'or' at the same nesting level. ` +
          `Use nested braces to clarify precedence.`
        );
      }
      operator = tok;
      stream.next(); // consume 'and'/'or'
      operands.push(parseTerm(stream));
    } else {
      break;
    }
  }

  if (operands.length === 1) {
    return first;
  }

  return {
    type: 'compound',
    operator: operator!,
    operands,
  };
}

/**
 * Parse a single where term: comparison, in, or nested.
 */
function parseTerm(stream: TokenStream): WhereExpression {
  const property = stream.next();

  // Nested: property { compound }
  if (stream.matches('{')) {
    stream.expect('{');
    const inner = parseCompound(stream);
    stream.expect('}');
    return { type: 'nested', property, inner };
  }

  // In: property in [ value, value, ... ]
  if (stream.matches('in')) {
    stream.next(); // consume 'in'
    stream.expect('[');
    const values: OslcValue[] = [];
    if (!stream.matches(']')) {
      values.push(parseValue(stream));
      while (stream.tryConsume(',')) {
        values.push(parseValue(stream));
      }
    }
    stream.expect(']');
    return { type: 'in', property, values };
  }

  // Comparison: property op value
  const op = stream.next();
  if (!COMPARISON_OPS.has(op)) {
    throw new Error(`Expected comparison operator but got '${op}'`);
  }
  const value = parseValue(stream);
  return {
    type: 'comparison',
    property,
    operator: op as ComparisonTerm['operator'],
    value,
  };
}

/**
 * Parse a single value: quoted string, URI, number, boolean, or prefixed name.
 */
function parseValue(stream: TokenStream): OslcValue {
  const tok = stream.next();

  // Quoted string: "..."
  if (tok.startsWith('"') && tok.endsWith('"') && tok.length >= 2) {
    // Unescape the string content
    const raw = tok.slice(1, -1);
    const unescaped = raw.replace(/\\(.)/g, '$1');
    return { kind: 'string', value: unescaped };
  }

  // URI in angle brackets: <...>
  if (tok.startsWith('<') && tok.endsWith('>')) {
    return { kind: 'uri', value: tok.slice(1, -1) };
  }

  // Boolean
  if (tok === 'true' || tok === 'false') {
    return { kind: 'boolean', value: tok };
  }

  // Number (integer or decimal)
  if (/^-?\d+(\.\d+)?$/.test(tok)) {
    return { kind: 'number', value: tok };
  }

  // Prefixed name or bare word -- treat as URI (prefixed form)
  return { kind: 'uri', value: tok };
}

// ============================================================================
// SELECT clause parser
// ============================================================================

/**
 * Parse an oslc.select parameter value into a list of SelectTerms.
 *
 * Format: "prop1,prop2{nested1,nested2},*"
 */
export function parseSelect(input: string): SelectTerm[] {
  const tokens = tokenize(input);
  const stream = new TokenStream(tokens);
  return parseSelectTermList(stream);
}

/**
 * Parse a comma-separated list of select terms.
 */
function parseSelectTermList(stream: TokenStream): SelectTerm[] {
  const terms: SelectTerm[] = [];

  if (!stream.hasMore()) {
    return terms;
  }

  terms.push(parseSelectTerm(stream));
  while (stream.tryConsume(',')) {
    terms.push(parseSelectTerm(stream));
  }

  return terms;
}

/**
 * Parse a single select term: wildcard, nested property, or simple property.
 */
function parseSelectTerm(stream: TokenStream): SelectTerm {
  // Wildcard
  if (stream.matches('*')) {
    stream.next();
    return { type: 'wildcard' };
  }

  const property = stream.next();

  // Nested: property { children }
  if (stream.matches('{')) {
    stream.expect('{');
    const children = parseSelectTermList(stream);
    stream.expect('}');
    return { type: 'nested', property, children };
  }

  return { type: 'property', property };
}

// ============================================================================
// ORDER BY parser
// ============================================================================

/**
 * Parse an oslc.orderBy parameter value into a list of OrderByTerms.
 *
 * Format: "+prop1,-prop2" where + means ascending and - means descending.
 */
export function parseOrderBy(input: string): OrderByTerm[] {
  const tokens = tokenize(input);
  const stream = new TokenStream(tokens);
  const terms: OrderByTerm[] = [];

  if (!stream.hasMore()) {
    return terms;
  }

  terms.push(parseOrderByTerm(stream));
  while (stream.tryConsume(',')) {
    terms.push(parseOrderByTerm(stream));
  }

  return terms;
}

/**
 * Parse a single orderBy term: a direction prefix (+/-) followed by a property name.
 */
function parseOrderByTerm(stream: TokenStream): OrderByTerm {
  let direction: 'asc' | 'desc' = 'asc';

  const tok = stream.peek();
  if (tok === '+') {
    direction = 'asc';
    stream.next();
  } else if (tok === '-') {
    direction = 'desc';
    stream.next();
  }

  const property = stream.next();
  return { property, direction };
}

// ============================================================================
// Search terms parser
// ============================================================================

/**
 * Parse an oslc.searchTerms parameter value into an array of search strings.
 *
 * Format: quoted strings separated by commas, e.g. '"term1","term2"'
 */
export function parseSearchTerms(input: string): string[] {
  const tokens = tokenize(input);
  const terms: string[] = [];

  const stream = new TokenStream(tokens);

  if (!stream.hasMore()) {
    return terms;
  }

  terms.push(parseSearchTermValue(stream));
  while (stream.tryConsume(',')) {
    terms.push(parseSearchTermValue(stream));
  }

  return terms;
}

/**
 * Parse a single search term value (expected to be a quoted string).
 */
function parseSearchTermValue(stream: TokenStream): string {
  const tok = stream.next();
  if (tok.startsWith('"') && tok.endsWith('"') && tok.length >= 2) {
    return tok.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  // If not quoted, return as-is (lenient)
  return tok;
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Parse all OSLC query parameters from a params record into a structured OslcQuery.
 *
 * Recognized parameter keys (following OSLC Query 3.0):
 * - oslc.prefix
 * - oslc.where
 * - oslc.select
 * - oslc.orderBy
 * - oslc.searchTerms
 * - oslc.pageSize
 * - oslc.page
 *
 * @param params - A record of query parameter names to their string values.
 * @returns A fully parsed OslcQuery AST.
 */
export function parseOslcQuery(params: Record<string, string | undefined>): OslcQuery {
  const prefixes = params['oslc.prefix']
    ? parsePrefixes(params['oslc.prefix'])
    : new Map<string, string>();

  const query: OslcQuery = { prefixes };

  if (params['oslc.where']) {
    query.where = parseWhere(params['oslc.where']);
  }

  if (params['oslc.select']) {
    query.select = parseSelect(params['oslc.select']);
  }

  if (params['oslc.orderBy']) {
    query.orderBy = parseOrderBy(params['oslc.orderBy']);
  }

  if (params['oslc.searchTerms']) {
    query.searchTerms = parseSearchTerms(params['oslc.searchTerms']);
  }

  if (params['oslc.pageSize'] !== undefined) {
    const size = parseInt(params['oslc.pageSize'], 10);
    if (isNaN(size) || size < 1) {
      throw new Error(`Invalid oslc.pageSize: '${params['oslc.pageSize']}'`);
    }
    query.pageSize = size;
  }

  if (params['oslc.page'] !== undefined) {
    const page = parseInt(params['oslc.page'], 10);
    if (isNaN(page) || page < 1) {
      throw new Error(`Invalid oslc.page: '${params['oslc.page']}'`);
    }
    query.page = page;
  }

  return query;
}
