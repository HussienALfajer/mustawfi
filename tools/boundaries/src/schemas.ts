import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import type { Violation } from "./check.ts";

/**
 * ADR-0015 rule 5: a module's table definitions are not exported from any entry, and its SQL
 * touches only its own PostgreSQL schema — except the foreign keys ADR-0016 allows toward
 * modules in its `dependsOn`.
 */

export interface ModuleInfo {
  /** Repository-relative directory with forward slashes, e.g. `core/ledger`. */
  dir: string;
  moduleId: string;
  dependsOn: readonly string[];
  /** Absolute paths of the files behind its `./shared`, `./server`, `./client` entries. */
  entryFiles: readonly string[];
}

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
/** Drizzle builders whose result is a table, view, enum, sequence, or schema. */
const TABLE_BUILDERS = new Set([
  "pgTable",
  "pgSchema",
  "pgView",
  "pgMaterializedView",
  "pgEnum",
  "pgSequence",
  "sqliteTable",
  "sqliteView",
]);
/** Members of a `pgSchema(...)` object, or of a table, that return a table definition. */
const TABLE_MEMBERS = new Set([
  "table",
  "view",
  "materializedView",
  "enum",
  "sequence",
  "enableRLS",
]);
/** A string that starts like a SQL statement. */
const SQL_START =
  /^\s*(select|insert|update|delete|with|create|alter|drop|grant|revoke|truncate|lock|set|comment)\b/i;

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.ReactJSX,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

/** The PostgreSQL schema that owns a module's tables (ADR-0016): `core.ledger` → `core_ledger`. */
export function schemaNameOf(moduleId: string): string {
  return moduleId.replace(/[.-]/g, "_");
}

function toRepoPath(rootDir: string, file: string): string {
  return relative(rootDir, file).split("\\").join("/");
}

