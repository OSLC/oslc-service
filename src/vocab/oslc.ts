const ns = 'http://open-services.net/ns/core#' as const;

export const oslc = {
  ns,

  ResponseInfo: `${ns}ResponseInfo`,
  'Exactly-one': `${ns}Exactly-one`,
  'Zero-or-one': `${ns}Zero-or-one`,
  'Zero-or-many': `${ns}Zero-or-many`,
  'One-or-many': `${ns}One-or-many`,

  ServiceProviderCatalog: `${ns}ServiceProviderCatalog`,
  ServiceProvider: `${ns}ServiceProvider`,
  Service: `${ns}Service`,
  service: `${ns}service`,

  CreationFactory: `${ns}CreationFactory`,
  creationFactory: `${ns}creationFactory`,
  creation: `${ns}creation`,

  QueryCapability: `${ns}QueryCapability`,
  queryCapability: `${ns}queryCapability`,
  queryBase: `${ns}queryBase`,

  Dialog: `${ns}Dialog`,
  creationDialog: `${ns}creationDialog`,
  selectionDialog: `${ns}selectionDialog`,
  dialog: `${ns}dialog`,

  Publisher: `${ns}Publisher`,
  icon: `${ns}icon`,

  PrefixDefinition: `${ns}PrefixDefinition`,
  prefix: `${ns}prefix`,
  prefixBase: `${ns}prefixBase`,

  OAuthConfiguration: `${ns}OAuthConfiguration`,
  oauthRequestTokenURI: `${ns}oauthRequestTokenURI`,
  authorizationURI: `${ns}authorizationURI`,
  oauthAccessTokenURI: `${ns}oauthAccessTokenURI`,

  hintHeight: `${ns}hintHeight`,
  hintWidth: `${ns}hintWidth`,

  Error: `${ns}Error`,
  ExtendedError: `${ns}ExtendedError`,

  usage: `${ns}usage`,
  default: `${ns}default`,
  resourceShape: `${ns}resourceShape`,
  resourceType: `${ns}resourceType`,
  domain: `${ns}domain`,
  label: `${ns}label`,

  Property: `${ns}Property`,
  occurs: `${ns}occurs`,
  valueType: `${ns}valueType`,
  Resource: `${ns}Resource`,
  LocalResource: `${ns}LocalResource`,
  representation: `${ns}representation`,

  Inline: `${ns}Inline`,
  Reference: `${ns}Reference`,

  results: `${ns}results`,

  // Discovery properties
  serviceProvider: `${ns}serviceProvider`,
  details: `${ns}details`,

  // Resource Shapes
  ResourceShape: `${ns}ResourceShape`,
  describes: `${ns}describes`,
  name: `${ns}name`,
  property: `${ns}property`,
  propertyDefinition: `${ns}propertyDefinition`,
  readOnly: `${ns}readOnly`,
  hidden: `${ns}hidden`,
  maxSize: `${ns}maxSize`,
  range: `${ns}range`,
  allowedValues: `${ns}allowedValues`,
  isMemberProperty: `${ns}isMemberProperty`,

  // Compact / Preview
  Compact: `${ns}Compact`,
  compact: `${ns}compact`,
  smallPreview: `${ns}smallPreview`,
  largePreview: `${ns}largePreview`,
  Preview: `${ns}Preview`,
  document: `${ns}document`,
} as const;
