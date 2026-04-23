# oslc-service

Express middleware providing [OSLC 3.0](https://docs.oasis-open-projects.org/oslc-op/core/v3.0/oslc-core.html) services on top of [ldp-service](../ldp-service/). It is domain-agnostic: any OSLC domain can be supported by supplying the appropriate vocabulary URIs and a catalog template.

## Build

```bash
npm install
npm run build
```

`npm run clean` removes the `dist/` directory.

## Usage

oslc-service is Express middleware that wraps ldp-service. Mount it in an Express application with an initialized storage backend:

```typescript
import express from 'express';
import { oslcService } from 'oslc-service';
import { JenaStorageService } from 'jena-storage-service';

const app = express();
const storage = new JenaStorageService();

const env = {
  appBase: 'http://localhost:3000',
  context: '/',
  templatePath: './config/catalog-template.ttl',
};

await storage.init(env);
app.use(await oslcService(env, storage));
app.listen(3000);
```

The `oslcService(env, storage)` function accepts:

- **env** (`OslcEnv`) -- Configuration extending `StorageEnv` with:
  - `appBase` -- the server's external base URL
  - `context` -- URL path prefix (defaults to `/`)
  - `templatePath` -- absolute path to the catalog template file (`.ttl`)
  - `catalogPath` -- URL path for the catalog (defaults to `context + 'oslc'`)
- **storage** (`StorageService`) -- an initialized storage backend instance

It returns an Express application that can be mounted as middleware.

## What It Does

oslc-service implements the following OSLC 3.0 capabilities, all driven by configuration rather than hard-coded domain knowledge:

- **ServiceProviderCatalog** -- An LDP BasicContainer at the catalog path that lists available ServiceProviders. Created automatically at startup from the catalog template.
- **ServiceProvider creation** -- POST to the catalog with a `dcterms:title` to instantiate a new ServiceProvider from the template. Each ServiceProvider gets its own services, creation factories, and query capabilities.
- **Creation factories** -- Each ServiceProvider exposes creation factory URLs where clients POST new resources. Server-generated properties (`dcterms:created`, `dcterms:creator`, `oslc:serviceProvider`) are injected automatically.
- **Query capabilities** -- OSLC Query endpoints that accept `oslc.where`, `oslc.select`, `oslc.orderBy`, `oslc.searchTerms`, `oslc.prefix`, and paging parameters. Queries are parsed into an AST, translated to SPARQL, and executed against the storage backend. Results are returned as LDP BasicContainers with `oslc:ResponseInfo` for paged responses.
- **Resource shapes** -- Turtle shape documents referenced by the template are loaded into storage at startup. Shapes define the properties, value types, and cardinality constraints for resources.
- **Delegated UI dialogs** -- A creation dialog endpoint (`GET /dialog/create`) that reads a ResourceShape and generates an HTML form. The form supports the OSLC delegated UI protocol (`postMessage` and `windowName` mechanisms).
- **Compact rendering** -- A preview endpoint (`GET /compact`) that returns either an `oslc:Compact` RDF description or an HTML small-preview fragment, depending on content negotiation.
- **SPARQL endpoint** -- If the storage backend supports it, a SPARQL query endpoint is exposed at `{context}/sparql` for direct queries.
- **Resource lookup** -- A generic resource endpoint at `{context}/resource` that resolves any stored resource by URI.
- **CORS support** -- All routes include CORS headers for browser-based clients, including OSLC-specific headers like `OSLC-Core-Version`.

## Configuration

OSLC service discovery is driven by a **catalog template** file written in Turtle. The template defines the structure that every new ServiceProvider will have when instantiated.

The template uses the base URI `urn:oslc:template/` and declares:

- **Catalog properties** -- title, description, publisher for the `ServiceProviderCatalog`
- **Services** -- one or more `oslc:Service` blocks, each with an `oslc:domain`
- **Creation factories** -- title, resource types, and resource shapes
- **Creation dialogs** -- title, label, hint dimensions, usage, and resource shape
- **Query capabilities** -- title, resource types, and resource shapes

ResourceShape references in the template use URIs like `urn:oslc:template/shapes/MyShapes#SomeShape`. The corresponding `.ttl` files are loaded from the directory containing the template. External HTTP shape URIs are left as-is.

When a client POSTs to the catalog, oslc-service reads the template and creates a concrete ServiceProvider with real URLs pointing to creation factories, query endpoints, and dialog URLs.

## Architecture

oslc-service sits between the application layer and ldp-service in the middleware stack:

```
Application (oslc-server, mrm-server, etc.)
  |
  v
oslc-service  -- OSLC discovery, dialogs, query, compact, property injection
  |
  v
ldp-service   -- W3C LDP protocol (GET, PUT, POST, DELETE, content negotiation, ETags)
  |
  v
storage-service  -- Abstract storage interface (e.g., jena-storage-service for Apache Jena/Fuseki)
```

All LDP protocol operations (content negotiation, serialization, container management, ETag handling, Prefer headers) are handled by ldp-service. oslc-service intercepts requests that require OSLC-specific behavior and delegates everything else downward.

Key design constraint: oslc-service contains no domain-specific knowledge. It does not know about any particular OSLC domain (Change Management, Requirements Management, etc.). Domain-specific configuration is provided entirely through the catalog template and resource shapes.

## Exports

The module exports the following for use by consuming applications:

- `oslcService` -- the middleware factory function
- `oslc` -- OSLC Core 3.0 namespace constants
- `dcterms` -- Dublin Core Terms namespace constants
- `parseOslcQuery` / `toSPARQL` -- OSLC query parsing and SPARQL translation
- `queryHandler` / `sparqlHandler` / `resourceHandler` / `importHandler` -- reusable Express handlers

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](http://www.apache.org/licenses/LICENSE-2.0) for details.
