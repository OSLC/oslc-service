/*
 * catalog.ts handles OSLC ServiceProviderCatalog initialization
 * and ServiceProvider instantiation from a meta template.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as rdflib from 'rdflib';
import type { Request, Response, RequestHandler, Express } from 'express';
import {
  type StorageService,
  type LdpDocument,
  ldp,
} from 'storage-service';
import type { OslcEnv } from './service.js';
import {
  parseTemplate,
  type CatalogTemplate,
  type MetaService,
} from './template.js';
import { queryHandler } from './query-handler.js';
import { importHandler } from './import-handler.js';

const RDF = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const OSLC = rdflib.Namespace('http://open-services.net/ns/core#');
const LDP = rdflib.Namespace('http://www.w3.org/ns/ldp#');
const DCTERMS = rdflib.Namespace('http://purl.org/dc/terms/');

/** Runtime state for the catalog, initialized at startup. */
export interface CatalogState {
  catalogURI: string;
  catalogPath: string;
  template: CatalogTemplate;
}

/**
 * Initialize the ServiceProviderCatalog.
 *
 * 1. Read and parse the meta template
 * 2. Create the catalog BasicContainer in storage (idempotent)
 * 3. Store ResourceShapes referenced by the template (idempotent)
 */
export async function initCatalog(
  env: OslcEnv,
  storage: StorageService
): Promise<CatalogState> {
  const context = env.context ?? '/';
  const catalogPath = context.endsWith('/') ? context + 'oslc' : context + '/oslc';
  const catalogURI = env.appBase + catalogPath;

  // Read and parse the template
  const turtleContent = readFileSync(env.templatePath!, 'utf-8');
  const template = parseTemplate(turtleContent);

  // Ensure the root LDP container exists (needed when Fuseki dataset is empty)
  let rootURI = env.appBase + context;
  if (rootURI.endsWith('/')) rootURI = rootURI.slice(0, -1);
  const { status: rootStatus } = await storage.read(rootURI);
  if (rootStatus === 404) {
    const root = new rdflib.IndexedFormula() as unknown as LdpDocument;
    root.uri = rootURI;
    const rootSym = root.sym(rootURI);
    root.add(rootSym, RDF('type'), LDP('BasicContainer'), rootSym);
    root.add(rootSym, DCTERMS('title'), rdflib.lit('LDP Root Container'), rootSym);
    root.interactionModel = ldp.BasicContainer;
    await storage.update(root);
    console.log(`Created root LDP container at ${rootURI}`);
  }

  // Create catalog if it doesn't exist
  const { status } = await storage.read(catalogURI);
  if (status === 404) {
    const catalog = new rdflib.IndexedFormula() as unknown as LdpDocument;
    catalog.uri = catalogURI;
    const sym = catalog.sym(catalogURI);

    catalog.add(sym, RDF('type'), LDP('BasicContainer'), sym);
    catalog.add(sym, RDF('type'), OSLC('ServiceProviderCatalog'), sym);
    catalog.add(sym, DCTERMS('title'), rdflib.lit(template.catalogProps.title), sym);
    if (template.catalogProps.description) {
      catalog.add(sym, DCTERMS('description'), rdflib.lit(template.catalogProps.description), sym);
    }
    if (template.catalogProps.publisherTitle) {
      const pub = rdflib.blankNode();
      catalog.add(sym, DCTERMS('publisher'), pub, sym);
      catalog.add(pub, RDF('type'), OSLC('Publisher'), sym);
      catalog.add(pub, DCTERMS('title'), rdflib.lit(template.catalogProps.publisherTitle), sym);
      if (template.catalogProps.publisherIdentifier) {
        catalog.add(pub, DCTERMS('identifier'), rdflib.lit(template.catalogProps.publisherIdentifier), sym);
      }
    }

    catalog.interactionModel = ldp.BasicContainer;
    await storage.update(catalog);
    console.log(`Created ServiceProviderCatalog at ${catalogURI}`);
  } else {
    console.log(`ServiceProviderCatalog already exists at ${catalogURI}`);
  }

  // Store ResourceShapes referenced by the template
  await storeResourceShapes(env, storage, template);

  return { catalogURI, catalogPath, template };
}

/**
 * Register query and import routes for a single ServiceProvider.
 */