/** Rule 5, first half: no entry exports a Drizzle table or schema, directly or re-exported. */
export function checkTableExports(rootDir: string, modules: readonly ModuleInfo[]): Violation[] {
  const entries = modules.flatMap((module) =>
    module.entryFiles.filter((file) => existsSync(file)).map((file) => ({ module, file })),
  );
  if (entries.length === 0) return [];

  // Third-party packages stay unresolved: only workspace code can define a table, and loading
  // every library's declarations would only slow the check down.
  const host = ts.createCompilerHost(COMPILER_OPTIONS, true);
  host.resolveModuleNameLiterals = (literals, containingFile, _redirect, options) =>
    literals.map((literal) => {
      const { resolvedModule } = ts.resolveModuleName(literal.text, containingFile, options, host);
      return {
        resolvedModule:
          resolvedModule !== undefined &&
          !resolvedModule.resolvedFileName.includes("/node_modules/")
            ? resolvedModule
            : undefined,
      };
    });
  const program = ts.createProgram(
    entries.map((e) => e.file),
    COMPILER_OPTIONS,
    host,
  );
  const checker = program.getTypeChecker();

  const resolveAlias = (symbol: ts.Symbol): ts.Symbol =>
    symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

  /** Whether an import binding comes from a `drizzle-orm` entry. */
  const isDrizzleImport = (declaration: ts.ImportDeclaration | ts.JSDocImportTag): boolean =>
    ts.isStringLiteral(declaration.moduleSpecifier) &&
    declaration.moduleSpecifier.text.startsWith("drizzle-orm");

  /** `pgTable` imported by name, or `pg.pgTable` through a namespace import of Drizzle. */
  const isDrizzleBuilder = (callee: ts.Expression): boolean => {
    if (ts.isIdentifier(callee)) {
      const declaration = checker.getSymbolAtLocation(callee)?.declarations?.[0];
      if (declaration === undefined || !ts.isImportSpecifier(declaration)) return false;
      const imported = (declaration.propertyName ?? declaration.name).text;
      return isDrizzleImport(declaration.parent.parent.parent) && TABLE_BUILDERS.has(imported);
    }
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const declaration = checker.getSymbolAtLocation(callee.expression)?.declarations?.[0];
      return (
        declaration !== undefined &&
        ts.isNamespaceImport(declaration) &&
        isDrizzleImport(declaration.parent.parent) &&
        TABLE_BUILDERS.has(callee.name.text)
      );
    }
    return false;
  };

  const isTableSymbol = (symbol: ts.Symbol | undefined, seen: Set<ts.Symbol>): boolean => {
    if (symbol === undefined) return false;
    const resolved = resolveAlias(symbol);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return (resolved.declarations ?? []).some(
      (declaration) =>
        (ts.isVariableDeclaration(declaration) &&
          declaration.initializer !== undefined &&
          isTableExpression(declaration.initializer, seen)) ||
        (ts.isExportAssignment(declaration) && isTableExpression(declaration.expression, seen)),
    );
  };

  const isTableExpression = (node: ts.Expression, seen: Set<ts.Symbol>): boolean => {
    const expression = skipOuter(node);
    if (ts.isCallExpression(expression)) {
      const callee = skipOuter(expression.expression);
      if (isDrizzleBuilder(callee)) return true;
      if (ts.isPropertyAccessExpression(callee) && TABLE_MEMBERS.has(callee.name.text))
        return isTableExpression(callee.expression, seen);
      return false;
    }
    if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression))
      return isTableSymbol(checker.getSymbolAtLocation(expression), seen);
    if (ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression)) {
      const elements = ts.isObjectLiteralExpression(expression)
        ? expression.properties
        : expression.elements;
      return elements.some((element) => {
        if (ts.isShorthandPropertyAssignment(element))
          return isTableSymbol(checker.getShorthandAssignmentValueSymbol(element), seen);
        if (ts.isPropertyAssignment(element)) return isTableExpression(element.initializer, seen);
        if (ts.isSpreadAssignment(element) || ts.isSpreadElement(element))
          return isTableExpression(element.expression, seen);
        return ts.isExpression(element) && isTableExpression(element, seen);
      });
    }
    return false;
  };

  const violations: Violation[] = [];
  for (const { file } of entries) {
    const sourceFile = program.getSourceFile(file);
    const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) continue;
    const from = toRepoPath(rootDir, file);

    const visit = (namespace: ts.Symbol, prefix: string, visited: Set<ts.Symbol>): void => {
      if (visited.has(namespace)) return;
      visited.add(namespace);
      for (const exported of checker.getExportsOfModule(namespace)) {
        const resolved = resolveAlias(exported);
        const name = `${prefix}${exported.name}`;
        if (resolved.flags & ts.SymbolFlags.Module) {
          visit(resolved, `${name}.`, visited);
        } else if (isTableSymbol(resolved, new Set())) {
          const declaration = resolved.declarations?.[0];
          const where = declaration
            ? toRepoPath(rootDir, declaration.getSourceFile().fileName)
            : "";
          violations.push({
            rule: "no-table-export",
            from,
            to: `${name} (${where})`,
            message:
              "a module's table definitions stay internal; export functions or events instead (ADR-0015 rule 5)",
          });
        }
      }
    };
    visit(moduleSymbol, "", new Set());
  }
  return violations;
}

/** Unwraps parentheses, `as`, `satisfies`, and non-null assertions. */
function skipOuter(node: ts.Expression): ts.Expression {
  let expression = node;
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  )
    expression = expression.expression;
  return expression;
}

