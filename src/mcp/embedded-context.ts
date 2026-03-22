/**
 * EmbeddedMcpContext -- implements OslcMcpContext using the in-process
 * catalog state and storage service.
 *
 * This is the key new code that has no oslc-mcp-server equivalent.
 * It reads shapes from storage, uses the catalog template to enumerate
 * capabilities, and performs CRUD directly through the storage service.
 */

import * as rdflib from 'rdflib';
import type { IndexedFormula, NamedNode } from 'rdflib';
import { type StorageService, type LdpDocument } from 'storage-service';
import type { CatalogState } from '../catalog.js';
import type { OslcEnv } from '../service.js';
import type {
  OslcMcpContext,
  McpToolDefinition,
  McpResourceDefinition,
  DiscoveryResult,
  DiscoveredServiceProvider,
  DiscoveredFactory,
  DiscoveredQuery,
  DiscoveredShape,
  OslcQueryParams,
} from './context.js';
import { parseShape } from './schema.js';
import { generateTools, type GeneratedTool } from './tool-factory.js';
import { buildMcpResources, formatCatalogContent, formatShapesContent, formatVocabularyContent } from './resources.js';

const OSLC = rdflib.Namespace('http://open-services.net/ns/core#');
const DCTERMS = rdflib.Namespace('http://purl.org/dc/terms/');
const LDP = rdflib.Namespace('http://www.w3.org/ns/ldp#');

/**
 * EmbeddedMcpContext uses in-memory catalog state and storage to
 * provide MCP capabilities without HTTP round-trips.
 */
export class EmbeddedMcpContext implements OslcMcpContext {
  readonly serverName: string;
  readonly serverBase: string;

  private readonly catalogState: CatalogState;
  private readonly storage: StorageService;
  private readonly env: OslcEnv;

  /** Cached discovery result for use by tool handlers. */
  private discoveryResult: DiscoveryResult | null = null;

  /** Generated tools with handlers, keyed by name. */
  private generatedToolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<string>>();

  constructor(catalogState: CatalogState, storage: StorageService, env: OslcEnv) {
    this.catalogState = catalogState;
    this.storage = storage;
    this.env = env;
    this.serverName = catalogState.template.catalogProps.title;
    this.serverBase = env.appBase;
  }

  /**
   * Get the current discovery result (for tool handlers that need it).
   */
  getDiscoveryResult(): DiscoveryResult | null {
    return this.discoveryResult;
  }

  /**
   * Get a generated tool handler by name.
   */
  getGeneratedHandler(name: string): ((args: Record<string, unknown>) => Promise<string>) | undefined {
    return this.generatedToolHandlers.get(name);
  }

  // ── Discovery ───────────────────────────────────────────────

  async discoverCapabilities(): Promise<{
    tools: McpToolDefinition[];
    resources: McpResourceDefinition[];
  }> {
    const template = this.catalogState.template;
    const shapes = new Map<string, DiscoveredShape>();
    const serviceProviders: DiscoveredServiceProvider[] = [];

    // Read existing SPs from the catalog in storage
    const { status, document: catalogDoc } = await this.storage.read(this.catalogState.catalogURI);
    const spURIs: string[] = [];
    if (status === 200 && catalogDoc) {
      const catalogStore = catalogDoc as unknown as IndexedFormula;
      const containsNodes = catalogStore.each(
        rdflib.sym(this.catalogState.catalogURI),
        LDP('contains'),
        undefined
      );
      for (const node of containsNodes) {
        spURIs.push(node.value);
      }
    }

    // For each existing SP, read it from storage and extract capabilities
    for (const spURI of spURIs) {
      const { status: spStatus, document: spDoc } = await this.storage.read(spURI);
      if (spStatus !== 200 || !spDoc) continue;

      const spStore = spDoc as unknown as IndexedFormula;
      const spSym = rdflib.sym(spURI);
      const spTitle = spStore.anyValue(spSym, DCTERMS('title')) ?? spURI;

      const factories: DiscoveredFactory[] = [];
      const queries: DiscoveredQuery[] = [];

      const serviceNodes = spStore.each(spSym, OSLC('service'), null);
      for (const serviceNode of serviceNodes) {
        const sn = serviceNode as NamedNode;

        // Creation factories
        const factoryNodes = spStore.each(sn, OSLC('creationFactory'), null);
        for (const factoryNode of factoryNodes) {
          const fn = factoryNode as NamedNode;
          const factoryTitle = spStore.anyValue(fn, DCTERMS('title')) ?? '';
          const creationNode = spStore.any(fn, OSLC('creation'), null);
          const creationURI = creationNode?.value ?? '';
          const resourceTypeNode = spStore.any(fn, OSLC('resourceType'), null);
          const resourceType = resourceTypeNode?.value ?? '';
          const shapeNode = spStore.any(fn, OSLC('resourceShape'), null);

          let shape: DiscoveredShape | null = null;
          if (shapeNode) {
            const shapeURI = shapeNode.value;
            if (shapes.has(shapeURI)) {
              shape = shapes.get(shapeURI)!;
            } else {
              shape = await this.fetchAndParseShape(shapeURI);
              if (shape) {
                shapes.set(shapeURI, shape);
              }
            }
          }

          if (creationURI) {
            factories.push({ title: factoryTitle, creationURI, resourceType, shape });
          }
        }

        // Query capabilities
        const queryNodes = spStore.each(sn, OSLC('queryCapability'), null);
        for (const queryNode of queryNodes) {
          const qn = queryNode as NamedNode;
          const queryTitle = spStore.anyValue(qn, DCTERMS('title')) ?? '';
          const queryBaseNode = spStore.any(qn, OSLC('queryBase'), null);
          const queryBase = queryBaseNode?.value ?? '';
          const resourceTypeNode = spStore.any(qn, OSLC('resourceType'), null);
          const resourceType = resourceTypeNode?.value ?? '';

          if (queryBase) {
            queries.push({ title: queryTitle, queryBase, resourceType });
          }
        }
      }

      serviceProviders.push({ title: spTitle, uri: spURI, factories, queries });
    }

    // If no SPs exist yet, build capabilities from the template
    // (so the tools are available even before a ServiceProvider is created)
    if (serviceProviders.length === 0) {
      const templateSP = await this.buildFromTemplate(shapes);
      if (templateSP) {
        serviceProviders.push(templateSP);
      }
    }

    // Build content for MCP resources
    const catalogContent = formatCatalogContent(serviceProviders);
    const shapesContent = formatShapesContent(shapes);
    const vocabularyContent = formatVocabularyContent(serviceProviders, shapes);

    const discovery: DiscoveryResult = {
      catalogURI: this.catalogState.catalogURI,
      supportsJsonLd: false,
      serviceProviders,
      shapes,
      vocabularyContent,
      catalogContent,
      shapesContent,
    };

    this.discoveryResult = discovery;

    // Generate tools
    const generated = generateTools(this, discovery);
    this.generatedToolHandlers.clear();
    for (const tool of generated) {
      this.generatedToolHandlers.set(tool.name, tool.handler);
    }

    const toolDefs: McpToolDefinition[] = generated.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    // Build MCP resources
    const resources = buildMcpResources(discovery, this.serverName, this.serverBase);

    console.log(
      `[mcp] Discovery complete: ${serviceProviders.length} providers, ` +
      `${generated.length} tools, ${shapes.size} shapes`
    );

    return { tools: toolDefs, resources };
  }

