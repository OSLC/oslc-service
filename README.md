# oslc-service

[![npm](https://img.shields.io/npm/v/oslc-service)](https://www.npmjs.com/package/oslc-service)
[![Discourse status](https://img.shields.io/discourse/https/meta.discourse.org/status.svg)](https://forum.open-services.net/)
[![Gitter](https://img.shields.io/gitter/room/nwjs/nw.js.svg)](https://gitter.im/OSLC/chat)

A Node.js module providing Express middleware to create an [OSLC 3.0](https://docs.oasis-open-projects.org/oslc-op/core/v3.0/oslc-core.html) server. It is built on the **ldp-service** Express middleware which implements the W3C Linked Data Platform protocol, providing a pluggable storage backend for persistence.

oslc-service supports any OSLC domain by including the domain vocabulary URIs. It also exports the OSLC Core 3.0 vocabulary constants for use in OSLC applications.

Many thanks to Steve Speicher and Sam Padgett for their valuable contribution to LDP and the LDP middleware upon which this service is built.

## Architecture

oslc-service is a thin wrapper over ldp-service that serves as the extension point for OSLC-specific behavior:

- **ldp-service** -- Express middleware implementing W3C LDP (GET, HEAD, PUT, POST, DELETE for RDF resources and containers, content negotiation, ETag handling, Prefer headers, DirectContainer membership)
- **oslc-service** -- Mounts ldp-service and exports OSLC vocabulary constants
- **storage-service** -- Abstract storage interface; backends like ldp-service-jena provide persistence

All LDP protocol operations (content negotiation, serialization, container management, membership patterns) are handled by ldp-service. oslc-service delegates to it and provides the OSLC vocabulary and a future extension point for OSLC-specific features such as service provider catalogs, resource shapes, and query capabilities.

## Usage

```typescript
import express from 'express';
import { oslcService } from 'oslc-service';
import { JenaStorageService } from 'ldp-service-jena';

const app = express();
const storage = new JenaStorageService();

await storage.init(env);
app.use(oslcService(env, storage));
```

The `oslcService(env, storage)` function takes:
- **env** (`OslcEnv`) -- Configuration extending `StorageEnv` with `appBase`, `context`, `jenaURL`, etc.
- **storage** (`StorageService`) -- An initialized storage backend instance

It returns an Express application that can be mounted as middleware.

## OSLC Vocabulary

The `oslc` export provides OSLC Core 3.0 namespace constants:

```typescript
import { oslc } from 'oslc-service';

oslc.ServiceProviderCatalog  // 'http://open-services.net/ns/core#ServiceProviderCatalog'
oslc.ServiceProvider         // 'http://open-services.net/ns/core#ServiceProvider'
oslc.CreationFactory         // 'http://open-services.net/ns/core#CreationFactory'
oslc.QueryCapability         // 'http://open-services.net/ns/core#QueryCapability'
oslc.resourceShape           // 'http://open-services.net/ns/core#resourceShape'
// ... and many more
```

## Building

```bash
npm run build    # Compile TypeScript
npm run clean    # Remove dist/
```

## License

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
