/**
 * Build MCP resource definitions from discovery results.
 *
 * Ported from oslc-mcp-server/src/resources.ts, with the three
 * content-formatting functions from oslc-mcp-server/src/discovery.ts:
 * formatCatalogContent(), formatShapesContent(), formatVocabularyContent().
 */

import type {
  DiscoveredShape,
  DiscoveredServiceProvider,
  DiscoveryResult,
  McpResourceDefinition,
} from './context.js';

const OSLC = 'http://open-services.net/ns/core#';

// ── Public API ──────────────────────────────────────────────────

/**
 * Build MCP resource definitions from discovery results.
 *
 * @param discovery - The complete discovery result
 * @param serverName - Human-readable server name for catalog header
 * @param serverBase - Root URL of the OSLC server
 */
export function buildMcpResources(
  discovery: DiscoveryResult,
  serverName: string,
  serverBase: string
): McpResourceDefinition[] {
  const catalogHeader = `**Server:** ${serverName}\n**Base URL:** ${serverBase}\n\n`;

  return [
    {
      uri: 'oslc://catalog',
      name: 'OSLC Service Provider Catalog',
      description:
        'Lists all service providers, creation factories, query capabilities, and resource types available on this OSLC server.',
      mimeType: 'text/plain',
      content: catalogHeader + discovery.catalogContent,
    },
    {
      uri: 'oslc://vocabulary',
      name: 'OSLC Vocabulary',
      description:
        'Resource types and their relationships. Read this to understand the domain model before creating resources.',
      mimeType: 'text/plain',
      content: discovery.vocabularyContent,
    },
    {
      uri: 'oslc://shapes',
      name: 'OSLC Resource Shapes',
      description:
        'Property definitions for each resource type: names, types, cardinalities, descriptions. Read this to know what fields each resource type accepts.',
      mimeType: 'text/plain',
      content: discovery.shapesContent,
    },
  ];
}

// ── Content formatters ──────────────────────────────────────────

/**
 * Format catalog content as human-readable text for MCP resource.
 */
export function formatCatalogContent(
  providers: DiscoveredServiceProvider[]
): string {
  const lines: string[] = ['# OSLC Service Provider Catalog\n'];

  for (const sp of providers) {
    lines.push(`## ${sp.title}`);
    lines.push(`URI: ${sp.uri}\n`);

    if (sp.factories.length > 0) {
      lines.push('### Creation Factories');
      for (const f of sp.factories) {
        lines.push(`- **${f.title}**`);
        lines.push(`  - Creation URL: ${f.creationURI}`);
        lines.push(`  - Resource Type: ${f.resourceType}`);
        if (f.shape) {
          lines.push(`  - Shape: ${f.shape.shapeURI}`);
        }
      }
      lines.push('');
    }

    if (sp.queries.length > 0) {
      lines.push('### Query Capabilities');
      for (const q of sp.queries) {
        lines.push(`- **${q.title}**`);
        lines.push(`  - Query Base: ${q.queryBase}`);
        lines.push(`  - Resource Type: ${q.resourceType}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format shapes content as human-readable text for MCP resource.
 */
export function formatShapesContent(shapes: Map<string, DiscoveredShape>): string {
  const lines: string[] = ['# OSLC Resource Shapes\n'];

  for (const [uri, shape] of shapes) {
    lines.push(`## ${shape.title || uri}`);
    if (shape.description) {
      lines.push(shape.description);
    }
    lines.push(`URI: ${uri}\n`);

    lines.push('| Property | Type | Required | Description | Inverse |');
    lines.push('|----------|------|----------|-------------|---------|');
    for (const prop of shape.properties) {
      const required =
        prop.occurs === 'exactly-one' || prop.occurs === 'one-or-more';
      const typeLabel = prop.valueType.split(/[#/]/).pop() ?? prop.valueType;
      const multi =
        prop.occurs === 'zero-or-many' || prop.occurs === 'one-or-more';
      const typeStr = multi ? `${typeLabel}[]` : typeLabel;
      const ro = prop.readOnly ? ' (read-only)' : '';
      const inverse = prop.inverseLabel
        ? prop.inverseLabel
        : prop.inversePropertyDefinition ?? '';
      lines.push(
        `| ${prop.name} | ${typeStr} | ${required ? 'Yes' : 'No'} | ${prop.description}${ro} | ${inverse} |`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format vocabulary content as human-readable text for MCP resource.
 * Extracts resource types and their relationships from the discovered data.
 */
export function formatVocabularyContent(
  providers: DiscoveredServiceProvider[],
  shapes: Map<string, DiscoveredShape>
): string {
  const lines: string[] = ['# OSLC Vocabulary\n'];
  lines.push('## Resource Types\n');

  const seenTypes = new Set<string>();
  for (const sp of providers) {
    for (const f of sp.factories) {
      if (f.resourceType && !seenTypes.has(f.resourceType)) {
        seenTypes.add(f.resourceType);
        const typeName = f.resourceType.split(/[#/]/).pop() ?? f.resourceType;
        lines.push(`### ${typeName}`);
        lines.push(`URI: ${f.resourceType}`);
        lines.push(`Create via: ${f.title}\n`);

        if (f.shape) {
          const resourceProps = f.shape.properties.filter(
            (p) =>
              p.valueType === `${OSLC}Resource` ||
              p.valueType === `${OSLC}AnyResource`
          );
          if (resourceProps.length > 0) {
            lines.push('**Relationships:**');
            for (const rp of resourceProps) {
              const rangeLabel = rp.range
                ? rp.range.split(/[#/]/).pop()
                : 'any';
              lines.push(
                `- ${rp.name} → ${rangeLabel} (${rp.occurs})`
              );
            }
            lines.push('');
          }
        }
      }
    }
  }

  return lines.join('\n');
}