  // ── CRUD operations ─────────────────────────────────────────

  async createResource(factoryURI: string, turtle: string): Promise<string> {
    // Parse the incoming Turtle
    const inputStore = rdflib.graph() as unknown as LdpDocument;
    rdflib.parse(turtle, inputStore, factoryURI + '/', 'text/turtle');

    // Generate a unique resource URI
    const resourceURI = factoryURI + '/' + generateId();
    inputStore.uri = resourceURI;

    // Re-base all statements from the placeholder subject to the real URI
    const rebasedStore = rdflib.graph() as unknown as LdpDocument;
    rebasedStore.uri = resourceURI;
    const rebasedSym = rebasedStore.sym(resourceURI);
    const allStatements = (inputStore as unknown as IndexedFormula).statements;
    for (const st of allStatements) {
      const subject = st.subject.value === 'urn:new-resource'
        ? rebasedSym
        : st.subject;
      (rebasedStore as unknown as IndexedFormula).add(
        subject,
        st.predicate,
        st.object,
        rebasedSym
      );
    }

    await this.storage.update(rebasedStore);

    // Add ldp:contains to the factory container
    const containsData = rdflib.graph() as IndexedFormula;
    containsData.add(
      rdflib.sym(factoryURI),
      LDP('contains'),
      rdflib.sym(resourceURI)
    );
    await this.storage.insertData(containsData, factoryURI);

    return resourceURI;
  }

  async getResource(uri: string): Promise<{ turtle: string; etag: string }> {
    const { status, document } = await this.storage.read(uri);
    if (status !== 200 || !document) {
      throw new Error(`Resource not found: ${uri} (status ${status})`);
    }

    const store = document as unknown as IndexedFormula;
    const turtle = rdflib.serialize(null, store, uri, 'text/turtle') ?? '';

    // Generate a simple ETag from content hash
    const { createHash } = await import('node:crypto');
    const etag = 'W/"' + createHash('md5').update(turtle).digest('hex') + '"';

    return { turtle, etag };
  }

  async updateResource(uri: string, turtle: string, _etag: string): Promise<void> {
    const store = rdflib.graph() as unknown as LdpDocument;
    store.uri = uri;
    rdflib.parse(turtle, store, uri, 'text/turtle');

    await this.storage.update(store);
  }

  async deleteResource(uri: string): Promise<void> {
    await this.storage.remove(uri);
  }

