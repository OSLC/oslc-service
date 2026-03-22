/**
 * MCP Express middleware for OSLC servers.
 *
 * Provides a Streamable HTTP MCP endpoint at the mounted path,
 * session management, and dynamic tool/resource rediscovery.
 *
 * Re-exports shared types so oslc-mcp-server can import from
 * 'oslc-service/mcp'.
 */

import { randomUUID } from 'node:crypto';
import express, { type Router, type Request, type Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { StorageService } from 'storage-service';
import type { CatalogState } from '../catalog.js';
import type { OslcEnv } from '../service.js';
import type { McpToolDefinition, McpResourceDefinition } from './context.js';
import { EmbeddedMcpContext } from './embedded-context.js';
import {
  handleGetResource,
  handleUpdateResource,
  handleDeleteResource,
  handleListResourceTypes,
  handleQueryResources,
} from './tool-handlers.js';

// ── Generic tool definitions ────────────────────────────────────

const GENERIC_TOOLS: McpToolDefinition[] = [
  {
    name: 'get_resource',
    description: 'Fetch an OSLC resource by URI and return all its properties.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'The URI of the resource to fetch' },
      },
      required: ['uri'],
    },
  },
  {
    name: 'update_resource',
    description:
      'Update an OSLC resource. Provided properties replace existing values; omitted properties are unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'The URI of the resource to update' },
        properties: {
          type: 'object',
          description: 'Properties to set (key-value pairs)',
        },
      },
      required: ['uri', 'properties'],
    },
  },
  {
    name: 'delete_resource',
    description: 'Delete an OSLC resource by URI.',
    inputSchema: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'The URI of the resource to delete' },
      },
      required: ['uri'],
    },
  },
  {
    name: 'list_resource_types',
    description:
      'List all discovered OSLC resource types with their creation factories, query capabilities, and property summaries.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'query_resources',
    description: 'Query OSLC resources using a query capability URL.',
    inputSchema: {
      type: 'object',
      properties: {
        queryBase: {
          type: 'string',
          description: 'The query capability URL',
        },
        filter: {
          type: 'string',
          description:
            'OSLC query filter (oslc.where). Example: dcterms:title="My Resource"',
        },
        select: {
          type: 'string',
          description: 'Property projection (oslc.select)',
        },
        orderBy: {
          type: 'string',
          description: 'Sort order (oslc.orderBy)',
        },
      },
      required: ['queryBase'],
    },
  },
];

// ── Middleware factory ───────────────────────────────────────────

/**
 * Rediscovery function returned alongside the router so that
 * catalog.ts can trigger re-discovery when SPs are created.
 */
export type RediscoverFn = () => Promise<void>;

/**
 * Create the MCP Express middleware and an associated rediscovery function.
 *
 * @returns An Express Router to mount at `/mcp` and a `rediscover` callback.
 */
export async function mcpMiddleware(
  catalogState: CatalogState,
  storage: StorageService,
  env: OslcEnv
): Promise<{ router: Router; rediscover: RediscoverFn }> {
  // 1. Create the embedded context
  const context = new EmbeddedMcpContext(catalogState, storage, env);

  // 2. Discover initial capabilities
  let currentTools: McpToolDefinition[] = [];
  let currentResources: McpResourceDefinition[] = [];

  const { tools, resources } = await context.discoverCapabilities();
  currentTools = tools;
  currentResources = resources;

  // 3. Factory to create a configured MCP Server for each session.
  //    The SDK's Server can only connect to one transport at a time,
  //    so each session gets its own Server + Transport pair.
  function createMcpServer(): Server {
    const server = new Server(
      { name: context.serverName, version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...currentTools, ...GENERIC_TOOLS],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        let result: string;
        const generatedHandler = context.getGeneratedHandler(name);
        if (generatedHandler) {
          result = await generatedHandler((args ?? {}) as Record<string, unknown>);
        } else {
          const discovery = context.getDiscoveryResult();
          switch (name) {
            case 'get_resource':
              result = await handleGetResource(context, args as { uri: string });
              break;
            case 'update_resource':
              if (!discovery) throw new Error('Discovery not yet complete');
              result = await handleUpdateResource(context, discovery, args as { uri: string; properties: Record<string, unknown> });
              break;
            case 'delete_resource':
              result = await handleDeleteResource(context, args as { uri: string });
              break;
            case 'list_resource_types':
              if (!discovery) throw new Error('Discovery not yet complete');
              result = handleListResourceTypes(context, discovery);
              break;
            case 'query_resources':
              result = await handleQueryResources(context, args as { queryBase: string; filter?: string; select?: string; orderBy?: string });
              break;
            default:
              return {
                content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
                isError: true,
              };
          }
        }
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    });

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: currentResources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const resource = currentResources.find((r) => r.uri === request.params.uri);
      if (!resource) {
        throw new Error(`Unknown resource: ${request.params.uri}`);
      }
      return {
        contents: [{
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: resource.content,
        }],
      };
    });

    return server;
  }

  // 4. Build Express Router with session management
  const router = express.Router();
  router.use(express.json());

  const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

  // POST — MCP JSON-RPC requests
  router.post('/', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      let server: Server | undefined;

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        server = session.server;
        transport = session.transport;
      } else if (!sessionId) {
        // New session — create a Server + Transport pair
        server = createMcpServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        await server.connect(transport);
      } else {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      await transport.handleRequest(req, res, req.body);

      // Store the session after handleRequest — the session ID is
      // generated during the first handleRequest call, not at construction.
      if (transport.sessionId && !sessions.has(transport.sessionId) && server) {
        sessions.set(transport.sessionId, { server, transport });
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error('[mcp] POST error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed', detail: error.message });
      }
    }
  });

  // GET — SSE stream for server-initiated notifications
  router.get('/', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      await sessions.get(sessionId)!.transport.handleRequest(req, res);
    } catch (err) {
      console.error('[mcp] GET error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed' });
      }
    }
  });

  // DELETE — session termination
  router.delete('/', async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      await sessions.get(sessionId)!.transport.handleRequest(req, res);
      sessions.delete(sessionId);
    } catch (err) {
      console.error('[mcp] DELETE error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP request failed' });
      }
    }
  });

  // 9. Rediscovery function
  const rediscover: RediscoverFn = async () => {
    try {
      const { tools: newTools, resources: newResources } = await context.discoverCapabilities();
      currentTools = newTools;
      currentResources = newResources;
      console.log(`[mcp] Rediscovery complete: ${newTools.length} tools`);
    } catch (err) {
      console.error('[mcp] Rediscovery failed, retaining existing tools:', err);
    }
  };

  return { router, rediscover };
}

// ── Re-exports for oslc-mcp-server ──────────────────────────────

export type {
  OslcMcpContext,
  ShapeProperty,
  DiscoveredShape,
  DiscoveredFactory,
  DiscoveredQuery,
  DiscoveredServiceProvider,
  DiscoveryResult,
  OslcQueryParams,
  McpToolDefinition,
  McpResourceDefinition,
} from './context.js';

export {
  shapeToJsonSchema,
  buildPredicateMap,
  buildPredicateMapForResource,
  parseShape,
} from './schema.js';

export { generateTools } from './tool-factory.js';
export type { GeneratedTool } from './tool-factory.js';

export {
  buildMcpResources,
  formatCatalogContent,
  formatShapesContent,
  formatVocabularyContent,
} from './resources.js';

export {
  handleGetResource,
  handleUpdateResource,
  handleDeleteResource,
  handleListResourceTypes,
  handleQueryResources,
  resourceToJson,
} from './tool-handlers.js';

export { EmbeddedMcpContext } from './embedded-context.js';
