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
 * query-translator.ts -- OSLC Query to SPARQL translator.
 *
 * Converts a parsed OslcQuery AST (from query-parser.ts) into a SPARQL
 * CONSTRUCT query string suitable for execution against a triplestore
 * (e.g. Jena Fuseki's union default graph).
 *
 * Two query shapes are produced:
 *
 * 1. **Selected properties** (oslc.select present) -- a CONSTRUCT that
 *    returns only the requested properties using OPTIONAL patterns.
 *
 * 2. **Full representation** (no oslc.select) -- a CONSTRUCT wrapping a
 *    subquery SELECT that filters by type and where-clause, then binds
 *    all triples for the matching subjects via `?s ?p ?o`.
 */

import type {
  OslcQuery,
  WhereExpression,
  SelectTerm,
  OslcValue,
  PrefixMap,
  ComparisonTerm,
  InTerm,
  NestedTerm,
  CompoundTerm,
  OrderByTerm,
} from './query-parser.js';

// ============================================================================
// Well-known prefixes
// ============================================================================

const WELL_KNOWN_PREFIXES: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  dcterms: 'http://purl.org/dc/terms/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  oslc: 'http://open-services.net/ns/core#',
  oslc_cm: 'http://open-services.net/ns/cm#',
  oslc_rm: 'http://open-services.net/ns/rm#',
  oslc_qm: 'http://open-services.net/ns/qm#',
  oslc_am: 'http://open-services.net/ns/am#',
  oslc_config: 'http://open-services.net/ns/config#',
};

// ============================================================================
// Translation context
// ============================================================================

/** Shared mutable counter for generating unique variable names. */
interface VarCounter {
  value: number;
}

/**
 * Manages fresh variable names, accumulated WHERE patterns, and
 * CONSTRUCT patterns during SPARQL generation.
 */
class TranslationContext {
  private readonly counter: VarCounter;
  readonly constructPatterns: string[] = [];
  readonly wherePatterns: string[] = [];
  readonly prefixes: PrefixMap;

  constructor(prefixes: PrefixMap, counter?: VarCounter) {
    this.prefixes = prefixes;
    this.counter = counter ?? { value: 0 };
  }

  /** Generate a fresh SPARQL variable name. */
  freshVar(): string {
    return `?_v${this.counter.value++}`;
  }

  /**
   * Create a child context that shares the same prefix map and variable
   * counter (to avoid name collisions) but has its own pattern arrays.
   */
  childContext(): TranslationContext {
    return new TranslationContext(this.prefixes, this.counter);
  }

  /**
   * Resolve a prefixed name (e.g. "dcterms:title") to a full URI in
   * angle-bracket form (e.g. "<http://purl.org/dc/terms/title>").
   *
   * If the name is already a full URI (contains "://"), wrap it.
   * If it is a bare name with no prefix match, return it as-is
   * (caller may treat it as a local name).
   */
  resolveUri(prefixedName: string): string {
    // Already a full URI
    if (prefixedName.includes('://')) {
      return `<${prefixedName}>`;
    }

    const colonIdx = prefixedName.indexOf(':');
    if (colonIdx === -1) {
      // No prefix -- return as-is (unusual, but defensive)
      return prefixedName;
    }

    const prefix = prefixedName.slice(0, colonIdx);
    const localName = prefixedName.slice(colonIdx + 1);

    // Check query-declared prefixes first
    const ns = this.prefixes.get(prefix);
    if (ns !== undefined) {
      return `<${ns}${localName}>`;
    }

    // Fall back to well-known prefixes
    const wellKnown = WELL_KNOWN_PREFIXES[prefix];
    if (wellKnown !== undefined) {
      return `<${wellKnown}${localName}>`;
    }

    // Unresolvable -- return the prefixed name in angle brackets so the
    // query is at least syntactically valid SPARQL.
    return `<${prefixedName}>`;
  }
}

// ============================================================================
// Value serialization
// ============================================================================

/**
 * Serialize an OslcValue to its SPARQL representation.
 */
function sparqlValue(val: OslcValue, ctx: TranslationContext): string {
  switch (val.kind) {
    case 'string':
      // Escape special characters in the string literal
      return `"${escapeSparqlString(val.value)}"`;
    case 'number':
      return val.value;
    case 'boolean':
      return `"${val.value}"^^<http://www.w3.org/2001/XMLSchema#boolean>`;
    case 'uri':
      // Could be a prefixed name or a full URI
      return ctx.resolveUri(val.value);
  }
}

