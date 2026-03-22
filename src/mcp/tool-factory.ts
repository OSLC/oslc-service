/**
 * Generate per-type create and query MCP tool definitions from
 * discovery results.
 *
 * Ported from oslc-mcp-server/src/tools/factory.ts. The key
 * difference: handlers call OslcMcpContext CRUD methods instead of
 * hitting HTTP directly via OSLCClient.
 */

import * as rdflib from 'rdflib';
import type {
  OslcMcpContext,
  McpToolDefinition,
  DiscoveryResult,
  DiscoveredFactory,
  DiscoveredQuery,
} from './context.js';
import { shapeToJsonSchema, buildPredicateMap } from './schema.js';

const rdfNS = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');

/**
 * A generated MCP tool with a handler function.
 * The McpToolDefinition (name, description, inputSchema) is the
 * public metadata; the handler is internal to the middleware.
 */
export interface GeneratedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Sanitize a title into a valid tool name component.
 * Lowercases, replaces spaces/hyphens with underscores,
 * removes other non-alphanumeric chars.
 */
function sanitizeName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Generate per-type create and query tools from discovery results.
 *
 * @param context - The OslcMcpContext to use for CRUD operations
 * @param discovery - The complete discovery result
 * @returns Array of generated tools (metadata + handler)
 */
export function generateTools(
  context: OslcMcpContext,
  discovery: DiscoveryResult
): GeneratedTool[] {
  const tools: GeneratedTool[] = [];
  const usedNames = new Set<string>();

  for (const sp of discovery.serviceProviders) {
    // Generate create tools from factories
    for (const factory of sp.factories) {
      const baseName = sanitizeName(factory.title);
      let createName = `create_${baseName}`;

      // Disambiguate if name collision
      if (usedNames.has(createName)) {
        let counter = 2;
        while (usedNames.has(`${createName}_${counter}`)) counter++;
        createName = `${createName}_${counter}`;
      }
      usedNames.add(createName);

      if (factory.shape) {
        const inputSchema = shapeToJsonSchema(factory.shape, true) as unknown as Record<string, unknown>;
        const predicateMap = buildPredicateMap(factory.shape);

        tools.push({
          name: createName,
          description: `Create a new ${factory.title} resource. ${factory.shape.description ?? ''}`.trim(),
          inputSchema,
          handler: createCreateHandler(context, factory, predicateMap),
        });
      }

      // Generate query tool for matching query capability
      const matchingQuery = sp.queries.find(
        (q) => q.resourceType === factory.resourceType
      );
      if (matchingQuery) {
        const queryName = `query_${baseName}`;
        if (!usedNames.has(queryName)) {
          usedNames.add(queryName);
          tools.push({
            name: queryName,
            description: `Query ${factory.title} resources.`,
            inputSchema: {
              type: 'object',
              properties: {
                filter: {
                  type: 'string',
                  description:
                    'OSLC query filter (oslc.where). Example: dcterms:title="My Resource"',
                },
                select: {
                  type: 'string',
                  description:
                    'Property projection (oslc.select). Example: dcterms:title,dcterms:description',
                },
                orderBy: {
                  type: 'string',
                  description: 'Sort order (oslc.orderBy).',
                },
              },
              required: [],
            },
            handler: createQueryHandler(context, matchingQuery),
          });
        }
      }
    }
  }

  return tools;
}

/**
 * Create a handler function for a create_<type> tool.
 */
function createCreateHandler(
  context: OslcMcpContext,
  factory: DiscoveredFactory,
  predicateMap: Map<string, string>
): (args: Record<string, unknown>) => Promise<string> {
  return async (args: Record<string, unknown>): Promise<string> => {
    // Build RDF graph from the provided properties
    const store = rdflib.graph();
    // Use a placeholder subject -- the server assigns the real URI
    const subject = rdflib.sym('urn:new-resource');

    // Set rdf:type
    if (factory.resourceType) {
      store.add(subject, rdfNS('type'), rdflib.sym(factory.resourceType));
    }

    // Add properties
    for (const [name, value] of Object.entries(args)) {
      const predicateURI = predicateMap.get(name);
      if (!predicateURI) {
        console.error(`[create] Unknown property: ${name}, skipping`);
        continue;
      }
      const predicate = rdflib.sym(predicateURI);

      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (
          typeof v === 'string' &&
          (v.startsWith('http://') || v.startsWith('https://'))
        ) {
          store.add(subject, predicate, rdflib.sym(v));
        } else {
          store.add(subject, predicate, rdflib.lit(String(v)));
        }
      }
    }

    // Serialize to Turtle — use the subject URI as base so rdflib
    // can produce valid output (base must be absolute).
    const turtle = rdflib.serialize(null, store, 'urn:new-resource', 'text/turtle') ?? '';

    // POST via context
    const locationURI = await context.createResource(factory.creationURI, turtle);

    // Fetch the created resource and return JSON representation
    if (locationURI) {
      try {
        const { turtle: createdTurtle } = await context.getResource(locationURI);
        const resultStore = rdflib.graph();
        rdflib.parse(createdTurtle, resultStore, locationURI, 'text/turtle');
        const resultSubject = resultStore.sym(locationURI);
        const statements = resultStore.statementsMatching(resultSubject, null, null);
        const result: Record<string, unknown> = { uri: locationURI };

        for (const st of statements) {
          const key = st.predicate.value.split(/[#/]/).pop() ?? st.predicate.value;
          result[key] = st.object.value;
        }

        return JSON.stringify(result, null, 2);
      } catch {
        return JSON.stringify({ uri: locationURI, created: true });
      }
    }

    return JSON.stringify({ created: true });
  };
}

/**
 * Create a handler function for a query_<type> tool.
 */
function createQueryHandler(
  context: OslcMcpContext,
  queryCapability: DiscoveredQuery
): (args: Record<string, unknown>) => Promise<string> {
  return async (args: Record<string, unknown>): Promise<string> => {
    const result = await context.queryResources(
      queryCapability.queryBase,
      {
        filter: args.filter as string | undefined,
        select: args.select as string | undefined,
        orderBy: args.orderBy as string | undefined,
      }
    );
    return result;
  };
}
