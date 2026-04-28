/*
 * compact.ts generates OSLC Compact (resource preview) representations.
 *
 * Two access paths:
 *
 *   1) OSLC-standard content negotiation on the resource URL
 *      itself, per OSLC Core (Compact section):
 *        GET <resourceURL>
 *          Accept: application/x-oslc-compact+xml
 *      Returns RDF/XML carrying oslc:Compact + oslc:smallPreview.
 *      Used by oslc-client's OSLCClient.getCompactResource() and any
 *      other OSLC-conformant client. The Accept-based dispatch is
 *      installed by compactAcceptMiddleware() in service.ts, which
 *      intercepts the GET before ldp-service.
 *
 *   2) Server-local convenience endpoint:
 *        GET /compact?uri=<resourceURI>
 *          Accept: text/turtle             -> oslc:Compact (Turtle)
 *          Accept: application/x-oslc-compact+xml -> oslc:Compact (RDF/XML)
 *          Accept: text/html               -> small preview HTML fragment
 *      The HTML fragment is what oslc:smallPreview's oslc:document URL
 *      points at; it's served from this same /compact endpoint with
 *      Accept: text/html so an iframe can load it.
 */

import * as rdflib from 'rdflib';
import type { Request, Response, RequestHandler, NextFunction } from 'express';
import { type StorageService } from 'storage-service';
import type { OslcEnv } from './service.js';

const RDF = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const OSLC = rdflib.Namespace('http://open-services.net/ns/core#');
const DCTERMS = rdflib.Namespace('http://purl.org/dc/terms/');

/** Standard OSLC media type for Compact representations. */
const OSLC_COMPACT_XML = 'application/x-oslc-compact+xml';

/**
 * Create the Express route handler for GET /compact?uri=<resourceURI>.
 * Convenience endpoint; honors Accept for HTML preview, Turtle Compact,
 * or RDF/XML Compact (the OSLC-standard media type).
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

    const accepts = req.accepts([
      'text/html',
      OSLC_COMPACT_XML,
      'application/rdf+xml',
      'text/turtle',
      'application/ld+json',
    ]);

    if (accepts === 'text/html') {
      const html = generateSmallPreviewHTML(resourceDoc, resourceURI);
      res.type('html').send(html);
    } else if (accepts === OSLC_COMPACT_XML || accepts === 'application/rdf+xml') {
      const xml = await generateCompactRDFXML(resourceDoc, resourceURI, env);
      res.type(OSLC_COMPACT_XML).send(xml);
    } else {
      const turtle = await generateCompactRDF(resourceDoc, resourceURI, env);
      res.type('text/turtle').send(turtle);
    }
  };
}

/**
 * Express middleware: serve the OSLC Compact representation for any
 * GET to a stored resource URL when the client's Accept header asks
 * for application/x-oslc-compact+xml. Per OSLC Core, this is the
 * standard mechanism — the Compact projection lives at the resource's
 * own URL under content negotiation, not at a side endpoint.
 *
 * Falls through to next() when:
 *   - The request method isn't GET
 *   - The Accept header doesn't include application/x-oslc-compact+xml
 *   - The storage layer doesn't have a record for this URL
 *
 * Mount this BEFORE ldp-service so the Compact response intercepts
 * the default LDP GET (which would return the full resource body).
 */
