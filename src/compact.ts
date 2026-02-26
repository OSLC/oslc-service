/*
 * compact.ts generates OSLC Compact (resource preview) representations.
 *
 * GET /compact?uri=<resourceURI>
 *   Accept: text/turtle  -> oslc:Compact RDF
 *   Accept: text/html    -> small preview HTML fragment
 */

import * as rdflib from 'rdflib';
import type { Request, Response, RequestHandler } from 'express';
import { type StorageService } from 'storage-service';
import type { OslcEnv } from './service.js';

const RDF = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const OSLC = rdflib.Namespace('http://open-services.net/ns/core#');
const DCTERMS = rdflib.Namespace('http://purl.org/dc/terms/');

/**
 * Create the Express route handler for GET /compact.
 */
export function compactHandler(
  env: OslcEnv,
  storage: StorageService
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const resourceURI = req.query.uri as string;
    if (!resourceURI) {
      res.status(400).send('Missing uri query parameter');
      return;
    }

    const { status, document: resourceDoc } = await storage.read(resourceURI);
    if (status !== 200 || !resourceDoc) {
      res.sendStatus(404);
      return;
    }

    const accepts = req.accepts(['text/html', 'text/turtle', 'application/ld+json']);

    if (accepts === 'text/html') {
      const html = generateSmallPreviewHTML(resourceDoc, resourceURI);
      res.type('html').send(html);
    } else {
      const turtle = generateCompactRDF(resourceDoc, resourceURI, env);
      res.type('text/turtle').send(turtle);
    }
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function localName(uri: string): string {
  const parts = uri.split(/[#/]/);
  return parts[parts.length - 1] || uri;
}

function generateSmallPreviewHTML(
  doc: rdflib.IndexedFormula,
  resourceURI: string
): string {
  const sym = doc.sym(resourceURI);
  const title = doc.anyValue(sym, DCTERMS('title')) ?? localName(resourceURI);
  const description = doc.anyValue(sym, DCTERMS('description')) ?? '';
  const identifier = doc.anyValue(sym, DCTERMS('identifier')) ?? '';
  const types = doc.statementsMatching(sym, RDF('type'), undefined)
    .map(s => s.object.value)
    .filter(t => !t.startsWith('http://www.w3.org/ns/ldp#'));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 8px; font-size: 13px; color: #333; }
    .title { font-weight: 600; font-size: 14px; color: #0066cc; }
    .id { color: #888; font-size: 12px; }
    .type { color: #666; font-size: 11px; margin-top: 2px; }
    .desc { margin-top: 4px; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="title">${escapeHtml(title)}</div>
  ${identifier ? `<div class="id">#${escapeHtml(identifier)}</div>` : ''}
  ${types.length ? `<div class="type">${types.map(t => escapeHtml(localName(t))).join(', ')}</div>` : ''}
  ${description ? `<div class="desc">${escapeHtml(description)}</div>` : ''}
</body>
</html>`;
}

function generateCompactRDF(
  doc: rdflib.IndexedFormula,
  resourceURI: string,
  env: OslcEnv
): string {
  const sym = doc.sym(resourceURI);
  const title = doc.anyValue(sym, DCTERMS('title')) ?? localName(resourceURI);
  const previewURL = env.appBase + '/compact?uri=' + encodeURIComponent(resourceURI);

  return `@prefix oslc: <http://open-services.net/ns/core#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<${resourceURI}>
  a oslc:Compact ;
  dcterms:title "${escapeTurtle(title)}" ;
  oslc:smallPreview [
    a oslc:Preview ;
    oslc:document <${previewURL}> ;
    oslc:hintHeight "200px" ;
    oslc:hintWidth "400px"
  ] .
`;
}

function escapeTurtle(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