  async queryResources(queryURL: string, params: OslcQueryParams): Promise<string> {
    // Build query URL with OSLC parameters
    const url = new URL(queryURL);
    if (params.filter) url.searchParams.set('oslc.where', params.filter);
    if (params.select) url.searchParams.set('oslc.select', params.select);
    if (params.orderBy) url.searchParams.set('oslc.orderBy', params.orderBy);

    // Use the storage service's SPARQL support for OSLC queries.
    // We import the query handler's internal logic rather than going
    // through HTTP, since we're in-process.
    const { parseOslcQuery } = await import('../query-parser.js');
    const { toSPARQL } = await import('../query-translator.js');

    const queryParams: Record<string, string | undefined> = {};
    for (const [key, value] of url.searchParams.entries()) {
      queryParams[key] = value;
    }

    const oslcQuery = parseOslcQuery(queryParams);
    const sparql = toSPARQL(oslcQuery);

    if (!this.storage.constructQuery) {
      throw new Error('Storage backend does not support SPARQL queries');
    }

    const { status, results } = await this.storage.constructQuery(sparql);
    if (status !== 200 || !results) {
      return JSON.stringify([]);
    }

    // Extract member resources from the query results
    const ldpContains = rdflib.Namespace('http://www.w3.org/ns/ldp#')('contains');
    const rdfsMember = rdflib.Namespace('http://www.w3.org/2000/01/rdf-schema#')('member');

    // Find all unique subjects in the results
    const subjects = new Set<string>();
    for (const st of results.statements) {
      if (st.subject.termType === 'NamedNode') {
        subjects.add(st.subject.value);
      }
    }

    const memberResults: Record<string, unknown>[] = [];
    for (const subjectURI of subjects) {
      const subject = results.sym(subjectURI);
      const statements = results.statementsMatching(subject, null, null);
      if (statements.length === 0) continue;

      const result: Record<string, unknown> = { uri: subjectURI };
      const grouped: Record<string, unknown[]> = {};
      for (const st of statements) {
        // Skip container membership triples
        if (st.predicate.value === ldpContains.value || st.predicate.value === rdfsMember.value) continue;

        const key = st.predicate.value.split(/[#/]/).pop() ?? st.predicate.value;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(
          st.object.termType === 'NamedNode' ? { uri: st.object.value } : st.object.value
        );
      }
      for (const [key, values] of Object.entries(grouped)) {
        result[key] = values.length === 1 ? values[0] : values;
      }
      if (Object.keys(result).length > 1) {
        memberResults.push(result);
      }
    }

    return JSON.stringify(memberResults, null, 2);
  }

  // ── Private helpers ─────────────────────────────────────────

  /**
   * Fetch a shape document from storage and parse it.
   * Handles both direct URIs and fragment URIs.
   */
  private async fetchAndParseShape(shapeURI: string): Promise<DiscoveredShape | null> {
    // Strip fragment to get document URI
    const hashIdx = shapeURI.indexOf('#');
    const docURI = hashIdx >= 0 ? shapeURI.slice(0, hashIdx) : shapeURI;

    const { status, document } = await this.storage.read(docURI);
    if (status !== 200 || !document) {
      console.warn(`[mcp] Shape not found in storage: ${docURI}`);
      return null;
    }

    const store = document as unknown as IndexedFormula;
    // Use the full shape URI (with fragment) for parsing
    return parseShape(store, shapeURI);
  }

  /**
   * Build a synthetic DiscoveredServiceProvider from the catalog
   * template when no SPs have been created yet. This allows the MCP
   * endpoint to expose tool metadata even before the first POST to
   * the catalog.
   */
  private async buildFromTemplate(
    shapes: Map<string, DiscoveredShape>
  ): Promise<DiscoveredServiceProvider | null> {
    const template = this.catalogState.template;
    const factories: DiscoveredFactory[] = [];
    const queries: DiscoveredQuery[] = [];

    for (const metaSP of template.metaServiceProviders) {
      for (const metaService of metaSP.services) {
        for (const cf of metaService.creationFactories) {
          // Resolve shape URIs
          let shape: DiscoveredShape | null = null;
          for (const shapeRef of cf.resourceShapes) {
            const resolvedURI = this.resolveShapeURI(shapeRef);
            if (shapes.has(resolvedURI)) {
              shape = shapes.get(resolvedURI)!;
            } else {
              shape = await this.fetchAndParseShape(resolvedURI);
              if (shape) {
                shapes.set(resolvedURI, shape);
              }
            }
          }

          factories.push({
            title: cf.title,
            creationURI: '', // No concrete URI until SP is created
            resourceType: cf.resourceTypes[0] ?? '',
            shape,
          });
        }

        for (const qc of metaService.queryCapabilities) {
          queries.push({
            title: qc.title,
            queryBase: '', // No concrete URI until SP is created
            resourceType: qc.resourceTypes[0] ?? '',
          });
        }
      }
    }

    return {
      title: template.catalogProps.title + ' (template)',
      uri: this.catalogState.catalogURI,
      factories,
      queries,
    };
  }

  /**
   * Resolve a shape reference from the template to a concrete URI.
   * Same logic as resolveShapeURI() in catalog.ts.
   */
  private resolveShapeURI(shapeRef: string): string {
    if (shapeRef.startsWith('urn:oslc:template/')) {
      const relativePath = shapeRef.replace('urn:oslc:template/', '');
      return this.env.appBase + '/' + relativePath;
    }
    return shapeRef;
  }
}

/**
 * Generate a short unique ID for new resources.
 */
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