function listFiles(dir: string, accept: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") files.push(...listFiles(path, accept));
    } else if (accept(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

/** Blanks `--` and `/* *\/` comments, keeping offsets and line breaks. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

interface SqlFragment {
  text: string;
  /** 1-based line where the fragment starts. */
  line: number;
}

interface SchemaDefinition {
  name: string;
  line: number;
}

/** SQL text inside TypeScript: `sql` templates, `sql.raw(...)`, and strings that read as SQL. */
function sqlInTypeScript(file: string, content: string) {
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.ESNext, true);
  const fragments: SqlFragment[] = [];
  const schemas: SchemaDefinition[] = [];
  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const calleeName = (node: ts.Expression): string | undefined =>
    ts.isIdentifier(node)
      ? node.text
      : ts.isPropertyAccessExpression(node)
        ? `${calleeName(node.expression) ?? ""}.${node.name.text}`
        : undefined;
  const templateText = (template: ts.TemplateLiteral): string =>
    ts.isNoSubstitutionTemplateLiteral(template)
      ? template.text
      : [template.head.text, ...template.templateSpans.map((span) => span.literal.text)].join(" ");

  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && calleeName(node.tag) === "sql") {
      fragments.push({ text: templateText(node.template), line: lineOf(node) });
      // Substitutions can hold more SQL: `sql.raw(...)`, nested `sql` templates, strings.
      if (ts.isTemplateExpression(node.template))
        for (const span of node.template.templateSpans) visit(span.expression);
      return;
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      const [first] = node.arguments;
      if (name === "sql.raw" && first !== undefined && ts.isStringLiteralLike(first)) {
        fragments.push({ text: first.text, line: lineOf(first) });
        return;
      }
      const isPgSchema = name === "pgSchema" || name?.endsWith(".pgSchema") === true;
      if (isPgSchema && first !== undefined && ts.isStringLiteralLike(first))
        schemas.push({ name: first.text, line: lineOf(first) });
    }
    if (ts.isStringLiteralLike(node) && SQL_START.test(node.text))
      fragments.push({ text: node.text, line: lineOf(node) });
    else if (ts.isTemplateExpression(node) && SQL_START.test(templateText(node)))
      fragments.push({ text: templateText(node), line: lineOf(node) });
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { fragments, schemas };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rule 5, second half: a module's SQL and Drizzle schema name only its own PostgreSQL schema. */
export function checkSchemaOwnership(rootDir: string, modules: readonly ModuleInfo[]): Violation[] {
  const ownerBySchema = new Map(modules.map((m) => [schemaNameOf(m.moduleId), m.moduleId]));
  const violations: Violation[] = [];

  for (const module of modules) {
    const own = schemaNameOf(module.moduleId);
    const fragments: (SqlFragment & { file: string })[] = [];
    const moduleDir = join(rootDir, module.dir);

    for (const file of listFiles(join(moduleDir, "migrations"), (n) => n.endsWith(".sql")))
      fragments.push({ file, text: stripSqlComments(readFileSync(file, "utf8")), line: 1 });

    const sources = listFiles(
      join(moduleDir, "src"),
      (n) => /\.[cm]?tsx?$/.test(n) && !TEST_FILE.test(n),
    );
    for (const file of sources) {
      const found = sqlInTypeScript(file, readFileSync(file, "utf8"));
      for (const fragment of found.fragments)
        fragments.push({ file, text: stripSqlComments(fragment.text), line: fragment.line });
      for (const schema of found.schemas.filter((s) => s.name !== own)) {
        violations.push({
          rule: "own-schema-only",
          from: `${toRepoPath(rootDir, file)}:${schema.line}`,
          to: schema.name,
          message: `${module.moduleId} defines its tables only in its own PostgreSQL schema ${own} (ADR-0016)`,
        });
      }
    }

    for (const [schema, owner] of ownerBySchema) {
      if (schema === own) continue;
      const name = escapeRegExp(schema);
      // `"schema".object` or `schema.object` (not a value like `'core_ledger.entry'`),
      // `SCHEMA [IF [NOT] EXISTS] "schema"` (GRANT, CREATE, DROP, SET SCHEMA…), or the schema
      // anywhere in a `search_path` list.
      const reference = new RegExp(
        [
          `(?<![\\w$"'.])("?)${name}\\1(?=\\s*\\.)`,
          `\\bschema\\s+(?:if\\s+(?:not\\s+)?exists\\s+)?(["']?)${name}\\2(?![\\w$])`,
          `\\bsearch_path\\s*(?:to|=)\\s*(?:["']?[\\w$]+["']?\\s*,\\s*)*(["']?)${name}\\3(?![\\w$])`,
        ].join("|"),
        "gi",
      );
      for (const fragment of fragments) {
        for (const match of fragment.text.matchAll(reference)) {
          const before = fragment.text.slice(0, match.index);
          const line = fragment.line + (before.match(/\n/g)?.length ?? 0);
          const from = `${toRepoPath(rootDir, fragment.file)}:${line}`;
          const foreignKey = /\breferences\s*$/i.test(before);
          if (foreignKey && module.dependsOn.includes(owner)) continue;
          violations.push({
            rule: "own-schema-only",
            from,
            to: schema,
            message: foreignKey
              ? `a foreign key may point only to modules in mustawfi.dependsOn; ${module.moduleId} does not depend on ${owner} (ADR-0016)`
              : `${module.moduleId}'s SQL touches only its own schema ${own}; reach ${owner} through its public interface (ADR-0015 rule 5)`,
          });
        }
      }
    }
  }
  return violations;
}
