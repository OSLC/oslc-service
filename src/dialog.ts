/*
 * dialog.ts generates OSLC delegated creation dialogs from ResourceShapes.
 * The dialog is an HTML page with a form whose fields are derived from
 * the shape's oslc:property entries.
 */

import * as rdflib from 'rdflib';
import type { Request, Response, RequestHandler } from 'express';
import { type StorageService } from 'storage-service';
import type { OslcEnv } from './service.js';

const RDF = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const OSLC = rdflib.Namespace('http://open-services.net/ns/core#');
const DCTERMS = rdflib.Namespace('http://purl.org/dc/terms/');
const XSD = rdflib.Namespace('http://www.w3.org/2001/XMLSchema#');

interface ShapeProperty {
  uri: string;
  name: string;
  title: string;
  description: string;
  occurs: string;
  valueType: string;
  readOnly: boolean;
  hidden: boolean;
  maxSize: number;
}

/**
 * Create the Express route handler for GET /dialog/create.
 *
 * Query parameters:
 *   shape    - URI of the ResourceShape
 *   creation - URI of the creation factory (where the form POSTs)
 */
export function dialogCreateHandler(
  _env: OslcEnv,
  storage: StorageService
): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const shapeURI = req.query.shape as string;
    const creationURI = req.query.creation as string;

    if (!shapeURI || !creationURI) {
      res.status(400).send('Missing shape or creation query parameter');
      return;
    }

    const { status, document: shapeDoc } = await storage.read(shapeURI);
    if (status !== 200 || !shapeDoc) {
      res.status(404).send('ResourceShape not found: ' + shapeURI);
      return;
    }

    const properties = extractShapeProperties(shapeDoc, shapeURI);
    const shapeTitle = shapeDoc.anyValue(shapeDoc.sym(shapeURI), DCTERMS('title')) ?? 'Resource';
    const html = generateCreationDialogHTML(properties, creationURI, shapeTitle);
    res.type('html').send(html);
  };
}

function extractShapeProperties(
  graph: rdflib.IndexedFormula,
  shapeURI: string
): ShapeProperty[] {
  const shapeSym = graph.sym(shapeURI);
  const propNodes = graph.each(shapeSym, OSLC('property'), undefined);

  const properties: ShapeProperty[] = [];
  for (const propNode of propNodes) {
    const node = propNode as rdflib.NamedNode;
    const uri = graph.anyValue(node, OSLC('propertyDefinition')) ?? '';
    const name = graph.anyValue(node, OSLC('name')) ?? localName(uri);
    const title = graph.anyValue(node, DCTERMS('title')) ?? graph.anyValue(node, DCTERMS('description')) ?? name;
    const description = graph.anyValue(node, DCTERMS('description')) ?? '';
    const occurs = graph.anyValue(node, OSLC('occurs')) ?? '';
    const valueType = graph.anyValue(node, OSLC('valueType')) ?? XSD('string').value;
    const readOnly = graph.anyValue(node, OSLC('readOnly')) === 'true';
    const hidden = graph.anyValue(node, OSLC('hidden')) === 'true';
    const maxSizeStr = graph.anyValue(node, OSLC('maxSize'));
    const maxSize = maxSizeStr ? parseInt(maxSizeStr, 10) : 0;

    properties.push({ uri, name, title, description, occurs, valueType, readOnly, hidden, maxSize });
  }

  return properties;
}

