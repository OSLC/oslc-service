/*
 * import-handler.ts provides an Express handler for bulk-loading RDF data
 * into an OSLC server via HTTP PUT. Resources are parsed from the request
 * body and each URI subject's Concise Bounded Description is loaded into
 * its own named graph.
 *
 * PUT /oslc/{sp}/import
 * Content-Type: text/turtle | application/trig
 *
 * Resources whose rdf:type does not match any of the ServiceProvider's
 * registered query capabilities are loaded but generate warnings.
 */

import type { Request, Response, RequestHandler } from 'express';
import * as rdflib from 'rdflib';
import type { StorageService } from 'storage-service';

const RDF = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');

/**
 * Create an Express handler for bulk-loading RDF data into a ServiceProvider.
 *
 * @param storage        - StorageService for loading resources
 * @param resourceTypes  - The rdf:type URIs registered via query capabilities
 */
export function importHandler(
  storage: StorageService,
  resourceTypes: string[]
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

      // Pre-parse Turtle to check types and count resources
      const warnings: string[] = [];
      let resourceCount = 0;
      if (format === 'turtle') {
        const graph = rdflib.graph();
        rdflib.parse(body, graph, 'urn:import-check', 'text/turtle');

        // Find all URI subjects
        const subjects = new Set<string>();
        for (const st of graph.statements) {
          if (st.subject.termType === 'NamedNode') {
            subjects.add(st.subject.value);
          }
        }
        resourceCount = subjects.size;

        // Check types against registered query capabilities
        const registeredTypes = new Set(resourceTypes);
        for (const subjectURI of subjects) {
          const types = graph
            .each(rdflib.sym(subjectURI), RDF('type'), undefined)
            .map(n => n.value);

          if (types.length > 0 && !types.some(t => registeredTypes.has(t))) {
            warnings.push(
              `Resource <${subjectURI}> has type(s) [${types.join(', ')}] ` +
              `not matching any registered query capability`
            );
          }
        }

        if (warnings.length > 0) {
          console.warn(`Import warnings for ${resourceCount} resources:`);
          for (const w of warnings) console.warn(`  ${w}`);
        }
      }

      // Delegate to storage for the actual import
      await storage.importDataset(body, format);

      res.status(200).json({
        message: `Import complete`,
        resourceCount,
        warnings,
      });
    } catch (err) {
      console.error('Import error:', err);
      res.status(400).json({ error: String(err) });
    }
  };
}