/**
 * Escape characters that are special inside a SPARQL double-quoted string.
 */
function escapeSparqlString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// ============================================================================
// SPARQL operator mapping
// ============================================================================

/**
 * Map OSLC comparison operators to SPARQL FILTER operators.
 * All OSLC operators map directly to SPARQL.
 */
function sparqlOp(op: ComparisonTerm['operator']): string {
  return op;
}

// ============================================================================
// WHERE clause translation
// ============================================================================

/**
 * Translate a WhereExpression AST into SPARQL WHERE patterns,
 * appending to `ctx.wherePatterns`.
 *
 * @param expr  The where-clause AST node.
 * @param ctx   Translation context.
 * @param subject  The SPARQL variable for the current subject (e.g. "?s").
 */
function translateWhere(
  expr: WhereExpression,
  ctx: TranslationContext,
  subject: string,
): void {
  switch (expr.type) {
    case 'comparison':
      translateComparison(expr, ctx, subject);
      break;
    case 'in':
      translateIn(expr, ctx, subject);
      break;
    case 'nested':
      translateNested(expr, ctx, subject);
      break;
    case 'compound':
      translateCompound(expr, ctx, subject);
      break;
  }
}

function translateComparison(
  expr: ComparisonTerm,
  ctx: TranslationContext,
  subject: string,
): void {
  const pred = ctx.resolveUri(expr.property);
  const v = ctx.freshVar();
  ctx.wherePatterns.push(`${subject} ${pred} ${v} .`);
  ctx.wherePatterns.push(
    `FILTER(${v} ${sparqlOp(expr.operator)} ${sparqlValue(expr.value, ctx)})`,
  );
}

function translateIn(
  expr: InTerm,
  ctx: TranslationContext,
  subject: string,
): void {
  const pred = ctx.resolveUri(expr.property);
  const v = ctx.freshVar();
  const values = expr.values.map((val) => sparqlValue(val, ctx)).join(', ');
  ctx.wherePatterns.push(`${subject} ${pred} ${v} .`);
  ctx.wherePatterns.push(`FILTER(${v} IN (${values}))`);
}

function translateNested(
  expr: NestedTerm,
  ctx: TranslationContext,
  subject: string,
): void {
  const pred = ctx.resolveUri(expr.property);
  const nestedVar = ctx.freshVar();
  ctx.wherePatterns.push(`${subject} ${pred} ${nestedVar} .`);
  translateWhere(expr.inner, ctx, nestedVar);
}

function translateCompound(
  expr: CompoundTerm,
  ctx: TranslationContext,
  subject: string,
): void {
  if (expr.operator === 'and') {
    // AND: simply concatenate all operand conditions
    for (const operand of expr.operands) {
      translateWhere(operand, ctx, subject);
    }
  } else {
    // OR: use OPTIONAL + FILTER(bound(...) || bound(...))
    // Each branch gets its own OPTIONAL block with a marker variable.
    // We then FILTER that at least one marker is bound.
    const markers: string[] = [];
    for (const operand of expr.operands) {
      const branchCtx = ctx.childContext();
      translateWhere(operand, branchCtx, subject);
      const marker = ctx.freshVar();
      markers.push(marker);
      const branchPatterns = branchCtx.wherePatterns.join('\n    ');
      ctx.wherePatterns.push(
        `OPTIONAL {\n    ${branchPatterns}\n    BIND(true AS ${marker})\n  }`,
      );
    }
    const boundChecks = markers.map((m) => `BOUND(${m})`).join(' || ');
    ctx.wherePatterns.push(`FILTER(${boundChecks})`);
  }
}

// ============================================================================
// SELECT clause translation (CONSTRUCT patterns)
// ============================================================================

/**
 * Translate SelectTerm[] into CONSTRUCT and OPTIONAL WHERE patterns.
 *
 * @param selectTerms  The select-clause AST.
 * @param ctx          Translation context to append to.
 * @param subject      The current subject variable (e.g. "?s").
 */
