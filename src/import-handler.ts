/*
 * import-handler.ts provides an Express handler for bulk-loading RDF data
 * into an OSLC server via HTTP PUT. Resources are parsed from the request
 * body, their URIs are rewritten to the target ServiceProvider's resource
 * container, and each resource's Concise Bounded Description is loaded
 * into its own named graph.
 *
 * PUT /oslc/{sp}/import
 * Content-Type: text/turtle | application/trig
 *
 * URI rewriting: source URIs (e.g. http://www.misa.org.ca/mrm#FireDepartment)
 * are mapped to the target container (e.g. http://localhost:3002/oslc/mrmv2-1/
 * resources/FireDepartment). This makes imported resources first-class citizens
 * accessible at normal server URLs.
 */

import type { Request, Response, RequestHandler } from 'express';
import * as rdflib from 'rdflib';
import type { StorageService } from 'storage-service';

const RDF = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const DCTERMS = rdflib.Namespace('http://purl.org/dc/terms/');
const OSLC = rdflib.Namespace('http://open-services.net/ns/core#');
const XSD = rdflib.Namespace('http://www.w3.org/2001/XMLSchema#');

/**
 * Extract the local name from a URI (fragment or last path segment).
 */
function localName(uri: string): string {
  const hash = uri.lastIndexOf('#');
  if (hash >= 0) return uri.substring(hash + 1);
  const slash = uri.lastIndexOf('/');
  if (slash >= 0) return uri.substring(slash + 1);
  return uri;
}

/**
 * Extract the namespace base from a URI (everything before the local name).
 * For fragment URIs: http://example.org/vocab# → http://example.org/vocab#
 * For path URIs:     http://example.org/vocab/Foo → http://example.org/vocab/
 */
function namespaceBase(uri: string): string {
  const hash = uri.lastIndexOf('#');
  if (hash >= 0) return uri.substring(0, hash + 1);
  const slash = uri.lastIndexOf('/');
  if (slash >= 0) return uri.substring(0, slash + 1);
  return uri;
}

/**
 * Create an Express handler for bulk-loading RDF data into a ServiceProvider.
 *
 * @param storage          - StorageService for loading resources
 * @param resourceTypes    - The rdf:type URIs registered via query capabilities
 * @param containerBaseURI - Target container URI (e.g. http://host/oslc/sp/resources)
 * @param spURI            - ServiceProvider URI (e.g. http://host/oslc/sp)
 */
