/** Subset of the Wappalyzer / webappanalyzer technology schema that can be evaluated server-side. */
export type PatternField = string | string[];

export type DomSpec =
  | string
  | string[]
  | Record<string, { exists?: string; text?: string; attributes?: Record<string, string>; properties?: Record<string, string> }>;

export interface TechDefinition {
  cats: number[];
  website?: string;
  html?: PatternField;
  text?: PatternField;
  scriptSrc?: PatternField;
  scripts?: PatternField;
  url?: PatternField;
  meta?: Record<string, PatternField>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  dom?: DomSpec;
  implies?: PatternField;
  requires?: PatternField;
  requiresCategory?: number | number[];
  excludes?: PatternField;
}

export interface FingerprintSet {
  categories: Record<string, string>;
  technologies: Record<string, TechDefinition>;
}
