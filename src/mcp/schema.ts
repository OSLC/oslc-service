/**
 * OSLC ResourceShape → JSON Schema conversion.
 *
 * Ported from oslc-mcp-server/src/schema.ts, with parseShape() from
 * oslc-mcp-server/src/discovery.ts and buildPredicateMapForResource()
 * from oslc-mcp-server/src/tools/generic.ts.
 */

import * as rdflib from 'rdflib';
import type { NamedNode, IndexedFormula } from 'rdflib';
import type {
  ShapeProperty,
  DiscoveredShape,
  DiscoveryResult,
} from './context.js';

// ── Namespace constants ─────────────────────────────────────────

const oslcNS = rdflib.Namespace('http://open-services.net/ns/core#');
const dctermsNS = rdflib.Namespace('http://purl.org/dc/terms/');
const xsdNS = rdflib.Namespace('http://www.w3.org/2001/XMLSchema#');
const rdfNS = rdflib.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');

const OSLC_NS = 'http://open-services.net/ns/core#';
const XSD_NS = 'http://www.w3.org/2001/XMLSchema#';

// ── JSON Schema types ───────────────────────────────────────────

/**
 * JSON Schema type definition for MCP tool inputSchema.
 */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  description?: string;
}

interface JsonSchemaProperty {
  type: string;
  description?: string;
  format?: string;
  items?: { type: string; description?: string; format?: string; enum?: string[] };
  enum?: string[];
}

// ── Value-type mapping ──────────────────────────────────────────

/**
 * Map an oslc:valueType URI to a JSON Schema type.
 */
function mapValueType(valueType: string): { type: string; format?: string } {
  switch (valueType) {
    case `${XSD_NS}string`:
    case `${XSD_NS}anyURI`:
      return { type: 'string' };
    case `${XSD_NS}integer`:
    case `${XSD_NS}int`:
    case `${XSD_NS}long`:
      return { type: 'integer' };
    case `${XSD_NS}float`:
    case `${XSD_NS}double`:
    case `${XSD_NS}decimal`:
      return { type: 'number' };
    case `${XSD_NS}boolean`:
      return { type: 'boolean' };
    case `${XSD_NS}dateTime`:
    case `${XSD_NS}date`:
      return { type: 'string', format: 'date-time' };
    case `${OSLC_NS}Resource`:
    case `${OSLC_NS}AnyResource`:
    case `${OSLC_NS}LocalResource`:
      return { type: 'string' };
    default:
      return { type: 'string' };
  }
}

// ── Description builder ─────────────────────────────────────────

/**
 * Build a description string for a property, including range info.
 */
function buildDescription(prop: ShapeProperty): string {
  const parts: string[] = [];
  if (prop.description) {
    parts.push(prop.description);
  }

  const isResource =
    prop.valueType === `${OSLC_NS}Resource` ||
    prop.valueType === `${OSLC_NS}AnyResource` ||
    prop.valueType === `${OSLC_NS}LocalResource`;

  if (isResource) {
    parts.push('(URI reference)');
  }
  if (prop.range) {
    parts.push(`Expected type: ${prop.range}`);
  }
  return parts.join(' ');
}

// ── Shape → JSON Schema ─────────────────────────────────────────

/**
 * Convert an OSLC ResourceShape into a JSON Schema for MCP tool input.
 *
 * @param shape - The discovered resource shape
 * @param excludeReadOnly - If true, exclude read-only properties (for create tools)
 * @returns JSON Schema object
 */
export function shapeToJsonSchema(
  shape: DiscoveredShape,
  excludeReadOnly: boolean = true
): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const prop of shape.properties) {
    if (excludeReadOnly && prop.readOnly) {
      continue;
    }

    const { type, format } = mapValueType(prop.valueType);
    const description = buildDescription(prop);
    const isArray =
      prop.occurs === 'zero-or-many' || prop.occurs === 'one-or-more';

    if (isArray) {
      const schemaProp: JsonSchemaProperty = {
        type: 'array',
        items: {
          type,
          ...(format ? { format } : {}),
        },
      };
      if (description) schemaProp.description = description;
      if (prop.allowedValues.length > 0) {
        schemaProp.items = { ...schemaProp.items!, enum: prop.allowedValues };
      }
      properties[prop.name] = schemaProp;
    } else {
      const schemaProp: JsonSchemaProperty = { type };
      if (description) schemaProp.description = description;
      if (format) schemaProp.format = format;
      if (prop.allowedValues.length > 0) {
        schemaProp.enum = prop.allowedValues;
      }
      properties[prop.name] = schemaProp;
    }

    if (prop.occurs === 'exactly-one' || prop.occurs === 'one-or-more') {
      required.push(prop.name);
    }
  }

  return {
    type: 'object',
    properties,
    required,
    ...(shape.description ? { description: shape.description } : {}),
  };
}

