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
 * service.ts is Express middleware for OSLC 3.0 resources.
 * It provides OSLC discovery (ServiceProviderCatalog, ServiceProviders),
 * creation dialogs, and resource preview, then delegates all LDP
 * operations to ldp-service.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { Readable } from 'node:stream';
import * as rdflib from 'rdflib';
import { type StorageService, type StorageEnv } from 'storage-service';
import { ldpService } from 'ldp-service';
import { initCatalog, catalogPostHandler, recoverRoutes, type CatalogState } from './catalog.js';
import { mcpMiddleware, type RediscoverFn } from './mcp/index.js';
import { dialogCreateHandler } from './dialog.js';
import { compactHandler } from './compact.js';
import { sparqlHandler } from './sparql-handler.js';
import { resourceHandler } from './resource-handler.js';

export interface OslcEnv extends StorageEnv {
  context?: string;
  /** Absolute path to the meta ServiceProviderCatalog template (.ttl file). */
  templatePath?: string;
  /** URL path for the catalog (defaults to context + 'oslc'). */
  catalogPath?: string;
}

/**
 * Create the OSLC Express middleware.
 *
 * If a templatePath is provided, initializes the ServiceProviderCatalog
 * and mounts OSLC-specific routes (catalog POST, creation dialog,
 * resource preview) before delegating to ldp-service.
 */
export async function oslcService(
  env: OslcEnv,
  storage: StorageService
): Promise<express.Express> {
  const app = express();

  // CORS headers for browser-based clients — covers all OSLC routes
  // (query, SPARQL, dialog, compact, catalog) that are mounted before ldp-service.
  app.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
    }
    res.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Accept, OSLC-Core-Version, If-Match, If-None-Match, Slug');
    res.set('Access-Control-Expose-Headers', 'ETag, Link, Location, Content-Type, Accept-Post, Allow');

    if (req.method === 'OPTIONS' && req.get('Access-Control-Request-Method')) {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Router for dynamically registered query and import routes.
  // Mounted before ldp-service so routes added at runtime (when creating
  // ServiceProviders) are matched before the ldp-service catch-all.
  const dynamicRouter = express.Router();

  // Initialize catalog from template if configured
  let catalogState: CatalogState | undefined;
  if (env.templatePath) {
    catalogState = await initCatalog(env, storage);

    // Re-register query and import routes for existing ServiceProviders
    await recoverRoutes(env, storage, catalogState, dynamicRouter);

    // Mount embedded MCP endpoint at /mcp (before dynamicRouter and ldp-service)
    const mcp = await mcpMiddleware(catalogState, storage, env, dynamicRouter);
    app.use('/mcp', mcp.router);

    // Intercept POST to catalog — must be mounted before ldp-service
    app.post(catalogState.catalogPath, catalogPostHandler(env, storage, catalogState, dynamicRouter, mcp.rediscover));
  }

  // Creation dialog route
  app.get('/dialog/create', dialogCreateHandler(env, storage));

  // Resource preview (Compact) route
  app.get('/compact', compactHandler(env, storage));

  // Resource lookup — resolves any stored resource by URI
  const resourcePath = (env.context ?? '/') + 'resource';
  app.get(resourcePath, resourceHandler(storage));

  // SPARQL endpoint — only if storage backend supports it
  if (storage.sparqlQuery) {
    const sparqlPath = (env.context ?? '/') + 'sparql';
    app.get(sparqlPath, sparqlHandler(storage));
    app.post(sparqlPath, sparqlHandler(storage));
  }

  // Mount dynamic router before ldp-service
  app.use(dynamicRouter);

  // Inject server-generated OSLC properties into POST/PUT request bodies
  // before ldp-service processes them. This keeps OSLC domain knowledge
  // out of the generic LDP layer.
  app.use(oslcPropertyInjector(env, storage));

  // Delegate all LDP operations to ldp-service
  app.use(ldpService(env, storage));

  return app;
}

/**
 * Express middleware that injects server-generated OSLC properties
 * (dcterms:created, dcterms:creator, oslc:serviceProvider,
 * oslc:instanceShape) into POST and PUT request bodies before
 * ldp-service parses them.
 *
 * Reads the raw body, appends Turtle triples (only if missing), and
 * replaces the request stream so ldp-service sees the augmented body.
 */