export function compactAcceptMiddleware(
  env: OslcEnv,
  storage: StorageService
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    const acceptHeader = req.headers.accept ?? '';
    if (!acceptHeader.includes(OSLC_COMPACT_XML)) {
      next();
      return;
    }

    // Reconstruct the absolute URL the client GETted against.
    const host = req.headers.host ?? 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol ?? 'http';
    const resourceURI = `${proto}://${host}${req.originalUrl ?? req.url}`;

    let read;
    try {
      read = await storage.read(resourceURI);
    } catch {
      next();
      return;
    }
    if (read.status !== 200 || !read.document) {
      next();
      return;
    }

    const xml = await generateCompactRDFXML(read.document, resourceURI, env);
    res.type(OSLC_COMPACT_XML).send(xml);
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

/**
 * Cache of shape URI → oslc:icon URL (or null if the shape has none
 * or could not be fetched). Shapes are practically static for the
 * lifetime of a server, so a per-process Map is sufficient.
 */
const shapeIconCache = new Map<string, string | null>();

/**
 * Look up the `oslc:icon` value for a resource by following its
 * `oslc:instanceShape` to the shape document and reading the icon
 * declared on the shape. Returns null if the resource has no
 * instanceShape, the shape lookup fails, or the shape declares no
 * icon. Implements the proposed `oslc:icon` ResourceShape extension
 * (see docs/OSLC-Shape-Extensions.md, Part 2).
 */
async function lookupResourceIcon(
  doc: rdflib.IndexedFormula,
  resourceURI: string
): Promise<string | null> {
  const sym = doc.sym(resourceURI);
  const shapeNode = doc.any(sym, OSLC('instanceShape'), null);
  if (!shapeNode || shapeNode.termType !== 'NamedNode') return null;
  const shapeURI = shapeNode.value;

  if (shapeIconCache.has(shapeURI)) return shapeIconCache.get(shapeURI)!;

  // Fragment URIs name a node within a shape document; HTTP fetches
  // ignore the fragment and return the whole document. Parse and
  // look up the fragment subject's oslc:icon.
  const docURI = shapeURI.split('#')[0];
  try {
    const resp = await fetch(docURI, { headers: { Accept: 'text/turtle' } });
    if (!resp.ok) {
      shapeIconCache.set(shapeURI, null);
      return null;
    }
    const turtle = await resp.text();
    const shapeStore = rdflib.graph();
    rdflib.parse(turtle, shapeStore, docURI, 'text/turtle');
    const iconNode = shapeStore.any(rdflib.sym(shapeURI), OSLC('icon'), null);
    const icon =
      iconNode && iconNode.termType === 'NamedNode' ? iconNode.value : null;
    shapeIconCache.set(shapeURI, icon);
    return icon;
  } catch {
    shapeIconCache.set(shapeURI, null);
    return null;
  }
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

async function generateCompactRDF(
  doc: rdflib.IndexedFormula,
  resourceURI: string,
  env: OslcEnv
): Promise<string> {
  const sym = doc.sym(resourceURI);
  const title = doc.anyValue(sym, DCTERMS('title')) ?? localName(resourceURI);
  const previewURL = env.appBase + '/compact?uri=' + encodeURIComponent(resourceURI);
  const icon = await lookupResourceIcon(doc, resourceURI);

  let body = `@prefix oslc: <http://open-services.net/ns/core#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<${resourceURI}>
  a oslc:Compact ;
  dcterms:title "${escapeTurtle(title)}" ;
`;
  if (icon) body += `  oslc:icon <${icon}> ;\n`;
  body += `  oslc:smallPreview [
    a oslc:Preview ;
    oslc:document <${previewURL}> ;
    oslc:hintHeight "200px" ;
    oslc:hintWidth "400px"
  ] .
`;
  return body;
}

function escapeTurtle(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generate the OSLC Compact projection in RDF/XML. The wire format
 * for application/x-oslc-compact+xml is RDF/XML; the media type label
 * is OSLC-specific so consumers know to expect a Compact resource.
 *
 * Rendering by hand (rather than going through rdflib.serialize) keeps
 * the output namespace-clean and avoids parser quirks some OSLC
 * clients have with rdflib's RDF/XML output.
 */
async function generateCompactRDFXML(
  doc: rdflib.IndexedFormula,
  resourceURI: string,
  env: OslcEnv
): Promise<string> {
  const sym = doc.sym(resourceURI);
  const title = doc.anyValue(sym, DCTERMS('title')) ?? localName(resourceURI);
  const shortTitle = doc.anyValue(sym, OSLC('shortTitle')) ?? '';
  const previewURL = env.appBase + '/compact?uri=' + encodeURIComponent(resourceURI);
  const icon = await lookupResourceIcon(doc, resourceURI);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
    '         xmlns:oslc="http://open-services.net/ns/core#"',
    '         xmlns:dcterms="http://purl.org/dc/terms/">',
    `  <oslc:Compact rdf:about="${escapeXmlAttr(resourceURI)}">`,
    `    <dcterms:title>${escapeXml(title)}</dcterms:title>`,
  ];
  if (shortTitle) {
    lines.push(`    <oslc:shortTitle>${escapeXml(shortTitle)}</oslc:shortTitle>`);
  }
  if (icon) {
    lines.push(`    <oslc:icon rdf:resource="${escapeXmlAttr(icon)}"/>`);
  }
  lines.push(
    '    <oslc:smallPreview>',
    '      <oslc:Preview>',
    `        <oslc:document rdf:resource="${escapeXmlAttr(previewURL)}"/>`,
    '        <oslc:hintHeight>200px</oslc:hintHeight>',
    '        <oslc:hintWidth>400px</oslc:hintWidth>',
    '      </oslc:Preview>',
    '    </oslc:smallPreview>',
    '  </oslc:Compact>',
    '</rdf:RDF>',
  );
  return lines.join('\n') + '\n';
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttr(text: string): string {
  return escapeXml(text).replace(/"/g, '&quot;');
}
