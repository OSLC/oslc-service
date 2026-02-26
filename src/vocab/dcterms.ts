const ns = 'http://purl.org/dc/terms/' as const;

export const dcterms = {
  ns,
  prefix: 'dcterms' as const,
  title: `${ns}title`,
  description: `${ns}description`,
  identifier: `${ns}identifier`,
  publisher: `${ns}publisher`,
  creator: `${ns}creator`,
  created: `${ns}created`,
  modified: `${ns}modified`,
  subject: `${ns}subject`,
  contributor: `${ns}contributor`,
  type: `${ns}type`,
} as const;