// ── Predicate maps ──────────────────────────────────────────────

/**
 * Build a property-name-to-predicate-URI lookup map from a shape.
 */
export function buildPredicateMap(
  shape: DiscoveredShape
): Map<string, string> {
  const map = new Map<string, string>();
  for (const prop of shape.properties) {
    map.set(prop.name, prop.predicateURI);
  }
  return map;
}

/**
 * Build a property-name-to-predicate-URI map for a specific resource,
 * by finding its rdf:type and matching it to a discovered shape.
 */
export function buildPredicateMapForResource(
  store: IndexedFormula,
  uri: string,
  discovery: DiscoveryResult
): Map<string, string> {
  const subject = store.sym(uri);
  const typeNodes = store.each(subject, rdfNS('type'), null);
  const typeURIs = typeNodes.map((n) => n.value);

  // Try to find a shape that matches one of the resource's types
  for (const sp of discovery.serviceProviders) {
    for (const factory of sp.factories) {
      if (typeURIs.includes(factory.resourceType) && factory.shape) {
        const map = new Map<string, string>();
        for (const prop of factory.shape.properties) {
          map.set(prop.name, prop.predicateURI);
        }
        return map;
      }
    }
  }

  // Fallback: return empty map
  return new Map();
}

// ── Parse shape from rdflib store ───────────────────────────────

/**
 * Map an oslc:occurs URI to a normalized string.
 */
function normalizeOccurs(occursURI: string): string {
  switch (occursURI) {
    case `${OSLC_NS}Exactly-one`:
      return 'exactly-one';
    case `${OSLC_NS}Zero-or-one`:
      return 'zero-or-one';
    case `${OSLC_NS}Zero-or-many`:
      return 'zero-or-many';
    case `${OSLC_NS}One-or-more`:
      return 'one-or-more';
    default:
      return 'zero-or-one';
  }
}

/**
 * Parse a resource shape from an rdflib IndexedFormula store
 * into a DiscoveredShape.
 *
 * @param store - The rdflib store containing the shape triples
 * @param shapeURI - The URI of the shape to parse
 * @returns The parsed DiscoveredShape
 */
export function parseShape(store: IndexedFormula, shapeURI: string): DiscoveredShape {
  const shapeSym = store.sym(shapeURI);

  const title =
    store.anyValue(shapeSym, dctermsNS('title')) ?? '';
  const description =
    store.anyValue(shapeSym, dctermsNS('description')) ?? '';

  const propertyNodes = store.each(shapeSym, oslcNS('property'), null);
  const properties: ShapeProperty[] = [];

  for (const propNode of propertyNodes) {
    const pn = propNode as NamedNode;
    const name = store.anyValue(pn, oslcNS('name')) ?? '';
    if (!name) continue;

    const propertyDefinition =
      store.any(pn, oslcNS('propertyDefinition'))?.value ?? '';
    const descriptionVal =
      store.anyValue(pn, dctermsNS('description')) ?? '';
    const valueTypeNode = store.any(pn, oslcNS('valueType'));
    const valueType = valueTypeNode?.value ?? `${xsdNS('').value}string`;
    const occursNode = store.any(pn, oslcNS('occurs'));
    const occurs = occursNode ? normalizeOccurs(occursNode.value) : 'zero-or-one';
    const rangeNode = store.any(pn, oslcNS('range'));
    const range = rangeNode?.value ?? null;
    const readOnlyNode = store.any(pn, oslcNS('readOnly'));
    const readOnly = readOnlyNode?.value === 'true';

    // Collect allowed values
    const allowedValues: string[] = [];
    const allowedValueNodes = store.each(pn, oslcNS('allowedValue'), null);
    for (const av of allowedValueNodes) {
      allowedValues.push(av.value);
    }
    const allowedValuesNode = store.any(pn, oslcNS('allowedValues'));
    if (allowedValuesNode) {
      const avMembers = store.each(allowedValuesNode as NamedNode, oslcNS('allowedValue'), null);
      for (const av of avMembers) {
        allowedValues.push(av.value);
      }
    }

    // Inverse metadata — identifiers for the reverse direction used
    // by clients to render incoming-link discovery results. The
    // inverse URI is never asserted as a triple; only the forward
    // direction is stored.
    const inversePropertyDefinition =
      store.any(pn, oslcNS('inversePropertyDefinition'))?.value;
    const inverseLabel = store.anyValue(pn, oslcNS('inverseLabel'));

    properties.push({
      name,
      predicateURI: propertyDefinition,
      description: descriptionVal,
      valueType,
      occurs,
      range,
      readOnly,
      allowedValues,
      ...(inversePropertyDefinition ? { inversePropertyDefinition } : {}),
      ...(inverseLabel ? { inverseLabel } : {}),
    });
  }

  return { shapeURI, title, description, properties };
}