function oslcPropertyInjector(env: OslcEnv, storage: StorageService) {
  const OSLC = rdflib.Namespace('http://open-services.net/ns/core#');

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'POST' && req.method !== 'PUT') {
      next();
      return;
    }

    const contentType = req.get('Content-Type') ?? '';
    if (!contentType.includes('text/turtle') && !contentType.includes('application/ld+json')) {
      next();
      return;
    }

    // Buffer the request body
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      // Build extra Turtle triples for missing OSLC properties.
      // Use <> as subject — ldp-service resolves it to the resource URI.
      const extraTriples: string[] = [];

      if (!body.includes('dcterms:created') && !body.includes('http://purl.org/dc/terms/created')) {
        extraTriples.push(
          `<> <http://purl.org/dc/terms/created> "${new Date().toISOString()}"^^<http://www.w3.org/2001/XMLSchema#dateTime> .`
        );
      }

      if (!body.includes('dcterms:creator') && !body.includes('http://purl.org/dc/terms/creator')) {
        const creator = (req as any).user?.username ?? req.get('X-Forwarded-User') ?? 'anonymous';
        extraTriples.push(
          `<> <http://purl.org/dc/terms/creator> "${creator}" .`
        );
      }

      // Derive service provider URI from the request URL pattern:
      // {appBase}/oslc/{sp-slug}/resources → SP is {appBase}/oslc/{sp-slug}
      const fullURL = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      const containerPath = fullURL.replace(env.appBase, '');
      const segments = containerPath.split('/').filter(Boolean);
      let spURI: string | undefined;
      if (segments.length >= 2) {
        spURI = env.appBase + '/' + segments.slice(0, 2).join('/');
      }

      if (!body.includes('oslc:serviceProvider') && !body.includes('http://open-services.net/ns/core#serviceProvider')) {
        if (spURI) {
          extraTriples.push(
            `<> <http://open-services.net/ns/core#serviceProvider> <${spURI}> .`
          );
        }
      }

      // Inject oslc:instanceShape on POST by looking up the creation
      // factory's resourceShape from the service provider document.
      const needsShape = req.method === 'POST'
        && !body.includes('oslc:instanceShape')
        && !body.includes('http://open-services.net/ns/core#instanceShape')
        && spURI;

      if (!needsShape) {
        // No shape lookup needed — finish synchronously
        finishRequest(req, body, extraTriples, next);
        return;
      }

      // Async shape lookup — non-fatal if it fails
      (async () => {
        try {
          // Parse the POST body to find the resource's rdf:type. All BMM
          // creation factories share the same oslc:creation URL (the
          // container), so we must disambiguate by resourceType.
          const RDF = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
          const bodyStore = rdflib.graph();
          const bodyBase = fullURL.endsWith('/') ? fullURL : fullURL + '/';
          try {
            rdflib.parse(body, bodyStore, bodyBase, contentType.split(';')[0].trim());
          } catch {
            // If body parse fails the shape lookup can't disambiguate — skip
            finishRequest(req, body, extraTriples, next);
            return;
          }

          const resourceTypes = bodyStore
            .each(undefined, RDF('type'), undefined)
            .filter(n => n.termType === 'NamedNode')
            .map(n => n.value);

          const result = await storage.read(spURI!);
          if (result.status === 200 && result.document) {
            const spDoc = result.document as unknown as rdflib.IndexedFormula;
            // Candidate factories are those whose oslc:creation matches the POST URL.
            const candidateFactories = spDoc.each(undefined, OSLC('creation'), rdflib.sym(fullURL));

            // Choose the factory whose oslc:resourceType matches the body's rdf:type.
            // If multiple factories share the same creation URL (typical for
            // domain servers with a single container), this disambiguation is
            // required to get the correct resourceShape for instanceShape.
            let chosen: rdflib.NamedNode | undefined;
            for (const cfNode of candidateFactories) {
              const factoryTypes = spDoc
                .each(cfNode as rdflib.NamedNode, OSLC('resourceType'), undefined)
                .map(n => n.value);
              if (factoryTypes.some(t => resourceTypes.includes(t))) {
                chosen = cfNode as rdflib.NamedNode;
                break;
              }
            }

            // Fall back to the first candidate if no type match (preserves
            // prior behavior when the client doesn't declare rdf:type).
            if (!chosen && candidateFactories.length > 0) {
              chosen = candidateFactories[0] as rdflib.NamedNode;
            }

            if (chosen) {
              const shapeNodes = spDoc.each(chosen, OSLC('resourceShape'), undefined);
              if (shapeNodes.length > 0) {
                extraTriples.push(
                  `<> <http://open-services.net/ns/core#instanceShape> <${shapeNodes[0].value}> .`
                );
              }
            }
          }
        } catch (_err) {
          // Shape lookup is non-fatal — continue without it
        }
        finishRequest(req, body, extraTriples, next);
      })();
    });
    req.on('error', next);
  };
}

/**
 * Append extra triples to the body and replace the request stream
 * so ldp-service reads the modified content via its own rawBody middleware.
 */
function finishRequest(
  req: Request,
  body: string,
  extraTriples: string[],
  next: NextFunction
): void {
  const augmented = extraTriples.length > 0
    ? body + '\n' + extraTriples.join('\n') + '\n'
    : body;

  const stream = Readable.from([augmented]);
  Object.assign(req, {
    read: stream.read.bind(stream),
    on: stream.on.bind(stream),
    once: stream.once.bind(stream),
    removeListener: stream.removeListener.bind(stream),
    pipe: stream.pipe.bind(stream),
  });

  next();
}