function translateSelect(
  selectTerms: SelectTerm[],
  ctx: TranslationContext,
  subject: string,
): void {
  for (const term of selectTerms) {
    switch (term.type) {
      case 'wildcard':
        // Wildcard: select all properties -- degenerate to full representation
        // We handle this at the top level by falling through to the
        // "no select" branch, but if a wildcard appears as a nested child,
        // we just bind ?p ?o.
        {
          const pVar = ctx.freshVar();
          const oVar = ctx.freshVar();
          ctx.constructPatterns.push(`${subject} ${pVar} ${oVar} .`);
          ctx.wherePatterns.push(
            `OPTIONAL { ${subject} ${pVar} ${oVar} . }`,
          );
        }
        break;

      case 'property':
        {
          const pred = ctx.resolveUri(term.property);
          const v = ctx.freshVar();
          ctx.constructPatterns.push(`${subject} ${pred} ${v} .`);
          ctx.wherePatterns.push(
            `OPTIONAL { ${subject} ${pred} ${v} . }`,
          );
        }
        break;

      case 'nested':
        {
          const pred = ctx.resolveUri(term.property);
          const nestedVar = ctx.freshVar();
          ctx.constructPatterns.push(`${subject} ${pred} ${nestedVar} .`);
          ctx.wherePatterns.push(
            `OPTIONAL { ${subject} ${pred} ${nestedVar} . }`,
          );
          // Recurse for nested children
          translateSelect(term.children, ctx, nestedVar);
        }
        break;
    }
  }
}

// ============================================================================
// Search terms translation
// ============================================================================

/**
 * Generate FILTER patterns for oslc.searchTerms.
 *
 * Each search term generates a pattern that binds all literal values of
 * the subject and checks whether any contains the search term
 * (case-insensitive substring match).
 */
function translateSearchTerms(
  terms: string[],
  ctx: TranslationContext,
  subject: string,
): void {
  for (const term of terms) {
    const v = ctx.freshVar();
    const escaped = escapeSparqlString(term.toLowerCase());
    ctx.wherePatterns.push(`${subject} ?_searchPred${v.slice(1)} ${v} .`);
    ctx.wherePatterns.push(
      `FILTER(CONTAINS(LCASE(STR(${v})), "${escaped}"))`,
    );
  }
}

// ============================================================================
// ORDER BY translation
// ============================================================================

/**
 * Build an ORDER BY clause string from OrderByTerm[].
 */
