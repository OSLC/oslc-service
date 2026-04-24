/*
 * OSLC Link Discovery Management (LDM) endpoint.
 *
 * POST /discover-links accepts a list of target resource URIs and
 * (optionally) link predicate URIs, and returns the incoming-link
 * triples from this server's storage whose object matches one of the
 * targets.
 *
 * Scope: same-server links only. Cross-server incoming links (links
 * stored in a different OSLC server whose target URI points here) are
 * the domain of a standalone LDM provider or LQE; oslc-browser merges
 * both sources client-side.
 *
 * Request body forms accepted:
 *   - text/turtle or application/rdf+xml with:
 *       [] oslc_ldm:resources <target1>, <target2>, ... ;
 *          oslc_ldm:linkPredicates <pred1>, <pred2>, ... .
 *     (linkPredicates is optional; omit to get all domain link types)
 *   - application/x-www-form-urlencoded or application/json with:
 *       objectResources | objectConceptResources = <uri>[]
 *       predicateFilters = <uri>[]  (optional)
 *
 * Response: text/turtle triples where the object is one of the target
 * URIs.
 */

import * as rdflib from 'rdflib';
import type { Request, Response, RequestHandler } from 'express';
import type { StorageService } from 'storage-service';

const OSLC_LDM = rdflib.Namespace('http://open-services.net/ns/ldm#');

export function ldmDiscoverLinksHandler(storage: StorageService): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    if (!storage.getIncomingLinks) {
      res.status(501).json({
        error: 'Incoming link discovery not supported by this storage backend',
      });
      return;
    }

    let targetURIs: string[] = [];
    let predicates: string[] = [];

    const contentType = req.headers['content-type']?.split(';')[0]?.trim() ?? '';

    if (contentType === 'text/turtle' || contentType === 'application/rdf+xml') {
      // RDF body: parse oslc_ldm:resources and oslc_ldm:linkPredicates
      let body = '';
      req.setEncoding('utf8');
      for await (const chunk of req) body += chunk;

      const store = rdflib.graph();
      // rdflib requires an absolute base URI for parsing. Use the full
      // request URL so any relative URIs in the body resolve sensibly.
      const host = req.headers.host ?? 'localhost';
      const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http';
      const baseURI = `${proto}://${host}${req.originalUrl ?? req.url}`;
      try {
        rdflib.parse(body, store, baseURI, contentType);
      } catch (err) {
        res.status(400).json({ error: 'Invalid RDF: ' + String(err) });
        return;
      }

      // statementsMatching is unambiguous when multiple positions are
      // open — store.each() overloads its return based on which
      // position is null and misbehaves here.
      targetURIs = store
        .statementsMatching(null, OSLC_LDM('resources'), null)
        .filter((st) => st.object.termType === 'NamedNode')
        .map((st) => st.object.value);

      predicates = store
        .statementsMatching(null, OSLC_LDM('linkPredicates'), null)
        .filter((st) => st.object.termType === 'NamedNode')
        .map((st) => st.object.value);
    } else {
      // Form-encoded / JSON fallback (legacy LDM clients). Requires
      // that Express body parsers for urlencoded and json are mounted
      // upstream (they are in oslc-service's service.ts).
      const body = (req.body ?? {}) as Record<string, unknown>;
      const objRes = body.objectResources ?? body.objectConceptResources ?? [];
      targetURIs = Array.isArray(objRes) ? (objRes as string[]) : [String(objRes)];
      const predFilters = body.predicateFilters ?? [];
      predicates = Array.isArray(predFilters)
        ? (predFilters as string[])
        : [String(predFilters)];
    }

    if (targetURIs.length === 0) {
      res.status(400).json({ error: 'No target resource URIs provided' });
      return;
    }

    try {
      const links = await storage.getIncomingLinks(
        targetURIs,
        predicates.length > 0 ? predicates : undefined
      );

      // Build response as Turtle triples
      const responseStore = rdflib.graph();
      for (const link of links) {
        responseStore.add(
          rdflib.sym(link.sourceURI),
          rdflib.sym(link.predicate),
          rdflib.sym(link.targetURI)
        );
      }

      const turtle = rdflib.serialize(null, responseStore, undefined, 'text/turtle') ?? '';
      res.set('Content-Type', 'text/turtle').send(turtle);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  };
}