function registerSPRoutes(
  slug: string,
  env: OslcEnv,
  storage: StorageService,
  state: CatalogState,
  app: Express
): void {
  // Register query routes for each query capability
  for (const metaSP of state.template.metaServiceProviders) {
    for (const metaService of metaSP.services) {
      for (const qc of metaService.queryCapabilities) {
        const typeName = qc.resourceTypes.length > 0
          ? qc.resourceTypes[0].replace(/.*[#/]/, '')
          : 'resources';
        const queryPath = state.catalogPath + '/' + encodeURIComponent(slug) + '/query/' + typeName;
        const handler = queryHandler(storage, qc.resourceTypes[0], env.appBase);
        app.get(queryPath, handler);
        app.post(queryPath, handler);
      }
    }
  }

  // Register import route for bulk-loading RDF data
  const allResourceTypes: string[] = [];
  for (const metaSP of state.template.metaServiceProviders) {
    for (const metaService of metaSP.services) {
      for (const qc of metaService.queryCapabilities) {
        allResourceTypes.push(...qc.resourceTypes);
      }
    }
  }
  const importPath = state.catalogPath + '/' + encodeURIComponent(slug) + '/import';
  app.put(importPath, importHandler(storage, allResourceTypes));
}

/**
 * Re-register query and import routes for existing ServiceProviders.
 * Called at startup so that routes survive server restarts.
 */
export async function recoverRoutes(
  env: OslcEnv,
  storage: StorageService,
  state: CatalogState,
  app: Express
): Promise<void> {
  const { status, document: catalog } = await storage.read(state.catalogURI);
  if (status !== 200 || !catalog) return;

  const spURIs = (catalog as unknown as rdflib.IndexedFormula)
    .each(rdflib.sym(state.catalogURI), LDP('contains'), undefined)
    .map(n => n.value);

  for (const spURI of spURIs) {
    const slug = decodeURIComponent(spURI.replace(state.catalogURI + '/', ''));
    registerSPRoutes(slug, env, storage, state, app);
    console.log(`Recovered routes for ServiceProvider: ${spURI}`);
  }
}

/**
 * Store ResourceShape documents referenced by the template.
 *
 * Shape references may include fragment identifiers (e.g.,
 * urn:oslc:template/shapes/MRMS-Shapes#ProgramShape).
 * We strip fragments to get unique document URIs, then load each
 * document file once and store it as a single resource.
 *
 * External HTTP URIs are skipped (assumed published elsewhere).
 */
async function storeResourceShapes(
  env: OslcEnv,
  storage: StorageService,
  template: CatalogTemplate
): Promise<void> {
  const configDir = dirname(env.templatePath!);

  // Collect all unique shape refs from the template
  const shapeRefs = new Set<string>();
  for (const sp of template.metaServiceProviders) {
    for (const svc of sp.services) {
      for (const cf of svc.creationFactories) {
        for (const s of cf.resourceShapes) shapeRefs.add(s);
      }
      for (const cd of svc.creationDialogs) {
        if (cd.resourceShape) shapeRefs.add(cd.resourceShape);
      }
      for (const qc of svc.queryCapabilities) {
        for (const s of qc.resourceShapes) shapeRefs.add(s);
      }
    }
  }

  // Strip fragments to get unique document URIs
  const docURIs = new Set<string>();
  for (const ref of shapeRefs) {
    const hashIdx = ref.indexOf('#');
    docURIs.add(hashIdx >= 0 ? ref.slice(0, hashIdx) : ref);
  }

  for (const docRef of docURIs) {
    // Skip external HTTP URIs — they're published elsewhere
    if (!docRef.startsWith('urn:oslc:template/')) continue;

    const relativePath = docRef.replace('urn:oslc:template/', '');
    const docURI = env.appBase + '/' + relativePath;

    const { status } = await storage.read(docURI);
    if (status === 200) continue; // already stored

    // Try to find the .ttl file on disk
    const candidates = [
      join(configDir, relativePath + '.ttl'),
      join(configDir, 'shapes', relativePath.replace('shapes/', '') + '.ttl'),
    ];

    let turtleContent: string | null = null;
    for (const filePath of candidates) {
      try {
        turtleContent = readFileSync(filePath, 'utf-8');
        break;
      } catch {
        // try next candidate
      }
    }

    if (!turtleContent) {
      console.warn(`ResourceShape file not found for ${docRef}. Tried: ${candidates.join(', ')}`);
      continue;
    }

    const shapeDoc = new rdflib.IndexedFormula() as unknown as LdpDocument;
    shapeDoc.uri = docURI;
    rdflib.parse(turtleContent, shapeDoc, docURI, 'text/turtle');
    await storage.update(shapeDoc);
    console.log(`Stored ResourceShape document at ${docURI}`);
  }
}

/**
 * Slugify a string for use in URIs.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Express middleware that handles POST to the catalog to create
 * a new ServiceProvider from the meta template.
 */
export function catalogPostHandler(
  env: OslcEnv,
  storage: StorageService,
  state: CatalogState,
  app: Express
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    // Read the raw body
    let body = '';
    req.setEncoding('utf8');
    for await (const chunk of req) {
      body += chunk;
    }

    if (!body.trim()) {
      res.status(400).json({ error: 'Request body required with at least dcterms:title' });
      return;
    }

    // Parse the posted Turtle to extract title
    const inputGraph = rdflib.graph();
    try {
      rdflib.parse(body, inputGraph, state.catalogURI + '/', 'text/turtle');
    } catch (err) {
      res.status(400).json({ error: 'Invalid Turtle: ' + String(err) });
      return;
    }

    // Find the title from the posted body
    const stmts = inputGraph.statementsMatching(undefined, DCTERMS('title'), undefined);
    if (stmts.length === 0) {
      res.status(400).json({ error: 'dcterms:title is required' });
      return;
    }
    const title = stmts[0].object.value;

    // Determine the SP identifier from Slug header or title
    const slug = (req.get('Slug') as string) || slugify(title);
    const spURI = state.catalogURI + '/' + encodeURIComponent(slug);

    // Check if SP already exists
    const { status: existStatus } = await storage.read(spURI);
    if (existStatus === 200) {
      res.status(409).json({ error: 'ServiceProvider already exists: ' + spURI });
      return;
    }

    // containerURI is still used by creation factory oslc:creation URLs,
    // but we no longer create a BasicContainer for it. Resources are
    // discovered via OSLC QueryCapability, not container membership.
    const containerURI = spURI + '/resources';

    // Build the ServiceProvider resource from the template
    const spDoc = new rdflib.IndexedFormula() as unknown as LdpDocument;
    spDoc.uri = spURI;
    const spSym = spDoc.sym(spURI);

    spDoc.add(spSym, RDF('type'), OSLC('ServiceProvider'), spSym);
    spDoc.add(spSym, DCTERMS('title'), rdflib.lit(title), spSym);
    spDoc.add(spSym, OSLC('details'), spSym, spSym);

    // Copy description from POST body if provided
    const descStmts = inputGraph.statementsMatching(undefined, DCTERMS('description'), undefined);
    if (descStmts.length > 0) {
      spDoc.add(spSym, DCTERMS('description'), rdflib.lit(descStmts[0].object.value), spSym);
    }

    // Add publisher from template
    if (state.template.catalogProps.publisherTitle) {
      const pub = rdflib.blankNode();
      spDoc.add(spSym, DCTERMS('publisher'), pub, spSym);
      spDoc.add(pub, RDF('type'), OSLC('Publisher'), spSym);
      spDoc.add(pub, DCTERMS('title'), rdflib.lit(state.template.catalogProps.publisherTitle), spSym);
      if (state.template.catalogProps.publisherIdentifier) {
        spDoc.add(pub, DCTERMS('identifier'), rdflib.lit(state.template.catalogProps.publisherIdentifier), spSym);
      }
    }

    // Instantiate services from the template
    for (const metaSP of state.template.metaServiceProviders) {
      for (const metaService of metaSP.services) {
        const serviceNode = rdflib.blankNode();
        spDoc.add(spSym, OSLC('service'), serviceNode, spSym);
        instantiateService(spDoc, spSym, serviceNode, metaService, env, containerURI);
      }
    }

    await storage.update(spDoc);

    // Register query and import routes for this ServiceProvider
    registerSPRoutes(slug, env, storage, state, app);

    // Add ldp:contains triple to the catalog
    const containsData = new rdflib.IndexedFormula();
    containsData.add(
      rdflib.sym(state.catalogURI),
      LDP('contains'),
      rdflib.sym(spURI)
    );
    await storage.insertData(containsData, state.catalogURI);

    res.location(spURI).sendStatus(201);
  };
}

/**
 * Instantiate a Service from a MetaService template, adding triples
 * to the ServiceProvider document with concrete URLs.
 */
function instantiateService(
  doc: rdflib.IndexedFormula,
  docNode: rdflib.NamedNode,
  serviceNode: rdflib.BlankNode,
  meta: MetaService,
  env: OslcEnv,
  containerURI: string
): void {
  doc.add(serviceNode, RDF('type'), OSLC('Service'), docNode);

  for (const domain of meta.domains) {
    doc.add(serviceNode, OSLC('domain'), rdflib.sym(domain), docNode);
  }

  // Creation factories
  for (const cf of meta.creationFactories) {
    const cfNode = rdflib.blankNode();
    doc.add(serviceNode, OSLC('creationFactory'), cfNode, docNode);
    doc.add(cfNode, RDF('type'), OSLC('CreationFactory'), docNode);
    doc.add(cfNode, DCTERMS('title'), rdflib.lit(cf.title), docNode);
    doc.add(cfNode, OSLC('creation'), rdflib.sym(containerURI), docNode);

    for (const rt of cf.resourceTypes) {
      doc.add(cfNode, OSLC('resourceType'), rdflib.sym(rt), docNode);
    }
    for (const rs of cf.resourceShapes) {
      const shapeURI = resolveShapeURI(rs, env);
      doc.add(cfNode, OSLC('resourceShape'), rdflib.sym(shapeURI), docNode);
    }
  }

  // Creation dialogs
  for (const cd of meta.creationDialogs) {
    const cdNode = rdflib.blankNode();
    doc.add(serviceNode, OSLC('creationDialog'), cdNode, docNode);
    doc.add(cdNode, RDF('type'), OSLC('Dialog'), docNode);
    doc.add(cdNode, DCTERMS('title'), rdflib.lit(cd.title), docNode);
    doc.add(cdNode, OSLC('label'), rdflib.lit(cd.label), docNode);
    doc.add(cdNode, OSLC('hintHeight'), rdflib.lit(cd.hintHeight), docNode);
    doc.add(cdNode, OSLC('hintWidth'), rdflib.lit(cd.hintWidth), docNode);

    // Build the dialog URL with shape and creation params
    const shapeURI = cd.resourceShape ? resolveShapeURI(cd.resourceShape, env) : '';
    const dialogURL = env.appBase + '/dialog/create'
      + '?shape=' + encodeURIComponent(shapeURI)
      + '&creation=' + encodeURIComponent(containerURI);
    doc.add(cdNode, OSLC('dialog'), rdflib.sym(dialogURL), docNode);

    for (const rt of cd.resourceTypes) {
      doc.add(cdNode, OSLC('resourceType'), rdflib.sym(rt), docNode);
    }
    for (const u of cd.usage) {
      doc.add(cdNode, OSLC('usage'), rdflib.sym(u), docNode);
    }
  }

  // Query capabilities
  for (const qc of meta.queryCapabilities) {
    const qcNode = rdflib.blankNode();
    doc.add(serviceNode, OSLC('queryCapability'), qcNode, docNode);
    doc.add(qcNode, RDF('type'), OSLC('QueryCapability'), docNode);
    doc.add(qcNode, DCTERMS('title'), rdflib.lit(qc.title), docNode);

    // Build the query base URL from the first resource type's local name
    const typeName = qc.resourceTypes.length > 0
      ? qc.resourceTypes[0].replace(/.*[#/]/, '')
      : 'resources';
    const queryBaseURL = containerURI.replace(/\/resources$/, '/query/' + typeName);
    doc.add(qcNode, OSLC('queryBase'), rdflib.sym(queryBaseURL), docNode);

    for (const rt of qc.resourceTypes) {
      doc.add(qcNode, OSLC('resourceType'), rdflib.sym(rt), docNode);
    }
    for (const rs of qc.resourceShapes) {
      const shapeURI = resolveShapeURI(rs, env);
      doc.add(qcNode, OSLC('resourceShape'), rdflib.sym(shapeURI), docNode);
    }
  }
}

/**
 * Resolve a shape reference from the template to a concrete URI.
 * Template shapes use urn:oslc:template/ base; resolve to appBase/.
 */
function resolveShapeURI(shapeRef: string, env: OslcEnv): string {
  if (shapeRef.startsWith('urn:oslc:template/')) {
    const relativePath = shapeRef.replace('urn:oslc:template/', '');
    return env.appBase + '/' + relativePath;
  }
  return shapeRef;
}
