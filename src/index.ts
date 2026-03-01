export { oslcService, type OslcEnv } from './service.js';
export { oslc } from './vocab/oslc.js';
export { dcterms } from './vocab/dcterms.js';
export { type CatalogState } from './catalog.js';
export {
  type CatalogTemplate,
  type MetaServiceProvider,
  type MetaService,
  type MetaCreationFactory,
  type MetaCreationDialog,
  type MetaQueryCapability,
} from './template.js';
export { parseOslcQuery, type OslcQuery } from './query-parser.js';
export { toSPARQL } from './query-translator.js';
export { queryHandler } from './query-handler.js';
export { importHandler } from './import-handler.js';