function buildOrderBy(
  orderBy: OrderByTerm[],
  ctx: TranslationContext,
  subject: string,
): { clause: string; patterns: string[] } {
  const parts: string[] = [];
  const patterns: string[] = [];
  for (const term of orderBy) {
    const pred = ctx.resolveUri(term.property);
    const v = ctx.freshVar();
    patterns.push(`OPTIONAL { ${subject} ${pred} ${v} . }`);
    if (term.direction === 'asc') {
      parts.push(`ASC(${v})`);
    } else {
      parts.push(`DESC(${v})`);
    }
  }
  return {
    clause: `ORDER BY ${parts.join(' ')}`,
    patterns,
  };
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Convert a parsed OslcQuery AST into a SPARQL CONSTRUCT query string.
 *
 * @param query         The parsed OSLC query AST.
 * @param resourceType  The full URI of the rdf:type to constrain results to.
 * @param defaultPrefixes  Optional additional prefix mappings merged under
 *                         (i.e. lower priority than) the query's own prefixes.
 * @returns A SPARQL CONSTRUCT query string.
 */
export function toSPARQL(
  query: OslcQuery,
  resourceType: string,
  defaultPrefixes?: PrefixMap,
): string {
  // Merge prefixes: query-declared override defaults override well-known
  const mergedPrefixes: PrefixMap = new Map();
  if (defaultPrefixes) {
    for (const [k, v] of defaultPrefixes) {
      mergedPrefixes.set(k, v);
    }
  }
  for (const [k, v] of query.prefixes) {
    mergedPrefixes.set(k, v);
  }

  const ctx = new TranslationContext(mergedPrefixes);

  // Check if any select term is a wildcard -- if so, treat as full representation
  const hasWildcard = query.select?.some((t) => t.type === 'wildcard') ?? false;
  const hasSelect = query.select && query.select.length > 0 && !hasWildcard;

  if (hasSelect) {
    return buildSelectedPropertiesQuery(query, resourceType, ctx);
  } else {
    return buildFullRepresentationQuery(query, resourceType, ctx);
  }
}

// ============================================================================
// Selected-properties query shape
// ============================================================================

/**
 * Build a CONSTRUCT query that returns only the selected properties.
 *
 * ```sparql
 * CONSTRUCT {
 *   ?s rdf:type <resourceType> .
 *   ?s <prop1> ?v1 .
 *   ?s <prop2> ?v2 .
 * }
 * WHERE {
 *   ?s rdf:type <resourceType> .
 *   [where conditions]
 *   [search terms]
 *   OPTIONAL { ?s <prop1> ?v1 . }
 *   OPTIONAL { ?s <prop2> ?v2 . }
 * }
 * ```
 */
function buildSelectedPropertiesQuery(
  query: OslcQuery,
  resourceType: string,
  ctx: TranslationContext,
): string {
  const rdfType = '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>';
  const typeUri = resourceType.startsWith('<') ? resourceType : `<${resourceType}>`;
  const typeTriple = `?s ${rdfType} ${typeUri} .`;

  // Always include the type triple in CONSTRUCT
  ctx.constructPatterns.push(typeTriple);

  // WHERE starts with the type constraint
  ctx.wherePatterns.push(typeTriple);

  // Translate where clause
  if (query.where) {
    translateWhere(query.where, ctx, '?s');
  }

  // Translate search terms
  if (query.searchTerms && query.searchTerms.length > 0) {
    translateSearchTerms(query.searchTerms, ctx, '?s');
  }

  // Translate select clause (adds CONSTRUCT patterns + OPTIONAL WHERE patterns)
  translateSelect(query.select!, ctx, '?s');

  // Build the query string
  const construct = ctx.constructPatterns.map((p) => `  ${p}`).join('\n');
  const where = ctx.wherePatterns.map((p) => `  ${p}`).join('\n');

  let sparql = `CONSTRUCT {\n${construct}\n}\nWHERE {\n${where}\n}`;

  // Paging for selected-properties queries (applied at outer level)
  if (query.pageSize !== undefined) {
    sparql += `\nLIMIT ${query.pageSize}`;
    if (query.page !== undefined) {
      sparql += `\nOFFSET ${(query.page - 1) * query.pageSize}`;
    }
  }

  return sparql;
}

// ============================================================================
// Full-representation query shape
// ============================================================================

/**
 * Build a CONSTRUCT query that returns full representations of matching
 * resources using a subquery.
 *
 * ```sparql
 * CONSTRUCT { ?s ?p ?o }
 * WHERE {
 *   { SELECT ?s WHERE {
 *       ?s rdf:type <resourceType> .
 *       [where conditions]
 *       [search terms]
 *     }
 *     [ORDER BY ...]
 *     [LIMIT/OFFSET]
 *   }
 *   ?s ?p ?o .
 * }
 * ```
 */
function buildFullRepresentationQuery(
  query: OslcQuery,
  resourceType: string,
  ctx: TranslationContext,
): string {
  const rdfType = '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>';
  const typeUri = resourceType.startsWith('<') ? resourceType : `<${resourceType}>`;
  const typeTriple = `?s ${rdfType} ${typeUri} .`;

  // Subquery WHERE patterns
  const subWherePatterns: string[] = [typeTriple];

  // Translate where clause into subquery patterns
  if (query.where) {
    const subCtx = ctx.childContext();
    translateWhere(query.where, subCtx, '?s');
    subWherePatterns.push(...subCtx.wherePatterns);
  }

  // Translate search terms
  if (query.searchTerms && query.searchTerms.length > 0) {
    const searchCtx = ctx.childContext();
    translateSearchTerms(query.searchTerms, searchCtx, '?s');
    subWherePatterns.push(...searchCtx.wherePatterns);
  }

  // ORDER BY
  let orderByClause = '';
  if (query.orderBy && query.orderBy.length > 0) {
    const orderCtx = ctx.childContext();
    const { clause, patterns } = buildOrderBy(query.orderBy, orderCtx, '?s');
    subWherePatterns.push(...patterns);
    orderByClause = `\n    ${clause}`;
  }

  // LIMIT / OFFSET
  let pagingClause = '';
  if (query.pageSize !== undefined) {
    pagingClause += `\n    LIMIT ${query.pageSize}`;
    if (query.page !== undefined) {
      pagingClause += `\n    OFFSET ${(query.page - 1) * query.pageSize}`;
    }
  }

  // Build the subquery WHERE block
  const subWhere = subWherePatterns.map((p) => `      ${p}`).join('\n');

  // Assemble
  const subquery = [
    '  { SELECT ?s WHERE {',
    subWhere,
    `    }${orderByClause}${pagingClause}`,
    '  }',
  ].join('\n');

  return [
    'CONSTRUCT { ?s ?p ?o }',
    'WHERE {',
    subquery,
    '  ?s ?p ?o .',
    '}',
  ].join('\n');
}
