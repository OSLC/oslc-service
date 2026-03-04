/*
 * resource-handler.ts provides a resource lookup endpoint.
 *
 * GET /resource?uri=<encoded-uri>
 *
 * Resolves any resource stored in the backend by its URI, regardless of
 * whether the URI is in the server's URL space. This is needed for
 * navigating imported resources whose URIs use external namespaces
 * (e.g., http://www.misa.org.ca/mrm#FireDepartment).
 */

import type { Request, Response, RequestHandler } from 'express';
import * as rdflib from 'rdflib';
import { type StorageService } from 'storage-service';

function serializeRdf(
  subject: rdflib.NamedNode | null,
  graph: rdflib.IndexedFormula,
  base: string,
  contentType: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    rdflib.serialize(subject, graph, base, contentType, (err, content) => {
      if (err) reject(err);
      else resolve(content ?? '');
    });
  });
}

export function resourceHandler(storage: StorageService): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const resourceURI = req.query.uri as string;
    if (!resourceURI) {
      res.status(400).json({ error: 'Missing uri query parameter' });
      return;
    }

    const { status, document: doc } = await storage.read(resourceURI);
    if (status !== 200 || !doc) {
      res.sendStatus(status === 200 ? 404 : status);
      return;
    }

    const accepted = req.accepts([
      'text/turtle',
      'application/ld+json',
      'application/rdf+xml',
    ]);
    if (!accepted) {
      res.sendStatus(406);
      return;
    }

    const contentType = accepted as string;
    // Use a neutral base URI so rdflib doesn't convert namespace URIs
    // to relative references (which would break when re-parsed by a
    // client using a different base URL).
    const body = await serializeRdf(null, doc, 'urn:x-serialize-base:', contentType);
    res.status(200).set('Content-Type', contentType).send(body);
  };
}
