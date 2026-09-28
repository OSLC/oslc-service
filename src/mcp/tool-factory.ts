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
    .replace(/[^a-z0-9_]/g, '')
    // a title of only punctuation or whitespace sanitizes to underscores, which
    // would yield `create__`; collapse runs and drop the edges so an empty stem
    // is recognisably empty and the fallbacks below can act on it.
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Boilerplate a server wraps around the type in a creation factory's title.
 * Stripped so the tool name says what is created and nothing else.
 *
 * Real titles this exists for, from ELM 7.1 SR1 and a genOSLC owned domain:
 *
 *   "Create Finding"                                  -> create_finding
 *   "Default creation factory for TestCase"           -> create_testcase
 *   "Location for creation of Defect change requests" -> create_defect
 *   "Requirement Creation Factory"                    -> create_requirement
 *   "ReqIF Export Factory"                            -> create_reqif_export
 *
 * Untouched, those become `create_create_finding` and
 * `create_location_for_creation_of_defect_change_requests`.
 */
const TITLE_PREFIX = [
  /^default creation factory for\s+/,
  /^location for creation of\s+/,
  /^creation factory for\s+/,
  /^create\s+/,
  /^new\s+/,
];

const TITLE_SUFFIX = [
  /\s+change requests?$/,
  /\s+creation factory$/,
  /\s+factory$/,
];

/**
 * The tool name for a creation factory: `create_` plus the type it creates.
 *
 * Derived from the title rather than from `oslc:resourceType`, because a server
 * may advertise many factories for ONE type and the title is what distinguishes
 * them — EWM advertises ten factories that all create `oslc_cm:ChangeRequest`,
 * one per work-item type, so the type alone would collide ten ways. The resource
 * type is the fallback for a title that is entirely boilerplate ("Location for
 * creation of change requests"), and the raw title the fallback after that.
 *
 * Exported and shared rather than copied: the rule is a list of patterns now,
 * not three character replacements, and a second copy would drift silently while
 * `describe_discovery` must report the name the factory will actually produce.
 */
export function createToolName(title: string, resourceType?: string): string {
  let stem = (title ?? '').trim().toLowerCase();
  for (const p of TITLE_PREFIX) {
    if (p.test(stem)) { stem = stem.replace(p, ''); break; }
  }
  for (const sfx of TITLE_SUFFIX) {
    if (sfx.test(stem)) { stem = stem.replace(sfx, ''); break; }
  }
  let name = sanitizeName(stem);
  if (!name && resourceType) name = sanitizeName(uriLocalName(resourceType));
  if (!name) name = sanitizeName(title ?? '');
  return `create_${name || 'resource'}`;
}

