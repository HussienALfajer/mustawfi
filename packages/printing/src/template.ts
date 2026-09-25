import { type FS, Liquid } from "liquidjs";

/**
 * Templates may not reach files: `include`, `render`, and `layout` find nothing, in Node as in
 * the browser, so a tenant's template sees only the data it is given.
 */
const noFiles: FS = {
  exists: () => Promise.resolve(false),
  existsSync: () => false,
  readFile: (file) => Promise.reject(new Error(`templates cannot read files: ${file}`)),
  readFileSync: (file) => {
    throw new Error(`templates cannot read files: ${file}`);
  },
  resolve: (_dir, file) => file,
  contains: () => Promise.resolve(false),
  containsSync: () => false,
};

/**
 * Print templates are HTML with LiquidJS variables (ADR-0025). LiquidJS runs no code, and here
 * it also escapes every output (a product named `<img onerror=…>` prints as text), refuses
 * unknown variables and filters (a typo fails loudly instead of printing blank), reads only
 * own properties, and bounds the size and cost of a template.
 */
const engine = new Liquid({
  fs: noFiles,
  root: [],
  relativeReference: false,
  outputEscape: "escape",
  strictVariables: true,
  strictFilters: true,
  ownPropertyOnly: true,
  parseLimit: 100_000,
  renderLimit: 1_000,
  memoryLimit: 10_000_000,
});

/** Renders a print template with its data into HTML. */
export function renderTemplate(source: string, data: object): string {
  return engine.parseAndRenderSync(source, data) as string;
}
