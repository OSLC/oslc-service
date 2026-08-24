/**
 * Term-level access to a parsed OSLC ResourceShape, over the rdflib store.
 *
 * Why this exists, and why the flattened {@link ShapeProperty} is now a cache
 * rather than the source of truth: projecting a shape into a hand-maintained
 * record loses everything nobody thought to project, and silently. `parseShape`
 * dropped `oslc:defaultValue` and `oslc:representation` outright — and EWM
 * publishes both on the property that decides whether a work item can be
 * created at all. Worse, `occurs` was *translated* into a private vocabulary by
 * a table that spelt one OSLC term wrong (`One-or-more`, which the
 * specification does not define), so every `oslc:One-or-many` property was read
 * as optional and single-valued, in the generated tool schemas included. Nothing
 * failed; the wrong answer simply propagated.
 *
 * Reading through the graph removes that whole class of bug: comparisons are
 * against OSLC URIs, a typo is a URI that matches nothing visibly rather than a
 * token that falls through a `default:` branch, and a term added to a shape needs
 * no parser change to become readable.
 */

import type { IndexedFormula, NamedNode, Node } from 'rdflib';

const OSLC = 'http://open-services.net/ns/core#';
const DCTERMS = 'http://purl.org/dc/terms/';

/** The OSLC cardinality terms, as the specification spells them. */
export const OCCURS = {
  ExactlyOne: `${OSLC}Exactly-one`,
  ZeroOrOne: `${OSLC}Zero-or-one`,
  ZeroOrMany: `${OSLC}Zero-or-many`,
  OneOrMany: `${OSLC}One-or-many`,
} as const;

/** Cardinalities that oblige a client to supply a value. */
const REQUIRED = new Set<string>([OCCURS.ExactlyOne, OCCURS.OneOrMany]);

/** Cardinalities that admit more than one value. */
const MULTIPLE = new Set<string>([OCCURS.ZeroOrMany, OCCURS.OneOrMany]);

/**
 * One `oslc:Property` of a shape, read from the graph on demand.
 *
 * Every getter returns what the server actually published — a URI where the
 * shape carries a URI — so callers compare against {@link OCCURS} and friends
 * rather than against strings this library invented.
 */
export class ShapePropertyAccess {
  constructor(
    private readonly store: IndexedFormula,
    /** The property node itself, named or blank. */
    public readonly node: Node
  ) {}

  private uri(term: string): string | null {
    return this.store.any(this.node as NamedNode, this.store.sym(term))?.value ?? null;
  }

  private literal(term: string): string | null {
    return this.store.anyValue(this.node as NamedNode, this.store.sym(term)) ?? null;
  }

  /** `oslc:name` — the short name, used as the JSON key in a tool's input. */
  get name(): string | null { return this.literal(`${OSLC}name`); }

  /** `oslc:propertyDefinition` — the predicate this property constrains. */
  get propertyDefinition(): string | null { return this.uri(`${OSLC}propertyDefinition`); }

  /** `dcterms:description`, as published. */
  get description(): string | null { return this.literal(`${DCTERMS}description`); }

  /** `dcterms:title`, which a server may use for a human label (EWM does: "Filed Against"). */
  get title(): string | null { return this.literal(`${DCTERMS}title`); }

  /** `oslc:valueType` — a URI, not a normalized token. */
  get valueType(): string | null { return this.uri(`${OSLC}valueType`); }

  /** `oslc:occurs` — the OSLC URI. Compare against {@link OCCURS}. */
  get occurs(): string | null { return this.uri(`${OSLC}occurs`); }

  /** `oslc:range` — the type expected at the other end of a reference. */
  get range(): string | null { return this.uri(`${OSLC}range`); }

  /** `oslc:representation` — Reference, Inline or Either. Previously dropped entirely. */
  get representation(): string | null { return this.uri(`${OSLC}representation`); }

  /**
   * `oslc:defaultValue` — previously dropped entirely.
   *
   * Read it with care: a server may advertise a default its own write rules
   * reject. EWM's `filedAgainst` defaults to the `Unassigned` category, which is
   * refused on save.
   */
  get defaultValue(): string | null {
    return this.uri(`${OSLC}defaultValue`) ?? this.literal(`${OSLC}defaultValue`);
  }

  /** `oslc:readOnly`, false when the shape says nothing. */
  get readOnly(): boolean { return this.literal(`${OSLC}readOnly`) === 'true'; }

  /** `oslc:inversePropertyLabel` — wording for the incoming direction of a link. */
  get inversePropertyLabel(): string | null {
    return this.literal(`${OSLC}inversePropertyLabel`);
  }

  /** Must a client supply this property? */
  get isRequired(): boolean {
    const occurs = this.occurs;
    return occurs !== null && REQUIRED.has(occurs);
  }

  /** May this property carry more than one value? */
  get isMultiValued(): boolean {
    const occurs = this.occurs;
    return occurs !== null && MULTIPLE.has(occurs);
  }

  /** Is the value a reference to another resource rather than a literal? */
  get isReference(): boolean {
    const type = this.valueType;
    return type === `${OSLC}Resource`
      || type === `${OSLC}AnyResource`
      || type === `${OSLC}LocalResource`;
  }

  /**
   * `oslc:allowedValue`s, whether stated inline or gathered under an
   * `oslc:allowedValues` document node.
   */
  get allowedValues(): string[] {
    const values = this.store
      .each(this.node as NamedNode, this.store.sym(`${OSLC}allowedValue`), null)
      .map((value) => value.value);
    const collection = this.store.any(this.node as NamedNode, this.store.sym(`${OSLC}allowedValues`));
    if (collection) {
      for (const value of this.store.each(collection as NamedNode, this.store.sym(`${OSLC}allowedValue`), null)) {
        values.push(value.value);
      }
    }
    return values;
  }
}

/** A shape, read from the graph it was parsed into. */
export class ShapeAccess {
  constructor(
    public readonly store: IndexedFormula,
    public readonly shapeURI: string
  ) {}

  private get node(): NamedNode { return this.store.sym(this.shapeURI); }

  get title(): string | null {
    return this.store.anyValue(this.node, this.store.sym(`${DCTERMS}title`)) ?? null;
  }

  get description(): string | null {
    return this.store.anyValue(this.node, this.store.sym(`${DCTERMS}description`)) ?? null;
  }

  /** `oslc:describes` — the type(s) this shape constrains. */
  get describes(): string[] {
    return this.store
      .each(this.node, this.store.sym(`${OSLC}describes`), null)
      .map((value) => value.value);
  }

  /** Every `oslc:property` of the shape. */
  get properties(): ShapePropertyAccess[] {
    return this.store
      .each(this.node, this.store.sym(`${OSLC}property`), null)
      .map((node) => new ShapePropertyAccess(this.store, node));
  }

  /** The property constraining a given predicate, if the shape has one. */
  property(propertyDefinition: string): ShapePropertyAccess | null {
    return this.properties.find((p) => p.propertyDefinition === propertyDefinition) ?? null;
  }

  /** Properties a client must supply. */
  get required(): ShapePropertyAccess[] {
    return this.properties.filter((p) => p.isRequired);
  }
}
