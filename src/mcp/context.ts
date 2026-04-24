/**
 * Shared MCP types and the OslcMcpContext interface.
 *
 * All other MCP modules depend on these types. Ported from
 * oslc-mcp-server/src/types.ts with the addition of the
 * OslcMcpContext abstraction that both the embedded endpoint
 * and the standalone server implement.
 */

// ── Shape and discovery types ───────────────────────────────────

/**
 * A single property from an OSLC ResourceShape.
 */
export interface ShapeProperty {
  /** Short name from oslc:name (used as JSON key in tool input) */
  name: string;
  /** Full predicate URI from oslc:propertyDefinition */
  predicateURI: string;
  /** Human-readable description from dcterms:description */
  description: string;
  /** Value type URI (e.g., xsd:string, oslc:Resource) */
  valueType: string;
  /** Cardinality: 'exactly-one' | 'zero-or-one' | 'zero-or-many' | 'one-or-more' */
  occurs: string;
  /** Expected resource type URI from oslc:range (if resource-valued) */
  range: string | null;
  /** Whether the property is read-only */
  readOnly: boolean;
  /** Allowed values (from oslc:allowedValue / oslc:allowedValues) */
  allowedValues: string[];
  /**
   * URI of the inverse property, from oslc:inversePropertyDefinition.
   * The inverse URI is an identifier only — it is never asserted as a
   * triple. Clients use it to render incoming-link discovery results
   * as if they were outgoing, making link ownership transparent.
   */
  inversePropertyDefinition?: string;
  /**
   * Human-readable label for the inverse, from oslc:inverseLabel.
   * Used by oslc-browser to label incoming-link rows in the UI.
   */
  inverseLabel?: string;
}

/**
 * A discovered OSLC ResourceShape.
 */
export interface DiscoveredShape {
  /** URI of the resource shape */
  shapeURI: string;
  /** Title of the shape from dcterms:title */
  title: string;
  /** Description from dcterms:description */
  description: string;
  /** Properties defined in this shape */
  properties: ShapeProperty[];
}

/**
 * A discovered creation factory from the service provider.
 */
export interface DiscoveredFactory {
  /** Title from dcterms:title */
  title: string;
  /** Creation factory URL for POST */
  creationURI: string;
  /** Resource type URI from oslc:resourceType */
  resourceType: string;
  /** Associated resource shape */
  shape: DiscoveredShape | null;
}

/**
 * A discovered query capability from the service provider.
 */
export interface DiscoveredQuery {
  /** Title from dcterms:title */
  title: string;
  /** Query base URL */
  queryBase: string;
  /** Resource type URI from oslc:resourceType */
  resourceType: string;
}

/**
 * A discovered service provider.
 */
export interface DiscoveredServiceProvider {
  /** Title from dcterms:title */
  title: string;
  /** URI of the service provider */
  uri: string;
  /** Creation factories */
  factories: DiscoveredFactory[];
  /** Query capabilities */
  queries: DiscoveredQuery[];
}

/**
 * Complete discovery result from walking the catalog.
 */
export interface DiscoveryResult {
  /** The catalog URI */
  catalogURI: string;
  /** Whether the server supports JSON-LD */
  supportsJsonLd: boolean;
  /** All discovered service providers */
  serviceProviders: DiscoveredServiceProvider[];
  /** All discovered resource shapes (deduplicated by URI) */
  shapes: Map<string, DiscoveredShape>;
  /** Raw vocabulary content (RDF as readable text) */
  vocabularyContent: string;
  /** Raw catalog content (readable text summary) */
  catalogContent: string;
  /** Raw shapes content (readable text summary) */
  shapesContent: string;
}

// ── OSLC query parameters ───────────────────────────────────────

/**
 * Parameters for OSLC queries (oslc.where, oslc.select, etc.).
 */
export interface OslcQueryParams {
  filter?: string;
  select?: string;
  orderBy?: string;
}

// ── MCP tool and resource definitions ───────────────────────────

/**
 * An MCP tool definition (metadata only, no handler function).
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * An MCP resource definition.
 */
export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  content: string;
}

// ── Context interface ───────────────────────────────────────────

/**
 * Abstract interface for MCP–OSLC integration.
 *
 * Two implementations exist:
 *  - EmbeddedMcpContext  (oslc-service) — in-process via catalog + storage
 *  - HttpMcpContext       (oslc-mcp-server) — over HTTP via oslc-client
 */
export interface OslcMcpContext {
  /** Human-readable server name (e.g., "BMM Server"). */
  serverName: string;
  /** Root URL of the OSLC server (e.g., "http://localhost:3005"). */
  serverBase: string;

  /**
   * Discover all capabilities (tools + resources) from the catalog.
   * Called at startup and again whenever the catalog changes.
   */
  discoverCapabilities(): Promise<{
    tools: McpToolDefinition[];
    resources: McpResourceDefinition[];
  }>;

  /** POST Turtle to a creation factory; returns the Location URI. */
  createResource(factoryURI: string, turtle: string): Promise<string>;

  /** GET a resource; returns Turtle body and ETag. */
  getResource(uri: string): Promise<{ turtle: string; etag: string }>;

  /** PUT updated Turtle with ETag concurrency control. */
  updateResource(uri: string, turtle: string, etag: string): Promise<void>;

  /** DELETE a resource. */
  deleteResource(uri: string): Promise<void>;

  /** Execute an OSLC query against a query capability URL. */
  queryResources(queryURL: string, params: OslcQueryParams): Promise<string>;
}