export function importHandler(
  storage: StorageService,
  resourceTypes: string[],
  containerBaseURI: string,
  spURI: string
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      // Read request body
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        body += chunk;
      }

      if (!body.trim()) {
        res.status(400).json({ error: 'Request body required' });
        return;
      }

      // Determine format from Content-Type
      const contentType = req.get('Content-Type') ?? 'text/turtle';
      let format: 'trig' | 'turtle';
      if (contentType.includes('trig')) {
        format = 'trig';
      } else {
        format = 'turtle';
      }

      if (format === 'trig') {
        // TriG import: no URI rewriting (caller is responsible for URIs)
        await storage.importDataset(body, format);
        res.status(200).json({ message: 'TriG import complete' });
        return;
      }

      // Parse Turtle into an rdflib graph
      const graph = rdflib.graph();
      rdflib.parse(body, graph, 'urn:import', 'text/turtle');

      // Build URI rewrite map: source URI → target URI
      // Collect all unique NamedNode subjects (these are the resources to import)
      const sourceSubjects = new Set<string>();
      for (const st of graph.statements) {
        if (st.subject.termType === 'NamedNode') {
          sourceSubjects.add(st.subject.value);
        }
      }

      // Determine the source namespace(s) from subject URIs
      const sourceNamespaces = new Set<string>();
      for (const uri of sourceSubjects) {
        sourceNamespaces.add(namespaceBase(uri));
      }

      // Also collect NamedNode objects that share a source namespace.
      // These are cross-references to resources that may only appear as
      // objects (dangling references) and must also be rewritten.
      // EXCLUDE objects of vocabulary predicates (rdf:type, rdfs:subClassOf,
      // etc.) — those are class/ontology URIs, not resource instances.
      const VOCAB_PREDICATES = new Set([
        'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        'http://www.w3.org/2000/01/rdf-schema#subClassOf',
        'http://www.w3.org/2000/01/rdf-schema#domain',
        'http://www.w3.org/2000/01/rdf-schema#range',
        'http://www.w3.org/2002/07/owl#equivalentClass',
        'http://www.w3.org/2002/07/owl#sameAs',
      ]);
      const allSourceURIs = new Set(sourceSubjects);
      for (const st of graph.statements) {
        if (st.object.termType === 'NamedNode' && !VOCAB_PREDICATES.has(st.predicate.value)) {
          const objNS = namespaceBase(st.object.value);
          if (sourceNamespaces.has(objNS)) {
            allSourceURIs.add(st.object.value);
          }
        }
      }

      // Ensure container base has no trailing slash
      const base = containerBaseURI.replace(/\/$/, '');

      const uriMap = new Map<string, string>();
      for (const sourceURI of allSourceURIs) {
        const slug = localName(sourceURI);
        const targetURI = `${base}/${slug}`;
        uriMap.set(sourceURI, targetURI);
      }

      // Check types against registered query capabilities (using source URIs for type checking)
      const warnings: string[] = [];
      const registeredTypes = new Set(resourceTypes);
      for (const sourceURI of sourceSubjects) {
        const types = graph
          .each(rdflib.sym(sourceURI), RDF('type'), undefined)
          .map(n => n.value);

        if (types.length > 0 && !types.some(t => registeredTypes.has(t))) {
          warnings.push(
            `Resource <${sourceURI}> has type(s) [${types.join(', ')}] ` +
            `not matching any registered query capability`
          );
        }
      }

      if (warnings.length > 0) {
        console.warn(`Import warnings for ${sourceSubjects.size} resources:`);
        for (const w of warnings) console.warn(`  ${w}`);
      }

      // Build rewritten graph with mapped URIs
      const rewritten = rdflib.graph();
      const now = new Date().toISOString();
      const creator = (req as any).user?.username ?? req.get('X-Forwarded-User') ?? 'anonymous';

      // Rewrite all statements
      for (const st of graph.statements) {
        // Rewrite subject
        let subject = st.subject;
        if (subject.termType === 'NamedNode' && uriMap.has(subject.value)) {
          subject = rdflib.sym(uriMap.get(subject.value)!);
        }

        // Rewrite object (only NamedNode objects that are in the URI map)
        let object = st.object;
        if (object.termType === 'NamedNode' && uriMap.has(object.value)) {
          object = rdflib.sym(uriMap.get(object.value)!);
        }

        // Use the target URI as the named graph
        const graphNode = subject.termType === 'NamedNode'
          ? rdflib.sym(subject.value)
          : st.why;

        rewritten.add(subject, st.predicate, object, graphNode);
      }

      // Inject OSLC server-generated properties for each resource
      for (const [, targetURI] of uriMap) {
        const targetSym = rdflib.sym(targetURI);
        const targetGraph = rdflib.sym(targetURI);

        // dcterms:created
        if (rewritten.statementsMatching(targetSym, DCTERMS('created'), null).length === 0) {
          rewritten.add(targetSym, DCTERMS('created'),
            rdflib.lit(now, undefined, XSD('dateTime')), targetGraph);
        }

        // dcterms:creator
        if (rewritten.statementsMatching(targetSym, DCTERMS('creator'), null).length === 0) {
          rewritten.add(targetSym, DCTERMS('creator'),
            rdflib.lit(creator), targetGraph);
        }

        // oslc:serviceProvider
        if (rewritten.statementsMatching(targetSym, OSLC('serviceProvider'), null).length === 0) {
          rewritten.add(targetSym, OSLC('serviceProvider'),
            rdflib.sym(spURI), targetGraph);
        }
      }

      // Serialize the rewritten graph and import via storage
      // Group triples by resource subject for CBD-based import
      const resourceMap = new Map<string, rdflib.Statement[]>();
      for (const st of rewritten.statements) {
        const key = st.subject.termType === 'NamedNode'
          ? st.subject.value
          : (st.why?.value ?? 'urn:unknown');
        if (!resourceMap.has(key)) resourceMap.set(key, []);
        resourceMap.get(key)!.push(st);
      }

      // Import each resource individually via storage.update()
      let importCount = 0;
      for (const [uri, stmts] of resourceMap) {
        const doc = rdflib.graph() as any;
        doc.uri = uri;
        for (const st of stmts) {
          doc.add(st.subject, st.predicate, st.object, rdflib.sym(uri));
        }
        await storage.update(doc);
        importCount++;
      }

      res.status(200).json({
        message: `Import complete`,
        resourceCount: importCount,
        warnings,
      });
    } catch (err) {
      console.error('Import error:', err);
      res.status(400).json({ error: String(err) });
    }
  };
}