function localName(uri: string): string {
  const parts = uri.split(/[#/]/);
  return parts[parts.length - 1] || uri;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mapValueTypeToInputType(valueType: string): string {
  if (valueType.endsWith('#dateTime') || valueType.endsWith('#date')) return 'datetime-local';
  if (valueType.endsWith('#integer') || valueType.endsWith('#int') || valueType.endsWith('#decimal')) return 'number';
  if (valueType.endsWith('#boolean')) return 'checkbox';
  if (valueType.endsWith('Resource') || valueType.endsWith('#anyURI')) return 'url';
  return 'text';
}

const OSLC_EXACTLY_ONE = 'http://open-services.net/ns/core#Exactly-one';
const OSLC_ONE_OR_MANY = 'http://open-services.net/ns/core#One-or-many';

function generateCreationDialogHTML(
  properties: ShapeProperty[],
  creationURI: string,
  shapeTitle: string
): string {
  const editableProps = properties.filter(p => !p.hidden && !p.readOnly);

  const fields = editableProps.map(p => {
    const required = p.occurs === OSLC_EXACTLY_ONE || p.occurs === OSLC_ONE_OR_MANY;
    const inputType = mapValueTypeToInputType(p.valueType);
    const maxAttr = p.maxSize > 0 ? ` maxlength="${p.maxSize}"` : '';

    return `      <div class="field">
        <label for="${escapeHtml(p.name)}">${escapeHtml(p.title)}${required ? ' *' : ''}</label>
        ${p.description ? `<div class="hint">${escapeHtml(p.description)}</div>` : ''}
        <input type="${inputType}" id="${escapeHtml(p.name)}" name="${escapeHtml(p.uri)}"${required ? ' required' : ''}${maxAttr}>
      </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Create ${escapeHtml(shapeTitle)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 16px; color: #333; }
    h2 { margin-top: 0; font-size: 18px; }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-weight: 600; margin-bottom: 2px; font-size: 13px; }
    .field .hint { font-size: 11px; color: #666; margin-bottom: 2px; }
    .field input[type="text"],
    .field input[type="url"],
    .field input[type="number"],
    .field input[type="datetime-local"] { width: 100%; padding: 6px 8px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 3px; font-size: 13px; }
    .buttons { margin-top: 16px; display: flex; gap: 8px; }
    button { padding: 8px 16px; border: 1px solid #ccc; border-radius: 3px; cursor: pointer; font-size: 13px; }
    button[type="submit"] { background: #0066cc; color: white; border-color: #0066cc; }
    .error { color: #cc0000; margin-top: 8px; display: none; font-size: 13px; }
  </style>
</head>
<body>
  <h2>Create ${escapeHtml(shapeTitle)}</h2>
  <form id="creation-form">
${fields}
    <div class="buttons">
      <button type="submit">OK</button>
      <button type="button" id="cancel-btn">Cancel</button>
    </div>
    <div class="error" id="error-msg"></div>
  </form>
  <script>
    const creationURI = ${JSON.stringify(creationURI)};

    document.getElementById('creation-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var formData = new FormData(e.target);
      var errorEl = document.getElementById('error-msg');
      errorEl.style.display = 'none';

      // Build Turtle body from form values
      var triples = [];
      for (var entry of formData.entries()) {
        var predicate = entry[0];
        var value = entry[1];
        if (value) {
          triples.push('<' + predicate + '> "' + escapeForTurtle(String(value)) + '"');
        }
      }
      if (triples.length === 0) {
        errorEl.textContent = 'Please fill in at least one field.';
        errorEl.style.display = 'block';
        return;
      }
      var turtle = '<> ' + triples.join(' ;\\n  ') + ' .';

      try {
        var response = await fetch(creationURI, {
          method: 'POST',
          headers: { 'Content-Type': 'text/turtle' },
          body: turtle
        });

        if (response.status === 201) {
          var location = response.headers.get('Location');
          sendResponse(location);
        } else {
          errorEl.textContent = 'Creation failed: ' + response.status;
          errorEl.style.display = 'block';
        }
      } catch (err) {
        errorEl.textContent = 'Error: ' + err.message;
        errorEl.style.display = 'block';
      }
    });

    document.getElementById('cancel-btn').addEventListener('click', function() {
      if (window.location.hash === '#oslc-core-postMessage-1.0') {
        (window.opener || window.parent).postMessage('oslc-response:', '*');
      } else {
        window.close();
      }
    });

    function sendResponse(resourceURI) {
      var result = JSON.stringify({
        'oslc:results': [{ 'rdf:resource': resourceURI }]
      });

      if (window.location.hash === '#oslc-core-postMessage-1.0') {
        (window.opener || window.parent).postMessage('oslc-response:' + result, '*');
      } else if (window.location.hash === '#oslc-core-windowName-1.0') {
        var params = new URLSearchParams(window.location.search);
        var returnURL = params.get('returnURL');
        window.name = result;
        if (returnURL) window.location.href = returnURL;
      }
    }

    function escapeForTurtle(s) {
      return s.replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
    }
  </script>
</body>
</html>`;
}
