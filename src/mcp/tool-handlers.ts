/**
 * Generic CRUD tool handlers for the MCP endpoint.
 *
 * Ported from oslc-mcp-server/src/tools/generic.ts. Handlers use
 * OslcMcpContext instead of OSLCClient for all operations.
 */

import * as rdflib from 'rdflib';
import type { IndexedFormula } from 'rdflib';
import type {
  OslcMcpContext,
  DiscoveryResult,
} from './context.js';
import type { EmbeddedMcpContext } from './embedded-context.js';
import { buildPredicateMapForResource } from './schema.js';

const rdfNS = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');

// ── Utility ─────────────────────────────────────────────────────

/**
 * Convert an rdflib store's statements about a subject into a plain
 * JSON object for tool output.
 */
export function resourceToJson(store: IndexedFormula, uri: string): Record<string, unknown> {
  const subject = store.sym(uri);
  const statements = store.statementsMatching(subject, null, null);
  const result: Record<string, unknown> = { uri };

  const grouped: Record<string, unknown[]> = {};
  for (const st of statements) {
    const predicate = st.predicate.value;
    const key = predicate.split(/[#/]/).pop() ?? predicate;
    const value = st.object.termType === 'NamedNode'
      ? { uri: st.object.value }
      : st.object.value;

    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(value);
  }

  for (const [key, values] of Object.entries(grouped)) {
    result[key] = values.length === 1 ? values[0] : values;
  }

  return result;
}

// ── Handler: get_resource ───────────────────────────────────────

/**
 * Handler for get_resource tool.
 */
export async function handleGetResource(
  context: OslcMcpContext,
  args: { uri: string }
): Promise<string> {
  const { turtle } = await context.getResource(args.uri);
  const store = rdflib.graph();
  rdflib.parse(turtle, store, args.uri, 'text/turtle');
  const json = resourceToJson(store, args.uri);
  return JSON.stringify(json, null, 2);
}

// ── Handler: update_resource ────────────────────────────────────

/**
 * Handler for update_resource tool.
 */
export async function handleUpdateResource(
  context: OslcMcpContext,
  discovery: DiscoveryResult,
  args: { uri: string; properties: Record<string, unknown> }
): Promise<string> {
  // GET current resource with ETag
  const { turtle, etag } = await context.getResource(args.uri);
  const store = rdflib.graph();
  rdflib.parse(turtle, store, args.uri, 'text/turtle');
  const subject = store.sym(args.uri);

  // Find the shape for this resource to map property names to predicate URIs
  const predicateMap = buildPredicateMapForResource(store, args.uri, discovery);

  // Apply property changes
  for (const [name, value] of Object.entries(args.properties)) {
    const predicateURI = predicateMap.get(name);
    if (!predicateURI) {
      console.error(`[update] Unknown property: ${name}, using as-is`);
      continue;
    }

    const predicate = store.sym(predicateURI);

    // Remove existing values for this predicate
    const existing = store.statementsMatching(subject, predicate, null);
    for (const st of existing) {
      store.remove(st);
    }

    // Add new values
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))) {
        store.add(subject, predicate, store.sym(v));
      } else {
        store.add(subject, predicate, rdflib.lit(String(v)));
      }
    }
  }

  // Serialize and PUT with ETag
  const updatedTurtle = rdflib.serialize(null, store, args.uri, 'text/turtle') ?? '';
  await context.updateResource(args.uri, updatedTurtle, etag);

  // Re-fetch to return current state
  const { turtle: freshTurtle } = await context.getResource(args.uri);
  const freshStore = rdflib.graph();
  rdflib.parse(freshTurtle, freshStore, args.uri, 'text/turtle');
  const json = resourceToJson(freshStore, args.uri);
  return JSON.stringify(json, null, 2);
}

// ── Handler: delete_resource ────────────────────────────────────

/**
 * Handler for delete_resource tool.
 */
export async function handleDeleteResource(
  context: OslcMcpContext,
  args: { uri: string }
): Promise<string> {
  await context.deleteResource(args.uri);
  return JSON.stringify({ deleted: true, uri: args.uri });
}

// ── Handler: list_resource_types ────────────────────────────────

/**
 * Handler for list_resource_types tool.
 *
 * Returns server identity (name, base) alongside the array of types.
 * This is a behavioral change from the standalone server, which
 * returns a bare array.
 */
export function handleListResourceTypes(
  context: OslcMcpContext,
  discovery: DiscoveryResult
): string {
  const types: unknown[] = [];

  for (const sp of discovery.serviceProviders) {
    // The SP has a single shared query endpoint; every type is queried
    // via that endpoint with an oslc.where=rdf:type=... filter.
    const queryBase = sp.queries[0]?.queryBase ?? null;

    for (const factory of sp.factories) {
      types.push({
        name: factory.title,
        resourceType: factory.resourceType,
        creationFactory: factory.creationURI,
        queryCapability: queryBase,
        serviceProvider: sp.title,
        properties: factory.shape
          ? factory.shape.properties
              .filter((p) => !p.readOnly)
              .map((p) => ({
                name: p.name,
                type: p.valueType.split(/[#/]/).pop(),
                required:
                  p.occurs === 'exactly-one' || p.occurs === 'one-or-more',
              }))
          : [],
      });
    }
  }

  return JSON.stringify(
    { server: context.serverName, base: context.serverBase, types },
    null,
    2
  );
}

// ── Handler: query_resources ────────────────────────────────────

/**
 * Handler for query_resources tool.
 */
export async function handleQueryResources(
  context: OslcMcpContext,
  args: { queryBase: string; filter?: string; select?: string; orderBy?: string }
): Promise<string> {
  const result = await context.queryResources(args.queryBase, {
    filter: args.filter,
    select: args.select,
    orderBy: args.orderBy,
  });
  return result;
}

// ── Handler: create_service_provider ───────────────────────────

/**
 * Handler for create_service_provider tool.
 * Creates a new ServiceProvider in the catalog and triggers MCP
 * rediscovery so that create/query tools for the new SP become available.
 */
export async function handleCreateServiceProvider(
  context: EmbeddedMcpContext,
  args: { title: string; slug: string; description?: string }
): Promise<string> {
  const spURI = await context.createSP(args.title, args.slug, args.description);
  return JSON.stringify({
    uri: spURI,
    title: args.title,
    slug: args.slug,
    message: `ServiceProvider "${args.title}" created at ${spURI}. New create/query tools are now available for this ServiceProvider.`,
  });
}
