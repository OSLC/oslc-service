# OSLC 3.0 Discovery Design

## Overview

oslc-service provides OSLC 3.0 discovery capabilities driven by a meta ServiceProviderCatalog template. Servers using oslc-service (such as oslc-server) provide the template via configuration, and oslc-service handles all OSLC discovery, dialog, and preview logic.

## Architecture

```
Client
  |
  |-- GET /oslc                    --> ServiceProviderCatalog (LDP BasicContainer)
  |-- POST /oslc                   --> Create ServiceProvider from template
  |-- GET /oslc/{sp}               --> ServiceProvider with services
  |-- GET /oslc/{sp}/resources     --> Resource container (LDP BasicContainer)
  |-- POST /oslc/{sp}/resources    --> Create resource (LDP POST)
  |-- GET /dialog/create?shape=&creation=  --> Creation dialog HTML
  |-- GET /compact?uri=            --> Resource preview (Compact)
  |-- GET/PUT/DELETE /*            --> LDP operations (ldp-service)
```

oslc-service mounts OSLC-specific routes before ldp-service. The catalog POST handler intercepts POST to the catalog path and creates ServiceProvider instances from the template. All other LDP operations fall through to ldp-service.

## Meta Template

The meta template is a Turtle file following OSLC Core vocabulary. It uses `urn:oslc:template/` as a base URI for placeholder URIs that are rewritten to concrete URLs at instantiation time.

### Template Structure

```turtle
@prefix oslc: <http://open-services.net/ns/core#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

# Catalog properties
<urn:oslc:template/catalog>
  dcterms:title "Server Name" ;
  dcterms:publisher [ a oslc:Publisher ; dcterms:title "Publisher" ] .

# Meta ServiceProvider (template for each new SP)
<urn:oslc:template/sp>
  a oslc:ServiceProvider ;
  oslc:service <urn:oslc:template/sp/service> .

<urn:oslc:template/sp/service>
  a oslc:Service ;
  oslc:domain <domainURI> ;
  oslc:creationFactory [
    a oslc:CreationFactory ;
    dcterms:title "..." ;
    oslc:resourceType <typeURI> ;
    oslc:resourceShape <shapeURI>
  ] ;
  oslc:creationDialog [
    a oslc:Dialog ;
    dcterms:title "..." ;
    oslc:resourceType <typeURI> ;
    oslc:hintWidth "680px" ;
    oslc:hintHeight "505px"
  ] .
```

### Parsing

`parseTemplate(turtleContent, appBase)` reads the template and extracts:
- **CatalogTemplate.catalogProps**: title, description, publisher info
- **CatalogTemplate.metaServiceProviders[]**: one per `<urn:oslc:template/sp>` subject
  - **MetaService[]**: from `oslc:service` links
    - **MetaCreationFactory[]**: from `oslc:creationFactory` blank nodes
    - **MetaCreationDialog[]**: from `oslc:creationDialog` blank nodes

## ServiceProvider Instantiation

When a client POSTs to the catalog:

1. **Parse input**: Extract `dcterms:title` from the Turtle body
2. **Mint URIs**:
   - SP URI: `{catalogURI}/{slug}` (from Slug header or slugified title)
   - Container URI: `{spURI}/resources`
3. **Create resources in storage**:
   - BasicContainer at `{spURI}/resources`
   - ServiceProvider at `{spURI}` with:
     - Title from POST body
     - Publisher from template
     - Services instantiated from template with concrete URLs:
       - `oslc:creation` -> `{spURI}/resources`
       - `oslc:dialog` -> `{appBase}/dialog/create?shape={shapeURI}&creation={spURI}/resources`
4. **Update catalog**: Insert `ldp:contains` triple linking catalog to new SP
5. **Return 201** with Location header

## Creation Dialogs

`GET /dialog/create?shape={shapeURI}&creation={creationURI}`

1. Read the ResourceShape from storage
2. Extract `oslc:property` entries with: name, occurs, valueType, readOnly, hidden
3. Generate HTML form:
   - `oslc:Exactly-one` / `oslc:One-or-many` -> required fields
   - `xsd:string` -> text input, `xsd:dateTime` -> datetime input, etc.
   - `oslc:readOnly` / `oslc:hidden` properties skipped
4. On submit: construct Turtle from form values, POST to creation URI
5. Response protocol: `postMessage` or `windowName` per URL hash fragment

## Resource Preview (Compact)

`GET /compact?uri={resourceURI}`

- **Accept: text/turtle**: Returns `oslc:Compact` RDF with title and `oslc:smallPreview` link
- **Accept: text/html**: Returns HTML fragment showing title, identifier, type, description

## Startup Sequence

1. Server reads template Turtle file from config
2. Calls `await oslcService(env, storage)` (async initialization)
3. oslc-service parses the template
4. Checks if catalog exists in storage (idempotent)
5. If not, creates BasicContainer with catalog properties
6. Stores ResourceShapes referenced by the template (idempotent)
7. Mounts routes: catalog POST, dialog, compact
8. Mounts ldp-service for all other operations

## OslcEnv Configuration

```typescript
interface OslcEnv extends StorageEnv {
  context?: string;        // LDP context path (default: '/')
  templatePath?: string;   // absolute path to meta template .ttl file
  catalogPath?: string;    // URL path for catalog (default: context + 'oslc')
}
```

The template path and catalog path are provided by the consuming server (e.g., oslc-server) when it instantiates oslc-service.
