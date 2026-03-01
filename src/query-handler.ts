/*
 * Copyright 2014 IBM Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * query-handler.ts provides an Express handler for OSLC query capability
 * endpoints. It parses OSLC query parameters, translates to SPARQL,
 * executes against the storage backend, and returns RDF results.
 */

import type { Request, Response, RequestHandler } from 'express';
import * as rdflib from 'rdflib';
import type { StorageService } from 'storage-service';
import { parseOslcQuery } from './query-parser.js';
import { toSPARQL } from './query-translator.js';
import { oslc } from './vocab/oslc.js';

const DCTERMS = rdflib.Namespace('http://purl.org/dc/terms/');
const RDF = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');

/**
 * Promisify rdflib.serialize.
 */
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

/**
 * Extract OSLC query parameters from Express req.query.
 *
 * Express 5 types req.query values as string | ParsedQs | ... but for
 * simple key=value parameters they arrive as strings. This helper
 * normalises them into the Record<string, string | undefined> that
 * parseOslcQuery expects.
 */
function extractParams(reqQuery: Request['query']): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  for (const key of Object.keys(reqQuery)) {
    const val = reqQuery[key];
    if (typeof val === 'string') {
      params[key] = val;
    }
  }
  return params;
}

/**
 * Create an Express request handler for an OSLC query capability endpoint.
 *
 * The handler:
 * 1. Extracts OSLC query parameters from the request query string.
 * 2. Parses them into an OslcQuery AST via parseOslcQuery().
 * 3. Translates the AST to a SPARQL CONSTRUCT query via toSPARQL().
 * 4. Executes the SPARQL against the storage backend.
 * 5. Optionally adds oslc:ResponseInfo triples for paged results.
 * 6. Negotiates the response content type and serializes the RDF.
 *
 * @param storage       The storage backend that executes SPARQL queries.
 * @param resourceType  The full URI of the rdf:type for the queried resources.
 * @param appBase       The application base URL (used to construct page URIs).
 */
export function queryHandler(
  storage: StorageService,
  resourceType: string,
  appBase: string
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      // 1. Extract query parameters
      const params = extractParams(req.query);

      // 2. Parse OSLC query parameters into AST
      const oslcQuery = parseOslcQuery(params);

      // 3. Translate to SPARQL
      const sparql = toSPARQL(oslcQuery, resourceType);

      // 4. Execute SPARQL CONSTRUCT against storage
      const { status, results } = await storage.constructQuery(sparql);
      if (status !== 200 || !results) {
        res.sendStatus(status === 200 ? 500 : status);
        return;
      }

      // 5. Add oslc:ResponseInfo triples for paged results
      if (oslcQuery.pageSize !== undefined) {
        const currentPage = oslcQuery.page ?? 1;
        const requestPath = req.originalUrl.split('?')[0];
        const responseInfoURI = appBase + req.originalUrl;
        const responseInfoNode = rdflib.sym(responseInfoURI);
        const graphNode = rdflib.sym(responseInfoURI);

        results.add(
          responseInfoNode,
          RDF('type'),
          rdflib.sym(oslc.ResponseInfo),
          graphNode
        );

        results.add(
          responseInfoNode,
          DCTERMS('title'),
          rdflib.lit('Query Results'),
          graphNode
        );

        // Build the next page URL preserving existing query params
        const nextPage = currentPage + 1;
        const nextParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && key !== 'oslc.page') {
            nextParams.set(key, value);
          }
        }
        nextParams.set('oslc.page', String(nextPage));
        const nextPageURL = appBase + requestPath + '?' + nextParams.toString();

        results.add(
          responseInfoNode,
          rdflib.sym(oslc.ns + 'nextPage'),
          rdflib.sym(nextPageURL),
          graphNode
        );
      }

      // 6. Content negotiation
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

      // 7. Serialize and send response
      const body = await serializeRdf(null, results, appBase, contentType);
      res.status(200).set('Content-Type', contentType).send(body);
    } catch (err: unknown) {
      // Parse or translation errors return 400
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  };
}
