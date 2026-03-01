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

import express from 'express';
import { type StorageService, type StorageEnv } from 'storage-service';
import { ldpService } from 'ldp-service';
import { initCatalog, catalogPostHandler, type CatalogState } from './catalog.js';
import { dialogCreateHandler } from './dialog.js';
import { compactHandler } from './compact.js';

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

  // Initialize catalog from template if configured
  let catalogState: CatalogState | undefined;
  if (env.templatePath) {
    catalogState = await initCatalog(env, storage);

    // Intercept POST to catalog — must be mounted before ldp-service
    app.post(catalogState.catalogPath, catalogPostHandler(env, storage, catalogState, app));
  }

  // Creation dialog route
  app.get('/dialog/create', dialogCreateHandler(env, storage));

  // Resource preview (Compact) route
  app.get('/compact', compactHandler(env, storage));

  // Delegate all LDP operations to ldp-service
  app.use(ldpService(env, storage));

  return app;
}