/** The fragment or last path segment of a URI. */
function uriLocalName(uri: string): string {
  const cut = Math.max(uri.lastIndexOf('#'), uri.lastIndexOf('/'));
  return cut >= 0 ? uri.slice(cut + 1) : uri;
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

  // Per-type query_<class> tools are intentionally NOT generated. With
  // the server consolidated to a single QueryCapability per
  // ServiceProvider, the standard query_resources tool (in
  // tool-handlers.ts) accepts a queryBase + arbitrary oslc.where
  // filter and is sufficient. Generating 14 per-type wrappers just
  // bloats the tool list and duplicates what callers can already
  // express with `oslc.where=rdf:type=<...>`.
  for (const sp of discovery.serviceProviders) {
    for (const factory of sp.factories) {
      let createName = createToolName(factory.title, factory.resourceType);

      // Disambiguate if name collision
      if (usedNames.has(createName)) {
        let counter = 2;
        while (usedNames.has(`${createName}_${counter}`)) counter++;
        createName = `${createName}_${counter}`;
      }
      usedNames.add(createName);

      // A factory advertising several shapes stays ONE tool. Splitting it
      // into one tool per shape multiplies the tool list by the provider's
      // type system -- DOORS Next advertises 21 -- for no gain, since they
      // all POST to the same URL. The caller picks with `instanceShape`,
      // and the schema is the union of the shapes' properties.
      const allShapes =
        factory.shapes && factory.shapes.length > 0
          ? factory.shapes
          : factory.shape
            ? [factory.shape]
            : [];

      if (allShapes.length > 0) {
        const inputSchema = shapeToJsonSchema(allShapes[0], true) as unknown as Record<string, unknown>;
        const predicateMap = buildPredicateMap(allShapes[0]);
        for (const extra of allShapes.slice(1)) {
          const extraSchema = shapeToJsonSchema(extra, true) as unknown as Record<string, unknown>;
          Object.assign(
            inputSchema.properties as Record<string, unknown>,
            extraSchema.properties as Record<string, unknown>
          );
          for (const [name, predicateURI] of buildPredicateMap(extra)) {
            if (!predicateMap.has(name)) predicateMap.set(name, predicateURI);
          }
        }
        if (allShapes.length > 1) {
          (inputSchema.properties as Record<string, unknown>).instanceShape = {
            type: 'string',
            enum: allShapes.map((sh) => sh.shapeURI),
            description:
              'Which shape to create against. Defaults to the first shape ' +
              'the factory advertises, which is rarely the one you want when ' +
              'the provider advertises many.',
          };
        }

        // rdf:type is the CALLER's choice, from what the provider advertises.
        //
        // oslc:resourceType is Zero-or-many on a CreationFactory and
        // oslc:resourceShape is Zero-or-many alongside it, the shapes
        // constraining the types. So a factory legitimately creates several
        // types and the caller picks the one that fits the resource it is
        // creating -- a judgement about the resource, which only the caller
        // can make. Offering the union of what the factory advertises and
        // what its shapes declare via oslc:describes is what makes that
        // choice possible; collapsing it to one is the tool guessing.
        //
        // It also guesses WRONG on DOORS Next, whose Requirement Creation
        // Factory advertises exactly one oslc:resourceType --
        // jazz sse#UserRequirement -- that its own shape does not describe
        // and that it then refuses in a creation body:
        //   403  CRRRS6401E  Error parsing content. Content must be valid rdf+xml.
        // an error naming the syntax although the body is well-formed XML.
        // The identical body typed oslc_rm:Requirement, which the shape does
        // describe, is accepted.
        const candidateTypes = [
          ...new Set([
            ...(factory.resourceTypes ?? (factory.resourceType ? [factory.resourceType] : [])),
            ...allShapes.flatMap((sh) => sh.access?.describes ?? []),
          ]),
        ];
        if (candidateTypes.length > 1) {
          (inputSchema.properties as Record<string, unknown>).resourceType = {
            type: 'array',
            items: { type: 'string', enum: candidateTypes },
            description:
              'rdf:type(s) for the new resource, chosen from what this factory ' +
              'and its shapes advertise. A resource may carry several. Pick the ' +
              'type that fits what you are creating; the provider may reject a ' +
              'type its shape does not describe.',
          };
        }

        // Template-derived factories (advertised before any concrete SP
        // exists) have an empty creationURI. Their tool *metadata* is
        // useful to AI clients exploring the server, but invoking the
        // handler would compute a relative URI and crash. Replace the
        // handler with a clear error so the user knows to call
        // create_service_provider first; the real handler gets wired
        // in by rediscovery after an SP is created.
        const handler = factory.creationURI
          ? createCreateHandler(context, factory, predicateMap)
          : async () => {
              throw new Error(
                `No ServiceProvider exists yet for ${factory.title}. ` +
                `Call create_service_provider first.`
              );
            };

        tools.push({
          name: createName,
          description: `Create a new ${factory.title} resource. ${allShapes[0].description ?? ''}`.trim(),
          inputSchema,
          handler,
        });
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

    // Add oslc:instanceShape pointing to this factory's shape. The HTTP
    // POST middleware in service.ts does this for the REST path by
    // matching rdf:type against factory.oslc:resourceType; the MCP path
    // bypasses that middleware and goes directly to storage, so we must
    // set these OSLC standard properties here.
    // oslc:instanceShape. The factory may advertise several shapes -- also
    // Zero-or-many -- in which case the caller chooses one by passing
    // `instanceShape`; anything else is the tool guessing which kind of
    // resource the engineer meant to create. An unrecognised value falls
    // back to the first advertised shape rather than being sent on.
    const advertisedShapes =
      factory.shapes && factory.shapes.length > 0
        ? factory.shapes
        : factory.shape
          ? [factory.shape]
          : [];
    const requestedShape = typeof args.instanceShape === 'string' ? args.instanceShape : '';
    const chosenShape =
      advertisedShapes.find((sh) => sh.shapeURI === requestedShape) ?? advertisedShapes[0];
    if (chosenShape?.shapeURI) {
      store.add(
        subject,
        rdflib.sym('http://open-services.net/ns/core#instanceShape'),
        rdflib.sym(chosenShape.shapeURI)
      );
    }

    // rdf:type -- the caller's choice, validated against what is advertised.
    //
    // The tool schema offers `resourceType` as an enum over the union of the
    // factory's oslc:resourceType and its shapes' oslc:describes (see
    // generateTools). Honour what the caller picked; fall back only to an
    // advertised type the chosen shape actually describes, because a type the
    // shape does not describe is one the provider is entitled to refuse --
    // and DOORS Next does refuse its own advertised jazz sse#UserRequirement
    // with a 403 CRRRS6401E blaming the RDF/XML syntax.
    const describedTypes = chosenShape?.access?.describes ?? [];
    const advertisedTypes =
      factory.resourceTypes ?? (factory.resourceType ? [factory.resourceType] : []);
    const requestedTypes = Array.isArray(args.resourceType)
      ? (args.resourceType as unknown[]).filter((t): t is string => typeof t === 'string')
      : typeof args.resourceType === 'string'
        ? [args.resourceType]
        : [];
    const consistentAdvertised = advertisedTypes.filter(
      (t) => describedTypes.length === 0 || describedTypes.includes(t)
    );
    const declaredTypes =
      requestedTypes.length > 0
        ? requestedTypes
        : consistentAdvertised.length > 0
          ? consistentAdvertised
          : advertisedTypes;
    for (const t of declaredTypes) {
      store.add(subject, rdfNS('type'), rdflib.sym(t));
    }

    // Add oslc:serviceProvider derived from the factory creation URL.
    // Factory URL pattern: {spURI}/resources — strip trailing /resources
    // (or whatever path segment) to get the SP URI.
    const spURI = factory.creationURI.replace(/\/[^/]+\/?$/, '');
    if (spURI && spURI !== factory.creationURI) {
      store.add(
        subject,
        rdflib.sym('http://open-services.net/ns/core#serviceProvider'),
        rdflib.sym(spURI)
      );
    }

    // Add dcterms:created timestamp and dcterms:creator.
    store.add(
      subject,
      rdflib.sym('http://purl.org/dc/terms/created'),
      rdflib.lit(new Date().toISOString(), undefined, rdflib.sym('http://www.w3.org/2001/XMLSchema#dateTime'))
    );
    store.add(
      subject,
      rdflib.sym('http://purl.org/dc/terms/creator'),
      rdflib.lit('mcp')
    );

    // Add properties
    for (const [name, value] of Object.entries(args)) {
      // Consumed above to choose the shape, and deliberately not in the
      // predicate map -- it selects the shape rather than being a property
      // of it.
      if (name === 'instanceShape' || name === 'resourceType') continue;
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
