/*
 * sparql-handler.ts — Express handler for a read-only SPARQL endpoint.
 *
 * Proxies SPARQL queries (SELECT, CONSTRUCT, ASK, DESCRIBE) to the
 * storage backend when it supports the sparqlQuery capability.
 *
 * Follows the SPARQL 1.1 Protocol:
 *   GET  with ?query= parameter
 *   POST with application/sparql-query body
 */

import type { Request, Response, RequestHandler } from 'express';
import type { StorageService } from 'storage-service';

/**
 * Create an Express handler for a read-only SPARQL endpoint.
 *
 * Returns 501 if the storage backend does not implement sparqlQuery.
 */
export function sparqlHandler(storage: StorageService): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    if (!storage.sparqlQuery) {
      res.status(501).send('SPARQL queries not supported by this storage backend');
      return;
    }

    try {
      let sparql: string | undefined;

      if (req.method === 'GET') {
        sparql = req.query.query as string | undefined;
      } else {
        let body = '';
        req.setEncoding('utf8');
        for await (const chunk of req) {
          body += chunk;
        }
        sparql = body || undefined;
      }

      if (!sparql) {
        res.status(400).send('Missing SPARQL query');
        return;
      }

      const accept = req.headers.accept ?? 'application/sparql-results+json';
      const result = await storage.sparqlQuery(sparql, accept);
      res.status(result.status).set('Content-Type', result.contentType).send(result.body);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  };
}
