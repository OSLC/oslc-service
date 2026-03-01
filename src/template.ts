/*
 * template.ts parses a meta ServiceProviderCatalog template (Turtle)
 * and extracts the catalog properties and meta service provider
 * definitions used to instantiate new ServiceProviders at runtime.
 */

import * as rdflib from 'rdflib';

const RDF = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const OSLC = rdflib.Namespace('http://open-services.net/ns/core#');
const DCTERMS = rdflib.Namespace('http://purl.org/dc/terms/');

const TEMPLATE_BASE = 'urn:oslc:template/';

/** Parsed catalog properties from the template. */
export interface CatalogProps {
  title: string;
  description?: string;
  publisherTitle?: string;
  publisherIdentifier?: string;
}

/** A creation factory defined in the meta template. */
export interface MetaCreationFactory {
  title: string;
  resourceTypes: string[];
  resourceShapes: string[];
}

/** A creation dialog defined in the meta template. */
export interface MetaCreationDialog {
  title: string;
  label: string;
  resourceTypes: string[];
  hintHeight: string;
  hintWidth: string;
  usage: string[];
  resourceShape?: string;
}

/** A query capability defined in the meta template. */
export interface MetaQueryCapability {
  title: string;
  resourceTypes: string[];
  resourceShapes: string[];
}

/** A service defined in the meta template. */
export interface MetaService {
  domains: string[];
  creationFactories: MetaCreationFactory[];
  creationDialogs: MetaCreationDialog[];
  queryCapabilities: MetaQueryCapability[];
}

/** A meta service provider defined in the template. */
export interface MetaServiceProvider {
  services: MetaService[];
}

/** The fully parsed catalog template. */
export interface CatalogTemplate {
  catalogProps: CatalogProps;
  metaServiceProviders: MetaServiceProvider[];
}

/**
 * Parse a meta template Turtle string into a CatalogTemplate.
 */
export function parseTemplate(turtleContent: string): CatalogTemplate {
  const graph = rdflib.graph();
  rdflib.parse(turtleContent, graph, TEMPLATE_BASE, 'text/turtle');

  const catalogProps = extractCatalogProps(graph);
  const metaServiceProviders = extractMetaServiceProviders(graph);

  return { catalogProps, metaServiceProviders };
}

function extractCatalogProps(graph: rdflib.IndexedFormula): CatalogProps {
  const catalogNode = rdflib.sym(TEMPLATE_BASE + 'catalog');
  const title = graph.anyValue(catalogNode, DCTERMS('title')) ?? 'OSLC Service Provider Catalog';
  const description = graph.anyValue(catalogNode, DCTERMS('description')) ?? undefined;

  let publisherTitle: string | undefined;
  let publisherIdentifier: string | undefined;
  const pub = graph.any(catalogNode, DCTERMS('publisher'));
  if (pub) {
    publisherTitle = graph.anyValue(pub as rdflib.NamedNode, DCTERMS('title')) ?? undefined;
    publisherIdentifier = graph.anyValue(pub as rdflib.NamedNode, DCTERMS('identifier')) ?? undefined;
  }

  return { title, description, publisherTitle, publisherIdentifier };
}

function extractMetaServiceProviders(graph: rdflib.IndexedFormula): MetaServiceProvider[] {
  const spNode = rdflib.sym(TEMPLATE_BASE + 'sp');
  const serviceLinks = graph.each(spNode, OSLC('service'), undefined);

  if (serviceLinks.length === 0) {
    return [];
  }

  const services: MetaService[] = [];
  for (const serviceNode of serviceLinks) {
    services.push(extractMetaService(graph, serviceNode as rdflib.NamedNode));
  }

  return [{ services }];
}

function extractMetaService(graph: rdflib.IndexedFormula, serviceNode: rdflib.NamedNode): MetaService {
  const domains = graph.each(serviceNode, OSLC('domain'), undefined)
    .map(n => n.value);

  const creationFactories: MetaCreationFactory[] = [];
  for (const cfNode of graph.each(serviceNode, OSLC('creationFactory'), undefined)) {
    creationFactories.push(extractCreationFactory(graph, cfNode as rdflib.NamedNode));
  }

  const creationDialogs: MetaCreationDialog[] = [];
  for (const cdNode of graph.each(serviceNode, OSLC('creationDialog'), undefined)) {
    creationDialogs.push(extractCreationDialog(graph, cdNode as rdflib.NamedNode));
  }

  const queryCapabilities: MetaQueryCapability[] = [];
  for (const qcNode of graph.each(serviceNode, OSLC('queryCapability'), undefined)) {
    queryCapabilities.push(extractQueryCapability(graph, qcNode as rdflib.NamedNode));
  }

  return { domains, creationFactories, creationDialogs, queryCapabilities };
}

function extractCreationFactory(graph: rdflib.IndexedFormula, node: rdflib.NamedNode): MetaCreationFactory {
  const title = graph.anyValue(node, DCTERMS('title')) ?? 'Creation Factory';
  const resourceTypes = graph.each(node, OSLC('resourceType'), undefined).map(n => n.value);
  const resourceShapes = graph.each(node, OSLC('resourceShape'), undefined).map(n => n.value);
  return { title, resourceTypes, resourceShapes };
}

function extractCreationDialog(graph: rdflib.IndexedFormula, node: rdflib.NamedNode): MetaCreationDialog {
  const title = graph.anyValue(node, DCTERMS('title')) ?? 'Create Resource';
  const label = graph.anyValue(node, OSLC('label')) ?? title;
  const resourceTypes = graph.each(node, OSLC('resourceType'), undefined).map(n => n.value);
  const hintHeight = graph.anyValue(node, OSLC('hintHeight')) ?? '505px';
  const hintWidth = graph.anyValue(node, OSLC('hintWidth')) ?? '680px';
  const usage = graph.each(node, OSLC('usage'), undefined).map(n => n.value);
  const shapeNode = graph.any(node, OSLC('resourceShape'));
  const resourceShape = shapeNode?.value;
  return { title, label, resourceTypes, hintHeight, hintWidth, usage, resourceShape };
}

function extractQueryCapability(graph: rdflib.IndexedFormula, node: rdflib.NamedNode): MetaQueryCapability {
  const title = graph.anyValue(node, DCTERMS('title')) ?? 'Query Capability';
  const resourceTypes = graph.each(node, OSLC('resourceType'), undefined).map(n => n.value);
  const resourceShapes = graph.each(node, OSLC('resourceShape'), undefined).map(n => n.value);
  return { title, resourceTypes, resourceShapes };
}
